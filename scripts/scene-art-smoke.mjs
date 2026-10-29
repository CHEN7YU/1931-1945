import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCENE_ART_MATERIALS } from '../src/scene-art.js';

const baseline = process.env.BASELINE === '1';
const url = process.env.GAME_URL || 'http://127.0.0.1:5183/?benchmark=interior&seed=1938';
const artifacts = process.env.ARTIFACT_DIR;
if (!artifacts) throw new Error('Set ARTIFACT_DIR for the real-game comparison captures.');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], requests = [], assets = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('request', request => requests.push(request.url()));
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  const path = new URL(response.url()).pathname;
  if (response.ok() && path.startsWith('/assets/materials/ai-scene/')) assets.add(path);
});
const snapshot = () => page.evaluate(() => window.__battle);
async function look(yaw, pitch = 0) {
  await page.evaluate(({ yaw, pitch }) => {
    const current = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: -delta / .00132, movementY: -(pitch - current.pitch) / .00132,
    }));
  }, { yaw, pitch });
}
async function walkTo(x, z) {
  await page.keyboard.down('c');
  await page.keyboard.down('w');
  const result = await page.evaluate(({ x, z }) => new Promise(resolve => {
    const deadline = performance.now() + 45000;
    function frame() {
      const state = window.__battle, dx = x - state.position.x, dz = z - state.position.z;
      if (state.state !== 'playing' || performance.now() > deadline || Math.hypot(dx, dz) < .12) {
        document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
        resolve({ state: state.state, position: state.position });
        return;
      }
      const yaw = Math.atan2(-dx, -dz);
      const delta = Math.atan2(Math.sin(yaw - state.look.yaw), Math.cos(yaw - state.look.yaw));
      document.dispatchEvent(new MouseEvent('mousemove', {
        movementX: -delta / .00132, movementY: state.look.pitch / .00132,
      }));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), { x, z });
  await page.keyboard.up('w');
  await page.keyboard.up('c');
  assert.equal(result.state, 'playing');
  assert.ok(Math.hypot(result.position.x - x, result.position.z - z) < .2, `real movement reached ${x}, ${z}`);
}
const frames = [];
async function capture(name, yaw, pitch = 0, hip = false) {
  await look(yaw, pitch);
  if (hip) await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(hip ? 450 : 180);
  const state = await snapshot();
  await page.screenshot({ path: join(artifacts, `${name}.png`) });
  frames.push({ name, position: state.position, look: state.look, drawCalls: state.drawCalls });
  if (hip) await page.mouse.down({ button: 'right' });
}
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  await page.mouse.down({ button: 'right' });
  await walkTo(0, 73);
  await capture('street', .08, -.06);
  await walkTo(0, 66);
  await walkTo(-2.6, 66);
  await capture('wall', Math.PI / 2, -.06);
  await walkTo(-2.6, 64);
  await capture('door', Math.PI / 2, -.12);
  const door = (await snapshot()).doors.find(item => item.id === 'west-0-east-door');
  assert.ok(door);
  if (door.state === 'closed') await page.keyboard.press('f');
  await page.waitForFunction(id => window.__battle.doors.find(item => item.id === id)?.state === 'open',
    door.id, { timeout: 8000 });
  await walkTo(-8.5, 64);
  assert.equal((await snapshot()).town.inside, 'west-0', 'textured door remains a real working portal');
  await walkTo(-10.6, 64);
  await look(Math.PI / 2, -.12);
  await page.waitForTimeout(120);
  if ((await snapshot()).doors.find(item => item.id === 'west-0-west-door')?.state === 'closed') {
    await page.keyboard.press('f');
  }
  await page.waitForFunction(() => window.__battle.doors.find(item => item.id === 'west-0-west-door')?.state === 'open',
    null, { timeout: 8000 });
  await walkTo(-16, 64);
  await walkTo(-16, 61.5);
  await capture('cargo', -.52, -.36);
  await walkTo(-16, 64);
  await walkTo(0, 64);
  await walkTo(0, 58.6);
  await walkTo(-2.6, 58.6);
  await capture('window', Math.PI / 2, -.16);
  await capture('grime', Math.PI / 2, -.36, true);
  await walkTo(0, 58.6);
  await walkTo(0, 74);
  await walkTo(-13, 74);
  await capture('sandbags', 0, -.34);
  const state = await snapshot();
  if (!baseline) {
    assert.equal(assets.size, Object.keys(SCENE_ART_MATERIALS).length * 3 + 1, 'all scene and nature material sets and the grime atlas loaded');
    const dimensions = await page.evaluate(async paths => {
      return Promise.all(paths.map(async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Missing texture: ${path}`);
        const bitmap = await createImageBitmap(await response.blob());
        const result = { path, width: bitmap.width, height: bitmap.height };
        if (path.endsWith('/atlas.webp')) {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0);
          const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
          let edgeAlpha = 0, markedPixels = 0;
          for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
            const alpha = pixels[(y * 1024 + x) * 4 + 3];
            if ([0, 511, 512, 1023].includes(x) || [0, 511, 512, 1023].includes(y)) {
              edgeAlpha = Math.max(edgeAlpha, alpha);
            }
            if (alpha > 10) markedPixels++;
          }
          Object.assign(result, { edgeAlpha, markedPixels });
        }
        bitmap.close();
        return result;
      }));
    }, [...assets]);
    for (const texture of dimensions) {
      const size = /\/(color|atlas)\.webp$/.test(texture.path) ? 1024 : 512;
      assert.equal(texture.width, size, `actual decoded width: ${texture.path}`);
      assert.equal(texture.height, size, `actual decoded height: ${texture.path}`);
      if (texture.path.endsWith('/atlas.webp')) {
        assert.equal(texture.edgeAlpha, 0, 'all four atlas cells have real transparent borders');
        assert.ok(texture.markedPixels > 10000, 'atlas contains visible stains, not a transparent fallback');
      }
    }
    assert.ok(state.sceneArt.wallPieces > 0);
    assert.equal(state.sceneArt.doorLeaves, state.doors.length);
    assert.equal(state.sceneArt.sandbagMaterial, 'burlap');
    assert.ok(state.sceneArt.grimeDecals > 10);
    assert.equal(state.sceneArt.detailedCargo, 3);
    assert.equal(state.sceneArt.detailedSandbags, 12);
    assert.deepEqual(state.town.visibility, { doorOpening: true, wall: false, window: true, sill: false, lintel: false });
    assert.ok(state.drawCalls < 230, `shared scene materials stay batched: ${state.drawCalls}`);
    const failure = await browser.newPage();
    await failure.route('**/assets/materials/ai-scene/weathered-plaster/color.webp',
      route => route.fulfill({ status: 404, body: 'missing AI texture' }));
    await failure.goto(url);
    await failure.locator('#fatal').waitFor({ state: 'visible', timeout: 90000 });
    assert.match(await failure.locator('#fatal-message').textContent(), /场景材质加载失败/);
    assert.equal(await failure.locator('#menu').isVisible(), false);
    await failure.close();
  }
  assert.ok(requests.every(request => new URL(request).origin === new URL(url).origin),
    'no runtime Azure, CDN or other external requests');
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'observations.json'), JSON.stringify({
    baseline, url, frames, sceneArt: state.sceneArt, assets: [...assets],
    note: 'Actual first-person gameplay with ordinary movement in the five-friendly interior diagnostic; not a full-roster performance benchmark.',
  }, null, 2));
  console.log(`PASS: ${baseline ? 'baseline' : 'AI scene art'} real-game wall/door/sandbag captures and working door entry.`);
} finally {
  await browser.close();
}
