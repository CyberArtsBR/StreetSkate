// The default Heretic export omits metallicFactor on both costume materials.
// glTF therefore loads the entire painted costume/face as metal (factor 1).
// Correct only this known default asset; custom artist materials stay authored.
export function calibrateRiderMaterials(root, url) {
  if(!String(url).split('?')[0].endsWith('/assets/rider/The_Heretic.glb'))return;
  const touched=new Set();
  root.traverse(object=>{
    if(!object.isMesh)return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material||touched.has(material)||!material.isMeshStandardMaterial)continue;
      touched.add(material);
      material.metalness=Math.min(material.metalness,.22);
      material.roughness=Math.max(material.roughness,.58);
    }
  });
}
