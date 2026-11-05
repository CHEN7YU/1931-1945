import { setQualityPreset } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
const wait = (fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 20000 });
async function observeRestrictedFire(kind) {
  return page.evaluate(kind => new Promise((resolve, reject) => {
    let started = null, phase = kind === 'reload' ? 'prime' : 'start', primingAmmo = null;
    const timer = setTimeout(() => {
      const b = window.__battle;
      reject(new Error(`No observed ${kind}/fire restriction: ${JSON.stringify({
        phase, state: b.state, ammo: b.ammo, action: b.rifle.action, elapsed: b.rifle.elapsed, input: b.controlInput,
      })}`));
    }, 30000);
    function observe() {
      let data = window.__battle;
      const canvas = document.querySelector('#world');
      if (phase === 'prime' && data.rifle.action === 'idle') {
        primingAmmo = data.ammo; phase = 'shot';
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      } else if (phase === 'shot' && data.ammo < primingAmmo) {
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); phase = 'reload';
      } else if (phase === 'reload' && data.rifle.action === 'idle') {
        for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { code: 'KeyR' }));
        data = window.__battle; phase = 'start';
      }
      const ready = phase === 'start' && (kind === 'reload' ? data.rifle.action === 'reload' : data.locomotion.sprinting);
      if (!started && ready) {
        started = { time: data.time, ammo: data.ammo };
        if (kind === 'reload') for (const type of ['keydown', 'keyup']) {
          document.dispatchEvent(new KeyboardEvent(type, { code: 'KeyR' }));
        }
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      } else if (started && data.time - started.time >= .12) {
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        clearTimeout(timer);
        resolve({ beforeAmmo: started.ammo, ammo: data.ammo, feedback: data.actionFeedback,
          action: data.rifle.action, primingAmmo, toast: document.querySelector('#toast').textContent });
        return;
      }
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  }), kind);
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  if (process.env.GAME_PRODUCTION !== '1') url.searchParams.set('benchmark', 'interior');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
  await setQualityPreset(page, 'low');
  await page.locator('#deploy').click();
  await page.keyboard.press('r');
  assert.match(await page.locator('#toast').textContent(), /弹药已满/);
  const full = await page.evaluate(() => window.__battle.ammo);
  await page.mouse.down({ button: 'right' });
  const reload = await observeRestrictedFire('reload');
  assert.equal(reload.beforeAmmo, full - 1, 'one actually observed shot primes the reload');
  assert.equal(reload.action, 'reload');
  assert.match(reload.toast, /正在装填/);
  assert.equal(reload.feedback.displayed, 'reload');
  assert.equal(reload.ammo, reload.beforeAmmo, 'pressing fire cannot skip the actual owned reload step');
  observations.push({ stage: 'reload', ...reload });
  await wait(() => window.__battle.rifle.action === 'idle');
  await wait(() => document.querySelector('#action-status').hidden);
  await page.mouse.up({ button: 'right' });
  const sprintObservation = observeRestrictedFire('sprint');
  await page.keyboard.down('w'); await page.keyboard.down('ShiftLeft');
  const sprint = await sprintObservation;
  observations.push({ stage: 'sprint', ...sprint });
  assert.ok(['sprint', 'recovery'].includes(sprint.feedback.fire?.code));
  assert.ok(['sprint', 'recovery'].includes(sprint.feedback.displayed));
  assert.equal(sprint.ammo, sprint.beforeAmmo, 'an actually observed restricted-fire step cannot consume ammo');
  await page.mouse.up(); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('w');
  await wait(() => window.__battle.locomotion.aimRecovery === 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__battle.actionFeedback.fire), null);
  assert.deepEqual(errors, []);
  console.log('PASS: full-magazine and active-reload responses, persistent real reload/sprint reasons, no ammo bypass and automatic reason clearing.');
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'weapon-feedback.json'), JSON.stringify({ observations, errors }, null, 2));
    }
  } finally { await browser.close(); }
}
