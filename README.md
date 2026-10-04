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
| Push | W / Up | Left stick forward |
| Turn | A, D / Left, Right | Left stick sideways |
| Brake | S / Down / Shift | B / Circle or stick back |
| Charge ollie / pop | Hold / release Space | Hold / release A / Cross |
| Kickflip in air | Q | X / Square |
| Grab in air | E | Y / Triangle |
| Reset | R | Start / Options |

The toolbar switches between Skate and Explore. Aerial steering rotates the rider without redirecting momentum. Land aligned with the travel direction (or switch); unfinished flips and sideways landings cause a bail.

## Build and deploy

```sh
npm run build
```

Render Static Site: branch main, no root directory, build command
`npm ci && npm run build`, publish directory `dist`.
All four runtime GLBs are ordinary Git binary files in `public/assets`; no chunk reconstruction or external asset service is needed.

## Integration

- 120 Hz fixed movement step with acceleration, braking, gravity on slopes, chargeable ollies, short coyote time, and jump buffering.
- Ground, wall, and camera probes against the separate collision mesh.
- Left/right steering corrected for the local -Z forward convention.
- Real 38,544-triangle park and 4,852-triangle collision mesh.
- Single Unreal-style 61-bone character; procedural limb posing and foot placement because the supplied GLB has no animation clips.
- Skateboard resized to 1.05 m with deck-centered flip rotation.
- Follow camera tracks momentum during aerial spins.

The park follows the broad layout of the supplied reference without the building or grass.
It is an original low-poly reconstruction, not the photogrammetry scan.
Dimensions are estimated for gameplay. See `public/assets/park/park-manifest.json` for provenance, counts, and rail paths.

This is a movement prototype. Grinding, manuals, a full combo system, authored animation clips, and dedicated transition pumping are still future work. Gameplay tests and benchmarks were not run for this integration at the user's request.

`tools/build_park.py` is the editable Blender source. The ignored `references/` folder is research material, not application source; Tony Hawk source code is not shipped.
