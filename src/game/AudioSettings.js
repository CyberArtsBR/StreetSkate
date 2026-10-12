export const AUDIO_DEFAULTS = Object.freeze({ music: 0.8, effects: 0.85 });

export function clampVolume(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export function readAudioVolume(channel) {
  const fallback = AUDIO_DEFAULTS[channel];
  try {
    const saved = localStorage.getItem(`streetskate.${channel}Volume`);
    return saved === null ? fallback : clampVolume(saved, fallback);
  } catch { return fallback; }
}

export function saveAudioVolume(channel, value) {
  const volume = clampVolume(value);
  try { localStorage.setItem(`streetskate.${channel}Volume`, String(volume)); } catch {}
  return volume;
}
