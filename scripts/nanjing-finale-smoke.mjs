import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
const readyTimeout = Number(process.env.NANJING_FINALE_READY_TIMEOUT_MS ?? 180000);
const gameUrl = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
gameUrl.pathname = '/';
gameUrl.searchParams.set('campaign', 'nanjing');
if (process.env.GAME_CHARACTER) gameUrl.searchParams.set('character', process.env.GAME_CHARACTER);
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
page.on('console', message => {
  if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); }
});
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace('await nraCharacter?.prepare(renderer);',
        'await new Promise(resolve=>setTimeout(resolve,1000));await nraCharacter?.prepare(renderer);')
      .replace('const frameInterval = now - lastFrame;',
        'const frameInterval = now - lastFrame;window.firstBattleFrameInterval??=frameInterval;');
    await route.fulfill({ response, body: source + `
      window.nanjingFinaleReview = {
        finale(){
          setGameState('menu');beginMatch();setGameState('pause');
          const player=controlledSoldier(entities),formation=formations.find(unit=>unit.team==='friendly'&&!unit.player&&unit.members.length);
          const guards=formation.members;
          for(const actor of allForces)if(actor!==player&&!guards.includes(actor))actor.health=0;
          for(const unit of formations){unit.reserve=false;unit.respawnEnabled=false;}
          enemies=[];rebuildForces();combatSounds.length=0;
          const candidates=[];
          for(let z=-90;z<=-69;z+=1.5)for(let x=-52;x<=-42;x+=1.5)
            if(Math.hypot(x-NANJING_DOCK.x,z-NANJING_DOCK.z)>17&&!circleBlocked(x,z,.5,world.obstacles))
              candidates.push({x,z});
          if(candidates.length<guards.length)throw Error('Missing clear outside-dock positions for the final AI withdrawal');
          guards.forEach((actor,index)=>actor.position.set(candidates[index].x,world.groundHeight(candidates[index].x,candidates[index].z),candidates[index].z));
          player.position.set(-72.3,.36,-80);
          for(const person of world.civilians){
            person.visible=false;person.userData.dead=true;person.userData.health=0;
          }
          const waiting=world.civilians.slice(0,2),walker=world.civilians[2];
          for(const person of [...waiting,walker])Object.assign(person.userData,{dead:false,health:100,releaseAt:0,active:false});
          for(const person of waiting){
            const slot=person.userData.waitingSlot;
            person.visible=true;person.position.set(slot.x,world.groundHeight(slot.x,slot.z),slot.z);
            Object.assign(person.userData,{arrived:true,active:true,route:[slot],waypoint:1});
          }
          world.civilianQueue.splice(0,world.civilianQueue.length,...waiting);
          nanjingCampaign.stage='withdrawal-to-boats';nanjingCampaign.dockActivated=true;
          nanjingCampaign.requiredAISquads=1;nanjingCampaign.presentedStage='withdrawal-to-boats';
          nanjingCampaign.civilianCasualties=177;
          registerCivilianArrival(nanjingCampaign,2);
          updateHUD();
          const pendingHUD=$('objective-help').textContent;
          let partialDeparture=false,maxCivilianStep=0,steps=0;
          for(;steps<6000&&!nanjingCivilianEvacuationStatus(nanjingCampaign,world.civilians).ready;steps++){
            time+=.05;
            world.doorSystem.update(.05,world.civilians.filter(person=>person.visible&&person.parent===scene)
              .map(person=>({...person.position,radius:.36})));
            const before=walker.getWorldPosition(new THREE.Vector3());
            updateNanjingCivilians(.05);updateNanjingMission(.05);
            if(walker.parent)maxCivilianStep=Math.max(maxCivilianStep,
              walker.getWorldPosition(new THREE.Vector3()).distanceTo(before));
            if(!walker.userData.arrived)for(const ferry of world.ferries){
              const boat=nanjingCampaign.boats[ferry.userData.ferryId];
              if(boat.returning&&boat.passengers>0&&boat.passengers<10)partialDeparture=true;
            }
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          const civilians=nanjingCivilianEvacuationStatus(nanjingCampaign,world.civilians);
          const before=guards.map(actor=>actor.position.clone());let travel=0;
          for(let frame=0;frame<800&&!nanjingCampaign.evacuatedSquads.length;frame++){
            time+=.05;aiDecisions.beginFrame();updateWeaponSimulation(.05);updateGrenades(.05);updateAI(.05);
            for(const actor of guards)if(actor.health>0&&actor.nativeMotion)advanceNraMotion(actor,.05);
            updateNanjingCivilians(.05);updateNanjingMission(.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          for(let index=0;index<guards.length;index++)travel+=guards[index].position.distanceTo(before[index]);
          const aiBoarding={required:nanjingCampaign.requiredAISquads,boarded:[...nanjingCampaign.boardedAISquads],
            evacuated:nanjingCampaign.evacuatedSquads.map(squad=>({...squad})),
            guards:guards.map(actor=>({id:actor.id,health:actor.health,position:actor.position.toArray(),
              ferry:actor.tactics.nanjingFerry??null})),
            ferries:world.ferries.map(ferry=>({id:ferry.userData.ferryId,state:ferry.userData.state,
              passengers:ferry.userData.troopPassengers?.map(passenger=>passenger.actor.id)??[],
              boarding:ferry.userData.troopBoarding?.actor.id??null}))};
          for(let frame=0;frame<1400&&!world.ferries.some(ferry=>ferry.userData.state==='docked'&&
            Math.hypot(player.position.x-ferry.position.x,player.position.z-ferry.position.z)<=4);frame++){
            time+=.05;updateNanjingCivilians(.05);updateNanjingMission(.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          setGameState('playing');
          bindControlInput();
          const interaction=dispatchControlCommand('interact');
          let playerSteps=0;
          for(;playerSteps<3000&&!nanjingCampaign.outcome;playerSteps++){
            time+=.05;updateNanjingCivilians(.05);updateNanjingMission(.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          const playerFerry=world.ferries.find(ferry=>ferry.userData.ferryId===player.tactics.nanjingFerry?.ferryId);
          return{pendingHUD,partialDeparture,civilianSeconds:steps*.05,civilians,maxCivilianStep,
            aiTravel:travel,evacuated:nanjingCampaign.evacuatedSquads,ending:battleEnding.snapshot,outcome:nanjingCampaign.outcome,
            toast:$('toast').textContent,interaction,playerSteps,playerBoarding:player.tactics.nanjingFerry??null,
            playerFerry:playerFerry?{id:playerFerry.userData.ferryId,state:playerFerry.userData.state,x:playerFerry.position.x,
              departed:playerFerry.position.x<=NANJING_DOCK.ferryX-1}:null,aiBoarding};
        },
        async respawn(){
          for(let frame=0;battlePreparing&&frame<300;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));
          if(battlePreparing)throw Error('Previous battle render preparation did not finish before respawn');
          setGameState('menu');beginMatch();
          const enemy=enemies.find(actor=>!actor.vehicleId);
          for(const actor of allForces)if(actor!==enemy)actor.health=0;
          enemy.position.set(NANJING_DOCK.x,.36,NANJING_DOCK.z);
          enemies=[enemy];friendlyAI=[];rebuildForces();
          nanjingCampaign.dockActivated=true;nanjingCampaign.stage='dock-defense';
          for(const person of world.civilians)person.visible=false;
          const civilians=world.civilians.slice(0,8);
          for(const [index,person] of civilians.entries()){
            person.visible=true;person.position.set(-67+(index%4)*1.3,.36,-81+Math.floor(index/4)*1.3);
          }
          showOverlay('dead');pendingSquad='infantry';pendingSpawn='nanjing-west-dock';
          refreshDeployment();
          const enabled=!$('confirm-deploy').disabled;
          deploy('infantry','nanjing-west-dock');
          const result={enabled,state,count:allies.filter(actor=>actor.health>0).length,
            positions:allies.map(actor=>actor.position.toArray()),
            enemyClearance:Math.min(...allies.map(actor=>actor.position.distanceTo(enemy.position))),
            civilianClearance:Math.min(...allies.flatMap(actor=>civilians.map(person=>actor.position.distanceTo(person.position))))};
          setGameState('pause');return result;
        },
        async grenade(){
          const{advanceGrenadeFlight,GRENADE}=await import('/src/grenades.js');
          let location=null;
          for(const home of world.landmarks.residentialBuildings){
            const point={x:home.exit.x,y:world.groundHeight(home.exit.x,home.exit.z)+GRENADE.size,z:home.exit.z};
            const hit=traceGrenade(point,{...point,y:point.y-.005},GRENADE.size,true);
            if(hit&&hit.normal.y>.6&&!hit.staticSupport){location=point;break;}
          }
          if(!location)throw Error('Missing real uncacheable doorstep support');
          const grenade={kind:'grenade',resting:true,position:{...location},velocity:{x:0,y:0,z:0},collisions:0};
          let queries=0;const trace=(...args)=>{queries++;return traceGrenade(...args);};
          const start=performance.now();
          for(let step=0;step<100;step++)advanceGrenadeFlight(grenade,.05,trace);
          return{queries,steps:100,totalMs:performance.now()-start,resting:grenade.resting,position:grenade.position,location};
        }
      };` });
  });
  await page.goto(gameUrl.href, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.__battle?.state === 'menu' && window.nanjingFinaleReview,
      null, { timeout: readyTimeout });
  } catch (error) {
    const readiness = await page.evaluate(() => ({
      state: window.__battle?.state ?? null,
      hasReview: Boolean(window.nanjingFinaleReview),
      loading: document.querySelector('#loading')?.textContent,
      loadingHidden: document.querySelector('#loading')?.hidden,
      menuHidden: document.querySelector('#menu')?.hidden,
    })).catch(() => null);
    console.log(JSON.stringify({ readiness, errors }));
    throw error;
  }
  let firstFrameInterval = null;
  if (process.env.GAME_CHARACTER !== 'procedural') {
    await page.waitForFunction(() => Number.isFinite(window.firstBattleFrameInterval));
    firstFrameInterval = await page.evaluate(() => window.firstBattleFrameInterval);
    assert.ok(firstFrameInterval < 500, 'the deliberate one-second preparation delay must not appear as a battle frame hitch');
  }
  const finale = await page.evaluate(() => nanjingFinaleReview.finale());
  console.log(JSON.stringify({ finale }));
  assert.match(finale.pendingHUD, /在途 1.*候船 2/);
  assert.ok(finale.partialDeparture && finale.civilians.ready);
  assert.equal(finale.civilians.evacuated, 3);
  assert.ok(finale.maxCivilianStep <= .27 && finale.aiTravel > 3);
  assert.equal(finale.aiBoarding.boarded.length, 1);
  assert.equal(finale.aiBoarding.evacuated.length, 0, 'the player must not wait for other ferries to finish crossing');
  assert.ok(finale.aiBoarding.ferries.some(ferry => ferry.state === 'docked' && ferry.passengers.length > 0));
  assert.ok(finale.aiBoarding.ferries.some(ferry => ferry.state === 'outbound' && ferry.passengers.length > 0));
  assert.equal(finale.interaction.status, 'applied', JSON.stringify(finale.interaction));
  assert.equal(finale.playerBoarding.phase, 'aboard');
  assert.equal(finale.playerFerry.state, 'outbound');
  assert.ok(finale.playerFerry.departed, 'the ending must wait until the selected ferry has left the dock');
  assert.ok(finale.playerSteps < 3000, 'the player must actually board and depart on the selected ferry');
  assert.equal(finale.outcome, 'evacuated');
  assert.equal(finale.ending.result, 'commemoration');
  const respawn = await page.evaluate(() => nanjingFinaleReview.respawn());
  console.log(JSON.stringify({ respawn }));
  assert.ok(respawn.enabled); assert.equal(respawn.state, 'playing'); assert.equal(respawn.count, 11);
  assert.ok(respawn.enemyClearance >= 1.25 && respawn.civilianClearance >= 1.25);
  assert.ok(respawn.positions.every(([x, , z]) => Math.hypot(x + 66, z + 80) <= 20));
  const grenade = await page.evaluate(() => nanjingFinaleReview.grenade());
  console.log(JSON.stringify({ grenade, firstFrameInterval, errors }));
  assert.equal(grenade.queries, grenade.steps);
  assert.ok(grenade.resting); assert.deepEqual(grenade.position, grenade.location);
  assert.deepEqual(errors, []);
  if (process.env.NANJING_FINALE_RESULT)
    await writeFile(process.env.NANJING_FINALE_RESULT, JSON.stringify({ finale, respawn, grenade, firstFrameInterval, errors }, null, 2));
} finally { await browser.close(); }
