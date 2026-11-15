import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.nanjingDrawnText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.nanjingDrawnText.push(text);
      return fillText.call(this, text, ...args);
    };
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.nanjingSloganReview = {
        capture(eye, target, hidden) {
          setGameState('pause'); missionBriefing.hide();
          const slogans = [];
          scene.traverse(object => { if (object.userData.nanjingFeature === 'wall-slogan') slogans.push(object); });
          const visibility = slogans.map(object => object.visible);
          if (hidden) for (const object of slogans) object.visible = false;
          camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          const texts = [];
          scene.traverse(object => {
            if (object.userData.nanjingFeature === 'wall-slogan')
              texts.push({ text: object.userData.text, rasterized: Boolean(object.material.map),
                position: object.position.toArray() });
          });
          const result = { image: renderer.domElement.toDataURL('image/png').split(',')[1], texts,
            draws: renderer.info.render.calls };
          slogans.forEach((object, index) => { object.visible = visibility[index]; });
          return result;
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('character', 'procedural');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const records = [];
  for (const [name, eye, target] of [
    ['west', [-30, 1.65, 31], [-30, 4.5, 20.4]],
    ['east', [59, 1.65, 38], [55, 4.7, 20.4]],
    ['east-left', [49, 1.65, 34], [55, 4.7, 20.4]],
    ['east-near', [55, 1.65, 30], [55, 4.7, 20.4]],
    ['east-right', [66, 1.65, 34], [55, 4.7, 20.4]],
  ]) {
    for (const hidden of [true, false]) {
      const { image, ...record } = await page.evaluate(({ eye, target, hidden }) =>
        nanjingSloganReview.capture(eye, target, hidden), { eye, target, hidden });
      await writeFile(join(directory, `${name}-${hidden ? 'before' : 'after'}.png`), Buffer.from(image, 'base64'));
      records.push({ name, hidden, eye, target, ...record });
    }
  }
  if (process.env.REQUIRE_SLOGANS === '1') {
    assert.deepEqual(records[0].texts.map(item => item.text).sort(), [
      '地无分南北，年无分老幼，无论何人，皆有守土抗战之责', '誓死保卫南京',
    ].sort());
    assert.ok(records[0].texts.every(item => item.rasterized));
    const drawnText = await page.evaluate(() => window.nanjingDrawnText.join(''));
    for (const line of ['誓死保卫南京', '地无分南北，年无分老幼，', '无论何人，皆有守土抗战之责'])
      assert.ok(drawnText.includes(line), `missing rendered slogan line: ${line}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({
    fixture: 'Production Nanjing scene; paused, procedural characters and manually positioned eye-height diagnostic camera.',
    records, errors,
  }, null, 2));
  console.log(JSON.stringify(records));
} finally {
  await browser.close();
}
