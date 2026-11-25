import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseHitArea, ribbonStage } from '../src/drag.js';
import { faceToControls } from '../src/tracking.js';
const defs = [
  { id:'HitArea',name:'Hitarea'}, {id:'HitAreahead',name:'Hitareahead'},
  {id:'HitAreariibbon',name:'Hitarearibbon'}, {id:'HitArearight',name:'Hitarearight'},
  {id:'HitArealeft',name:'Hitarealeft'}
];
test('hit area: specific head wins over generic',()=>{
  assert.equal(chooseHitArea(['Hitarea','Hitareahead'],defs),'HitAreahead');
});
test('hit area: ribbon priority wins over head',()=>{
  assert.equal(chooseHitArea(['Hitareahead','Hitarearibbon'],defs),'HitAreariibbon');
});
test('ribbon: drag only reaches 1, then auto rise can reach 2',()=>{
  assert.equal(ribbonStage(0,0,0),0);
  assert.equal(ribbonStage(0,59,0),.5);
  assert.equal(ribbonStage(0,118,0),1);
  assert.equal(ribbonStage(0,200,0),1);
  assert.ok(ribbonStage(1,118,SENSITIVITY.ribbonHoldToStage2Seconds/2)>1);
  assert.equal(ribbonStage(1,118,SENSITIVITY.ribbonHoldToStage2Seconds),2);
  assert.equal(ribbonStage(2,10,0),2);
  assert.equal(ribbonStage(0,10,0,true),2);
});
test('head + face: depth increases nearer and decreases farther',()=>{
  const baseline={yaw:0,pitch:0,roll:0,faceWidth:0.2};
  const face={yaw:0,pitch:0,roll:0,faceWidth:0.4,blend:{},gazeX:0,gazeY:0};
  assert.ok(faceToControls(face,baseline).depth>0);
  assert.ok(faceToControls({...face,faceWidth:0.1},baseline).depth<0);
  assert.equal(faceToControls(face,null).depth, undefined);
});
test('face: ParamAngleX is flipped left-right',()=>{
  const baseline={yaw:0,pitch:0,roll:0,faceWidth:0.2};
  const rightTurn={yaw:15,pitch:0,roll:0,faceWidth:0.2,blend:{},gazeX:0,gazeY:0};
  const leftTurn={yaw:-15,pitch:0,roll:0,faceWidth:0.2,blend:{},gazeX:0,gazeY:0};
  assert.ok(faceToControls(rightTurn, baseline).angleX < 0);
  assert.ok(faceToControls(leftTurn, baseline).angleX > 0);
});

import { bodyFromHead, responseFor } from '../src/controller.js';
import { SENSITIVITY } from '../src/config.js';
import { readFileSync } from 'node:fs';
test('body follows camera head and drag overrides, including elastic release', () => {
  const head = {angleX: .6, angleY: -.5, angleZ: .25};
  const base = bodyFromHead(head);
  assert.equal(base.ParamBodyAngleX, .6 * SENSITIVITY.bodyFollowX);
  assert.equal(base.ParamBodyAngleY, -.5 * SENSITIVITY.bodyFollowY);
  assert.equal(base.ParamBodyAngleZ, .25 * SENSITIVITY.bodyFollowZ);
  const dragged = bodyFromHead(head, {ParamAngleY: .9, ParamAngleZ: -.8});
  assert.equal(dragged.ParamBodyAngleY, .9 * SENSITIVITY.bodyFollowY);
  assert.equal(dragged.ParamBodyAngleZ, -.8 * SENSITIVITY.bodyFollowZ);
});
test('eye and mouth respond strongly to small expressions', () => {
  const baseline={yaw:0,pitch:0,roll:0,faceWidth:.2};
  const face={...baseline,blend:{eyeBlinkLeft:.45,eyeBlinkRight:.1,jawOpen:.2,mouthSmileLeft:.2},gazeX:0,gazeY:0};
  const c=faceToControls(face,baseline);
  assert.equal(c.eyeL,0);
  assert.ok(c.eyeR > .7 && c.eyeR < .9);
  assert.ok(c.mouthOpen > .5);
  assert.ok(c.mouthForm > .3);
  assert.ok(responseFor('eyeL',1,0) < .02);
  assert.ok(responseFor('mouthOpen',0,1) < .04);
});
test('new model has matching MOC3 v6, all body/face parameters and five HitAreas', () => {
  const dir=new URL('../public/live2d/avatar/', import.meta.url);
  const model=JSON.parse(readFileSync(new URL('avatar.model3.json',dir),'utf8'));
  const info=JSON.parse(readFileSync(new URL(model.FileReferences.DisplayInfo,dir),'utf8'));
  const ids=new Set(info.Parameters.map(p=>p.Id));
  assert.equal(ids.size,48);
  for (const id of ['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ','ParamEyeLOpen','ParamEyeROpen','ParamMouthForm','ParamMouthOpenY','depth','stage','HX','HY','BRX','BRY','BLX','BLY']) assert.ok(ids.has(id),id);
  assert.deepEqual(new Set(model.HitAreas.map(p=>p.Id)),new Set(defs.map(p=>p.id)));
  const moc=readFileSync(new URL(model.FileReferences.Moc,dir));
  assert.equal(moc.subarray(0,4).toString(),'MOC3');
  assert.equal(moc[4],6);
  for (const tex of model.FileReferences.Textures) assert.ok(readFileSync(new URL(tex,dir)).length>0);
});

