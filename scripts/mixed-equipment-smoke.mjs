import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5345/');
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  for (let index = 0; index < 4; index++) await page.keyboard.press('y');
  await page.waitForFunction(() => window.__battle.current === 4);
  const before = await page.evaluate(() => {
    const battle = window.__battle; return { actor: battle.allies[battle.current], ammo: battle.ammo };
  });
  assert.equal(before.actor.role, 'assault');
  assert.equal(before.actor.rifle.model, 'sigm1920'); assert.equal(before.ammo, 50);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => window.__battle.fov < 50);
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.ammo < 50);
  await page.mouse.up();
  await page.mouse.up({ button: 'right' });
  const shot = await page.evaluate(() => window.__battle.allies[window.__battle.current].rifle);
  assert.ok(shot.shots > 0 && shot.ammo < 50);
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__battle.allies[window.__battle.current].rifle.action === 'reload');
  await page.waitForFunction(() => window.__battle.ammo === 50);
  await page.screenshot({ path: join(directory, 'sigm1920-first-person.png') });
  const data = await page.evaluate(() => {
    const battle = window.__battle; return { current: battle.current, actor: battle.allies[battle.current],
      models: battle.allies.map(actor => ({ role: actor.role, weapon: actor.rifle.model ?? 'rifle' })) };
  });
  assert.equal(data.models.filter(actor => actor.role === 'engineer').length, 1);
  assert.equal(data.models.filter(actor => actor.role === 'assault').length, 1);
  assert.equal(data.models.filter(actor => actor.role === 'machine-gunner').length, 1);
  assert.equal(data.models.filter(actor => actor.role === 'sniper').length, 1);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'mixed-equipment.json'), JSON.stringify({ before, shot, data, errors,
    note: 'Actual Y selection, first-person firing and personal reload in the existing cover fixture' }, null, 2));
  console.log(JSON.stringify({ passed: true, personalWeapon: data.actor.rifle.model, actualShots: shot.shots }));
} finally { await browser.close(); }
