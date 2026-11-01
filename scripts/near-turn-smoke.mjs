import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.route(new URL('/__near-turn-check', base).href, route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(new URL('/__near-turn-check', base).href);
  const observations = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
    const { advanceAITurn, headingError } = await import('/src/ai-turning.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials(1);
    const template = await loadNraCharacter(), cases = [];
    for (const hz of [30, 60, 144]) for (const direction of [-1, 1]) {
      const view = template.createView();
      const actor = { id: 'near-turn', team: 'friendly', friendly: true, health: 100, heading: 0,
        position: new T.Vector3(0, 0, 80), walkPhase: 0, stance: 'standing', tactics: { id: 1 },
        rifle: createRifleState(), rifleReady: false, locomotion: { speed: 0, mode: 'idle' } };
      actor.nativeMotion = createNraMotion(view.motionProfile, actor);
      view.bind(actor.id); view.update(actor, 0, null);
      const rest = view.snapshot;
      let lift = 0, kneeMovement = 0, maximumFootStep = 0, maximumHipDrop = 0, completionTime = null, previous = rest;
      for (let frame = 1; frame <= hz * 2; frame++) {
        advanceAITurn(actor, direction * (Math.PI - .001), 1 / hz);
        if (completionTime === null && Math.abs(headingError(actor.heading, direction * (Math.PI - .001))) < .001) {
          completionTime = frame / hz;
        }
        advanceNraMotion(actor, 1 / hz);
        view.update(actor, frame / hz, null);
        const current = view.snapshot;
        if (current.issue) throw new Error(current.issue);
        if (current.active !== 'idle' || current.motion.weight !== 0) throw new Error('A stationary turn cannot invent running');
        maximumHipDrop = Math.max(maximumHipDrop, rest.hips[1] - current.hips[1]);
        for (const side of ['left', 'right']) {
          const foot = current[`${side}Foot`], knee = current[`${side}Knee`];
          if (![...foot, ...knee].every(Number.isFinite)) throw new Error('Nonfinite near-body joint');
          const step = current.gait.legPose[side];
          if (step) lift = Math.max(lift, step.requestedLift);
          kneeMovement = Math.max(kneeMovement, Math.hypot(...knee.map((value, axis) => value - rest[`${side}Knee`][axis])));
          maximumFootStep = Math.max(maximumFootStep, Math.hypot(...foot.map((value, axis) => value - previous[`${side}Foot`][axis])));
        }
        previous = current;
      }
      const paused = JSON.stringify(view.snapshot);
      advanceNraMotion(actor, 0); view.update(actor, 2, null);
      if (JSON.stringify(view.snapshot) !== paused) throw new Error('Paused near pose drifted');
      cases.push({ hz, direction, lift, kneeMovement, maximumFootStep, hipDrop: maximumHipDrop, completionTime,
        distance: actor.nativeMotion.distance, issue: view.snapshot.issue });
    }
    return cases;
  });
  assert.deepEqual(errors, []);
  for (const sample of observations) {
    assert.equal(sample.issue, null);
    assert.equal(sample.distance, 0);
    assert.ok(sample.completionTime > .7 && sample.completionTime <= .8, 'a half-turn must finish in under 0.8 seconds');
    assert.ok(sample.lift > .025 && sample.lift <= .055, 'turning must visibly lift the swing foot');
    assert.ok(sample.kneeMovement > .03, 'knees cannot stay rigid during the turn');
    assert.ok(sample.hipDrop > .04 && sample.hipDrop <= .046, 'turns keep a small grounded knee bend');
    assert.ok(sample.maximumFootStep < .12, 'feet cannot jump across the near view');
  }
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'near-turn.json'), JSON.stringify(observations, null, 2));
  }
  console.log(JSON.stringify({ passed: true, observations }));
} finally {
  await browser.close();
}
