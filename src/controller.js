import { faceToControls } from './tracking.js';
import { clamp, lerpExp } from './utils.js';
import { SENSITIVITY } from './config.js';
import { installPhysicsPipeline } from './physics.js';

// camera:1 / physics:2 / HitArea:3 의 우선순위. 실제 모델 최종 update 바로 전 합성.
const faceParamMap = [
  ['ParamAngleX','angleX','range'], ['ParamAngleY','angleY','range'], ['ParamAngleZ','angleZ','range'],
  ['ParamEyeLOpen','eyeL','unit'], ['ParamEyeROpen','eyeR','unit'],
  ['ParamEyeLSmile','eyeSmileL','unit'], ['ParamEyeRSmile','eyeSmileR','unit'],
  ['ParamEyeBallX','gazeX','range'], ['ParamEyeBallY','gazeY','range'],
  ['ParamBrowLY','browLY','range'], ['ParamBrowRY','browRY','range'],
  ['ParamBrowLAngle','browLAngle','range'], ['ParamBrowRAngle','browRAngle','range'],
  ['ParamBrowLForm','browLForm','range'], ['ParamBrowRForm','browRForm','range'],
  ['ParamMouthForm','mouthForm','range'], ['ParamMouthOpenY','mouthOpen','unit'],
];
const idle = { angleX:0, angleY:0, angleZ:0, depth:0,
  eyeL:1,eyeR:1, eyeSmileL:0,eyeSmileR:0,gazeX:0,gazeY:0,
  browLY:0,browRY:0,browLAngle:0,browRAngle:0,browLForm:0,browRForm:0,
  mouthForm:0,mouthOpen:0 };

// 드래그/탄성 복귀까지 반영된 실제 머리 회전에서 몸 각도를 계산.
export function bodyFromHead(current, overrides = {}) {
  return {
    ParamBodyAngleX: clamp(overrides.ParamAngleX ?? current.angleX, -1, 1) * SENSITIVITY.bodyFollowX,
    ParamBodyAngleY: clamp(overrides.ParamAngleY ?? current.angleY, -1, 1) * SENSITIVITY.bodyFollowY,
    ParamBodyAngleZ: clamp(overrides.ParamAngleZ ?? current.angleZ, -1, 1) * SENSITIVITY.bodyFollowZ,
  };
}
export function responseFor(key, previous, target) {
  if (key === 'eyeL' || key === 'eyeR') return target < previous ? SENSITIVITY.blinkCloseResponse : SENSITIVITY.blinkOpenResponse;
  if (key === 'mouthOpen' || key === 'mouthForm') return SENSITIVITY.mouthResponse;
  return key === 'depth' ? 0.28 : 0.105;
}

export class AvatarController {
  constructor(avatar, tracking) {
    this.avatar = avatar;
    this.tracking = tracking;
    this.drag = null;
    this.current = { ...idle };
    this.lastTime = performance.now();
    this.startTime = performance.now();
    this.frameOverrides = {};
    this.physicsMode = installPhysicsPipeline(avatar, this);
    console.info('[Live2D] physics mode:', this.physicsMode);
  }
  bindDrag(drag) { this.drag = drag; }
  cameraNormalized(id) {
    const aliases = { ParamAngleY:'angleY', ParamAngleZ:'angleZ' };
    return this.current[aliases[id]] ?? 0;
  }
  apply(frameSeconds) {
    const now = performance.now();
    const dt = clamp(Number.isFinite(frameSeconds) ? frameSeconds : (now - this.lastTime)/1000, 0, 0.1);
    this.lastTime = now;
    const recentlySeen = this.tracking.raw && now - this.tracking.lastSeen < 600;
    const target = recentlySeen ? { ...idle, ...faceToControls(this.tracking.raw, this.tracking.baseline) } : idle;
    for (const [key, value] of Object.entries(target)) {
      this.current[key] = lerpExp(this.current[key], value, dt, responseFor(key, this.current[key], value));
    }
    const { write, unit, range, metadata } = this.avatar;
    for (const [param, key, mode] of faceParamMap) {
      if (!metadata[param]) continue;
      // 눈은 기본 열린 값에서 닫힌 값까지 움직인다. 최대값이 1보다 큰 리깅도 과하게 뜨지 않음.
      if (key === 'eyeL' || key === 'eyeR') {
        const p = metadata[param];
        write(param, p.min + (p.default - p.min) * this.current[key]);
      } else write(param, mode === 'unit' ? unit(param, this.current[key]) : range(param, this.current[key]));
    }
    // 멀고 가까움 상대변화: 기준 = 0; nearer=+1; farther=-1
    if (metadata.depth) {
      const d = metadata.depth;
      const distance = this.current.depth;
      write('depth', d.default + distance * (distance >= 0 ? (d.max - d.default) : (d.default - d.min)));
    }
    if (metadata.ParamBreath) write('ParamBreath', unit('ParamBreath', (1 + Math.sin((now-this.startTime)*Math.PI*2/3600)) * 0.5));
    this.drag?.update(dt);
    const overrides = this.drag?.overrides() ?? {};
    for (const [id, value] of Object.entries(bodyFromHead(this.current, overrides))) {
      if (!metadata[id]) continue;
      const p = metadata[id];
      write(id, p.default + value * (value >= 0 ? p.max - p.default : p.default - p.min));
    }
    this.frameOverrides = overrides;
    // 물리 계산 전에 드래그를 입력으로 전달한다.
    this.applyOverrides();
    return dt;
  }
  applyOverrides() {
    const { write, range, metadata } = this.avatar;
    if (metadata.stage) write('stage', this.drag?.stage ?? metadata.stage.default);
    // 물리 계산 뒤 직접 조작 값만 재적용한다.
    for (const [id, normalized] of Object.entries(this.frameOverrides)) {
      if (metadata[id]) write(id, range(id, normalized));
    }
  }
}
