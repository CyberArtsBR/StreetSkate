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


// Add the selective glow buffer over the normally lit environment.
// The environment never contributes to this texture.
const SELECTIVE_BLOOM_COMPOSITE = {
  uniforms: {
    tDiffuse: { value: null },
    bloomTexture: { value: null },
    bloomMix: { value: .38 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform float bloomMix;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 actorGlow = texture2D(bloomTexture, vUv).rgb;
      gl_FragColor = vec4(base.rgb + actorGlow * bloomMix, base.a);
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

    // A separate HDR composer isolates actor glow and ORBIT's emissive fixtures.
    // Other geometry stays black in this pass while preserving occlusion.
    const bloomTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
    });
    this.bloomComposer = new EffectComposer(renderer, bloomTarget);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1,1), .25, .24, .88);
    this.bloomComposer.addPass(this.bloom);
    this.blackoutMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.glowRoot = null;
    this.bloomSceneMeshes = null;
    this.bloomEnvironmentEmissives = [];
    this.bloomSceneChildCount = -1;
    this.bloomGlowMeshCount = -1;
    this.bloomCacheAge = 0;
    this.shadowAnchor = null;
    this.shadowWorldPosition = new THREE.Vector3();

    this.bloomComposite = new ShaderPass(SELECTIVE_BLOOM_COMPOSITE);
    this.bloomComposite.enabled = false;
    this.composer.addPass(this.bloomComposite);
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
    const candidates = [];
    this.world?.traverse(object => {
      if (!object.isMesh || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const reflective = materials.find(m => m && m.metalness >= .45 &&
        m.roughness <= .48 && m.transparent !== true && (m.emissiveIntensity || 0) < 1);
      if (!reflective) return;
      // Prefer large reflective floors/ramps over small repeated metal details.
      // Selection is rebuilt at world/preset changes, never each rendered frame.
      const radius = object.geometry?.boundingSphere?.radius || 1;
      const scale = object.getWorldScale?.(new THREE.Vector3()) || new THREE.Vector3(1, 1, 1);
      const projectedSize = radius * Math.max(scale.x, scale.y, scale.z);
      candidates.push({ object, score: projectedSize * (1.2 - reflective.roughness) });
    });
    candidates.sort((a, b) => b.score - a.score);
    this.ssr.selects = candidates.slice(0, this.settings?.ssrTargetLimit || 40).map(entry => entry.object);
  }

  setWorld(world) {
    this.world = world;
    this.bloomSceneMeshes = null;
    this.shadowAnchor = null;
    this.configureBloom();
    this.refreshSSRTargets();
    this.updateMaterials();
  }

  // StreetSkater.visual always contains ONLY the active rider and board.
  // Keeping the root rather than a static mesh list automatically handles
  // runtime rider GLB swaps and changes to the skateboard finish.
  setGlowTarget(root) {
    this.glowRoot = root;
    this.bloomSceneMeshes = null;
  }

  refreshBloomSceneCache() {
    const meshes = [];
    this.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
    const environmentEmissives = [];
    if (this.world?.userData.environmentBloom) {
      this.world.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => /^(LED|Grind) \/ /.test(material?.name || '') &&
          material.emissive?.getHex?.() > 0)) environmentEmissives.push(object);
      });
    }
    this.bloomSceneMeshes = meshes;
    this.bloomEnvironmentEmissives = environmentEmissives;
    this.bloomSceneChildCount = this.scene.children?.length ?? 0;
    this.bloomCacheAge = 0;
  }

  // Keep the existing directional light's direction intact while following
  // the active rider. This concentrates 1024² shadow texels near wheel contact
  // instead of spreading them across an entire 150-metre warehouse.
  updateContactShadows() {
    if (!this.settings || !this.glowRoot?.parent) return;
    const light = this.scene.children?.find(object => object.isDirectionalLight && object.castShadow && object.shadow);
    if (!light) return;
    const radius = this.settings.shadowCoverageRadius;
    const shadow = light.shadow, camera = shadow.camera;
    if (camera.left !== -radius || camera.right !== radius ||
        camera.top !== radius || camera.bottom !== -radius) {
      camera.left = camera.bottom = -radius;
      camera.right = camera.top = radius;
      camera.updateProjectionMatrix();
      shadow.needsUpdate = true;
    }
    // The former normal bias (0.07 m) separated board/wheel contact shadows.
    shadow.normalBias = this.settings.shadowNormalBias;
    if (!this.shadowAnchor || this.shadowAnchor.light !== light) {
      this.shadowAnchor = {
        light, position: light.position.clone(), target: light.target.position.clone(),
      };
    }
    this.glowRoot.getWorldPosition(this.shadowWorldPosition);
    const texel = (radius * 2) / 1024;
    const snap = value => Math.round(value / texel) * texel;
    const offsetX = snap(this.shadowWorldPosition.x - this.shadowAnchor.target.x);
    const offsetZ = snap(this.shadowWorldPosition.z - this.shadowAnchor.target.z);
    const anchor = this.shadowAnchor;
    if (Math.abs(light.target.position.x - anchor.target.x - offsetX) > 1e-6 ||
        Math.abs(light.target.position.z - anchor.target.z - offsetZ) > 1e-6) {
      light.position.set(anchor.position.x + offsetX, anchor.position.y, anchor.position.z + offsetZ);
      light.target.position.set(anchor.target.x + offsetX, anchor.target.y, anchor.target.z + offsetZ);
      light.target.updateMatrixWorld();
      shadow.needsUpdate = true;
    }
  }

  renderSelectiveBloom() {
    if (!this.glowRoot?.parent) return false;
    const allowed = new Set();
    this.glowRoot.traverse(object => {
      if (object.isMesh) allowed.add(object);
    });
    const childCount = this.scene.children?.length ?? 0;
    // Recheck occasionally for procedural objects, immediately for rider swaps
    // and top-level scene changes; ordinary frames avoid two full traversals.
    if (!this.bloomSceneMeshes || this.bloomCacheAge >= 120 ||
        this.bloomSceneChildCount !== childCount || this.bloomGlowMeshCount !== allowed.size) {
      this.refreshBloomSceneCache();
      this.bloomGlowMeshCount = allowed.size;
    }
    this.bloomCacheAge++;
    for (const object of this.bloomEnvironmentEmissives) allowed.add(object);
    if (!allowed.size) return false;
    const replaced = [];
    const originalBackground = this.scene.background;
    const originalFog = this.scene.fog;
    const originalOverride = this.scene.overrideMaterial;
    const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
    try {
      // Reuse the preceding shadow atlas; do not recalculate costly maps twice
      // per frame merely to produce a small actor-only glow mask.
      this.renderer.shadowMap.autoUpdate = false;
      this.scene.background = null;
      this.scene.fog = null;
      this.scene.overrideMaterial = null;
      // Dark geometry still writes depth: rider bloom cannot appear through walls.
      for (const object of this.bloomSceneMeshes) {
        if (allowed.has(object)) continue;
        replaced.push([object, object.material]);
        object.material = this.blackoutMaterial;
      }
      this.bloomComposer.render();
      this.bloomComposite.uniforms.bloomTexture.value = this.bloomComposer.readBuffer.texture;
      return true;
    } finally {
      for (const [object, material] of replaced) object.material = material;
      this.scene.background = originalBackground;
      this.scene.fog = originalFog;
      this.scene.overrideMaterial = originalOverride;
      this.renderer.shadowMap.autoUpdate = shadowAutoUpdate;
    }
  }

  updateMaterials() {
    if (!this.world || !this.settings) return;
    const touched = new Set(), textures = new Set();
    this.world.traverse(object => {
      if (!object.isMesh) return;
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!m || touched.has(m)) continue;
        touched.add(m);
        for (const key of ['map','normalMap','bumpMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap']) {
          const map = m[key];
          if (!map?.isTexture || textures.has(map)) continue;
          textures.add(map);
          if (map.anisotropy !== this.settings.anisotropy) {
            map.anisotropy = this.settings.anisotropy;
            map.needsUpdate = true;
          }
        }
        if (m.metalness >= .45 && 'envMapIntensity' in m) {
          if (!this.reflectionBase.has(m)) this.reflectionBase.set(m, m.envMapIntensity);
          m.envMapIntensity = this.reflectionBase.get(m) * this.settings.metalReflectionStrength;
        }
        if (m.emissive?.getHex?.() > 0 && 'emissiveIntensity' in m) {
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
      else if (this.ssr) {
        // Reclaim the SSR render targets when downgrading instead of merely
        // hiding a pass that continues to occupy GPU memory.
        this.composer.passes.splice(this.composer.passes.indexOf(this.ssr), 1);
        this.ssr.dispose();
        this.ssr = null;
      }
      if (this.ssr) {
        this.ssr.enabled = true;
        this.ssr.resolutionScale = settings.ssrScale || .5;
        this.refreshSSRTargets();
      }
    } catch (error) {
      console.warn('SSR unavailable on this GPU; falling back to environment reflections.', error);
      if (this.ssr) this.ssr.enabled = false;
    }
    this.configureBloom();
    this.cas.enabled = settings.sharpen > 0;
    this.cas.uniforms.strength.value = settings.sharpen;
    this.shadowAnchor = null;
    this.updateMaterials();
    this.resize(this.width, this.height);
    return settings;
  }

  configureBloom() {
    if (!this.settings) return;
    const orbit = Boolean(this.world?.userData.environmentBloom);
    // Performance means no extra scene pass, even on emissive-heavy ORBIT.
    this.bloomComposite.enabled = this.settings.bloomStrength > 0;
    this.bloom.strength = orbit ? .24 : this.settings.bloomStrength * this.settings.vfxScale;
    this.bloom.radius = .24;
    this.bloom.threshold = orbit ? 1.25 : .88;
    this.bloomComposite.uniforms.bloomMix.value = orbit ? .55 : .32;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (!this.settings) return;
    this.composer.setPixelRatio(this.settings.pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.bloomComposer.setPixelRatio(this.settings.pixelRatio * this.settings.bloomScale);
    this.bloomComposer.setSize(this.width, this.height);
    const sw = Math.max(1, Math.round(this.width * this.settings.pixelRatio));
    const sh = Math.max(1, Math.round(this.height * this.settings.pixelRatio));
    const samples = this.settings.msaaSamples;
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;
    this.cas.uniforms.pixelStep.value.set(1 / sw, 1 / sh);
  }

  render() {
    if (!this.settings || this.faulted) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    try {
      this.updateContactShadows();
      if (this.bloomComposite.enabled) {
        const validBloom = this.renderSelectiveBloom();
        this.bloomComposite.enabled = validBloom;
      }
      this.composer.render();
      // Re-enable on the next frame after a transient/no-rider loading state.
      this.bloomComposite.enabled = this.settings.bloomStrength > 0;
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
    this.bloomComposite.dispose();
    this.bloomComposer.dispose();
    this.blackoutMaterial.dispose();
    this.cas.dispose();
    this.composer.dispose();
  }
}
