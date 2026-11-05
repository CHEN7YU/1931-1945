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
  console.error(`Fatal diagnostic regression exceeded 180s at ${stage}`);
  void browser.close();
}, 180000);
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  const production = process.env.GAME_PRODUCTION === '1';
  if (!production) url.searchParams.set('benchmark', 'interior');
  for (const kind of ['loading', 'runtime', 'promise', 'webgl']) {
    stage = kind;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      if (kind === 'loading') {
        await page.route('**/assets/materials/brick/color.jpg', route => route.abort('failed'));
      }
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
      if (kind !== 'loading') {
        await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
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
        assert.equal(await page.locator('#fatal-title').textContent(),
          kind === 'webgl' ? '显卡连接已中断' : '作战意外中断');
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
        if (kind !== 'webgl') {
          const expected = `stability-${kind}-probe`;
          assert.equal(report.error.message, expected);
          assert.ok(report.error.stack.includes(expected));
          assert.deepEqual(errors, [expected]);
        } else assert.deepEqual(errors, []);
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
