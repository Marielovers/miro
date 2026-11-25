import { CAMERA, LOCAL_FACE_MODEL, REMOTE_FACE_MODEL, VISION_WASM, SENSITIVITY } from './config.js';
import { clamp, scoreMap } from './utils.js';

const deg = x => x * 180 / Math.PI;

export function extractFace(result) {
  const landmark = result.faceLandmarks?.[0];
  if (!landmark || landmark.length < 455) return null;
  const s = scoreMap(result.faceBlendshapes?.[0]);
  const eyeL = landmark[33], eyeR = landmark[263], nose = landmark[1];
  const eyeMiddle = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
  const eyeDistance = Math.max(0.001, Math.hypot(eyeL.x-eyeR.x, eyeL.y-eyeR.y));
  // 비디오의 미러링이 아닌 실제 카메라 좌표이며 표정 계수의 좌우도 사용자 기준.
  const rollLandmark = deg(Math.atan2(eyeR.y-eyeL.y, eyeR.x-eyeL.x));
  let yaw = clamp((nose.x - eyeMiddle.x) / eyeDistance * 68, -35, 35);
  let pitch = clamp((((nose.y-eyeMiddle.y) / eyeDistance) - 0.53) * 55, -30, 30);
  let roll = clamp(rollLandmark, -35, 35);
  const mat = result.facialTransformationMatrixes?.[0]?.data;
  if (mat && mat.length === 16 && mat.every(Number.isFinite)) {
    // 4x4 column-major; Matrix가 불안정할 때는 랜드마크 계산값 사용.
    const myaw = deg(Math.atan2(mat[8], mat[10]));
    const mpitch = deg(Math.atan2(-mat[9], Math.hypot(mat[8], mat[10])));
    const mroll = deg(Math.atan2(mat[1], mat[0]));
    if (Math.abs(myaw) < 65 && Math.abs(mpitch) < 60 && Math.abs(mroll) < 65) {
      yaw = myaw;
      pitch = mpitch;
      roll = mroll;
    }
  }
  // face bounds: 앞뒤 거리의 상대적 대리 지표. 절대적인 cm 거리가 아님.
  const left = Math.min(landmark[234].x, landmark[454].x);
  const right = Math.max(landmark[234].x, landmark[454].x);
  const faceWidth = clamp(right - left, 0.03, 0.95);
  return { yaw, pitch, roll, faceWidth, blend: s, gazeX: (s.eyeLookOutLeft - s.eyeLookInLeft + s.eyeLookInRight - s.eyeLookOutRight)/2,
    gazeY: (s.eyeLookUpLeft + s.eyeLookUpRight - s.eyeLookDownLeft - s.eyeLookDownRight) / 2 };
}

