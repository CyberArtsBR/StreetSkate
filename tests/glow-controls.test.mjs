import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsPipeline } from '../src/graphics/GraphicsPipeline.js';
import { GRAPHICS_STORAGE_KEY, resolveGraphicsSettings } from '../src/graphics/GraphicsSettings.js';
import { GLOW_CONTROLS, GLOW_TUNING_KEY, GLOW_DEFAULTS_KEY, readGlowPresets, saveGlowPresets, resolveGlowTuning, stepGlowValue, initializeGlowDefaults, useCurrentGlowDefaults } from '../src/graphics/GlowTuning.js';

function pipeline(name, enabled = true) {
  const material = {emissive:{getHex:()=>0x4488ff},emissiveIntensity:2};
  const p = Object.create(GraphicsPipeline.prototype);
  p.settings = resolveGraphicsSettings(name, {}, {bloomEnabled:enabled});
  p.world = {userData:{environmentBloom:true},traverse(visitor){visitor({isMesh:true,userData:{},material});}};
  p.emissiveBase = new WeakMap();p.reflectionBase = new WeakMap();
  p.bloom = {};p.bloomComposite = {uniforms:{bloomMix:{value:0}}};
  p.configureBloom();p.updateMaterials();
  return {p,material};
}

test('Cinematic starts with the previously chosen values without changing the image', () => {
  const settings = resolveGraphicsSettings('cinematic');
  const tuning = resolveGlowTuning(settings,true);
  assert.equal(tuning.emissive,1.25*1.35);
  assert.ok(Math.abs(tuning.bloom-0.9975)<1e-9);
  assert.equal(tuning.glow,.75);assert.equal(tuning.radius,.38);
  assert.equal(stepGlowValue(GLOW_CONTROLS[0],tuning.emissive,1),1.74);
});

test('each control changes its real rendering value without compounding world emission', () => {
  const {p,material} = pipeline('cinematic');
  p.setGlowTuning({emissive:1.4,bloom:.6,glow:.5,radius:.25});
  assert.equal(material.emissiveIntensity,2.8);
  assert.equal(p.bloom.strength,.6);assert.equal(p.bloom.radius,.25);
  assert.equal(p.bloomComposite.uniforms.bloomMix.value,.5);
  p.setGlowTuning({emissive:1.4,bloom:.7,glow:.6,radius:.3});
  assert.equal(material.emissiveIntensity,2.8,'repeated changes must not multiply the material again');
  p.setGlowTuning({});
  assert.equal(material.emissiveIntensity,2*1.25*1.35);
  assert.ok(Math.abs(p.bloom.strength-.9975)<1e-9);
});

test('saved values are per preset, clamped, and survive disabled storage', () => {
  const values = new Map();
  const store = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const result = saveGlowPresets({cinematic:{emissive:1.4,bloom:99},'high-refresh':{glow:.55},unknown:{glow:1}},store);
  assert.deepEqual(result,{cinematic:{emissive:1.4,bloom:2.5},'high-refresh':{glow:.55}});
  assert.deepEqual(readGlowPresets(store),result);
  values.set(GLOW_TUNING_KEY,'not json');assert.deepEqual(readGlowPresets(store),{});
  const forbidden = {getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  assert.deepEqual(readGlowPresets(forbidden),{});
  assert.doesNotThrow(()=>saveGlowPresets(result,forbidden));
});

test('switching glow off and Performance mode keep bloom off despite saved custom values', () => {
  for (const name of ['cinematic','performance']) {
    const {p} = pipeline(name,false);
    p.setGlowTuning({bloom:2,glow:1,radius:.5});
    assert.equal(p.bloomComposite.enabled,false);assert.equal(p.bloom.strength,0);
    assert.equal(resolveGlowTuning(p.settings,true).bloom,2,'saved choice stays editable while off');
  }
});

test('new players get the requested 144 FPS values and retain them on reload', () => {
  const values = new Map();
  const store = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let legacyGlowDefaults = initializeGlowDefaults(store);
  assert.equal(legacyGlowDefaults,false);
  const desired = {emissive:1.2,bloom:.49,glow:.5,radius:.26};
  for (const orbit of [false,true])
    assert.deepEqual(resolveGlowTuning(resolveGraphicsSettings('high-refresh',{}, {legacyGlowDefaults}),orbit),desired);
  values.set(GRAPHICS_STORAGE_KEY,'high-refresh');
  legacyGlowDefaults = initializeGlowDefaults(store);
  assert.equal(legacyGlowDefaults,false,'a returning new player must not be misclassified');
  assert.deepEqual(resolveGlowTuning(resolveGraphicsSettings('high-refresh',{}, {legacyGlowDefaults}),true),desired);
});

test('existing players keep their old baseline and saved overrides until they reset', () => {
  const values = new Map([[GRAPHICS_STORAGE_KEY,'high-refresh'],
    [GLOW_TUNING_KEY,JSON.stringify({'high-refresh':{emissive:.95,bloom:.37}})]]);
  const store = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const legacyGlowDefaults = initializeGlowDefaults(store);
  assert.equal(legacyGlowDefaults,true);
  const glowTuning=readGlowPresets(store)['high-refresh'];
  const settings=resolveGraphicsSettings('high-refresh',{}, {legacyGlowDefaults,glowTuning});
  assert.deepEqual(resolveGlowTuning(settings,true),{emissive:.95,bloom:.37,glow:.6,radius:.26});
  assert.deepEqual(resolveGlowTuning(settings,false),{emissive:.95,bloom:.37,glow:.38,radius:.26});
  assert.equal(initializeGlowDefaults(store),true,'legacy classification survives reload');
  const readOnly = {getItem:key=>key===GRAPHICS_STORAGE_KEY?'high-refresh':null,setItem(){throw Error('denied');}};
  assert.equal(initializeGlowDefaults(readOnly),true,'read-only storage still preserves existing settings');
  useCurrentGlowDefaults(store);
  assert.equal(values.get(GLOW_DEFAULTS_KEY),'current');
  assert.equal(initializeGlowDefaults(store),false);
  const reset=resolveGraphicsSettings('high-refresh',{}, {legacyGlowDefaults:false});
  assert.deepEqual(resolveGlowTuning(reset,true),{emissive:1.2,bloom:.49,glow:.5,radius:.26});
});
