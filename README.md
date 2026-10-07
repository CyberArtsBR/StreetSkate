# StreetSkate

Playable Three.js street skateboarding prototype, using the reconstructed Insanity-inspired park, the user-supplied TheanchoURi character, and the skateboard from CyberArtsBR/Skate.

## Run locally

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173/ and click inside the game to give it focus.
Simulation pauses when the page loses focus. Explore mode pauses the rider.

## Controls

| Action | Keyboard | Standard gamepad |
| --- | --- | --- |
| Push | W | Left stick / D-pad forward |
| Turn / air spin | A, D | Left stick / D-pad sideways |
| Brake | S / Shift | Left stick / D-pad back |
| Charge ollie / pop | Hold / release Space | Hold / release A / Cross |
| Directional flip | Left arrow + WASD direction | X / Square + direction |
| Directional grab | Right arrow + WASD direction | B / Circle + direction |
| Grind / wall ride | Hold Up arrow near a rail / wall | Hold Y / Triangle |
| Additional air spin | Q / E | LB / RB or L1 / R1 |
| Exit vert after apex | Left Ctrl | LT / L2 |
| Switch stance | Right Ctrl | RT / R2 |
| Manual / nose manual | W then S / S then W | Forward then back / back then forward |
| Camera | Drag with left mouse button | Right stick |
| Pause | Esc | Start / Options |
| Reset | R | — |

The toolbar switches between Skate and Explore. Aerial steering rotates the rider without redirecting momentum. Land aligned with the travel direction (or switch); unfinished flips and sideways landings cause a bail.

Bowl and quarter-pipe lips launch into a locked vertical air. Speed controls airtime and height; Left Ctrl / LT / L2 after the apex deliberately releases the return line and carries the rider over the coping. Holding forward alone keeps the return line. Ordinary banks and flat-ground ollies keep their normal momentum.

Hold grind while descending close to a rail to catch it; release an ollie to jump off. A short cooldown prevents immediate recapture. Direction + flip, grab, or grind selects the trick. Quick pairs of trick buttons during a manual select flatland variations.

## Build and deploy

```sh
npm run build
```

Render Static Site: branch main, no root directory, build command
`npm ci && npm run build`, publish directory `dist`.
All four runtime GLBs are ordinary Git binary files in `public/assets`; no chunk reconstruction or external asset service is needed.

`build` only compiles the production bundle. Tests and physics verification remain available through `npm run validate`; they are separate from deployment.

The 2026-10-07 production integration merges `refactor/core-skate-controller-v1` through `fba85cc2c622aeb3d50c0a88477a4364667c1777`. It includes the canonical input, transition, collision, takeoff, and landing services coordinated by `CoreSkateController`, with `StableBoardContact.land()` using `LandingResult` and `LandingExecutor`. The original park loader is preserved. This merge/deploy was requested without any new test or benchmark runs.

## Integration

- 120 Hz fixed movement step with acceleration, braking, gravity on slopes, chargeable ollies, short coyote time, and jump buffering.
- Board-contact ground/landing sweeps plus subdivided capsule movement for the rider and grounded skateboard. Obstacle contacts slide along barriers without rolling back the entire move.
- Solid ramp sides/backs, rails and supports, guards, lamp posts, bench legs, and curbs in the separate collision mesh. The active grind rail is excluded from body blocking while grinding.
- Left/right steering corrected for the local -Z forward convention.
- Real 38,544-triangle park and 8,296-triangle collision mesh.
- Quarter-pipe transitions and heights enlarged 30% in the asset generator, before batching, with matching visual/collision geometry and coping paths. Bowl dimensions are unchanged.
- Single Unreal-style 61-bone character; procedural limb posing and foot placement because the supplied GLB has no animation clips.
- Skateboard resized to 1.05 m with deck-centered flip rotation.
- Follow camera tracks momentum during aerial spins.
- Vertical transition launches use the authored coping paths, with a locked return line and intentional forward exits after the apex.
- Arm poses respect the authored elbow bend planes, spread forearm/wrist roll, and distribute the gaze across the torso, neck, and head.

The park follows the broad layout of the supplied reference without the building or grass.
It is an original low-poly reconstruction, not the photogrammetry scan.
Dimensions are estimated for gameplay. See `public/assets/park/park-manifest.json` for provenance, counts, and rail paths.

This is a movement prototype with directional tricks, rail grinds, manuals, flatland variations, wall rides/plants, and combo scoring. Authored animation clips and dedicated transition pumping remain future work. Gameplay tests and benchmarks were not run for this integration at the user's request.

`tools/build_park.py` is the editable Blender source. Regenerate the embedded-texture GLBs and manifest without rendering a preview:

```sh
blender --background --factory-startup --python tools/build_park.py -- --assets-only
```

The ignored `references/` folder is research material, not application source; Tony Hawk source code is not shipped.
