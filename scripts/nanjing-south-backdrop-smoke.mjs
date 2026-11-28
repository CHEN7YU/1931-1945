import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const quality = process.env.QUALITY ?? 'low';
const lowMemory = quality === 'low';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.southBackdropReview = {
        setup(pointId = 'gate-wall-mg') {
          setGameState('pause'); missionBriefing.hide();
          const actor = controlledSoldier(entities), point = emplacements.get(pointId);
          if (!actor || !point) throw new Error('Missing player or gate machine gun');
          if (actor.emplacementId) releaseEmplacement(actor, false);
          this.pointId = pointId;
          if (point.operatorId) {
            const operator = entities.soldiers.get(point.operatorId);
            if (!operator) throw new Error('Missing gate machine gun operator');
            releaseEmplacement(operator, false);
          }
          const pose = emplacementPose(point, point.altitude);
          actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          stopLocomotion(actor.locomotion);
          controlPose.yaw = point.heading; controlPose.pitch = 0;
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        pause() { setGameState('pause'); },
        mounted() { return controlledSoldier(entities)?.emplacementId === this.pointId; },
        hands() {
          const actor = controlledSoldier(entities), point = emplacements.get(actor.emplacementId);
          point.pitch = point.weapon.settings.maxPitch;
          point.view.userData.update();
          actor.lookPitch = point.pitch;
          updateCamera(0);
          const snapshot = supportViewHands.update(actor, camera, point.view, { appearance: actor.avatarAppearance });
          const meshes = [];
          supportViewHands.root.traverseVisible(node => { if (node.isMesh) meshes.push(node.name); });
          renderer.render(scene, camera);
          return { snapshot, meshes, pitch: point.pitch, profile: point.profile,
            image: renderer.domElement.toDataURL('image/png').split(',')[1] };
        },
        characters() {
          const player = controlledSoldier(entities);
          releaseEmplacement(player, false);
          const blue = friendlyAI.filter(actor => actor.health > 0 && !actor.vehicleId &&
            actor.nativeMotion && actor.avatarAppearance?.blueFieldCap);
          const soldier = blue.find(actor => actor.index !== 2), officer = blue.find(actor => actor.index === 2);
          if (!soldier || !officer) throw new Error('Missing original blue-uniform soldier and officer');
          let place = null;
          placement: for (const z of [-16, -28, -40, -52, -64]) for (const x of [-44, -54, -64, -74]) {
            const y = world.walkHeight(x, z, 0), eye = new THREE.Vector3(x + 1, y + 1.5, z - 5);
            if (Math.abs(y) < .1 && !circleBlocked(x, z, .6, movementObstacles(x, z), y, 1.8) &&
              !circleBlocked(x + 2, z, .6, movementObstacles(x + 2, z), y, 1.8) &&
              hasLine(eye, new THREE.Vector3(x, y + 1, z), 8) &&
              hasLine(eye, new THREE.Vector3(x + 2, y + 1, z), 8)) { place = { x, y, z, eye }; break placement; }
          }
          if (!place) throw new Error('No clear original battlefield position for character review');
          for (const [index, actor] of [soldier, officer].entries()) {
            actor.position.set(place.x + index * 2, place.y, place.z);
            actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
            actor.stance = 'standing'; actor.firingPose = null; actor.heading = 0;
            actor.rifleReady = false; stopLocomotion(actor.locomotion);
            for (let i = 0; i < 30; i++) advanceNraMotion(actor, .05);
          }
          camera.position.copy(place.eye); camera.lookAt(place.x + 1, place.y + .9, place.z);
          camera.updateMatrixWorld(true);
          for (const child of camera.children) child.visible = false;
          supportViewHands.root.visible = false;
          const capture = (now, far = false) => {
            nraCharacter.update([...allForces, ...corpses.values()], now, entities.control.soldierId, 'high',
              { detailLimit: far ? 0 : 6 });
            renderer.render(scene, camera);
            return { snapshot: nraCharacter.snapshot, image: renderer.domElement.toDataURL('image/png').split(',')[1] };
          };
          const standing = capture(time);
          setGameState('playing');
          hurt(soldier, 1000, { credit: 'environment', cause: 'fall', subjectId: soldier.id }, 'fall');
          setGameState('pause');
          if (!soldier.casualty) throw new Error('Real hurt path did not create a corpse');
          return { standing, near: capture(time + 3), far: capture(time + 3, true),
            casualty: soldier.casualty, soldierId: soldier.id, officerId: officer.id };
        },
        cutoff() {
          const civilian = world.civilians.find(person => person.userData.active && person.visible && !person.userData.dead);
          if (!civilian) throw new Error('No living original civilian');
          const data = civilian.userData, goal = data.waitingSlot;
          civilian.position.set(goal.x, world.walkHeight(goal.x, goal.z, 0), goal.z);
          Object.assign(nanjingCampaign, { stage: 'withdrawal-to-boats', outcome: null,
            finalWithdrawalElapsed: NANJING_CIVILIAN_FINAL_WAIT, finalShoreWaitExpired: false });
          const deathsBefore = nanjingCampaign.civilianCasualties;
          updateNanjingCivilians(0);
          if (nanjingCampaign.civilianCasualties !== deathsBefore) throw new Error('Deadline invented casualties');
          const target = nanjingCivilianCombatTargets().find(target => target.civilian === civilian);
          if (!target || !nanjingEnemyPersonTargetAllowed(target)) throw new Error('Cutoff civilian is not targetable');
          const formation = formations.find(formation => formation.team === 'enemy' && formation.type === 'infantry');
          let operator = null;
          placement: for (const z of [-55, -45, -95]) for (const x of [-70, -80, -90]) {
            const y = world.walkHeight(x, z, 0), from = new THREE.Vector3(x, y + 1.5, z);
            if (Math.abs(y) < .1 && !circleBlocked(x, z, .6, movementObstacles(x, z), y, 1.8) &&
              hasLine(from, target.position.clone().add(new THREE.Vector3(0, target.aimHeight, 0)), 210)) {
              operator = actorAt(false, x, z, 0, { id: 'cutoff-review', altitude: y }, formation); break placement;
            }
          }
          if (!operator?.discharger) throw new Error('No legal original tube operator position');
          enemies.push(operator); formation.members.push(operator); rebuildForces();
          const source = captureAttackSource(entities, operator, operator.discharger);
          let steps = 0;
          setGameState('playing');
          for (; steps < 900 && !data.dead; steps++) {
            time += .1; dischargerQueryBudget = 2;
            operateAIDischarger(operator, .1); advanceNraMotion(operator, .1); updateProjectiles(.1);
          }
          setGameState('pause');
          if (!data.dead || data.health !== 0 || data.casualtySource !== operator.id)
            throw new Error('Actual owned tube fire did not kill the shore civilian: ' +
              JSON.stringify({ shots: operator.discharger.shots, rejected: operator.discharger.rejected, health: data.health }));
          const corpseId = 'civilian-' + data.civilianId;
          time += 3;
          camera.position.copy(civilian.position).add(new THREE.Vector3(4, 2, -4));
          camera.lookAt(civilian.position); camera.updateMatrixWorld(true);
          cleanupBattleCorpses();
          const visibleRetained = civilian.visible && civilianCorpses.has(corpseId);
          camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0, -100)));
          camera.updateMatrixWorld(true); time += 1.1; cleanupBattleCorpses();
          const hiddenCleared = !civilian.visible && !civilianCorpses.has(corpseId);
          this.operator = operator;
          return { source, steps, shots: operator.discharger.shots, deathsBefore,
            deathsAfter: nanjingCampaign.civilianCasualties, health: data.health,
            visibleRetained, hiddenCleared, status: nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians) };
        },
        deathText() {
          const player = controlledSoldier(entities);
          player.fatalFall = true;
          setGameState('playing');
          hurt(player, 1000, captureAttackSource(entities, this.operator, this.operator.discharger), 'grenade-discharger');
          updateDeathFeedback(.4);
          setGameState('pause'); renderDeathFeedback(); updateHUD();
          return { reason: $('death-transfer-reason').textContent,
            font: getComputedStyle($('death-transfer-reason')).fontSize,
            nameHidden: $('death-transfer-name').hidden, objective: $('objective-title').textContent };
        },
        compare(name) {
          return { before: this.view(name, false), after: this.view(name, true) };
        },
        view(name, visible) {
          if (!this.mounted()) throw new Error('Gate gun must be mounted through actual F input');
          world.landmarks.southBackdrop.root.visible = visible;
          if (name === 'wall') {
            camera.position.set(0, 10.2, 25);
            camera.lookAt(0, 3.5, 170);
          } else if (name === 'south-road') {
            camera.position.set(-24, 2, 70);
            camera.lookAt(-20, 4, 165);
          } else if (name === 'southwest') {
            camera.position.set(-16, 10, 26);
            camera.lookAt(-195, 8, 240);
          } else {
            updateCamera(0);
          }
          camera.updateMatrixWorld(true);
          const shadowUpdate = renderer.shadowMap.autoUpdate, shadowPending = renderer.shadowMap.needsUpdate;
          renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
          renderer.info.reset();
          renderer.render(scene, camera);
          renderer.shadowMap.autoUpdate = shadowUpdate; renderer.shadowMap.needsUpdate = shadowPending;
          const backdrop = world.landmarks.southBackdrop, box = new THREE.Box3().setFromObject(backdrop.root);
          const frustum = new THREE.Frustum().setFromProjectionMatrix(
            new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          return { view: name, visible, camera: camera.position.toArray(),
            direction: camera.getWorldDirection(new THREE.Vector3()).toArray(), art: world.sceneArt.southBackdrop,
            visibleBatches: backdrop.root.children.filter(mesh => mesh.isMesh && frustum.intersectsObject(mesh)).length,
            minZ: box.min.z, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5392/');
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('seed', '1937');
  if (lowMemory) url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await setQualityPreset(page, quality);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.locator('#world').click();
  await page.evaluate(() => southBackdropReview.setup());
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => southBackdropReview.mounted(), null, { timeout: 10000 });
  await page.evaluate(() => southBackdropReview.pause());
  const results = [];
  for (const view of ['casemate', 'wall', 'south-road', 'southwest']) {
    const before = await page.evaluate(view => southBackdropReview.view(view, false), view);
    await page.locator('#world').screenshot({ path: join(directory, `${view}-before.png`) });
    const after = await page.evaluate(view => southBackdropReview.view(view, true), view);
    await page.locator('#world').screenshot({ path: join(directory, `${view}-after.png`) });
    assert.ok(after.visibleBatches > 0 && after.minZ > 114);
    const comparison = await page.evaluate(view => southBackdropReview.compare(view), view);
    assert.ok(comparison.after.calls > comparison.before.calls &&
      comparison.after.triangles > comparison.before.triangles, JSON.stringify(comparison));
    assert.ok(comparison.after.calls - comparison.before.calls <= 24, JSON.stringify(comparison));
    results.push({ before, after, comparison });
  }
  let hands, characters, cutoff, deathText;
  if (process.env.BACKDROP_ONLY !== '1') {
  await page.evaluate(() => southBackdropReview.setup('gate-aa'));
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => southBackdropReview.mounted(), null, { timeout: 10000 });
  await page.evaluate(() => southBackdropReview.pause());
  hands = await page.evaluate(() => southBackdropReview.hands());
  assert.deepEqual(hands.meshes, ['手部', '手部']);
  assert.equal(hands.profile, 'maxim24aa'); assert.ok(hands.pitch >= 1.4);
  await writeFile(join(directory, 'machine-gun-high-angle.png'), Buffer.from(hands.image, 'base64'));
  delete hands.image;
  characters = await page.evaluate(() => southBackdropReview.characters());
  for (const [name, frame] of Object.entries({ 'blue-grey-uniform': characters.standing,
    'casualty-near': characters.near, 'casualty-distant-batch-diagnostic': characters.far })) {
    await writeFile(join(directory, name + '.png'), Buffer.from(frame.image, 'base64'));
    delete frame.image;
  }
  cutoff = await page.evaluate(() => southBackdropReview.cutoff());
  assert.ok(cutoff.shots > 0 && cutoff.deathsAfter > cutoff.deathsBefore);
  assert.equal(cutoff.visibleRetained, true); assert.equal(cutoff.hiddenCleared, true);
  deathText = await page.evaluate(() => southBackdropReview.deathText());
  assert.equal(deathText.reason, '被日军八九式掷弹筒击中');
  assert.ok(parseFloat(deathText.font) >= 24 && deathText.nameHidden);
  assert.ok(!/阶段/.test(deathText.objective));
  await page.screenshot({ path: join(directory, 'death-notice.png') });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({
    conditions: `${quality} quality, ${lowMemory ? 'low-memory' : 'standard'} resources, paused real battlefield; artificial placement and F mounting. Before hides only new scenery. Synchronous draw comparisons use cached shadows. ${process.env.BACKDROP_ONLY === '1' ? '' : 'Character images use original actors and actual hurt with an isolated presentation clock; distant-batch image forces that representation at a close camera. Cutoff fixture stages the deadline and an owned tube operator, runs actual selection, launch, collision and blast damage on isolated simulation steps, then rotates the camera to check corpse cleanup. Death notice uses actual hurt with the original tube source, bypassing the last-stand delay for capture. '}None of these fixtures is a natural battle or a full-scale performance measurement.`,
    results, hands, characters, cutoff, deathText, errors,
  }, null, 2));
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
}
