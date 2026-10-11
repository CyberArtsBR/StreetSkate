import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { StreetSkater } from './game/StreetSkater.js';
import { SkateInput } from './input/SkateInput.js';
import { FollowCamera } from './game/FollowCamera.js';
import { createDebugOverlay, captureAuditTelemetry } from './game/DebugOverlay.js';
import { captureGameplayState } from './game/core/GameplayStateSnapshot.js';
import { TransitionDebugVisualizer, transitionDebugSummary } from './game/transitions/TransitionDebugVisualizer.js';
import { createParkWorld, prepareParkRuntime, bindParkRuntime, disposeParkWorld } from './game/ParkRegistry.js';
import { SkateAudio } from './game/SkateAudio.js';
import { SKATEBOARD_FINISHES } from './skateboard/BoardFinishes.js';
import { loadSolarSky, createCloudBackdrop } from './park/SolarSky.js';
import { GameShell } from './game/GameShell.js';
import { graffitiToneForTrick } from './game/GraffitiTypography.js';
import { GraphicsPipeline } from './graphics/GraphicsPipeline.js';
import { GRAPHICS_PRESET_ORDER, loadGraphicsPreset, storeGraphicsPreset, normalizedGraphicsPreset, qualityFogDistance } from './graphics/GraphicsSettings.js';
import './style.css';
import './game-shell.css';

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
sun.shadow.mapSize.set(1024, 1024);
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

const graphicsPipeline = new GraphicsPipeline(renderer, scene, camera);
const graphicsStorage = (() => { try { return window.localStorage; } catch { return null; } })();
let graphicsPreset = loadGraphicsPreset(graphicsStorage);

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
let skyLoading = null;
let currentWorld = null;
let switchingWorld = false;
let mode = 'skate';
let loaded = false;
let paused = false;
let lastInputState = {};
let loadoutRequest = 0;
const input = new SkateInput(renderer.domElement);
const debugOverlay = new URLSearchParams(location.search).get('debug') === '1' ? createDebugOverlay({
  button: document.querySelector('#debug-overlay'),
  panel: document.querySelector('#debug-panel'),
}) : { update() {}, toggle() {} };
const clock = new THREE.Clock();
const skateAudio = new SkateAudio();
window.addEventListener('pointerdown', () => skateAudio.unlock(), { passive: true });
window.addEventListener('keydown', () => skateAudio.unlock(), { passive: true });
const legacyPark = new URLSearchParams(location.search).get('park') === 'legacy';
const gameShell = new GameShell({
  start: () => {
    if (!skater) return;
    skater.spawn.set(...manifest.spawn); skater.spawnHeading = Number(manifest.spawnHeading) || 0;
    skater.reset(skater.spawn, skater.spawnHeading);
    setMode('skate'); input.read(); input.clear(); followCamera.snap(skater);
  },
  pause: value => setPaused(value),
  camera: mode => setCameraMode(mode),
  graphics: name => applyGraphicsPreset(name),
  score: () => skater?.score || 0,
  countdownWarning: seconds => skateAudio.countdownCue(seconds),
  sound: enabled => { if (skateAudio.enabled !== enabled) skateAudio.toggle(); },
  deck: index => skater?.board?.setFinish(index),
  masterVolume: value => skateAudio.setMasterVolume(value),
  cancelLoadout: () => { loadoutRequest++; skater?.cancelRiderSwap?.(); },
  loadout: ({hero,board,location}) => selectLocation(location?.id, {hero,finish:board.finishIndex}),
});
gameShell.sound = skateAudio.enabled;
skateAudio.setMasterVolume(gameShell.music.masterVolume);
applyGraphicsPreset(graphicsPreset);
document.querySelector('#trick-guide-button').onclick = () => gameShell.openTutorial();

function applyGraphicsPreset(name) {
  graphicsPreset = normalizedGraphicsPreset(name);
  graphicsPipeline.setQuality(graphicsPreset, {
    devicePixelRatio: window.devicePixelRatio,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    maxSamples: renderer.capabilities.maxSamples || 2,
  });
  gameShell.graphicsIndex = GRAPHICS_PRESET_ORDER.indexOf(graphicsPreset);
  storeGraphicsPreset(graphicsStorage, graphicsPreset);
  if (currentWorld) {
    graphicsPipeline.setWorld(currentWorld.park);
    applyLighting();
  }
}

