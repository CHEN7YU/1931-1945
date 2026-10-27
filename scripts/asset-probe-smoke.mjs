import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
  ...(out ? { recordVideo: { dir: out, size: { width: 1440, height: 900 } } } : {}) });
const errors = [], requests = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => requests.push(request.url()));
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const snapshot = () => page.evaluate(() => window.__assetProbe);
async function observe(stage) {
  const data = await snapshot();
  observations.push({ stage, ...data });
  return data;
}
try {
  const url = new URL('/asset-lab.html', process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__assetProbe?.ready || window.__assetProbe?.fatal, null, { timeout: 30000 });
  const initial = await observe('loaded');
  assert.equal(initial.fatal, null);
  assert.equal(initial.character.skinnedMeshes, 1);
  assert.equal(initial.character.bones, 58);
  assert.ok(Math.abs(initial.character.weaponReferenceLength - 1.11) < 1e-5);
  if (out) await page.screenshot({ path: join(out, 'character-idle.png') });
  await page.locator('#toggle').click();
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__assetProbe.movement.speed > 1 && window.__assetProbe.character.active === 'run');
  const moving = await observe('actual-movement');
  assert.ok(moving.position[2] < initial.position[2]);
  assert.ok(Math.abs(moving.character.weaponReferenceLength - 1.11) < 1e-5);
  await page.waitForTimeout(350);
  if (out) await page.screenshot({ path: join(out, 'character-running.png') });
  await page.waitForFunction(() => window.__assetProbe.position[2] < -2.3 && window.__assetProbe.movement.speed < .01, null, { timeout: 10000 });
  const blocked = await observe('wall-contact');
  assert.ok(blocked.position[2] >= blocked.wall.maxZ + .4 - 1e-5, 'normal collision prevents walking through the actual wall');
  assert.equal(blocked.character.active, 'idle', 'held input cannot keep a blocked character running in place');
  await page.waitForTimeout(250);
  assert.ok(Math.abs((await snapshot()).position[2] - blocked.position[2]) < .01);
  await page.keyboard.up('w');
  await page.locator('#toggle').click();
  const paused = await observe('paused');
  await page.waitForTimeout(200);
  const frozen = await snapshot();
  assert.deepEqual(frozen.position, paused.position);
  assert.equal(frozen.character.mixerTime, paused.character.mixerTime);
  await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => Number.isFinite(audio.duration) && audio.duration > 0));
  const audio = await page.locator('audio').evaluateAll(elements => elements.map(element => ({ src: element.currentSrc, duration: element.duration })));
  observations.push({ stage: 'decoded-footstep-candidates', audio });
  assert.equal(audio.length, 3);
  await page.locator('audio').first().evaluate(element => element.play());
  await page.waitForTimeout(100);
  await page.locator('audio').first().evaluate(element => element.pause());
  assert.ok(requests.every(request => request.startsWith(url.origin) || request.startsWith('data:') || request.startsWith('blob:')));
  assert.deepEqual(errors, []);
  await page.locator('#reset').click();
  assert.deepEqual((await snapshot()).position, [0, 0, 4]);

  const missing = await browser.newPage();
  await missing.route('**/characters/kenney-survivor/run.fbx', route => route.fulfill({ status: 404, body: 'Intentional missing-asset check' }));
  await missing.goto(url.href);
  await missing.waitForFunction(() => Boolean(window.__assetProbe?.fatal));
  assert.equal(await missing.locator('#error').isVisible(), true);
  assert.equal(await missing.locator('#toggle').isDisabled(), true);
  assert.equal(await missing.evaluate(() => window.__assetProbe.ready), false);
  await missing.close();
  console.log('PASS: real skinning/animation, normal movement/wall stop, metre-sized hand attachment, pause, decoded local audio and explicit load failure. Combat poses remain missing.');
} finally {
  try {
    if (out) await writeFile(join(out, 'asset-probe-observations.json'), JSON.stringify({ observations, requests, errors }, null, 2));
    const video = page.video();
    await page.close();
    if (out && video) await video.saveAs(join(out, 'asset-pipeline.webm'));
  } finally { await browser.close(); }
}
