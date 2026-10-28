import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const samples = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  const initial = await page.evaluate(() => window.__battle);
  assert.equal(initial.population.friendly.alive, 110);
  assert.equal(initial.population.enemy.alive, 110);
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z <= 42 || window.__battle.state === 'dead', null, { timeout: 40000 });
  await page.keyboard.up('w');
  const started = Date.now();
  while (Date.now() - started < 60000) {
    const sample = await page.evaluate(() => {
      const data = window.__battle;
      return { time: data.time, state: data.state, friends: data.friendlyPositions, claims: data.coverClaims,
        shots: data.combatStats.aiRifleShots };
    });
    samples.push(sample);
    if (samples.some(item => item.friends.some(actor => actor.movement.sprinting &&
      ['rush-to-cover', 'withdraw-to-cover'].includes(actor.mode))) &&
      samples.some(item => item.friends.some(actor => actor.mode === 'withdraw-to-cover' && item.time < actor.suppressedUntil)) &&
      sample.friends.some(actor => actor.lastShot?.mode === 'peek') &&
      new Set(samples.flatMap(item => item.friends.filter(actor => actor.enteredCover && actor.cover &&
        Math.hypot(actor.x - actor.cover.x, actor.z - actor.cover.z) < .28).map(actor => actor.id))).size >= 2) break;
    if (sample.state === 'victory' || sample.state === 'defeat') break;
    await page.waitForTimeout(150);
  }
  const actors = samples.flatMap(sample => sample.friends);
  const rushes = actors.filter(actor => actor.movement.sprinting &&
    ['rush-to-cover', 'withdraw-to-cover'].includes(actor.mode));
  assert.ok(rushes.length > 0, 'normal friendly AI actually rushes towards real cover');
  assert.ok(rushes.some(actor => actor.movement.speed > 3.25 && actor.movement.stamina < .99),
    'actual faster displacement spends personal stamina, not just a sprint label');
  assert.ok(new Set(actors.filter(actor => actor.enteredCover && actor.cover &&
    Math.hypot(actor.x - actor.cover.x, actor.z - actor.cover.z) < .28).map(actor => actor.id)).size >= 2,
    'multiple living friendlies physically reach cover');
  assert.ok(samples.some(item => item.friends.some(actor => actor.mode === 'withdraw-to-cover' && item.time < actor.suppressedUntil)),
    'actual suppressed friendlies return to cover instead of only advancing');
  assert.ok(actors.some(actor => actor.lastShot?.mode === 'peek'), 'a friendly physically reaches its firing peek and actually fires');
  for (const actor of actors.filter(actor => actor.lastShot)) {
    assert.ok(actor.lastShot.speed <= .1 && actor.lastShot.aimRecovery <= 0, 'actual accepted friendly shots require a stationary recovered weapon');
  }
  assert.ok(actors.every(actor => actor.bodyScaleY === 1 && actor.movement.stamina >= 0 && actor.movement.stamina <= 1));
  assert.ok(samples.at(-1).shots > samples[0].shots, 'the observed interval contains real fighting');
  assert.deepEqual(errors, []);
  console.log('PASS: real friendly cover rushes and stamina, multiple cover arrivals, withdrawals, stationary recovered rifle fire.');
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'friendly-tactics.json'), JSON.stringify({ samples, errors }, null, 2));
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'friendly-cover.png') });
    }
  } finally {
    await browser.close();
  }
}
