# Changelog

## Unreleased — Game Evolution local cycle, 2026-11-03

Base: `f62779d`. Integration: `codex/evolution-cycle-20261103`. [Verification](PROJECT_STATE.md).

- R and toolbar respawn preserve already-earned round score, stance and travelled distance while discarding unfinished tricks. Restart Session still starts a new round.
- Practice-marker/named-spot recovery uses the same contact-safe transaction, preventing teleport landings and retaining canonical stance.
- Rider swap/respawn affects only rider materials; the skateboard stays opaque.
- Switching Manual/Nose Manual retains accumulated difficulty, drift and flatland cooldown instead of refreshing initial assistance.
- Selective bloom refreshes immediately after same-count rider swaps; ordinary faces/clothes stay out of the glow mask.
- Dust/spark viewport sizing uses actual rendering resolution, including sub-native and high-DPI ratios.
- ORBIT no longer displays an incomplete grid of785decorative short-joint bars. Source GLB, real ramp seams/grilles, collision and14 rail paths are preserved.
- Settings Tab/reverse-Tab navigation skips hidden/inert capture controls and reaches the footer.
- Readable tutorial pages use current controls; Flip School controller diagrams follow physical face-button remaps, with explicit fallback text for other controls.
- Tutorial text explains existing overtime. HUD/menu sound toggles share the runtime state.
- Browser title uses the game identity rather than a legacy park name; the viewport's accessible description points to current tutorial controls instead of hardcoded defaults.
- Added behavioral/actual-asset regressions, production browser QA, technical profile, architecture, scorecard and prioritized roadmap. No new assets/dependencies/modes.

Earlier released changes and evidence remain in [AAA polish status](aaa-polish-status.md), [round2 status](audit-round2-status.md) and the Git history. This local cycle has not been merged, deployed or synchronized to Portals.
