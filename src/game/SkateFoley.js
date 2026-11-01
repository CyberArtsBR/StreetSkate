import { gameAssetUrl } from './AssetPaths.js';

// Original field recordings; license and provenance are in public/audio/foley/CREDITS.md.
export const SKATE_FOLEY_FILES = Object.freeze({
  pop:'/audio/foley/pop.wav', landing:'/audio/foley/land.wav',
  bail:'/audio/foley/bail.ogg', roll:'/audio/foley/roll.wav',
});

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
