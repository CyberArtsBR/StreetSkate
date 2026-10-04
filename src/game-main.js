import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { StreetSkater } from './game/StreetSkater.js';
import { SkateInput } from './input/SkateInput.js';
import { FollowCamera } from './game/FollowCamera.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';

const container = document.querySelector('#viewport');
const app = document.querySelector('#app');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#25363d');
scene.fog = new THREE.FogExp2('#25363d', 0.005);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.08, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 5;
controls.maxDistance = 160;
controls.maxPolarAngle = Math.PI * 0.485;
controls.target.set(0, 0, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.32;
room.dispose();
pmrem.dispose();

const ambient = new THREE.HemisphereLight('#bce1ff', '#635649', 1.3);
scene.add(ambient);
const sun = new THREE.DirectionalLight('#fff1d9', 2.8);
sun.position.set(-25, 45, 10);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 45, bottom: -45, near: 1, far: 130 });
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.07;
sun.shadow.radius = 2;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: '#31454b', roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -3.18;
floor.receiveShadow = true;
scene.add(floor);

const views = {
  overview: { position: [66, 62, 80], target: [-1, 0, 0], caption: 'The whole playground', index: '01' },
  bowl: { position: [44, 30, 22], target: [14, -1, -11], caption: 'Connected curves. Continuous flow.', index: '02' },
  street: { position: [31, 17, 37], target: [-4, 1, 7], caption: 'Find your next connection', index: '03' },
  top: { position: [0, 100, 0.01], target: [0, 0, 0], caption: 'Every obstacle. Every possible line.', index: '—' },
};

let tween = null;
let park = null;
let collision = null;
let manifest = null;
let skater = null;
let followCamera = null;
let dusk = false;
let mode = 'skate';
let loaded = false;
const input = new SkateInput();
const clock = new THREE.Clock();

function setExploreView(name, instant = false) {
  const view = views[name];
  app.dataset.view = name;
  document.querySelectorAll('button[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === name);
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
  document.querySelector('#view-number').textContent = `${view.index} / 03`;
  document.querySelector('#view-caption').textContent = view.caption;
  const position = new THREE.Vector3(...view.position);
  if (innerWidth < 620 && name === 'overview') position.multiplyScalar(1.32);
  if (instant) {
    camera.position.copy(position);
    controls.target.set(...view.target);
    controls.update();
    tween = null;
  } else {
    tween = {
      start: performance.now(),
      from: camera.position.clone(),
      to: position,
      targetFrom: controls.target.clone(),
      targetTo: new THREE.Vector3(...view.target),
    };
  }
}

function setMode(nextMode) {
  if (!loaded) return;
  mode = nextMode;
  const skating = mode === 'skate';
  app.dataset.mode = mode;
  controls.enabled = !skating;
  input.clear();
  input.enabled = skating;
  skater.charge = 0;
  skater.jumpBuffer = 0;
  document.querySelector('#mode-toggle').classList.toggle('active', skating);
  document.querySelector('#mode-toggle').setAttribute('aria-pressed', String(skating));
  document.querySelector('#mode-toggle').setAttribute('aria-label', skating ? 'Switch to park explore mode' : 'Start skating');
  document.querySelector('#mode-label').textContent = skating ? 'SKATING' : 'EXPLORE';
  if (skating) {
    tween = null;
    followCamera?.snap(skater);
  } else {
    setExploreView('overview');
  }
}

function updateHud() {
  if (!skater) return;
  const kmh = Math.round(Math.abs(skater.speed) * 3.6);
  document.querySelector('#speed-value').textContent = String(kmh).padStart(2, '0');
  document.querySelector('#charge-fill').style.transform = `scaleX(${skater.charge.toFixed(3)})`;
  document.querySelector('#state-value').textContent = skater.bailTime > 0 ? 'BAIL' : skater.grounded ? 'RIDING' : 'AIR';
  document.querySelector('#score-value').textContent = skater.score.toLocaleString();
  document.querySelector('#trick-feedback').textContent = skater.feedbackTime > 0 ? skater.feedback : '';
  document.querySelector('#state-value').classList.toggle('air', !skater.grounded);
}

function showError(error) {
  const loading = document.querySelector('#loading');
  loading.querySelector('p').innerHTML = 'The playable park could not load.<span id="load-progress">Check the console for details.</span>';
  loading.querySelector('.loader').style.display = 'none';
  console.error(error);
}

async function loadGame() {
  try {
    const loader = new GLTFLoader();
    const [parkFile, collisionFile, parkManifest] = await Promise.all([
      loader.loadAsync('/assets/park/insanity-inspired-park.glb'),
      loader.loadAsync('/assets/park/park-collision.glb'),
      fetch('/assets/park/park-manifest.json').then(r => {
        if (!r.ok) throw new Error('Park manifest unavailable');
        return r.json();
      }),
    ]);
    manifest = parkManifest;
    park = parkFile.scene;
    collision = collisionFile.scene;
    park.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
    });
    scene.add(park);
    document.querySelector('#load-progress').textContent = 'Loading TheanchoURi and skateboard';

    skater = await new StreetSkater({ collision, spawn: manifest.spawn, rails: manifest.rails }).load();
    scene.add(skater.root);
    followCamera = new FollowCamera(camera);
    followCamera.snap(skater);

    document.querySelector('#poly-count').textContent = `${(manifest.visualTriangles / 1000).toFixed(1)}k triangles`;
    document.querySelector('#loading').classList.add('done');
    loaded = true;
    setMode('skate');
    window.streetSkate = { ready: true, scene, renderer, camera, manifest, park, collision, skater, setMode, setExploreView };
  } catch (error) {
    showError(error);
  }
}

