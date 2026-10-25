import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing' && window.__battle.population.renderer.visible > 50, null, { timeout: 60000 });
  const initial = await snapshot();
  assert.equal(initial.allies.length, 10);
  assert.equal(initial.population.units.length, 20);
  assert.deepEqual(initial.population.friendly, { units: 10, rosterUnits: 10, alive: 100, vehicles: 0 });
  assert.deepEqual(initial.population.enemy, { units: 10, rosterUnits: 10, alive: 100, vehicles: 0 });
  assert.ok(initial.population.units.every(unit => unit.memberCount === 10 && unit.alive === 10));
  const members = initial.population.units.flatMap(unit => unit.members);
  assert.equal(new Set(members.map(actor => actor.id)).size, 200);
  const origins = new Map(initial.spawnPoints.map(point => [point.id, point]));
  for (const unit of initial.population.units) for (const actor of unit.members) {
    assert.ok(actor.spawnClear, `${unit.id} member starts inside a real obstacle`);
    assert.equal(origins.get(actor.spawnId)?.team, unit.team);
  }
  for (let i = 0; i < members.length; i++) for (let j = 0; j < i; j++) {
    assert.ok(Math.hypot(members[i].spawnPosition.x - members[j].spawnPosition.x, members[i].spawnPosition.z - members[j].spawnPosition.z) >= 1.25 - 1e-8, 'different soldiers do not spawn stacked');
  }
  assert.equal(await page.locator('#members .member').count(), 10);
  assert.match(await page.locator('#force-status').textContent(), /100人/);
  assert.ok(initial.population.renderer.batches <= 40, 'soldier rendering uses shared instance batches, not hundreds of per-soldier draws');
  await page.waitForFunction(time => window.__battle.time > time + 8, initial.time, { timeout: 60000 });
  const advanced = await snapshot();
  let movedUnits = 0;
  for (const unit of advanced.population.units.filter(unit => !unit.player)) {
    const old = initial.population.units.find(item => item.id === unit.id);
    if (unit.members.some(actor => {
      const before = old.members.find(item => item.id === actor.id);
      return before && Math.hypot(actor.x - before.x, actor.z - before.z) > 1;
    })) movedUnits++;
  }
  assert.equal(movedUnits, 19, 'all nineteen autonomous units act in the world, not just in the counters');
  await page.waitForFunction(() => {
    const data = window.__battle;
    return data.combatStats.aiRifleShots > 0 && (data.population.friendly.alive < 100 || data.population.enemy.alive < 100);
  }, null, { timeout: 120000 });
  const combat = await snapshot();
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(250);
  assert.equal((await snapshot()).time, paused.time);
  await page.evaluate(() => document.querySelector('#redeploy-choices [data-type="tank"]').click());
  assert.equal((await snapshot()).type, 'infantry', 'a living platoon cannot be replaced via hidden controls');
  await page.locator('#resume').click();
  await page.keyboard.press('y');
  assert.equal((await snapshot()).current, 1);
  await page.keyboard.down('Tab');
  assert.match(await page.locator('#scoreboard-stats').textContent(), /10单位/);
  await page.keyboard.up('Tab');
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'population-battle.png') });
    await writeFile(join(process.env.ARTIFACT_DIR, 'population-measurements.json'), JSON.stringify({
      initial: { friendly: initial.population.friendly, enemy: initial.population.enemy, participants: members.length },
      advanced: { movedUnits, performance: advanced.performance, rendering: advanced.population.renderer },
      combat: { time: combat.time, shots: combat.combatStats.aiRifleShots, friendly: combat.population.friendly, enemy: combat.population.enemy },
    }, null, 2));
  }
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  await page.locator('#squad-choices [data-type="tank"]').click(); await page.locator('#deploy').click();
  let data = await snapshot();
  assert.equal(data.population.friendly.units, 10);
  assert.equal(data.population.friendly.alive, 93);
  assert.equal(data.population.friendly.vehicles, 1);
  assert.equal(data.allies.length, 3);
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  await page.locator('#squad-choices [data-type="plane"]').click(); await page.locator('#deploy').click();
  data = await snapshot();
  assert.equal(data.population.friendly.alive, 91);
  assert.equal(data.population.friendly.vehicles, 1);
  assert.equal(data.allies.length, 1);
  assert.equal(data.population.enemy.alive, 100);
  assert.deepEqual(errors, []);
  console.log(`PASS: 200 actual members, 20 real units, ten-person control, safe origins, ${movedUnits} autonomous units moving, one selected vehicle and ${advanced.performance.drawCalls} draw calls / ${advanced.performance.averageFrameMs.toFixed(1)}ms observed mean frame.`);
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ state: data?.state, time: data?.time, forces: data?.population && { friendly: data.population.friendly, enemy: data.population.enemy },
    combat: data?.combatStats, pendingPaths: data?.population?.queuedPaths, modes: [...new Set((data?.enemyPositions || []).map(actor => actor.mode))] }));
  throw error;
} finally {
  await browser.close();
}
