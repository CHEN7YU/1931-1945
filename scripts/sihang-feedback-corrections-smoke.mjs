import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.correctionReview = {
        presentation() {
          setGameState('pause'); initAudio();
          const actor = controlledSoldier(entities), point = [...emplacements.values()].find(p => p.profile === 'maxim24');
          const original = actor.emplacementId;
          actor.emplacementId = point.id; point.operatorId = actor.id;
          point.heat = 1; point.overheated = true;
          renderWeaponReload();
          const cooling = { visible: !$('tank-reload').hidden, label: $('tank-reload-label').textContent,
            remaining: $('tank-reload-time').textContent, progress: $('tank-reload').getAttribute('aria-valuenow') };
          advanceEmplacement(point, 2, time); renderWeaponReload();
          const progressed = Number($('tank-reload').getAttribute('aria-valuenow')) > Number(cooling.progress);
          advanceEmplacement(point, 4, time); renderWeaponReload();
          const completed = $('tank-reload').hidden;
          actor.emplacementId = original; point.operatorId = null;
          const samples = [];
          for (const style of ['grenade', 'mortar', 'grenade-discharger', 'explosive-pack']) {
            blastFeedback.reset(); combatEvents.clear();
            camera.position.set(90, 2, -95); camera.rotation.set(0, 0, 0);
            explode(new THREE.Vector3(90, 2, -100), 0, .1,
              captureAttackSource(entities, actor, actor.grenades), style);
            presentCombatEvents();
            samples.push({ style, strength: blastFeedback.snapshot.strength,
              flash: grenadeFlashStrength, tinnitus: grenadeBlastAudio?.snapshot.tinnitus });
            grenadeFlashStrength = 0;
          }
          setGameState('playing'); setGameState('pause');
          return { cooling, progressed, completed, samples, reset: blastFeedback.snapshot.strength };
        },
        async reset() {
          while (battlePreparing) await new Promise(resolve => setTimeout(resolve, 50));
          setGameState('menu'); beginMatch();
          while (battlePreparing) await new Promise(resolve => setTimeout(resolve, 50));
          setGameState('pause'); missionBriefing.hide();
        },
        fall(kind) {
          setGameState('pause');
          const actor = controlledSoldier(entities);
          for (const formation of formations) formation.respawnEnabled = false;
          for (const other of allForces) if (other !== actor) other.health = 0;
          actor.position.set(0, 16.8, -46); actor.traversal.kind = 'jumping'; actor.traversal.velocity = 0;
          actor.tactics.sihangShieldLanding = time;
          actor.health = 100;
          keys.clear(); setGameState('playing');
          for (let step = 0; step < 100 && !actor.fatalFall; step++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          const landed = { health: actor.health, wound: Boolean(actor.fatalFall),
            position: actor.position.toArray(), stance: actor.stance };
          const before = actor.position.clone();
          keys.add('KeyW'); updatePlayer(.2); keys.clear();
          const immobile = actor.position.distanceTo(before) < 1e-8;
          const switchDenied = dispatchControlCommand('cycleMember').status === 'rejected';
          equipGrenade(kind); prepareGrenade();
          const action = actor.grenades.action, id = actor.id;
          for (let step = 0; step < 15; step++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time); }
          grenades.release(id, time);
          let thrown = false;
          for (let step = 0; step < 90; step++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            thrown ||= grenades.active.some(item => item.source.soldierId === id && item.kind === kind && item.phase === 'flight');
          }
          setGameState('pause');
          return { kind, landed, immobile, switchDenied, prepared: Boolean(action), thrown,
            health: actor.health, deathCause: actor.deathSource?.cause, fatal: fatalReporter.failed };
        },
        breach() {
          const player = controlledSoldier(entities);
          const sapper = formations.find(item => item.sihangDemolition);
          const retiredIds = sapper.members.filter(actor => actor.health > 0).map(actor => actor.id);
          for (const formation of formations) if (formation !== sapper) formation.respawnEnabled = false;
          for (const actor of allForces) if (actor !== player && actor.formation !== sapper) actor.health = 0;
          player.position.set(0, 0, -34); player.heading = 0; player.health = 100000;
          player.traversal.kind = 'grounded'; controlPose.stance = player.stance = 'standing';
          Object.assign(sihangCampaign.demolition, { state: 'armed', fuseRemaining: .01 });
          keys.clear(); setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.02, time);
          const retired = retiredIds.every(id => !entities.soldiers.has(id));
          sihangCampaign.stageElapsed = 0; combatEvents.clear();
          let firstShot = null, peakSpeed = 0, spawned = null, crossed = false;
          for (let step = 0; step < 1500 && !(crossed && firstShot); step++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            if (sapper.members.length) {
              spawned ??= sapper.members.map(actor => ({ id: actor.id, p: actor.spawnPosition,
                gun: actor.hasFirearm, model: actor.rifle.model ?? 'rifle' }));
              for (const actor of sapper.members) {
                peakSpeed = Math.max(peakSpeed, actor.locomotion.speed);
                if (!firstShot && actor.rifle.shots > 0)
                  firstShot = { id: actor.id, z: actor.position.z, shots: actor.rifle.shots };
              }
              crossed ||= sapper.members.filter(actor => actor.health > 0).some(actor => actor.position.z > -41);
            }
          }
          setGameState('pause');
          camera.position.set(10, 4, -54); camera.lookAt(0, 1.5, -42);
          camera.children.forEach(child => child.visible = false);
          renderer.render(scene, camera);
          return { retired, retiredCount: retiredIds.length, demolition: sapper.sihangDemolition,
            memberCount: sapper.memberCount, spawned, firstShot, peakSpeed, crossed,
            breached: world.northWallBreached, outcome: sihangCampaign.outcome,
            actors: sapper.members.map(a => ({ id: a.id, p: a.position.toArray(), mode: a.tactics.mode,
              shots: a.rifle.shots, aim: a.aiRifle, path: a.path?.slice(0, 2) })),
            image: renderer.domElement.toDataURL('image/png') };
        },
        retreat() {
          const player = controlledSoldier(entities);
          for (const formation of formations) formation.respawnEnabled = false;
          for (const enemy of enemies) enemy.health = 0;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          setGameState('playing'); updateSihangMission(.02);
          for (const actor of allies) hurt(actor, actor.health, { credit: 'environment', cause: 'fall', subjectId: actor.id }, 'fall');
          updateSihangMission(.05); showOverlay('dead');
          const before = { outcome: sihangCampaign.outcome, state, count: sihangDeploymentCount(sihangCampaign),
            choices: deploymentSpawnChoices('infantry').map(point => point.id) };
          deploy('infantry', 'sihang-south-cover');
          const replacement = controlledSoldier(entities);
          const spawned = { id: replacement.id, p: replacement.position.toArray(), health: replacement.health,
            count: allies.length, state, retreatDeployed: sihangCampaign.retreatDeployed };
          for (const actor of friendlyAI) actor.position.set(92, 0, 4);
          updateSihangMission(.05);
          const beforeLoss = sihangCampaign.outcome;
          hurt(replacement, 200, { credit: 'environment', cause: 'fall', subjectId: replacement.id }, 'fall');
          updateSihangMission(.05);
          setGameState('pause');
          return { before, spawned, beforeLoss, after: sihangCampaign.outcome };
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=sihang&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const results = { falls: [] };
  results.presentation = await page.evaluate(() => correctionReview.presentation());
  assert.equal(results.presentation.cooling.visible, true);
  assert.equal(results.presentation.cooling.label, '冷却');
  assert.equal(results.presentation.progressed, true); assert.equal(results.presentation.completed, true);
  const strengths = results.presentation.samples.map(sample => sample.strength);
  assert.ok(strengths[0] < strengths[1] && strengths[1] === strengths[2] && strengths[2] < strengths[3]);
  assert.equal(results.presentation.reset, 0);
  for (const kind of ['grenade', 'explosive-pack']) {
    console.log('Checking real high fall and final ' + kind);
    await page.evaluate(() => correctionReview.reset());
    const fall = await page.evaluate(kind => correctionReview.fall(kind), kind);
    console.log(JSON.stringify(fall));
    results.falls.push(fall);
    assert.equal(fall.landed.wound, true); assert.equal(fall.landed.health, 1);
    assert.equal(fall.immobile, true); assert.equal(fall.switchDenied, true);
    assert.equal(fall.prepared, true); assert.equal(fall.thrown, true);
    assert.equal(fall.health, 0); assert.equal(fall.deathCause, 'fall'); assert.equal(fall.fatal, false);
  }
  console.log('Checking replacement infantry fire before entry and assault through the breach');
  await page.evaluate(() => correctionReview.reset());
  const breach = await page.evaluate(() => correctionReview.breach());
  await writeFile(join(directory, 'armed-breach-assault.png'), Buffer.from(breach.image.split(',')[1], 'base64'));
  delete breach.image; results.breach = breach;
  console.log(JSON.stringify(breach));
  assert.equal(breach.retired, true); assert.equal(breach.retiredCount, 20);
  assert.equal(breach.demolition, false); assert.equal(breach.memberCount, 11);
  assert.equal(breach.spawned?.length, 11); assert.ok(breach.spawned.every(actor => actor.gun));
  assert.ok(breach.firstShot?.z < -42, 'replacement infantry must fire while outside the north wall');
  assert.ok(breach.peakSpeed > 3.5, 'ordinary attackers must use an urgent running pace');
  assert.equal(breach.crossed, true);
  console.log('Checking south-side covering replacements and final death');
  await page.evaluate(() => correctionReview.reset());
  results.retreat = await page.evaluate(() => correctionReview.retreat());
  console.log(JSON.stringify(results.retreat));
  assert.equal(results.retreat.before.outcome, null); assert.equal(results.retreat.before.count, 11);
  assert.deepEqual(results.retreat.before.choices, ['sihang-south-cover']);
  assert.equal(results.retreat.spawned.count, 11); assert.equal(results.retreat.spawned.health, 100);
  assert.equal(results.retreat.spawned.p[1], 0);
  assert.ok(results.retreat.spawned.p[2] > -8 && results.retreat.spawned.p[2] < 0);
  assert.equal(results.retreat.beforeLoss, null); assert.equal(results.retreat.after, 'withdrawal-ended');
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'corrections.json'), JSON.stringify({ ...results, errors }, null, 2));
  console.log('Sihang feedback corrections passed');
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => ({ url: location.href,
      text: document.body.innerText.slice(-6000), reviewLoaded: Boolean(window.correctionReview) })));
    await page.screenshot({ path: join(directory, 'correction-failure.png') });
  }
  throw error;
} finally {
  await browser.close();
}
