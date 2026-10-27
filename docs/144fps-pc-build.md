# 144 FPS PC build

The default graphics setting is now **144 FPS**. Existing installations start on this profile once through the v2 preference key; later explicit quality selections persist. Rendering follows the browser's native display cadence. The physics step remains 120 Hz, so changing refresh rate does not change gameplay speed or the coping fixes.

The profile draws the scene directly, disables bloom/AO/sharpening passes, releases large unused effect buffers, and limits internal rendering to 2,073,600 pixels while preserving the viewport aspect ratio. Materials, lighting, 1024² shadows and hardware canvas antialiasing remain. Canvas CSS fills the viewport independently of internal resolution, including after resizing. Higher quality profiles remain available.

Phone-specific menu/HUD/tutorial layouts and the touch audio-unlock handler were removed. Supported inputs are PC keyboard/mouse and standard gamepads. Small desktop-window layouts and reduced-motion settings remain.

## Validation

- All 862 unit/regression tests pass; production build passes.
- `STREETSKATE_URL=http://127.0.0.1:5181/ node tools/quality-144fps.mjs` checks all three maps, keyboard steering, simulated gamepad steering/pause, 4K-to-720p resizing, switching effects back on, preference persistence, and browser errors.
- Local Chrome / NVIDIA RTX 5060 Ti, 2560×1440 viewport at DPR 2 with 1920×1080 internal rendering: short rolling samples measured approximately 144 FPS in Warehouse, ORBIT and Skate Paradise, with 7 ms p95 frame intervals.
- A comparison on Skate Paradise at a 1920×1080/DPR 2 viewport measured about 131 FPS in Cinematic (3840×2160 internal) and 144 FPS in the new default (1920×1080 internal).
- Screenshots and the full measurement report are produced in `artifacts/144fps/`. Timing measures actual animation-frame intervals, not render-pass counters.

These are short local measurements, not a guarantee across every GPU or gameplay situation. The browser cannot change the monitor refresh setting; a 144 Hz display mode must be enabled in the operating system.
