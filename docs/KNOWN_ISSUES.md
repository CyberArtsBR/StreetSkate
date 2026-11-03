# Known issues and evidence limits

Current cycle: 2026-11-03. [State](PROJECT_STATE.md) · [Prioritized work](DEVELOPMENT_ROADMAP.md). Fixed defects are recorded in [CHANGELOG](CHANGELOG.md), not counted as unresolved here.

| ID / priority | Confirmed gap | Evidence / next verification |
|---|---|---|
| KI-01 / P2 | Compact-rig grab hands can remain separated from the deck for some riders/extended poses. | [Rendered animation review](animation-visual-review-2026-11-02.md). Full normal/slow motion, each rider/stance/view and foot support must accompany further IK changes; do not equate endpoint math with perfect grip. |
| KI-02 / P2 | One shared voice palette and limited retained applause reduce character/audience variety. Human approval of the latest mix is still pending. | [Experience review](evolution-2026-11-03-experience.md), audio credits and prior owner feedback. The rejected cheer is absent; more sound variants require an appropriate recording/source and listening. |
| KI-03 / P2 | Sustained144 FPS at high resolution has not been demonstrated. Short browser samples are not controlled GPU benchmarks. | Current browser report plus prior 30-second [performance evidence](../artifacts/aaa-polish/reflective-pass/performance-comparison.json). Repeat identical routes with one active game, fixed viewport/DPR/preset, CPU/GPU timing and median results before selecting an optimization. |
| KI-04 / P2 | JPEG/PNG delivery optimization reduces transfer size, not ordinary decoded GPU texture memory. | [Asset delivery](asset-delivery-optimization.md). Measure target hardware memory before introducing KTX2/Basis, decoder costs and lossy comparisons. Preserve original assets and collision data. |
| KI-05 / P3 | Main JS entry still exceeds Vite's500 kB advisory (about1.30 MB minified /365 kB gzip in this candidate). | `artifacts/evolution-build.log`. Profile cold loading; consider lazy creator/diagnostic tooling only with loading/error fallback tests. No blanket bundler/engine rewrite. |
| KI-06 / P3 | Release identity stamping exists in CI scripts but is not part of Render's ordinary build command. | `render.yaml`, `package.json`, `tools/agent10-stamp-release.mjs`. Future release work should integrate a trustworthy commit stamp without presenting an uncommitted local tree as an immutable release. No deployment performed here. |
| KI-07 / verification | Current fixes have no fresh physical-controller, screen-reader or human sound-quality certification. | Automated keyboard/gamepad contracts and prior owner tests do not substitute for a new hardware/human review of this candidate. |
| KI-08 / verification | Ten prior park switches and current clean browser transitions do not establish a browser-heap/VRAM leak-free long session. | Extend same-route lifecycle capture with heap/resource baselines and actor/replay stress before making a memory guarantee. |

Hypothesis, not a confirmed defect: initially invisible bail/contact shaders may compile on first use despite scene warmup. Trace a cold first effect before expanding warmup. Hardware point-size limits and the shader's1–72 drawing-pixel clamp also bound particle-size invariance.

Portals multiplayer/economy/server security was not re-audited as part of this standalone main-runtime cycle. No certification or platform synchronization is implied.
