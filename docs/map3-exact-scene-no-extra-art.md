# Map 3 — use only the desired Skatewarehouse scene

## Evidence from screenshot
The 12 neon graffiti word decals were added by `src/park/GrandWarehouseGraffiti.js` at runtime, not authored in the uploaded `Skatewarehouse.glb`. They have been disabled and the now-unused generator is removed.

The concrete stair bank with a downrail at the player's right matches the exported `01_STREET_DISTRICT / Nine stair` assembly in the GLB. While present in the exported bytes, the user explicitly wants it excluded from the playable scene.

## Scope
- Preserve exact `Skatewarehouse.glb` bytes, SHA-256 `fbc46ba3e414bb4380366c749fa0aa526e06328ae3bff702e956b43c37f0902c`, as `public/assets/warehouse/granwarehouse.glb`.
- **Map 3 only:** mark all 35 source meshes for the `Nine stair` assembly (stair treads, access bank, east/west hubba, kinked downrail, supports) to be omitted from both batched visuals and the imported physics/rail builder.
- **Map 3 only:** disable runtime graffiti and update the location subtitle/stamp accordingly.
- Keep all other authored meshes, textures and exact transforms; preserve bowl, halfpipes, quarter pipes, ground, and remaining metal rails.
- Keep Map 1, **Map 2**, original GLB, camera, menus, and core skate physics untouched.

Visual-source collision must agree: removing the artwork but retaining invisible collider or grind paths would create a more serious bug. This patch explicitly checks all three.

Test with selected Map 3: no graffiti words, no right-side Nine stair/bank/rail block, playable remaining obstacles, safe spawn and remaining grind paths.
