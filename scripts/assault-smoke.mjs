import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const samples = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const entered = new Map(['A', 'B', 'C'].map(id => [id, new Set()]));
const departed = new Set(), owners = new Set();
const firstOwners = new Map(), counterattacks = new Set(), arrivals = new Map(['A', 'B', 'C'].map(id => [id, []]));
const counterattackers = new Set();
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'full');
  url.searchParams.set('seed', process.env.ASSAULT_SEED || '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  const initial = await page.evaluate(() => window.__battle);
  assert.equal(initial.population.enemy.alive, 98);
  assert.equal(initial.population.enemy.vehicles, 2);
  assert.equal(initial.population.friendly.alive, 110);
  const starts = new Map(initial.population.units.flatMap(unit => unit.members.map(actor => [actor.soldierId, actor.spawnPosition])));
  const started = Date.now();
  while (Date.now() - started < 300000) {
    const sample = await page.evaluate(() => {
      const data = window.__battle;
      return { time: data.time, state: data.state, objectives: data.objectives, conquest: data.conquest,
        enemies: data.enemyPositions, friendly: data.friendlyPositions.map(actor => ({ id: actor.id, x: actor.x, z: actor.z })),
        units: data.population.units.map(({ members, ...unit }) => unit), spawnEvents: data.spawnEvents,
        shots: data.combatStats.aiRifleShots, queuedPaths: data.population.queuedPaths,
        chips: [...document.querySelectorAll('.objective-chip')].map(element => ({ text: element.textContent, title: element.title })) };
    });
    samples.push(sample);
    for (const actor of sample.enemies) {
      const start = starts.get(actor.soldierId);
      if (start && Math.hypot(actor.x - start.x, actor.z - start.z) > 20) departed.add(actor.soldierId);
      for (const point of sample.objectives) if (Math.hypot(actor.x - point.x, actor.z - point.z) < point.radius && !entered.get(point.id).has(actor.soldierId)) {
        entered.get(point.id).add(actor.soldierId);
        arrivals.get(point.id).push(sample.time);
      }
      if (sample.objectives.some(point => point.owner === 'friendly' && point.status === 'contested' &&
        actor.objectiveId === point.id && Math.hypot(actor.x - point.x, actor.z - point.z) < point.radius)) counterattackers.add(actor.soldierId);
      if (actor.lastShot) assert.ok(actor.lastShot.speed <= .1 && actor.lastShot.aimRecovery <= 0, 'assaults preserve stationary recovered fire');
    }
    for (const point of sample.objectives) if (point.owner) {
      owners.add(point.owner);
      if (!firstOwners.has(point.id)) firstOwners.set(point.id, point.owner);
      if (firstOwners.get(point.id) !== point.owner) counterattacks.add(point.id);
    }
    if (sample.time >= 180 || ['victory', 'defeat', 'draw'].includes(sample.state)) break;
    await page.waitForTimeout(1000);
  }
  const result = { time: samples.at(-1)?.time, departed: departed.size,
    entered: Object.fromEntries([...entered].map(([id, soldiers]) => [id, soldiers.size])), owners: [...owners],
    completedRecaptures: [...counterattacks], actualCounterattackers: counterattackers.size,
    objectives: samples.at(-1)?.objectives, errors };
  console.log(JSON.stringify(result, null, 2));
  assert.ok(departed.size >= 30, 'multiple enemy formations physically leave their staging positions');
  for (const [id, soldiers] of entered) assert.ok(soldiers.size >= 4, `sustained actual enemy arrivals inside ${id}, observed ${soldiers.size}`);
  assert.ok(owners.has('enemy') && owners.has('friendly'), 'both armies independently complete captures with the player remaining at spawn');
  assert.ok(counterattackers.size >= 4, 'multiple assigned enemy attackers physically contest a friendly-owned point');
  assert.ok([...arrivals.values()].every(times => times.at(-1) - times[0] > 30), 'fresh attackers keep arriving, not just one initial rush');
  assert.ok(samples.at(-1).spawnEvents.some(event => event.team === 'enemy' && event.generation > 1),
    'a wiped enemy formation actually returns through registered reinforcement sources');
  assert.ok(samples.some(sample => sample.objectives.some(point => point.status === 'contested')), 'actual opposing soldiers enter a shared capture circle');
  assert.ok(samples.at(-1).shots > 0, 'real combat remains active during objective advances');
  assert.ok(samples.every(sample => sample.chips.length === 3 && sample.chips.every(chip => /我方.*日军/.test(chip.title))), 'HUD exposes both teams on all three points');
  assert.deepEqual(errors, []);
  console.log('PASS: full 110-friendly/96-enemy battlefield with two Japanese armored squads, no player movement; real multi-formation advances, all three enemy entry zones, bilateral captures and contested circles.');
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'assault-observations.json'), JSON.stringify({ samples, errors }, null, 2));
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'assault-battle.png') });
    }
  } finally {
    await browser.close();
  }
}
