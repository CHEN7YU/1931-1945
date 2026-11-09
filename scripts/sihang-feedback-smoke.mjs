import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations = {}, errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.__sihangFeedbackSetup = stage => {
 sihangCampaign.stage=stage;sihangCampaign.stageElapsed=0;sihangCampaign.stageRemaining=240;sihangCampaign.playerRetreatOpen=false;
 sihangCampaign.aiRetreatIds=friendlyForces.filter(a=>!a.playerUnit&&a.health>0).map(a=>a.id);
 const player=controlledSoldier(entities);player.position.set(18,0,-2);player.heading=-.9;player.lookPitch=-.65;
 stopLocomotion(player.locomotion);player.nativeMotion.position={x:18,z:-2};
 for(const [i,actor]of allies.entries()){
  if(actor===player)continue;
  actor.position.set(12+i%4*1.3,0,-5.5+Math.floor(i/4)*1.3);
  actor.traversal.kind='grounded';actor.stance='standing';actor.firingPose=null;
  actor.path=actor.pathGoal=null;actor.nextPath=0;actor.target=null;actor.tactics.lastSeen=null;
  actor.nativeMotion.position={x:actor.position.x,z:actor.position.z};
 }
 updateCamera(0);
 return window.__sihangFeedbackState();
};
window.__sihangFeedbackState=()=>({time,state,stage:sihangCampaign.stage,
 members:allies.filter(a=>a.health>0&&a!==controlledSoldier(entities)).map(a=>({
 id:a.id,x:a.position.x,y:a.position.y,z:a.position.z,order:a.order,point:a.orderPoint,
 goal:a.pathGoal,mode:a.tactics.mode,speed:a.locomotion.speed,
 inWater:world.isDeepWater(a.position.x,a.position.z)
 }))});
window.__sihangFollowRelocate=()=>{
 const player=controlledSoldier(entities);player.position.set(32,0,-4);
 player.nativeMotion.position={x:32,z:-4};updateCamera(0);
};
window.__sihangDoorSetup=()=>{
 const door=world.doorSystem.doors.find(d=>d.groupId==='warehouse-neighbor-6-front-door');
 const actor=controlledSoldier(entities);
 const x=door.x-door.hingeDirection*door.width/2;
 actor.position.set(x-1.2,0,door.z+.7);actor.lookPitch=0;
 actor.heading=Math.atan2(actor.position.x-x,0);
 updateCamera(0);
 return {group:door.groupId,focused:world.doorSystem.focus(camera)?.groupId};
};
window.__sihangDoorState=()=>world.doorSystem.doors.filter(d=>d.groupId==='warehouse-neighbor-6-front-door')
 .map(d=>({state:d.state,angle:d.angle,target:d.targetAngle,blocked:d.blocked,hold:d.manualCloseHold}));
window.__sihangQualityState=()=>({graphics:graphics.snapshot,preferences:preferences.snapshot,automatic:automaticQuality.snapshot});
` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5351/');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  observations.startupQuality = await page.evaluate(() => window.__sihangQualityState());
  assert.equal(observations.startupQuality.graphics.requested.preset, 'low', 'fresh browser starts with the conservative preset');
  const door = await page.evaluate(() => window.__sihangDoorSetup());
  assert.equal(door.focused, door.group);
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__sihangDoorState().every(d => d.state === 'closed'), null, { timeout: 10000 });
  observations.cityDoors = await page.evaluate(() => window.__sihangDoorState());
  await page.screenshot({ path: join(directory, 'city-paired-doors-closed.png') });
  observations.battle = await page.evaluate(() => ({
    state: window.__battle.state, time: window.__battle.time,
    allies: window.__battle.friendly?.length, enemies: window.__battle.enemies?.length,
    recovered: window.__battle.recoveredErrors,
  }));
  for (const stage of ['sihang-defense', 'sihang-retreat']) {
    await page.evaluate(stage => window.__sihangFeedbackSetup(stage), stage);
    await page.keyboard.press('x');
    const ordered = await page.evaluate(() => window.__sihangFeedbackState());
    assert.ok(ordered.members.every(a => a.order === 'hold'), 'a mark outside the warehouse capture rectangle is a movement order');
    assert.ok(ordered.members.every(a => a.point.y === 0), 'ground order keeps its actual level');
    await page.waitForFunction(start => window.__sihangFeedbackState().time > start + 5, ordered.time);
    const moved = await page.evaluate(() => window.__sihangFeedbackState());
    const progressed = moved.members.filter(a => {
      const before = ordered.members.find(b => b.id === a.id);
      return before && Math.hypot(a.x - before.x, a.z - before.z) > .5;
    });
    assert.ok(progressed.length >= 5, `actual squad movement in ${stage}: ${JSON.stringify(moved)}`);
    assert.ok(moved.members.every(a => !a.inWater));
    await page.keyboard.down('x'); await page.waitForTimeout(550); await page.keyboard.up('x');
    const following = await page.evaluate(() => window.__sihangFeedbackState());
    assert.ok(following.members.every(a => a.order === 'follow'));
    await page.evaluate(() => window.__sihangFollowRelocate());
    await page.waitForFunction(start => window.__sihangFeedbackState().time > start + 6, following.time);
    const followed = await page.evaluate(() => window.__sihangFeedbackState());
    assert.ok(followed.members.filter(a => {
      const before = following.members.find(b => b.id === a.id);
      return before && Math.hypot(a.x - 32, a.z + 4) < Math.hypot(before.x - 32, before.z + 4) - .5;
    }).length >= 3, `squad actually follows the relocated player in ${stage}: ${JSON.stringify(followed)}`);
    observations[stage] = { ordered, moved, following: followed, progressed: progressed.length };
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, stageOrders: 2, actualXAndF: true, errors }));
} catch (error) {
  observations.failure = { message: error.message, stack: error.stack };
  observations.page = await page.evaluate(() => ({
    loading: document.getElementById('loading-message')?.textContent,
    fatal: document.getElementById('fatal-message')?.textContent,
    body: document.body.innerText.slice(0, 2500),
    doors: window.__sihangDoorState?.(),
  }));
  console.error(JSON.stringify(observations.page));
  throw error;
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ ...observations, errors }, null, 2));
  await browser.close();
}
