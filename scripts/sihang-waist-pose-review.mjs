import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.WAIST_REUSE_BASELINE === '1') await page.route('**/src/nra-character.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const current = 'for (const leg of animatedLegs) { leg.bone.quaternion.copy(leg.rotation); leg.bone.position.copy(leg.position); }';
    const previous = 'for (const leg of animatedLegs) { leg.rotation.copy(leg.bone.quaternion); leg.position.copy(leg.bone.position); }';
    if (!source.includes(current)) throw new Error('Cannot reconstruct the pre-fix bind');
    await route.fulfill({ response, body: source.replace(current, previous) });
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.waistReview = {
        startNatural() {
          missionBriefing.hide(); keys.clear();
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          setGameState('playing');
        },
        naturalSnapshot() {
          return { time, stage: sihangCampaign.stage, state,
            views: nraCharacter.snapshot.views.map(view => ({ actorId: view.actorId, visible: view.visible,
              speed: view.speed, stance: view.stance, issue: view.issue, hips: view.hips, head: view.head })) };
        },
        setup(stance, rear, aiming = false, forceFar = false) {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const actor = friendlyAI.find(item => item.health > 0 && item.nativeMotion && !item.vehicleId);
          if (!actor) throw new Error('Expected a native friendly soldier');
          actor.position.set(-10, 0, -3); actor.heading = 0;
          actor.stance = stance; actor.firingPose = null; actor.rifleReady = aiming;
          stopLocomotion(actor.locomotion);
          for (let i = 0; i < 80; i++) advanceNraMotion(actor, .05);
          camera.position.set(-10, 1.35, rear ? -.7 : -5.3);
          camera.lookAt(-10, 1, -3); camera.updateMatrixWorld(true);
          nraCharacter.update([actor], time, entities.control.soldierId, graphics.snapshot.preset,
            { detailLimit: forceFar ? 0 : null });
          uniformExcludedIds.clear();
          for (const id of nraCharacter.excludedIds) uniformExcludedIds.add(id);
          soldierRenderer.update([actor], graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          const view = nraCharacter.snapshot.views.find(item => item.actorId === actor.id);
          return { stance, rear, aiming, forceFar, actorId: actor.id, motion: sampleNraMotion(actor),
            tier: nraCharacter.counts,
            view, image: renderer.domElement.toDataURL('image/png').split(',')[1] };
        },
        startWalking() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const actor of allForces) actor.nextFire = time + 100000;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          const actor = friendlyAI.find(item => item.health > 0 && item.nativeMotion && !item.vehicleId);
          if (!actor) throw new Error('Expected a moving friendly soldier');
          actor.position.set(24, 0, -4); actor.path = actor.pathGoal = null;
          actor.nativeMotion.position.x = actor.position.x; actor.nativeMotion.position.z = actor.position.z;
          actor.nativeMotion.speed = 0; actor.nativeMotion.weight = 0;
          stopLocomotion(actor.locomotion);
          this.walkingId = actor.id;
        },
        stepWalking(forceFar = false, steps = 10, distance = 2.3) {
          setGameState('playing');
          for (let i = 0; i < steps; i++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time); }
          setGameState('pause');
          const actor = entities.soldiers.get(this.walkingId);
          const x = actor.position.x, z = actor.position.z;
          camera.position.set(x + Math.sin(actor.heading) * distance, 1.35, z + Math.cos(actor.heading) * distance);
          camera.lookAt(x, 1, z); camera.updateMatrixWorld(true);
          nraCharacter.update([actor], time, entities.control.soldierId, graphics.snapshot.preset,
            { detailLimit: forceFar ? 0 : null });
          uniformExcludedIds.clear();
          for (const id of nraCharacter.excludedIds) uniformExcludedIds.add(id);
          soldierRenderer.update([actor], graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          return { time, position: actor.position.toArray(), mode: actor.tactics.mode,
            motion: sampleNraMotion(actor), view: nraCharacter.snapshot.views.find(item => item.actorId === actor.id),
            image: renderer.domElement.toDataURL('image/png').split(',')[1] };
        },
        startGroup() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          this.groupId = null;
        },
        stepGroup() {
          setGameState('playing');
          for (let i = 0; i < 20; i++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time); }
          setGameState('pause');
          let candidates = friendlyAI.filter(actor => actor.health > 0 && !actor.vehicleId &&
            actor.nativeMotion && actor.nativeMotion.speed > .5)
            .sort((a, b) => b.nativeMotion.speed - a.nativeMotion.speed).slice(0, 6);
          if (${JSON.stringify(process.env.WAIST_GROUP_SINGLE === '1')}) {
            this.groupId ??= candidates[0]?.id;
            candidates = friendlyAI.filter(actor => actor.id === this.groupId && actor.health > 0 && !actor.vehicleId);
          }
          return candidates.map(actor => {
            const x = actor.position.x, z = actor.position.z, distance = 2;
            camera.position.set(x + Math.sin(actor.heading) * distance, actor.position.y + 1.35,
              z + Math.cos(actor.heading) * distance);
            camera.lookAt(x, actor.position.y + 1, z); camera.updateMatrixWorld(true);
            nraCharacter.update([actor], time, entities.control.soldierId, graphics.snapshot.preset);
            uniformExcludedIds.clear();
            for (const id of nraCharacter.excludedIds) uniformExcludedIds.add(id);
            soldierRenderer.update([actor], graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds, true);
            renderer.render(scene, camera);
            return { time, id: actor.id, position: actor.position.toArray(), mode: actor.tactics.mode,
              motion: sampleNraMotion(actor),
              view: nraCharacter.snapshot.views.find(item => item.actorId === actor.id),
              image: renderer.domElement.toDataURL('image/png').split(',')[1] };
          });
        },
        reuseProbe() {
          setGameState('playing');
          for (let i = 0; i < 80; i++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time); }
          setGameState('pause');
          const candidates = friendlyAI.filter(actor => actor.health > 0 && !actor.vehicleId &&
            actor.nativeMotion && actor.nativeMotion.speed > .5);
          candidates.sort((a, b) => sampleNraMotion(b).upperBody.lateral - sampleNraMotion(a).upperBody.lateral);
          const positive = candidates.slice(0, 2), negative = candidates.slice(-2);
          const sum = pair => pair.reduce((total, actor) => total + sampleNraMotion(actor).upperBody.lateral, 0);
          const actors = Math.abs(sum(positive)) >= Math.abs(sum(negative)) ? positive : negative;
          if (actors.length !== 2) throw new Error('Expected two moving soldiers');
          const samples = [];
          for (let i = 0; i < 60; i++) {
            const actor = actors[i % 2];
            camera.position.set(actor.position.x + Math.sin(actor.heading) * 2,
              actor.position.y + 1.35, actor.position.z + Math.cos(actor.heading) * 2);
            camera.lookAt(actor.position.x, actor.position.y + 1, actor.position.z);
            camera.updateMatrixWorld(true);
            nraCharacter.update([actor], time, entities.control.soldierId, graphics.snapshot.preset);
            uniformExcludedIds.clear();
            for (const id of nraCharacter.excludedIds) uniformExcludedIds.add(id);
            soldierRenderer.update([actor], graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds, true);
            if (i === 1 || i === 59) renderer.render(scene, camera);
            samples.push({ id: actor.id, view: nraCharacter.snapshot.views.find(view => view.actorId === actor.id),
              image: i === 1 || i === 59 ? renderer.domElement.toDataURL('image/png').split(',')[1] : null });
          }
          return samples;
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  if (process.env.WAIST_REUSE_PROBE === '1') url.searchParams.set('seed', '1938');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  if (process.env.WAIST_NATURAL_REVIEW === '1') {
    await page.evaluate(() => waistReview.startNatural());
    const records = [];
    for (let step = 0; step < 15; step++) {
      await page.waitForTimeout(2000);
      records.push(await page.evaluate(() => waistReview.naturalSnapshot()));
      if (step === 0 || step === 7 || step === 14)
        await page.screenshot({ path: join(directory, `natural-${step}.png`) });
    }
    await writeFile(join(directory, 'natural.json'), JSON.stringify({ records, errors,
      fixture: 'original soldiers, normal health and real frame updates; defense clock manually advanced, player idle' }, null, 2));
    assert.ok(records.some(record => record.views.some(view => view.visible)),
      'the natural renderer must observe at least one original soldier');
    assert.deepEqual(errors, []);
    console.log('Captured natural rendered views.');
  } else if (process.env.WAIST_REUSE_PROBE === '1') {
    await page.evaluate(() => waistReview.startGroup());
    const records = await page.evaluate(() => waistReview.reuseProbe());
    for (const [index, record] of records.entries()) {
      if (record.image) await writeFile(join(directory, `reuse-${index}.png`), Buffer.from(record.image, 'base64'));
      delete record.image;
    }
    await writeFile(join(directory, 'reuse.json'), JSON.stringify({ records, errors,
      fixture: 'real battle and AI; clock moved to assembly; two real moving actors frozen during 60 artificial view rebinds; not natural frame pacing' }, null, 2));
    assert.deepEqual(errors, []);
    if (process.env.WAIST_REUSE_BASELINE === '1')
      assert.ok(records.at(-1).view.issue, 'pre-fix rebind must show an actual pose issue');
    else assert.equal(records.at(-1).view.issue, null);
    console.log(`Captured ${records.length} repeated views.`);
  } else if (process.env.WAIST_GROUP_REVIEW === '1') {
    await page.evaluate(() => waistReview.startGroup());
    const records = [];
    for (let step = 0; step < 15; step++) {
      const sample = await page.evaluate(() => waistReview.stepGroup());
      for (const item of sample) {
        await writeFile(join(directory, `group-${step}-${item.id}.png`), Buffer.from(item.image, 'base64'));
        delete item.image;
        records.push(item);
      }
    }
    await writeFile(join(directory, 'group.json'), JSON.stringify({
      fixture: 'original soldiers and normal health; manually advanced defense clock; real AI simulation at .05 seconds; rear diagnostic camera follows each moving actor',
      records, errors }, null, 2));
    assert.ok(records.length > 10);
    assert.deepEqual(errors, []);
    console.log(`Captured ${records.length} moving soldiers.`);
  } else {
  const records = [];
  for (const stance of process.env.WAIST_WALK_ONLY === '1' ? [] : ['standing', 'crouched'])
    for (const rear of [true, false]) for (const aiming of [false, true]) {
    const { image, ...record } = await page.evaluate(
      ({ stance, rear, aiming }) => waistReview.setup(stance, rear, aiming), { stance, rear, aiming });
    await writeFile(join(directory, `${stance}-${rear ? 'rear' : 'front'}-${aiming ? 'aim' : 'travel'}.png`), Buffer.from(image, 'base64'));
    records.push(record);
    const far = await page.evaluate(
      ({ stance, rear, aiming }) => waistReview.setup(stance, rear, aiming, true), { stance, rear, aiming });
    await writeFile(join(directory, `${stance}-${rear ? 'rear' : 'front'}-${aiming ? 'aim' : 'travel'}-far.png`),
      Buffer.from(far.image, 'base64'));
    delete far.image;
    records.push(far);
  }
  await page.evaluate(() => waistReview.startWalking());
  const walking = [];
  const samples = process.env.WAIST_WALK_ONLY === '1' ? 40 : 6;
  for (let i = 0; i < samples; i++) {
    const { image, ...record } = await page.evaluate(
      walkOnly => waistReview.stepWalking(false, walkOnly ? 2 : 10, walkOnly ? 1.3 : 2.3),
      process.env.WAIST_WALK_ONLY === '1');
    await writeFile(join(directory, `walking-${i}.png`), Buffer.from(image, 'base64'));
    walking.push(record);
  }
  await writeFile(join(directory, 'poses.json'), JSON.stringify({
    fixture: 'manually-placed-friendly-actor-native-poses-and-retreat-ai-steps-fire-disabled', records, walking, errors,
  }, null, 2));
  assert.ok(records.every(record => record.forceFar || record.view && !record.view.issue));
  assert.ok(records.filter(record => record.forceFar).every(record => record.tier.far === 1));
  assert.ok(walking.some(record => record.motion.speed > .5));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(records.map(({ stance, rear, aiming, motion }) => ({
    stance, rear, aiming, torsoYaw: motion.torsoYaw, bodyLean: motion.bodyLean, posture: motion.postures,
  }))));
  }
} finally {
  await browser.close();
}
