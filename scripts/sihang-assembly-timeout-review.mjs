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
      window.assemblyTimeoutReview = {
        start(high) {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const actor of allForces) actor.nextFire = time + 100000;
          for (const actor of allies) actor.position.set(0, 0, -25);
          const distant = friendlyAI.find(actor => actor.health > 0 && !actor.vehicleId &&
            (high ? actor.formation.index === 3 && actor.index === 10 : actor.formation.index > 1));
          if (!distant) throw new Error('Expected an existing living friendly soldier');
          if (high) {
            const goal = sihangDefenseGoal(3, 10);
            distant.position.set(goal.x, goal.y, goal.z);
            if (distant.nativeMotion) {
              distant.nativeMotion.position.x = goal.x; distant.nativeMotion.position.z = goal.z;
            }
          }
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          time += 90; sihangCampaign.elapsed += 90; sihangCampaign.stageElapsed += 90;
          updateSihangMission(.05);
          const waiting = this.snapshot();
          if (!high) distant.position.set(0, 0, -25);
          this.distant = distant;
          const original = { id: distant.id, position: distant.position.toArray(),
            health: distant.health, ammo: distant.rifle.ammo, nextFire: distant.nextFire };
          for (const actor of allies.filter(actor => actor.health > 0)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched'; actor.heading = -Math.PI / 2;
          }
          updateSihangMission(.05);
          return { waiting, original, prepared: this.snapshot(), retained: {
            sameEntity: entities.soldiers.get(distant.id) === distant,
            inFriendlyAI: friendlyAI.includes(distant),
            inFormation: distant.formation.members.includes(distant),
            inRetreat: sihangCampaign.retreatIds.includes(distant.id),
            inAiRetreat: sihangCampaign.aiRetreatIds.includes(distant.id),
            position: distant.position.toArray(), health: distant.health,
            ammo: distant.rifle.ammo, nextFire: distant.nextFire } };
        },
        nearDeadline() {
          const delta = sihangCampaign.waveAssemblyAt + SIHANG_RULES.assemblyTimeout - .2 - sihangCampaign.elapsed;
          time += delta; sihangCampaign.elapsed += delta; sihangCampaign.stageElapsed += delta;
          updateSihangMission(.05);
          return this.snapshot();
        },
        deadline() {
          updateSihangMission(.2);
          const started = this.snapshot();
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time); setGameState('pause');
          return { started, stepped: this.snapshot() };
        },
        fullWaveStep(seconds) {
          setGameState('playing');
          for (let i = 0; i < Math.round(seconds / .05) && !sihangCampaign.withdrawalWave; i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.snapshot();
        },
        eastAssemblyRoute() {
          const actor = friendlyAI.find(item => item.health > 0 && !item.playerUnit);
          if (!actor) throw new Error('Expected a living independent friendly soldier');
          actor.position.set(28.89, 0, -5.4);
          actor.sihangAssemblySlot = { slot: 8, index: 10 };
          actor.sihangAssemblyRoute = null;
          actor.path = actor.pathGoal = null;
          actorGrid.rebuild(allForces);
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time); setGameState('pause');
          return { position: actor.position.toArray(), goal: sihangActorAssemblyGoal(actor),
            mode: actor.tactics.mode, route: actor.sihangAssemblyRoute };
        },
        playerCornerStart() {
          const actor = allies.find(item => item !== controlledSoldier(entities) && item.index === 2);
          if (!actor) throw new Error('Expected player squad member at index 2');
          actor.position.set(28.31753662643888, 0, -7.212670610890565);
          actor.sihangAssemblySlot = null; actor.sihangAssemblyRoute = null;
          actor.path = actor.pathGoal = null;
          sihangCampaign.assemblyPrepared = false; sihangCampaign.assemblyReleased = false;
          sihangCampaign.waveAssemblyAt = null;
          this.cornerActor = actor;
          return this.playerCornerSnapshot();
        },
        playerCornerStep(seconds) {
          setGameState('playing');
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.playerCornerSnapshot();
        },
        playerCornerSnapshot() {
          const actor = this.cornerActor;
          return { position: actor.position.toArray(), goal: sihangActorAssemblyGoal(actor),
            mode: actor.tactics.mode, route: actor.sihangAssemblyRoute,
            path: actor.path, pathGoal: actor.pathGoal, pathReason: actor.tactics.pathReason,
            blocked: actor.tactics.blockedBy, traffic: actor.tactics.traffic,
            inside: actor.position.x >= -34 && actor.position.x <= 26 &&
              actor.position.z >= -7.7 && actor.position.z <= -.4 && Math.abs(actor.position.y) < .4 };
        },
        swapOutsidePlayerArea() {
          const player = controlledSoldier(entities), other = friendlyAI.find(actor => actor.health > 0);
          const oldPosition = player.position.clone(), oldPlayerSlot = player.sihangAssemblySlot;
          const oldOtherSlot = other.sihangAssemblySlot;
          const slot = Array.from({ length: SIHANG_RULES.retreatSquads }, (_, index) => index)
            .find(index => sihangAssemblyPosition(index, 10).x > 26);
          if (slot === undefined) throw new Error('Expected an assembly position outside the player area');
          other.sihangAssemblySlot = { slot, index: 10 };
          const goal = sihangActorAssemblyGoal(other);
          player.position.set(goal.x, goal.y, goal.z);
          updateSihangMission(0);
          const result = { goal, playerSlot: player.sihangAssemblySlot ?? null,
            otherSlot: other.sihangAssemblySlot };
          player.position.copy(oldPosition);
          player.sihangAssemblySlot = oldPlayerSlot;
          other.sihangAssemblySlot = oldOtherSlot;
          return { ...result, slot };
        },
        followOriginal(seconds) {
          setGameState('playing');
          let lowestAlive = this.distant.position.y, reachedGroundAlive = false, firstGround = null, maxStep = 0;
          let previous = this.distant.position.clone();
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            maxStep = Math.max(maxStep, previous.distanceTo(this.distant.position));
            previous.copy(this.distant.position);
            if (this.distant.health > 0) {
              lowestAlive = Math.min(lowestAlive, this.distant.position.y);
              reachedGroundAlive ||= this.distant.position.y < .3;
              if (!firstGround && reachedGroundAlive)
                firstGround = { elapsed: (i + 1) * .05, position: this.distant.position.toArray() };
            }
          }
          setGameState('pause');
          const actor = entities.soldiers.get(this.distant.id);
          return { sameEntity: actor === this.distant, position: actor?.position.toArray(),
            mode: actor?.tactics.mode, health: actor?.health, lowestAlive, reachedGroundAlive, firstGround, maxStep };
        },
        nextWave() {
          for (const id of sihangCampaign.withdrawalWave.squads.flat()) {
            const actor = entities.soldiers.get(id);
            if (actor) actor.health = 0;
          }
          updateSihangMission(.05);
          const interval = this.snapshot();
          time += SIHANG_RULES.waveInterval; updateSihangMission(SIHANG_RULES.waveInterval);
          return { interval, refill: this.snapshot() };
        },
        snapshot() {
          updateHUD();
          const wave = sihangCampaign.withdrawalWave;
          return { prepared: sihangCampaign.assemblyPrepared, released: sihangCampaign.assemblyReleased,
            remaining: sihangWaveAssemblyRemaining(sihangCampaign), help: $('objective-help').textContent,
            wave: wave && structuredClone(wave), reserve: sihangCampaign.retreatReserve,
            actors: friendlyAI.filter(actor => actor.health > 0).map(actor => ({
              id: actor.id, mode: actor.tactics.mode, assembled: actor.formation.retreatAssembled })) };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const high = process.env.HIGH_ACTOR_REVIEW === '1';
  const initial = await page.evaluate(high => assemblyTimeoutReview.start(high), high);
  assert.deepEqual(initial.retained, { sameEntity: true, inFriendlyAI: true, inFormation: true,
    inRetreat: true, inAiRetreat: true, position: initial.original.position,
    health: initial.original.health, ammo: initial.original.ammo, nextFire: initial.original.nextFire },
  'preparing the assembly must preserve the original distant living soldier and its state');
  if (process.env.PLAYER_CORNER_REVIEW === '1') {
    const records = [await page.evaluate(() => assemblyTimeoutReview.playerCornerStart())];
    for (let step = 0; step < 20; step++) records.push(await page.evaluate(() => assemblyTimeoutReview.playerCornerStep(1)));
    await writeFile(join(directory, 'player-corner.json'), JSON.stringify({
      fixture: 'manual-observed-position-real-mission-ai-fixed-steps', records, errors }, null, 2));
    assert.ok(records.some(record => record.inside),
      'the player squad member must physically reach the assembly area');
    assert.deepEqual(errors, []);
    console.log('Player corner assembly passed.');
  } else if (process.env.EAST_ASSEMBLY_REVIEW === '1') {
    const east = await page.evaluate(() => assemblyTimeoutReview.eastAssemblyRoute());
    await writeFile(join(directory, 'east-assembly.json'), JSON.stringify({ initial, east, errors }, null, 2));
    assert.equal(east.mode, 'sihang-assembly');
    assert.ok(east.position[0] > 28);
    assert.ok(east.route?.length > 1, JSON.stringify(east));
    assert.ok(east.route.some(point => Math.abs(point.z + 1.1) < .001), JSON.stringify(east));
    assert.deepEqual(errors, []);
    console.log('Eastern assembly route passed.');
  } else if (process.env.FULL_WAVE_REVIEW === '1') {
    const swap = await page.evaluate(() => assemblyTimeoutReview.swapOutsidePlayerArea());
    assert.ok(swap.goal.x > 26);
    assert.equal(swap.playerSlot, null, JSON.stringify(swap));
    assert.deepEqual(swap.otherSlot, { slot: swap.slot, index: 10 });
    const full = await page.evaluate(() => assemblyTimeoutReview.fullWaveStep(35));
    await writeFile(join(directory, 'full-wave.json'), JSON.stringify({
      fixture: 'manual-player-position-and-advanced-stage-clock-enemy-fire-delayed-real-simulation-steps',
      initial, full, errors }, null, 2));
    assert.equal(full.wave?.number, 1, JSON.stringify(full));
    assert.equal(full.wave.squads.length, 10);
    assert.equal(full.wave.squads.flat().length, 110, JSON.stringify(full));
    assert.equal(new Set(full.wave.squads.flat()).size, 110);
    assert.deepEqual(errors, []);
    console.log('Full 110-person withdrawal wave passed.');
  } else {
    const before = await page.evaluate(() => assemblyTimeoutReview.nearDeadline());
    const first = await page.evaluate(() => assemblyTimeoutReview.deadline());
    const movement = await page.evaluate(seconds => assemblyTimeoutReview.followOriginal(seconds), high ? 60 : 10);
    const next = await page.evaluate(() => assemblyTimeoutReview.nextWave());
    const secondBefore = await page.evaluate(() => assemblyTimeoutReview.nearDeadline());
    const second = await page.evaluate(() => assemblyTimeoutReview.deadline());
    await writeFile(join(directory, 'assembly-timeout.json'), JSON.stringify({
      fixture: 'manual-positions-and-advanced-clocks-normal-mission-and-ai-calls', initial, before, first, movement,
      next, secondBefore, second, errors,
    }, null, 2));
    assert.equal(initial.waiting.prepared, false);
    assert.equal(initial.waiting.remaining, null);
    assert.match(initial.waiting.help, /本队全部存活队员/);
    assert.equal(initial.prepared.prepared, true);
    assert.match(initial.prepared.help, /最迟30秒/);
    assert.equal(before.released, false);
    assert.equal(before.wave, null);
    assert.equal(first.started.released, true);
    assert.equal(first.started.wave.number, 1);
    assert.ok(first.started.wave.squads.flat().includes(initial.original.id),
      'the original distant soldier must remain in the timed-out withdrawal wave');
    assert.equal(movement.sameEntity, true);
    assert.ok(Math.hypot(movement.position[0] - initial.original.position[0],
      movement.position[2] - initial.original.position[2]) > 1,
    'the original distant soldier must physically move after the timeout');
    if (high) assert.equal(movement.reachedGroundAlive, true,
      `the original rooftop soldier must actually descend alive: ${JSON.stringify(movement)}`);
    if (high) assert.ok(movement.maxStep < .5, 'the original soldier must not teleport while descending');
    assert.ok(first.started.actors.length && first.started.actors.every(actor => actor.assembled));
    assert.ok(first.stepped.actors.every(actor => actor.mode !== 'sihang-assembly'));
    assert.equal(next.interval.wave.phase, 'interval');
    assert.equal(next.interval.remaining, 30);
    assert.equal(next.refill.wave, null);
    assert.equal(next.refill.remaining, 25);
    assert.match(next.refill.help, /最迟25秒/);
    assert.equal(secondBefore.wave, null);
    assert.equal(second.started.wave.number, 2);
    assert.ok(second.stepped.actors.every(actor => actor.mode !== 'sihang-assembly'));
    assert.deepEqual(errors, []);
    console.log('Assembly timeout and next-wave countdown passed.');
  }
} finally {
  await browser.close();
}
