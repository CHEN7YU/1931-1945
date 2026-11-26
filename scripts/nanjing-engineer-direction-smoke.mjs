import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.nanjingEngineerDirectionFixture = () => {
        setGameState('pause'); missionBriefing.hide();
        const builder = friendlyAI.find(actor => actor.health > 0 && actor.engineer?.kits);
        const enemy = enemies.find(actor => !actor.vehicleId);
        if (!builder || !enemy) throw new Error('Missing engineer or attacker for construction fixture');
        for (const actor of allForces) actor.health = 0;
        builder.health = enemy.health = 100;
        nanjingCampaign.stage = 'dock-defense';
        builder.formation.objectiveId = 'dock'; builder.tactics.suppressedUntil = 0;
        cancelEngineer(builder.engineer); builder.engineer.planAt = 0;
        builder.engineer.selected = ENGINEER.profiles.find(profile => builder.engineer.materials[profile]);
        let found = false;
        for (let x = -70; x <= -50 && !found; x += 2)
          for (let z = -70; z <= -50 && !found; z += 2) {
            builder.position.set(x, 0, z); enemy.position.set(x + 35, 0, z);
            builder.traversal.kind = 'grounded'; stopLocomotion(builder.locomotion);
            builder.engineer.heading = -Math.PI / 2;
            actorGrid.rebuild(allForces);
            if (!engineerPlacementReason(builder, engineerPlacement(builder.position, builder.engineer.heading))) found = true;
          }
        if (!found) throw new Error('No clear dock-side construction fixture');
        builder.engineer.heading = null;
        engineerPlanBudget = 2;
        for (let i = 0; i < 410 && !engineerWorks.some(work => work.builderId === builder.id); i++) {
          time += .05; actorGrid.rebuild(allForces); operateAIEngineer(builder, .05);
        }
        const work = engineerWorks.find(item => item.builderId === builder.id);
        if (!work) throw new Error('Engineer did not complete the position');
        camera.position.set(work.point.x - 6, 3.2, work.point.z + 7);
        camera.lookAt(work.point.x, 1, work.point.z);
        renderer.render(scene, camera);
        return { heading: work.point.heading, point: { x: work.point.x, z: work.point.z },
          enemy: { x: enemy.position.x, z: enemy.position.z },
          canAim: aiEmplacementCanAimAt(work.point, { x: enemy.position.x, y: 1.1, z: enemy.position.z }) };
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const result = await page.evaluate(() => nanjingEngineerDirectionFixture());
  assert.ok(-Math.sin(result.heading) > .99, JSON.stringify(result));
  assert.equal(result.canAim, true, 'the completed emplacement must be able to face the attacker');
  if (process.env.ARTIFACT_PATH) await page.screenshot({ path: process.env.ARTIFACT_PATH });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result,
    limitation: 'Positions and stage are diagnostic setup; construction uses the actual AI planning and building path.' }));
} finally {
  await browser.close();
}
