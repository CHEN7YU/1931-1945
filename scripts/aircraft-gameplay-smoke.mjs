import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="plane"]').click();
  await page.locator('#spawn-choices [data-spawn="china-air"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  const initial = await page.evaluate(() => window.__battle);
  assert.equal(initial.population.friendly.alive, 110);
  assert.equal(initial.population.enemy.alive, 96);
  assert.equal(initial.type, 'plane');
  await page.screenshot({ path: join(directory, 'friendly-cockpit.png') });
  await page.waitForFunction(() => window.__battle.vehicles.some(vehicle => vehicle.team === 'enemy' &&
    vehicle.aiFlight?.shots > 0) || !document.getElementById('fatal').hidden, null, { timeout: 90000 });
  const later = await page.evaluate(() => window.__battle);
  const enemy = later.vehicles.find(vehicle => vehicle.team === 'enemy' && vehicle.type === 'plane');
  assert.ok(enemy.aiFlight.shots > 0);
  assert.ok(enemy.speed > 0);
  assert.ok(!errors.length, errors.join('\n'));
  const result = { passed: true, enemyShots: enemy.aiFlight.shots, enemyPosition: enemy.position,
    initialPopulation: { friendly: initial.population.friendly.alive, enemy: initial.population.enemy.alive } };
  await writeFile(join(directory, 'aircraft-gameplay.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
