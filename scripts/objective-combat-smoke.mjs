import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], samples = [], shots = new Map();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5204/');
  if (process.env.PRODUCTION !== '1') { url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938'); }
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#squad-choices [data-type="tank"]').click(); await page.locator('#deploy').click();
  const start = await page.evaluate(() => ({ time: window.__battle.time, friends: window.__battle.friendlyPositions,
    population: window.__battle.population }));
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z < 45, null, { timeout: 30000 }); await page.keyboard.up('w');
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    const data = await page.evaluate(() => ({ time: window.__battle.time, state: window.__battle.state,
      objectives: window.__battle.objectives, friends: window.__battle.friendlyPositions, enemies: window.__battle.enemyPositions }));
    samples.push(data);
    for (const [team, actors] of [['friendly', data.friends], ['enemy', data.enemies]]) for (const actor of actors) {
      const shot = actor.aiRifle.lastShot;
      if (shot) shots.set(`${actor.soldierId}-${shot.shots}`, { team, id: actor.soldierId, ...shot });
    }
    if (data.time - start.time >= 60 || ['victory', 'defeat'].includes(data.state)) break;
    await page.waitForTimeout(200);
  }
  const objective = samples[0].objectives[0], progresses = new Map();
  for (const sample of samples) for (const actor of sample.friends) {
    const original = start.friends.find(item => item.soldierId === actor.soldierId);
    if (!original) continue;
    const progress = Math.hypot(original.x - objective.x, original.z - objective.z) - Math.hypot(actor.x - objective.x, actor.z - objective.z);
    progresses.set(actor.soldierId, Math.max(progresses.get(actor.soldierId) ?? 0, progress));
  }
  const advancing = [...progresses.values()].filter(progress => progress > 12).length;
  const entrants = new Set(samples.flatMap(sample => sample.friends.filter(actor =>
    Math.hypot(actor.x - objective.x, actor.z - objective.z) < objective.radius).map(actor => actor.soldierId)));
  assert.ok(advancing >= 12, `real objective advances required, observed ${advancing}`);
  assert.ok(entrants.size >= 6, `multiple soldiers must actually enter the capture area, observed ${entrants.size}`);
  assert.ok(samples.some(sample => sample.friends.some(actor => actor.mode === 'advance-to-objective')));
  const accepted = [...shots.values()];
  assert.ok(accepted.some(shot => shot.team === 'friendly') && accepted.some(shot => shot.team === 'enemy'));
  const bySoldier = new Map();
  for (const shot of accepted.sort((a, b) => a.time - b.time)) {
    const previousFar = bySoldier.get(shot.id);
    if (shot.distance > 35) {
      if (previousFar) assert.ok(shot.requiredSeconds >= 6 && shot.time - previousFar.time >= 6,
        `far follow-up cannot bypass stable aim: ${JSON.stringify({ shot, previousFar })}`);
      assert.equal(shot.continuingBurst, false);
      bySoldier.set(shot.id, shot);
    }
    assert.ok(shot.distance <= 75 && shot.aimedSeconds + 1e-8 >= shot.requiredSeconds);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(directory, 'objective-battle.png') });
  console.log(JSON.stringify({ passed: true, advancing, captureEntrants: entrants.size, shots: accepted.length,
    farShots: accepted.filter(shot => shot.distance > 35).length,
    closeShots: accepted.filter(shot => shot.distance <= 35).length }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, shots: [...shots.values()], errors }, null, 2));
  await browser.close();
}
