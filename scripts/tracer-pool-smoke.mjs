import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173', directory = process.env.ARTIFACT_DIR;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/__tracer-pool-check', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><link rel="icon" href="data:,"><body></body>' }));
  await page.goto(new URL('/__tracer-pool-check', base).href);
  const visual = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createTracerPool } = await import('/src/tracer-pool.js');
    const { createTracerPool: legacyPool } = await import('/scripts/fixtures/tracer-pool-legacy.js');
    const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(96, 96); document.body.append(renderer.domElement);
    const camera = new T.OrthographicCamera(-2, 2, 2, -2, .1, 10);
    camera.position.z = 3;
    const pools = [createTracerPool(2), legacyPool()], samples = [], images = [];
    for (const [phase, x, color, opacity] of [
      ['outside', 100, 0xff0000, .8], ['returned', 0, 0xff9933, .8],
      ['faded-recolored', 0, 0x3399ff, .2], ['outside-again', -100, 0x33ff99, .8],
    ]) {
      const captures = [], calls = [];
      for (const pool of pools) {
        const scene = new T.Scene();
        const lines = [
          pool.acquire(new T.Vector3(x - .8, -.8, 0), new T.Vector3(x + .8, .8, 0), color),
          pool.acquire(new T.Vector3(x - .8, .8, 0), new T.Vector3(x + .8, -.8, 0), 0xeeeeee),
        ];
        lines[0].material.opacity = opacity;
        lines[1].material.opacity = .6;
        scene.add(...lines); renderer.render(scene, camera);
        calls.push(renderer.info.render.calls);
        captures.push(renderer.domElement.toDataURL());
        for (const line of lines) { scene.remove(line); pool.release(line); }
      }
      samples.push({ phase, samePixels: captures[0] === captures[1], calls });
      images.push({ phase, data: captures[0].split(',')[1] });
    }
    const reuse = pools[0].snapshot;
    for (const pool of pools) pool.reset();
    renderer.dispose();
    return { samples, images, reuse };
  });
  assert.ok(visual.samples.every(sample => sample.samePixels), 'pooled and former GPU images must match');
  assert.deepEqual(visual.samples.map(sample => sample.calls), [[0, 0], [2, 2], [2, 2], [0, 0]]);
  assert.equal(visual.reuse.created, 2);
  assert.equal(visual.reuse.reused, 6);

  const url = new URL(base);
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#deploy').click();
  const initial = await page.evaluate(() => window.__battle.population);
  assert.equal(initial.friendly.alive, 110); assert.equal(initial.enemy.alive, 96);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__battle.position.z <= 42 || window.__battle.state === 'dead',
      null, { timeout: 60000 });
  } finally { await page.keyboard.up('w'); }
  await page.waitForFunction(() => window.__battle.tracers.reused >= 3 && window.__battle.combatStats.aiRifleShots >= 5,
    null, { timeout: 90000 });
  const fighting = await page.evaluate(() => ({ tracers: window.__battle.tracers, shots: window.__battle.combatStats.aiRifleShots }));
  assert.ok(fighting.tracers.retained <= 64 && fighting.tracers.disposed === 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const paused = await page.evaluate(() => ({ time: window.__battle.time, tracers: window.__battle.tracers }));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ time: window.__battle.time, tracers: window.__battle.tracers })), paused);
  await page.locator('#back-menu').click();
  await page.waitForFunction(() => window.__battle.state === 'menu');
  const cleared = await page.evaluate(() => window.__battle.tracers);
  assert.deepEqual(cleared, { capacity: 64, active: 0, retained: 0, idle: 0, created: 0, reused: 0, disposed: 0 });
  await page.locator('#deploy').click();
  const restarted = await page.evaluate(() => ({ population: window.__battle.population, tracers: window.__battle.tracers }));
  assert.equal(restarted.population.friendly.alive, 110); assert.equal(restarted.population.enemy.alive, 96);
  assert.equal(restarted.tracers.active, 0);
  assert.deepEqual(errors, []);
  if (directory) {
    await mkdir(directory, { recursive: true });
    for (const image of visual.images) await writeFile(join(directory, `${image.phase}.png`), Buffer.from(image.data, 'base64'));
    await writeFile(join(directory, 'tracer-pool-check.json'),
      JSON.stringify({ visual: visual.samples, reuse: visual.reuse, fighting, paused, cleared, restarted }, null, 2));
  }
  console.log('PASS: identical pooled/legacy GPU pixels, culling on reuse, independent fading; full 110/96 combat reuse, pause and restart cleanup.');
} finally {
  await browser.close();
}
