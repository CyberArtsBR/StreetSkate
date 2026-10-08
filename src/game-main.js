import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { StreetSkater } from './game/StreetSkater.js';
import { SkateInput } from './input/SkateInput.js';
import { FollowCamera } from './game/FollowCamera.js';
import { createDebugOverlay, captureAuditTelemetry } from './game/DebugOverlay.js';
import { captureGameplayState } from './game/core/GameplayStateSnapshot.js';
import { TransitionDebugVisualizer, transitionDebugSummary } from './game/transitions/TransitionDebugVisualizer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assembleExpandedPark } from './park/ExpandedPark.js';
import { createSolarDockPark } from './park/SolarDockPark.js';
import { SkateAudio } from './game/SkateAudio.js';
import { SKATEBOARD_FINISHES } from './skateboard/BoardFinishes.js';
import { surfaceTexturesReady } from './park/SurfaceMaterials.js';
import { loadSolarSky } from './park/SolarSky.js';
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

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.08, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 5;
controls.maxDistance = 260;
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
let transitionDebug = null;
let dusk = false;
let solarSky = null;
let mode = 'skate';
let loaded = false;
let paused = false;
let lastInputState = {};
const input = new SkateInput(renderer.domElement);
const debugOverlay = createDebugOverlay({
  button: document.querySelector('#debug-overlay'),
  panel: document.querySelector('#debug-panel'),
});
const clock = new THREE.Clock();
const skateAudio = new SkateAudio();
window.addEventListener('pointerdown', () => skateAudio.unlock(), { passive: true });
window.addEventListener('keydown', () => skateAudio.unlock(), { passive: true });
const legacyPark = new URLSearchParams(location.search).get('park') === 'legacy';
const daylightColor = legacyPark ? '#25363d' : '#c1d1cf';

function applyLighting() {
  sun.intensity = dusk ? 0.65 : solarSky ? 2.1 : 2.8;
  sun.color.set(dusk ? '#86b5ff' : solarSky ? '#ffddb8' : '#fff1d9');
  ambient.intensity = dusk ? 0.4 : solarSky ? 0.65 : legacyPark ? 1.3 : 0.9;
  if (solarSky) {
    scene.background = solarSky.background;
    scene.backgroundIntensity = dusk ? 0.22 : 0.9;
    scene.environmentIntensity = dusk ? 0.22 : 0.65;
    scene.fog.color.set(dusk ? '#383e50' : '#c5b7a7');
  } else {
    scene.background.set(dusk ? '#141f32' : daylightColor);
    scene.fog.color.copy(scene.background);
  }
}

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
      start: performance.now(), from: camera.position.clone(), to: position,
      targetFrom: controls.target.clone(), targetTo: new THREE.Vector3(...view.target),
    };
  }
}

function setCameraMode(nextMode) {
  if (!followCamera) return;
  followCamera.setMode(nextMode, mode === 'skate' ? skater : null);
  const button = document.querySelector('#camera-mode');
  button.setAttribute('aria-pressed', String(followCamera.mode === 'follow'));
  button.setAttribute('aria-label', `Camera: ${followCamera.mode}. Cycle camera view`);
  document.querySelector('#camera-label').textContent = followCamera.mode.toUpperCase();
  // New preference version makes high follow the default even for earlier users.
  try { localStorage.setItem('streetskate.cameraMode.v2', followCamera.mode); } catch { /* Storage is optional. */ }
}

function toggleCameraMode() {
  const modes = ['follow', 'classic', 'fixed'];
  setCameraMode(modes[(modes.indexOf(followCamera?.mode) + 1) % modes.length]);
}

function goToSpot(id) {
  const spot = manifest?.spots?.find(item => item.id === id);
  if (!loaded || !spot || !skater) return;
  const score = skater.score;
  skater.spawn.set(...spot.position);
  skater.spawnHeading = spot.heading || 0;
  skater.reset(skater.spawn, spot.heading || 0);
  skater.score = score;
  setMode('skate');
  followCamera.snap(skater);
  document.querySelectorAll('[data-spot]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.spot === id));
  });
  renderer.domElement.focus({ preventScroll: true });
}

