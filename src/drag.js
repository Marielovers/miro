import { SENSITIVITY } from './config.js';
import { clamp } from './utils.js';

// 요청된 HitArea 이름 순서. 'HitArea'는 전신의 일반 영역일 수 있으므로 마지막.
export const HIT_PRIORITY = ['HitAreariibbon', 'HitAreahead', 'HitArearight', 'HitArealeft', 'HitArea'];
export function chooseHitArea(hitNames, definitions) {
  const matched = new Set(hitNames.map(String));
  return HIT_PRIORITY.find(id => {
    const name = definitions.find(d => d.id === id)?.name;
    return name && matched.has(name);
  }) ?? null;
}
export function dragParamIds(hit) {
  switch (hit) {
    case 'HitAreahead': return ['ParamAngleZ', 'ParamAngleY'];
    case 'HitArea': return ['HX', 'HY'];
    case 'HitArearight': return ['BRX', 'BRY'];
    case 'HitArealeft': return ['BLX', 'BLY'];
    default: return [];
  }
}
export function ribbonStage(stageOnDown, downwardPx, autoRiseSeconds = 0, lockedToTwo = false) {
  if (lockedToTwo || stageOnDown >= 2) return 2;
  const pulled = clamp(downwardPx / SENSITIVITY.ribbonToStage1, 0, 1);
  const stage1 = Math.max(Math.min(stageOnDown, 1), pulled);
  if (stage1 < 1) return clamp(stage1, 0, 1);
  return clamp(1 + Math.max(0, autoRiseSeconds) / SENSITIVITY.ribbonHoldToStage2Seconds, 0, 2);
}

