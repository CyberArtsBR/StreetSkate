import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_GRAPHICS_PRESET, GRAPHICS_PRESET_ORDER, GRAPHICS_PRESETS,
  GRAPHICS_STORAGE_KEY, resolveGraphicsSettings, normalizedGraphicsPreset,
  loadGraphicsPreset, storeGraphicsPreset, qualityFogDistance,
} from '../src/graphics/GraphicsSettings.js';

test('all five user-facing presets use 1024 shadow resolution', () => {
  assert.deepEqual(GRAPHICS_PRESET_ORDER, ['performance','balanced','high','ultra','cinematic']);
  for (const key of GRAPHICS_PRESET_ORDER) {
    const p = GRAPHICS_PRESETS[key];
    assert.equal(p.shadowResolution, 1024, key);
    assert.ok(p.pixelRatioCap >= 1);
    assert.ok(p.bloomScale > 0 && p.bloomScale <= 1);
  }
});

test('preset caps never exceed DPR, MSAA or GPU anisotropy capabilities', () => {
  for (const name of GRAPHICS_PRESET_ORDER) {
    const p = resolveGraphicsSettings(name, { devicePixelRatio:1.5, maxAnisotropy:4, maxSamples:0 });
    assert.ok(p.pixelRatio <= 1.5);
    assert.ok(p.pixelRatio <= p.pixelRatioCap);
    assert.ok(p.anisotropy <= 4);
    assert.equal(p.msaaSamples, 0);
    assert.equal(p.shadowResolution, 1024);
  }
  assert.equal(resolveGraphicsSettings('cinematic', {devicePixelRatio:3,maxAnisotropy:32,maxSamples:4}).pixelRatio,2.25);
});

test('SSR remains optional to protect performance on low/midrange devices', () => {
  assert.equal(GRAPHICS_PRESETS.performance.ssr,false);
  assert.equal(GRAPHICS_PRESETS.balanced.ssr,false);
  assert.equal(GRAPHICS_PRESETS.high.ssr,false);
  assert.equal(GRAPHICS_PRESETS.ultra.ssr,true);
  assert.equal(GRAPHICS_PRESETS.cinematic.ssr,true);
  assert.equal(GRAPHICS_PRESETS.performance.bloomStrength,0);
  assert.ok(GRAPHICS_PRESETS.high.bloomStrength>0);
});

test('preset storage is versioned and resistant to disabled local storage', () => {
  const values = new Map();
  const storage = {getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v)};
  assert.equal(normalizedGraphicsPreset('wrong'),DEFAULT_GRAPHICS_PRESET);
  assert.equal(loadGraphicsPreset(storage),DEFAULT_GRAPHICS_PRESET);
  storeGraphicsPreset(storage,'ultra');
  assert.equal(values.get(GRAPHICS_STORAGE_KEY),'ultra');
  assert.equal(loadGraphicsPreset(storage),'ultra');
  const forbidden = {getItem(){throw Error('denied')},setItem(){throw Error('denied')}};
  assert.equal(loadGraphicsPreset(forbidden),DEFAULT_GRAPHICS_PRESET);
  assert.doesNotThrow(()=>storeGraphicsPreset(forbidden,'ultra'));
});

test('linear fog maintains near plane and adjusts far distance relative to the map', () => {
  assert.deepEqual(qualityFogDistance(100,225,GRAPHICS_PRESETS.high.fogDensity),{near:100,far:225});
  assert.ok(qualityFogDistance(100,225,GRAPHICS_PRESETS.cinematic.fogDensity).far>225);
  assert.ok(qualityFogDistance(100,225,GRAPHICS_PRESETS.ultra.fogDensity).far<225);
});

test('integration maintains scene-specific exposure and uses shared post FX compositor', () => {
  const main = readFileSync(new URL('../src/game-main.js',import.meta.url),'utf8');
  const shell = readFileSync(new URL('../src/game/GameShell.js',import.meta.url),'utf8');
  const fx = readFileSync(new URL('../src/graphics/GraphicsPipeline.js',import.meta.url),'utf8');
  assert.match(main,/sun\.shadow\.mapSize\.set\(1024, 1024\)/);
  assert.match(main,/renderer\.toneMappingExposure = settings\.exposure \*/);
  assert.match(main,/graphicsPipeline\.render\(\)/);
  assert.match(main,/graphicsPipeline\.setWorld\(park\)/);
  assert.match(shell,/graphicsSet/);
  assert.match(shell,/graphicsMenu/);
  assert.match(fx,/SSRPass/);
  assert.match(fx,/UnrealBloomPass/);
  assert.match(fx,/CAS_SHADER/);
});
