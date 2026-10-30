import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  const probes = await page.evaluate(async () => {
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const results = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      for (const direction of [-1, 1]) {
        const view = await load();
        const actor = { id: `turn-${team}-${direction}`, unitId: 'turn-probe', team, groundType: 'infantry',
          health: 100, heading: 0, stance: 'standing', walkPhase: 0, tactics: {},
          position: view.root.position.clone(), locomotion: { speed: 0, mode: 'turn' }, rifle: createRifleState() };
        actor.nativeMotion = createNraMotion(view.motionProfile, actor);
        view.bind(actor.id);
        const stages = new Set(), lifts = [];
        for (let frame = 0; frame < 120; frame++) {
          actor.heading += direction * 1.5 / 60;
          advanceNraMotion(actor, 1 / 60);
          view.update(actor, 0, null);
          const snapshot = view.snapshot;
          if (snapshot.issue) throw new Error(snapshot.issue);
          for (const side of ['left', 'right']) {
            const foot = snapshot.gait.legPose[side];
            stages.add(foot.phase); lifts.push(foot.requestedLift);
            if (foot.error > .01) throw new Error('Turning foot IK lost contact');
          }
          const muzzle = snapshot.riflePose.muzzle, logical = snapshot.logicalMuzzle;
          if (Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z) > 1e-4) {
            throw new Error('Turning changed the authoritative muzzle');
          }
        }
        const paused = JSON.stringify(actor.nativeMotion);
        advanceNraMotion(actor, 0); sampleNraMotion(actor);
        results.push({ team, direction, stages: [...stages], maximumLift: Math.max(...lifts),
          paused: JSON.stringify(actor.nativeMotion) === paused, speed: actor.nativeMotion.speed });
      }
    }
    return results;
  });
  for (const probe of probes) {
    assert.ok(probe.stages.includes('turn-swing') && probe.stages.includes('turn-support'));
    assert.ok(probe.maximumLift > .04 && probe.maximumLift <= .055);
    assert.equal(probe.speed, 0);
    assert.equal(probe.paused, true);
  }
  const runs = await page.evaluate(async () => {
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const results = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const view = await load();
      const actor = { id: `run-${team}`, unitId: 'run-probe', team, groundType: 'infantry',
        health: 100, heading: 0, stance: 'standing', walkPhase: 0, tactics: {},
        position: view.root.position.clone(), locomotion: { speed: 0, mode: 'jog' }, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(view.motionProfile, actor);
      view.bind(actor.id);
      for (const speed of [3.15, 4.8]) {
        actor.locomotion.speed = speed;
        const samples = [];
        for (let frame = 0; frame < 180; frame++) {
          actor.position.z -= speed / 60;
          advanceNraMotion(actor, 1 / 60); view.update(actor, 0, null);
          const snapshot = view.snapshot;
          if (snapshot.issue) throw new Error(snapshot.issue);
          const muzzle = snapshot.riflePose.muzzle, logical = snapshot.logicalMuzzle;
          if (Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z) > 1e-4) {
            throw new Error('Running lean changed the authoritative muzzle');
          }
          if (frame >= 120) samples.push({
            phase: snapshot.gait.legPose.left.phase, foot: snapshot.leftFoot,
            lean: snapshot.gait.bodyLean,
          });
        }
        let supportSlip = 0, supportPairs = 0;
        for (let frame = 1; frame < samples.length; frame++) {
          const a = samples[frame - 1], b = samples[frame];
          if (a.phase !== 'support' || b.phase !== 'support') continue;
          supportSlip = Math.max(supportSlip, Math.hypot(a.foot[0] - b.foot[0], a.foot[2] - b.foot[2]));
          supportPairs++;
        }
        results.push({ team, speed, lean: samples.at(-1).lean, supportSlip, supportPairs });
      }
    }
    return results;
  });
  for (const run of runs) {
    assert.ok(run.lean >= (run.speed > 4 ? .60 : .40), JSON.stringify(run));
    assert.ok(run.supportPairs > 3, 'observe real planted frames');
    assert.ok(run.supportSlip < .012, `planted foot cannot skate with the running body: ${JSON.stringify(run)}`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', runs, turning: 'Both native skeletons, left/right, muzzle alignment and pause' }));
} finally {
  await browser.close();
}
