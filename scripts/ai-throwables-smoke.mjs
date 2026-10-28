import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OBJECTIVES } from '../src/core.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const directory = process.env.ARTIFACT_DIR, errors = [], warnings = [], samples = [], throws = new Map();
const armorOnly = process.env.ARMOR_ONLY === '1';
const audioSamples = [];
let audioWindow = -1;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning' && message.text().includes('casualty')) warnings.push(message.text());
});
const snapshot = () => page.evaluate(() => window.__battle);
let packageObserved = false, armoredTargetId = null;
const enemyPack = data => data.grenades.active.some(item => item.kind === 'explosive-pack' && item.source.team === 'enemy' &&
  item.throws > 0 && item.aiTargetId === armoredTargetId) ||
  data.grenades.history.some(item => item.type === 'throw' && item.kind === 'explosive-pack' &&
    item.source.team === 'enemy' && item.targetId === armoredTargetId);
async function load(scenario, type = 'infantry') {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.searchParams.set('benchmark', scenario); url.searchParams.set('seed', '1938');
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#menu-quality').selectOption('low');
  await page.locator(`#squad-choices [data-type="${type}"]`).click();
  await page.locator('#deploy').click(); await page.waitForFunction(() => window.__battle.state === 'playing');
}
function collect(data, phase) {
  for (const event of data.grenades.history) if (event.type === 'throw') throws.set(`${phase}:${event.id}`, event);
  samples.push({ phase, time: data.time, state: data.state, corpses: data.corpses,
    friendly: data.friendlyPositions, enemies: data.enemyPositions, scores: data.squadScores,
    aiShots: data.combatStats.aiRifleShots, grenades: data.grenades.history,
    controlledVehicle: phase === 'full' ? undefined : data.vehicles.find(vehicle => vehicle.id === armoredTargetId) });
  if (phase === 'full' && Math.floor(data.time / 10) !== audioWindow) {
    audioWindow = Math.floor(data.time / 10); audioSamples.push({ time: data.time, audio: data.rifleAudio });
  }
}
function crowding(records) {
  let people = 0, touching = 0, close = 0;
  for (const sample of records.filter(sample => sample.time >= 20 && sample.time <= 150 && (!sample.phase || sample.phase === 'full'))) {
    for (const team of ['friendly', 'enemies']) {
      const actors = sample[team].filter(actor => !['enemy-8', 'enemy-9'].includes(actor.formationId) &&
        !OBJECTIVES.some(point => Math.hypot(actor.x - point.x, actor.z - point.z) < point.radius));
      for (const actor of actors) {
        const nearest = Math.min(...actors.filter(other => other !== actor).map(other => Math.hypot(actor.x - other.x, actor.z - other.z)));
        people++; if (nearest < .9) touching++; if (nearest < 1.35) close++;
      }
    }
  }
  return { observations: people, touching: touching / people, close: close / people };
}
async function driveTo(x, z) {
  const began = Date.now();
  while (Date.now() - began < 45000) {
    const data = await snapshot();
    collect(data, 'armor-driving');
    if (enemyPack(data)) { packageObserved = true; break; }
    assert.equal(data.state, 'playing');
    const vehicle = data.vehicles.find(vehicle => vehicle.id === data.controlInput.owner.vehicleId);
    const dx = x - vehicle.position.x, dz = z - vehicle.position.z, distance = Math.hypot(dx, dz);
    if (distance < 1.7) break;
    const target = Math.atan2(-dx, -dz), error = Math.atan2(Math.sin(target - vehicle.heading), Math.cos(target - vehicle.heading));
    for (const [key, active] of [['a', error > .08], ['d', error < -.08], ['w', Math.abs(error) < .22]]) {
      if (active) await page.keyboard.down(key); else await page.keyboard.up(key);
    }
    await page.waitForTimeout(100);
  }
  for (const key of ['w', 'a', 'd']) await page.keyboard.up(key);
  if (packageObserved) return;
  const data = await snapshot(), vehicle = data.vehicles.find(vehicle => vehicle.id === data.controlInput.owner.vehicleId);
  assert.ok(Math.hypot(vehicle.position.x - x, vehicle.position.z - z) < 2,
    `normal WASD reaches the visible enemy approach: ${JSON.stringify({ goal: { x, z }, position: vehicle.position, heading: vehicle.heading })}`);
}
try {
  if (directory) await mkdir(directory, { recursive: true });
  let data, actual = [], density = null, baseline = null;
  if (!armorOnly) {
    await load('full');
    data = await snapshot();
    assert.equal(data.population.friendly.alive, 110); assert.equal(data.population.enemy.alive, 96);
    const started = Date.now();
    while (Date.now() - started < 260000) {
      data = await snapshot(); collect(data, 'full');
      assert.deepEqual(errors, []);
      if (data.time >= 150 || ['victory', 'defeat', 'draw'].includes(data.state)) break;
      await page.waitForTimeout(700);
    }
    assert.ok(data.time >= 150 || ['victory', 'defeat', 'draw'].includes(data.state),
      'full battle reaches 150 simulated seconds or a legitimate match result within the observation deadline');
    actual = [...throws.values()];
    assert.ok(actual.some(event => event.source.team === 'friendly' && event.source.credit === 'ally'));
    assert.ok(actual.some(event => event.source.team === 'enemy'));
    assert.ok(actual.every(event => event.source.weaponClass === event.kind));
    assert.ok(data.squadScores.some(row => row.total > 0), 'real kills reach the per-squad table');
    assert.equal(data.squadScores.filter(row => row.team === 'friendly').reduce((sum, row) => sum + row.total, 0), data.kills + data.teamKills);
    const moving = samples.flatMap(sample => sample.friendly).filter(actor => actor.movement?.speed > 2.5 && actor.bodyLean > .15);
    assert.ok(moving.length > 10, 'actual moving soldiers use a visible combat lean');
    assert.ok(data.corpses.count > 0);
    density = crowding(samples);
    if (process.env.CROWD_BASELINE) {
      baseline = crowding(JSON.parse(await readFile(process.env.CROWD_BASELINE, 'utf8')).samples);
      assert.ok(density.touching < baseline.touching && density.close < baseline.close,
        `non-objective crowding must improve against the actual saved battle: ${JSON.stringify({ density, baseline })}`);
    }
    if (directory) await page.screenshot({ path: join(directory, 'mixed-battle.png') });
    await page.keyboard.down('Tab'); await page.waitForTimeout(200);
    if (directory) await page.screenshot({ path: join(directory, 'actual-kill-breakdown.png') });
    await page.keyboard.up('Tab');
  }
  await load('control', 'tank');
  armoredTargetId = (await snapshot()).controlInput.owner.vehicleId;
  for (const point of [[0, 83], [0, 45], [0, 30]]) { await driveTo(...point); if (packageObserved) break; }
  const approached = Date.now();
  while (!packageObserved && Date.now() - approached < 60000) {
    data = await snapshot(); collect(data, 'armor');
    packageObserved ||= enemyPack(data);
    if (packageObserved || ['dead', 'defeat', 'victory'].includes(data.state)) break;
    await page.waitForTimeout(300);
  }
  assert.ok(packageObserved, 'observed hostile infantry actually spend their own pack against the approached friendly tank');
  assert.deepEqual(errors, []);
  if (directory) await page.screenshot({ path: join(directory, 'enemy-anti-tank-pack.png') });
  console.log(JSON.stringify({ passed: true, scope: armorOnly ? 'armor-only' : 'full-and-armor',
    throws: actual.map(event => ({ team: event.source.team, kind: event.kind })),
    corpses: samples.filter(sample => sample.phase === 'full').at(-1)?.corpses.count ?? null,
    constrainedCorpses: warnings.length, crowding: density, baseline, enemyPackAgainstPlayerTank: packageObserved }));
} finally {
  if (directory) await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, audioSamples, errors, warnings }, null, 2));
  await browser.close();
}
