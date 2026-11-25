import * as PIXI from 'pixi.js';
import { FRAMING, LOCAL_CORE_URL, MODEL_URL, REMOTE_CORE_URL } from './config.js';

function injectScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Cubism Core 로딩 실패: ${url}`));
    document.head.append(script);
  });
}

async function loadCore() {
  if (window.Live2DCubismCore) return;
  // Vite는 존재하지 않는 파일을 index.html로 대신 응답하기도 하므로 content-type 확인.
  let hasLocal = false;
  try {
    const r = await fetch(LOCAL_CORE_URL, { method: 'HEAD', cache: 'no-store' });
    const type = r.headers.get('content-type') ?? '';
    hasLocal = r.ok && /javascript|ecmascript|text\/plain/i.test(type);
  } catch { /* 공식 주소로 fallback */ }
  if (hasLocal) {
    try { await injectScript(LOCAL_CORE_URL); } catch { /* 공식 주소로 fallback */ }
  }
  if (!window.Live2DCubismCore) await injectScript(REMOTE_CORE_URL);
  if (!window.Live2DCubismCore) throw new Error('Cubism Core를 불러오지 못했습니다. npm run setup으로 다시 설치하세요.');
}

export async function createAvatar(canvas) {
  await loadCore();
  console.info('[Live2D] Cubism Core loaded:', LOCAL_CORE_URL, window.Live2DCubismCore.Version);
  const engine = await import('@laplace.live/pixijs-live2d');
  const { Live2DModel, Live2DPlugin, Live2DFactory } = engine;
  if (Live2DPlugin) PIXI.extensions.add(Live2DPlugin);
  Live2DModel.registerTicker(PIXI.Ticker);
  const app = new PIXI.Application();
  await app.init({
    canvas,
    preference: 'webgl',
    preferWebGLVersion: 2,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: 'high-performance',
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  });

  console.info('[Live2D] WebGL renderer ready; loading model:', MODEL_URL);
  const model = await Live2DModel.from(MODEL_URL, { autoInteract: false, autoUpdate: true });
  console.info('[Live2D] Model assets loaded');
  model.anchor.set(0.5, 0.5);
  app.stage.addChild(model);
  const internal = model.internalModel;
  // 웹캠 추적이 눈/고개 각도를 직접 제어하므로 자동 시선·숨쉬기의 상호 덮어쓰기 방지.
  internal.eyeBlink = undefined;
  internal.breath = undefined;
  // Do not silently fall back to approximate springs when the native asset
  // is declared but the library failed to load it.
  if (internal.settings?.physics && !internal.physics) {
    const physicsUrl = internal.settings.resolveURL(internal.settings.physics);
    const response = await fetch(physicsUrl, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Physics load failed: HTTP ${response.status}`);
    const runtime = Live2DFactory.findRuntime(internal.settings);
    internal.physics = runtime.createPhysics(internal.coreModel, await response.arrayBuffer());
  }
  if (internal.settings?.physics && typeof internal.physics?.evaluate !== 'function') {
    throw new Error('Cubism physics initialization failed.');
  }
  console.info('[Live2D] native physics groups:', internal.physics?._physicsRig?.subRigCount ?? 0);

  const getBounds = () => {
    const rect = canvas.getBoundingClientRect();
    return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  };
  function layout() {
    const { width, height } = getBounds();
    app.renderer.resolution = Math.min(window.devicePixelRatio || 1, 2);
    app.renderer.resize(width, height);
    // 모바일 세로 화면에서도 아랫부분이 드러나지 않도록 늘 항상 아래로 오버스캔.
    const baseScale = height * FRAMING.heightFactor / Math.max(1, internal.height);
    const requiredWidthScale = width * FRAMING.minWidthFactor / Math.max(1, internal.width);
    const scale = Math.max(baseScale, requiredWidthScale);
    model.scale.set(scale);
    model.position.set(width * FRAMING.centerX, height * FRAMING.centerY);
  }
  layout();
  window.addEventListener('resize', layout, { passive: true });
  window.visualViewport?.addEventListener('resize', layout, { passive: true });

  const coreModel = internal.coreModel;
  const raw = coreModel.getModel?.() ?? coreModel._model ?? coreModel;
  const params = raw?.parameters;
  if (!params?.values || !params?.ids) throw new Error('MOC3 파라미터를 조회할 수 없습니다.');

  const ids = Array.from(params.ids, (id) => String(id));
  const index = new Map(ids.map((id, i) => [id, i]));
  const metadata = Object.fromEntries(ids.map((id,i) => [id, {
    min: params.minimumValues[i], max: params.maximumValues[i], default: params.defaultValues[i], index: i
  }]));
  const has = id => index.has(id);
  const read = id => has(id) ? params.values[index.get(id)] : undefined;
  const write = (id, value) => {
    if (!has(id) || !Number.isFinite(value)) return;
    const p = metadata[id];
    params.values[p.index] = Math.min(p.max, Math.max(p.min, value));
  };
  const range = (id, normalized) => {
    const p = metadata[id];
    return p ? p.min + (p.max - p.min) * Math.min(1, Math.max(0, (normalized + 1) / 2)) : 0;
  };
  const unit = (id, normalized) => {
    const p = metadata[id];
    return p ? p.min + (p.max - p.min) * Math.min(1, Math.max(0, normalized)) : 0;
  };
  const toNormalized = (id, value) => {
    const p = metadata[id];
    return p && p.max !== p.min ? (2 * (value - p.min) / (p.max - p.min) - 1) : 0;
  };
  console.info('[Live2D] parameter IDs:', ids);
  console.info('[Live2D] valid HitAreas:', Object.values(internal.hitAreas ?? {}));
  // 첫 프레임 렌더링이 실패해도 카메라 오류와 구분되도록 즉시 검사.
  app.renderer.render({ container: app.stage });
  console.info('[Live2D] First frame rendered');
  return { app, model, internal, coreModel, metadata, has, read, write, range, unit, toNormalized, getBounds, layout };
}
