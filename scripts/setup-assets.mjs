import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const wasmSource = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDestination = path.join(pub,'mediapipe/wasm');
await mkdir(wasmDestination,{recursive:true});
try {
  for (const entry of await readdir(wasmSource)) {
    if (!/\.(?:js|wasm|data)$/.test(entry)) continue;
    await copyFile(path.join(wasmSource,entry),path.join(wasmDestination,entry));
  }
  console.log('[setup] MediaPipe WASM files copied');
} catch(e) { console.warn('[setup] WASM local copy failed:', e.message); }

async function downloadIfMissing(destination,url) {
  try { await access(destination); return; } catch { /* continue */ }
  await mkdir(path.dirname(destination),{recursive:true});
  for (let retry=1;retry<=2;retry++) {
    try {
      const response = await fetch(url,{signal:AbortSignal.timeout(14000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 5000) throw new Error('Unexpected small download');
      await writeFile(destination,bytes);
      console.log('[setup] downloaded',path.relative(root,destination),Math.round(bytes.length/1024),'KB');
      return;
    } catch(e) { console.warn(`[setup] Attempt ${retry} failed: ${e.message}`); }
  }
  console.warn(`[setup] Could not download ${path.basename(destination)}. See README.md for manual setup.`);
}
await downloadIfMissing(path.join(pub,'mediapipe/face_landmarker.task'), 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task');
await downloadIfMissing(path.join(pub,'vendor/live2dcubismcore-v6.min.js'), 'https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js');