export class DragInteraction {
  constructor(canvas, avatar, getCameraTarget, onGrab = null) {
    this.canvas = canvas;
    this.avatar = avatar;
    this.getCameraTarget = getCameraTarget;
    this.onGrab = onGrab;
    this.values = new Map();
    this.pointer = null;
    this.stage = avatar.metadata.stage?.default ?? avatar.read('stage') ?? 0;
    this.ribbonLockedTo2 = this.stage >= 2;
    this.ribbonAutoRise = null;
    this.releases = new Map();
    this.attach();
  }
  attach() {
    this.canvas.addEventListener('pointerdown', event => this.onDown(event));
    this.canvas.addEventListener('pointermove', event => this.onMove(event));
    this.canvas.addEventListener('pointerup', event => this.onUp(event));
    this.canvas.addEventListener('pointercancel', event => this.onUp(event));
    this.canvas.addEventListener('lostpointercapture', event => this.onUp(event));
    // 캔버스 바깥에서 놓아도 동일한 해제 경로를 사용한다.
    window.addEventListener('pointerup', event => this.onUp(event), true);
    window.addEventListener('pointercancel', event => this.onUp(event), true);
    window.addEventListener('blur', () => {
      if (this.pointer) this.onUp({ pointerId: this.pointer.id });
    });
  }
  toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * this.avatar.app.screen.width / rect.width,
      y: (event.clientY - rect.top) * this.avatar.app.screen.height / rect.height };
  }
  getReleaseTarget(id) {
    if (id === 'ParamAngleZ' || id === 'ParamAngleY') return this.getCameraTarget(id);
    const p = this.avatar.metadata[id];
    return p ? this.avatar.toNormalized(id, p.default) : 0;
  }
  startSpring(id, value) {
    this.releases.set(id, {
      value,
      velocity: 0,
      target: this.getReleaseTarget(id)
    });
  }
  onDown(e) {
    if (this.pointer || (e.button !== 0 && e.pointerType === 'mouse')) return;
    const p = this.toWorld(e);
    const hitNames = this.avatar.model.hitTest(p.x, p.y);
    const defs = Object.values(this.avatar.internal.hitAreas);
    const hit = chooseHitArea(hitNames, defs);
    if (!hit) return;
    const ids = dragParamIds(hit);
    ids.forEach(id => this.releases.delete(id));
    const captured = ids.map(id => {
      const remembered = this.values.get(id);
      if (remembered !== undefined) return remembered;
      return this.getReleaseTarget(id);
    });
    this.pointer = { id: e.pointerId, hit, x: e.clientX, y: e.clientY,
      initial: captured, distanceY: 0, stageOnDown: this.stage, reachedOne: this.stage >= .98 };
    // 자동 상승 중에는 리본을 다시 잡아도 진행을 중단하지 않는다.
    if (ids.length) ids.forEach((id, i) => this.values.set(id, captured[i]));
    this.canvas.setPointerCapture(e.pointerId);
    this.onGrab?.(hit);
    e.preventDefault();
  }
  onMove(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const scale = SENSITIVITY.dragDistance * clamp(Math.min(window.innerWidth, window.innerHeight) / 650, .65, 1.4);
    if (p.hit === 'HitAreariibbon') {
      if (this.ribbonLockedTo2) {
        this.stage = 2;
      } else if (!this.ribbonAutoRise) {
        this.updateRibbonDrag(p, dy);
      }
    } else {
      const [xid, yid] = dragParamIds(p.hit);
      if (xid && yid) {
        const factorX = p.hit === 'HitAreahead' ? SENSITIVITY.headZ : SENSITIVITY.customX;
        const factorY = p.hit === 'HitAreahead' ? SENSITIVITY.headY : SENSITIVITY.customY;
        this.values.set(xid, clamp(p.initial[0] + dx / scale * factorX, -1, 1));
        this.values.set(yid, clamp(p.initial[1] - dy / scale * factorY, -1, 1));
      }
    }
    e.preventDefault();
  }
  updateRibbonDrag(p, dy) {
    if (this.ribbonAutoRise || this.ribbonLockedTo2) return;
    p.distanceY = Math.max(0, dy);
    const next = ribbonStage(p.stageOnDown, p.distanceY, 0, false);
    if (next >= .98) p.reachedOne = true;
    // Once the pull reaches 1, keep that value until release.
    this.stage = p.reachedOne ? 1 : next;
  }
  update(dt) {
    if (this.ribbonAutoRise && !this.ribbonLockedTo2) {
      const rise = this.ribbonAutoRise;
      rise.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const elapsed = Math.max(rise.elapsed, (performance.now() - rise.startedAt) / 1000);
      this.stage = ribbonStage(1, SENSITIVITY.ribbonToStage1, elapsed, false);
      if (this.stage >= 2) {
        this.stage = 2;
        this.ribbonLockedTo2 = true;
        this.ribbonAutoRise = null;
      }
    }
    for (const [id, spring] of this.releases) {
      spring.target = this.getReleaseTarget(id);
      spring.velocity += (spring.target - spring.value) * SENSITIVITY.springStiffness * dt;
      spring.velocity *= Math.exp(-SENSITIVITY.springDamping * dt);
      spring.value += spring.velocity * dt;
      if (Math.abs(spring.target - spring.value) <= SENSITIVITY.springStopDistance
        && Math.abs(spring.velocity) <= SENSITIVITY.springStopVelocity) {
        this.releases.delete(id);
      }
    }
  }
  onUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    if (p.hit === 'HitAreariibbon') {
      // A quick pull can finish on pointerup without a final pointermove.
      if (e.type === 'pointerup' && Number.isFinite(e.clientY)) this.updateRibbonDrag(p, e.clientY - p.y);
      if (!this.ribbonLockedTo2 && !this.ribbonAutoRise && (p.reachedOne || this.stage >= .98)) {
        this.stage = 1;
        this.ribbonAutoRise = { elapsed: 0, startedAt: performance.now() };
      }
    } else {
      for (const id of dragParamIds(p.hit)) {
        const value = this.values.get(id);
        if (value !== undefined) this.startSpring(id, value);
        this.values.delete(id);
      }
    }
    this.pointer = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }
  overrides() {
    const final = Object.fromEntries(this.values);
    for (const [id, spring] of this.releases) final[id] = spring.value;
    return final;
  }
}
