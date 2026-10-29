import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const directory = process.env.ARTIFACT_DIR;
let poseChecks = 0;
try {
  if (directory) await mkdir(directory, { recursive: true });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'duel'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  const poses = await page.evaluate(async () => {
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createBayonetState } = await import('/src/bayonet.js');
    const view = await loadIjaCharacter(), results = [];
    const actor = { id: 'bayonet-probe', unitId: 'probe-unit', team: 'enemy', groundType: 'infantry',
      position: view.root.position.clone(), heading: .7, walkPhase: 0, health: 100, stance: 'standing',
      locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), bayonet: createBayonetState() };
    actor.nativeMotion = createNraMotion(view.motionProfile, actor);
    view.bind(actor.id);
    for (const speed of [0, 1.75, 3.15, 4.8]) for (let phase = 0; phase < 6; phase++) {
      for (const extension of [0, .25, .5, .75, 1]) {
        Object.assign(actor.nativeMotion, { speed, weight: speed ? 1 : 0, distance: phase / 6 * 2.55,
          gaitCharge: speed === 4.8 ? 1 : 0, gaitAim: 0, aim: 0, bodyLean: speed === 4.8 ? .34 : speed ? .21 : 0 });
        Object.assign(actor.bayonet, { mode: speed ? 'charge' : 'thrust', extension });
        view.update(actor, 0, null);
        const snapshot = view.snapshot;
        const muzzle = snapshot.riflePose.muzzle, logical = snapshot.logicalMuzzle;
        results.push({ speed, phase, extension, issue: snapshot.issue, bayonet: snapshot.bayonet,
          muzzleError: Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z) });
      }
    }
    // While rising, retain the reachable original posture carry rather than stretching arms to a standing rifle.
    for (const stance of ['prone', 'crouched']) for (const weight of [1, .75, .5, .25, .05]) {
      Object.assign(actor.nativeMotion, { speed: 0, weight: 0, bodyLean: 0 });
      for (const key of Object.keys(actor.nativeMotion.posture)) actor.nativeMotion.posture[key] = key === stance ? weight : 0;
      view.update(actor, 0, null);
      results.push({ stance, weight, issue: view.snapshot.issue, intent: sampleNraMotion(actor).intent,
        bayonet: view.snapshot.bayonet, muzzleError: 0 });
    }
    return results;
  });
  for (const pose of poses) {
    assert.equal(pose.issue, null, JSON.stringify(pose));
    assert.equal(pose.bayonet, true);
    assert.ok(pose.muzzleError < 1e-4);
  }
  poseChecks = poses.length;
  await page.locator('#deploy').click();
  await page.keyboard.down('w');
  const deadline = Date.now() + 30000;
  let capturedCharge = false, capturedHit = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(60);
    const sample = await page.evaluate(() => {
      const data = window.__battle;
      return { time: data.time, state: data.state, health: data.health, position: data.position,
        selectedId: data.control.soldierId,
        victims: data.allies.map(actor => ({ id: actor.id, health: actor.health })),
        actors: data.enemyPositions.map(actor => ({ id: actor.soldierId, x: actor.x, z: actor.z,
          speed: actor.speed, bayonet: actor.bayonet, shots: actor.rifle.shots, blocked: actor.aiRifle.blocked })),
        views: data.enemyHistoricalForce.views.filter(view => view.soldier.health > 0)
          .map(view => ({ id: view.actorId, issue: view.issue, bayonet: view.bayonet })) };
    });
    samples.push(sample);
    if (sample.position?.z < 26 || sample.state !== 'playing') await page.keyboard.up('w');
    const charging = sample.actors.filter(actor => actor.bayonet.mode !== 'idle');
    for (const actor of charging) assert.equal(actor.blocked, 'bayonet');
    for (const view of sample.views) { assert.equal(view.bayonet, true); assert.equal(view.issue, null); }
    if (!capturedCharge && charging.some(actor => actor.speed > 4)) {
      capturedCharge = true;
      if (directory) await page.screenshot({ path: join(directory, 'bayonet-charge.png') });
    }
    if (charging.some(actor => actor.bayonet.hits > 0)) {
      capturedHit = true;
      assert.ok(charging.some(actor => actor.bayonet.hits > 0 &&
        sample.victims.some(target => target.id === actor.bayonet.targetId && target.health <= 35)),
      'a confirmed stab must actually apply its damage to the owned target');
      if (directory) await page.screenshot({ path: join(directory, 'bayonet-hit.png') });
      break;
    }
  }
  await page.keyboard.up('w');
  assert.ok(capturedCharge, 'real AI must sprint towards a close visible target');
  assert.ok(capturedHit, 'real AI must complete its windup and land a melee hit');
  for (let index = 1; index < samples.length; index++) for (const actor of samples[index].actors.filter(actor => actor.bayonet.mode !== 'idle')) {
    const before = samples[index - 1].actors.find(other => other.id === actor.id && other.bayonet.mode !== 'idle');
    if (before && actor.bayonet.targetId === before.bayonet.targetId) assert.equal(actor.shots, before.shots, 'no rifle shots during melee');
  }
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => ({ time: window.__battle.time, states: window.__battle.enemyPositions.map(actor => actor.bayonet) }));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ time: window.__battle.time, states: window.__battle.enemyPositions.map(actor => actor.bayonet) })), paused);
  await page.locator('#back-menu').click();
  await page.locator('#deploy').click();
  assert.ok((await page.evaluate(() => window.__battle.enemyPositions)).every(actor => actor.bayonet.strikes === 0 && actor.bayonet.mode === 'idle'));
  assert.deepEqual(errors, []);
  console.log(`PASS: ${poseChecks} native pose checks, actual AI sprint/thrust/damage, no melee gunfire, pause and clean redeployment.`);
} finally {
  try {
    if (directory) await writeFile(join(directory, 'bayonet-observations.json'), JSON.stringify({ poseChecks, samples, errors }, null, 2));
  } finally { await browser.close(); }
}
