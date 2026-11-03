/** Prepare selected world/actor programs behind the loadout, before the clock
 * starts. Unsupported/lost contexts retain the normal renderer fallback. */
export async function warmScenePrograms(renderer,scene,camera,{renderFirstFrame,isCurrent=()=>true}={}) {
  if(!renderer?.compileAsync||renderer.getContext?.().isContextLost?.())return false;
  try{
    await renderer.compileAsync(scene,camera);
    if(!isCurrent()||renderer.getContext?.().isContextLost?.())return false;
    // compileAsync prepares scene materials, but the real composers also use
    // offscreen output, bloom occluders and fullscreen shaders. Their first
    // actual draw must finish behind loadout, before the playable clock starts.
    renderFirstFrame?.();
    return true;
  }
  catch{return false;}
}
