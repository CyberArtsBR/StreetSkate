import * as THREE from 'three';

const GHOST_COLOR = new THREE.Color('#68efff');
const GHOST_RIM_CODE = `
  // View-dependent cyan edge: genuine Fresnel-like ghost rim emitted in HDR.
  float streetGhostFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
  float streetGhostRim = pow(1.0 - clamp(streetGhostFacing, 0.0, 1.0), 2.15);
  totalEmissiveRadiance += vec3(0.28, 0.86, 1.0) * streetGhostRim * 2.65;
`;

/** Uploaded avatars receive a ghost presentation; shipped riders never do. */
export function isCustomRiderUpload(url) {
  return typeof url === 'string' && url.startsWith('blob:');
}

/**
 * Decorate materials, not geometry or bones. Existing skinned meshes, IK,
 * morph targets, proportions and imported texture maps remain unchanged.
 * The selective bloom pass already includes any positive emissive material.
 */
export function applyGhostRiderPresentation(root) {
  if (!root?.traverse) return 0;
  const owned = new Map();
  let affected = 0;
  const decorate = source => {
    if (!source) return source;
    if (owned.has(source)) return owned.get(source);
    const material = source.isMeshStandardMaterial
      ? source.clone()
      : new THREE.MeshStandardMaterial({
        name: source.name || 'Uploaded ghost rider',
        color: source.color?.clone?.() || new THREE.Color('#ffffff'),
        map: source.map || null,
        alphaMap: source.alphaMap || null,
        side: source.side ?? THREE.FrontSide,
      });
    material.name = (source.name || 'Custom') + ' / spectral glow';
    material.color.lerp(new THREE.Color('#e6fcff'), 0.42);
    material.emissive.copy(GHOST_COLOR);
    material.emissiveIntensity = 0.88;
    material.roughness = Math.max(0.48, material.roughness ?? 0.48);
    material.metalness = Math.min(0.12, material.metalness ?? 0);
    material.transparent = true;
    material.opacity = Math.min(0.80, Number.isFinite(source.opacity) ? source.opacity : 1);
    material.depthWrite = false;
    material.depthTest = true;
    material.blending = THREE.NormalBlending;
    const previousHook = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
      previousHook.call(material, shader);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' + GHOST_RIM_CODE,
      );
    };
    material.customProgramCacheKey = () => 'streetskate-custom-ghost-fresnel-v1';
    material.needsUpdate = true;
    owned.set(source, material);
    affected++;
    return material;
  };
  root.traverse(object => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(decorate) : decorate(object.material);
    object.userData.ghostRiderGlow = true;
    object.castShadow = false;
    object.receiveShadow = false;
  });
  // The imported materials have been replaced. Their texture maps remain
  // owned by the rider and will be released on normal UnrealRider disposal.
  for (const source of owned.keys()) source?.dispose?.();
  return affected;
}