export class FaceTracking {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.video = null;
    this.stream = null;
    this.detector = null;
    this.loopId = 0;
    this.started = false;
    this.lastInference = 0;
    this.lastVideoTime = -1;
    this.lastSeen = 0;
    this.raw = null;
    this.baseline = null;
    this.samples = [];
    this.starting = false;
  }
  async start() {
    if (this.started || this.starting) return;
    this.starting = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서는 HTTPS 또는 localhost가 필요합니다.');
      if (!this.detector) {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
        const options = { baseOptions: { modelAssetPath: LOCAL_FACE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true };
        try { this.detector = await FaceLandmarker.createFromOptions(vision, options); }
        catch (e) {
          console.warn('[MediaPipe] Local model or GPU failed. Trying CPU/remote model.', e);
          // GPU 문제가 난다면 CPU를 사용. 모델이 없는 경우 공식 원본 주소로 재시도.
          try { this.detector = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: LOCAL_FACE_MODEL, delegate: 'CPU' } }); }
          catch { this.detector = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: REMOTE_FACE_MODEL, delegate: 'CPU' } }); }
        }
      }
      // 실제 영상은 HTML에 추가하지 않는다. 웹페이지에는 아바타만 보인다.
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: {
        facingMode: 'user', width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, frameRate: { ideal: CAMERA.maxFps, max: 30 }
      }, audio: false });
      video.srcObject = this.stream;
      this.video = video;
      await video.play();
      this.started = true;
      this.starting = false;
      this.onStatus?.('active');
      this.tick = this.tick.bind(this);
      this.loopId = requestAnimationFrame(this.tick);
    } catch (error) {
      this.starting = false;
      this.stop();
      this.onStatus?.('error', error);
      throw error;
    }
  }
  tick(now) {
    if (!this.started) return;
    this.loopId = requestAnimationFrame(this.tick);
    if (document.hidden || now - this.lastInference < 1000 / CAMERA.maxFps || !this.video || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    this.lastInference = now;
    try {
      const result = this.detector.detectForVideo(this.video, now);
      const face = extractFace(result);
      if (!face) { this.raw = null; return; }
      this.lastSeen = now;
      this.raw = face;
      if (!this.baseline) this.samples.push(face);
      if (this.samples.length >= 12) {
        const average = key => this.samples.reduce((acc, item) => acc + item[key], 0) / this.samples.length;
        this.baseline = { yaw: average('yaw'), pitch: average('pitch'), roll: average('roll'), faceWidth: average('faceWidth') };
        this.samples.length = 0;
      }
    } catch (e) { console.warn('[FaceTracker] 프레임 분석 실패', e); }
  }
  calibrate() { this.baseline = null; this.samples.length = 0; }
  stop() {
    cancelAnimationFrame(this.loopId);
    this.started = false;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null;
    this.raw = null;
  }
}

export function faceToControls(face, baseline) {
  if (!face || !baseline) return {};
  const b = face.blend;
  const g = (key) => b[key] || 0;
  const depthRatio = face.faceWidth / Math.max(0.03, baseline.faceWidth);
  return {
    angleX: clamp(-(face.yaw - baseline.yaw) / 30 * 1.25, -1, 1),
    angleY: clamp(-(face.pitch - baseline.pitch) / 25 * 1.35, -1, 1),
    angleZ: clamp((face.roll - baseline.roll) / 30, -1, 1),
    depth: clamp((depthRatio - 1) * 1.4, -1, 1),
    eyeL: clamp(1 - Math.max(0, g('eyeBlinkLeft') - SENSITIVITY.blinkDeadzone) * SENSITIVITY.blinkGain, 0, 1),
    eyeR: clamp(1 - Math.max(0, g('eyeBlinkRight') - SENSITIVITY.blinkDeadzone) * SENSITIVITY.blinkGain, 0, 1),
    eyeSmileL: clamp(g('cheekSquintLeft') * 0.6 + g('mouthSmileLeft') * 0.55, 0, 1),
    eyeSmileR: clamp(g('cheekSquintRight') * 0.6 + g('mouthSmileRight') * 0.55, 0, 1),
    gazeX: clamp(-face.gazeX * 2.4, -1, 1),
    gazeY: clamp(face.gazeY * 2.3, -1, 1),
    browLY: clamp(g('browOuterUpLeft') * 1.4 + g('browInnerUp') * 0.65 - g('browDownLeft') * 1.5, -1, 1),
    browRY: clamp(g('browOuterUpRight') * 1.4 + g('browInnerUp') * 0.65 - g('browDownRight') * 1.5, -1, 1),
    browLAngle: clamp(g('browOuterUpLeft') - g('browDownLeft'), -1, 1),
    browRAngle: clamp(g('browOuterUpRight') - g('browDownRight'), -1, 1),
    browLForm: clamp(g('browDownLeft') - g('browOuterUpLeft'), -1, 1),
    browRForm: clamp(g('browDownRight') - g('browOuterUpRight'), -1, 1),
    mouthOpen: clamp(Math.max(0, g('jawOpen') - SENSITIVITY.mouthOpenDeadzone) * SENSITIVITY.mouthOpenGain, 0, 1),
    mouthForm: clamp(((g('mouthSmileLeft') + g('mouthSmileRight')) * 0.75 - (g('mouthFrownLeft') + g('mouthFrownRight')) * 0.85 - g('mouthPucker') * 0.4) * SENSITIVITY.mouthFormGain, -1, 1),
  };
}
