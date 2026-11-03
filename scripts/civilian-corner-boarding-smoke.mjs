import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.civilianIncidentReview = {
        riverView(){
          setGameState('pause');$('hud').hidden=true;$('overlay').hidden=true;
          for(const child of camera.children)child.visible=false;
          const ferry=world.ferries[0];ferry.position.x=-128;updateFerryVisibility(ferry);
          camera.position.set(-65,2.1,-80);camera.lookAt(-150,1,-80);
          renderer.render(scene,camera);
          return{opacity:ferry.userData.opacity,visible:ferry.visible};
        },
        boarding() {
          setGameState('menu');beginMatch();enemies=[];rebuildForces();
          const person=world.civilians.find(person=>person.userData.civilianId===87);
          const start={x:-72.63022417191681,y:.36,z:-86.82845379539327};
          const target={x:-72.2,z:-86};
          const original=world.civilianNavigate(start,target);
          const reason=world.civilianNavigate.stats.reason;
          const path=rejoinCivilianRoute(start,target,world.civilianNavigate,world.civilianNavigationObstacles,civilianNavigationLookup);
          if(!path?.length)throw Error('Reported 87th refugee has no physical boarding reconnection');
          person.visible=true;person.position.set(start.x,start.y,start.z);
          Object.assign(person.userData,{active:true,arrived:true,boarding:false,dead:false,route:[{...start}],waypoint:1});
          for(const other of world.civilians)if(other!==person){other.visible=false;other.userData.arrived=true;other.removeFromParent();}
          nanjingCampaign.dockActivated=true;nanjingCampaign.stage='dock-defense';
          nanjingCampaign.civiliansWaiting=1;nanjingCampaign.civiliansArrived=180;
          world.civilianQueue.splice(0,world.civilianQueue.length,person);
          for(let frame=0;frame<3000&&!person.userData.evacuated;frame++){
            time+=.05;updateNanjingCivilians(.05);controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          return{originalLength:original.length,reason,path,evacuated:person.userData.evacuated,
            waiting:nanjingCampaign.civiliansWaiting,aboard:nanjingCampaign.civiliansAboard};
        },
        enemyFire() {
          setGameState('menu');beginMatch();battleRandom=seededRandom(19371212);
          const player=controlledSoldier(entities),attacker=enemies.find(actor=>!actor.vehicleId&&(actor.rifle.model??'rifle')==='rifle');
          if(!attacker)throw Error('Missing ordinary Japanese rifleman for autonomous firing regression');
          player.position.set(-80,0,80);
          for(const formation of formations)formation.respawnEnabled=false;
          for(const actor of allForces)if(actor!==player&&actor!==attacker)actor.health=0;
          enemies=[attacker];rebuildForces();
          for(const vehicle of entities.vehicles.values())vehicle.position.set(-300,0,300);
          vehicleRenderer.update(entities.vehicles.values(),time);
          attacker.position.set(-24,0,55);attacker.heading=0;attacker.target=null;
          attacker.tactics.cover=null;attacker.tactics.lastSeen=null;attacker.tactics.suppressedUntil=0;
          const person=world.civilians.find(person=>person.userData.ageGroup==='adult'&&person.userData.civilianId<60);
          for(const civilian of world.civilians)civilian.visible=false;
          person.visible=true;person.position.set(-24,0,44);
          Object.assign(person.userData,{active:true,dead:false,health:100,arrived:false,evacuated:false,escapeMotion:null});
          const shots=attacker.rifle.shots;
          for(let frame=0;frame<2400&&!person.userData.dead;frame++){
            time+=.05;aiDecisions.beginFrame();updateWeaponSimulation(.05);updateAI(.05);
            advanceNraMotion(attacker,.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          return{selected:attacker.tactics.civilianTarget===person,mode:attacker.tactics.mode,
            shots:attacker.rifle.shots-shots,civilianShots:nanjingCampaign.civilianShots??0,
            dead:person.userData.dead,health:person.userData.health,casualties:nanjingCampaign.civilianCasualties,
            aim:attacker.aiRifle.blocked,rifleReady:attacker.rifleReady};
        }
      };` });
  });
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/?campaign=nanjing');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  if(process.env.ARTIFACT_DIR){
    await mkdir(process.env.ARTIFACT_DIR,{recursive:true});
    const river=await page.evaluate(()=>civilianIncidentReview.riverView());
    assert.equal(river.opacity,.5);
    await page.screenshot({path:join(process.env.ARTIFACT_DIR,'wide-yangtze.png')});
  }
  const boarding = await page.evaluate(() => civilianIncidentReview.boarding());
  console.log(JSON.stringify({ boarding }));
  assert.equal(boarding.originalLength, 0); assert.equal(boarding.reason, 'blocked-start');
  assert.equal(boarding.evacuated, true); assert.equal(boarding.waiting + boarding.aboard, 0);
  const fire = await page.evaluate(() => civilianIncidentReview.enemyFire());
  console.log(JSON.stringify({ fire, errors }));
  assert.ok(fire.selected && fire.shots > 0 && fire.dead && fire.casualties === 1,
    'autonomous enemy selection and actual bullet hits must cause the casualty, not a direct damage call');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
