import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsPipeline } from '../src/graphics/GraphicsPipeline.js';
import { resolveGraphicsSettings } from '../src/graphics/GraphicsSettings.js';

function profile(name, orbit, bloomEnabled = true) {
  const pipeline = Object.create(GraphicsPipeline.prototype);
  pipeline.settings = resolveGraphicsSettings(name, {}, {bloomEnabled});
  pipeline.world = {userData:{environmentBloom:orbit}};
  pipeline.bloom = {};
  pipeline.bloomComposite = {uniforms:{bloomMix:{value:0}}};
  pipeline.configureBloom();
  return { ...pipeline.bloom, mix:pipeline.bloomComposite.uniforms.bloomMix.value,
    enabled:pipeline.bloomComposite.enabled };
}

test('Cinematic gives emissive sources a visibly stronger glow in both ORBIT and other parks', () => {
  for (const orbit of [false,true]) {
    const fast = profile('high-refresh',orbit);
    const ultra = profile('ultra',orbit);
    const cinematic = profile('cinematic',orbit);
    assert.ok(cinematic.enabled);
    assert.ok(cinematic.strength * cinematic.mix > ultra.strength * ultra.mix * 1.5);
    assert.ok(cinematic.strength * cinematic.mix > fast.strength * fast.mix * 2);
    assert.ok(cinematic.threshold < ultra.threshold && cinematic.threshold < fast.threshold);
    assert.ok(cinematic.radius > fast.radius);
  }
});

test('the glow switch still disables bloom in every preset', () => {
  for (const name of ['performance','high-refresh','balanced','high','ultra','cinematic']) {
    for (const orbit of [false,true]) {
      const effect = profile(name,orbit,false);
      assert.equal(effect.enabled,false);
      assert.equal(effect.strength,0);
    }
  }
});

test('Cinematic boosts authored emissive materials without compounding on repeated updates', () => {
  const material = {emissive:{getHex:()=>0x4488ff}, emissiveIntensity:2};
  const pipeline = Object.create(GraphicsPipeline.prototype);
  pipeline.world = {traverse(visitor){visitor({isMesh:true, userData:{}, material});}};
  pipeline.emissiveBase = new WeakMap();
  pipeline.reflectionBase = new WeakMap();
  pipeline.settings = resolveGraphicsSettings('cinematic');
  pipeline.updateMaterials();
  assert.equal(material.emissiveIntensity, 2 * 1.25 * 1.45);
  pipeline.updateMaterials();
  assert.equal(material.emissiveIntensity, 2 * 1.25 * 1.45);
  pipeline.settings = resolveGraphicsSettings('high-refresh');
  pipeline.updateMaterials();
  assert.equal(material.emissiveIntensity, 2 * .8);
});
