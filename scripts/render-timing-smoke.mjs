import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installRenderTimingProbe } from './render-timing-probe.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(installRenderTimingProbe, { gpu: true });
  await page.route(/\/src\/main\.js(?:\?|$)/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(128, 128);
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 3;
    const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xdd6633 }));
    scene.add(mesh);
    const original = renderer.render;
    renderer.render(scene, camera);
    const before = renderer.domElement.toDataURL();
    window.__attachRenderTimingProbe(renderer);
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      renderer.render(scene, camera);
    }
    const after = renderer.domElement.toDataURL(), snapshot = window.__renderTimingProbe;
    const glError = renderer.getContext().getError();
    window.__stopRenderTimingProbe();
    const restored = renderer.render === original;
    mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose();
    return { samePixels: before === after, restored, glError, snapshot,
      limitation: 'Functional pixel readback only; do not treat these timings as a performance sample.' };
  });
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: false });
    await writeFile(join(process.env.ARTIFACT_DIR, 'result.json'), JSON.stringify(result, null, 2));
  }
  assert.equal(result.samePixels, true);
  assert.equal(result.restored, true);
  assert.equal(result.glError, 0);
  assert.equal(result.snapshot.totalRenders, 10);
  if (result.snapshot.status === 'ready') assert.ok(result.snapshot.resolved > 0, 'real GPU queries must resolve asynchronously');
  else assert.equal(result.snapshot.status, 'unsupported');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ samePixels: result.samePixels, restored: result.restored,
    status: result.snapshot.status, resolved: result.snapshot.resolved, pending: result.snapshot.pending, glError: result.glError }));
} finally { await browser.close(); }
