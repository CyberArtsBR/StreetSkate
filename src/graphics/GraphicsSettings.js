// Graphics quality policy is renderer-independent so it can be tested without WebGL.
export const GRAPHICS_PRESET_ORDER = Object.freeze(['performance', 'balanced', 'high', 'ultra', 'cinematic']);
const PRESETS = {
  performance: { label:'Performance', pixelRatioCap:1, anisotropy:2, environmentQuality:'Low', environmentIntensity:.74, environmentBlur:.11, metalReflectionStrength:1.8, exposureMultiplier:.98, fogDensity:.0038, vfxScale:.65, bloomScale:.40, bloomStrength:0, ssr:false, ssrScale:0, sharpen:.12, msaaSamples:0 },
  balanced: { label:'Balanced', pixelRatioCap:1.3, anisotropy:4, environmentQuality:'Medium', environmentIntensity:.79, environmentBlur:.075, metalReflectionStrength:2.0, exposureMultiplier:.99, fogDensity:.0040, vfxScale:.82, bloomScale:.65, bloomStrength:.18, ssr:false, ssrScale:0, sharpen:.19, msaaSamples:2 },
  high: { label:'High', pixelRatioCap:1.6, anisotropy:8, environmentQuality:'High', environmentIntensity:.84, environmentBlur:.05, metalReflectionStrength:2.4, exposureMultiplier:1, fogDensity:.0042, vfxScale:1, bloomScale:.65, bloomStrength:.25, ssr:false, ssrScale:0, sharpen:.23, msaaSamples:2 },
  ultra: { label:'Ultra', pixelRatioCap:2, anisotropy:16, environmentQuality:'Ultra', environmentIntensity:.88, environmentBlur:.035, metalReflectionStrength:2.8, exposureMultiplier:1.02, fogDensity:.0043, vfxScale:1.15, bloomScale:.8, bloomStrength:.32, ssr:true, ssrScale:.5, sharpen:.26, msaaSamples:2 },
  cinematic: { label:'Cinematic', pixelRatioCap:2.25, anisotropy:16, environmentQuality:'Cinematic', environmentIntensity:1.15, environmentBlur:.025, metalReflectionStrength:3.4, exposureMultiplier:1, fogDensity:.0032, vfxScale:1.25, bloomScale:.8, bloomStrength:.38, ssr:true, ssrScale:.75, sharpen:.3, msaaSamples:2 },
};
// The 1024 shadow-map size is intentional on ALL tiers: no hidden 2K/4K override.
export const GRAPHICS_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(PRESETS).map(([key,value])=>[key,Object.freeze({ ...value, shadowResolution:1024 })])
));
export const DEFAULT_GRAPHICS_PRESET = 'high';
export const GRAPHICS_STORAGE_KEY = 'streetskate.graphicsPreset.v1';

export function normalizedGraphicsPreset(value) {
  return Object.hasOwn(GRAPHICS_PRESETS, value) ? value : DEFAULT_GRAPHICS_PRESET;
}
export function resolveGraphicsSettings(value, capabilities = {}) {
  const name = normalizedGraphicsPreset(value);
  const preset = GRAPHICS_PRESETS[name];
  const devicePixelRatio = Math.max(1, Number(capabilities.devicePixelRatio) || 1);
  const gpuAnisotropy = Math.max(1, Number(capabilities.maxAnisotropy) || 1);
  const maxSamples = Math.max(0, Number(capabilities.maxSamples) || 0);
  return {
    ...preset, name,
    pixelRatio: Math.min(devicePixelRatio, preset.pixelRatioCap),
    anisotropy: Math.min(gpuAnisotropy, preset.anisotropy),
    msaaSamples: Math.min(preset.msaaSamples, maxSamples),
  };
}
export function loadGraphicsPreset(storage) {
  try { return normalizedGraphicsPreset(storage?.getItem(GRAPHICS_STORAGE_KEY)); }
  catch { return DEFAULT_GRAPHICS_PRESET; }
}
export function storeGraphicsPreset(storage, preset) {
  try { storage?.setItem(GRAPHICS_STORAGE_KEY, normalizedGraphicsPreset(preset)); }
  catch { /* Privacy mode and disabled storage must not interrupt gameplay. */ }
}
export function qualityFogDistance(near, far, fogDensity) {
  // Linear fog is scaled around its own map-specific range, not replaced with
  // the exponential fog definition used by the Legacy and Rooftop maps.
  const scale = fogDensity / GRAPHICS_PRESETS.high.fogDensity;
  return { near, far: near + (far - near) / scale };
}
