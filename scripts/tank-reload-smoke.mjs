import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
const wait = predicate => page.waitForFunction(predicate);
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'control');
  url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await wait(() => window.__battle?.state === 'menu');
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  assert.equal(await page.locator('#tank-reload').isVisible(), false);
  assert.match(await page.locator('#battle-controls').textContent(), /自动装填/);
  const initial = await snapshot();
  await page.mouse.down();
  await wait(() => window.__battle.ammo === 0);
  await page.mouse.up();
  let data = await snapshot();
  const deadline = data.vehicles[0].weapon.reloadUntil;
  assert.ok(Math.abs(deadline - data.time - 3.8) < .3, 'one click immediately starts the 3.8s reload');
  await page.locator('#tank-reload').waitFor({ state: 'visible' });
  await page.keyboard.press('r');
  assert.equal((await snapshot()).vehicles[0].weapon.reloadUntil, deadline, 'R does not reset automatic loading');
  await page.waitForFunction(() => Number(document.querySelector('#tank-reload').getAttribute('aria-valuenow')) >= 20);
  const observed = await page.evaluate(() => ({
    data: window.__battle,
    progress: Number(document.querySelector('#tank-reload').getAttribute('aria-valuenow')),
    offset: Number(document.querySelector('#tank-reload-progress').style.strokeDashoffset),
  }));
  data = observed.data;
  const { progress, offset } = observed;
  const expected = (1 - (deadline - data.time) / 3.8) * 100;
  assert.ok(Math.abs(progress - expected) < 3, `ring is driven by actual simulation progress: ${progress} vs ${expected}`);
  assert.ok(Math.abs(offset - (100 - expected)) < 3);
  assert.equal(data.locomotion.weaponOffset.pitch, 0, 'cannon has no hand-held reload tilt');
  assert.equal(data.vehicles[0].turretPitch, initial.vehicles[0].turretPitch);
  assert.equal(data.look.pitch, initial.look.pitch);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'tank-auto-reload.png') });
  }
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  const frozenProgress = await page.locator('#tank-reload').getAttribute('aria-valuenow');
  await page.waitForTimeout(500);
  assert.equal((await snapshot()).time, paused.time);
  assert.equal(await page.locator('#tank-reload').getAttribute('aria-valuenow'), frozenProgress);
  await page.locator('#resume').click();
  await page.keyboard.press('y');
  assert.equal((await snapshot()).current, 1);
  assert.equal((await snapshot()).vehicles[0].weapon.reloadUntil, deadline);
  await page.keyboard.press('y');
  assert.equal((await snapshot()).current, 2);
  assert.equal(await page.locator('#tank-reload').isVisible(), true, 'driver can observe shared reload progress');
  await page.keyboard.press('r');
  assert.equal((await snapshot()).vehicles[0].weapon.reloadUntil, deadline);
  await page.keyboard.press('y');
  await page.keyboard.press('f');
  assert.equal((await snapshot()).type, 'infantry');
  await page.locator('#tank-reload').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__battle.vehicles[0].weapon.ammo === 1);
  data = await snapshot();
  assert.equal(data.vehicles[0].weapon.reloadUntil, 0);
  assert.equal(data.ammo, 5, 'vehicle reload does not change the dismounted rifle');
  await page.keyboard.press('y');
  assert.equal((await snapshot()).type, 'tank');
  assert.equal((await snapshot()).ammo, 1, 'loaded cannon is ready after switching back');
  assert.equal(await page.locator('#tank-reload').isVisible(), false);
  await page.mouse.down();
  await wait(() => window.__battle.ammo === 0);
  await page.mouse.up();
  await page.locator('#tank-reload').waitFor({ state: 'visible' });
  await wait(() => window.__battle.ammo === 1);
  await page.locator('#tank-reload').waitFor({ state: 'hidden' });
  assert.equal((await snapshot()).locomotion.weaponOffset.pitch, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: tank auto-reload, timed progress ring, steady barrel, R no-op, pause, seat transfer and dismounted completion.');
} finally {
  await browser.close();
}
