import * as THREE from 'three';

/** Find flat support close to the actual fall, not the original start marker. */
export function safeRespawnPoint(surface, origin, fallback) {
  const candidates = [
    [0,0], [2,0],[-2,0],[0,2],[0,-2],
    [4,0],[-4,0],[0,4],[0,-4], [5,5],[-5,5],[5,-5],[-5,-5],
    [8,0],[-8,0],[0,8],[0,-8], [12,0],[-12,0],[0,12],[0,-12],
  ];
  for (const [x,z] of candidates) {
    const probe = new THREE.Vector3(origin.x+x, origin.y+3.5, origin.z+z);
    const hit = surface.ground(probe, 8, 15);
    if (!hit || hit.normal.y < 0.94 || !Number.isFinite(hit.point.y)) continue;
    return hit.point.clone().add(new THREE.Vector3(0,0.10,0));
  }
  return fallback.clone();
}
