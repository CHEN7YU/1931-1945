import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required for AI fire-control evidence');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173/');
  if (process.env.PRODUCTION !== '1') { url.searchParams.set('benchmark', 'control'); url.searchParams.set('seed', '1938'); }
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' && !document.querySelector('#menu').hidden,
    null, { timeout: 90000 });
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  const result = await page.evaluate(production => new Promise(resolve => {
    const shots = new Map(), reloads = new Map(), samples = [], deadline = performance.now() + 90000;
    function collect() {
      const data = window.__battle;
      for (const [team, actors] of [['friendly', data.friendlyPositions], ['enemy', data.enemyPositions]]) for (const actor of actors) {
        const shot = actor.aiRifle.lastShot;
        if (shot) shots.set(`${actor.soldierId}:${shot.shots}`, { team, soldierId: actor.soldierId, ...shot,
          speed: actor.lastShot?.time === shot.time ? actor.lastShot.speed : null,
          recovery: actor.lastShot?.time === shot.time ? actor.lastShot.aimRecovery : null });
        if (actor.rifle.action === 'reload') reloads.set(actor.soldierId, { team, soldierId: actor.soldierId, time: data.time, ...actor.rifle });
      }
      if (!samples.length || data.time - samples.at(-1).time >= 5) samples.push({
        time: data.time, state: data.state, health: data.health, population: data.population,
        shots: data.combatStats.aiRifleShots, observed: shots.size, reloads: reloads.size });
      const enough = [...shots.values()].some(shot => shot.shots >= 6) &&
        [...shots.values()].some(shot => shot.team === 'friendly') && [...shots.values()].some(shot => shot.team === 'enemy') &&
        (!production || ['friendly', 'enemy'].every(team => [...reloads.values()].some(actor => actor.team === team)));
      if (enough || performance.now() >= deadline) resolve({ shots: [...shots.values()], reloads: [...reloads.values()], samples });
      else setTimeout(collect, 80);
    }
    collect();
  }), process.env.PRODUCTION === '1');
  observations.push(result);
  assert.ok(result.shots.some(shot => shot.team === 'friendly'), 'actual friendly AI shots observed');
  assert.ok(result.shots.some(shot => shot.team === 'enemy'), 'actual enemy AI shots observed');
  assert.ok(result.reloads.some(actor => actor.ammo === 0 && actor.shots >= 5), 'an exhausted owned magazine really enters loading');
  assert.ok(result.shots.some(shot => shot.shots >= 6), 'the same real soldier fires beyond its first magazine');
  if (process.env.PRODUCTION === '1') for (const team of ['friendly', 'enemy']) {
    assert.ok(result.reloads.some(actor => actor.team === team), `actual ${team} AI loading observed in the full production battle`);
  }
  for (const shot of result.shots) {
    assert.ok(shot.aimedSeconds + 1e-8 >= shot.requiredSeconds);
    assert.ok(shot.requiredSeconds >= .45 || shot.requiredSeconds === 0 && shot.continuingBurst && shot.weaponModel !== 'rifle');
    assert.ok(shot.distance <= 75 && shot.ammo >= 0 && shot.ammo < shot.magazine);
    if (shot.speed !== null) assert.ok(shot.speed <= .1 && shot.recovery === 0);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause');
  const weapons = () => page.evaluate(() => {
    const data = window.__battle;
    return { time: data.time, actors: [...data.friendlyPositions, ...data.enemyPositions].map(actor =>
      ({ id: actor.soldierId, rifle: actor.rifle, aim: actor.aiRifle })) };
  });
  const paused = await weapons();
  await page.waitForTimeout(350);
  assert.deepEqual(await weapons(), paused, 'global pause freezes every AI action and aiming timer');
  await page.screenshot({ path: join(directory, 'paused.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, shots: result.shots.length, reloads: result.reloads.length,
    friendly: result.shots.filter(shot => shot.team === 'friendly').length,
    enemy: result.shots.filter(shot => shot.team === 'enemy').length }));
} finally {
  await page.screenshot({ path: join(directory, 'final.png') });
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
