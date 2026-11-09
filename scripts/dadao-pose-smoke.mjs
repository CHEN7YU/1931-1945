import { setQualityPreset } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { DADAO_ART_ROOT, DADAO_ART_MAPS } from '../src/dadao-surface.js';
import { DADAO } from '../src/dadao.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const directory = process.env.ARTIFACT_DIR, errors = [];
const observations = [];
try {
  if (directory) await mkdir(directory, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
    recordVideo: directory ? { dir: join(directory, 'video'), size: { width: 1440, height: 900 } } : undefined });
  await page.route('**/api/performance', route => route.abort());
  const loaded = new Set();
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith(DADAO_ART_ROOT) && response.ok()) loaded.add(path);
  });
  page.on('request', request => {
    const destination = new URL(request.url());
    if (/openai\.azure\.com$/.test(destination.hostname)) errors.push(`Unexpected runtime Azure call: ${destination.hostname}`);
  });
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5187');
  url.searchParams.set('benchmark', 'interior'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await setQualityPreset(page, 'low');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  for (const [kind, maps] of Object.entries(DADAO_ART_MAPS)) for (const map of maps) {
    assert.ok(loaded.has(`${DADAO_ART_ROOT}${kind}/${map}.webp`), `Missing runtime texture: ${kind}/${map}`);
  }
  const decoded = await page.evaluate(async () => {
    const samples = {};
    for (const texture of window.__battle.dadaoMaterials) {
      if (texture.dataTexture || texture.imageType !== 'HTMLImageElement') throw new Error('Dadao map is not a drawable image');
      const { kind, name } = texture, image = new Image(), canvas = document.createElement('canvas');
      image.src = texture.url; await image.decode();
      if (image.width !== texture.width || image.height !== texture.height) throw new Error('Material dimensions do not match the loaded weapon');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0, minimum = 255, maximum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += pixels[i]; minimum = Math.min(minimum, pixels[i]); maximum = Math.max(maximum, pixels[i]);
      }
      const column = x => {
        let total = 0;
        for (let y = 0; y < canvas.height; y++) total += pixels[(y * canvas.width + x) * 4];
        return total / canvas.height;
      };
      samples[`${kind}/${name}`] = { width: image.width, height: image.height, colorSpace: texture.colorSpace,
        mean: sum / (pixels.length / 4), minimum, maximum, left: column(8), right: column(canvas.width - 9) };
    }
    return samples;
  });
  assert.equal(decoded['steel/map'].width, 512);
  assert.equal(decoded['steel/map'].height, 2048);
  assert.equal(decoded['steel/map'].colorSpace, 'srgb');
  assert.equal(decoded['cotton/map'].width, 512);
  assert.ok(decoded['steel/roughnessMap'].left - decoded['steel/roughnessMap'].right > 20, 'real bevel has lower roughness');
  assert.ok(decoded['steel/metalnessMap'].mean > 210, 'bare steel remains predominantly metallic');
  assert.ok(decoded['cotton/roughnessMap'].mean > 218, 'cloth stays matte rather than shiny');
  await page.locator('#deploy').click();
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__battle.dadao?.phase === 'ready');
  const captureStroke = (phase, minimum, maximum) => page.evaluate(({ phase, minimum, maximum }) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 8000;
    const canvas = document.querySelector('canvas');
    const observe = () => {
      const { dadao, time } = window.__battle;
      if (performance.now() > deadline) { reject(new Error(`Missed actual ${phase} pose`)); return; }
      if (dadao.phase === phase && dadao.progress >= minimum) {
        if (dadao.progress > maximum) { reject(new Error(`Skipped ${phase} keyframe: ${dadao.progress}`)); return; }
        resolve({ time, ...dadao, image: canvas.toDataURL('image/jpeg', .92) });
        return;
      }
      requestAnimationFrame(observe);
    };
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    requestAnimationFrame(observe);
  }), { phase, minimum, maximum });
  for (const [name, viewport] of [
    ['wide', { width: 1440, height: 900 }], ['narrow', { width: 450, height: 1100 }],
    ['sidebar', { width: 360, height: 1000 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => window.__battle);
    assert.equal(data.dadao.viewVisible, true);
    assert.equal(data.dadao.handSource, 'nra-authorized-skinned-hand');
    assert.equal(data.dadao.materialSource, `${DADAO_ART_ROOT}source.json`);
    assert.ok(data.dadao.arm.reachable && data.dadao.arm.error < 1e-6);
    if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
    const before = data.rifle.shots;
    for (const [phase, minimum, maximum] of [['windup', .7, 1], ['cut', .35, .65], ['recover', 0, .2]]) {
      await page.waitForFunction(cost => window.__battle.dadao.phase === 'ready' &&
        window.__battle.time >= window.__battle.dadao.nextAttackAt && window.__battle.locomotion.stamina >= cost, DADAO.stamina);
      const { image, ...sample } = await captureStroke(phase, minimum, maximum);
      assert.equal(sample.viewVisible, true, 'capture the rendered weapon, not a pause-menu frame that hides it');
      assert.ok(sample.arm.reachable && sample.arm.error < 1e-6, `${name}/${sample.phase}: original arm cannot reach the stroke`);
      observations.push({ viewport: name, ...sample });
      if (directory) await writeFile(join(directory, `${name}-${sample.phase}.jpg`), Buffer.from(image.split(',')[1], 'base64'));
    }
    await page.waitForFunction(() => window.__battle.dadao.phase === 'ready');
    const after = await page.evaluate(() => window.__battle);
    assert.equal(after.rifle.shots, before);
    assert.equal(after.dadao.swings, data.dadao.swings + 3, 'one mouse press per captured swing, not held auto-repeat');
  }
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__battle.rifle.model !== null);
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__battle.dadao.phase === 'ready');
  assert.deepEqual(errors, []);
  await page.close();
  const missing = await browser.newPage();
  await missing.route(`**${DADAO_ART_ROOT}steel/color.webp`, route => route.fulfill({ status: 404, body: 'Missing texture' }));
  await missing.goto(url.href);
  await missing.waitForFunction(() => !document.querySelector('#fatal').hidden);
  assert.match(await missing.locator('#fatal-message').textContent(), /Dadao material failed to load:.*steel\/color\.webp/);
  assert.equal(await missing.evaluate(() => window.__battle?.state), undefined, 'missing art must not silently launch an untextured game');
  await missing.close();
  if (directory) await writeFile(join(directory, 'stroke-observations.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: seven local decoded material maps, steel bevel and matte cloth, visible missing-map failure, native closed grip, three viewports, low-quality continuous swings, exact windup/middle-cut/early-recovery frames and re-equipping.');
} finally {
  await browser.close();
}
