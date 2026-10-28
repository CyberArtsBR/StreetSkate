import test from 'node:test';
import assert from 'node:assert/strict';
import {PracticeDrills} from '../src/game/PracticeDrills.js';

test('practice drills advance only when the matching trick is banked',()=>{
  const d=new PracticeDrills();
  assert.equal(d.accept([{name:'Ollie'}]),false);
  d.toggle();
  assert.equal(d.accept([{name:'Kickflip'}]),false);
  assert.equal(d.accept([{name:'Ollie'}]),true);
  assert.equal(d.accept([{name:'Kickflip'}]),true);
  assert.equal(d.accept([{name:'Noseslide'}]),true);
  assert.equal(d.accept([{name:'Ollie'},{name:'Kickflip'}]),false);
  assert.equal(d.accept([{name:'Ollie'},{name:'Kickflip'},{name:'50-50'}]),true);
  assert.equal(d.label,'All drills complete!');
  d.toggle(); assert.equal(d.label,'');
});
