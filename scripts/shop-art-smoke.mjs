import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const baseline = process.env.BASELINE === '1', origin = process.env.GAME_URL || 'http://127.0.0.1:5183/';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (new URL(request.url()).origin !== new URL(origin).origin) external.push(request.url()); });
const observations = [];
try {
  await page.goto(origin);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#shop-art-entry').waitFor({ state: 'visible', timeout: 90000 });
  await page.locator('#shop-art-entry').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' && window.__battle.benchmark?.scenario === 'shop-art',
    null, { timeout: 90000 });
  assert.equal(await page.locator('#shop-art-tour').isVisible(), true);
  for (const view of ['grain', 'cloth', 'ground']) {
    await page.locator(`[data-shop-view="${view}"]`).click();
    await page.waitForTimeout(650);
    const state = await page.evaluate(() => window.__battle);
    assert.equal(state.population.friendly.alive, 1);
    assert.equal(state.population.enemy.alive, 0);
    assert.ok(Math.hypot(state.position.x, state.position.z - 64) < .1, 'entry and each view return directly to the samples');
    assert.deepEqual(state.town.visibility, { doorOpening: true, wall: false, window: true, sill: false, lintel: false });
    if (!baseline) {
      assert.equal(state.sceneArt.shopAwnings, 2);
      assert.equal(state.sceneArt.shopNotices, 2);
      assert.equal(state.sceneArt.contactPatches, 4);
      assert.deepEqual(state.sceneArt.shopSamples, ['west-0', 'east-0']);
      assert.ok(state.drawCalls < 240);
    }
    await page.screenshot({ path: join(directory, `${view}.png`) });
    observations.push({ view, position: state.position, look: state.look, sceneArt: state.sceneArt, drawCalls: state.drawCalls });
  }
  await page.keyboard.press('F1'); await page.waitForTimeout(200);
  await page.keyboard.down('w'); await page.waitForTimeout(800); await page.keyboard.up('w');
  await page.keyboard.down('a'); await page.waitForTimeout(850); await page.keyboard.up('a');
  const oblique = await page.evaluate(() => window.__battle);
  const targetYaw = Math.atan2(4.5 + oblique.position.x, oblique.position.z - 64);
  await page.mouse.move(100, 450); await page.mouse.down({ button: 'right' });
  await page.mouse.move(100 + (oblique.look.yaw - targetYaw) / (.0022 * .6), 450, { steps: 12 });
  await page.mouse.up({ button: 'right' }); await page.waitForTimeout(850);
  const sideState = await page.evaluate(() => window.__battle);
  assert.ok(Math.abs(sideState.look.yaw - targetYaw) < .02, 'oblique capture uses ordinary movement and right-drag controls');
  assert.ok(sideState.position.x < -1 && sideState.position.z > 65);
  await page.screenshot({ path: join(directory, 'grain-oblique.png') });
  observations.push({ view: 'grain-oblique', position: sideState.position, look: sideState.look, drawCalls: sideState.drawCalls });
  await page.keyboard.press('F2');
  await page.waitForTimeout(150);
  assert.ok(Math.abs((await page.evaluate(() => window.__battle.look.yaw)) + Math.PI / 2) < .01);
  await page.keyboard.down('w'); await page.waitForTimeout(450); await page.keyboard.up('w');
  assert.ok((await page.evaluate(() => window.__battle.position.x)) > .2, 'ordinary movement remains usable inside the sample');
  await page.keyboard.press('F1'); await page.waitForTimeout(200);
  assert.ok(Math.hypot(...await page.evaluate(() => [window.__battle.position.x, window.__battle.position.z - 64])) < .1);
  if (!baseline) {
    const derived = await page.evaluate(async () => {
      const { shopContactMaterial } = await import('/src/shop-art.js');
      const image = new Image(); image.src = '/assets/materials/ai-scene/wall-grime/atlas.webp'; await image.decode();
      const material = shopContactMaterial(image), canvas = material.map.image;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let maxAlpha = 0, borderAlpha = 0, visible = 0;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const alpha = pixels[(y * 256 + x) * 4 + 3];
        maxAlpha = Math.max(maxAlpha, alpha); if (alpha > 20) visible++;
        if (x === 0 || y === 0 || x === 255 || y === 255) borderAlpha = Math.max(borderAlpha, alpha);
      }
      const result = { maxAlpha, borderAlpha, visible, colorSpace: material.map.colorSpace, source: material.map.userData.source };
      material.map.dispose(); material.dispose(); return result;
    });
    assert.ok(derived.maxAlpha > 60 && derived.maxAlpha <= 160);
    assert.equal(derived.borderAlpha, 0); assert.ok(derived.visible > 4000);
    assert.equal(derived.colorSpace, 'srgb');
    observations.push({ derived });
    const prints = await page.evaluate(async () => {
      const { shopPrintMaterial, SHOP_ART_STYLES } = await import('/src/shop-art.js');
      const load = async source => { const image = new Image(); image.src = source; await image.decode(); return image; };
      const [wood, plaster] = await Promise.all([
        load('/assets/materials/ai-scene/crate-timber/color.webp'),
        load('/assets/materials/ai-scene/weathered-plaster/color.webp'),
      ]);
      const results = [];
      for (const notice of [false, true]) {
        const first = shopPrintMaterial(SHOP_ART_STYLES['west-0'], '同德糧行', wood, plaster, notice);
        const second = shopPrintMaterial(SHOP_ART_STYLES['west-0'], '同德糧行', wood, plaster, notice);
        results.push({ notice, deterministic: first.map.image.toDataURL() === second.map.image.toDataURL(),
          colorSpace: first.map.colorSpace, processing: first.map.userData.processing, side: first.side });
        for (const material of [first, second]) { material.map.dispose(); material.dispose(); }
      }
      return results;
    });
    assert.ok(prints.every(print => print.deterministic && print.colorSpace === 'srgb'));
    assert.equal(prints[1].side, 2, 'curled paper remains visible from both sides');
    observations.push({ prints });
  }
  await page.locator('#shop-art-tour a').click();
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  assert.equal(await page.locator('#shop-art-tour').isVisible(), false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ baseline, observations, errors, external }, null, 2));
  console.log('PASS: discoverable entry, direct spawn, three resettable views, unchanged apertures, local assets and return to normal lobby.');
} finally { await browser.close(); }
