import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = process.env.STREETSKATE_URL || 'http://127.0.0.1:4173';
const screenshotPath = process.env.STREETSKATE_SCREENSHOT || 'artifacts/phase1-browser-smoke.png';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const parkResponses = [];

page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
page.on('requestfailed', request => {
  failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'unknown',
  });
});
page.on('response', response => {
  const url = response.url();
  if (/\/assets\/park\//.test(url)) {
    parkResponses.push({ url, status: response.status() });
  }
});

try {
  await page.goto(baseUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });

  await page.waitForFunction(
    () => window.streetSkate?.ready === true,
    null,
    { timeout: 60_000 },
  );

  const boot = await page.evaluate(() => {
    const app = document.querySelector('#app');
    const resources = performance.getEntriesByType('resource')
      .map(entry => entry.name);
    const state = window.streetSkate;
    const skater = state?.skater;

    return {
      canvasCount: document.querySelectorAll('canvas').length,
      mode: app?.dataset?.mode || null,
      controlsVersion: state?.controlsVersion || null,
      spawn: state?.manifest?.spawn || null,
      rails: state?.manifest?.rails?.length ?? null,
      ready: state?.ready === true,
      grounded: Boolean(skater?.grounded),
      position: skater?.position?.toArray?.() || null,
      velocity: skater?.velocity?.toArray?.() || null,
      heading: Number(skater?.heading),
      yawViolations: Number(skater?.landingYawInvariantViolations || 0),
      resources,
      rendererFrame: Number(state?.renderer?.info?.render?.frame || 0),
    };
  });

  assert.equal(boot.ready, true, 'window.streetSkate never reached ready=true');
  assert.ok(boot.canvasCount >= 1, 'WebGL canvas was not created');
  assert.equal(boot.mode, 'skate', 'game did not enter skate mode after load');
  assert.equal(boot.controlsVersion, 'thug-controls-v1');
  assert.ok(Array.isArray(boot.spawn) && boot.spawn.length === 3, 'park manifest spawn missing');
  assert.ok(Number.isInteger(boot.rails) && boot.rails > 0, 'park rails metadata missing');
  assert.ok(Array.isArray(boot.position) && boot.position.every(Number.isFinite), 'skater position is not finite');
  assert.ok(Array.isArray(boot.velocity) && boot.velocity.every(Number.isFinite), 'skater velocity is not finite');
  assert.ok(Number.isFinite(boot.heading), 'skater heading is not finite');
  assert.equal(boot.yawViolations, 0, 'landing yaw invariant already violated during bootstrap');

  const hasResource = pattern => boot.resources.some(url => pattern.test(url));
  assert.equal(
    hasResource(/\/assets\/park\/insanity-inspired-park\.glb(?:$|\?)/),
    true,
    'original visual arena was not requested',
  );
  assert.equal(
    hasResource(/\/assets\/park\/park-collision\.glb(?:$|\?)/),
    true,
    'optimized collision arena was not requested',
  );
  assert.equal(
    hasResource(/halfpipenew\.glb/i),
    false,
    'halfpipenew must remain inactive during Phase 1 staging',
  );

  for (const response of parkResponses) {
    assert.ok(response.status >= 200 && response.status < 400,
      `park asset failed: ${response.status} ${response.url}`);
  }

  await page.bringToFront();
  await page.evaluate(() => window.focus());
  await page.waitForFunction(() => document.hasFocus() && !document.hidden, null, { timeout: 5_000 });
  const start = await page.evaluate(() => ({
    y: window.streetSkate.skater.position.y,
    grounded: window.streetSkate.skater.grounded,
  }));

  await page.keyboard.down('Space');
  await page.waitForTimeout(320);
  await page.keyboard.up('Space');

  let maxY = start.y;
  let observedAir = !start.grounded;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(25);
    const sample = await page.evaluate(() => ({
      y: window.streetSkate.skater.position.y,
      grounded: window.streetSkate.skater.grounded,
      velocity: window.streetSkate.skater.velocity.toArray(),
      heading: window.streetSkate.skater.heading,
      yawViolations: window.streetSkate.skater.landingYawInvariantViolations || 0,
    }));
    maxY = Math.max(maxY, sample.y);
    observedAir ||= !sample.grounded;
    assert.ok(sample.velocity.every(Number.isFinite), 'non-finite velocity during browser ollie');
    assert.ok(Number.isFinite(sample.heading), 'non-finite heading during browser ollie');
    assert.equal(sample.yawViolations, 0, 'contact-driven yaw invariant violated during browser ollie');
  }

  assert.equal(observedAir, true, 'Space input never produced an airborne frame');
  assert.ok(maxY > start.y + 0.12,
    `ollie did not gain expected height: start=${start.y}, max=${maxY}`);

  await page.screenshot({ path: screenshotPath, fullPage: true });

  assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join('\n')}`);
  assert.deepEqual(failedRequests, [], `failed requests:\n${JSON.stringify(failedRequests, null, 2)}`);
  assert.deepEqual(consoleErrors, [], `console errors:\n${consoleErrors.join('\n')}`);

  process.stdout.write(JSON.stringify({
    ok: true,
    baseUrl,
    maxOllieY: maxY,
    parkResponses,
    screenshotPath,
  }, null, 2) + '\n');
} catch (error) {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {}
  throw error;
} finally {
  await browser.close();
}
