// Cosmetic response only: retain authored colors, textures, UVs, names and
// geometry. Some imported timber/rail materials use zero roughness, producing
// mirror highlights on wood and unstable bright pixels on narrow coping.
export function refineWarehouseMaterials(root){
  const touched=new Set();
  root.traverse(object=>{
    if(!object.isMesh)return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material?.isMeshStandardMaterial||touched.has(material))continue;
      touched.add(material);
      if(/^Foundry_(Plywood(?:_Edges)?|Dark_Timber)(?:\.\d+)?$/.test(material.name)){
        material.metalness=0;
        material.roughness=Math.max(material.roughness,.58);
      }else if(/^Foundry_(Grind_Rail|Stainless_Coping)(?:\.\d+)?$/.test(material.name)){
        material.roughness=Math.max(material.roughness,.16);
      }else if(/^Foundry_Concrete(?:\.\d+)?$/.test(material.name)){
        material.metalness=0;
        material.roughness=Math.max(material.roughness,.82);
      }
    }
  });
}