function applyLighting() {
  if (!currentWorld) return;
  const presentation = currentWorld.presentation;
  const sky = presentation.sky && solarSky;
  const settings = !sky && presentation.sky
    ? { ...presentation, ...presentation.fallback } : presentation;
  sun.intensity = dusk ? 0.65 : settings.keyIntensity;
  sun.color.set(dusk ? '#86b5ff' : settings.keyColor);
  ambient.color.set(settings.ambientSky);
  ambient.groundColor.set(settings.ambientGround);
  ambient.intensity = dusk ? 0.4 : settings.ambientIntensity;
  renderer.toneMappingExposure = settings.exposure * (graphicsPipeline.settings?.exposureMultiplier || 1);
  scene.environment = sky?.environment?.texture || environment.texture;
  scene.environmentIntensity = (dusk ? 0.22 : settings.environmentIntensity) *
    ((graphicsPipeline.settings?.environmentIntensity || .84) / .84);
  scene.backgroundBlurriness = graphicsPipeline.settings?.environmentBlur || 0;
  if (sky) {
    scene.background = solarSky.background;
    scene.backgroundIntensity = dusk ? 0.22 : settings.backgroundIntensity;
  } else {
    scene.background = new THREE.Color(dusk ? '#141f32' : settings.background || '#c1d1cf');
    scene.backgroundIntensity = 1;
  }
  const fogColor = dusk ? '#383e50' : settings.fogColor;
  const qualityFog = graphicsPipeline.settings?.fogDensity || .0042;
  const fogRange = settings.fogNear != null
    ? qualityFogDistance(settings.fogNear, settings.fogFar, qualityFog) : null;
  scene.fog = fogRange ? new THREE.Fog(fogColor, fogRange.near, fogRange.far)
    : new THREE.FogExp2(fogColor, settings.fogDensity * qualityFog / .0042);
  sun.target.position.set(...settings.center);
  sun.position.set(...settings.keyPosition);
  const extent = settings.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.5, far: 240 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
  floor.visible = Boolean(settings.floor);
  floor.position.y = settings.floor ? -3.18 : -100;
}

// The indoor structure stays complete at skating height. The pre-collected
// roof groups become a cutaway only when a high air or inspection camera would
// otherwise cross the roof; the existing third-person camera rig is untouched.
function updateWorldVisibility() {
  if (!currentWorld?.cameraRoof.length) return;
  const settings = currentWorld.presentation;
  const threshold = settings.roofFadeHeight ?? settings.roofCutawayHeight;
  if (!Number.isFinite(threshold)) return;
  const hidden = currentWorld.roofCutaway
    ? camera.position.y > threshold - 1 : camera.position.y > threshold;
  if (currentWorld.roofCutaway === hidden) return;
  currentWorld.roofCutaway = hidden;
  for (const roof of currentWorld.cameraRoof) roof.visible = !hidden;
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
  gameShell.cameraIndex = ['follow','classic','fixed'].indexOf(followCamera.mode);
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
  input.clear();
  gameShell.syncPause(paused);
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
  const trickNode = document.querySelector('#trick-feedback');
  const trickLabel = skater.feedbackTime > 0 ? skater.feedback : skater.tricks.comboText();
  // Do not reset the pop animation on every render frame.
  if (trickNode.textContent !== trickLabel) {
    trickNode.textContent = trickLabel;
    trickNode.dataset.graffitiText = trickLabel; // exact same text for safe gradient overlay
    trickNode.dataset.tone = graffitiToneForTrick(trickLabel);
    trickNode.classList.remove('graffiti-pop');
    if (trickLabel) {
      void trickNode.offsetWidth;
      trickNode.classList.add('graffiti-pop');
    }
  }
  document.querySelector('#state-value').classList.toggle('air', !skater.grounded || Boolean(skater.grind));
}

function showError(error) {
  gameShell.loadError = true;
  gameShell.render();
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

async function ensureWorldEnvironment(world) {
  if (!world.presentation.sky || solarSky) return;
  skyLoading ||= loadSolarSky(renderer).then(sky => { solarSky = sky; return sky; });
  try { await skyLoading; }
  catch (error) {
    skyLoading = null;
    solarSky = { background: createCloudBackdrop(new THREE.Color('#687bb2')) };
    console.warn('HDRI unavailable; keeping fallback lighting.', error);
  }
}

function prepareWorldVisuals(world) {
  const anisotropy = graphicsPipeline.settings?.anisotropy || Math.min(8, renderer.capabilities.getMaxAnisotropy());
  world.park.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.userData.castShadow !== false;
    object.receiveShadow = true;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.map) material.map.anisotropy = anisotropy;
    }
  });
  world.park.updateMatrixWorld(true);
}

