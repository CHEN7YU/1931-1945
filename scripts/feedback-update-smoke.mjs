import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [], registrations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGLProgram/.test(message.text())) errors.push(message.text()); });
  await page.route('**/api/performance', async route => {
    const body = route.request().postDataJSON(); registrations.push(body);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: body.id, saved: true }) });
  });
  await page.route('**/src/nra-rifle-pose.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'export function solveArm(upper, lower, hand, target, pole) {';
    assert.ok(source.includes(marker));
    await route.fulfill({ response, body: source.replace(marker, marker +
      `if (globalThis.injectPoseFailure) { globalThis.injectPoseFailure = false; throw new PoseGeometryError('Injected presentation fault'); }`) });
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.feedbackReview = {
        recoverPose(team) {
          setGameState('pause');
          const force = team === 'friendly' ? nraCharacter : ijaCharacter;
          const actor = allForces.find(actor => actor.team === team && !actor.vehicleId &&
            actor.health > 0 && actor.id !== entities.control.soldierId && !actor.formation.sihangDemolition);
          camera.position.copy(actor.position).add(new THREE.Vector3(0, 1.8, 4));
          camera.lookAt(actor.position.clone().add(new THREE.Vector3(0, 1.3, 0))); camera.updateMatrixWorld(true);
          force.update([actor], time, entities.control.soldierId, 'high', { detailLimit: 1 });
          const previous = force.snapshot.views.find(view => view.actorId === actor.id);
          if (!previous?.visible) throw new Error('Recovery fixture requires a real visible detailed soldier');
          const before = fatalReporter.recoveries.reduce((sum, entry) => sum + entry.count, 0);
          globalThis.injectPoseFailure = true;
          force.update([actor], time, entities.control.soldierId, 'high', { detailLimit: 1 });
          const next = force.snapshot.views.find(view => view.actorId === actor.id);
          const failed = globalThis.injectPoseFailure; globalThis.injectPoseFailure = false;
          let finite = true;
          force.root.traverse(node => { finite &&= [...node.position, ...node.quaternion, ...node.scale].every(Number.isFinite); });
          force.update([actor], time + .05, entities.control.soldierId, 'high', { detailLimit: 1 });
          setGameState('playing');
          return { team, injected: !failed, visible: next?.visible, finite,
            recorded: fatalReporter.recoveries.reduce((sum, entry) => sum + entry.count, 0) - before,
            fatal: fatalReporter.failed, performanceEnabled: performanceDiagnostics.enabled, time };
        },
        flushErrors() { performanceDiagnostics.suspend(); },
        prepare() {
          setGameState('pause'); missionBriefing.hide();
          for (const formation of formations) formation.respawnEnabled = false;
          const player = controlledSoldier(entities);
          window.breachActors = enemies.filter(actor => !actor.vehicleId && !actor.formation.sihangDemolition &&
            !actor.discharger && !actor.engineer?.kits && (actor.rifle.model ?? 'rifle') === 'rifle').slice(0, 5);
          if (breachActors.length !== 5) throw new Error('Breach fixture requires five actual ordinary riflemen');
          for (const actor of allForces) if (actor !== player && !breachActors.includes(actor)) actor.health = 0;
          for (const actor of breachActors) {
            actor.nextThink = Infinity;
            Object.assign(actor.rifle, { ammo: 0, action: 'reload', elapsed: 0 });
          }
          player.position.set(0, 0, -60);
          player.traversal.kind = 'grounded'; player.stance = 'standing';
          Object.assign(player.locomotion, { speed: 0, sprinting: false, sprintBlend: 0, aimRecovery: 0 });
          if (player.nativeMotion) player.nativeMotion.position = { x: 0, z: -60 };
          controlPose.yaw = Math.PI; controlPose.pitch = 0; controlPose.stance = 'standing';
          held.primary = held.aiming = false;
          toolEquipped = grenadeEquipped = dadaoEquipped = false;
          renderEquippedTool(); updateCamera(1);
        },
        recoil(aiming, stance) {
          const player = controlledSoldier(entities);
          player.health = 100; player.stance = controlPose.stance = stance;
          held.aiming = aiming;
          Object.assign(player.rifle, { action: 'idle', elapsed: 0, ammo: 5, queuedReload: false });
          unit.nextShot = 0; rifleRecoil.clear(); recoil = 0; combatEvents.clear();
          setGameState('playing'); refreshWeaponVisibility();
          updateCamera(1);
          const born = time, originalPitch = controlPose.pitch, originalYaw = controlPose.yaw;
          const base = weapon.position.clone(), shots = player.rifle.shots;
          fire(); presentCombatEvents();
          const samples = [], pictures = [];
          for (const elapsed of [0, .018, .028, .06, .12, .2, .3]) {
            time = born + elapsed; player.rifle.elapsed = elapsed;
            updateCamera(0);
            samples.push({ elapsed, pitch: camera.rotation.x - originalPitch,
              yaw: camera.rotation.y - originalYaw, gunPitch: weapon.rotation.x,
              rear: weapon.position.z - base.z, visible: weapon.visible, hands: weaponHands.snapshot });
            if (elapsed === .028 || elapsed === .3) {
              renderer.render(scene, camera);
              pictures.push({ elapsed, image: renderer.domElement.toDataURL('image/png') });
            }
          }
          setGameState('pause');
          return { aiming, stance, fired: player.rifle.shots - shots, samples, pictures,
            inputUnchanged: controlPose.pitch === originalPitch && controlPose.yaw === originalYaw };
        },
        breach() {
          const player = controlledSoldier(entities); player.position.set(-20, 0, -20);
          Object.assign(sihangCampaign, { stage: 'sihang-defense', stageElapsed: 0, elapsed: 0, outcome: null });
          Object.assign(sihangCampaign.demolition, { state: 'armed', fuseRemaining: .01, defuseProgress: 0 });
          keys.clear(); setGameState('playing'); advanceBattleStep(.02, time); setGameState('pause');
          const origin = new THREE.Vector3(0, 1.4, -46), forward = new THREE.Vector3(0, 0, 1);
          ray.set(origin, forward); ray.far = 9;
          const blocked = ray.intersectObjects(solidIndex.candidates(origin, forward, 9), true).length;
          ray.far = Infinity;
          const infantry = breachActors;
          const laneCounts = new Map();
          for (const actor of infantry) {
            const lane = actor.index % 5, queued = laneCounts.get(lane) ?? 0;
            laneCounts.set(lane, queued + 1);
            actor.health = 100; actor.position.set((lane - 2) * .9, 0, -46 - queued * 1.6);
            Object.assign(actor.rifle, { ammo: 0, action: 'reload', elapsed: 0 });
            actor.path = actor.pathGoal = actor.target = null; actor.nextPath = actor.nextThink = 0;
            actor.tactics.cover = actor.tactics.lastSeen = null; actor.traversal.kind = 'grounded';
            actor.heading = Math.PI; stopLocomotion(actor.locomotion);
            if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          }
          window.breachActors = infantry;
          return { campaign: sihangCampaign.northWallBreached, world: world.northWallBreached,
            outcome: sihangCampaign.outcome, ruined: world.warehouseRuined, blocked, ids: infantry.map(actor => actor.id) };
        },
        assault() {
          setGameState('playing');
          for (let step = 0; step < 20; step++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time); }
          setGameState('pause');
        },
        troops() { return breachActors.map(actor => ({ id: actor.id, health: actor.health,
          z: actor.position.z, x: actor.position.x, mode: actor.tactics.mode,
          heading: actor.heading, goal: actor.pathGoal, waypoint: actor.path?.[0], reason: actor.tactics.pathReason })); },
        breachView() {
          setGameState('pause'); $('overlay').hidden = true; if (weapon) weapon.visible = false;
          camera.position.set(12, 6, -58); camera.lookAt(0, 2, -42); camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
        },
        reset() {
          setGameState('menu'); beginMatch(); setGameState('pause');
          return { campaign: sihangCampaign.northWallBreached, world: world.northWallBreached, outcome: sihangCampaign.outcome };
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=sihang&resources=low-memory', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  console.log('Loading real Sihang battle');
  await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  console.log('Battle ready; injecting isolated presentation faults');
  const recoveries = [];
  for (const team of ['friendly', 'enemy']) {
    const result = await page.evaluate(team => feedbackReview.recoverPose(team), team);
    assert.equal(result.injected, true); assert.equal(result.visible, true); assert.equal(result.finite, true);
    assert.equal(result.recorded, 1); assert.equal(result.fatal, false); assert.equal(result.performanceEnabled, false);
    await page.waitForFunction(time => window.__battle.time > time && window.__battle.state === 'playing', result.time);
    recoveries.push(result);
  }
  await page.evaluate(() => feedbackReview.flushErrors());
  await page.waitForTimeout(100);
  const registered = registrations.flatMap(batch => batch.windows.flatMap(window => window.runtimeErrors ?? []));
  assert.ok(registered.some(error => error.code === 'pose-geometry' && error.stage === 'character-pose' && error.recovered));
  assert.equal(await page.locator('#fatal').isVisible(), false);
  console.log('Recovery and automatic registration passed; checking recoil and breach assault');
  await page.evaluate(() => feedbackReview.prepare());
  const recoil = [];
  for (const [aiming, stance] of [[false, 'standing'], [true, 'standing'], [true, 'crouched'], [true, 'prone']]) {
    const result = await page.evaluate(([aiming, stance]) => feedbackReview.recoil(aiming, stance), [aiming, stance]);
    assert.equal(result.fired, 1, JSON.stringify(result)); assert.equal(result.inputUnchanged, true);
    assert.ok(result.samples[1].pitch > .01 && result.samples[2].rear > .015, JSON.stringify(result));
    for (const sample of result.samples) {
      assert.equal(sample.hands.reachLimited, false, JSON.stringify(sample));
      for (const side of ['left', 'right']) assert.equal(sample.hands[side].arm.reachable, true, JSON.stringify(sample));
    }
    assert.ok(Math.abs(result.samples.at(-1).rear) < .001);
    for (const picture of result.pictures) await writeFile(join(directory,
      'recoil-' + (aiming ? 'ads' : 'hip') + '-' + stance + '-' + picture.elapsed + '.png'),
    Buffer.from(picture.image.split(',')[1], 'base64'));
    delete result.pictures;
    recoil.push(result);
  }
  const breach = await page.evaluate(() => feedbackReview.breach());
  assert.deepEqual({ ...breach, ids: breach.ids.length }, { campaign: true, world: true, outcome: null, ruined: false, blocked: 0, ids: 5 });
  for (let second = 0; second < 20; second++) {
    await page.evaluate(() => feedbackReview.assault());
    if (await page.evaluate(() => feedbackReview.troops().every(actor => actor.z > -41))) break;
  }
  const troops = await page.evaluate(() => feedbackReview.troops());
  assert.ok(troops.every(actor => actor.z > -41), JSON.stringify(troops));
  await page.evaluate(() => feedbackReview.breachView());
  await page.screenshot({ path: join(directory, 'sihang-north-breach.png') });
  const reset = await page.evaluate(() => feedbackReview.reset());
  assert.deepEqual(reset, { campaign: false, world: false, outcome: null });
  await writeFile(join(directory, 'feedback.json'), JSON.stringify({ recoveries, registered, recoil, breach, troops, reset, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, recoveries, registered, recoil: recoil.map(({ aiming, stance, samples }) => ({
    aiming, stance, cameraPeak: samples[1].pitch, rearPeak: samples[2].rear, gunPeak: samples[2].gunPitch })), breach, troops, reset }));
} finally { await browser.close(); }
