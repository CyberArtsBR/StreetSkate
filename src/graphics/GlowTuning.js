import { GRAPHICS_PRESETS } from './GraphicsSettings.js';

export const GLOW_TUNING_KEY = 'streetskate.glowTuning.v1';
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
  return { ...defaults, ...normalizeGlowOverrides(settings.glowTuning) };
}

export function stepGlowValue(control, current, direction) {
  const rounded = Math.round(current * 100) / 100;
  return Math.max(control.min, Math.min(control.max,
    Math.round((rounded + Math.sign(direction) * control.step) * 100) / 100));
}