function refreshLocationUi() {
  document.querySelector('#poly-count').textContent = `${((manifest.visualTriangles || 0) / 1000).toFixed(1)}k triangles`;
  document.querySelector('.asset-meta > span').textContent = manifest.dimensions || '136 × 92 m · 3 AREAS';
  const center = currentWorld.presentation.center;
  Object.assign(views, manifest.views || {
    overview: { position: [155, 108, 165], target: center, caption: 'Three connected areas', index: '01' },
    bowl: { position: [44, 30, 22], target: center, caption: 'Connected transitions', index: '02' },
    street: { position: [31, 17, 37], target: center, caption: 'Find your next line', index: '03' },
    top: { position: [center[0], 160, center[2] + 0.01], target: center, caption: 'All skating areas', index: '—' },
  });
  const spotNav = document.querySelector('#spot-nav');
  spotNav.replaceChildren();
  for (const spot of manifest.spots || []) {
    const button = document.createElement('button');
    button.textContent = spot.label; button.dataset.spot = spot.id;
    button.title = `Start at ${spot.label}`;
    button.setAttribute('aria-pressed', String(spot.id === 'entrance' || spot.id === 'street'));
    button.onclick = () => goToSpot(spot.id);
    spotNav.append(button);
  }
  spotNav.hidden = !manifest.spots?.length;
  const locationTitle = { foundry: 'THE FOUNDRY', legacy: 'LEGACY PARK', rooftop: 'ROOFTOP',
    'tron-warehouse': 'TRON WAREHOUSE', 'urban-warehouse': 'URBAN WAREHOUSE' }[currentWorld.id] || manifest.name;
  document.title = `Chimp Hawk Underground — ${locationTitle}`;
  document.querySelector('.edition').textContent = locationTitle;
  gameShell.setLocation(currentWorld.id);
  transitionDebug?.dispose();
  transitionDebug = null;
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    transitionDebug = new TransitionDebugVisualizer(skater.transitions);
    scene.add(transitionDebug.group);
  }
  if (window.streetSkate) Object.assign(window.streetSkate, {
    currentLocation: currentWorld.id, manifest, park, collision, skater, transitionDebug,
    rampTuning: { factor: manifest.transitionScale, baked: true },
  });
}

function commitWorld(world, runtime) {
  const previousWorld = currentWorld;
  const previousRuntime = previousWorld && {
    surface: skater.surface, boardContact: skater.boardContact, contactRig: skater.contactRig,
    coreController: skater.coreController, railNetwork: skater.railNetwork,
    spawn: skater.spawn, spawnHeading: skater.spawnHeading, playableRegions: skater.playableRegions,
  };
  const previousPosition = skater.position.clone(), previousHeading = skater.heading, previousScore = skater.score;
  try {
    bindParkRuntime(skater, runtime);
    currentWorld = world;
    ({ park, collision, manifest } = world);
    scene.add(park);
    graphicsPipeline.setWorld(park);
    applyLighting();
    refreshLocationUi();
    input.clear(); tween = null; lastInputState = {};
    followCamera.snap(skater);
    updateHud();
  } catch (error) {
    world.park.removeFromParent();
    if (previousWorld && previousRuntime) {
      currentWorld = previousWorld;
      ({ park, collision, manifest } = previousWorld);
      bindParkRuntime(skater, previousRuntime);
      skater.reset(previousPosition, previousHeading); skater.score = previousScore;
      graphicsPipeline.setWorld(park);
      applyLighting(); refreshLocationUi(); followCamera.snap(skater);
    }
    throw error;
  }
  if (previousWorld && previousWorld !== world) disposeParkWorld(previousWorld, world);
}

async function selectLocation(id, { hero, finish } = {}) {
  if (!loaded || !skater) throw new Error('Wait for the game to finish loading.');
  if (switchingWorld) throw new Error('A location is already loading.');
  switchingWorld = true;
  const request = ++loadoutRequest;
  setPaused(true);
  let nextWorld;
  const progress = message => {
    gameShell.selectError = message;
    if (gameShell.phase === 'select') gameShell.render();
  };
  try {
    if (id !== currentWorld.id) {
      nextWorld = await createParkWorld(id, progress);
      prepareWorldVisuals(nextWorld);
      await ensureWorldEnvironment(nextWorld);
    }
    if (request !== loadoutRequest) { if (nextWorld) disposeParkWorld(nextWorld, currentWorld); return false; }
    const candidate = nextWorld || currentWorld;
    // Build collision BVHs and validate the entry point before replacing any live references.
    const runtime = nextWorld ? prepareParkRuntime(candidate, skater.board.contactRig) : null;
    if (hero?.url) {
      progress('LOADING YOUR CHARACTER…');
      await skater.setRiderModel(hero.url);
    }
    if (request !== loadoutRequest) { if (nextWorld) disposeParkWorld(nextWorld, currentWorld); return false; }
    if (runtime) commitWorld(candidate, runtime);
    if (finish != null) skater.board.setFinish(finish);
    followCamera.snap(skater);
    return { locationId: currentWorld.id, manifest };
  } catch (error) {
    if (nextWorld && nextWorld !== currentWorld) disposeParkWorld(nextWorld, currentWorld);
    throw new Error(`Could not load ${id === 'foundry' ? 'The Foundry' : 'the selected location'}. ${error.message || 'Choose another location and retry.'}`);
  } finally {
    switchingWorld = false;
  }
}

