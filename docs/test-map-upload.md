# Local map testing

Options → **UPLOAD TEST MAP · GLB** opens a local file picker and starts unlimited
practice with a random built-in rider and skateboard finish. The file stays in
the browser, is not uploaded to a server, and is not added to the map catalog.
The title screen is unchanged. Reloading restores the regular game.

The importer accepts static, self-contained GLB 2.0 files up to 80 MiB and 350,000
triangles. It rejects external resources, rigs, animations, invalid hierarchies,
invalid geometry and malformed gameplay metadata. Leaving Options cancels a
pending swap. A rejected upload preserves the current world.

Generic GLBs receive mesh collision, inferred rectangular boundaries and a
probed flat spawn. Accurate grind paths and special collision require authored
metadata. Maps without a clear four-wheel entrance are rejected.

## Prepared GLB format

One node contains `extras.streetSkateMap` as an object or JSON string:

```json
{
  "version": 1,
  "name": "My test park",
  "spawn": [0, 0.04, 0],
  "spawnHeading": 0,
  "rails": [{ "name": "Street rail", "radius": 0.055,
    "points": [[-2, 1, -2], [2, 1, -2]] }],
  "playableRegions": [{ "minX": -10, "maxX": 10, "minZ": -10, "maxZ": 10 }]
}
```

Coordinates are world-space metres in glTF's Y-up system. Rail points describe
tube centrelines. Include `coping` in bowl-lip names for transition capture.

`extras.streetSkateRole` may be `visual`, `collision`, `sky` or `decoration` and
inherits through parent nodes. Prepared maps require explicit collision meshes;
visual geometry does not become additional collision. Collision nodes accept
`surface: "solid"` or `"rideable"`, `transitionSkin: true`, `railId`, and
`cameraTransparent: true`. Sky nodes are excluded from collision and bounds.
Export collision meshes normally: the loader hides them at runtime.

## Skate Paradise test edition

The supplied park remains a separate artifact, outside shipped game assets and
the regular registry. Its entire geometry, collision, spawn, rails, boundaries
and sky dome are scaled to **150%** of the original size. It contains corrected
riding-surface winding, recalculated normals, continuous collision over the east
stairs and south straight/fan stair, 44 grind paths, perimeter blockers, a west
fence, embedded PBR surface maps and a seamless 4096 × 2048 sky.

The original GLB is preserved. The editable blend, build script, final GLB,
preview and validation reports are in `G:/Streetskate/artifacts/skate-paradise/`.

Validation: 32 targeted tests, production build, desktop file-picker upload and
invalid-file recovery. The final GLB passes 297 stair samples, 15,289 sloped
surface probes, 482 rail-segment contact/alignment samples and four boundary
sweeps. These are geometry/runtime checks, not an exhaustive playthrough of
every trick or approach. No phone testing was performed.

```sh
node tools/verify-test-map.mjs /path/to/skate_paradise_test.glb /path/to/report.json
```
