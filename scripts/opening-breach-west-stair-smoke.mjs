import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const campaign of process.env.CAMPAIGN ? [process.env.CAMPAIGN] : ['sihang', 'nanjing']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.openingReview = () => {
          setGameState('pause'); missionBriefing.hide();
          if (sihangCampaignMode) {
            const result = { breached: sihangCampaign.northWallBreached, worldBreached: world.northWallBreached,
              squads: formations.filter(f => f.team === 'enemy' && f.type === 'infantry')
                .map(f => ({ count: f.members.length, demolition: !!f.sihangDemolition,
                  armed: f.members.every(a => a.hasFirearm) })),
              text: $('objective-help').textContent, shields: sihangCombat.snapshot.shields };
            camera.position.set(13, 5, -55); camera.lookAt(0, 3, -42);
            renderer.render(scene, camera);
            return result;
          }
          const actor = controlledSoldier(entities);
          actor.position.set(-67.1, 0, -73.85);
          const walk = (dx, dz) => {
            moveInfantry(actor.position, dx, dz, .4, movementObstacles(actor.position.x, actor.position.z));
            settleActorSupport(actor);
          };
          walk(0, -5); walk(-1.8, 0); walk(0, 5.1); walk(-1.35, 0); walk(0, 13.75);
          const top = actor.position.toArray();
          walk(0, -13.75); walk(1.35, 0); walk(0, -5.1); walk(1.8, 0); walk(0, 5);
          const bottom = actor.position.toArray();
          camera.position.set(-58, 11, -68); camera.lookAt(-68, 4, -77);
          renderer.render(scene, camera);
          return { top, bottom };
        };
        window.stairInputReview = {
          start() {
            const actor = controlledSoldier(entities);
            actor.position.set(-67.1, 0, -73.85);
            actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
            stopLocomotion(actor.locomotion);
            actor.heading = controlPose.yaw = 0; controlPose.pitch = 0; controlPose.stance = 'standing';
            for (const enemy of enemies) { enemy.nextThink = Infinity; enemy.target = null; }
            setGameState('playing'); bindControlInput(); updateCamera(0);
          },
          turn(yaw) { controlledSoldier(entities).heading = controlPose.yaw = yaw; updateCamera(0); },
          position() { return controlledSoldier(entities).position.toArray(); },
        };
        window.gateExitReview = {
          start() {
            const actor = controlledSoldier(entities);
            advanceNanjingCampaign(nanjingCampaign, nanjingCampaign.stageRemaining);
            actor.position.set(-68, 0, -60);
            actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
            actor.health = 100000;
            stopLocomotion(actor.locomotion);
            actor.heading = controlPose.yaw = Math.PI / 2; controlPose.pitch = 0;
            for (const enemy of enemies) { enemy.nextThink = Infinity; enemy.target = null; }
            updateNanjingMission(0); updateCamera(0);
            return { stage: nanjingCampaign.stage, position: actor.position.toArray() };
          },
          snapshot() {
            return { stage: nanjingCampaign.stage, position: controlledSoldier(entities).position.toArray(),
              remaining: nanjingCampaign.stageRemaining };
          },
          approach() {
            nanjingCampaign = createNanjingCampaign();
            advanceNanjingCampaign(nanjingCampaign, nanjingCampaign.stageRemaining);
            const actor = controlledSoldier(entities);
            actor.position.set(NANJING_DOCK.x + 37.3, 0, NANJING_DOCK.z);
            actor.position.y = world.walkHeight(actor.position.x, actor.position.z, 0);
            actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
            actor.heading = controlPose.yaw = Math.PI / 2;
            stopLocomotion(actor.locomotion);
            updateNanjingMission(0);
          },
        };
      ` });
    });
    await page.goto(new URL(`/?campaign=${campaign}&resources=low-memory`,
      process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
    await setQualityPreset(page, 'low');
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    const result = await page.evaluate(() => window.openingReview());
    if (campaign === 'sihang') {
      assert.equal(result.breached, true);
      assert.equal(result.worldBreached, true);
      assert.equal(result.squads.length, 7);
      assert.ok(result.squads.every(squad => !squad.demolition && squad.armed));
      assert.equal(result.squads.at(-1).count, 20);
      assert.equal(result.shields, 0);
      assert.doesNotMatch(result.text, /爆破|拆除炸药/);
    } else {
      assert.ok(Math.abs(result.top[1] - 8.58) < .05 && Math.abs(result.top[2] + 60) < .1);
      assert.ok(result.bottom[1] < .1 && Math.abs(result.bottom[2] + 73.85) < .1);
    }
    assert.deepEqual(errors, []);
    if (process.env.ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ARTIFACT_DIR}\\${campaign}-opening-review.png` });
    if (campaign === 'nanjing') {
      await page.evaluate(() => window.stairInputReview.start());
      await page.keyboard.down('KeyW');
      try {
        await page.waitForFunction(() => window.stairInputReview.position()[2] < -78.5,
          null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyW'); }
      const inputTurn = await page.evaluate(() => window.stairInputReview.position());
      assert.ok(Math.abs(inputTurn[1] - 4.29) < .15);
      await page.evaluate(() => window.stairInputReview.turn(Math.PI / 2));
      await page.keyboard.down('KeyW');
      try {
        await page.waitForFunction(() => window.stairInputReview.position()[0] < -68.65,
          null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyW'); }
      await page.evaluate(() => window.stairInputReview.turn(Math.PI));
      await page.keyboard.down('KeyW');
      try {
        await page.waitForFunction(() => window.stairInputReview.position()[1] > 8.5,
          null, { timeout: 90000 });
      } catch (error) {
        console.error('Upper stair input stopped at', await page.evaluate(() => window.stairInputReview.position()));
        throw error;
      } finally { await page.keyboard.up('KeyW'); }
      const inputTop = await page.evaluate(() => window.stairInputReview.position());
      await page.keyboard.down('KeyS');
      try {
        await page.waitForFunction(() => {
          const position = window.stairInputReview.position();
          return position[1] <= 4.35 && position[2] < -78.4;
        }, null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyS'); }
      await page.evaluate(() => window.stairInputReview.turn(Math.PI / 2));
      await page.keyboard.down('KeyS');
      try {
        await page.waitForFunction(() => {
          const position = window.stairInputReview.position();
          return position[0] > -67.3;
        }, null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyS'); }
      await page.evaluate(() => window.stairInputReview.turn(0));
      await page.keyboard.down('KeyS');
      try {
        await page.waitForFunction(() => {
          const position = window.stairInputReview.position();
          return position[1] < .1 && position[2] > -74.05;
        }, null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyS'); }
      const inputBottom = await page.evaluate(() => window.stairInputReview.position());
      assert.ok(inputTop[0] > -69.8 && inputTop[0] < -68 &&
        inputTop[2] > -74.2 && inputTop[2] < -73.3 && inputTop[1] > 8.5,
        `unexpected input positions: ${JSON.stringify({ inputTurn, inputTop, inputBottom })}`);
      assert.ok(inputBottom[1] < .1);
      const beforeGate = await page.evaluate(() => window.gateExitReview.start());
      assert.equal(beforeGate.stage, 'withdrawal');
      await page.keyboard.down('KeyW');
      try {
        await page.waitForFunction(() => window.gateExitReview.snapshot().position[0] <= -75,
          null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyW'); }
      const atGate = await page.evaluate(() => window.gateExitReview.snapshot());
      assert.equal(atGate.stage, 'dock-defense', JSON.stringify(atGate));
      await page.evaluate(() => window.gateExitReview.approach());
      assert.equal((await page.evaluate(() => window.gateExitReview.snapshot())).stage, 'withdrawal');
      await page.keyboard.down('KeyW');
      try {
        await page.waitForFunction(() => window.gateExitReview.snapshot().stage === 'dock-defense',
          null, { timeout: 90000 });
      } finally { await page.keyboard.up('KeyW'); }
      const atDock = await page.evaluate(() => window.gateExitReview.snapshot());
      assert.ok(atDock.remaining > 179, JSON.stringify(atDock));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ campaign, inputTop, inputBottom, beforeGate, atGate, atDock }));
    }
    console.log(JSON.stringify({ campaign, result }));
    await page.close();
  }
} finally {
  await browser.close();
}
