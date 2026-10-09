import * as THREE from 'three';

// Only the rooftop support remains. The photographic HDRI supplies the horizon.
export function createRooftopCity() {
  const base = new THREE.Group(); base.name = 'Rooftop base';
  const structure = new THREE.MeshStandardMaterial({color:'#77777b',roughness:.85});
  const slab = new THREE.Mesh(new THREE.BoxGeometry(113,.65,153),structure);
  // Below the deepest bowl: never put a support surface across its opening.
  slab.position.set(0,-4.55,-8);slab.userData.castShadow=false;base.add(slab);
  for(const x of [-56,56]) {
    const fascia=new THREE.Mesh(new THREE.BoxGeometry(1,4.2,153),structure);
    fascia.position.set(x,-2.1,-8);base.add(fascia);
  }
  for(const z of [-84,68]) {
    const fascia=new THREE.Mesh(new THREE.BoxGeometry(113,4.2,1),structure);
    fascia.position.set(0,-2.1,z);base.add(fascia);
  }
  return base;
}
