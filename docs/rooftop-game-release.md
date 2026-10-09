# Rooftop game-flow recovery — 2026-10-09

This release reconstructs the interrupted 2026-10-08 Codex work against current main (the branch with the 22 advanced tricks). It does **not** overwrite the newer trick catalog.

## Included in source
- Controller-friendly 16:9 title, How To Play tutorial, pause menu, Options and end-of-run results.
- Timed 90-second runs; Practice without a clock.
- Music shuffle player with Select/View/Backspace skip. MP3 files are automatically discovered at build by `tools/materialize-music.mjs`.
- Follow default; Classic, Fixed, First Person via 1–4 or C/R3, with camera clearance-side control and reduced vert landing reframe.
- Stronger grind imbalance and neutral-input bail.
- Nearby level flat safe respawn, animated fall, three translucent flashes.
- Removed ground-painted area labels, added skyline rooftop presentation, perimeter rails and warm sunset sky dome.
- Development toolbar and QA overlay hidden in normal interface.

## Assets unavailable in recovered source
The seven original MP3 binaries and user's exact starting-screen artwork are **not stored in current main nor the accessible project archive**. They belonged to the interrupted local Codex workspace. The title is recreated as accessible typography and live game background; no image is falsely claimed to have been restored. Add the MP3s under `public/audio/music` and run `npm run build` to auto-generate a shuffled playlist.

## Verification
Static JavaScript parsing checked for staged .js modules. Full production build, rendered visual validation, gameplay QA, FPS tests and controller device validation were not run in this environment. Check Render's new deploy before treating the version as live.
