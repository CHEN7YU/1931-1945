import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TYPES } from '../src/core.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
function record(stage, data) {
  observations.push({ stage, time: data.time, state: data.state, position: data.position, health: data.health,
    stats: data.combatStats, vehicles: data.vehicles,
    crew: data.allies.map(actor => ({ id: actor.id, health: actor.health, kind: actor.targetKind, deathSource: actor.deathSource })),
    selectedAircraftTargets: data.enemyPositions.filter(actor => actor.targetKind === 'aircraft').map(actor => actor.id) });
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#squad-choices [data-type="plane"]').click();
  await page.locator('#deploy').click();
  const initial = await snapshot(), planeId = initial.vehicles.find(vehicle => vehicle.team === 'friendly' && vehicle.type === 'plane').id;
  assert.equal(initial.benchmark?.scenario, 'full');
  assert.equal(initial.population.friendly.alive, 100, 'one actual pilot replaces an eleven-person infantry unit');
  assert.equal(initial.population.enemy.alive, 98);
  assert.equal(initial.health, TYPES.plane.health);
  assert.ok(initial.allies.every(actor => actor.targetKind === 'aircraft'));
  record('air-entry', initial);
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const pitch = window.__battle.look.pitch;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: pitch / .00132 }));
  });
  await page.mouse.up({ button: 'right' });
  assert.ok(Math.abs((await snapshot()).look.pitch) < .002, 'normal pitch input levels the initial descending flight before the flyover');
  await page.waitForFunction(() => window.__battle.combatStats.rifleAircraftCandidatesIgnored > 0, null, { timeout: 15000 });
  const start = await snapshot();
  while ((await snapshot()).time < start.time + 3) {
    const data = await snapshot();
    record('flyover', data);
    assert.equal(data.state, 'playing');
    assert.equal(data.health, TYPES.plane.health, 'ordinary riflemen cannot damage the moving aircraft');
    assert.equal(data.allies[0].health, initial.allies[0].health, 'seated pilot health is not secretly reduced instead of the hull');
    assert.equal(data.combatStats.aiRifleShotsAtAircraft, 0);
    assert.ok(data.enemyPositions.every(actor => actor.targetKind !== 'aircraft'), 'aircraft are not selected for rifle engagement');
    await page.waitForTimeout(150);
  }
  const airborne = await snapshot();
  assert.ok(airborne.combatStats.rifleAircraftCandidatesIgnored > 0, 'the plane actually enters hostile candidate queries');
  assert.ok(airborne.position.z < initial.position.z - 30, 'the real aircraft is flying, not a parked fixture');
  await page.keyboard.down('Control');
  await page.waitForFunction(() => window.__battle.state === 'dead', null, { timeout: 10000 });
  await page.keyboard.up('Control');
  const crashed = await snapshot(), wreck = crashed.vehicles.find(vehicle => vehicle.id === planeId);
  record('actual-crash', crashed);
  assert.equal(wreck.health, 0, 'non-rifle crash damage still destroys the aircraft');
  assert.equal(crashed.allies[0].health, 0);
  assert.equal(crashed.allies[0].deathSource.cause, 'crash');
  assert.equal(crashed.allies[0].deathSource.credit, 'environment');
  await page.waitForFunction(() => window.__battle.combatStats.aiRifleShots > 0, null, { timeout: 30000 });
  const groundCombat = await snapshot();
  record('ground-rifles-still-active', groundCombat);
  assert.equal(groundCombat.combatStats.aiRifleShotsAtAircraft, 0);
  assert.equal(groundCombat.combatStats.aiRifleShotsAtArmor, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real flight enters hostile queries without rifle targeting/damage; real crash and ground rifle combat remain active.');
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'aircraft-rifle-observations.json'), JSON.stringify({ observations, errors }, null, 2));
    }
  } finally { await browser.close(); }
}
