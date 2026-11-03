import { gameAssetUrl } from './AssetPaths.js';

// Original field recordings; license and provenance are in public/audio/foley/CREDITS.md.
export const SKATE_FOLEY_FILES = Object.freeze({
  pop:'/audio/foley/pop.wav', landing:'/audio/foley/land.wav',
  bail:'/audio/foley/bail.ogg', roll:'/audio/foley/roll.wav',
});

// Alternate files are authored recordings, not copies presented as new takes.
export const SKATE_FOLEY_BANKS = Object.freeze({
  pop: ['/audio/foley/pop.wav','/audio/foley/pop-skate-1.wav','/audio/foley/pop-skate-2.wav'],
  landing: ['/audio/foley/land.wav','/audio/foley/land-skate-1.wav','/audio/foley/land-skate-2.wav'],
  catch: [1,2].map(n => `/audio/foley/catch-skate-${n}.wav`),
  landingConcrete: [1,2].map(n => `/audio/foley/landing-concrete-${n}.ogg`),
  landingMetal: [1,2].map(n => `/audio/foley/landing-metal-${n}.ogg`),
  cloth: [1,2].map(n => `/audio/foley/cloth-${n}.ogg`),
  scrapeMetal: ['/audio/foley/scrape-skate-metal.mp3'],
  scrapeConcrete: ['/audio/foley/scrape-skate-concrete.mp3'],
  ambienceWarehouse: ['/audio/foley/ambience-warehouse.wav'],
  ambienceParadise: ['/audio/foley/ambience-paradise.wav'],
  bail: ['/audio/foley/bail.ogg'],
  ...Object.fromEntries(['confirm','back','ready','go','roundOver','tenSeconds','finalFive'].map(kind => [`cue:${kind}`, [`/audio/foley/cue-${kind}.ogg`]])),
  voicePain: [1,2,3].map(n => `/audio/foley/voice-pain-${n}.mp3`),
  voiceEffort: ['/audio/foley/voice-effort-1.mp3'],
  crowdSubdued: ['/audio/foley/crowd-claps.ogg'],
  crowdMedium: ['/audio/foley/crowd-claps.ogg'],
  crowdExceptional: ['/audio/foley/crowd-claps.ogg'],
});

export function loadSkateFoleyBanks(context, onClip, { fetcher=globalThis.fetch, assetUrl=gameAssetUrl }={}) {
  if (!context?.decodeAudioData || typeof fetcher!=='function') return Promise.resolve([]);
  // Decode each URL once even when shared by two intensity banks.
  const urls = [...new Set(Object.values(SKATE_FOLEY_BANKS).flat())];
  return Promise.allSettled(urls.map(async path => {
    const response = await fetcher(assetUrl(path));
    if (!response.ok) throw new Error(`Audio unavailable: ${path}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    if (!buffer?.duration || !Number.isFinite(buffer.duration)) throw new Error(`Invalid audio: ${path}`);
    for (const [kind, paths] of Object.entries(SKATE_FOLEY_BANKS)) if (paths.includes(path)) onClip(kind, buffer);
    return path;
  }));
}

/** Decode each clip independently; one missing asset never suppresses another. */
export function loadSkateFoley(context, onClip, { fetcher=globalThis.fetch, assetUrl=gameAssetUrl }={}) {
  if (!context?.decodeAudioData || typeof fetcher!=='function') return Promise.resolve([]);
  return Promise.allSettled(Object.entries(SKATE_FOLEY_FILES).map(async ([kind,path])=>{
    const response=await fetcher(assetUrl(path));
    if(!response.ok)throw new Error(`Audio unavailable: ${kind}`);
    const encoded=await response.arrayBuffer();
    const decoded=await context.decodeAudioData(encoded);
    if(!decoded?.duration || !Number.isFinite(decoded.duration))throw new Error(`Invalid audio: ${kind}`);
    onClip(kind,decoded);
    return kind;
  }));
}

/** Mono overlap crossfade removes the hard seam from a field-recording loop. */
export function seamlessFoleyLoop(context, input) {
  if (!input?.getChannelData || !context?.createBuffer) return input;
  const length = input.length || input.getChannelData(0).length;
  const overlap = Math.min(Math.floor(input.sampleRate*.04), Math.floor(length/8));
  if (!overlap) return input;
  const output = context.createBuffer(1,length-overlap,input.sampleRate), data = output.getChannelData(0);
  const channels = input.numberOfChannels || 1;
  for (let channel=0;channel<channels;channel++) {
    const source=input.getChannelData(channel);
    for(let i=0;i<data.length;i++) {
      const t=i/overlap;
      data[i]+=(i<overlap?source[length-overlap+i]*(1-t)+source[i]*t:source[i])/channels;
    }
  }
  return output;
}