async function loadGame() {
  let initialWorld;
  try {
    initialWorld = await createParkWorld(legacyPark ? 'legacy' : 'rooftop', message => {
      document.querySelector('#load-progress').textContent = message;
    });
    prepareWorldVisuals(initialWorld);
    await ensureWorldEnvironment(initialWorld);
    document.querySelector('#load-progress').textContent = 'Loading rider and skateboard';
    skater = await new StreetSkater({ collision: initialWorld.collision, spawn: initialWorld.manifest.spawn,
      rails: initialWorld.manifest.rails, playableRegions: initialWorld.manifest.playableRegions }).load();
    scene.add(skater.root);
    // Actor-only bloom: visual contains the skateboard and currently selected GLB rider.
    // Keeping the group reference automatically tracks later character hot-swaps.
    graphicsPipeline.setGlowTarget(skater.visual);
    followCamera = new FollowCamera(camera);
    currentWorld = initialWorld;
    ({ park, collision, manifest } = initialWorld);
    scene.add(park, sun.target);
    graphicsPipeline.setWorld(park);
    skater.spawnHeading = Number(manifest.spawnHeading) || 0;
    skater.reset(skater.spawn, skater.spawnHeading);
    applyLighting();
    refreshLocationUi();
    setCameraMode('follow');
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
    document.querySelector('#loading').classList.add('done');
    loaded = true;
    setMode('skate');
    setPaused(true);
    gameShell.setReady();
    window.streetSkate = {
      ready: true, scene, renderer, camera, manifest, park, collision, skater,
      currentLocation: currentWorld.id, selectLocation,
      setMode, setExploreView, setPaused, setCameraMode, goToSpot, controlsVersion: 'thug-controls-v2',
      rampTuning: { factor: manifest.transitionScale, baked: true },
      captureState: () => captureGameplayState(skater),
      captureInput: () => ({ ...lastInputState }),
      toggleDebugOverlay: () => debugOverlay.toggle(),
      captureAuditTelemetry: () => captureAuditTelemetry({
        skater, followCamera, camera, input: lastInputState,
        paused, focused: document.hasFocus(),
      }),
      transitionDebug,
      captureTransitionDebug: () => transitionDebugSummary(skater.transitions),
    };
  } catch (error) {
    loaded = false;
    gameShell.ready = false;
    if (initialWorld) disposeParkWorld(initialWorld);
    transitionDebug?.dispose(); transitionDebug = null;
    currentWorld = null; park = null; collision = null; manifest = null;
    skater?.root.removeFromParent();
    showError(error);
  }
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
  graphicsPipeline.resize(innerWidth, innerHeight);
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
  const realDelta = clock.getDelta();
  const dt = Math.min(realDelta, 0.1);
  const elapsed = clock.elapsedTime;
  if (document.hidden) return;
  const wasPlaying = gameShell.active;
  gameShell.update(realDelta);

  // Never silently freeze on the last airborne frame when another overlay/window
  // takes focus. Make the suspension explicit and require a deliberate resume.
  if (loaded && mode === 'skate' && !document.hasFocus() && !paused) setPaused(true);
  if (loaded && mode === 'skate' && document.hasFocus() && !document.hidden) {
    const state = input.read();
    lastInputState = {
      ...state,
      directionTaps: [...(state.directionTaps || [])],
    };
    if (state.pausePressed && gameShell.active && wasPlaying) setPaused(true);
    if (state.cameraModePressed && gameShell.active) toggleCameraMode();
    if (state.cameraModeIndex != null && gameShell.active) setCameraMode(['follow','classic','fixed'][state.cameraModeIndex] || 'follow');
    if (!paused && gameShell.active) {
      const respawn = skater.respawnSerial;
      skater.update(dt, gameShell.inputGrace > 0 ? {} : state, elapsed);
      if (skater.respawnSerial !== respawn) followCamera.snap(skater);
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
  skateAudio.update(skater, loaded && mode === 'skate' && !paused && gameShell.active && document.hasFocus());
  updateWorldVisibility();
  graphicsPipeline.render();
});