function setPaused(value) {
  paused = Boolean(value) && mode === 'skate';
  app.dataset.paused = String(paused);
  if (paused) {
    skateAudio.silence();
    input.clear();
    if (skater) {
      skater.charge = 0; skater.jumpBuffer = 0; skater.accumulator = 0;
      skater.pumpReleaseQueued = false; skater.pumpHoldTime = 0;
      skater.pendingStepInput = { olliePressed: false, grindPressed: false, directionTaps: [] };
      skater.tricks.clearPendingInput();
    }
  }
  updateHud();
}

function setMode(nextMode) {
  if (!loaded) return;
  mode = nextMode;
  const skating = mode === 'skate';
  app.dataset.mode = mode;
  controls.enabled = !skating;
  setPaused(false);
  input.clear();
  input.enabled = skating;
  skater.charge = 0;
  skater.jumpBuffer = 0;
  skater.pumpReleaseQueued = false;
  skater.pumpHoldTime = 0;
  skater.accumulator = 0;
  skater.pendingStepInput = { olliePressed: false, grindPressed: false, directionTaps: [] };
  skater.tricks.clearPendingInput();
  skater.visual.visible = true;
  document.querySelector('#mode-toggle').classList.toggle('active', skating);
  document.querySelector('#mode-toggle').setAttribute('aria-pressed', String(skating));
  document.querySelector('#mode-toggle').setAttribute('aria-label', skating ? 'Switch to park explore mode' : 'Start skating');
  document.querySelector('#mode-label').textContent = skating ? 'SKATING' : 'EXPLORE';
  if (skating) {
    tween = null;
    followCamera?.snap(skater);
  } else setExploreView('overview');
}

function updateHud() {
  if (!skater) return;
  const kmh = Math.round(Math.abs(skater.speed) * 3.6);
  document.querySelector('#speed-value').textContent = String(kmh).padStart(2, '0');
  document.querySelector('#charge-fill').style.transform = `scaleX(${skater.charge.toFixed(3)})`;
  let state = skater.grounded ? 'RIDING' : 'AIR';
  if (skater.transitionAir && !skater.transitionAir.transferring) state = 'VERT';
  if (skater.manual) state = skater.manual === 'noseManual' ? 'NOSE MANUAL' : 'MANUAL';
  if (skater.grind) state = 'GRIND';
  if (skater.wallRide) state = 'WALL RIDE';
  if (skater.bailTime > 0) state = 'BAIL';
  if (paused) state = 'PAUSED';
  document.querySelector('#state-value').textContent = state;
  document.querySelector('#score-value').textContent = skater.score.toLocaleString();
  document.querySelector('#trick-feedback').textContent = skater.feedbackTime > 0 ? skater.feedback : skater.tricks.comboText();
  document.querySelector('#state-value').classList.toggle('air', !skater.grounded || Boolean(skater.grind));
}

function showError(error) {
  const loading = document.querySelector('#loading');
  loading.querySelector('p').innerHTML = 'The game could not continue.<span id="load-progress"></span>';
  loading.querySelector('#load-progress').textContent = error?.message || 'Reload the game to try again.';
  loading.querySelector('.loader').style.display = 'none';
  loading.classList.remove('done');
  if (!loading.querySelector('button')) {
    const retry = document.createElement('button');
    retry.textContent = 'Reload game';
    retry.addEventListener('click', () => location.reload());
    loading.append(retry);
  }
  console.error(error);
}

