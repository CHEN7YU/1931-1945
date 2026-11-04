import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], requests = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
page.on('request', request => { if (/assets\/audio\/(tactical-feedback|vehicle-engines)\//.test(request.url())) requests.push(request.url()); });
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.worldAudioReview={
        ready(){return Boolean(tacticalAudio&&vehicleAudio&&audioContext?.state==='running')},
        engine(){
          const actor=controlledSoldier(entities),vehicle=occupiedVehicle(entities,actor);
          const before=vehicle?JSON.stringify({id:vehicle.id,health:vehicle.health,ammo:vehicle.weapon.ammo,crew:vehicle.crewIds}):null;
          vehicleAudio.update(audioContext,entities.vehicles.values(),battleAudioListener(),time,true);
          const first=vehicleAudio.snapshot;
          if(vehicle&&allies.length>1){
            changeMember(nextAlive(allies,current));
            vehicleAudio.update(audioContext,entities.vehicles.values(),battleAudioListener(),time,true);
          }
          const after=vehicleAudio.snapshot;
          const unchanged=!vehicle||before===JSON.stringify({id:vehicle.id,health:vehicle.health,ammo:vehicle.weapon.ammo,crew:vehicle.crewIds});
          return{first,after,unchanged,vehicleId:vehicle?.id??null};
        },
        common(){
          setGameState('pause');tacticalAudio.reset();tacticalAudio.sync(true);tacticalAudio.beginFrame();combatEvents.clear();
          camera.position.set(0,200,0);camera.updateMatrixWorld(true);
          const listener=battleAudioListener(),enemy=enemies.find(actor=>actor.health>0&&!actor.vehicleId);
          const source=captureAttackSource(entities,enemy,enemy.rifle),actor=controlledSoldier(entities);
          const before=JSON.stringify({health:actor.health,ammo:actor.rifle.ammo});
          combatEvents.publish('shot',{source,weaponType:'infantry',
            start:{x:-10,y:200.7,z:0},end:{x:10,y:200.7,z:0},muzzle:false},time);
          for(const [index,kind] of ['stone','wood','soil'].entries())
            combatEvents.publish('impact',{source,kind,position:{x:index-1,y:199,z:1},normal:{x:0,y:1,z:0}},time);
          presentCombatEvents();tacticalAudio.flush(audioContext,listener,time,entities.vehicles.values());
          const result={feedback:tacticalAudio.snapshot,unchanged:before===JSON.stringify({health:actor.health,ammo:actor.rifle.ammo})};
          tacticalAudio.sync(false);return result;
        },
        ownPlane(){
          setGameState('menu');selectedType='plane';beginMatch();
          vehicleAudio.update(audioContext,entities.vehicles.values(),battleAudioListener(),time,true);
          const result=vehicleAudio.snapshot;setGameState('pause');return result;
        },
        async river(){
          setGameState('menu');beginMatch();setGameState('pause');
          tacticalAudio.reset();tacticalAudio.sync(true);combatEvents.clear();combatSounds.length=0;enemies=[];rebuildForces();
          camera.position.set(-72.3,1.9,-86);camera.lookAt(-90,1,-86);camera.updateMatrixWorld(true);
          for(const person of world.civilians){person.visible=false;person.userData.dead=true;person.userData.health=0;}
          const person=world.civilians[2],ferry=world.ferries[0],point={x:-70,z:ferry.position.z};
          person.position.set(point.x,.36,point.z);person.visible=true;
          Object.assign(person.userData,{dead:false,health:100,active:true,arrived:true,boarding:false,route:[point],waypoint:1,escapeMotion:null});
          world.civilianQueue.splice(0,world.civilianQueue.length,person);
          nanjingCampaign.stage='dock-defense';nanjingCampaign.dockActivated=true;nanjingCampaign.civilianCasualties=179;
          registerCivilianArrival(nanjingCampaign,1);
          let inboundAt=null,emptyReturn=false,returnOar=false;
          for(let step=0;step<1400&&!returnOar;step++){
            time+=.05;tacticalAudio.beginFrame();updateNanjingCivilians(.05);
            tacticalAudio.flush(audioContext,battleAudioListener(),time,entities.vehicles.values());
            if(ferry.userData.state==='inbound'){
              inboundAt??=time;emptyReturn=ferry.userData.passengers.length===0;
              returnOar=tacticalAudio.snapshot.history.some(event=>event.kind==='oar'&&event.time>=inboundAt);
            }
            await new Promise(resolve=>setTimeout(resolve,12));
          }
          const boatSounds=tacticalAudio.snapshot;
          const plane=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='plane'&&vehicle.health>0);
          plane.position.set(-90,4,-86);plane.speed=0;
          vehicleAudio.update(audioContext,entities.vehicles.values(),battleAudioListener(),time,true);
          const engineBefore=vehicleAudio.snapshot.voices.some(voice=>voice.vehicleId===plane.id);
          damageVehicle(plane,1000,'crash','collision');
          vehicleAudio.update(audioContext,entities.vehicles.values(),battleAudioListener(),time,true);
          const stoppedEngine=!vehicleAudio.snapshot.voices.some(voice=>voice.vehicleId===plane.id);
          for(let step=0;step<160&&!plane.fall.sunk;step++){
            time+=.05;tacticalAudio.beginFrame();updateVehicles(.05);presentCombatEvents();
            tacticalAudio.flush(audioContext,battleAudioListener(),time,entities.vehicles.values());
            await new Promise(resolve=>setTimeout(resolve,12));
          }
          const result={boatSounds,emptyReturn,returnOar,engineBefore,stoppedEngine,sunk:plane.fall.sunk,feedback:tacticalAudio.snapshot};
          tacticalAudio.sync(false);vehicleAudio.sync(false);return result;
        },
        mute(){
          const original=audioMixer.snapshot.settings,muted=structuredClone(original);muted.master.muted=true;
          audioMixer.configure(muted);const result=audioMixer.snapshot.channels;audioMixer.configure(original);return result;
        }
      };` });
  });
  const observations = [];
  for (const map of ['taierzhuang-fort', 'nanjing']) {
    requests.length = 0;
    await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + (map === 'nanjing' ? '/?campaign=nanjing' : ''));
    if (map === 'taierzhuang-fort') {
      await page.locator('#confirm-campaign').click();
      await page.locator('#redeploy-choices [data-type="tank"]').click();
      await page.locator('#confirm-deploy').click();
    } else {
      await page.waitForFunction(() => window.__battle?.state === 'menu' && window.worldAudioReview, null, { timeout: 180000 });
      await page.locator('#deploy').click();
    }
    await page.waitForFunction(() => window.__battle?.state === 'playing' && window.worldAudioReview, null, { timeout: 180000 });
    await page.locator('#world').click({ position: { x: 700, y: 400 } });
    await page.waitForFunction(() => window.worldAudioReview.ready(), null, { timeout: 30000 });
    const engine = await page.evaluate(() => worldAudioReview.engine());
    assert.ok(engine.unchanged); assert.ok(engine.after.active > 0 && engine.after.active <= 3);
    if (engine.vehicleId) {
      assert.ok(engine.after.voices.some(voice => voice.owned));
      assert.equal(engine.first.history.filter(event => event.vehicleId === engine.vehicleId).length,
        engine.after.history.filter(event => event.vehicleId === engine.vehicleId).length);
    }
    const common = await page.evaluate(() => worldAudioReview.common());
    assert.ok(common.unchanged);
    for (const kind of ['flyby', 'hit-stone', 'hit-wood', 'hit-soil'])
      assert.ok(common.feedback.history.some(event => event.kind === kind), kind);
    const mute = await page.evaluate(() => worldAudioReview.mute());
    assert.ok(Object.values(mute).every(channel => channel.effectiveGain === 0));
    if (map === 'taierzhuang-fort') {
      assert.equal(common.feedback.available.length, 5);
      assert.ok(requests.every(path => !/\/(oar|water-crash|bubbles|deck-step|submerged-metal)\.wav/.test(path)));
      const plane = await page.evaluate(() => worldAudioReview.ownPlane());
      assert.ok(plane.voices.some(voice => voice.type === 'plane' && voice.owned));
      observations.push({ map, engine, common, ownedPlane: plane });
    } else {
      const river = await page.evaluate(() => worldAudioReview.river());
      assert.ok(river.emptyReturn && river.returnOar);
      for (const kind of ['deck-step', 'oar', 'water-crash', 'bubbles', 'submerged-metal'])
        assert.ok(river.feedback.history.some(event => event.kind === kind), kind);
      assert.ok(river.engineBefore && river.stoppedEngine && river.sunk);
      assert.ok(river.feedback.peak <= 8);
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => window.__battle.tacticalAudio.active), 0);
      assert.equal(await page.evaluate(() => window.__battle.vehicleAudio.active + window.__battle.vehicleAudio.fading), 0);
      observations.push({ map, engine, common, river });
    }
  }
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'world-audio.json'), JSON.stringify({ observations, errors,
      note: 'Controlled registered-source combat-event fixtures for common audio; actual boarding/crossing/empty return and aircraft-fall functions for river audio. Not a natural battle or an FPS benchmark.' }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, maps: observations.map(item => item.map), errors }));
} finally { await browser.close(); }
