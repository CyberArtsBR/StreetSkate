# Local master upgrade — working checkpoint

Branch: `codex/master-local-upgrade`. Baseline: `29c3809` (remote main verified 29 October 2026). No publish, push, merge or hosted Portals sync authorized for this upgrade.

## Ownership
- Lead: shared GameShell/game-main integration, camera, rendering, assets, art, final browser QA.
- Gameplay agent: scoring/versioned records, round policy, practice drills, physics fixtures.
- Interface agent: CSS/type, glyph loading, lessons, saved preferences/remapping and settings panel.
- Presentation agent: animation, sound, physical impact effects, audio preferences.

## Checklist
- [x] Read complete prompt/audit and relevant Game Studio skills; verify branch/base and preserve unrelated changes.
- [ ] Phase 1: warnings/type/glyphs/tutorial lessons and selected-trick practice.
- [ ] Phase 2: saved settings, remapping, camera, audio, liquid and measured performance.
- [ ] Phase 3: READY/GO, zero-clock resolution, results, scoring/PB, fixtures.
- [ ] Phase 4: motion/contact/audio/VFX.
- [ ] Phase 5: art bible, park readability, reproducible assets, measured loading/rendering.
- [ ] Integration tests/build, browser round/menu/tutorial/parks/animation, performance comparison.
- [ ] Persistent local server verified, reviewable local commits, final test notes.

Preserved baseline: 120 Hz simulation; 18 m/s cruise; gravity21; pop5.6–7.9; charge.24; rail attachment/acceleration; glow; grounded-impact liquid; no BANKED and no new modes.

Pre-existing edits/artifacts are retained. This document and specialist status notes are the durable continuation checkpoint.

## Checkpoint — 1 November, local test candidate
- Implemented: warning labels/readability, decoded graffiti fallback, four advanced lesson clips, saved controls/accessibility/camera/audio/liquid/FPS options, creator page, READY/GO, bounded overtime, versioned score records and results, measured fixtures, tested coping/deck transfer correction, visual animation and ground-impact sound/puddle updates.
- Validation: 934/934 tests and board15/vert20/pump15 passed; production build succeeded; browser smoke opened settings and started a round with no page errors; original eight lessons passed. Four new clips generated; complete advanced-video/browser/controller acceptance remains.
- Remaining before considering the full prompt complete: full real-time round/overtime/bail/replay QA; physical controller and listening/animation review; reliable per-surface contact tagging; art-bible and asset optimization; controlled after-change GPU/loading measurements and multi-resolution screenshots. Baseline measured submissions/s 143.5 Warehouse,137.8 ORBIT,130.7 Paradise at 1080p on RTX5060Ti with glow; these are not display FPS or GPU time. Lossless asset experiment was not applied.
- Current local build is suitable for exploratory testing, not yet a release approval. Main and Portals unchanged. Re-run full validation after any additional edits.
