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
    let source = await response.text();
    if (process.env.AUTONOMOUS_DROP_REVIEW_ONLY === '1') {
      const marker = "    const actor = allForces[(index + aiCursor) % allForces.length];";
      if (!source.includes(marker)) throw new Error('Cannot isolate the manually held builder');
      source = source.replace(marker, marker + `
        if (window.engineerReservationReview?.manualBuilder === actor) continue;`);
    }
    if (process.env.SIHANG_ASSEMBLY_HOLD === '1') {
      const marker = 'const goal = sihangActorAssemblyGoal(actor);';
      if (!source.includes(marker)) throw new Error('Cannot set the isolated assembly target');
      source = source.replace(marker, `const goal = actor === window.engineerReservationReview?.assemblyActor
        ? window.engineerReservationReview.site : sihangActorAssemblyGoal(actor);`);
    }
    if (process.env.SIHANG_LEADER_EVACUATED === '1') {
      const marker = 'walkActor(actor, sihangRetreatGoal(actor), 3, dt, false);';
      if (!source.includes(marker)) throw new Error('Cannot set the isolated withdrawal target');
      source = source.replace(marker, `walkActor(actor, actor === window.engineerReservationReview?.assemblyActor
        ? window.engineerReservationReview.site : sihangRetreatGoal(actor), 3, dt, false);`);
    }
    await route.fulfill({ response, body: source + `
      window.engineerReservationReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const builder = friendlyForces.find(actor => actor.health > 0 && actor !== controlledSoldier(entities) && actor.engineer);
          const teammate = friendlyForces.find(actor => actor.health > 0 && actor !== controlledSoldier(entities) && actor !== builder && !actor.engineer);
          if (!builder || !teammate) throw new Error('Expected friendly AI engineer and teammate');
          builder.engineer.heading = builder.heading = 0;
          let found = null;
          for (let z = battleArea.minZ + 8; z < battleArea.maxZ - 8 && !found; z += 5)
            for (let x = battleArea.minX + 8; x < battleArea.maxX - 8 && !found; x += 5) {
              const origin = { x, y: 0, z }, candidate = engineerPlacement(origin, 0);
              const approach = { x, y: 0, z: candidate.z - 3 };
              if (Math.abs(world.walkHeight(x, z, 0)) > .025 ||
                Math.abs(world.walkHeight(approach.x, approach.z, 0)) > .025 ||
                circleBlocked(x, z, .45, movementObstacles(x, z), 0) ||
                circleBlocked(approach.x, approach.z, .45, movementObstacles(approach.x, approach.z), 0) ||
                engineerPlacementReason(builder, candidate)) continue;
              found = { origin, candidate, approach };
            }
          if (!found) throw new Error('No clear engineering fixture');
          builder.position.set(found.origin.x, 0, found.origin.z);
          teammate.position.set(found.approach.x, 0, found.approach.z);
          teammate.heading = Math.PI; teammate.stance = 'standing'; teammate.firingPose = null;
          stopLocomotion(teammate.locomotion);
          if (teammate.nativeMotion) teammate.nativeMotion.position = { x: found.approach.x, z: found.approach.z };
          selectConstructionBlueprint(builder.engineer.construction, builder.id);
          updateEngineerConstruction(builder, .05, true, found.candidate);
          actorGrid.rebuild(allForces);
          this.builder = builder; this.teammate = teammate; this.site = found.candidate;
          this.initial = { ...found.approach };
          const blocker = infantryMovementObstacles(teammate, found.candidate.x, found.candidate.z)
            .some(obstacle => obstacle.id === 'construction-' + builder.id);
          const ownerBlocked = infantryMovementObstacles(builder, found.candidate.x, found.candidate.z)
            .some(obstacle => obstacle.id === 'construction-' + builder.id);
          return { blocker, ownerBlocked, progress: builder.engineer.construction.progress };
        },
        run() {
          const builder = this.builder, teammate = this.teammate, candidate = this.site;
          let minimumProgress = 1, entered = false, moved = 0;
          for (let i = 0; i < 400 && builder.engineer.materials.maxim24; i++) {
            time += .05; actorGrid.rebuild(allForces);
            teammate.path = [{ ...candidate }]; teammate.pathGoal = { ...candidate };
            walkActor(teammate, { ...candidate }, 3, .05, true);
            if (teammate.nativeMotion) advanceNraMotion(teammate, .05);
            const bounds = engineerObstacle('fixture', candidate, 0);
            entered ||= circleBlocked(teammate.position.x, teammate.position.z, .42, [bounds], teammate.position.y);
            moved = Math.hypot(teammate.position.x - this.initial.x, teammate.position.z - this.initial.z);
            updateEngineerConstruction(builder, .05, true, candidate);
            if (builder.engineer.materials.maxim24)
              minimumProgress = Math.min(minimumProgress, builder.engineer.construction.progress);
          }
          return { entered, moved, minimumProgress, materials: { ...builder.engineer.materials },
            works: engineerWorks.filter(work => work.builderId === builder.id).map(work => work.point.id) };
        },
        preparePlayer() {
          const player = controlledSoldier(entities);
          this.teammate.position.set(this.initial.x + 8, 0, this.initial.z);
          player.position.set(this.initial.x, 0, this.initial.z);
          controlPose.yaw = player.heading = Math.PI;
          controlPose.stance = player.stance = 'standing'; player.firingPose = null;
          stopLocomotion(player.locomotion);
          if (player.nativeMotion) player.nativeMotion.position = { x: player.position.x, z: player.position.z };
          actorGrid.rebuild(allForces);
        },
        stepPlayerLedge() {
          const player = controlledSoldier(entities), site = this.site;
          const slab = { minX: site.x - 5, maxX: site.x - .8,
            minZ: site.z - 3, maxZ: site.z + 3, minY: 3.8, height: 4, walkable: true };
          world.obstacles.push(slab); refreshEngineerObstacles(slab);
          player.position.set(site.x - 2, 4, site.z);
          player.traversal.kind = 'grounded'; player.traversal.velocity = 0;
          controlPose.yaw = player.heading = -Math.PI / 2;
          controlPose.stance = player.stance = 'standing'; player.firingPose = null;
          stopLocomotion(player.locomotion);
          if (player.nativeMotion) player.nativeMotion.position = { x: player.position.x, z: player.position.z };
          actorGrid.rebuild(allForces);
          setGameState('playing');
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
          setGameState('pause');
          const progress = this.builder.engineer.construction.progress;
          let minProgress = progress, airborne = false;
          for (let i = 0; i < 80; i++) {
            time += .025; actorGrid.rebuild(allForces); updatePlayer(.025);
            airborne ||= player.traversal.kind !== 'grounded';
            updateEngineerConstruction(this.builder, .025, true, site);
            minProgress = Math.min(minProgress, this.builder.engineer.construction.progress);
          }
          const stopped = { position: player.position.toArray(), kind: player.traversal.kind,
            support: landingHeight(player.position, player.position.y,
              movementObstacles(player.position.x, player.position.z), world.walkHeight),
            progress: this.builder.engineer.construction.progress, minProgress, airborne };
          cancelEngineer(this.builder.engineer);
          actorGrid.rebuild(allForces);
          for (let i = 0; i < 80; i++) {
            time += .025; actorGrid.rebuild(allForces); updatePlayer(.025);
          }
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
          keys.clear();
          return { site, slab, progress, stopped, released: { position: player.position.toArray(),
            kind: player.traversal.kind } };
        },
        stepPlayerDrop() {
          const player = controlledSoldier(entities), site = this.site;
          player.position.set(site.x, site.y + 3.5, site.z);
          player.traversal.kind = 'grounded';
          beginTraversal(player.traversal, player.position);
          player.traversal.velocity = 0;
          const bounds = engineerConstructionReservations(player, [this.builder]);
          const progress = this.builder.engineer.construction.progress;
          let entered = false, minProgress = progress, blockedProgress = null, changedWhileBlocked = false;
          const positions = [];
          for (let i = 0; i < 80 && player.traversal.kind !== 'grounded'; i++) {
            time += .025; actorGrid.rebuild(allForces);
            updateActorTraversal(player, .025);
            entered ||= circleBlocked(player.position.x, player.position.z, .4, bounds,
              player.position.y, 1.75);
            updateEngineerConstruction(this.builder, .025, true, site);
            if (this.builder.engineer.construction.blockedReason === ENGINEER_FRIENDLY_OCCUPIED) {
              const value = this.builder.engineer.construction.progress;
              if (blockedProgress === null) blockedProgress = value;
              else changedWhileBlocked ||= value !== blockedProgress;
            }
            minProgress = Math.min(minProgress, this.builder.engineer.construction.progress);
            positions.push(player.position.toArray());
          }
          return { entered, minProgress, progress, blockedProgress, changedWhileBlocked,
            reason: this.builder.engineer.construction.blockedReason, kind: player.traversal.kind,
            position: player.position.toArray(), positions };
        },
        resumeAfterPlayerDrop() {
          const player = controlledSoldier(entities);
          const before = player.position.clone();
          const bounds = engineerConstructionReservations(player, [this.builder]);
          controlPose.yaw = player.heading = -Math.PI / 2;
          stopLocomotion(player.locomotion);
          setGameState('playing');
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
          setGameState('pause');
          for (let i = 0; i < 120; i++) {
            time += .025; actorGrid.rebuild(allForces); updatePlayer(.025);
            updateEngineerConstruction(this.builder, .025, true, this.site);
          }
          const outside = player.position.toArray();
          const escaped = !circleBlocked(player.position.x, player.position.z, .4, bounds, player.position.y, 1.75);
          const progressAfterEscape = this.builder.engineer.construction.progress;
          controlPose.yaw = player.heading = Math.PI / 2;
          for (let i = 0; i < 60; i++) {
            time += .025; actorGrid.rebuild(allForces); updatePlayer(.025);
            updateEngineerConstruction(this.builder, .025, true, this.site);
          }
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
          keys.clear();
          const reentered = circleBlocked(player.position.x, player.position.z, .4, bounds, player.position.y, 1.75);
          const progressAfterReturn = this.builder.engineer.construction.progress;
          for (let i = 0; i < 500 && this.builder.engineer.materials.maxim24; i++) {
            time += .05;
            updateEngineerConstruction(this.builder, .05, true, this.site);
          }
          return { before: before.toArray(), outside, escaped, reentered, progressAfterEscape, progressAfterReturn,
            materials: this.builder.engineer.materials.maxim24,
            works: engineerWorks.filter(work => work.builderId === this.builder.id).length };
        },
        stepTeammateDrop() {
          const actor = this.teammate, site = this.site;
          actor.position.set(site.x, site.y + 3.5, site.z);
          actor.traversal.kind = 'grounded'; beginTraversal(actor.traversal, actor.position);
          actor.traversal.velocity = 0;
          for (let i = 0; i < 80 && actor.traversal.kind !== 'grounded'; i++) {
            time += .025; actorGrid.rebuild(allForces);
            updateActorTraversal(actor, .025); updateEngineerConstruction(this.builder, .025, true, site);
          }
          const start = actor.position.toArray(), progress = this.builder.engineer.construction.progress;
          const bounds = engineerConstructionReservations(actor, [this.builder]);
          const goal = { x: site.x + 5, y: site.y, z: site.z };
          actor.heading = -Math.PI / 2; stopLocomotion(actor.locomotion);
          for (let i = 0; i < 200; i++) {
            time += .025; actorGrid.rebuild(allForces);
            actor.path = [{ ...goal }]; actor.pathGoal = { ...goal };
            walkActor(actor, goal, 3, .025, true);
            updateEngineerConstruction(this.builder, .025, true, site);
          }
          const position = actor.position.toArray();
          const escaped = !circleBlocked(actor.position.x, actor.position.z, .42, bounds, actor.position.y, 1.75);
          const returnGoal = { x: site.x, y: site.y, z: site.z };
          for (let i = 0; i < 200; i++) {
            time += .025; actorGrid.rebuild(allForces);
            actor.path = [{ ...returnGoal }]; actor.pathGoal = { ...returnGoal };
            walkActor(actor, returnGoal, 3, .025, true);
            updateEngineerConstruction(this.builder, .025, true, site);
          }
          const finalProgress = this.builder.engineer.construction.progress;
          const inside = circleBlocked(actor.position.x, actor.position.z, .42, bounds, actor.position.y, 1.75);
          const mode = actor.tactics.mode, blockedBy = actor.tactics.blockedBy;
          for (let i = 0; i < 500 && this.builder.engineer.materials.maxim24; i++) {
            time += .05; actorGrid.rebuild(allForces);
            updateEngineerConstruction(this.builder, .05, true, site);
          }
          return { start, position, escaped, progress, finalProgress, inside, mode, blockedBy,
            materials: this.builder.engineer.materials.maxim24,
            works: engineerWorks.filter(work => work.builderId === this.builder.id).length };
        },
        autonomousTeammateDrop() {
          const actor = allies.find(item => item !== controlledSoldier(entities) &&
            item !== this.builder && item.health > 0 && !item.engineer);
          if (!actor) throw new Error('Expected a controllable squad teammate');
          const player = controlledSoldier(entities), site = this.site;
          const targets = [[10, 0], [-10, 0], [0, 10], [0, -10]];
          const offset = targets.find(([x, z]) => {
            const px = site.x + x, pz = site.z + z;
            return px > battleArea.minX + 3 && px < battleArea.maxX - 3 &&
              pz > battleArea.minZ + 3 && pz < battleArea.maxZ - 3 &&
              Math.abs(world.walkHeight(px, pz, site.y) - site.y) < .1 &&
              !circleBlocked(px, pz, .45, movementObstacles(px, pz), site.y);
          });
          if (!offset) throw new Error('No safe player location for follow fixture');
          player.position.set(site.x + offset[0], site.y, site.z + offset[1]);
          stopLocomotion(player.locomotion);
          actor.position.set(site.x, site.y + 3.5, site.z);
          actor.traversal.kind = 'grounded'; beginTraversal(actor.traversal, actor.position);
          actor.traversal.velocity = 0;
          actor.order = ${JSON.stringify(process.env.AUTONOMOUS_ORDER || 'follow')}; actor.orderTarget = null;
          if (actor.order === 'hold') actor.orderPoint = { ...site };
          actor.target = null; actor.tactics.lastSeen = null;
          actor.path = actor.pathGoal = null; actor.nextPath = 0;
          stopLocomotion(actor.locomotion);
          if (${JSON.stringify(process.env.SIHANG_RETREAT_HOLD === '1')}) {
            if (!sihangCampaignMode || actor.order !== 'hold')
              throw new Error('Retreat hold fixture requires Sihang and the hold order');
            sihangCampaign.stage = 'sihang-retreat';
            sihangCampaign.assemblyReleased = true;
            if (!actor.playerUnit) throw new Error('Expected player squad member: ' + actor.id);
          }
          if (${JSON.stringify(process.env.SIHANG_ASSEMBLY_HOLD === '1')}) {
            if (!sihangCampaignMode || !actor.playerUnit)
              throw new Error('Assembly fixture requires a Sihang player squad member');
            sihangCampaign.stage = 'sihang-retreat';
            sihangCampaign.assemblyReleased = false;
            this.assemblyActor = actor;
          }
          if (${JSON.stringify(process.env.SIHANG_LEADER_EVACUATED === '1')}) {
            if (!sihangCampaignMode || !actor.playerUnit)
              throw new Error('Evacuated leader fixture requires a Sihang player squad member');
            sihangCampaign.stage = 'sihang-retreat';
            sihangCampaign.assemblyReleased = true;
            player.sihangEvacuated = true;
            this.assemblyActor = actor;
          }
          enemies = []; friendlyForces = [player, actor, this.builder];
          allForces = [...friendlyForces]; entities.vehicles.clear();
          assaultAssignmentAt = populationRefreshAt = time + 100000;
          if (nanjingCampaign) nanjingCampaign.defenseUpdateAt = time + 100000;
          this.manualBuilder = this.builder;
          setGameState('playing');
          const start = actor.position.toArray(), samples = [];
          let maxHorizontalStep = 0;
          for (let i = 0; i < 600; i++) {
            const beforeX = actor.position.x, beforeZ = actor.position.z;
            time += .05; aiDecisions.beginFrame();
            if (actor.traversal.kind !== 'grounded') updateActorTraversal(actor, .05);
            updateAI(.05);
            maxHorizontalStep = Math.max(maxHorizontalStep,
              Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ));
            updateEngineerConstruction(this.builder, .05, true, site);
            if (i % 20 === 0) samples.push({ time, position: actor.position.toArray(),
              mode: actor.tactics.mode, pathReason: actor.tactics.pathReason,
              path: actor.path?.length ?? null, progress: this.builder.engineer.construction.progress,
              reason: this.builder.engineer.construction.blockedReason });
            if (!this.builder.engineer.materials.maxim24) break;
          }
          let modeAfterCompletion = null;
          if (${JSON.stringify(process.env.SIHANG_ASSEMBLY_HOLD === '1' || process.env.SIHANG_LEADER_EVACUATED === '1')} &&
            !this.builder.engineer.materials.maxim24) {
            time += .05; aiDecisions.beginFrame(); updateAI(.05);
            modeAfterCompletion = actor.tactics.mode;
          }
          setGameState('pause'); this.manualBuilder = null;
          return { start, player: player.position.toArray(), position: actor.position.toArray(),
            order: actor.order, maxHorizontalStep, samples, modeAfterCompletion,
            works: engineerWorks.filter(work => work.builderId === this.builder.id).length };
        },
        enemyAndFriendlyOccupancy() {
          const enemy = enemies.find(actor => actor.health > 0 && !actor.vehicleId);
          if (!enemy) throw new Error('Enemy occupancy fixture requires a living enemy on foot');
          const site = this.site;
          this.teammate.position.set(site.x, site.y, site.z);
          enemy.position.set(site.x + .6, site.y, site.z);
          actorGrid.rebuild(allForces);
          updateEngineerConstruction(this.builder, .025, true, site);
          const construction = this.builder.engineer.construction;
          return { progress: construction.progress, reason: construction.blockedReason,
            site: construction.site, mode: construction.mode };
        },
        stepVault() {
          const actor = this.teammate, site = this.site;
          actor.position.set(site.x, site.y, site.z - 2.05);
          if (actor.traversal.kind !== 'grounded') throw new Error('Vault fixture actor is not grounded');
          const start = { ...actor.position }, end = { x: site.x, y: site.y, z: site.z - 1.35 };
          if (circleBlocked(start.x, start.z, .4, movementObstacles(start.x, start.z), start.y, 1.75))
            throw new Error('Vault fixture start is physically blocked');
          const bounds = engineerConstructionReservations(actor, [this.builder]);
          if (circleBlocked(start.x, start.z, .4, bounds, start.y, 1.75))
            throw new Error('Vault fixture starts inside the reservation');
          beginTraversal(actor.traversal, actor.position, { start, end, top: site.y + .8 });
          actorGrid.rebuild(allForces);
          const progress = this.builder.engineer.construction.progress;
          let entered = false, minProgress = progress;
          for (let i = 0; i < 80 && actor.traversal.kind !== 'grounded'; i++) {
            time += .025; actorGrid.rebuild(allForces);
            updateActorTraversal(actor, .025);
            entered ||= circleBlocked(actor.position.x, actor.position.z, .4, bounds, actor.position.y, 1.75);
            updateEngineerConstruction(this.builder, .025, true, site);
            minProgress = Math.min(minProgress, this.builder.engineer.construction.progress);
          }
          const result = { entered, minProgress, progress, blocked: actor.traversal.blocked,
            kind: actor.traversal.kind, position: actor.position.toArray(),
            support: landingHeight(actor.position, actor.position.y,
              movementObstacles(actor.position.x, actor.position.z), world.walkHeight) };
          actor.position.set(this.initial.x, 0, this.initial.z);
          actor.traversal.blocked = false; actorGrid.rebuild(allForces);
          return result;
        },
        stepPlayerJump() {
          setGameState('playing');
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
          setGameState('pause');
          const player = controlledSoldier(entities), before = player.position.clone();
          const bounds = engineerConstructionReservations(player, [this.builder]);
          const progress = this.builder.engineer.construction.progress;
          let entered = false, airborne = false, minProgress = progress;
          for (let i = 0; i < 80; i++) {
            time += .025; actorGrid.rebuild(allForces); updatePlayer(.025);
            airborne ||= player.traversal.kind !== 'grounded';
            entered ||= circleBlocked(player.position.x, player.position.z, .4, bounds,
              player.position.y, 1.75);
            updateEngineerConstruction(this.builder, .025, true, this.site);
            minProgress = Math.min(minProgress, this.builder.engineer.construction.progress);
          }
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
          const result = { entered, airborne, minProgress, progress,
            moved: player.position.distanceTo(before), kind: player.traversal.kind,
            position: player.position.toArray() };
          keys.clear();
          return result;
        },
        stepPlayer() {
          setGameState('playing');
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
          setGameState('pause');
          const player = controlledSoldier(entities), before = player.position.clone();
          for (let i = 0; i < 80; i++) {
            time += .05; actorGrid.rebuild(allForces); updatePlayer(.05);
            updateEngineerConstruction(this.builder, .05, true, this.site);
          }
          const bounds = engineerObstacle('fixture', this.site, 0);
          const result = { moved: player.position.distanceTo(before),
            inside: circleBlocked(player.position.x, player.position.z, .45, [bounds], player.position.y),
            progress: this.builder.engineer.construction.progress };
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
          player.position.set(this.initial.x + 8, 0, this.initial.z); actorGrid.rebuild(allForces);
          this.teammate.position.set(this.initial.x, 0, this.initial.z); keys.clear();
          return result;
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  if (process.env.CAMPAIGN) url.searchParams.set('campaign', process.env.CAMPAIGN);
  if (process.env.BENCHMARK) url.searchParams.set('benchmark', process.env.BENCHMARK);
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  if (process.env.BENCHMARK) await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const initial = await page.evaluate(() => engineerReservationReview.setup());
  if (process.env.LEDGE_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => engineerReservationReview.stepPlayerLedge());
    await writeFile(join(directory, 'engineer-reservation-ledge.json'), JSON.stringify({
      fixture: 'synthetic-supported-ledge-over-active-construction-player-input-production-movement',
      initial, result, errors }, null, 2));
    assert.ok(result.stopped.position[0] > result.site.x - 1.8);
    assert.ok(result.stopped.position[0] <= result.slab.maxX + .4);
    assert.equal(result.stopped.kind, 'grounded');
    assert.equal(result.stopped.support, 4);
    assert.equal(result.stopped.airborne, false);
    assert.ok(result.stopped.progress > result.progress);
    assert.ok(result.stopped.minProgress >= result.progress);
    if (process.env.CAMPAIGN === 'nanjing') {
      assert.equal(result.released.position[0], result.stopped.position[0],
        'Nanjing retains its existing two-metre safe walking drop limit without a reservation');
      assert.equal(result.released.position[1], 4);
    } else {
      assert.ok(result.released.position[0] > result.stopped.position[0] + .5);
      assert.ok(result.released.position[1] < 4);
    }
    assert.deepEqual(errors, []);
    console.log('Supported ledge reservation passed.');
  } else if (process.env.ENEMY_OCCUPANCY_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => engineerReservationReview.enemyAndFriendlyOccupancy());
    await writeFile(join(directory, 'engineer-enemy-occupancy.json'), JSON.stringify({ initial, result, errors }, null, 2));
    assert.deepEqual(result, { progress: 0, reason: '敌军占据建造空间', site: null, mode: 'blocked' });
    assert.deepEqual(errors, []);
    console.log('Enemy occupancy still cancels construction.');
  } else if (process.env.AUTONOMOUS_DROP_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => engineerReservationReview.autonomousTeammateDrop());
    await writeFile(join(directory, 'engineer-reservation-autonomous.json'), JSON.stringify({
      fixture: 'isolated noncombat fixture: manually dropped squad member uses production AI and path scheduler; other soldiers and vehicles excluded, builder manually held; optional Sihang stage and leader status set manually; special fixtures set that actor’s goal inside the reservation',
      initial, result, errors }, null, 2));
    assert.ok(result.samples.some(sample => sample.reason === '队员占据建造空间'));
    assert.ok(result.samples.some(sample => sample.mode === 'clear-construction'));
    assert.ok(result.maxHorizontalStep < .3, 'teammate moves without teleportation');
    assert.equal(result.order, process.env.AUTONOMOUS_ORDER || 'follow');
    assert.equal(result.works, 1, 'construction resumes and completes without teleporting the teammate');
    if (process.env.SIHANG_ASSEMBLY_HOLD === '1')
      assert.equal(result.modeAfterCompletion, 'sihang-assembly', 'the original assembly task resumes');
    if (process.env.SIHANG_LEADER_EVACUATED === '1')
      assert.equal(result.modeAfterCompletion, 'sihang-follow-withdrawal', 'the original withdrawal task resumes');
    assert.deepEqual(errors, []);
    console.log(`Autonomous squad ${result.order} after construction intrusion passed.`);
  } else if (process.env.DROP_AI_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => engineerReservationReview.stepTeammateDrop());
    await writeFile(join(directory, 'engineer-reservation-ai-drop.json'), JSON.stringify({
      fixture: 'manually dropped teammate; production traversal, AI walking and construction updates',
      initial, result, errors }, null, 2));
    assert.equal(result.escaped, true, 'the teammate must walk out after landing');
    assert.equal(result.inside, false, 'the teammate must not return to the active site');
    assert.ok(result.finalProgress > result.progress);
    assert.equal(result.materials, 0);
    assert.equal(result.works, 1);
    assert.deepEqual(errors, []);
    console.log('Friendly AI construction reservation drop passed.');
  } else if (process.env.DROP_REVIEW_ONLY === '1' || process.env.DROP_PAUSE_REVIEW_ONLY === '1') {
    const drop = await page.evaluate(() => engineerReservationReview.stepPlayerDrop());
    const resumed = process.env.DROP_PAUSE_REVIEW_ONLY === '1'
      ? await page.evaluate(() => engineerReservationReview.resumeAfterPlayerDrop()) : null;
    await writeFile(join(directory, 'engineer-reservation-drop.json'), JSON.stringify({
      fixture: 'Manually placed player above active friendly construction; production gravity and construction updates.',
      initial, drop, resumed, errors,
    }, null, 2));
    if (process.env.DROP_REVIEW_ONLY === '1')
      assert.equal(drop.entered, false, 'falling player must not enter the reserved site');
    else {
      assert.equal(drop.entered, true, 'this fixture exercises unavoidable intrusion before the boundary is fixed');
      assert.equal(drop.reason, '队员占据建造空间');
      assert.ok(drop.blockedProgress > 0);
      assert.equal(drop.changedWhileBlocked, false);
      assert.equal(resumed.escaped, true, 'the player must actually walk out after landing');
      assert.equal(resumed.reentered, false, 'the player must not re-enter the active site');
      assert.ok(resumed.progressAfterEscape > drop.blockedProgress);
      assert.ok(resumed.progressAfterReturn >= resumed.progressAfterEscape);
      assert.equal(resumed.materials, 0);
      assert.equal(resumed.works, 1);
    }
    assert.ok(drop.minProgress >= drop.progress, 'falling player must not reset ongoing construction');
    assert.equal(drop.kind, 'grounded');
    assert.deepEqual(errors, []);
    console.log('Friendly construction reservation drop passed.');
  } else {
    const vault = await page.evaluate(() => engineerReservationReview.stepVault());
    await page.evaluate(() => engineerReservationReview.preparePlayer());
    const jump = await page.evaluate(() => engineerReservationReview.stepPlayerJump());
    await page.evaluate(() => engineerReservationReview.preparePlayer());
    const player = await page.evaluate(() => engineerReservationReview.stepPlayer());
    const result = await page.evaluate(() => engineerReservationReview.run());
    await writeFile(join(directory, 'engineer-reservation.json'), JSON.stringify({
      fixture: 'manual-positions-production-engineer-ai-walking-synthetic-vault-and-player-input', initial, vault, jump, player, result, errors,
    }, null, 2));
    assert.equal(initial.blocker, true);
    assert.equal(initial.ownerBlocked, false);
    assert.ok(initial.progress > 0);
    assert.equal(vault.entered, false);
    assert.equal(vault.blocked, true);
    assert.equal(vault.kind, 'grounded');
    assert.equal(vault.position[1], vault.support);
    assert.ok(vault.minProgress >= vault.progress);
    assert.equal(jump.airborne, true);
    assert.equal(jump.entered, false);
    assert.ok(jump.moved > .1);
    assert.equal(jump.kind, 'grounded');
    assert.ok(jump.minProgress >= jump.progress);
    assert.ok(player.moved > .1);
    assert.equal(player.inside, false);
    assert.ok(player.progress > 3.9);
    assert.equal(result.entered, false);
    assert.ok(result.moved > .1, 'teammate must actually approach the reserved site');
    assert.ok(result.minimumProgress > 0, 'construction must not reset');
    assert.equal(result.materials.maxim24, 0);
    assert.equal(result.works.length, 1);
    assert.deepEqual(errors, []);
    console.log('Friendly construction reservation passed.');
  }
} finally {
  await browser.close();
}
