import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const samples = [], errors = [], shots = new Map(), photographed = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.search = '?benchmark=full&seed=1938';
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu' ||
    !document.querySelector('#fatal').hidden, null, { timeout: 90000 });
  assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').innerText());
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click(); await page.waitForFunction(() => window.__battle.state === 'playing');
  const initial = await page.evaluate(() => window.__battle);
  assert.equal(initial.population.friendly.alive, 110); assert.equal(initial.population.enemy.alive, 96);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const data = await page.evaluate(() => {
      const state = window.__battle;
      return { time: state.time, state: state.state, enemies: state.enemyPositions, friendly: state.friendlyPositions,
        near: state.enemyHistoricalForce.views, poseBanks: state.enemyHistoricalForce.poseBanks };
    });
    samples.push(data);
    for (const actor of data.enemies) if (actor.lastShot) shots.set(`${actor.soldierId}:${actor.lastShot.time}`, actor.lastShot);
    for (const view of data.near.filter(view => view.visible && view.soldier.health > 0)) {
      assert.equal(view.issue, null);
      assert.ok(view.riflePose.left.error < .015 && view.riflePose.right.error < .015);
      const pose = view.soldier.firingPose;
      if (pose && pose !== 'standing' && !photographed.has(pose)) {
        photographed.add(pose); await page.screenshot({ path: join(directory, `actual-enemy-${pose}.png`) });
      }
    }
    assert.equal(data.poseBanks, 44);
    assert.deepEqual(errors, []);
    if (data.time >= 140 || ['victory', 'defeat', 'draw'].includes(data.state)) break;
    await page.waitForTimeout(500);
  }
  const actual = [...shots.values()], poses = new Set(actual.map(shot => shot.firingPose));
  assert.ok(actual.length >= 10, 'observe real hostile shots, not just planned postures');
  assert.ok(poses.has('kneeling') || poses.has('crouched'), 'Japanese infantry really fire from a low posture');
  assert.ok(poses.has('prone'), 'a clear open distant lane permits actual hostile prone firing');
  assert.ok(actual.some(shot => shot.coverId && ['peek', 'wall-supported-fire', 'tank-peek'].includes(shot.mode)),
    'hostile infantry actually reach and fire from real shielding');
  const runners = samples.flatMap(sample => sample.enemies).filter(actor => actor.speed > 3.6 && actor.bodyLean > .38);
  assert.ok(runners.length >= 5, 'real fast hostile movement bends the torso, not just a mode label');
  console.log(JSON.stringify({ passed: true, hostileShots: actual.length, actualPoses: [...poses],
    coveredShots: actual.filter(shot => shot.coverId).length, fastBentSamples: runners.length }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, shots: [...shots.values()], errors }, null, 2));
  await browser.close();
}
