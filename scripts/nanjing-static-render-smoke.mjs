import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.ARTIFACT_DIR) throw new Error('Set ARTIFACT_DIR to preserve paired render evidence');
await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.BENCH_HEADLESS !== '0' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch(), text = await response.text();
    assert.ok(text.includes('requestAnimationFrame(tick)'));
    await route.fulfill({ response, body: text.replaceAll('requestAnimationFrame(tick)',
      'window.__staticReviewFrame = requestAnimationFrame(tick)') + `
      window.staticRenderReview = {
        freeze() {
          cancelAnimationFrame(window.__staticReviewFrame);
          setGameState('pause');
          const sources = world.solids.filter(object => object.userData.staticResidential);
          const batches = scene.children.filter(object => object.userData.staticSceneBatch);
          if (!sources.length || !batches.length) throw Error('Static residential batches are missing');
          this.sources = sources; this.batches = batches;
          return { ...world.staticRendering, quality: graphics.snapshot.preset, time, build: buildStamp };
        },
        mode(batched) {
          for (const source of this.sources) {
            if (batched) source.removeFromParent(); else scene.add(source);
          }
          for (const batch of this.batches) batch.visible = batched;
          scene.updateMatrixWorld(true);
        },
        async view(position, target) {
          camera.position.fromArray(position); camera.lookAt(...target);
          camera.fov = 72; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
          const gl = renderer.getContext(), width = renderer.domElement.width, height = renderer.domElement.height;
          const image = batched => {
            this.mode(batched); renderer.render(scene, camera);
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return { pixels, png: renderer.domElement.toDataURL('image/png') };
          };
          for (const mode of [false, true]) {
            this.mode(mode);
            for (let frame = 0; frame < 8; frame++) renderer.render(scene, camera);
          }
          const before = image(false), after = image(true);
          let changed = 0, notable = 0, absolute = 0, maximum = 0;
          for (let pixel = 0; pixel < width * height; pixel++) {
            let difference = 0;
            for (let channel = 0; channel < 3; channel++) {
              const delta = Math.abs(before.pixels[pixel * 4 + channel] - after.pixels[pixel * 4 + channel]);
              absolute += delta; difference = Math.max(difference, delta);
            }
            if (difference) changed++;
            if (difference > 4) notable++;
            maximum = Math.max(maximum, difference);
          }
          const blocks = [];
          for (const mode of [false, true, true, false]) {
            this.mode(mode);
            const samples = [];
            for (let frame = 0; frame < 42; frame++) {
              await new Promise(requestAnimationFrame);
              const began = performance.now(); renderer.render(scene, camera);
              const milliseconds = performance.now() - began;
              if (frame >= 12) samples.push(milliseconds);
            }
            const sorted = [...samples].sort((a,b) => a-b);
            blocks.push({ batched: mode, samples, medianMs: sorted[Math.floor(sorted.length / 2)],
              p95Ms: sorted[Math.ceil(sorted.length * .95)-1],
              drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
          }
          return { before: before.png, after: after.png, blocks,
            pixels: { width, height, changed, notable, maximum, meanChannelDifference: absolute / (width * height * 3) } };
        }
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL ?? 'http://127.0.0.1:5203'}/?campaign=nanjing`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await page.locator('#menu-quality').selectOption('low');
  await page.evaluate(() => document.getElementById('deploy').click());
  await page.waitForFunction(() => window.__battle?.time >= 1, null, { timeout: 60000 });
  const setup = await page.evaluate(() => staticRenderReview.freeze());
  const views = [
    { name: 'gate', position: [0, 12, 38], target: [0, 4, 0] },
    { name: 'city', position: [20, 25, -40], target: [-25, 3, -50] },
    { name: 'dock', position: [-50, 8, -66], target: [-66, 1, -80] },
    { name: 'street', position: [4, 1.7, -45], target: [4, 3, -80] },
  ];
  const results = [];
  for (const view of views) {
    const result = await page.evaluate(async ({ position, target }) =>
      staticRenderReview.view(position, target), view);
    for (const kind of ['before', 'after']) {
      await writeFile(join(process.env.ARTIFACT_DIR, `${view.name}-${kind}.png`),
        Buffer.from(result[kind].split(',')[1], 'base64'));
      delete result[kind];
    }
    results.push({ ...view, ...result });
    console.log(JSON.stringify({ view: view.name, pixels: result.pixels,
      blocks: result.blocks.map(({ samples, ...rest }) => rest) }));
  }
  await writeFile(join(process.env.ARTIFACT_DIR, 'render-comparison.json'), JSON.stringify({
    setup, results, errors,
    limitation: 'Same frozen real game scene, low quality, ABBA CPU render calls. Not an active-match FPS or GPU-time result.',
  }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(results.every(result => result.pixels.notable / (result.pixels.width * result.pixels.height) < .002));
  assert.ok(results.every(result => result.pixels.meanChannelDifference < .3));
  assert.ok(results.some(result => result.blocks[1].drawCalls < result.blocks[0].drawCalls / 2));
} finally {
  await browser.close();
}