import { DragInteraction } from '../src/drag.js';
function ribbonFixture(onGrab) {
  const windowEvents = new Map();
  globalThis.window = {innerWidth: 800, innerHeight: 600, addEventListener: (name,fn)=>windowEvents.set(name,fn)};
  const events = new Map();
  const canvas = {addEventListener: (name,fn)=>events.set(name,fn), getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),setPointerCapture(){},hasPointerCapture(){return true},releasePointerCapture(){}};
  let hit = 'Hitarearibbon';
  const avatar = {read:()=>0, metadata:{}, app:{screen:{width:800,height:600}},model:{hitTest:()=>[hit]},internal:{hitAreas:defs}};
  const drag = new DragInteraction(canvas,avatar,()=>0,onGrab);
  const event = (y=0, id=1)=>({pointerId:id,button:0,pointerType:'mouse',clientX:0,clientY:y,preventDefault(){}});
  return {drag,events,windowEvents,event,setHit:v=>{hit=v}};
}
test('ribbon: actual pointer events hold at 1, release rises to 2 and locks',()=>{
  const {drag,events,event}=ribbonFixture();
  events.get('pointerdown')(event());
  events.get('pointermove')(event(160));
  assert.equal(drag.stage,1);
  for(let i=0;i<150;i++) drag.update(1/60);
  assert.equal(drag.stage,1);
  events.get('pointerup')(event(160));
  assert.equal(drag.stage,1);
  drag.update(SENSITIVITY.ribbonHoldToStage2Seconds / 2);
  assert.ok(Math.abs(drag.stage-1.5)<1e-8);
  drag.update(SENSITIVITY.ribbonHoldToStage2Seconds / 2 + .001);
  assert.equal(drag.stage,2);
  events.get('pointerdown')(event()); events.get('pointermove')(event(25)); events.get('pointerup')(event(25));
  drag.update(1); assert.equal(drag.stage,2);
});
test('ribbon: global release and new drag cannot stop the rise',()=>{
  const {drag,events,windowEvents,event,setHit}=ribbonFixture();
  events.get('pointerdown')(event()); events.get('pointermove')(event(117));
  assert.equal(drag.stage,1);
  windowEvents.get('pointerup')(event(117));
  drag.update(SENSITIVITY.ribbonHoldToStage2Seconds / 4);
  const value=drag.stage;
  events.get('pointerdown')(event(0,2)); events.get('pointermove')(event(30,2));
  assert.equal(drag.stage,value);
  drag.update(SENSITIVITY.ribbonHoldToStage2Seconds / 4); assert.ok(drag.stage>value);
  events.get('pointerup')(event(30,2));
  setHit('Hitareahead'); events.get('pointerdown')(event(0,3));
  drag.update(2); assert.equal(drag.stage,2);
});
test('ribbon: partial drag release does not start rise',()=>{
  const {drag,events,event}=ribbonFixture();
  events.get('pointerdown')(event()); events.get('pointermove')(event(59)); events.get('pointerup')(event(59));
  drag.update(3); assert.equal(drag.stage,.5);
});

test('audio routing: three hit areas use Hit, remaining use Hmm', async () => {
  const { voiceGroup, voicePath } = await import('../src/audio.js');
  for (const id of ['HitArealeft','HitArearight','HitAreariibbon']) assert.equal(voiceGroup(id),'Hit');
  for (const id of ['HitAreahead','HitArea']) assert.equal(voiceGroup(id),'Hmm');
  assert.ok(voicePath('HitArearight', 3).endsWith('Voice_Miro_Hit3.wav'));
});

 test('voice trigger fires only once per accepted grab',()=>{
  const hits=[]; const {events,event,setHit}=ribbonFixture(hit=>hits.push(hit));
  events.get('pointerdown')(event()); events.get('pointermove')(event(150)); events.get('pointermove')(event(200)); events.get('pointerup')(event(200));
  assert.deepEqual(hits,['HitAreariibbon']);
  setHit('Hitareahead'); events.get('pointerdown')(event()); events.get('pointerup')(event());
  assert.deepEqual(hits,['HitAreariibbon','HitAreahead']);
  setHit('unknown'); events.get('pointerdown')(event()); assert.equal(hits.length,2);
});
test('audio assets are present',()=>{
 const dir=new URL('../public/audio/',import.meta.url);
 for (const group of ['Hit','Hmm']) for(let i=1;i<=3;i++) assert.equal(readFileSync(new URL(`Voice_Miro_${group}${i}.wav`,dir)).subarray(0,4).toString(),'RIFF');
 assert.equal(readFileSync(new URL('BGM_Crayon.ogg',dir)).subarray(0,4).toString(),'OggS');
 assert.ok(readFileSync(new URL('BGM_Crayon.mp3',dir)).length>0);
});

test('ribbon: last pointerup coordinates reach stage one and start automatic rise',()=>{
  const {drag,events,event}=ribbonFixture();
  events.get('pointerdown')(event());
  events.get('pointermove')(event(30));
  events.get('pointerup')({...event(160),type:'pointerup'});
  assert.equal(drag.stage,1);
  assert.ok(drag.ribbonAutoRise);
  drag.update(SENSITIVITY.ribbonHoldToStage2Seconds+.001);
  assert.equal(drag.stage,2);
});
test('ribbon: stage one stays latched until release even with small reverse movement',()=>{
  const {drag,events,event}=ribbonFixture();
  events.get('pointerdown')(event()); events.get('pointermove')(event(150));
  events.get('pointermove')(event(70)); assert.equal(drag.stage,1);
  events.get('pointerup')({...event(70),type:'pointerup'});
  drag.update(1); assert.equal(drag.stage,2);
});
