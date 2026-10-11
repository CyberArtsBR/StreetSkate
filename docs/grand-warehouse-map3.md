# Map 3: GRAND WAREHOUSE — 2026-10-11

Source provided by user: granwarehouse.glb (15,961,164 bytes, SHA-256 f0f47613e0aad90fd1ba7903ec218d46fea7bdc9433d437f3a1b26a72d41d886).
Prepared updated asset: grand-warehouse-graffiti.glb (17,802,984 bytes, SHA-256 906a8ab0a497b6b374a6e5ea343408c749a448469078ee5c0c437eb8e0c5a477).

- Independent Map 3 location with the unchanged SkyLine Rooftop Map 1 and unchanged Urban Warehouse Map 2.
- 150 x 110 m original footprint; 1,414 original meshes preserved, plus 12 lightweight unlit-looking alpha-blended paint decals (the decals are visual-only).
- 4 unique hand-drawn graffiti textures embedded in the GLB; placed on all four brick walls, above typical quarter-pipe lip height.
- Blender export joined rail tubes with wooden ledge/quarter shell geometry; Grand mode reads the material-specific GLTF child primitives, extracts actual tubes, leaves wood as solid/rideable as appropriate.
- ImportedWarehouseRepairs Grand mode keeps artist-authored transforms, original floor material, and original ramp arrangement. Existing Map 2 follows the exact old repair path.
- Confirm all original entrance and respawn markers, all metal rail paths, bowled/swept transitions and camera clearances before release.

**Binary upload gate**: GitHub connector cannot send binary files from the sandbox. The branch intentionally references an uncommitted `public/assets/warehouse/grand-warehouse.glb`. Do not merge the PR until it is uploaded as the EXACT file named `grand-warehouse.glb`, checksum verified, CI green, and the browser Map 3 smoke test succeeds.

Download from ChatGPT and upload to `public/assets/warehouse/grand-warehouse.glb` on branch `feat/map3-grand-warehouse-20261011`. Do NOT overwrite `urban-warehouse.glb`; do NOT rename or change its GLB.
