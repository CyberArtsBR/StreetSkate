// Material tags are authored on collision contacts/rails. Never infer sound from
// a mesh's arbitrary name: imported names are not a reliable material contract.
const profile = values => Object.freeze(values);
export const SURFACE_AUDIO = Object.freeze({
  neutral: profile({ roll: 1, texture: 1, rollPitch: 1, scrapePitch: 1, resonance: 1.65 }),
  concrete: profile({ roll: 1, texture: 1.12, rollPitch: 1, scrapePitch: .78, resonance: .8 }),
  wood: profile({ roll: .9, texture: .6, rollPitch: .72, scrapePitch: .62, resonance: .65 }),
  metal: profile({ roll: .72, texture: .75, rollPitch: 1.32, scrapePitch: 1.16, resonance: 2.1 }),
  rubber: profile({ roll: .62, texture: .32, rollPitch: .55, scrapePitch: .48, resonance: .5 }),
});

export function validatedSurfaceTag(value) {
  return typeof value === 'string' && Object.hasOwn(SURFACE_AUDIO, value) ? value : 'neutral';
}

export function surfaceAudioFor(player) {
  const rail = player?.grind?.rail;
  const tag = rail ? rail.audioSurfaceTag ?? rail.surfaceType ?? rail.userData?.audioSurfaceTag
    : player?.audioSurfaceTag ?? player?.contact?.audioSurfaceTag;
  return SURFACE_AUDIO[validatedSurfaceTag(tag)];
}
