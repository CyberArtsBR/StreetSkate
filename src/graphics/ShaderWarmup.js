/** Prepare selected world/actor programs behind the loadout, before the clock
 * starts. Unsupported/lost contexts retain the normal renderer fallback. */
export async function warmScenePrograms(renderer,scene,camera) {
  if(!renderer?.compileAsync||renderer.getContext?.().isContextLost?.())return false;
  try{await renderer.compileAsync(scene,camera);return true;}
  catch{return false;}
}
