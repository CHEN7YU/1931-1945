import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5213/');
  url.searchParams.set('benchmark', 'interior');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#deploy').click();
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: -Math.PI / .00132 })));
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.rifle.obstruction > .5, null, { timeout: 15000 });
  await page.keyboard.up('w');
  for (let frame = 0; frame < 20; frame++) {
    const state = await page.evaluate(() => {
      const d = window.__battle;
      return { state: d.state, time: d.time, position: d.position, ammo: d.ammo,
        obstruction: d.rifle.obstruction, hands: d.rifle.model?.nativeHands,
        fatal: !document.querySelector('#fatal').hidden };
    });
    samples.push(state);
    assert.equal(state.fatal, false);
    assert.equal(state.state, 'playing');
    await page.waitForTimeout(100);
  }
  assert.ok(samples.at(-1).time > samples[0].time + 1, 'simulation continues while aiming into the wall');
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: Math.PI / .00132 })));
  await page.waitForFunction(() => window.__battle.rifle.obstruction === 0 &&
    window.__battle.rifle.model?.nativeHands?.visible, null, { timeout: 10000 });
  const recovered = await page.evaluate(() => window.__battle);
  assert.equal(recovered.ammo, samples[0].ammo);
  assert.equal(recovered.rifle.model.nativeHands.reachLimited, false);
  assert.deepEqual(errors, []);
  console.log('PASS: real wall approach/retraction cannot end the battle; turning away restores native arms without changing ammo.');
} finally {
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'wall-arm-observations.json'), JSON.stringify({ samples, errors }, null, 2));
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'wall-arm-recovered.png') });
  }
  await browser.close();
}
