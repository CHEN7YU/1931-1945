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
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.immediateRetreatReview = {
        setup() {
          missionBriefing.hide();
          simulationClock.setActive(false, performance.now());
          for (const actor of allForces) actor.nextFire = time + 100000;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          for (const actor of allies) actor.position.set(0, 0, -25);
          const teammate = allies.find(actor => actor !== controlledSoldier(entities) && actor.health > 0);
          if (!teammate) throw new Error('Missing living teammate');
          teammate.position.set(-4, 0, -4);
          this.teammate = teammate.id;
          this.initialAI = friendlyAI.filter(actor => actor.health > 0).map(actor => ({
            id: actor.id, health: actor.health, ammo: actor.rifle.ammo, position: actor.position.toArray() }));
          updateSihangMission(.05);
          return this.snapshot();
        },
        step() { updateSihangMission(.05); return this.snapshot(); },
        snapshot() {
          updateHUD();
          return { controlled: controlledSoldier(entities)?.id, teammate: this.teammate,
            stageElapsed: sihangCampaign.stageElapsed, prepared: sihangCampaign.assemblyPrepared,
            released: sihangCampaign.assemblyReleased, remaining: sihangWaveAssemblyRemaining(sihangCampaign),
            wave: sihangCampaign.withdrawalWave && structuredClone(sihangCampaign.withdrawalWave),
            help: $('objective-help').textContent, target: currentMissionTargets()[0].shortName,
            squad: allies.filter(actor => actor.health > 0).map(actor => ({
              id: actor.id, position: actor.position.toArray(), health: actor.health, ammo: actor.rifle.ammo })),
            initialAI: this.initialAI, retainedAI: this.initialAI.map(original => {
              const actor = entities.soldiers.get(original.id);
              return { id: original.id, same: Boolean(actor && friendlyAI.includes(actor)),
                health: actor?.health, ammo: actor?.rifle.ammo, position: actor?.position.toArray() };
            }) };
        },
        placeAtGun(id) {
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          if (!point) throw new Error('Missing bridge gun ' + id);
          if (actor.emplacementId) releaseEmplacement(actor);
          const position = emplacementPose(point, 0).operator;
          actor.position.set(position.x, position.y, position.z);
          actor.traversal.kind = 'grounded'; actor.traversal.velocity = 0;
          stopLocomotion(actor.locomotion); controlPose.yaw = actor.heading = point.heading;
          updateCamera(0); updateDoorPrompt();
          this.point = point;
          return { prompt: $('interaction-prompt').textContent, id: point.id, ammo: point.weapon.ammo };
        },
        gun() {
          const actor = controlledSoldier(entities);
          return { id: actor.emplacementId ?? null, operator: this.point.operatorId,
            controlled: actor.id, ammo: this.point.weapon.ammo, shots: this.point.shots };
        },
        advance() { aiDecisions.beginFrame(); advanceBattleStep(.05, time); },
        restart() { setGameState('menu'); beginMatch(); },
        bridgePermissions() {
          return ['sihang-cover-gun', 'sihang-cover-gun-east'].map(id => ({
            id, allowed: canOperateEmplacement(emplacements.get(id), controlledSoldier(entities)),
          }));
        },
        emptyFirstWave() {
          missionBriefing.hide(); simulationClock.setActive(false, performance.now());
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          for (const actor of friendlyAI) actor.health = 0;
          controlledSoldier(entities).position.set(-4, 0, -4);
          sihangCampaign.retreatNextSpawnAt = time + 10;
          updateSihangMission(.05); updateHUD();
          return { released: sihangCampaign.assemblyReleased, wave: sihangCampaign.withdrawalWave,
            reserve: sihangCampaign.retreatReserve, help: $('objective-help').textContent };
        },
        allowFirstRefill() {
          sihangCampaign.retreatNextSpawnAt = time;
          updateSihangMission(.05);
          return { wave: structuredClone(sihangCampaign.withdrawalWave), reserve: sihangCampaign.retreatReserve };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const waiting = await page.evaluate(() => immediateRetreatReview.setup());
  assert.equal(waiting.prepared, false);
  assert.equal(waiting.released, false);
  assert.equal(waiting.wave, null);
  assert.match(waiting.help, /前往仓库南面/);
  assert.equal(waiting.target, '前往仓库南面');
  assert.notEqual(waiting.controlled, waiting.teammate);
  await page.keyboard.press('y');
  const released = await page.evaluate(() => immediateRetreatReview.step());
  assert.equal(released.controlled, waiting.teammate, 'actual Y switches control to the soldier already in the area');
  assert.equal(released.prepared, true);
  assert.equal(released.released, true);
  assert.equal(released.wave?.number, 1);
  assert.ok(released.stageElapsed < 1, 'departure does not wait 20 or 30 seconds');
  assert.ok(released.squad.some(actor => actor.id !== released.controlled && actor.position[2] === -25));
  assert.equal(released.target, '西藏路桥撤离');
  assert.deepEqual(released.retainedAI.map(({ same, ...actor }) => actor), released.initialAI,
    'existing soldiers and equipment remain unchanged at release');
  assert.ok(released.retainedAI.every(actor => actor.same && released.wave.squads.flat().includes(actor.id)));
  assert.deepEqual(released.squad, waiting.squad, 'switching and release do not teleport or refill the squad');
  const guns = [];
  for (const id of ['sihang-cover-gun', 'sihang-cover-gun-east']) {
    const before = await page.evaluate(id => immediateRetreatReview.placeAtGun(id), id);
    assert.match(before.prompt, /F 操作/);
    await page.keyboard.press('f');
    const mounted = await page.evaluate(() => immediateRetreatReview.gun());
    assert.equal(mounted.id, id);
    assert.equal(mounted.operator, mounted.controlled);
    await page.locator('#world').dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => immediateRetreatReview.advance());
    await page.locator('#world').dispatchEvent('mouseup', { button: 0 });
    const fired = await page.evaluate(() => immediateRetreatReview.gun());
    assert.equal(fired.ammo, before.ammo - 1);
    assert.equal(fired.shots, 1);
    guns.push({ before, mounted, fired });
  }
  await page.evaluate(() => immediateRetreatReview.restart());
  await page.waitForFunction(() => document.querySelector('#loading').hidden &&
    window.__battle?.state === 'playing', null, { timeout: 180000 });
  const resetPermissions = await page.evaluate(() => immediateRetreatReview.bridgePermissions());
  assert.ok(resetPermissions.every(point => point.allowed), 'reset preserves the two assigned bridge guns');
  await page.reload(); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const empty = await page.evaluate(() => immediateRetreatReview.emptyFirstWave());
  assert.equal(empty.released, true);
  assert.equal(empty.wave, null);
  assert.ok(empty.reserve > 0);
  assert.match(empty.help, /等待友军补充/);
  const refill = await page.evaluate(() => immediateRetreatReview.allowFirstRefill());
  assert.equal(refill.wave?.number, 1);
  assert.ok(refill.wave.squads.flat().length > 0);
  assert.equal(refill.reserve, empty.reserve - refill.wave.squads.flat().length);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ waiting, released, guns, resetPermissions, empty, refill, errors,
    limitation: 'Procedural characters, artificial positions and stage clock, frozen simulation; actual Y, F and fire inputs.' }, null, 2));
  console.log('Immediate controlled-soldier retreat and both bridge guns passed.');
} finally {
  await browser.close();
}
