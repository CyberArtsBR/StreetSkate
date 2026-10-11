import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ParkCollision } from '../src/game/ParkCollision.js';
import { fitGraffitiHud } from '../src/game/GraffitiHudLayout.js';

function verticalPanel(surface, transitionSkin) {
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2,0,0), new THREE.Vector3(2,0,0), new THREE.Vector3(-2,2,0),
      new THREE.Vector3(2,0,0), new THREE.Vector3(2,2,0), new THREE.Vector3(-2,2,0),
    ]),
    new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),
  );
  mesh.userData.surface = surface;
  mesh.userData.transitionSkin = transitionSkin;
  const root = new THREE.Group(); root.add(mesh);
  return new ParkCollision(root);
}

test('nose/tail sweep and wallride probes never treat a rideable steep ramp as a structural wall', () => {
  const rideable = verticalPanel('rideable',true);
  const from = new THREE.Vector3(0,0.9,-0.65);
  const to = new THREE.Vector3(0,0.9,0.65);
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  assert.equal(rideable.solidMeshes.length, 0, 'rideable ramp included in solid probes');
  assert.equal(rideable.ridingMeshes.length, 1, 'rideable contact lost');
  assert.equal(rideable.sweepSolidSphere(from,to,0.08,point,normal),null,
    'skateboard nose blocks against a quarter pipe skin');
  assert.equal(rideable.wallContact(new THREE.Vector3(0,0,0.15),new THREE.Vector3(0,0,1),0.6),null,
    'ramp triggered an unintended wallride');
});

test('real structural wall still stops skateboard nose/tail and remains wallride-eligible', () => {
  const solid = verticalPanel('solid',false);
  const from = new THREE.Vector3(0,0.9,-0.65);
  const to = new THREE.Vector3(0,0.9,0.65);
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  assert.equal(solid.solidMeshes.length,1);
  assert.equal(solid.ridingMeshes.length,0);
  const impact = solid.sweepSolidSphere(from,to,0.08,point,normal);
  assert.ok(impact,'genuine structural wall no longer blocks the board');
  assert.ok(impact.distance>=0 && impact.distance<=from.distanceTo(to));
});

test('gold/fire/red digit widths are measured independently and fitted inside the viewport', () => {
  for (const viewport of [320,480,720,1280,1920]) {
    const state = {value:0};
    const style = {
      setProperty(name,value){ if(name==='--letter-height')state.value=parseFloat(value); },
    };
    const words = ['INDY', 'OLLIE', '99999999999999999'].map(label=>({
      get scrollWidth(){ return label.length*0.72*state.value; },
    }));
    const node = {style,querySelectorAll(selector){assert.equal(selector,'.graffiti-word');return words;}};
    const fitted = fitGraffitiHud(node,viewport,720);
    const allowed = viewport-40;
    const largest = Math.max(...words.map(word=>word.scrollWidth));
    assert.ok(largest<=allowed-24+.1,`at width ${viewport}, digit sprites exceed safe region: ${largest}`);
    assert.ok(fitted.height>0 && fitted.height<=40);
    // Short subsequent scores recover their full size, without retaining the
    // previous long-score fit from the same node.
    words.pop();
    const short = fitGraffitiHud(node,viewport,720);
    assert.ok(short.height>=fitted.height);
  }
});

test('graffiti HUD keeps a clear top margin and only sprites render the visible score',()=>{
 const css=readFileSync('src/game-hud.css','utf8');
 assert.match(css,/top:clamp\(125px,18vh,190px\)/);
 assert.match(css,/#trick-feedback \.graffiti-word img\{[^}]*max-height:none;/);
 assert.match(css,/#trick-feedback::after\{content:none!important\}/);
 const main=readFileSync('src/game-main.js','utf8');
 assert.match(main,/scheduleTrickHudFit\(\)/);
 assert.match(main,/image\.addEventListener\('load', scheduleTrickHudFit/);
});
