import { deployFromMenu } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await deployFromMenu(page);
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z < 42, null, { timeout: 25000 });
  await page.keyboard.up('w');
  const started = Date.now();
  while (Date.now() - started < 100000) {
    const data = await page.evaluate(() => window.__battle);
    samples.push({ time: data.time, state: data.state, enemies: data.enemyPositions, claims: data.coverClaims });
    const claimed = new Set(samples.flatMap(sample => sample.enemies.filter(actor => actor.coverId).map(actor => actor.id)));
    const peeking = samples.some(sample => sample.enemies.some(actor => actor.mode === 'peek' || actor.mode === 'cover'));
    if (claimed.size >= 2 && peeking) break;
    if (data.state === 'dead' || data.state === 'defeat') break;
    await page.waitForTimeout(500);
  }
  const states = new Set(samples.flatMap(sample => sample.enemies.map(actor => actor.mode)));
  const coverActors = new Set(samples.flatMap(sample => sample.enemies.filter(actor => actor.coverId).map(actor => actor.id)));
  for (const sample of samples) {
    assert.equal(new Set(sample.claims.map(claim => claim.id)).size, sample.claims.length, 'one cover slot has one owner');
    const occupied = sample.enemies.filter(actor => actor.coverId).map(actor => actor.coverId);
    assert.equal(new Set(occupied).size, occupied.length, 'two live enemies cannot retain the same cover assignment');
    assert.ok(sample.enemies.every(actor => Number.isFinite(actor.x) && Number.isFinite(actor.z)));
    assert.ok(sample.enemies.every(actor => actor.bodyScaleY === 1), 'combat roles never squash or stretch the whole soldier to fake crouching');
  }
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'tactics-measurements.json'), JSON.stringify(samples, null, 2));
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'tactics-live.png') });
  }
  assert.ok(new Set(samples.flatMap(sample => sample.enemies.map(actor => actor.squad))).size >= 2, 'distinct spawned squads preserve separate approach roles');
  assert.ok(coverActors.size >= 2, `multiple real enemies claim cover; observed: ${JSON.stringify([...states])}`);
  assert.ok(states.has('peek') || states.has('cover'), `actors actually reach their cover rather than merely reserving it: ${JSON.stringify([...states])}`);
  assert.deepEqual(errors, []);
  console.log(`PASS: live combat produced ${coverActors.size} cover-using enemy actors; observed states: ${[...states].join(', ')}.`);
} finally {
  await browser.close();
}