async function loadGame() {
  try {
    let world;
    if (legacyPark) {
      const loader = new GLTFLoader();
      const [parkFile, collisionFile, parkManifest, expandedFile] = await Promise.all([
        loader.loadAsync('/assets/park/insanity-inspired-park.glb'),
        loader.loadAsync('/assets/park/park-collision.glb'),
        fetch('/assets/park/park-manifest.json').then(r => {
          if (!r.ok) throw new Error('Park manifest unavailable');
          return r.json();
        }),
        loader.loadAsync('/assets/park/halfnew.glb?v=fixed-black'),
      ]);
      world = { ...assembleExpandedPark(expandedFile.scene, parkFile.scene, collisionFile.scene, parkManifest), manifest: parkManifest };
    } else {
      document.querySelector('#load-progress').textContent = 'Building Solar Dock';
      world = createSolarDockPark();
      document.querySelector('#load-progress').textContent = 'Loading concrete, plywood and mural artwork';
      await surfaceTexturesReady();
    }
    ({ park, collision, manifest } = world);
    scene.background.set(daylightColor);
    scene.fog.color.set(daylightColor);
    scene.fog.density = legacyPark ? 0.005 : 0.0014;
    floor.position.y = legacyPark ? -3.18 : -6;
    floor.material.color.set(legacyPark ? '#31454b' : '#b58e6c');
    if (!legacyPark) {
      ambient.intensity = 0.9;
      renderer.toneMappingExposure = 0.94;
      scene.environmentIntensity = 0.24;
      document.querySelector('#load-progress').textContent = 'Loading 4K HDRI sky and environment lighting';
      try {
        solarSky = await loadSolarSky(renderer);
        scene.environment = solarSky.environment.texture;
        environment.dispose();
      } catch (error) {
        console.warn('HDRI unavailable; keeping fallback lighting.', error);
      }
    }
    applyLighting();
    const rampTuning = { factor: manifest.transitionScale, baked: true };
    park.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = object.userData.castShadow !== false;
      object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
    });
    scene.add(park);
    document.querySelector('#load-progress').textContent = 'Loading TheanchoURi and skateboard';

    skater = await new StreetSkater({ collision, spawn: manifest.spawn, rails: manifest.rails,
      playableRegions: manifest.playableRegions }).load();
    scene.add(skater.root);
    followCamera = new FollowCamera(camera);
    let savedCamera = 'follow';
    try { savedCamera = localStorage.getItem('streetskate.cameraMode.v2') || 'follow'; } catch { /* Use high follow by default. */ }
    setCameraMode(savedCamera);

    const debugTransitions = new URLSearchParams(window.location.search).get('debug') === '1';
    if (debugTransitions) {
      transitionDebug = new TransitionDebugVisualizer(skater.transitions);
      scene.add(transitionDebug.group);
    }

    document.querySelector('#poly-count').textContent = `${(manifest.visualTriangles / 1000).toFixed(1)}k triangles`;
    document.querySelector('.asset-meta > span').textContent = manifest.dimensions || '136 × 92 m · 3 AREAS';
    const center = legacyPark ? new THREE.Vector3(34, 0, 23) : new THREE.Vector3(0, 0, -8);
    if (manifest.views) Object.assign(views, manifest.views);
    else {
      views.overview = { position: [155, 108, 165], target: center.toArray(), caption: 'Three connected areas', index: '01' };
      views.top = { position: [34, 160, 23.01], target: center.toArray(), caption: 'All three skating areas', index: '—' };
    }
    const spotNav = document.querySelector('#spot-nav');
    for (const spot of manifest.spots || []) {
      const button = document.createElement('button');
      button.textContent = spot.label; button.dataset.spot = spot.id;
      button.title = `Start at ${spot.label}`;
      button.setAttribute('aria-pressed', String(spot.id === 'street'));
      button.onclick = () => goToSpot(spot.id);
      spotNav.append(button);
    }
    spotNav.hidden = !manifest.spots?.length;
    if (legacyPark) {
      document.title = 'StreetSkate — Legacy park';
      document.querySelector('.edition').textContent = 'LEGACY PARK';
      const link = document.querySelector('.download');
      link.href = '/'; link.textContent = 'SOLAR DOCK ↗';
    }
    renderer.domElement.tabIndex = 0;
    const finishes = document.querySelector('#board-finishes');
    const finishNames = ['Sunset', 'Ocean', 'Aqua', 'Lime', 'Gold', 'Nebula', 'Graphite', 'Pearl'];
    SKATEBOARD_FINISHES.forEach((finish, i) => {
      const button = document.createElement('button'); button.style.background = finish.cssGradient;
      button.title = finishNames[i]; button.setAttribute('aria-label', `Skate ${finishNames[i]}`);
      button.setAttribute('aria-pressed', String(skater.board.finishIndex === i));
      button.onclick = () => { skater.board.setFinish(i); finishes.querySelectorAll('button').forEach((b,j) => b.setAttribute('aria-pressed',String(i===j))); button.blur(); };
      finishes.append(button);
    });
    const soundButton = document.querySelector('#sound-toggle');
    soundButton.textContent = skateAudio.enabled ? 'SOUND ON' : 'SOUND OFF';
    soundButton.setAttribute('aria-pressed', String(skateAudio.enabled));
    soundButton.onclick = () => { const enabled = skateAudio.toggle(); soundButton.textContent = enabled ? 'SOUND ON' : 'SOUND OFF'; soundButton.setAttribute('aria-pressed', String(enabled)); soundButton.blur(); };
    sun.target.position.copy(center);
    scene.add(sun.target);
    sun.position.copy(center).add(solarSky ? new THREE.Vector3(-55, 38, 18) : new THREE.Vector3(-25, 65, 10));
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 200 });
    sun.shadow.camera.updateProjectionMatrix();
    document.querySelector('#loading').classList.add('done');
    loaded = true;
    setMode('skate');
    window.streetSkate = {
      ready: true, scene, renderer, camera, manifest, park, collision, skater,
      setMode, setExploreView, setPaused, setCameraMode, goToSpot, controlsVersion: 'thug-controls-v2', rampTuning,
      // Phase 1 QA hook: side-effect-free canonical gameplay snapshot shared
      // with deterministic replay/debugging. This never repairs or mutates state.
      captureState: () => captureGameplayState(skater),
      // QA-only readback of the semantic input object consumed by the latest
      // focused animation frame. Returning a copy prevents tests/debug tools
      // from mutating the live input path.
      captureInput: () => ({ ...lastInputState }),
      toggleDebugOverlay: () => debugOverlay.toggle(),
      captureAuditTelemetry: () => captureAuditTelemetry({
        skater, followCamera, camera, input: lastInputState,
        paused, focused: document.hasFocus(),
      }),
      transitionDebug,
      captureTransitionDebug: () => transitionDebugSummary(skater.transitions),
    };
  } catch (error) { showError(error); }
}

