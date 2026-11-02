import { GRAPHICS_PRESETS, GRAPHICS_STORAGE_KEY } from './GraphicsSettings.js';

export const GLOW_TUNING_KEY = 'streetskate.glowTuning.v1';
export const GLOW_DEFAULTS_KEY = 'streetskate.glowDefaults.v2';
export const HIGH_REFRESH_GLOW_DEFAULTS = Object.freeze({emissive:1.2,bloom:.49,glow:.5,radius:.26});
export const GLOW_CONTROLS = Object.freeze([
  Object.freeze({ key:'emissive', label:'World emissive', hint:'Brightness of glowing park materials', min:0, max:3, step:.05, suffix:'×' }),
  Object.freeze({ key:'bloom', label:'Bloom strength', hint:'Intensity of the light halo', min:0, max:2.5, step:.05, suffix:'' }),
  Object.freeze({ key:'glow', label:'Glow contribution', hint:'How much halo is added to the image', min:0, max:1.5, step:.05, suffix:'' }),
  Object.freeze({ key:'radius', label:'Glow radius / glare', hint:'How far the halo spreads', min:0, max:1, step:.05, suffix:'' }),
]);

export function normalizeGlowOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const control of GLOW_CONTROLS) {
    const n = value[control.key];
    if (typeof n === 'number' && Number.isFinite(n))
      result[control.key] = Math.max(control.min, Math.min(control.max, n));
  }
  return result;
}

export function normalizeGlowPresets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const name of Object.keys(GRAPHICS_PRESETS)) {
    const overrides = normalizeGlowOverrides(value[name]);
    if (Object.keys(overrides).length) result[name] = overrides;
  }
  return result;
}

export function readGlowPresets(storage) {
  try { return normalizeGlowPresets(JSON.parse(storage?.getItem(GLOW_TUNING_KEY) || '{}')); }
  catch { return {}; }
}

export function saveGlowPresets(value, storage) {
  const presets = normalizeGlowPresets(value);
  try { storage?.setItem(GLOW_TUNING_KEY, JSON.stringify(presets)); } catch { /* Storage is optional. */ }
  return presets;
}

// Distinguish existing players from first launches before the game writes its
// graphics preset. Existing players keep their old preset baseline and choices.
export function initializeGlowDefaults(storage) {
  try {
    if (!storage) return false;
    const saved = storage.getItem(GLOW_DEFAULTS_KEY);
    if (saved === 'legacy' || saved === 'current') return saved === 'legacy';
    const existing = [GRAPHICS_STORAGE_KEY, 'streetskate.graphicsPreset.v1', GLOW_TUNING_KEY,
      'streetskate.bloomEnabled', 'streetskate.smoothEdges'].some(key => storage.getItem(key) != null);
    try { storage.setItem(GLOW_DEFAULTS_KEY, existing ? 'legacy' : 'current'); } catch { /* Read-only storage can still preserve the old defaults. */ }
    return existing;
  } catch { return false; }
}

export function useCurrentGlowDefaults(storage) {
  try { storage?.setItem(GLOW_DEFAULTS_KEY, 'current'); } catch { /* Storage is optional. */ }
}

// Values are the actual renderer controls, even while Neon Glow is switched off.
export function resolveGlowTuning(settings, environmentBloom = false) {
  const cinematic = settings.name === 'cinematic';
  const ultra = settings.name === 'ultra';
  const scale = cinematic ? 2.1 : ultra ? 1.7 : 1.5;
  const defaults = {
    emissive:settings.vfxScale * (settings.emissiveScale ?? 1),
    bloom:(GRAPHICS_PRESETS[settings.name]?.bloomStrength ?? settings.bloomStrength ?? 0) * settings.vfxScale * scale,
    glow:cinematic ? .75 : environmentBloom ? .6 : .38,
    radius:cinematic ? .38 : ultra ? .33 : .26,
  };
  if (settings.name === 'high-refresh' && !settings.legacyGlowDefaults)
    Object.assign(defaults, HIGH_REFRESH_GLOW_DEFAULTS);
  return { ...defaults, ...normalizeGlowOverrides(settings.glowTuning) };
}

export function stepGlowValue(control, current, direction) {
  const rounded = Math.round(current * 100) / 100;
  return Math.max(control.min, Math.min(control.max,
    Math.round((rounded + Math.sign(direction) * control.step) * 100) / 100));
}
