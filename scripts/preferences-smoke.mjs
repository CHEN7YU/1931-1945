import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PREFERENCES_KEY } from '../src/player-preferences.js';
import { QUALITY_EFFECTS } from '../src/quality.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [], warnings = [], observations = [];
let stage = 'starting';
const watchdog = setTimeout(() => {
  console.error(`Preferences regression exceeded 180s at ${stage}`);
  void browser.close();
}, 180000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
const snapshot = () => page.evaluate(() => window.__battle);
const wait = (fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 20000 });
async function setSlider(selector, value) {
  await page.locator(selector).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function measureLook(expected, aiming) {
  const canvas = page.locator('#world');
  if (aiming) await page.mouse.down({ button: 'right' });
  else {
    await page.mouse.up({ button: 'right' });
    if (!await page.evaluate(() => document.pointerLockElement === document.querySelector('#world'))) {
      await canvas.click();
      await wait(() => document.pointerLockElement === document.querySelector('#world'));
    }
  }
  const before = (await snapshot()).look;
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 40, movementY: -10 })));
  const after = (await snapshot()).look;
  assert.ok(Math.abs((after.yaw - before.yaw) - (-40 * expected)) < 1e-8, 'horizontal input uses the exact sensitivity');
  assert.ok(Math.abs((after.pitch - before.pitch) - (10 * expected)) < 1e-8, 'vertical input uses the same sensitivity');
  await page.mouse.up({ button: 'right' });
}
const pausedState = data => ({ time: data.time, ammo: data.ammo, health: data.health,
  position: data.position, control: data.control, rifle: { action: data.rifle.action, elapsed: data.rifle.elapsed },
  objectives: data.objectives });
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  if (process.env.GAME_PRODUCTION !== '1') url.searchParams.set('benchmark', 'cover');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
  assert.deepEqual((await snapshot()).preferences.mouseSensitivity, 1);
  assert.equal((await snapshot()).preferences.aimSensitivity, 1);
  await page.setViewportSize({ width: 1280, height: 720 });
  const deploy = await page.locator('#deploy').boundingBox();
  assert.ok(deploy.y >= 0 && deploy.y + deploy.height <= 720, 'closed menu controls keep deployment reachable at 720p');
  await page.locator('.menu-controls summary').click();
  await page.locator('#menu-aim-sensitivity').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#menu-aim-sensitivity').isVisible(), true);
  await page.locator('.menu-controls summary').click();
  await page.locator('#deploy').scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.menu-controls summary').click();
  stage = 'menu editing';
  await page.locator('#menu-mouse-sensitivity').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).preferences.mouseSensitivity, 1.05, 'menu sliders support native keyboard adjustment');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#menu-aim-sensitivity').evaluate(input => document.activeElement === input), true,
    'menu keyboard focus is not captured by the battlefield scoreboard');
  await setSlider('#menu-mouse-sensitivity', 2);
  await setSlider('#menu-aim-sensitivity', .5);
  await page.locator('#menu-motion-strength').selectOption('0.35');
  await page.locator('#menu-quality').selectOption('low');
  assert.equal(await page.locator('#mouse-sensitivity').inputValue(), '2', 'menu edits update paused controls too');
  assert.equal(await page.locator('#aim-sensitivity').inputValue(), '0.5');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.state === 'playing');
  stage = 'real normal and aimed input';
  await measureLook(.0022 * 2, false);
  await measureLook(.00132 * .5, true);
  await page.keyboard.press('Escape');
  await wait(() => window.__battle.state === 'pause');
  const before = pausedState(await snapshot());
  await setSlider('#mouse-sensitivity', 1.5);
  await setSlider('#aim-sensitivity', .75);
  await page.locator('#aim-sensitivity').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).preferences.aimSensitivity, .8, 'paused sliders support keyboard adjustment');
  await setSlider('#aim-sensitivity', .75);
  await page.locator('#motion-strength').selectOption('0');
  for (const effect of QUALITY_EFFECTS) await page.locator(`#quality-${effect}`).uncheck();
  assert.deepEqual(pausedState(await snapshot()), before, 'settings never advance, restart or rebind the paused match');
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.locator('#control-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'preferences-paused.png') });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  assert.deepEqual(pausedState(await snapshot()), before, 'resize does not alter match state');
  await page.locator('#resume').click();
  await wait(() => window.__battle.state === 'playing');
  await measureLook(.0022 * 1.5, false);
  await measureLook(.00132 * .75, true);
  // The cover fixture includes the real scoped rifle member; no writable game hooks.
  for (let i = 0; i < 11; i++) {
    const data = await snapshot();
    const member = data.allies.find(actor => actor.id === data.control.soldierId);
    if (member.rifle.model === 'sniper') break;
    await page.keyboard.press('y');
  }
  await page.mouse.down({ button: 'right' });
  await wait(() => window.__battle.scope.active);
  await measureLook(.0022 * .22 * .75, true);
  await page.keyboard.press('Escape');
  const saved = (await snapshot()).preferences;
  assert.equal(saved.motionStrength, 0);
  assert.equal(saved.quality.effects.fog, false);
  observations.push({ stage: 'before-reload', preferences: saved });
  stage = 'reload persistence';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
  const restored = await snapshot();
  assert.equal(restored.preferences.mouseSensitivity, 1.5);
  assert.equal(restored.preferences.aimSensitivity, .75);
  assert.equal(restored.preferences.motionStrength, 0);
  assert.equal(restored.graphics.preset, 'low');
  assert.equal(restored.graphics.fogEnabled, false);
  assert.equal(restored.graphics.grainEnabled, false);
  assert.ok(Object.values(restored.graphics.effects).every(value => value === false), 'all individual effects persist');
  assert.equal(await page.locator('#motion-strength').inputValue(), '0');
  assert.equal(await page.locator('#menu-mouse-sensitivity').inputValue(), '1.5');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.state === 'playing');
  assert.equal((await snapshot()).locomotion.motionStrength, 0, 'restored camera motion drives the actual player');
  await measureLook(.0022 * 1.5, false);
  await measureLook(.00132 * .75, true);
  await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  await page.locator('.menu-controls summary').click();
  await page.locator('.menu-controls [data-reset-controls]').click();
  const reset = (await snapshot()).preferences;
  assert.equal(reset.mouseSensitivity, 1);
  assert.equal(reset.aimSensitivity, 1);
  assert.equal(reset.motionStrength, 1);
  assert.deepEqual(reset.quality, saved.quality, 'resetting controls must not reset graphics effects');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.state === 'playing');
  await measureLook(.0022, false);
  await measureLook(.00132, true);
  await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  stage = 'corrupt saved settings';
  await page.evaluate(key => localStorage.setItem(key, '{invalid'), PREFERENCES_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
  assert.equal((await snapshot()).preferences.persistence.problem, true);
  assert.equal((await snapshot()).preferences.mouseSensitivity, 1);
  assert.match(await page.locator('#menu [data-preferences-status]').textContent(), /无法读取/);
  await page.locator('.menu-controls summary').click();
  await setSlider('#menu-mouse-sensitivity', 1.25);
  assert.equal((await snapshot()).preferences.persistence.problem, false);
  stage = 'unavailable browser storage';
  const blocked = await context.newPage();
  try {
    await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
      configurable: true, get() { throw new DOMException('Storage blocked by browser policy', 'SecurityError'); },
    }));
    await blocked.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await blocked.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
    assert.equal(await blocked.locator('#fatal').isVisible(), false);
    assert.match(await blocked.locator('#menu [data-preferences-status]').textContent(), /无法读取/);
    await blocked.locator('.menu-controls summary').click();
    await blocked.locator('#menu-aim-sensitivity').evaluate(input => {
      input.value = '.5'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await blocked.evaluate(() => window.__battle.preferences.aimSensitivity), .5);
    assert.match(await blocked.locator('#menu [data-preferences-status]').textContent(), /本页生效.*无法保存/);
  } finally { await blocked.close(); }
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(text => text.includes('无法读取保存的设置')), 'invalid storage is not silently discarded');
  console.log('PASS: independent input/scoped sensitivity, menu/pause sync, settings persistence, defaults reset, intact match state, corrupt and blocked storage.');
} finally {
  clearTimeout(watchdog);
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'preferences-observations.json'),
        JSON.stringify({ stage, observations, errors, warnings }, null, 2));
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'preferences-final.png') });
    }
  } finally { await browser.close(); }
}
