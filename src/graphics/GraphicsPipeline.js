import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { resolveGraphicsSettings } from './GraphicsSettings.js';

// Five-tap contrast-adaptive sharpening: edge-adaptive, avoids amplifying
// flat-area noise, and is deliberately cheaper than a full extra AA algorithm.
const CAS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    pixelStep: { value: new THREE.Vector2(1,1) },
    strength: { value: .23 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 pixelStep;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, pixelStep.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, pixelStep.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(pixelStep.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(pixelStep.x, 0.0)).rgb;
      vec3 lowest = min(c.rgb, min(min(n, s), min(e, w)));
      vec3 highest = max(c.rgb, max(max(n, s), max(e, w)));
      float localContrast = clamp(dot(highest - lowest, vec3(.2126,.7152,.0722)) * 1.8, 0.0, 1.0);
      float adaptive = strength * (1.0 - localContrast * .65);
      vec3 sharp = c.rgb * (1.0 + adaptive * 4.0) - (n + s + e + w) * adaptive;
      gl_FragColor = vec4(max(sharp, vec3(0.0)), c.a);
    }
  `,
};

export class GraphicsPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.reflectionBase = new WeakMap();
    this.emissiveBase = new WeakMap();
    this.faulted = false;

    // Render target provides HDR headroom to the bloom pass; two-sample MSAA
    // is enabled when supported to preserve edge AA lost through a composer.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ssr = null; // Heavy pass is allocated only on an SSR-enabled preset.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1,1), .25, .22, 1.1);
    this.composer.addPass(this.bloom);
    this.cas = new ShaderPass(CAS_SHADER);
    this.composer.addPass(this.cas);
    this.composer.addPass(new OutputPass());
    this.world = null;
    this.settings = null;
  }

  createSSR() {
    if (this.ssr) return;
    this.ssr = new SSRPass({
      renderer:this.renderer, scene:this.scene, camera:this.camera,
      width:this.width, height:this.height, selects:[],
    });
    this.ssr.thickness = .018;
    this.ssr.opacity = .38;
    this.ssr.distanceAttenuation = true;
    this.ssr.fresnel = true;
    this.ssr.blur = true;
    this.ssr.resolutionScale = .5;
    this.composer.insertPass(this.ssr, 1);
    this.refreshSSRTargets();
  }

  refreshSSRTargets() {
    if (!this.ssr) return;
    const selected = [];
    this.world?.traverse(object => {
      if (!object.isMesh || !object.visible || selected.length >= 96) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some(m => m && m.metalness >= .55 && m.roughness <= .65 && m.transparent !== true)) {
        selected.push(object);
      }
    });
    this.ssr.selects = selected;
  }

  setWorld(world) {
    this.world = world;
    this.refreshSSRTargets();
    this.updateMaterials();
  }

  updateMaterials() {
    if (!this.world || !this.settings) return;
    const touched = new Set();
    this.world.traverse(object => {
      if (!object.isMesh) return;
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!m || touched.has(m)) continue;
        touched.add(m);
        if (m.map) {
          m.map.anisotropy = this.settings.anisotropy;
          m.map.needsUpdate = true;
        }
        if (m.metalness >= .45 && 'envMapIntensity' in m) {
          if (!this.reflectionBase.has(m)) this.reflectionBase.set(m, m.envMapIntensity);
          m.envMapIntensity = this.reflectionBase.get(m) * this.settings.metalReflectionStrength;
        }
        if (m.emissive?.getHex?.() !== 0 && 'emissiveIntensity' in m) {
          if (!this.emissiveBase.has(m)) this.emissiveBase.set(m, m.emissiveIntensity);
          m.emissiveIntensity = this.emissiveBase.get(m) * this.settings.vfxScale;
        }
      }
    });
  }

  setQuality(key, capabilities) {
    const settings = resolveGraphicsSettings(key, capabilities);
    this.settings = settings;
    this.renderer.setPixelRatio(settings.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    const mapSize = settings.shadowResolution;
    const lights = this.scene.children.filter(object => object.isLight && object.castShadow && object.shadow);
    for (const light of lights) {
      if (light.shadow.mapSize.x !== mapSize || light.shadow.mapSize.y !== mapSize) {
        light.shadow.mapSize.set(mapSize, mapSize);
        light.shadow.map?.dispose();
        light.shadow.map = null;
        light.shadow.needsUpdate = true;
      }
    }

    try {
      if (settings.ssr) this.createSSR();
      if (this.ssr) {
        this.ssr.enabled = settings.ssr;
        this.ssr.resolutionScale = settings.ssrScale || .5;
      }
    } catch (error) {
      console.warn('SSR unavailable on this GPU; falling back to environment reflections.', error);
      if (this.ssr) this.ssr.enabled = false;
    }
    this.bloom.enabled = settings.bloomStrength > 0;
    this.bloom.strength = settings.bloomStrength * settings.vfxScale;
    this.bloom.radius = .24;
    this.bloom.threshold = 1.06;
    this.cas.uniforms.strength.value = settings.sharpen;
    this.updateMaterials();
    this.resize(this.width, this.height);
    return settings;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (!this.settings) return;
    this.composer.setPixelRatio(this.settings.pixelRatio);
    this.composer.setSize(this.width, this.height);
    const sw = Math.max(1, Math.round(this.width * this.settings.pixelRatio));
    const sh = Math.max(1, Math.round(this.height * this.settings.pixelRatio));
    const samples = this.settings.msaaSamples;
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;
    this.cas.uniforms.pixelStep.value.set(1 / sw, 1 / sh);
    this.bloom.setSize(
      Math.max(1, Math.floor(sw * this.settings.bloomScale)),
      Math.max(1, Math.floor(sh * this.settings.bloomScale)),
    );
  }

  render() {
    if (!this.settings || this.faulted) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    try {
      this.composer.render();
    } catch (error) {
      console.warn('Post-processing failed; disabling it for stable skating.', error);
      this.faulted = true;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.ssr?.dispose();
    this.bloom.dispose();
    this.cas.dispose();
    this.composer.dispose();
  }
}
