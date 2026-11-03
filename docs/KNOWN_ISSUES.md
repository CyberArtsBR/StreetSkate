# Known issues and evidence limits

Current cycle: 2026-11-03. [State](PROJECT_STATE.md) · [Prioritized work](DEVELOPMENT_ROADMAP.md). Fixed defects are recorded in [CHANGELOG](CHANGELOG.md), not counted as unresolved here.

| ID / priority | Confirmed gap | Evidence / next verification |
|---|---|---|
| KI-01 / P2 | Exact palm/finger contact remains incomplete on compact rigs, especially Heretic/Japan. | [Cycle 2 reach and rendered review](evolution-cycle2-animation.md): 48 held-case mean wrist gap improves 32.7→17.3 cm, with four-rider sheets and representative normal/slow clips. This is improved reach, not full grip or swept-mesh certification. |
| KI-02 / P2 | One shared voice palette and limited retained applause reduce character/audience variety. Human approval of the refined mix is still pending. | [Cycle 2 audio refinement](evolution-cycle2-audio.md) corrects level/tail/transition/loop issues with recorded assets intact. Local A/B is at port 5187; no new people/takes or subjective listening approval are claimed. |
| KI-03 / P2 | Sustained144 FPS at high resolution has not been demonstrated. Short browser samples are not controlled GPU benchmarks. | Current browser report plus prior 30-second [performance evidence](../artifacts/aaa-polish/reflective-pass/performance-comparison.json). Repeat identical routes with one active game, fixed viewport/DPR/preset, CPU/GPU timing and median results before selecting an optimization. |
| KI-04 / P2 | JPEG/PNG delivery optimization reduces transfer size, not ordinary decoded GPU texture memory. | [Asset delivery](asset-delivery-optimization.md). Measure target hardware memory before introducing KTX2/Basis, decoder costs and lossy comparisons. Preserve original assets and collision data. |
| KI-05 / P3 | Main JS entry still exceeds Vite's 500 kB advisory (about 1.31 MB minified /367 kB gzip in cycle 2). | `artifacts/evolution-cycle2/build.log`. Profile cold loading; consider lazy creator/diagnostic tooling only with loading/error fallback tests. No blanket bundler/engine rewrite. |
| KI-06 / P3 | Release identity stamping exists in CI scripts but is not part of Render's ordinary build command. | `render.yaml`, `package.json`, `tools/agent10-stamp-release.mjs`. Future release work should integrate a trustworthy commit stamp without presenting an uncommitted local tree as an immutable release. No deployment performed here. |
| KI-07 / verification | Current fixes have no fresh physical-controller, screen-reader or human sound-quality certification. | Automated keyboard/gamepad contracts and prior owner tests do not substitute for a new hardware/human review of this candidate. |
| KI-08 / verification | Ten prior park switches and current clean browser transitions do not establish a browser-heap/VRAM leak-free long session. | Extend same-route lifecycle capture with heap/resource baselines and actor/replay stress before making a memory guarantee. |

The initial composed-frame/wheel-glow shader stall is fixed in the sampled cycle 2 route: four first-use program-log calls move before play. Rare later effect/preset/camera variants still lack complete cold-path coverage; do not claim all possible shader hitches are eliminated. Hardware point-size limits and the shader's 1–72 drawing-pixel clamp also bound particle-size invariance.

Portals multiplayer/economy/server security was not re-audited as part of this standalone main-runtime cycle. No certification or platform synchronization is implied.
