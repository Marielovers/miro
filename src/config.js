// 화면에는 Live2D 캔버스만 보인다. 카메라 비디오는 DOM에 삽입하지 않는다.
const BASE = import.meta.env?.BASE_URL ?? '/';
export const MODEL_URL = `${BASE}live2d/avatar/avatar.model3.json`;
export const LOCAL_CORE_URL = `${BASE}vendor/live2dcubismcore-v6.min.js`;
export const REMOTE_CORE_URL = 'https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js';
export const LOCAL_FACE_MODEL = `${BASE}mediapipe/face_landmarker.task`;
export const REMOTE_FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const VISION_WASM = `${BASE}mediapipe/wasm`;
export const CAMERA = { width: 640, height: 480, maxFps: 24 };
// 이 설정은 모델의 실제 리깅을 바꾸는 게 아니라 화면 밖으로 아랫부분을 밀어내는 크롭이다.
export const FRAMING = {
  // 모델 캔버스 높이를 화면 높이의 1.37배로 확대
  heightFactor: 1.37,
  // 모델 중심을 화면 높이의 69%에 위치 -> 아랫부분은 화면 아래로 잘린다.
  centerY: 0.69,
  centerX: 0.50,
  minWidthFactor: 0.65
};
export const SENSITIVITY = {
  // 몸 회전 범위 대비 머리 회전의 비율 (0~1).
  bodyFollowX: 0.85,
  bodyFollowY: 0.80,
  bodyFollowZ: 0.85,
  // 눈/입 표정의 증폭과 반응 시간(초, 작을수록 빠름).
  blinkGain: 2.6,
  blinkDeadzone: 0.035,
  blinkCloseResponse: 0.012,
  blinkOpenResponse: 0.028,
  mouthOpenGain: 3.2,
  mouthOpenDeadzone: 0.025,
  mouthFormGain: 2.2,
  mouthResponse: 0.025,
  dragDistance: 260,
  headZ: 0.92,
  headY: 0.94,
  customX: 1.22,
  customY: 1.20,
  ribbonToStage1: 118,
  ribbonHoldToStage2Seconds: 0.5, // 손을 놓은 뒤 1 → 2까지 걸리는 시간(초)
  springStiffness: 32,
  springDamping: 4.6,
  springStopDistance: 0.0025,
  springStopVelocity: 0.02,
  // 얼굴 너비가 최초 기준 대비 ±60% 변하면 depth가 크게 변한다.
  depthGain: 1.4,
  headYaw: 1.25,
  headPitch: 1.35,
  headRoll: 1.0
};

// Cubism physics3.json이 없을 때만 사용하는 대체 관성/스프링 설정.
export const PHYSICS = {
  enabled: true,
  stiffness: 48,
  damping: 5.8,
  hairGain: 1.3,
  bodyGain: 0.65,
  restFollow: 0.18,
  direction: {} // 특정 파라미터를 반전하려면 예: {fronthairX1: -1}
};
