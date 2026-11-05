import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required for real capture-transition evidence');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const samples = [], cases = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.search = '?benchmark=full&seed=1938';
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu');
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click(); await page.waitForFunction(() => window.__battle.state === 'playing');
  assert.equal(await page.evaluate(() => window.__battle.benchmark?.scenario), 'full', 'use the development full-battle fixture');
  let previous = null, success = null;
  const deadline = Date.now() + 420000;
  while (Date.now() < deadline) {
    const data = await page.evaluate(() => {
      const state = window.__battle;
      return { time: state.time, state: state.state, objectives: state.objectives,
        units: state.population.units.filter(unit => unit.team === 'friendly' && !unit.player),
        friendly: state.friendlyPositions.map(actor => ({ soldierId: actor.soldierId, formationId: actor.formationId,
          x: actor.x, z: actor.z, mode: actor.mode, objectiveId: actor.objectiveId, speed: actor.movement.speed })),
        population: { friendly: state.population.friendly.alive, enemy: state.population.enemy.alive } };
    });
    samples.push(data);
    if (!previous) assert.deepEqual(data.population, { friendly: 110, enemy: 98 });
    assert.deepEqual(errors, []);
    if (previous) for (const point of data.objectives) {
      if (point.owner !== 'friendly' || previous.objectives.find(old => old.id === point.id).owner === 'friendly') continue;
      const units = previous.units.filter(unit => unit.objectiveId === point.id && unit.alive > 0);
      if (units.length < 2) continue;
      cases.push({ point: point.id, time: data.time, units: units.map(unit => unit.id),
        original: Object.fromEntries(previous.friendly.filter(actor => units.some(unit => unit.id === actor.formationId))
          .map(actor => [actor.soldierId, actor])),
        reassigned: {}, moved: {} });
      await page.screenshot({ path: join(directory, `captured-${point.id}-${Math.floor(data.time)}.png`) });
    }
    for (const event of cases) {
      for (const unit of data.units.filter(unit => event.units.includes(unit.id) && unit.alive > 0 &&
        unit.objectiveId !== event.point && unit.objectiveId !== null)) {
        event.reassigned[unit.id] ??= { to: unit.objectiveId, at: data.time };
      }
      for (const actor of data.friendly) {
        const old = event.original[actor.soldierId], assignment = event.reassigned[actor.formationId];
        if (!old || !assignment) continue;
        const point = data.objectives.find(point => point.id === assignment.to);
        const travel = Math.hypot(actor.x - old.x, actor.z - old.z);
        const progress = Math.hypot(old.x - point.x, old.z - point.z) - Math.hypot(actor.x - point.x, actor.z - point.z);
        if (travel >= 3 && progress >= 2.5) event.moved[actor.soldierId] = { travel, progress, time: data.time };
      }
      const reassigned = Object.values(event.reassigned);
      if (!event.handoff && reassigned.length) {
        event.handoff = { time: data.time, guards: data.units.filter(unit => unit.alive > 0 && unit.objectiveId === event.point).map(unit => unit.id) };
      }
      const moved = Object.values(event.moved).filter(move => move.time <= event.time + 12);
      if (event.handoff?.guards.length === 1 && reassigned.some(assignment => assignment.at <= event.time + 1.5) && moved.length >= 4) success = event;
    }
    if (success || data.time > 240 || ['victory', 'defeat', 'draw'].includes(data.state)) break;
    previous = data;
    await page.waitForTimeout(350);
  }
  assert.ok(cases.length, 'observe an actual friendly capture involving more than one autonomous squad');
  assert.ok(success, 'surplus squads retask within 1.5 seconds and at least four actual soldiers advance over 3m toward the next objective within 12 seconds');
  await page.screenshot({ path: join(directory, 'actual-next-objective-advance.png') });
  await page.keyboard.down('Tab'); await page.screenshot({ path: join(directory, 'historical-unit-scoreboard.png') });
  console.log(JSON.stringify({ passed: true, capture: success.point, capturedAt: success.time,
    handoff: success.handoff, reassigned: success.reassigned, moved: success.moved }));
} finally {
  await writeFile(join(directory, 'capture-observations.json'), JSON.stringify({ samples, cases, errors }, null, 2));
  await browser.close();
}
