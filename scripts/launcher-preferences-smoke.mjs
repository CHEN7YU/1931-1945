import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
try {
  await context.addInitScript(key => {
    const original = Storage.prototype.setItem;
    window.preferenceWrites = 0;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) window.preferenceWrites++;
      return original.call(this, name, value);
    };
  }, PREFERENCES_KEY);
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('character', 'procedural');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await page.locator('#menu-settings > summary').click();
  assert.equal(await page.locator('#menu [data-audio-volume]').count(), 5);
  assert.ok(!requests.some(request => request.includes('/src/main.js')), 'settings work before battlefield loading');
  await page.locator('#menu-mouse-sensitivity').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('#menu-aim-sensitivity').evaluate(input => {
    input.value = '0.5'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#menu-motion-strength').selectOption('0.35');
  await page.locator('#menu [data-blast-blur]').uncheck();
  await page.locator('#menu [data-audio-volume="master"]').evaluate(input => {
    input.value = '0.4'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#menu [data-audio-mute="voices"]').check();
  let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).settings, PREFERENCES_KEY);
  assert.equal(saved.mouseSensitivity, 1.05);
  assert.equal(saved.aimSensitivity, .5);
  assert.equal(saved.motionStrength, .35);
  assert.equal(saved.blastBlur, false);
  assert.equal(saved.audio.master.volume, .4);
  assert.equal(saved.audio.voices.muted, true);
  assert.ok(Math.abs(await page.locator('#menu-music').evaluate(audio => audio.volume) - .112) < 1e-10,
    'master volume immediately controls the existing menu soundtrack');
  await page.reload();
  await page.locator('#menu-settings > summary').click();
  assert.equal(await page.locator('#menu-mouse-sensitivity').inputValue(), '1.05');
  assert.equal(await page.locator('#menu [data-audio-volume="master"]').inputValue(), '0.4');
  assert.equal(await page.locator('#menu [data-audio-mute="voices"]').isChecked(), true);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  let battle = await page.evaluate(() => window.__battle);
  assert.equal(battle.preferences.mouseSensitivity, 1.05);
  assert.equal(battle.preferences.aimSensitivity, .5);
  assert.equal(battle.locomotion.motionStrength, .35);
  assert.equal(battle.preferences.blastBlur, false);
  assert.equal(battle.audioMix.settings.master.volume, .4);
  assert.equal(battle.audioMix.settings.voices.muted, true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle?.state === 'pause');
  await page.locator('#pause-settings > summary').click();
  const writes = await page.evaluate(() => window.preferenceWrites);
  await page.locator('#aim-sensitivity').evaluate(input => {
    input.value = '0.75'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => window.preferenceWrites), writes + 1, 'battle load does not add duplicate listeners');
  await page.locator('#audio-settings [data-audio-mute="voices"]').uncheck();
  battle = await page.evaluate(() => window.__battle);
  assert.equal(battle.preferences.aimSensitivity, .75);
  assert.equal(battle.audioMix.settings.voices.muted, false);
  assert.equal(await page.locator('#menu-aim-sensitivity').inputValue(), '0.75');
  assert.equal(await page.locator('#menu [data-audio-mute="voices"]').isChecked(), false);
  saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).settings, PREFERENCES_KEY);
  assert.equal(saved.aimSensitivity, .75);
  assert.equal(saved.audio.voices.muted, false);
  assert.equal(await page.locator('#menu [data-audio-volume]').count(), 5, 'battle load does not duplicate controls');
  await page.locator('#back-menu').click();
  await page.locator('#menu').waitFor({ state: 'visible' });
  if (!await page.locator('#menu-settings').evaluate(element => element.open))
    await page.locator('#menu-settings > summary').click();
  await page.locator('#menu [data-reset-controls]').click();
  await page.locator('#menu [data-reset-audio]').click();
  saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).settings, PREFERENCES_KEY);
  assert.equal(saved.mouseSensitivity, 1);
  assert.equal(saved.aimSensitivity, 1);
  assert.equal(saved.motionStrength, 1);
  assert.equal(saved.blastBlur, false, 'the existing control reset does not alter blast blur');
  assert.equal(saved.audio.master.volume, 1);
  for (const campaign of ['nanjing', 'sihang']) {
    const mapUrl = new URL(url); mapUrl.searchParams.set('campaign', campaign);
    await page.goto(mapUrl.href);
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    battle = await page.evaluate(() => window.__battle);
    assert.equal(battle.preferences.mouseSensitivity, 1);
    assert.equal(battle.preferences.blastBlur, false);
    assert.equal(battle.audioMix.settings.master.volume, 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__battle?.state === 'pause');
    await page.locator('#pause-settings > summary').click();
    assert.equal(await page.locator('#audio-settings [data-audio-volume]').count(), 5);
    assert.equal(await page.locator('#control-settings [data-blast-blur]').isChecked(), false);
  }
  assert.deepEqual(errors, []);

  const blocked = await context.newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new DOMException('Storage blocked by browser policy', 'SecurityError'); },
  }));
  await blocked.goto(url.href);
  await blocked.locator('#menu-settings > summary').click();
  assert.match(await blocked.locator('#menu [data-preferences-status]').textContent(), /无法读取/);
  await blocked.locator('#menu-aim-sensitivity').evaluate(input => {
    input.value = '0.5'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(await blocked.locator('#menu [data-preferences-status]').textContent(), /本页生效.*无法保存/);
  assert.equal(await blocked.locator('#aim-sensitivity').inputValue(), '0.5');
  await blocked.close();
  console.log('Launcher settings, persistence, three-map handoff and unavailable storage passed.');
} finally {
  await context.close();
  await browser.close();
}
