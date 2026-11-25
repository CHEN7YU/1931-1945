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
          actor.position.set(-82, 0, -68);
          moveInfantry(actor.position, 0, -8, .42, movementObstacles(-82, -68));
          const blockedPosition = actor.position.toArray(); actor.position.copy(old);
          return { stage: nanjingCampaign.stage, outcome: nanjingCampaign.outcome, incursions, blockedPosition,
            posts: friendlyAI.filter(a => a.health > 0).map(a => ({ point: a.tactics.nanjingDockDefense,
              position: a.position.toArray(), spawn: a.formation.spawnId, mode: a.tactics.mode })),
            playerOrders: allies.map(a => a.order),
            goals: enemies.filter(a => a.health > 0 && !a.vehicleId).map(a => formationDestination(a, objectives[1])),
            dockEnemyPath: dockNavigate({ x: -92, z: -95 }, { x: -92, z: -65 }) };
        },
        respawn() {
          setGameState('playing');
          const formation = formations.find(item => item.team === 'friendly' && !item.player && !item.reserve &&
            item.members.some(actor => actor.health > 0));
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
          actor.position.set(-77, 0, -80); person.position.set(-80, 0, -80);
          person.visible = true; person.userData.active = true; actor.tactics.civilianThinkAt = 0;
          civilianCombatTime = -1;
          const selectedOutside = nanjingCivilianPursuitTarget(actor) === person;
          person.position.set(-82, 0, -80); time += .05; civilianCombatTime = -1;
          const selectedInside = nanjingCivilianPursuitTarget(actor) === person;
          const attackInside = nanjingCivilianAttackTargets().some(target => target.civilian === person);
          const physicalInside = nanjingCivilianCombatTargets().some(target => target.civilian === person);
          const soldierOutside = nanjingEnemyPersonTargetAllowed({ targetKind: 'person', position: { x: -80, z: -80 } });
          const soldierInside = nanjingEnemyPersonTargetAllowed({ targetKind: 'person', position: { x: -82, z: -80 } });
          actor.position.copy(oldActor); person.position.copy(oldPerson); person.visible = oldVisible;
          world.civilians.forEach((civilian, index) => { civilian.userData.active = oldActive[index]; });
          actor.tactics.civilianTarget = oldTarget; actor.tactics.civilianThinkAt = oldThink;
          civilianCombatTime = -1;
          return { selectedOutside, selectedInside, attackInside, physicalInside, soldierOutside, soldierInside };
        },
        view(direction) {
          setGameState('pause');
          $('hud').hidden = true;
          for (const child of camera.children) child.visible = false;
          if (direction === 'north') {
            camera.position.set(-91, 1.65, -103);
            camera.lookAt(-91, 1.4, -150);
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
  assert.ok(dock.blockedPosition[2] >= -69.08, 'actual actor movement must respect the buffer');
  assert.ok(dock.posts.length >= 22);
  assert.ok(dock.posts.every(a => a.point && a.point.x >= -68 && a.point.x <= -54 &&
    Math.abs(a.point.z + 60) <= 10), 'AI defense posts are near the west gate');
  assert.deepEqual(dock.playerOrders, gate.playerOrders);
  assert.ok(dock.goals.every(goal => goal.x >= -58 && goal.x <= -54 &&
    Math.abs(goal.z + 60) <= 4));
  assert.ok(dock.dockEnemyPath.length > 0);
  const respawn = await page.evaluate(() => nanjingDockReview.respawn());
  assert.equal(respawn.newGeneration, respawn.generation + 1, 'a lost squad actually respawns');
  assert.equal(respawn.positions.length, 11, 'the full squad respawns');
  assert.ok(respawn.positions.every(position => position[0] < -74.2 &&
    position[2] < -80 && Math.hypot(position[0] + 98, position[2] + 80) < 30),
    'the squad starts north of the ferry and outside the west wall');
  assert.ok(respawn.positions.every(position => position[2] >= -104 && position[2] <= 96),
    'the complete AI squad respawns inside the real battle boundary');
  assert.ok(respawn.posts.length && respawn.posts.every(post => post &&
    post.x >= -68 && post.x <= -54 && Math.abs(post.z + 60) <= 10), 'respawned AI is assigned to the west gate');
  await page.evaluate(() => nanjingDockReview.preparePlayerRespawn());
  const marker = page.locator('[data-spawn="nanjing-west-dock"]');
  await marker.click();
  await page.screenshot({ path: join(directory, 'dock-deployment.png') });
  await page.locator('#confirm-deploy').click();
  const playerBoundary = await page.evaluate(() => nanjingDockReview.playerBoundary());
  assert.equal(playerBoundary.positions.length, 11);
  assert.ok(playerBoundary.positions.every(([x, , z]) => x >= playerBoundary.area.minX &&
    x <= playerBoundary.area.maxX && z >= playerBoundary.area.minZ && z <= playerBoundary.area.maxZ));
  assert.ok(playerBoundary.outside.every(outside => !outside), 'no player squad member starts outside');
  assert.deepEqual(playerBoundary.after, playerBoundary.before, 'spawning never causes boundary damage');
  for (const direction of ['north', 'gate']) {
    await page.evaluate(direction => nanjingDockReview.view(direction), direction);
    await page.screenshot({ path: join(directory, `dock-${direction}.png`) });
  }
  const protection = await page.evaluate(() => nanjingDockReview.civilianProtection());
  assert.deepEqual(protection, { selectedOutside: true, selectedInside: false,
    attackInside: false, physicalInside: true, soldierOutside: true, soldierInside: false },
    'AI drops the target when a person crosses the entrance');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, coreGuards: 6, dockPosts: dock.posts.length,
    enemyIncursions: dock.incursions, errors }));
} finally {
  await browser.close();
}
