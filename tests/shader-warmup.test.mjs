import {test}from'node:test';import assert from'node:assert/strict';import{warmScenePrograms}from'../src/graphics/ShaderWarmup.js';
test('world readiness waits for shader compilation without rendering or changing the scene',async()=>{
 let done,called=false;const scene={},camera={},renderer={compileAsync(s,c){assert.equal(s,scene);assert.equal(c,camera);called=true;return new Promise(r=>done=r)}};
 let ready=false;const p=warmScenePrograms(renderer,scene,camera).then(v=>{ready=v});assert.equal(called,true);assert.equal(ready,false);done();await p;assert.equal(ready,true);assert.deepEqual(scene,{});
});
test('shader warmup fails softly for unavailable or lost contexts',async()=>{
 assert.equal(await warmScenePrograms({}, {}, {}),false);assert.equal(await warmScenePrograms({compileAsync(){throw Error('driver')}},{},{}),false);
 assert.equal(await warmScenePrograms({compileAsync(){throw Error('must not call')},getContext:()=>({isContextLost:()=>true})},{},{}),false);
});
