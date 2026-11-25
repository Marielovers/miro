import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SecondaryPhysics, installPhysicsPipeline } from '../src/physics.js';
import { AvatarController } from '../src/controller.js';
import { PHYSICS } from '../src/config.js';
function fixture(native) {
  const internal = new EventEmitter();
  internal.physics = native;
  const ids = ['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ','HX','HY','depth','stage','fronthairX1','fronthairX2','fronthairY','ahoX','backY1'];
  const metadata=Object.fromEntries(ids.map(id=>[id,{min:-1,max:1,default:0}]));
  metadata.stage={min:0,max:2,default:0};
  const values=Object.fromEntries(ids.map(id=>[id,0]));
  return {internal,metadata,values,read:id=>values[id],write:(id,v)=>{values[id]=v;},range:(_id,v)=>v,unit:(_id,v)=>v};
}
test('fallback reacts to movement, continues after release, and settles',()=>{
  const a=fixture(); const p=new SecondaryPhysics(a);
  p.update(1/60); assert.equal(a.read('fronthairX1'),0);
  a.write('ParamAngleX',1); p.update(1/60);
  assert.ok(Math.abs(a.read('fronthairX1'))>.1);
  for(let i=0;i<10;i++) p.update(1/60);
  a.write('ParamAngleX',0); p.update(1/60);
  assert.ok(Math.abs(a.read('fronthairX1'))>.01);
  for(let i=0;i<600;i++) p.update(1/60);
  assert.ok(Math.abs(a.read('fronthairX1'))<.001);
});
test('fallback respects locked outputs and model limits',()=>{
  const a=fixture(); const p=new SecondaryPhysics(a,{...PHYSICS,hairGain:100});
  p.update(1/60); a.write('fronthairX1',.4); a.write('ParamAngleX',1);
  p.update(1/60,{fronthairX1:.4});
  assert.equal(a.read('fronthairX1'),.4);
  assert.ok(Math.abs(a.read('fronthairX2'))<=1);
});
test('native physics sees current drag values; final overrides win; update exactly once',()=>{
  const a=fixture({evaluate(){assert.equal(a.read('ParamAngleZ'),.7); a.write('ParamAngleZ',-.5); a.write('fronthairX1',.6);}});
  a.internal.update=function(dt){this.physics.evaluate({},dt/1000);this.emit('beforeModelUpdate');};
  let count=0;
  const c={frameOverrides:{ParamAngleZ:.7},apply(){count++;a.write('ParamAngleZ',.7);return 1/60;},applyOverrides(){a.write('ParamAngleZ',.7);}};
  assert.equal(installPhysicsPipeline(a,c),'cubism');
  a.internal.update(1000/60);
  assert.equal(count,1); assert.equal(a.read('ParamAngleZ'),.7); assert.equal(a.read('fronthairX1'),.6);
});
test('actual controller: fallback receives head drag and preserves stage and drag',()=>{
  const a=fixture(); const c=new AvatarController(a,{raw:null});
  let overrides={},ticks=0;
  c.bindDrag({stage:2,update(){ticks++;},overrides:()=>overrides});
  c.lastTime=performance.now()-17; a.internal.emit('beforeModelUpdate');
  overrides={ParamAngleZ:.8}; c.lastTime=performance.now()-17; a.internal.emit('beforeModelUpdate');
  assert.equal(ticks,2); assert.equal(a.read('stage'),2); assert.equal(a.read('ParamAngleZ'),.8);
  assert.ok(Math.abs(a.read('fronthairX1'))>.01);
});

test('shipped native physics asset: reference, counts and parameter IDs match', async()=>{
  const {readFile}=await import('node:fs/promises');
  const folder=new URL('../public/live2d/avatar/',import.meta.url);
  const read=async name=>JSON.parse((await readFile(new URL(name,folder),'utf8')).replace(/^\uFEFF/,''));
  const model=await read('avatar.model3.json');
  assert.equal(model.FileReferences.Physics,'avatar.physics3.json');
  const physics=await read(model.FileReferences.Physics);
  const cdi=await read(model.FileReferences.DisplayInfo);
  const ids=new Set(cdi.Parameters.map(p=>p.Id));
  assert.equal(physics.PhysicsSettings.length,physics.Meta.PhysicsSettingCount);
  assert.equal(physics.PhysicsSettings.length,11);
  assert.equal(physics.Meta.Fps,60);
  let inputs=0,outputs=0;
  for(const group of physics.PhysicsSettings){
    for(const item of group.Input){assert.ok(ids.has(item.Source.Id),item.Source.Id);inputs++;}
    for(const item of group.Output){assert.ok(ids.has(item.Destination.Id),item.Destination.Id);assert.ok(item.VertexIndex<group.Vertices.length);outputs++;}
  }
  assert.equal(inputs,physics.Meta.TotalInputCount);
  assert.equal(outputs,physics.Meta.TotalOutputCount);
});
