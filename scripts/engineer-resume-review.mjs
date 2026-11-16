import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const campaign of process.env.CAMPAIGN ? [process.env.CAMPAIGN] : ['sihang', 'nanjing', 'taierzhuang-fort']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.resumeReview = {
          roles() { missionBriefing.hide(); return { current, roles: allies.map(actor => actor.role) }; },
          selected() { return controlledSoldier(entities).id; },
          posture() {
            const actor = controlledSoldier(entities), point = actor.position.clone();
            const threat = point.clone().add(new THREE.Vector3(0, 1, -8));
            const results = ['standing', 'crouched', 'prone'].map(stance => postureFireLine(actor, point, stance, threat));
            const native = actor.nativeMotion;
            actor.nativeMotion = { profile: {} };
            try {
              postureFireLine(actor, point, 'standing', threat);
              throw new Error('Invalid native motion was silently accepted');
            } catch (error) {
              if (error.message !== 'Native combat posture is missing its carry profile') throw error;
            } finally { actor.nativeMotion = native; }
            return results;
          },
          turn(yaw) { controlledSoldier(entities).heading = controlPose.yaw = yaw; },
          place(retreatArtillery = false) {
            const actor = controlledSoldier(entities);
            if (!actor.engineer) throw new Error('Expected controlled engineer');
            simulationClock.setActive(false, performance.now());
            if (retreatArtillery) {
              if (!sihangCampaignMode || actor.engineer.selected !== 'bofors75')
                throw new Error('Expected player-selected artillery in Sihang');
              sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
              updateSihangMission(.02);
              if (sihangCampaign.stage !== 'sihang-retreat') throw new Error('Expected withdrawal stage');
            }
            actor.health = 100000; actor.engineer.heading = actor.heading = controlPose.yaw = 0;
            const rejected = {};
            for (let z = retreatArtillery ? -4 : battleArea.minZ + 10;
              z < (retreatArtillery ? 1 : battleArea.maxZ - 10); z += retreatArtillery ? 1 : 4)
              for (let x = retreatArtillery ? -34 : battleArea.minX + 10;
                x < (retreatArtillery ? 27 : battleArea.maxX - 10); x += retreatArtillery ? 1 : 4) {
                const y = world.walkHeight(x, z, 0), origin = { x, y, z };
                const candidate = engineerPlacement(origin, 0);
                candidate.y = world.walkHeight(candidate.x, candidate.z, y);
                const reason = Math.abs(y) > .025 ? 'origin elevation' :
                  !retreatArtillery && enemies.some(enemy => enemy.health > 0 && Math.hypot(enemy.position.x - x, enemy.position.z - z) < 40) ? 'hostile proximity' :
                  (retreatArtillery ? [0] : [-4, 0, 4]).some(dz => circleBlocked(x, z + dz, .5, movementObstacles(x, z + dz), y) ||
                    Math.abs(world.walkHeight(x, z + dz, y) - y) > .1) ? 'movement clearance' :
                  engineerPlacementReason(actor, candidate);
                if (reason) { rejected[reason] = (rejected[reason] || 0) + 1; continue; }
                actor.position.set(x, y, z); stopLocomotion(actor.locomotion); actorGrid.rebuild(allForces);
                this.origin = [x, y, z]; return { origin: this.origin, candidate };
              }
            throw new Error('No safe engineer fixture: ' + JSON.stringify(rejected));
          },
          step(seconds) {
            for (let i = 0; i < Math.round(seconds / .05); i++) {
              for (const actor of enemies) actor.nextFire = time + 1000000;
              for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
              aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            }
            return this.snapshot();
          },
          freeze() { simulationClock.setActive(false, performance.now()); },
          blockUnfinished() {
            const actor = controlledSoldier(entities), site = actor.engineer.unfinished[0]?.site;
            const enemy = enemies.find(item => item.health > 0 && !item.vehicleId);
            if (!site || !enemy) throw new Error('Expected an unfinished site and a living enemy');
            this.blocker = { actor: enemy, position: enemy.position.clone(), nextThink: enemy.nextThink };
            enemy.position.set(site.x, site.y, site.z);
            enemy.nextThink = Infinity; stopLocomotion(enemy.locomotion);
          },
          unblockUnfinished() {
            const { actor, position, nextThink } = this.blocker;
            actor.position.copy(position); actor.nextThink = nextThink;
          },
          snapshot() {
            const actor = controlledSoldier(entities);
            return { state, toolEquipped, id: actor.id, selected: actor.engineer.selected, position: actor.position.toArray(), origin: this.origin,
              construction: structuredClone(actor.engineer.construction),
              unfinished: structuredClone(actor.engineer.unfinished),
              materials: { ...actor.engineer.materials },
              works: engineerWorks.filter(work => work.builderId === actor.id).map(work => work.point.id) };
          }
        };` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
    url.searchParams.set('campaign', campaign);
    url.searchParams.set('resources', 'low-memory');
    if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
    await page.goto(url.href);
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    const start = await page.evaluate(() => resumeReview.roles());
    const engineer = start.roles.indexOf('engineer');
    assert.ok(engineer >= 0);
    for (let i = start.current; i !== engineer; i = (i + 1) % start.roles.length) await page.keyboard.press('y');
    const retreatArtillery = process.env.SIHANG_ARTILLERY === '1';
    if (retreatArtillery) {
      assert.equal(campaign, 'sihang');
      await page.keyboard.press('2');
      await page.keyboard.press('r');
      assert.equal((await page.evaluate(() => resumeReview.snapshot())).selected, 'bofors75');
    }
    const site = await page.evaluate(retreat => resumeReview.place(retreat), retreatArtillery);
    if (process.env.GAME_CHARACTER === 'procedural')
      assert.ok((await page.evaluate(() => resumeReview.posture())).every(value => typeof value === 'boolean'));
    if (!retreatArtillery) await page.keyboard.press('2');
    if (retreatArtillery) {
      await page.mouse.down();
      const completed = await page.evaluate(() => resumeReview.step(22));
      await page.mouse.up();
      assert.equal(completed.works.length, 1, JSON.stringify({ site, completed }));
      assert.equal(completed.materials.bofors75, 0);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ campaign, site, selected: completed.selected, works: completed.works }));
      await page.close();
      continue;
    }
    await page.mouse.down();
    const first = await page.evaluate(() => resumeReview.step(7));
    assert.ok(first.construction.progress >= 7 - 1e-8, JSON.stringify({ campaign, site, first, errors }));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const paused = await page.evaluate(() => resumeReview.snapshot());
    assert.equal(paused.state, 'pause');
    assert.ok(paused.unfinished[0].progress >= 7 - 1e-8);
    await page.locator('#resume').click();
    await page.evaluate(() => resumeReview.freeze());
    const resumedGame = await page.evaluate(() => resumeReview.snapshot());
    assert.equal(resumedGame.state, 'playing');
    if (!resumedGame.toolEquipped) await page.keyboard.press('2');
    await page.mouse.down();
    await page.evaluate(() => resumeReview.step(1));
    await page.mouse.up();
    const released = await page.evaluate(() => resumeReview.step(.1));
    assert.ok(released.unfinished[0].progress >= 8 - 1e-8);
    await page.evaluate(() => resumeReview.blockUnfinished());
    await page.mouse.down();
    const blocked = await page.evaluate(() => resumeReview.step(.1));
    await page.mouse.up();
    assert.equal(blocked.construction.blockedReason, '敌军占据建造空间');
    assert.ok(blocked.unfinished[0].progress >= released.unfinished[0].progress,
      'a temporarily blocked resumed site must retain its previous progress');
    await page.evaluate(() => resumeReview.unblockUnfinished());
    await page.evaluate(() => resumeReview.step(.1));
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('y');
    assert.notEqual(await page.evaluate(() => resumeReview.selected()), released.id);
    for (let i = 0; i < start.roles.length; i++) {
      if (await page.evaluate(id => resumeReview.selected() === id, released.id)) break;
      await page.keyboard.press('y');
    }
    assert.equal(await page.evaluate(() => resumeReview.selected()), released.id);
    if (!(await page.evaluate(() => resumeReview.snapshot())).toolEquipped) await page.keyboard.press('2');
    await page.evaluate(() => resumeReview.turn(0));
    await page.keyboard.down('s');
    const away = await page.evaluate(() => resumeReview.step(1.5));
    await page.keyboard.up('s');
    assert.ok(Math.hypot(away.position[0] - site.origin[0], away.position[2] - site.origin[2]) > .7);
    await page.keyboard.down('w');
    let returned;
    for (let i = 0; i < 50; i++) {
      returned = await page.evaluate(() => resumeReview.step(.05));
      if (Math.hypot(returned.position[0] - site.origin[0], returned.position[2] - site.origin[2]) < .55) break;
    }
    await page.keyboard.up('w');
    assert.ok(Math.hypot(returned.position[0] - site.origin[0], returned.position[2] - site.origin[2]) < .7,
      'actual movement must return to the original construction anchor');
    await page.evaluate(() => resumeReview.step(.4));
    await page.evaluate(() => resumeReview.turn(Math.PI));
    await page.mouse.down();
    const resumed = await page.evaluate(() => resumeReview.step(.2));
    assert.ok(resumed.construction.progress >= first.construction.progress, JSON.stringify({ site, first, away, returned, resumed }));
    const completed = await page.evaluate(() => resumeReview.step(14));
    await page.mouse.up();
    assert.equal(completed.works.length, 1, JSON.stringify(completed));
    assert.equal(completed.materials.maxim24, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ campaign, site, first: first.construction.progress,
      saved: released.unfinished[0].progress, resumed: resumed.construction.progress, works: completed.works }));
    await page.close();
  }
} finally {
  await browser.close();
}
