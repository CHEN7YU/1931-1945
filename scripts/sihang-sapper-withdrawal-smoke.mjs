import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.sapperWithdrawalProbe = (returnedBeforeTransition) => {
        const squad = formations.find(f => f.sihangDemolition);
        const originals = [...squad.members], player = controlledSoldier(entities);
        for (const formation of formations) if (formation !== squad) formation.respawnEnabled = false;
        for (const actor of allForces) if (actor !== player && actor.formation !== squad) actor.health = 0;
        player.position.set(24, 7.2, -26);
        player.health = 100000;
        const tick = () => { aiDecisions.beginFrame(); advanceBattleStep(.05, time); };
        const startedAt = time, homeZ = originals[0].position.z;
        let speed = 0;
        const heights = [];
        for (let frame = 0; frame < 440 && sihangCampaign.demolition.state !== 'installing'; frame++) {
          tick();
          const front = originals[0];
          speed = Math.max(speed, front.locomotion.speed);
          if (front.locomotion.speed < 2) continue;
          const shield = world.solids.find(mesh => mesh.visible && mesh.userData.sihangShieldPlate &&
            Math.abs(mesh.position.x - front.position.x) < .15 &&
            Math.abs(mesh.position.z - front.position.z) < 1);
          if (shield) heights.push(shield.position.y - front.position.y);
          if (heights.length === 2) {
            camera.position.set(-7, 3, front.position.z - 4);
            camera.lookAt(front.position.x, 1, front.position.z);
            renderer.render(scene, camera);
          }
        }
        const arrival = { state: sihangCampaign.demolition.state, elapsed: time - startedAt, z: originals[0].position.z };
        if (returnedBeforeTransition) {
          for (let frame = 0; frame < 1000 && !squad.demolitionCompleted; frame++) tick();
        }
        const atTransition = originals[0].position.z;
        const parked = originals.filter(actor => actor.tactics.sihangDemolitionReturned).length;
        sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
        for (let frame = 0; frame < 600 && originals.some(actor => entities.soldiers.has(actor.id)); frame++) tick();
        setGameState('pause');
        return { arrival, speed, homeZ, atTransition, parked,
          zAfter: originals[0].position.z, shift: Math.max(...heights) - Math.min(...heights),
          retired: originals.filter(actor => !entities.soldiers.has(actor.id)).length,
          health: originals.every(actor => actor.health > 0),
          stage: sihangCampaign.stage, shields: sihangCombat.snapshot.shields,
          breached: sihangCampaign.northWallBreached };
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  for (const returned of [false, true]) {
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await setQualityPreset(page, 'low');
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    const result = await page.evaluate(returned => sapperWithdrawalProbe(returned), returned);
    console.log(JSON.stringify({ returned, ...result }));
    assert.equal(result.arrival.state, 'installing');
    assert.ok(result.arrival.elapsed < 22 && result.arrival.z > -46);
    assert.ok(result.speed >= 2.6);
    assert.ok(result.shift > .015 && result.shift < .16);
    assert.equal(result.parked, returned ? 20 : 0);
    assert.equal(result.breached, returned);
    assert.equal(result.stage, 'sihang-retreat');
    assert.equal(result.retired, 20);
    assert.equal(result.shields, 0);
    assert.equal(result.health, true);
    assert.ok(Math.abs(result.zAfter - result.homeZ) < .75);
    if (!returned) assert.ok(result.zAfter < result.atTransition - 15);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
