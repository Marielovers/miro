import { clamp } from './utils.js';
import { PHYSICS } from './config.js';

// Original Cubism physics settings were absent. These are secondary-motion approximations,
// not recovered authoring settings. The model's parameter defaults and ranges are respected.
const channels = [
  ['fronthairX1','hairX',1.0, 1.0], ['fronthairX2','hairX',.78,.92],
  ['fronthairY','hairY',.9,1.0],
  ['sidehairX1','hairX',.93,1.0], ['sidehairX2','hairX',.73,.85], ['sidehairY','hairY',.83,.9],
  ['lefthairX1','hairX',.89,.96], ['lefthairX2','hairX',.69,.85], ['lefthairY','hairY',.80,.85],
  ['ahoX','hairX',1.25,1.1], ['ahoY','hairY',1.15,1.05],
  ['backX1','hairX',.76,.9], ['backX2','hairX',.58,.8],
  ['backY1','hairY',.76,.9], ['backY2','hairY',.58,.8],
  ['boobX1','bodyX',.94,.8], ['boobX2','bodyX',.73,.72],
  ['boobY1','bodyY',.94,.8], ['boobY2','bodyY',.73,.72],
];
export function normalizedFromDefault(p, value) {
  if (!p || !Number.isFinite(value)) return 0;
  const span = value >= p.default ? p.max-p.default : p.default-p.min;
  return span > 0 ? clamp((value-p.default)/span,-1,1) : 0;
}
export function fromDefault(p, value) {
  const v = clamp(value,-1,1);
  return p.default + v * (v >= 0 ? p.max-p.default : p.default-p.min);
}
export class SecondaryPhysics {
  constructor(avatar, options = PHYSICS) {
    this.avatar = avatar;
    this.options = options;
    this.channels = channels.filter(([id]) => avatar.metadata[id]).map(([id, group, speed, gain]) => ({id,group,speed,gain,position:0,velocity:0,initialized:false}));
  }
  update(dt, locked = {}) {
    const { avatar, options } = this;
    const n = id => normalizedFromDefault(avatar.metadata[id],avatar.read(id));
    const inputs = {
      hairX: clamp(.66*n('ParamAngleX') + .52*n('ParamAngleZ') + .22*n('ParamBodyAngleX') + .16*n('HX'),-1,1),
      hairY: clamp(.78*n('ParamAngleY') + .25*n('ParamBodyAngleY') + .30*n('depth') + .15*n('HY'),-1,1),
      bodyX: clamp(.65*n('ParamBodyAngleX') + .40*n('ParamBodyAngleZ') + .24*n('HX'),-1,1),
      bodyY: clamp(.72*n('ParamBodyAngleY') + .30*n('depth') + .22*n('HY'),-1,1),
    };
    const time = clamp(Number.isFinite(dt)?dt:0,0,.1);
    for (const c of this.channels) {
      const target = inputs[c.group];
      if (!c.initialized) { c.position=target; c.initialized=true; }
      const steps = Math.max(1,Math.ceil(time*120));
      const h = time/steps;
      // Substeps keep the underdamped spring stable across mobile/desktop FPS.
      for (let i=0;i<steps;i++) {
        c.velocity += ((target-c.position)*options.stiffness*c.speed*c.speed - options.damping*c.speed*c.velocity)*h;
        c.position += c.velocity*h;
      }
      if (Object.hasOwn(locked,c.id)) continue;
      const direction = options.direction[c.id] ?? 1;
      const groupGain = c.group.startsWith('hair') ? options.hairGain : options.bodyGain;
      const value = direction*groupGain*c.gain*((c.position-target) + options.restFollow*target);
      avatar.write(c.id, fromDefault(avatar.metadata[c.id],options.enabled ? value : 0));
    }
  }
}

// Cubism 5.3 renderer: update() takes milliseconds and emits beforeModelUpdate
// immediately before coreModel.update(). Run the entire input/physics/override
// pipeline at that one point, not in two callbacks with independent clocks.
export function installPhysicsPipeline(avatar, controller) {
  const internal = avatar.internal;
  const native = internal.physics;
  const evaluate = native && typeof native.evaluate === 'function' ? native.evaluate.bind(native) : null;
  const fallback = evaluate ? null : new SecondaryPhysics(avatar);
  let frameSeconds;
  let inFrame = false;
  const originalUpdate = internal.update;
  if (typeof originalUpdate === 'function') {
    internal.update = function (dt, ...args) {
      frameSeconds = Number.isFinite(dt) && dt > 0 ? Math.min(dt / 1000, .1) : undefined;
      inFrame = true;
      try {
        return originalUpdate.call(this, dt, ...args);
      } finally {
        inFrame = false;
        frameSeconds = undefined;
        // Cubism restores motion parameters after evaluating the mesh. Keep
        // persistent stage state available to the next frame and diagnostics.
        if (avatar.metadata.stage) avatar.write('stage', controller.drag?.stage ?? avatar.metadata.stage.default);
      }
    };
  }
  if (evaluate) {
    // Suppress only the renderer's earlier automatic call. The real evaluator
    // is called below after current camera and drag inputs are written.
    native.evaluate = function (...args) {
      if (!inFrame) return evaluate(...args);
    };
  }
  internal.on('beforeModelUpdate', () => {
    const dt = controller.apply(frameSeconds);
    if (evaluate) evaluate(avatar.coreModel ?? internal.coreModel, dt);
    else fallback.update(dt, controller.frameOverrides);
    controller.applyOverrides();
    controller.lastFrame = {
      stage: avatar.read('stage'),
      head: ['ParamAngleX','ParamAngleY','ParamAngleZ'].map(id=>avatar.read(id)),
      physics: Object.fromEntries(channels.filter(([id])=>avatar.metadata[id]).map(([id])=>[id,avatar.read(id)])),
      dt, frame: (controller.lastFrame?.frame ?? 0) + 1
    };
  });
  return evaluate ? 'cubism' : 'spring';
}
