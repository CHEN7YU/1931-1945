import { setQualityPreset } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'] });
const observations = [];
let stage = 'starting';
const watchdog = setTimeout(() => {
  console.error(`Fatal diagnostic regression exceeded 600s at ${stage}`);
  void browser.close();
}, 600000);
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  const production = process.env.GAME_PRODUCTION === '1';
  if (!production) url.searchParams.set('benchmark', 'interior');
  url.searchParams.set('resources', 'low-memory');
  for (const kind of ['loading', 'runtime', 'promise', 'webgl']) {
    stage = kind;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      if (kind === 'loading') {
        await page.route('**/assets/materials/brick/color.jpg', route => route.abort('failed'));
      }
      const receipts = [];
      await page.route('**/api/performance', async route => {
        const payload = route.request().postDataJSON(); receipts.push(payload);
        await route.fulfill({ json: { saved: true, id: payload.id } });
      });
      if (!production && kind === 'runtime') await page.route('**/src/main.js*', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: await response.text() + `
          window.runtimeReview = {
            sword() {
              equipDadao();
              const view = weapon, arm = view.userData.dadaoArm, original = arm.setOfficerAppearance;
              arm.setOfficerAppearance = () => { throw new Error('stability-sword-view-probe'); };
              for (let frame = 0; frame < 60; frame++) updateCamera(1 / 60);
              const hidden = !view.visible;
              const records = fatalReporter.recoveries.filter(entry => entry.error.message === 'stability-sword-view-probe');
              arm.setOfficerAppearance = original;
              equipPrimary(); equipDadao(); updateCamera(1 / 60);
              return { hidden, records, restored: weapon.visible, fatal: fatalReporter.failed };
            },
            stowed() {
              equipDadao(); const actor = controlledSoldier(entities);
              stowDadao(actor.dadao); updateCamera(1 / 60);
              return { equipped: dadaoEquipped, personal: actor.dadao.equipped, fatal: fatalReporter.failed };
            },
            frame() {
              const original = camera.updateProjectionMatrix;
              camera.updateProjectionMatrix = function () {
                camera.updateProjectionMatrix = original; throw new Error('stability-frame-probe');
              };
            },
            lethal() {
              equipDadao(); const actor = controlledSoldier(entities);
              actor.health = 100;
              hurt(actor, 100, captureAttackSource(entities, actor), 'rifle', 'torso');
              updateCamera(1 / 60);
              return { dying: Boolean(actor.dying), equipped: dadaoEquipped, personal: actor.dadao.equipped,
                fatal: fatalReporter.failed };
            },
            lastStand(preferred, ammo, packs, primed = false) {
              const actor = controlledSoldier(entities);
              actor.dying = actor.fatalFall = actor.blastReaction = null; actor.health = 100;
              grenades.interrupt(actor.id); actor.grenades.ammo = ammo; actor.grenades.packs = packs;
              selectedThrowable = preferred; equipPrimary();
              Object.assign(actor.rifle, { action: 'reload', ammo: 0, queuedReload: true, elapsed: .8 });
              if (primed) { equipGrenade(preferred); prepareGrenade(); }
              const pending = actor.grenades.action;
              hurt(actor, 100, captureAttackSource(entities, actor), 'rifle', 'torso');
              renderDeathFeedback(); renderWeaponReload();
              const automatic = { equipped: grenadeEquipped, kind: selectedThrowable,
                name: $('weapon-name').textContent, label: $('death-transfer-label').textContent,
                action: actor.dying.action, pendingPreserved: pending === actor.grenades.action,
                reload: actor.rifle.action, queued: actor.rifle.queuedReload, ammo: actor.rifle.ammo,
                reloadVisible: !$('tank-reload').hidden, fatal: fatalReporter.failed };
              const denied = dispatchControlCommand('reload').status === 'rejected';
              const shortHint = $('weapon-name').textContent;
              if (!primed && grenadeEquipped) prepareGrenade();
              const prepared = Boolean(actor.grenades.action);
              grenades.interrupt(actor.id); actor.dying = null; actor.health = 100; equipPrimary();
              return { automatic, denied, prepared, shortHint };
            }
          };` });
      });
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
      if (kind !== 'loading') {
        await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
        await setQualityPreset(page, 'low');
        await page.locator('#deploy').click();
        await page.waitForFunction(() => window.__battle.state === 'playing');
        assert.deepEqual(errors, [], 'no unexpected pre-injection runtime errors');
        if (kind === 'runtime') await page.evaluate(() => {
          setTimeout(() => { throw new Error('stability-runtime-probe'); }, 0);
        });
        if (kind === 'promise') await page.evaluate(() => {
          void Promise.reject(new Error('stability-promise-probe'));
        });
        if (kind === 'webgl') await page.evaluate(() => {
          const gl = document.querySelector('#world').getContext('webgl2');
          const extension = gl.getExtension('WEBGL_lose_context');
          if (!extension) throw new Error('WEBGL_lose_context required for this regression');
          extension.loseContext();
        });
      }
      if (kind === 'runtime' || kind === 'promise') {
        const expected = `stability-${kind}-probe`;
        await page.waitForFunction(message =>
          window.__battle.recoveredErrors.some(entry => entry.error.message === message), expected);
        const before = await page.evaluate(() => ({ time: window.__battle.time, control: window.__battle.control }));
        await page.keyboard.press('y');
        await page.waitForFunction(id => window.__battle.control.soldierId !== id, before.control.soldierId);
        const position = await page.evaluate(() => window.__battle.position);
        await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
        const after = await page.evaluate(() => ({ time: window.__battle.time, position: window.__battle.position,
          state: window.__battle.state, recovered: window.__battle.recoveredErrors }));
        assert.ok(after.time > before.time, 'simulation continues after the error');
        assert.notDeepEqual(after.position, position, 'movement input still works after the error');
        assert.equal(after.state, 'playing');
        assert.equal(await page.locator('#fatal').isVisible(), false, 'ordinary runtime errors do not open a modal');
        assert.deepEqual(errors, [expected]);
        for (let attempt = 0; attempt < 20 && !receipts.length; attempt++) await page.waitForTimeout(50);
        assert.ok(receipts.length, 'a local anonymous error registration was received');
        assert.ok(receipts.some(payload => payload.windows.some(window =>
          window.runtimeErrors?.some(entry => entry.recovered && entry.stage === 'battle'))));
        assert.equal(JSON.stringify(receipts).includes(expected), false, 'raw error messages are not uploaded');
        const injected = {};
        if (!production && kind === 'runtime') {
          injected.sword = await page.evaluate(() => window.runtimeReview.sword());
          assert.equal(injected.sword.hidden, true); assert.equal(injected.sword.restored, true);
          assert.equal(injected.sword.records.length, 1); assert.equal(injected.sword.records[0].count, 1);
          assert.equal(injected.sword.fatal, false);
          injected.stowed = await page.evaluate(() => window.runtimeReview.stowed());
          assert.deepEqual(injected.stowed, { equipped: false, personal: false, fatal: false });
          const beforeFrame = await page.evaluate(() => { window.runtimeReview.frame(); return window.__battle.time; });
          await page.waitForFunction(time => window.__battle.time > time + .1 &&
            window.__battle.recoveredErrors.some(entry => entry.error.message === 'stability-frame-probe'), beforeFrame);
          injected.lethal = await page.evaluate(() => window.runtimeReview.lethal());
          assert.deepEqual(injected.lethal, { dying: true, equipped: false, personal: false, fatal: false });
          injected.lastStand = [];
          for (const [preferred, ammo, packs, expected, primed] of [
            ['grenade', 1, 1, 'grenade', false], ['explosive-pack', 1, 1, 'explosive-pack', false],
            ['grenade', 0, 1, 'explosive-pack', false], ['explosive-pack', 1, 0, 'grenade', false],
            ['grenade', 0, 0, null, false], ['grenade', 1, 1, 'grenade', true],
          ]) {
            const sample = await page.evaluate(args => window.runtimeReview.lastStand(...args), [preferred, ammo, packs, primed]);
            assert.equal(sample.automatic.equipped, Boolean(expected));
            if (expected) assert.equal(sample.automatic.kind, expected);
            assert.equal(sample.automatic.label, '重伤');
            assert.equal(sample.automatic.reload, 'idle');
            assert.equal(sample.automatic.queued, false);
            assert.equal(sample.automatic.ammo, 0);
            assert.equal(sample.automatic.reloadVisible, false);
            assert.equal(sample.automatic.action, primed ? 'throw' : null);
            assert.equal(sample.automatic.pendingPreserved, true, 'selection does not prime or replace grenades');
            assert.equal(sample.denied, true); assert.equal(sample.prepared, Boolean(expected));
            assert.equal(sample.automatic.fatal, false);
            if (expected) assert.equal(sample.shortHint, expected === 'grenade' ? '手榴弹' : '炸药包');
            injected.lastStand.push(sample);
          }
        }
        observations.push({ kind, before, after, injected, localReceipts: receipts, errors });
        console.log(`PASS: ${kind} stays nonblocking, input works and anonymous registration reaches the local stub.`);
        continue;
      }
      await page.locator('#fatal').waitFor({ state: 'visible', timeout: 20000 });
      const report = JSON.parse(await page.locator('#fatal-details').inputValue());
      assert.equal(report.kind, kind === 'promise' ? 'runtime' : kind);
      assert.match(report.build.commit, /^[a-f0-9]{40,64}$/);
      assert.equal(report.build.development, !production);
      assert.ok(report.build.builtAt);
      if (kind === 'loading') {
        assert.equal(await page.locator('#fatal-title').textContent(), '战场未能加载');
        assert.equal(report.stage, 'scene-materials');
        assert.match(report.error.message, /\/assets\/materials\/brick\/color\.jpg/);
        assert.equal(await page.locator('#menu').isVisible(), false);
      } else {
        assert.equal(await page.locator('#fatal-title').textContent(), '显卡连接已中断');
        assert.equal(report.context.state, 'playing');
        assert.ok(report.context.control.soldierId);
        const before = await page.evaluate(() => {
          const d = window.__battle;
          return { time: d.time, control: d.control, ammo: d.ammo, position: d.position };
        });
        await page.keyboard.press('y');
        await page.keyboard.press('r');
        await page.keyboard.down('w');
        await page.waitForTimeout(300);
        await page.keyboard.up('w');
        const after = await page.evaluate(() => {
          const d = window.__battle;
          return { time: d.time, control: d.control, ammo: d.ammo, position: d.position };
        });
        assert.deepEqual(after, before, 'fatal state stops simulation and gameplay input');
        assert.deepEqual(errors, []);
      }
      await page.locator('#fatal-copy').click();
      await page.waitForFunction(() => document.querySelector('#fatal-copy-status').textContent.includes('已复制'));
      assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), report,
        'clipboard keeps every diagnostic field, independently of platform line endings');
      // Exercise browser permission failure, not a success-shaped clipboard fallback.
      await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true, value: () => Promise.reject(new Error('stability clipboard denied')),
      }));
      await page.locator('#fatal-copy').click();
      await page.waitForFunction(() => document.querySelector('#fatal-copy-status').textContent.includes('Ctrl+C'));
      assert.equal(await page.locator('#fatal-details').evaluate(node =>
        document.activeElement === node && node.selectionStart === 0 && node.selectionEnd === node.value.length), true);
      observations.push({ kind, report, errors });
      if (process.env.ARTIFACT_DIR) {
        await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `fatal-${kind}.png`) });
      }
      console.log(`PASS: ${kind} classification, original diagnostic, frozen gameplay, explicit copy and manual fallback.`);
    } catch (error) {
      observations.push({ kind, errors, failure: error.message, page: await page.evaluate(() => ({
        fatal: document.querySelector('#fatal-details')?.value,
        loading: document.querySelector('#loading')?.textContent,
        state: window.__battle?.state,
      })) });
      throw error;
    } finally { await page.close(); }
  }
} finally {
  clearTimeout(watchdog);
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'fatal-report-observations.json'),
        JSON.stringify({ stage, observations }, null, 2));
    }
  } finally { await browser.close(); }
}
