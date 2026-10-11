import * as THREE from 'three';
import { ParkCollision } from '../game/ParkCollision.js';
import { SkateboardContactRig } from '../game/SkateboardContactRig.js';

// Grand's artist-authored obstacle layout differs from Map 2. Preserve every
// ramp transform, but relocate any obsolete respawn marker to the nearest safe,
// flat, unoccupied four-wheel contact on the original plaza.
export function ensureGrandWarehouseSpawns(world) {
  const surface = new ParkCollision(world.collision);
  const contact = new SkateboardContactRig(surface);
  const manifest = world.manifest;
  const reserved = [];
  const regions = manifest.playableRegions;
  const offsets = [[0,0]];
  for (const distance of [2,4,6,8,10,12,16,20,26]) {
    for (let i=0;i<16;i++) {
      const a = i * Math.PI * 2 / 16;
      offsets.push([distance*Math.cos(a),distance*Math.sin(a)]);
    }
  }
  const inBounds = p => regions.some(r=>
    p.x>r.minX+2 && p.x<r.maxX-2 && p.z>r.minZ+2 && p.z<r.maxZ-2);
  const candidateAt = (point, heading) => {
    if (!inBounds(point)) return null;
    if (reserved.some(p=>p.distanceToSquared(point)<5)) return null;
    const support=contact.snapToGround(point,heading,.5,1);
    if (!support.supported || support.count!==4 || support.normal.y<.985) return null;
    const adjusted=support.position;
    if (!adjusted || Math.abs(adjusted.y-.15)>.38) return null;
    const sweep=surface.move(adjusted,adjusted,new THREE.Vector3(),{grounded:false});
    if (sweep.contacts.length || sweep.position.distanceToSquared(adjusted)>.001) return null;
    return adjusted.clone();
  };
  const place = (coords, heading, label) => {
    const source = new THREE.Vector3(...coords);
    for (const [dx,dz] of offsets) {
      const candidate=new THREE.Vector3(source.x+dx,.15,source.z+dz);
      const safe=candidateAt(candidate,heading);
      if (!safe) continue;
      reserved.push(safe);
      return safe.toArray();
    }
    throw new Error(`Grand Warehouse has no clear four-wheel spawn near ${label}`);
  };
  manifest.spawn=place(manifest.spawn,manifest.spawnHeading||0,'entrance');
  manifest.spots=manifest.spots.map(spot=>({
    ...spot,position:place(spot.position,spot.heading||0,spot.id),
  }));
  manifest.statistics={...manifest.statistics,grandValidatedSpawns:manifest.spots.length+1};
}