controls.addEventListener('start', () => { tween = null; });
document.querySelectorAll('button[data-view]').forEach((button) => button.addEventListener('click', () => {
  if (mode !== 'explore') setMode('explore');
  setExploreView(button.dataset.view);
}));
document.querySelector('#reset').onclick = () => {
  if (mode === 'skate') { skater?.reset(); followCamera?.snap(skater); input.clear(); }
  else setExploreView('overview');
};
document.querySelector('#topview').onclick = () => {
  if (mode !== 'explore') setMode('explore');
  setExploreView('top');
};
document.querySelector('#mode-toggle').onclick = () => setMode(mode === 'skate' ? 'explore' : 'skate');
document.querySelector('#wireframe').onclick = (event) => {
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  park?.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.wireframe = enabled;
  });
};
document.querySelector('#lighting').onclick = (event) => {
  dusk = !dusk;
  sun.intensity = dusk ? 0.65 : 2.8;
  sun.color.set(dusk ? '#86b5ff' : '#fff1d9');
  ambient.intensity = dusk ? 0.8 : 1.3;
  scene.background.set(dusk ? '#141f32' : '#25363d');
  scene.fog.color.copy(scene.background);
  event.currentTarget.setAttribute('aria-label', dusk ? 'Switch to afternoon' : 'Switch to blue hour');
};

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.addEventListener('blur', () => {
  input.clear();
  if (skater) { skater.charge = 0; skater.jumpBuffer = 0; skater.accumulator = 0; }
});
setExploreView('overview', true);
loadGame();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;

  if (loaded && mode === 'skate' && document.hasFocus() && !document.hidden) {
    const state = input.read();
    skater.update(dt, state, elapsed);
    followCamera.update(skater, dt);
    updateHud();
    if (state.reset) followCamera.snap(skater);
  } else {
    if (tween) {
      const t = Math.min((performance.now() - tween.start) / 1100, 1);
      const smooth = t * t * (3 - 2 * t);
      camera.position.lerpVectors(tween.from, tween.to, smooth);
      controls.target.lerpVectors(tween.targetFrom, tween.targetTo, smooth);
      if (t === 1) tween = null;
    }
    if (mode === 'explore') controls.update();
  }

  renderer.render(scene, camera);
});
