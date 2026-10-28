import test from 'node:test';
import assert from 'node:assert/strict';
import { GameShell } from '../src/game/GameShell.js';
import { renderFlipSchool } from '../src/game/FlipSchool.js';

function shellAt(phase='title') {
  const shell=Object.create(GameShell.prototype);
  Object.assign(shell,{phase,page:0,pages:[{},{}],pendingMode:null,
    actions:{pause(){}},music:{unlock(){}},render(){},
    setScreen(value){this.phase=value;},resume(){this.phase='playing';}});
  return shell;
}

test('Tutorial opens Flip School first and Next enters the original guide',()=>{
  const shell=shellAt();shell.openTutorial();
  assert.equal(shell.phase,'flipSchool');assert.equal(shell.flipTutorial,true);
  assert.match(renderFlipSchool(0,'xbox',true),/data-action="tutorialNext"/);
  assert.doesNotMatch(renderFlipSchool(0,'xbox',false),/data-action="tutorialNext"/);
  shell.choose('tutorialNext');assert.equal(shell.phase,'tutorial');assert.equal(shell.page,0);
  shell.choose('next');assert.equal(shell.page,1);
  shell.choose('previous');assert.equal(shell.page,0);
  shell.choose('previous');assert.equal(shell.phase,'flipSchool');
  shell.back();assert.equal(shell.phase,'title');
});

test('Tutorial entry returns to a paused session and direct Flip School returns to its source',()=>{
  const paused=shellAt('pause');paused.openTutorial();paused.back();assert.equal(paused.phase,'pause');
  const playing=shellAt('playing');playing.openTutorial();playing.back();assert.equal(playing.phase,'playing');
  const guide=shellAt('tutorial');guide.page=1;guide.openFlipSchool();
  assert.equal(guide.flipTutorial,false);guide.back();assert.equal(guide.phase,'tutorial');assert.equal(guide.page,1);
});
