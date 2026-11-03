# Decisions — evolution cycle 2026-11-03

| ID | Decision / reason | Consequence |
|---|---|---|
| EV-D01 | Retain plain Three.js and the existing canonical custom physics. Confirmed defects have narrow fixes; replacing the stack would add risk without demonstrated benefit. | No dependencies or plugins installed. |
| EV-D02 | Use three real specialist subagents and one integration owner. Gameplay, graphics and experience files were explicitly assigned. | Independent investigations and cross-review; no overlapping unreviewed integration. |
| EV-D03 | Base the candidate on release `f62779d` in `codex/evolution-cycle-20261103`. Preserve unrelated dirty files/artifacts. | Local branch is the rollback checkpoint. No merge, deployment or Portals sync in this cycle. |
| EV-D04 | Separate in-round rider recovery from full round restart. | Earned score survives R/toolbar/marker recovery; unfinished combo is discarded; contact serial suppresses teleport impacts. |
| EV-D05 | Preserve visual settings and particle budgets while fixing render correctness. | Actual pixel ratio drives particles; immediate actor-mask invalidation; hardware/shader size clamps remain. |
| EV-D06 | Teach sanitized live bindings, including blocked-storage sessions, and keep fixed menu keys separate. | Rebound face-button positions are accurate; other remaps use explicit text rather than a false diagram position. |
| EV-D07 | Record full-game judgments as provisional and separate missing evidence from N/A. | Passing tests/build is not human sound/motion approval or proof of144 FPS. |
| EV-D08 | Consolidate current governance here and link historical audits rather than rewrite their evidence. | Current state is [PROJECT_STATE](PROJECT_STATE.md); earlier documents describe earlier milestones. |

[Architecture](ARCHITECTURE.md) · [Vision](GAME_VISION.md) · [Roadmap](DEVELOPMENT_ROADMAP.md).
