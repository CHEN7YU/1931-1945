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
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://1931-1945.qchen.workers.dev/**', route =>
    route.request().method() === 'POST' ? route.fulfill({ status: 204 }) : route.continue());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.finalCivilianReview = (blockedStart=false,choice=false) => {
        setGameState('pause');missionBriefing.hide();
        for(const plane of world.aircraft)plane.userData.attack.cooldown=10000;
        for(const formation of formations.filter(f=>f.team==='enemy')){
          formation.evacuated=true;for(const actor of formation.members)actor.health=0;
        }
        const last=world.civilians[87];
        for(const person of world.civilians) {
          person.userData.dead=person!==last;person.userData.health=person===last?100:0;
          person.visible=person===last;
        }
        Object.assign(nanjingCampaign,{stage:'withdrawal-to-boats',presentedStage:'withdrawal-to-boats',
          dockActivated:true,stageRemaining:0,civiliansWaiting:0,civiliansAboard:0,
          civiliansEvacuated:0,civiliansArrived:0,civilianCasualties:179});
        world.civilianQueue.length=0;
        const data=last.userData,near=data.homeRoute.at(-2),
          home=[...world.landmarks.residentialBuildings].sort((a,b)=>
            Math.hypot(a.x-data.waitingSlot.x,a.z-data.waitingSlot.z)-
            Math.hypot(b.x-data.waitingSlot.x,b.z-data.waitingSlot.z))[0];
        last.position.set(near.x,world.groundHeight(near.x,near.z),near.z);
        if(blockedStart)last.position.set(home.x,0,home.z-home.depth/2+.15);
        Object.assign(data,{active:true,fleeReleased:true,arrived:false,evacuated:false,boarding:false,
          resting:false,restPoseWeight:0,waypoint:0,route:[{x:home.x,z:home.z},data.waitingSlot],
          crowdPath:null,crowdTarget:null,crowdSearch:null,streetEvacuating:false});
        data.finalRecovery={lastProgress:time-20,retryAt:time,attempts:0,active:false,
          route:data.route,waypoint:0,targetDistance:Math.hypot(last.position.x-home.x,last.position.z-home.z),
          goalDistance:Math.hypot(last.position.x-data.waitingSlot.x,last.position.z-data.waitingSlot.z)};
        const before=nanjingCivilianEvacuationStatus(nanjingCampaign,world.civilians);
        window.civilianChoiceStatus=()=>({unrescued:nanjingCampaign.civiliansUnrescued,
          deaths:nanjingCampaign.civilianCasualties,evacuated:nanjingCampaign.civiliansEvacuated,
          alive:data.health===100&&!data.dead,excluded:data.unrescued,
          ready:nanjingCivilianEvacuationStatus(nanjingCampaign,world.civilians).ready,
          playerEscaped:nanjingCampaign.playerEscaped});
        window.civilianDamageReview=(team,damage)=>{
          applyCivilianDamage(last,damage,{team,weaponClass:'rifle',soldierId:'fixture-enemy'});
          const previousStage=nanjingCampaign.stage;
          nanjingCampaign.stage='dock-defense';updateHUD();
          const hud=document.getElementById('objective-help').textContent;
          nanjingCampaign.stage=previousStage;updateHUD();
          return{...civilianChoiceStatus(),hud};
        };
        if(choice){data.finalRecovery.attempts=3;showOverlay('pause');return{before};}
        let sawArrival=false,sawBoarding=false,steps=0;
        setGameState('playing');
        for(;steps<2400&&!nanjingCivilianEvacuationStatus(nanjingCampaign,world.civilians).ready;steps++) {
          aiDecisions.beginFrame();advanceBattleStep(.05,time+.05);
          sawArrival ||= data.arrived;sawBoarding ||= data.boarding||last.parent!==scene;
        }
        setGameState('pause');
        return {before,after:nanjingCivilianEvacuationStatus(nanjingCampaign,world.civilians),
          recovered:data.finalRecovery.active,alive:data.health===100&&!data.dead,sawArrival,sawBoarding,
          playerEscaped:nanjingCampaign.playerEscaped,relocations:data.finalRecovery.relocations??0,steps};
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353/').href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000, polling: 500 });
  const choice = process.env.CHOICE_TEST === 'true';
  const result = await page.evaluate(([blocked,choice]) => finalCivilianReview(blocked,choice),
    [process.env.BLOCKED_START === 'true',choice]);
  if(choice) {
    await page.locator('#end-civilian-wait').click();
    assert.equal((await page.evaluate(()=>civilianChoiceStatus())).unrescued,0,'first click only asks for confirmation');
    await page.locator('#end-civilian-wait').click();
    const recorded=await page.evaluate(()=>civilianChoiceStatus());
    assert.deepEqual(recorded,{unrescued:1,deaths:179,evacuated:0,alive:true,excluded:true,ready:true,playerEscaped:false});
    assert.ok((await page.locator('#battle-summary').textContent()).includes('未救出 1'));
    const friendly=await page.evaluate(()=>civilianDamageReview('friendly',100));
    assert.equal(friendly.deaths,179); assert.equal(friendly.unrescued,1);
    assert.ok(friendly.hud.includes('被日军击毙 179'));
    const killed=await page.evaluate(()=>civilianDamageReview('enemy',100));
    assert.equal(killed.deaths,180); assert.equal(killed.unrescued,0); assert.equal(killed.evacuated,0);
    assert.ok(killed.hud.includes('被日军击毙 180'));
    assert.equal((await page.evaluate(()=>civilianDamageReview('enemy',100))).deaths,180);
    assert.deepEqual(errors,[]);
    await writeFile(join(directory,'unrescued-choice.json'),JSON.stringify({result,recorded,friendly,killed,errors},null,2));
    console.log(JSON.stringify({passed:true,recorded,killed,errors}));
  } else {
  await writeFile(join(directory, 'last-civilian.json'), JSON.stringify({ result, errors }, null, 2));
  assert.equal(result.before.enRoute, 1); assert.equal(result.before.ready, false);
  assert.equal(result.recovered, true); assert.equal(result.alive, true);
  assert.equal(result.sawArrival, true); assert.equal(result.sawBoarding, true);
  assert.equal(result.after.evacuated, 1); assert.equal(result.after.ready, true);
  assert.equal(result.playerEscaped, false);
  if (process.env.BLOCKED_START === 'true') assert.ok(result.relocations > 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result, errors }));
  }
} finally { await browser.close(); }
