import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.followupReview={
        boarding(){
          setGameState('pause');combatSounds.length=0;
          const slots=world.civilians.map(person=>({...person.userData.waitingSlot}));
          for(const person of world.civilians){person.visible=false;person.userData.dead=true;person.userData.health=0;}
          const people=world.civilians.slice(2,5),ferry=world.ferries[0];
          for(const [index,person] of people.entries()){
            const point={x:-69+index*3,z:ferry.position.z};
            person.position.set(point.x,.36,point.z);person.visible=true;
            Object.assign(person.userData,{dead:false,health:100,active:true,arrived:true,
              route:[point],waypoint:1,boarding:false,escapeMotion:null,streetEvacuating:false});
          }
          world.civilianQueue.splice(0,world.civilianQueue.length,people[2],people[0],people[1]);
          nanjingCampaign.stage='dock-defense';nanjingCampaign.dockActivated=true;
          nanjingCampaign.civilianCasualties=177;nanjingCampaign.boardingClock=1;
          registerCivilianArrival(nanjingCampaign,3);
          updateNanjingCivilians(.05);
          const selected=ferry.userData.boarding?.civilian.userData.civilianId;
          let maxSpeed=0;
          for(let step=0;step<180&&people[0].parent===scene;step++){
            const before=people[0].getWorldPosition(new THREE.Vector3());time+=.05;updateNanjingCivilians(.05);
            const moved=people[0].getWorldPosition(new THREE.Vector3()).distanceTo(before);
            maxSpeed=Math.max(maxSpeed,moved/.05);
          }
          return{slots,selected,expected:people[0].userData.civilianId,maxSpeed,
            boarded:people[0].parent===ferry,motionStopped:people[0].userData.escapeMotion===null};
        },
        denseBoarding(){
          setGameState('menu');beginMatch();setGameState('pause');enemies=[];rebuildForces();combatSounds.length=0;
          for(const person of world.civilians){
            const point=person.userData.waitingSlot;
            person.position.set(point.x,world.groundHeight(point.x,point.z),point.z);person.visible=true;
            Object.assign(person.userData,{dead:false,health:100,active:true,arrived:true,
              route:[point],waypoint:1,boarding:false,escapeMotion:null,streetEvacuating:false});
          }
          world.civilianQueue.splice(0,world.civilianQueue.length,...world.civilians);
          nanjingCampaign.stage='dock-defense';nanjingCampaign.dockActivated=true;
          registerCivilianArrival(nanjingCampaign,180);
          let previous=0,lastProgress=0,steps=0;
          for(;steps<36000&&nanjingCampaign.civiliansEvacuated<180;steps++){
            time+=.05;updateNanjingCivilians(.05);
            if(nanjingCampaign.civiliansEvacuated>previous){
              previous=nanjingCampaign.civiliansEvacuated;lastProgress=time;
            }
            if(time-lastProgress>200)break;
          }
          return{evacuated:nanjingCampaign.civiliansEvacuated,seconds:steps*.05,
            waiting:nanjingCampaign.civiliansWaiting,aboard:nanjingCampaign.civiliansAboard};
        },
        sink(){
          const plane=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='plane'&&vehicle.health>0);
          plane.position.set(-94,5,-80);plane.speed=0;
          damageVehicle(plane,1000,'crash','collision');
          let water=false;
          for(let step=0;step<150&&!plane.fall.sunk;step++){
            time+=.05;updateVehicles(.05);water ||= Boolean(plane.fall.sinking);
          }
          vehicleRenderer.update(entities.vehicles.values(),time);
          const colliders=vehicleSolids(),snapshot=window.__battle;
          return{water,sunk:plane.fall.sunk,grounded:plane.fall.grounded,y:plane.position.y,
            retained:entities.vehicles.has(plane.id),colliders:colliders.length,
            snapshotSunk:snapshot.campaign.airSupport.aircraft.find(item=>item.health===0)?.sunk};
        },
        signals(){
          setGameState('menu');beginMatch();setGameState('playing');
          battleSignals.reset();battleVoices.reset();battleVoices.sync(true);
          const listener=battleAudioListener(),friendly=friendlyAI.filter(actor=>actor.health>0&&!actor.vehicleId).slice(0,2),
            hostile=enemies.filter(actor=>actor.health>0&&!actor.vehicleId).slice(0,2);
          for(const [index,actor] of [...friendly,...hostile].entries()){
            actor.position.set(listener.position.x+2+index*2,0,listener.position.z);
            actor.locomotion.speed=2;actor.tactics.mode='advance';
          }
          time=4;presentRifleReports();battleSignals.sync(false);
          time=10;presentRifleReports();
          const result={context:audioContext.state,signals:battleSignals.snapshot.history,
            warnings:battleVoices.snapshot.history.filter(item=>item.cue==='enemy-whistle')};
          setGameState('pause');return result;
        },
        rise(progress){
          fatal=true;setGameState('pause');
          if(!this.risingActors){
            this.risingActors=[friendlyAI.find(actor=>actor.health>0),enemies.find(actor=>actor.health>0&&!actor.vehicleId)];
            this.risingActors.forEach((actor,index)=>{
              actor.position.set(-64+index*2,.36,-80);actor.heading=0;actor.rifleReady=true;actor.firingPose=null;
              actor.stance='standing';actor.locomotion.speed=0;
              actor.nativeMotion.position={x:actor.position.x,z:actor.position.z};
              actor.nativeMotion.postureTransition=null;
              for(const key of Object.keys(actor.nativeMotion.posture))actor.nativeMotion.posture[key]=Number(key==='crouched');
            });this.riseTime=0;
          }
          for(const actor of this.risingActors)advanceNraMotion(actor,progress-this.riseTime);
          this.riseTime=progress;
          for(const id of ['menu','hud','overlay','loading'])$(id).hidden=true;
          for(const child of camera.children)child.visible=false;
          camera.fov=55;camera.updateProjectionMatrix();camera.position.set(-58,2.4,-74);camera.lookAt(-63,1,-80);
          camera.updateMatrixWorld(true);
          nraCharacter.update([this.risingActors[0]],time,null,'low');
          ijaCharacter.update([this.risingActors[1]],time,null,'low');
          renderer.render(scene,camera);
          return this.risingActors.map(actor=>({team:actor.team,posture:{...actor.nativeMotion.posture},
            eye:soldierPostureHeight(actor)}));
        },
        results(){
          $('hud').hidden=false;
          $('scoreboard').hidden=false;updateHUD();renderSquadScores();
          const tabWidth=$('scoreboard').getBoundingClientRect().width;
          Object.assign(nanjingCampaign,{outcome:'evacuated',playerEscaped:true});
          showOverlay('commemoration');
          const endingAt=performance.now()+31000;
          battleEnding.update(endingAt);
          battleEnding.update(endingAt+6000);
          if(!battleEnding.finish())throw Error('Could not open Nanjing contribution results');
          return{tabWidth};
        }
      };` });
  });
  const response = await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/?campaign=nanjing');
  assert.ok(response.ok());
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const boarding = await page.evaluate(() => followupReview.boarding());
  assert.equal(boarding.slots.length, 180); assert.ok(boarding.slots.every(slot => slot.x < -59.8));
  assert.equal(boarding.selected, boarding.expected);
  assert.ok(boarding.maxSpeed > 2.4 && boarding.maxSpeed <= 3.21,
    JSON.stringify({ maxSpeed: boarding.maxSpeed, boarded: boarding.boarded, selected: boarding.selected }));
  assert.ok(boarding.boarded && boarding.motionStopped);
  const dense = await page.evaluate(() => followupReview.denseBoarding());
  assert.equal(dense.evacuated, 180, JSON.stringify(dense));
  const sink = await page.evaluate(() => followupReview.sink());
  assert.ok(sink.water && sink.sunk && sink.retained && sink.snapshotSunk);
  assert.equal(sink.grounded, false); assert.ok(sink.y < -5.28);
  const signals = await page.evaluate(() => followupReview.signals());
  assert.equal(signals.context, 'running');
  assert.deepEqual(signals.signals.map(item => item.team), ['friendly', 'enemy']);
  assert.equal(signals.warnings.length, 1); assert.match(signals.warnings[0].text, /日军/);
  const rise=[];
  if(process.env.ARTIFACT_DIR)await mkdir(process.env.ARTIFACT_DIR,{recursive:true});
  for(const progress of [0,.456,.589,.95]){
    const pose=await page.evaluate(progress=>followupReview.rise(progress),progress);
    if(progress===.456||progress===.589)assert.ok(pose.every(actor=>Math.abs(actor.posture.crouched-.42)<1e-6));
    if(progress===.95)assert.ok(pose.every(actor=>actor.posture.crouched<.001));
    rise.push({progress,pose});
    if(process.env.ARTIFACT_DIR)await page.screenshot({path:join(process.env.ARTIFACT_DIR,'rising-'+progress+'.png')});
  }
  const results = await page.evaluate(() => followupReview.results());
  await page.locator('#battle-results summary').click();
  const layout = await page.locator('#overlay > .dialog').evaluate(element => ({
    width: element.getBoundingClientRect().width,
    labels: [...element.querySelectorAll('#result-squad-scores tbody th')].map(cell => ({
      height: cell.getBoundingClientRect().height, wrap: getComputedStyle(cell).whiteSpace,
    })),
  }));
  assert.ok(Math.abs(layout.width - results.tabWidth) < 1);
  assert.ok(layout.labels.every(label => label.wrap === 'nowrap' && label.height < 30));
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'wide-results.png') });
    await writeFile(join(process.env.ARTIFACT_DIR, 'followup.json'), JSON.stringify({
      boarding, dense, sink, signals, rise, layout, errors,
      note: 'Controlled registered-actor fixture. Result panel is explicitly opened for layout, not a natural victory.',
    }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, boarding: { ...boarding, slots: boarding.slots.length }, dense, sink, signals, layout, errors }));
} catch (error) {
  console.error(JSON.stringify({ errors, loading: await page.locator('#loading-message').textContent() }));
  throw error;
} finally { await browser.close(); }
