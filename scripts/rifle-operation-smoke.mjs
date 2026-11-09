import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__rifle-operation', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto(new URL('/__rifle-operation', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, nativeEyeLocal } = await import('/src/nra-motion.js');
    const { createRifleState, rifleReloadSeconds, shootRifle } = await import('/src/rifle-action.js');
    const output = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0), view = template.createView();
      for (const [action, ammo] of [['cycle', 4], ['reload', 0], ['reload', 2]]) {
        const actor = { id: `${team}-${action}-${ammo}`, team, index: 1, unitId: 'operation-review',
          formation: { type: 'infantry', memberCount: 11 }, health: 100, stance: 'standing',
          position: new T.Vector3(), heading: 0, walkPhase: 0, tactics: {},
          locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState() };
        Object.assign(actor.rifle, { action, ammo });
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        view.bind(actor.id);
        const duration = action === 'cycle' ? .65 : rifleReloadSeconds(actor.rifle);
        let issues = 0, maxPalmError = 0;
        for (let frame = 0; frame <= 60; frame++) {
          actor.rifle.elapsed = duration * frame / 60;
          view.update(actor, actor.rifle.elapsed, null);
          if (view.issue) issues++;
          maxPalmError = Math.max(maxPalmError, view.snapshot.riflePose.right.palmError);
        }
        output.push({ team, action, ammo, issues, maxPalmError });
      }
      const actor = { id: `${team}-recoil`, team, index: 1, unitId: 'recoil-review',
        formation: { type: 'infantry', memberCount: 11 }, health: 100, stance: 'standing',
        position: new T.Vector3(), heading: 0, walkPhase: 0, tactics: {}, rifleReady: true,
        locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
      view.bind(actor.id);
      const capture = elapsed => {
        actor.rifle.elapsed = elapsed; view.update(actor, elapsed, null);
        const snapshot = view.snapshot, logical = snapshot.logicalMuzzle, muzzle = snapshot.riflePose.muzzle;
        const eye = nativeEyeLocal(actor);
        return { head: snapshot.head, eye, muzzleError:
          Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z),
          rightPalmError: snapshot.riflePose.right.palmError, leftPalmError: snapshot.riflePose.left.palmError,
          issue: view.issue };
      };
      if (!shootRifle(actor.rifle)) throw new Error('Rifle shot failed');
      const atShot = capture(0), peak = capture(.025), recovered = capture(.13);
      output.push({ team, action: 'recoil', atShot, peak, recovered });
    }
    return output;
  });
  for (const result of results) {
    if (result.action === 'recoil') {
      for (const sample of [result.atShot, result.peak, result.recovered]) {
        assert.equal(sample.issue, null, JSON.stringify(result));
        assert.ok(sample.muzzleError < .0001 && sample.rightPalmError < .005 && sample.leftPalmError < .005,
          JSON.stringify(result));
      }
      assert.ok(Math.hypot(...result.peak.head.map((v, i) => v - result.atShot.head[i])) > .0001,
        `${result.team}: actual head must react to recoil`);
      assert.ok(Math.hypot(...result.peak.eye.map((v, i) => v - result.atShot.eye[i])) > .0001,
        `${result.team}: simulated eye must react to recoil`);
      continue;
    }
    assert.equal(result.issues, 0, JSON.stringify(result));
    assert.ok(result.maxPalmError <= .005, JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results }));
} finally { await browser.close(); }
