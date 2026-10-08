import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

// Production Solar Dock smoke test. Previous Phase-1 harness is preserved as
// legacy-park-browser-smoke.mjs and must not be run against the Solar Dock main.
const url = process.env.STREETSKATE_URL || 'http://127.0.0.1:4173';
const screenshot = process.env.STREETSKATE_SCREENSHOT || 'artifacts/solar-dock-browser-smoke.png';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const failed = [];
page.on('pageerror', e => errors.push(String(e?.stack || e)));
page.on('requestfailed', req => {
  if (req.url().startsWith(url)) failed.push(req.url() + ': ' + (req.failure()?.errorText || 'unknown'));
});

function assertFiniteVector(vector, label) {
  assert.ok(Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite),
    label + ': invalid world vector ' + JSON.stringify(vector));
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => window.streetSkate?.ready === true, null, { timeout: 60000 });
  await page.bringToFront();
  await page.evaluate(() => window.focus());

  const boot = await page.evaluate(() => {
    const { skater, manifest, camera, renderer, captureAuditTelemetry, controlsVersion } = window.streetSkate;
    return {
      mode: document.querySelector('#app')?.dataset.mode,
      paused: document.querySelector('#app')?.dataset.paused,
      version: controlsVersion,
      park: manifest?.name, spots: manifest?.spots?.map(s => s.id) || [],
      rails: manifest?.rails?.length || 0,
      player: skater?.position?.toArray(), camera: camera?.position?.toArray(),
      rendererFrames: renderer?.info?.render?.frame ?? -1,
      telemetry: captureAuditTelemetry?.(),
      canvasCount: document.querySelectorAll('#viewport canvas').length,
      errors: (skater?.stateInvariantViolations || []).map(v => v.code),
    };
  });
  assert.equal(boot.mode, 'skate');
  assert.equal(boot.version, 'thug-controls-v2');
  assert.equal(boot.park, 'SOLAR DOCK');
  assert.deepEqual([...boot.spots].sort(), ['bowl', 'flow', 'mega', 'street']);
  assert.ok(boot.rails >= 8, 'expected full park rail/coping geometry');
  assert.equal(boot.canvasCount, 1);
  assertFiniteVector(boot.player, 'player');
  assertFiniteVector(boot.camera, 'camera');
  assert.ok(boot.rendererFrames >= 0);
  assert.ok(boot.telemetry && typeof boot.telemetry === 'object', 'read-only QA API missing');
  assert.deepEqual(boot.errors, [], 'canonical state violations during boot');

  // The QA panel must be an actual accessible button/overlay rather than a
  // static screenshot. It must not switch the gameplay mode or pause the game.
  const qaButton = page.locator('#debug-overlay');
  const qaPanel = page.locator('#debug-panel');
  await qaButton.click();
  await page.waitForTimeout(200);
  assert.equal(await qaButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await qaButton.getAttribute('aria-expanded'), 'true');
  assert.equal(await qaPanel.isVisible(), true);
  assert.match(await qaPanel.textContent(), /SPEED \/ HUD/);
  assert.match(await qaPanel.textContent(), /CAMERA/);
  assert.match(await qaPanel.textContent(), /RAIL/);

  // Keyboard F3 is an independent toggle path.
  await page.keyboard.press('F3');
  assert.equal(await qaPanel.isVisible(), false);
  await page.keyboard.press('F3');
  assert.equal(await qaPanel.isVisible(), true);
  const whileQA = await page.evaluate(() => ({
    mode: document.querySelector('#app').dataset.mode,
    telemetry: window.streetSkate.captureAuditTelemetry(),
  }));
  assert.equal(whileQA.mode, 'skate');
  assert.ok(Number.isFinite(whileQA.telemetry.speedKmh));

  // All four production spawn selectors preserve finite positions and create
  // a coherent camera pose without leaving a stale transition/grind state.
  for (const spot of boot.spots) {
    await page.evaluate(id => window.streetSkate.goToSpot(id), spot);
    await page.waitForTimeout(140);
    const state = await page.evaluate(() => {
      const s = window.streetSkate.skater;
      return {
        position: s.position.toArray(), velocity: s.velocity.toArray(),
        camera: window.streetSkate.camera.position.toArray(),
        transition: !!s.transitionAir, grinding: !!s.grind,
        invariantCodes: (s.stateInvariantViolations || []).map(v => v.code),
      };
    });
    assertFiniteVector(state.position, spot + ' spawn');
    assertFiniteVector(state.velocity, spot + ' velocity');
    assertFiniteVector(state.camera, spot + ' camera');
    assert.equal(state.transition, false, spot + ' entered stale transition');
    assert.equal(state.grinding, false, spot + ' entered stale grind');
    assert.deepEqual(state.invariantCodes, [], spot + ' canonical invariant mismatch');
  }

  // Existing focus event must never leave the UI pretending to simulate AIR.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#app').getAttribute('data-paused'), 'true');
  assert.equal(await page.locator('#pause-overlay').isVisible(), true);
  await page.evaluate(() => window.streetSkate.setPaused(false));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#pause-overlay').isVisible(), false);

  // Camera modes still function; high-follow remains the default on each new
  // load, while classic and fixed are user-selectable alternatives.
  await page.evaluate(() => window.streetSkate.setCameraMode('classic'));
  assert.equal(await page.locator('#camera-label').textContent(), 'CLASSIC');
  await page.evaluate(() => window.streetSkate.setCameraMode('fixed'));
  assert.equal(await page.locator('#camera-label').textContent(), 'FIXED');
  await page.evaluate(() => window.streetSkate.setCameraMode('follow'));
  assert.equal(await page.locator('#camera-label').textContent(), 'FOLLOW');

  await page.evaluate(() => window.streetSkate.goToSpot('street'));
  await page.waitForTimeout(180);
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.deepEqual(errors, [], 'uncaught browser exceptions');
  assert.deepEqual(failed, [], 'same-origin assets failed to load');
  console.log('SOLAR DOCK BROWSER SMOKE PASS', JSON.stringify({
    park: boot.park, spots: boot.spots, rails: boot.rails,
    telemetry: whileQA.telemetry.mode, screenshot,
  }));
} finally {
  await browser.close();
}
