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
          actor.position.set(-57, 0, -80);
          moveInfantry(actor.position, -8, 0, .42, movementObstacles(-57, -80));
          const blockedPosition = actor.position.toArray(); actor.position.copy(old);
          return { stage: nanjingCampaign.stage, outcome: nanjingCampaign.outcome, incursions, blockedPosition,
            posts: friendlyAI.filter(a => a.health > 0).map(a => ({ point: a.tactics.nanjingDockDefense,
              position: a.position.toArray(), spawn: a.formation.spawnId, mode: a.tactics.mode })),
            playerOrders: allies.map(a => a.order),
            goals: enemies.filter(a => a.health > 0 && !a.vehicleId).map(a => formationDestination(a, objectives[1])),
            dockEnemyPath: dockNavigate({ x: -65, z: -95 }, { x: -65, z: -65 }) };
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
  assert.ok(dock.blockedPosition[0] >= -58.08, 'actual actor movement must respect the buffer');
  assert.ok(dock.posts.length >= 22);
  assert.ok(dock.posts.every(a => a.point && a.point.x > -58));
  assert.deepEqual(dock.playerOrders, gate.playerOrders);
  assert.ok(dock.goals.every(goal => goal.x > -58));
  assert.ok(dock.dockEnemyPath.length > 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, coreGuards: 6, dockPosts: dock.posts.length,
    enemyIncursions: dock.incursions, errors }));
} finally {
  await browser.close();
}
