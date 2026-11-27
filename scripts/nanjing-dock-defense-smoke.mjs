import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
      window.nanjingDockReview = {
        gate() {
          return { stage: nanjingCampaign.stage, friendly: friendlyForces.filter(a => a.health > 0).length,
            roles: friendlyAI.filter(a => a.health > 0).map(a => a.tactics.nanjingDefense),
            playerOrders: allies.map(a => a.order) };
        },
        dock() {
          setGameState('pause'); missionBriefing.hide();
          nanjingCampaign.stage = 'withdrawal'; nanjingCampaign.stageRemaining = 0;
          updateNanjingMission(0); activateNanjingDock(nanjingCampaign); updateNanjingMission(0);
          setGameState('playing');
          let incursions = 0;
          for (let i = 0; i < 200 && !nanjingCampaign.outcome; i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time + .05);
            incursions += enemies.filter(a => a.health > 0 && !a.vehicleId && nanjingDockInside(a.position, .4)).length;
          }
          setGameState('pause'); updateHUD();
          const actor = enemies.find(a => a.health > 0 && !a.vehicleId);
          if (!actor) throw new Error('Missing actual attacker for movement verification');
          const old = actor.position.clone();
          actor.position.set(NANJING_DOCK_BUFFER.maxX - 2, 0, NANJING_DOCK_BUFFER.maxZ + 2);
          moveInfantry(actor.position, 0, -8, .42, movementObstacles(actor.position.x, actor.position.z));
          const blockedPosition = actor.position.toArray(); actor.position.copy(old);
          return { stage: nanjingCampaign.stage, outcome: nanjingCampaign.outcome, incursions, blockedPosition,
            buffer: NANJING_DOCK_BUFFER, dock: NANJING_DOCK,
            friendlySpawns: formations.filter(unit => unit.team === 'friendly' && !unit.player)
              .map(unit => ({ index: unit.index, spawnId: unit.spawnId, reserve: unit.reserve,
                spawnedAt: unit.members[0]?.spawnPosition })),
            posts: friendlyAI.filter(a => a.health > 0).map(a => ({ point: a.tactics.nanjingDockDefense,
              position: a.position.toArray(), spawn: a.formation.spawnId, mode: a.tactics.mode })),
            playerOrders: allies.map(a => a.order),
            goals: enemies.filter(a => a.health > 0 && !a.vehicleId).map(a => ({
              formation: a.formation.index, goal: formationDestination(a, objectives[1]) })),
            dockEnemyPath: dockNavigate({ x: NANJING_DOCK_BUFFER.maxX - 2, z: NANJING_DOCK_BUFFER.minZ - 3 },
              { x: NANJING_DOCK_BUFFER.maxX - 2, z: NANJING_DOCK_BUFFER.maxZ + 3 }) };
        },
        respawn(spawnId) {
          setGameState('playing');
          const formation = formations.find(item => item.team === 'friendly' && !item.player && !item.reserve &&
            item.spawnId === spawnId && item.members.some(actor => actor.health > 0));
          if (!formation) throw new Error('Missing living AI formation');
          const generation = formation.generation;
          for (const actor of formation.members) actor.health = 0;
          formation.respawnAt = time; populationRefreshAt = time;
          aiDecisions.beginFrame(); advanceBattleStep(.05, time + .05);
          const positions = formation.members.filter(actor => actor.health > 0).map(actor => actor.position.toArray());
          for (let i = 0; i < 40 && !nanjingCampaign.outcome; i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time + .05);
          }
          setGameState('pause');
          return { generation, newGeneration: formation.generation, spawn: formation.spawnId, positions,
            posts: formation.members.filter(actor => actor.health > 0).map(actor => actor.tactics.nanjingDockDefense) };
        },
        preparePlayerRespawn() {
          for (const actor of allies) actor.health = 0;
          showOverlay('dead');
        },
        playerBoundary() {
          setGameState('pause');
          const before = allies.map(actor => actor.health);
          updateBattleBoundary(BOUNDARY_RULES.graceSeconds + 1);
          return { area: battleArea, positions: allies.map(actor => actor.position.toArray()),
            before, after: allies.map(actor => actor.health),
            outside: allies.map(actor => boundaryStates.get(actor.id)?.outside ?? false) };
        },
        civilianProtection() {
          const actor = enemies.find(a => a.health > 0 && !a.vehicleId);
          const person = world.civilians.find(c => c.parent === scene && !c.userData.dead);
          if (!actor || !person) throw new Error('Missing attacker or civilian for dock protection');
          const oldActor = actor.position.clone(), oldPerson = person.position.clone();
          const oldTarget = actor.tactics.civilianTarget, oldThink = actor.tactics.civilianThinkAt;
          const oldVisible = person.visible, oldActive = world.civilians.map(c => c.userData.active);
          for (const civilian of world.civilians) civilian.userData.active = false;
          actor.position.set(NANJING_DOCK.x + 21, 0, NANJING_DOCK.z);
          person.position.set(NANJING_DOCK.x + 18, 0, NANJING_DOCK.z);
          person.visible = true; person.userData.active = true; actor.tactics.civilianThinkAt = 0;
          civilianCombatTime = -1;
          const selectedOutside = nanjingCivilianPursuitTarget(actor) === person;
          person.position.set(NANJING_DOCK.x + 16, 0, NANJING_DOCK.z); time += .05; civilianCombatTime = -1;
          const selectedInside = nanjingCivilianPursuitTarget(actor) === person;
          const attackInside = nanjingCivilianAttackTargets().some(target => target.civilian === person);
          const physicalInside = nanjingCivilianCombatTargets().some(target => target.civilian === person);
          const soldierOutside = nanjingEnemyPersonTargetAllowed({ targetKind: 'person', position: { x: NANJING_DOCK.x + 18, z: NANJING_DOCK.z } });
          const soldierInside = nanjingEnemyPersonTargetAllowed({ targetKind: 'person', position: { x: NANJING_DOCK.x + 16, z: NANJING_DOCK.z } });
          actor.position.copy(oldActor); person.position.copy(oldPerson); person.visible = oldVisible;
          world.civilians.forEach((civilian, index) => { civilian.userData.active = oldActive[index]; });
          actor.tactics.civilianTarget = oldTarget; actor.tactics.civilianThinkAt = oldThink;
          civilianCombatTime = -1;
          return { selectedOutside, selectedInside, attackInside, physicalInside, soldierOutside, soldierInside };
        },
        gateAssault() {
          setGameState('pause');
          const units = formations.filter(unit => unit.team === 'enemy' && unit.type === 'infantry' &&
            unit.index % 2 === 0);
          const actors = units.map(unit => unit.members.find(actor => actor.index === 2));
          if (actors.length !== 4 || actors.some(actor => !actor)) throw new Error('Missing assault formations');
          const friendlyRespawns = formations.filter(unit => unit.team === 'friendly' && !unit.player)
            .map(unit => ({ unit, enabled: unit.respawnEnabled }));
          for (const { unit } of friendlyRespawns) unit.respawnEnabled = false;
          rebuildForces();
          for (const actor of allForces) actor.health = 0;
          for (const actor of actors) { actor.health = 100; actor.vehicleId = 'fixture-inactive'; }
          for (const civilian of world.civilians) civilian.visible = false;
          const results = [];
          for (const actor of actors) {
            actor.vehicleId = null;
            actor.position.set(-64, 0, -60);
            actor.hasFirearm = false;
            actor.path = actor.pathGoal = actor.target = null;
            actor.blastReaction = actor.dying = null;
            actor.traversal.kind = 'grounded';
            actor.grenades.action = null;
            actor.tactics.throwIntent = null; actor.tactics.packApproach = null;
            actor.tactics.throwDecisionAt = Infinity;
            cancelAIMelee(actor);
            actor.tactics.lastSeen = null;
            actor.tactics.civilianTarget = null;
            actor.tactics.nanjingGateAssaultReady = false;
            rebuildForces();
            const samples = [];
            for (let frame = 0; frame < 600 && actor.position.x > -75; frame++) {
              time += .05;
              aiDecisions.beginFrame();
              updateAI(.05);
              if (actor.nativeMotion) advanceNraMotion(actor, .05);
              samples.push(actor.position.toArray());
            }
            for (let frame = 0; frame < 1400 && actor.tactics.mode !== 'dock-perimeter-guard'; frame++) {
              time += .05;
              aiDecisions.beginFrame();
              updateAI(.05);
              if (actor.nativeMotion) advanceNraMotion(actor, .05);
            }
            results.push({ formation: actor.formation.index, position: actor.position.toArray(),
              mode: actor.tactics.mode, goal: formationDestination(actor, objectives[1]),
              ready: actor.tactics.nanjingGateAssaultReady, health: actor.health,
              vehicleId: actor.vehicleId, emplacementId: actor.emplacementId,
              traversal: actor.traversal.kind, dying: actor.dying, blastReaction: actor.blastReaction,
              state, present: allForces.includes(actor), pathReason: actor.tactics.pathReason,
              target: actor.target && { id: actor.target.id, health: actor.target.health,
                team: actor.target.team, kind: actor.target.targetKind },
              livingFriends: friendlyForces.filter(friend => friend.health > 0).length,
              civilianTarget: Boolean(actor.tactics.civilianTarget),
              path: actor.path, samples });
            this.guard = actor;
            actor.health = 0;
          }
          for (const { unit, enabled } of friendlyRespawns) unit.respawnEnabled = enabled;
          return results;
        },
        guardCombat() {
          const guard = this.guard, player = controlledSoldier(entities);
          if (!guard || !player) throw new Error('Missing guard or player for combat check');
          guard.health = 100; guard.hasFirearm = true;
          guard.nextThink = 0; guard.target = null; guard.tactics.lastSeen = null;
          player.health = 100000; player.dying = null; player.blastReaction = null;
          let target = null;
          for (let x = -98; x <= -76 && !target; x += 2)
            for (let z = -76; z <= -42 && !target; z += 2) {
              const distance = Math.hypot(x - guard.position.x, z - guard.position.z);
              if (distance < 12 || distance > 20 || nanjingDockInside({ x, z }, .65) ||
                circleBlocked(x, z, .5, movementObstacles(x, z), 0)) continue;
              if (hasLine(new THREE.Vector3(guard.position.x, 1.4, guard.position.z),
                new THREE.Vector3(x, 1.2, z), 30)) target = { x, z };
            }
          if (!target) throw new Error('No clear target position for guard combat check');
          player.position.set(target.x, 0, target.z);
          if (player.nativeMotion) player.nativeMotion.position = target;
          guard.heading = Math.atan2(guard.position.x - target.x, guard.position.z - target.z);
          rebuildForces();
          const before = guard.rifle.shots;
          setGameState('playing');
          for (let i = 0; i < 400 && guard.rifle.shots === before && guard.health > 0; i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time + .05);
          }
          setGameState('pause');
          return { before, shots: guard.rifle.shots, mode: guard.tactics.mode,
            lastShot: guard.tactics.lastShot, target, health: guard.health };
        },
        positionFenceVault() {
          setGameState('pause');
          const actor = controlledSoldier(entities);
          const x = NANJING_DOCK.x + 9.25;
          actor.position.set(x, world.groundHeight(x, -90.7), -90.7);
          if (circleBlocked(actor.position.x, actor.position.z, .4, deploymentObstacles(), actor.position.y))
            throw new Error('Fence vault starting point is blocked');
          actor.traversal.kind = 'grounded'; actor.locomotion.stamina = 1;
          controlPose.yaw = Math.PI;
          setGameState('playing');
          return actor.position.toArray();
        },
        fenceVaultStatus() {
          const actor = controlledSoldier(entities);
          return { position: actor.position.toArray(), traversal: actor.traversal.kind };
        },
        ending() {
          battleEnding.reset();
          const now = performance.now();
          battleEnding.start('commemoration', now - 9000);
          battleEnding.update(now);
          const page = $('battle-ending-page');
          return { text: page.textContent, links: page.querySelectorAll('a').length, hidden: page.hidden };
        },
        view(direction) {
          setGameState('pause');
          $('hud').hidden = true;
          for (const child of camera.children) child.visible = false;
          if (direction === 'north') {
            camera.position.set(-91, 1.65, -103);
            camera.lookAt(-91, 1.4, -150);
          } else if (direction === 'dock') {
            camera.position.set(-78, 4, -72);
            camera.lookAt(NANJING_DOCK.x + 16.8, 1.5, NANJING_DOCK.z);
          } else {
            const gate = scene.children.find(object => object.userData.nanjingFeature === 'west-gate-name');
            if (!gate) throw new Error('Missing western gate name');
            camera.position.set(-84, 1.65, gate.position.z);
            camera.lookAt(-72, 4.5, gate.position.z);
          }
          renderer.render(scene, camera);
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353/').href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000, polling: 500 });
  const gate = await page.evaluate(() => nanjingDockReview.gate());
  assert.equal(gate.stage, 'gate-defense');
  assert.equal(gate.friendly, 33);
  assert.equal(gate.roles.filter(role => role?.role === 'wall').length, 6);
  assert.equal(gate.roles.filter(role => role?.role === 'courtyard' && role.slot < 3).length, 6);
  assert.equal(gate.roles.filter(role => role?.role === 'reserve').length, 4);
  const dock = await page.evaluate(() => nanjingDockReview.dock());
  await writeFile(join(directory, 'nanjing-defense.json'), JSON.stringify({ gate, dock, errors }, null, 2));
  assert.equal(dock.stage, 'dock-defense');
  assert.equal(dock.outcome, null);
  assert.equal(dock.incursions, 0, 'normal attackers cannot enter the civilian queue');
  assert.ok(dock.blockedPosition[2] >= dock.buffer.maxZ + .42 - .01, 'actual actor movement must respect the buffer');
  assert.ok(dock.posts.length >= 22);
  assert.deepEqual(dock.friendlySpawns.map(unit => unit.spawnId),
    ['nanjing-west-dock', 'nanjing-west-dock-south', 'nanjing-west-dock', 'nanjing-west-dock-south']);
  assert.ok(dock.posts.every(a => a.point && a.point.x >= -68 && a.point.x <= -54 &&
    Math.abs(a.point.z + 60) <= 10), 'AI defense posts are near the west gate');
  assert.deepEqual(dock.playerOrders, gate.playerOrders);
  assert.ok(dock.goals.every(({ formation, goal }) => formation % 2
    ? goal.x >= -58 && goal.x <= -54 && Math.abs(goal.z + 60) <= 4
    : (goal.x === -66 && goal.z === -60 || goal.x <= -78 && Math.abs(goal.z + 60) < 3)),
  'alternating formations advance through the gate or hold the inner line');
  assert.ok(dock.dockEnemyPath.length > 0);
  const respawns = [];
  for (const spawnId of ['nanjing-west-dock', 'nanjing-west-dock-south']) {
    const respawn = await page.evaluate(id => nanjingDockReview.respawn(id), spawnId);
    respawns.push(respawn);
    assert.equal(respawn.newGeneration, respawn.generation + 1, 'a lost squad actually respawns');
    assert.equal(respawn.positions.length, 11, 'the full squad respawns');
    assert.equal(respawn.spawn, spawnId);
    assert.ok(respawn.positions.every(position => respawn.spawn === 'nanjing-west-dock'
      ? position[0] >= -70 && position[0] <= -51 && position[2] >= -55 && position[2] <= -29
      : position[0] >= -112 && position[0] <= -101.5 && position[2] >= -61 && position[2] <= -49),
    'the full AI squad starts at the shared player deployment zone');
    assert.ok(respawn.positions.every(position => position[2] >= -104 && position[2] <= 96),
      'the complete AI squad respawns inside the real battle boundary');
    assert.ok(respawn.posts.length && respawn.posts.every(post => post &&
      post.x >= -68 && post.x <= -54 && Math.abs(post.z + 60) <= 10), 'respawned AI is assigned to the west gate');
  }
  await writeFile(join(directory, 'shared-ai-respawns.json'), JSON.stringify(respawns, null, 2));
  await page.evaluate(() => nanjingDockReview.preparePlayerRespawn());
  const marker = page.locator('[data-spawn="nanjing-west-dock-south"]');
  await marker.click();
  await page.screenshot({ path: join(directory, 'dock-deployment.png') });
  await page.locator('#confirm-deploy').click();
  const playerBoundary = await page.evaluate(() => nanjingDockReview.playerBoundary());
  assert.equal(playerBoundary.positions.length, 11);
  assert.ok(playerBoundary.positions.every(([x, , z]) => z > dock.dock.z &&
    x < -74.2 && x > dock.dock.x + 4), 'the whole squad deploys south of the dock on land outside the wall');
  assert.ok(playerBoundary.positions.every(([x, , z]) => x >= playerBoundary.area.minX &&
    x <= playerBoundary.area.maxX && z >= playerBoundary.area.minZ && z <= playerBoundary.area.maxZ));
  assert.ok(playerBoundary.outside.every(outside => !outside), 'no player squad member starts outside');
  assert.deepEqual(playerBoundary.after, playerBoundary.before, 'spawning never causes boundary damage');
  await page.evaluate(() => nanjingDockReview.preparePlayerRespawn());
  await page.locator('[data-spawn="nanjing-west-dock"]').click();
  await page.locator('#confirm-deploy').click();
  const cityPlayer = await page.evaluate(() => nanjingDockReview.playerBoundary());
  assert.equal(cityPlayer.positions.length, 11);
  assert.ok(cityPlayer.positions.every(([x, , z]) => x >= -70 && x <= -51 && z >= -55 && z <= -29));
  assert.ok(cityPlayer.outside.every(outside => !outside));
  assert.deepEqual(cityPlayer.after, cityPlayer.before);
  await writeFile(join(directory, 'shared-player-respawns.json'), JSON.stringify({ playerBoundary, cityPlayer }, null, 2));
  for (const direction of ['north', 'gate', 'dock']) {
    await page.evaluate(direction => nanjingDockReview.view(direction), direction);
    await page.screenshot({ path: join(directory, `dock-${direction}.png`) });
  }
  const protection = await page.evaluate(() => nanjingDockReview.civilianProtection());
  assert.deepEqual(protection, { selectedOutside: true, selectedInside: false,
    attackInside: false, physicalInside: true, soldierOutside: true, soldierInside: false },
    'AI drops the target when a person crosses the entrance');
  const vaultStart = await page.evaluate(() => nanjingDockReview.positionFenceVault());
  await page.keyboard.press('f');
  await page.waitForTimeout(1800);
  const vaultEnd = await page.evaluate(() => nanjingDockReview.fenceVaultStatus());
  assert.ok(vaultEnd.position[2] > -90 + .4 && vaultEnd.position[2] > vaultStart[2],
    `F must cross the actual fence: ${JSON.stringify({ vaultStart, vaultEnd })}`);
  assert.equal(vaultEnd.traversal, 'grounded');
  const crossings = await page.evaluate(() => nanjingDockReview.gateAssault());
  await writeFile(join(directory, 'gate-crossings.json'), JSON.stringify(crossings, null, 2));
  for (const crossing of crossings) {
    assert.ok(crossing.position[0] < -74.2, `formation ${crossing.formation} did not cross the wall`);
    assert.ok(crossing.samples.filter(([x]) => x >= -74.2 && x <= -69.8)
      .every(([, , z]) => Math.abs(z + 60) < 3.4), 'actual AI must cross through the gate opening');
    assert.equal(crossing.mode, 'dock-perimeter-guard', JSON.stringify(crossing));
  }
  assert.ok(new Set(crossings.map(crossing => `${crossing.goal.x},${crossing.goal.z}`)).size === 4,
    'the four assault formations use different guard posts');
  const combat = await page.evaluate(() => nanjingDockReview.guardCombat());
  assert.ok(combat.shots > combat.before, `a guard must still engage an actually visible opponent: ${JSON.stringify(combat)}`);
  await writeFile(join(directory, 'guard-combat.json'), JSON.stringify(combat, null, 2));
  const ending = await page.evaluate(() => nanjingDockReview.ending());
  assert.equal(ending.hidden, false);
  assert.match(ending.text, /中华门/);
  assert.doesNotMatch(ending.text, /新华网|新华社|人民日报|人民网/);
  assert.equal(ending.links, 0, 'the ending screen does not show source links');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, coreGuards: 6, dockPosts: dock.posts.length,
    enemyIncursions: dock.incursions, guardCombat: combat.shots > combat.before, errors }));
} finally {
  await browser.close();
}
