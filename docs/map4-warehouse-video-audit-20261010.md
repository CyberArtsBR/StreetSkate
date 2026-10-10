# Map 4 (Urban Warehouse) — Gameplay-video audit, 2026-10-10

Baseline: `53b96e97519eea0fee8dad091d1bebc31acc0015`. User video duration: 126.78 seconds. Scope: Map 4; the GLB and other maps are unchanged.

## Video observations (approximate timecodes)

- **00:04–00:20:** near wall-side quarters, the skater intersects a ramp end and the camera gets pushed into adjacent masonry.
- **00:32–00:44:** stair/bank and curved rail: severe occlusion gives first-person-looking gray geometry in the viewport.
- **00:48–01:16:** flat rails and horseshoe: nearby rails require actual eligibility checks, not just a centreline self-test.
- **01:28–01:44:** cornering near bank/wall produces sudden short camera arm and loss of playable view.
- **01:52–02:06:** rider remains blocked/stuck at loading door red column.

## Implemented

1. Evaluate every local grind path rather than only the globally nearest rail. Both strict and magnetic capture can now reject a perpendicular or unreachable coping and select the reachable handrail. Preserve the original nearest() semantics.
2. Support revised Blender stair landings/treads and riser/sidewall collision labels without changing the underlying visual meshes, coordinate spaces or skateboard physics.
3. Remove decorative, millimetre-thin Side_Edge_Band meshes from physical wheel contact; preserve the actual curved ramp skin, side cores and backs. This targets erroneous wheel snagging at joined quarter/bank ends.
4. Recover a third-person camera ray that starts just inside a nearby outward-facing solid face, without allowing inward wall rays to pass through. The correction is collision-only and preserves existing camera modes.
5. Add regression tests with overlapping copings, kinked rails, actual imported GLB rail approaches, stair geometry, ramp trims and camera rays.

## Remaining in-game verification required

The recording is not enough to prove every wall and ramp collision bug is resolved even though the identified rail candidate occlusion, decorative edge collision and near-origin camera exit cases now have regression coverage. Reproduce at the GLB world-space positions with debug logs of four-wheel support, body capsule contacts, rail candidate reasons, and camera ray intersections. Verify quarter-pipe backs, both stair run-ins, loading door corners and each visible rail in a browser before merging/deploying. Do not label these issues closed merely because source-level tests pass.