controls.addEventListener('start', () => { tween = null; });
document.querySelectorAll('button[data-view]').forEach((button) => button.addEventListener('click', () => {
  if (mode !== 'explore') setMode('explore');
  setExploreView(button.dataset.view);
}));
document.querySelector('#reset').onclick = () => {
  if (mode === 'skate') { skater?.reset(); followCamera?.snap(skater); input.clear(); setPaused(false); }
  else setExploreView('overview');
};
document.querySelector('#topview').onclick = () => {
  if (mode !== 'explore') setMode('explore');
  setExploreView('top');
};
document.querySelector('#mode-toggle').onclick = () => setMode(mode === 'skate' ? 'explore' : 'skate');
document.querySelector('#camera-mode').onclick = toggleCameraMode;
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
  applyLighting();
  event.currentTarget.setAttribute('aria-label', dusk ? 'Switch to afternoon' : 'Switch to blue hour');
};

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
function suspendSkating() {
  skateAudio.silence();
  input.clear();
  if (loaded && mode === 'skate') setPaused(true);
}
window.addEventListener('blur', suspendSkating);
window.addEventListener('gamepaddisconnected', suspendSkating);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendSkating();
});
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  suspendSkating();
  showError(new Error('Graphics context lost. Reload to recover.'));
});
setExploreView('overview', true);
loadGame();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;
  if (document.hidden) return;

  // Never silently freeze on the last airborne frame when another overlay/window
  // takes focus. Make the suspension explicit and require a deliberate resume.
  if (loaded && mode === 'skate' && !document.hasFocus() && !paused) setPaused(true);
  if (loaded && mode === 'skate' && document.hasFocus() && !document.hidden) {
    const state = input.read();
    lastInputState = {
      ...state,
      directionTaps: [...(state.directionTaps || [])],
    };
    if (state.pausePressed) setPaused(!paused);
    if (state.cameraModePressed) toggleCameraMode();
    if (!paused) {
      skater.update(dt, state, elapsed);
      followCamera.update(skater, dt, state);
      if (state.reset) followCamera.snap(skater);
    }
    updateHud();
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
  debugOverlay.update(dt, {
    skater, followCamera, camera, input: lastInputState,
    paused, focused: document.hasFocus(),
  });
  transitionDebug?.update(skater);
  skateAudio.update(skater, loaded && mode === 'skate' && !paused && document.hasFocus());
  renderer.render(scene, camera);
});
