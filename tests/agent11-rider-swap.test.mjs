import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StreetSkater } from '../src/game/StreetSkater.js';
import { UnrealRider } from '../src/character/UnrealRider.js';

test('newer model wins when old GLB resolves late', async () => {
  const previousLoad = UnrealRider.prototype.load;
  const previousDispose = UnrealRider.prototype.dispose;
  const complete = new Map();
  const disposed = [];
  try {
    UnrealRider.prototype.load = function() {
      const required = ['pelvis','head','upperarm_l','upperarm_r','thigh_l','thigh_r','foot_l','foot_r'];
      this.bones = Object.fromEntries(required.map(n => [n, {name:n}]));
      return new Promise(resolve => complete.set(this.url, () => resolve(this)));
    };
    UnrealRider.prototype.dispose = function() {
      disposed.push(this.url); this.root.removeFromParent();
    };
    const skater = Object.create(StreetSkater.prototype);
    skater.visual = new THREE.Group();
    skater.board = {deckHeight:0.12};
    skater.rider = {url:'old',dispose(){}};
    skater.resetPresentationAfterSwap = () => {};
    const older = skater.setRiderModel('older');
    const newer = skater.setRiderModel('newer');
    complete.get('newer')(); await newer;
    complete.get('older')(); await older;
    assert.equal(skater.rider.url,'newer');
    assert.deepEqual(disposed,['older']);
    const cancelled = skater.setRiderModel('cancelled');
    skater.cancelRiderSwap();
    complete.get('cancelled')(); await cancelled;
    assert.equal(skater.rider.url,'newer');
    assert.deepEqual(disposed,['older','cancelled']);
  } finally {
    UnrealRider.prototype.load = previousLoad;
    UnrealRider.prototype.dispose = previousDispose;
  }
});
