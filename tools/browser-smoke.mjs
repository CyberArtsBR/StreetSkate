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

function angleDelta(a, b) {
  const tau = Math.PI * 2;
  let d = (Number(b) || 0) - (Number(a) || 0);
  d = ((d + Math.PI) % tau + tau) % tau - Math.PI;
  return d;
}

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
      invariantCodes: (skater?.stateInvariantViolations || []).map(entry => entry?.code).filter(Boolean),
      cameraPosition: state?.camera?.position?.toArray?.() || null,
      cameraQuaternion: state?.camera?.quaternion?.toArray?.() || null,
      resources,
      rendererFrame: Number(state?.renderer?.info?.render?.frame || 0),
      qaState: state?.captureState?.() || null,
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
  assert.deepEqual(boot.invariantCodes, [], 'canonical state already diverged during bootstrap');
  assert.ok(Array.isArray(boot.cameraPosition) && boot.cameraPosition.every(Number.isFinite),
    'camera position is not finite at bootstrap');
  assert.ok(Array.isArray(boot.cameraQuaternion) && boot.cameraQuaternion.every(Number.isFinite),
    'camera quaternion is not finite at bootstrap');
  assert.ok(boot.rendererFrame >= 0, 'renderer frame counter is invalid at bootstrap');
  assert.ok(boot.qaState && typeof boot.qaState === 'object',
    'canonical staging QA snapshot hook is unavailable');
  assert.equal(boot.qaState.landingYawInvariantViolations, 0,
    'QA snapshot reports a landing yaw violation at bootstrap');
  assert.deepEqual(boot.qaState.stateInvariantCodes, [],
    'QA snapshot reports canonical state divergence at bootstrap');

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

  // Real browser-loop ground input validation. Let auto-push establish useful
  // park speed, then prove steering owns yaw and brake owns speed.
  await page.waitForTimeout(900);
  const steerStart = await page.evaluate(() => {
    const state = window.streetSkate;
    const skater = state.skater;
    return {
      heading: skater.heading,
      speed: skater.velocity.length(),
      grounded: skater.grounded,
      rendererFrame: state.renderer.info.render.frame,
    };
  });
  assert.equal(steerStart.grounded, true, 'skater was not grounded before steering smoke');

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(420);
  await page.keyboard.up('KeyD');
  const steerEnd = await page.evaluate(() => {
    const state = window.streetSkate;
    const skater = state.skater;
    return {
      heading: skater.heading,
      speed: skater.velocity.length(),
      grounded: skater.grounded,
      yawViolations: skater.landingYawInvariantViolations || 0,
      invariantCodes: (skater.stateInvariantViolations || []).map(entry => entry?.code).filter(Boolean),
      cameraPosition: state.camera.position.toArray(),
      cameraQuaternion: state.camera.quaternion.toArray(),
      rendererFrame: state.renderer.info.render.frame,
    };
  });
  assert.equal(steerEnd.grounded, true, 'ground steering unexpectedly left the surface');
  assert.ok(Math.abs(angleDelta(steerStart.heading, steerEnd.heading)) > 0.04,
    `KeyD did not produce a meaningful player-authored yaw change: ${steerStart.heading} -> ${steerEnd.heading}`);
  assert.equal(steerEnd.yawViolations, 0, 'steering smoke triggered a landing yaw violation');
  assert.deepEqual(steerEnd.invariantCodes, [], 'steering smoke diverged canonical state');
  assert.ok(steerEnd.cameraPosition.every(Number.isFinite), 'camera position became non-finite during steering');
  assert.ok(steerEnd.cameraQuaternion.every(Number.isFinite), 'camera quaternion became non-finite during steering');

  // Build speed again if needed, then verify the explicit brake removes energy.
  await page.waitForTimeout(700);
  const brakeStart = await page.evaluate(() => ({
    speed: window.streetSkate.skater.velocity.length(),
    grounded: window.streetSkate.skater.grounded,
  }));
  assert.equal(brakeStart.grounded, true, 'skater was not grounded before brake smoke');
  assert.ok(brakeStart.speed > 1.0, `insufficient speed before brake smoke: ${brakeStart.speed}`);

  await page.keyboard.down('Shift');
  await page.waitForTimeout(420);
  await page.keyboard.up('Shift');
  const brakeEnd = await page.evaluate(() => ({
    speed: window.streetSkate.skater.velocity.length(),
    grounded: window.streetSkate.skater.grounded,
    yawViolations: window.streetSkate.skater.landingYawInvariantViolations || 0,
  }));
  assert.equal(brakeEnd.grounded, true, 'braking unexpectedly left the surface');
  assert.ok(brakeEnd.speed < brakeStart.speed - 0.35,
    `brake did not remove enough speed: ${brakeStart.speed} -> ${brakeEnd.speed}`);
  assert.equal(brakeEnd.yawViolations, 0, 'brake smoke triggered a landing yaw violation');

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

  const finalState = await page.evaluate(() => {
    const state = window.streetSkate;
    const skater = state.skater;
    return {
      rendererFrame: state.renderer.info.render.frame,
      cameraPosition: state.camera.position.toArray(),
      cameraQuaternion: state.camera.quaternion.toArray(),
      yawViolations: skater.landingYawInvariantViolations || 0,
      invariantCodes: (skater.stateInvariantViolations || []).map(entry => entry?.code).filter(Boolean),
    };
  });
  assert.ok(finalState.rendererFrame > steerStart.rendererFrame,
    `renderer did not advance: ${steerStart.rendererFrame} -> ${finalState.rendererFrame}`);
  assert.ok(finalState.cameraPosition.every(Number.isFinite), 'camera position non-finite after gameplay smoke');
  assert.ok(finalState.cameraQuaternion.every(Number.isFinite), 'camera quaternion non-finite after gameplay smoke');
  assert.equal(finalState.yawViolations, 0, 'browser gameplay smoke ended with landing yaw violations');
  assert.deepEqual(finalState.invariantCodes, [], 'browser gameplay smoke ended with canonical state divergence');

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
