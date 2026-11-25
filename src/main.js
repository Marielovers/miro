import './style.css';
import { createAvatar } from './live2d.js';
import { FaceTracking } from './tracking.js';
import { AvatarController } from './controller.js';
import { DragInteraction } from './drag.js';
import { GameAudio } from './audio.js';

const canvas = document.getElementById('live2d');
const button = document.getElementById('enable-camera');
const toast = document.getElementById('toast');
const titleScreen = document.getElementById('title-screen');
const startButton = document.getElementById('start-game');
const startStatus = document.getElementById('start-status');
let toastTimer;
function notify(message, ms=3300) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => toast.classList.remove('visible'), ms);
}
function friendlyError(error) {
  if (error?.name === 'NotAllowedError') return '카메라 권한이 거부되었습니다. 브라우저 권한을 확인해주세요.';
  if (error?.name === 'NotFoundError') return '사용 가능한 카메라를 찾을 수 없습니다.';
  return `카메라 연결 실패: ${error?.message ?? error}`;
}

async function main() {
  let avatar;
  try { avatar = await createAvatar(canvas); }
  catch(e) { console.error(e); startStatus.textContent = `모델 로드 실패: ${e?.message ?? e}`; startButton.textContent = '로딩 실패'; notify(`모델 로드 실패: ${e?.message ?? e} (F12 → Console 확인)`, 0); return; }
  const tracking = new FaceTracking(state => {
    if (state === 'active') button.hidden = true;
  });
  const controller = new AvatarController(avatar, tracking);
  const audio = new GameAudio();
  let started = false;
  const drag = new DragInteraction(canvas, avatar, id => controller.cameraNormalized(id), hit => audio.playHitArea(hit));
  controller.bindDrag(drag);
  // Console-only diagnostic; no debug panel or webcam preview on the page.
  window.miroDebug = () => ({
    version: 'physics-stage-r2', mode: controller.physicsMode,
    groups: avatar.internal.physics?._physicsRig?.subRigCount ?? 0,
    stage: drag.stage, rising: !!drag.ribbonAutoRise, locked: drag.ribbonLockedTo2,
    stageRange: avatar.metadata.stage, lastFrame: controller.lastFrame
  });
  console.info('[Miro] physics-stage-r2 — inspect with miroDebug()');

  async function enableCamera() {
    if (!started) return;
    button.hidden = true;
    try { await tracking.start(); }
    catch(error) { console.warn(error); button.hidden = false; notify(friendlyError(error), 8500); }
  }
  button.addEventListener('click', enableCamera);
  window.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'r') tracking.calibrate();
    if (event.key.toLowerCase() === 'c' && !tracking.started) enableCamera();
  });
  window.addEventListener('pagehide', () => { tracking.stop(); audio.stop(); });
  startButton.disabled = false;
  startButton.textContent = '시작';
  startStatus.textContent = '시작을 누르면 카메라 권한을 요청합니다.';
  startButton.addEventListener('click', () => {
    if (started) return;
    started = true;
    audio.start(); // 사용자 클릭 이벤트 내부에서 재생해 모바일 자동재생 제한에 대응
    titleScreen.hidden = true;
    enableCamera();
  });
}
window.addEventListener('error', event => {
  console.error('[Runtime]', event.error ?? event.message);
  notify(`실행 오류: ${event.message} (F12 → Console 확인)`, 0);
});
window.addEventListener('unhandledrejection', event => {
  console.error('[Runtime]', event.reason);
  notify(`실행 오류: ${event.reason?.message ?? event.reason} (F12 → Console 확인)`, 0);
});
main().catch(error => { console.error(error); notify(`초기화 오류: ${error?.message ?? error}`, 0); });
