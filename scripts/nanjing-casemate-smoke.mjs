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
      window.casemateReview = {
        enter() {
          setGameState('pause'); missionBriefing.hide();
          const actor = controlledSoldier(entities), point = emplacements.get('gate-wall-mg');
          actor.position.set(-6.2,0,0);
          const goal = emplacementPose(point,point.altitude).operator;
          const path = world.elevatedPath(actor.position,goal);
          if(!path.length)throw new Error('No actual stair route to the room');
          for(const target of path) {
            moveInfantry(actor.position,target.x-actor.position.x,target.z-actor.position.z,.42,
              movementObstacles(actor.position.x,actor.position.z));
            if(Math.hypot(actor.position.x-target.x,actor.position.z-target.z)>.04)
              throw new Error('Controlled infantry cannot traverse the new room route: '+JSON.stringify({
                position:actor.position,target,blockers:movementObstacles(target.x,target.z)
                  .filter(o=>!o.walkable||o.height>actor.position.y+.5)
                  .filter(o=>circleBlocked(target.x,target.z,.42,[o],actor.position.y))}));
          }
          actor.nativeMotion.position={x:actor.position.x,z:actor.position.z};
          controlPose.yaw=point.heading;controlPose.pitch=-.6;
          setGameState('playing');bindControlInput();updateCamera(0);updateHUD();
          return {position:actor.position.toArray(),steps:path.length,room:world.casemateContains(actor.position)};
        },
        aim() {
          const point=emplacements.get('gate-wall-mg');
          controlPose.yaw=point.heading;controlPose.pitch=-.15;updateCamera(0);
        },
        status() {
          const actor=controlledSoldier(entities),point=emplacements.get('gate-wall-mg');
          return {mounted:actor.emplacementId,operator:point.operatorId,shots:point.shots,
            position:actor.position.toArray(),room:world.casemateContains(actor.position)};
        },
        leave() {
          setGameState('pause');
          const actor=controlledSoldier(entities),path=world.elevatedPath(actor.position,{x:-6.2,y:0,z:0});
          if(!path.length)throw new Error('No actual return route');
          for(const p of path)moveInfantry(actor.position,p.x-actor.position.x,p.z-actor.position.z,.42,
            movementObstacles(actor.position.x,actor.position.z));
          return actor.position.toArray();
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353/').href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000, polling: 500 });
  const entered = await page.evaluate(() => casemateReview.enter());
  assert.equal(entered.room, true);
  assert.ok(entered.steps > 25);
  await page.locator('#world').click();
  await page.keyboard.press('f');
  await page.waitForFunction(() => casemateReview.status().mounted === 'gate-wall-mg', null, { timeout: 10000 });
  await page.evaluate(() => casemateReview.aim());
  await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  const operated = await page.evaluate(() => casemateReview.status());
  assert.ok(operated.shots > 0);
  await page.screenshot({ path: join(directory, 'wall-room-machine-gun.png') });
  await page.keyboard.press('f');
  await page.waitForFunction(() => !casemateReview.status().mounted);
  const left = await page.evaluate(() => casemateReview.leave());
  assert.ok(Math.hypot(left[0] + 6.2, left[1], left[2]) < .04);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'casemate-review.json'), JSON.stringify({ entered, operated, left, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, steps: entered.steps, shots: operated.shots, errors }));
} finally { await browser.close(); }
