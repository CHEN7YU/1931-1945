import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.combatEvacuationReview = {
        reset(keep = null) {
          setGameState('menu');beginMatch();setGameState('pause');
          enemies=[];rebuildForces();combatSounds.length=0;
          if(keep)for(const person of world.civilians)if(!keep.includes(person.userData.civilianId)){
            person.visible=false;person.userData.releaseAt=1e9;
            if(person.userData.streetLife)person.userData.streetLife.wakeAt=1e9;
          }
        },
        step(frames, sound = null) {
          let maxStep=0,minSeparation=Infinity;
          for(let frame=0;frame<frames;frame++){
            time+=.05;
            if(sound&&frame%10===0){
              combatSounds.push({...sound,time,friendly:true,radius:40});
              if(combatSounds.length>32)combatSounds.shift();
            }
            const people=world.civilians.filter(person=>person.visible&&person.parent===scene&&!person.userData.dead);
            world.doorSystem.update(.05,people.map(person=>({...person.position,radius:.36})));
            const positions=new Map(people.map(person=>[person,person.position.clone()]));
            updateNanjingCivilians(.05);
            for(const [person,position] of positions)maxStep=Math.max(maxStep,person.position.distanceTo(position));
            const pair=world.civilians.slice(0,2);
            minSeparation=Math.min(minSeparation,pair[0].position.distanceTo(pair[1].position));
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          return{maxStep,minSeparation};
        },
        street() {
          this.reset([61]);
          const person=world.civilians[61],start=person.position.clone();
          const movement=this.step(400,{x:start.x+1,y:1,z:start.z});
          return{active:person.userData.active,evacuating:person.userData.streetEvacuating,
            panicked:person.userData.panicked,distance:person.position.distanceTo(start),
            releaseAt:person.userData.releaseAt,cycles:person.userData.streetLife.cycles,...movement};
        },
        pair() {
          this.reset([0,1]);
          const pair=world.civilians.slice(0,2);
          pair.forEach((person,index)=>{
            person.position.set(-24+index*.73,0,45);person.visible=true;person.userData.releaseAt=0;
            if(circleBlocked(person.position.x,person.position.z,.36,world.obstacles))
              throw Error('Visible-crowd fixture must start in physically clear space');
          });
          const starts=pair.map(person=>person.position.clone()),movement=this.step(400);
          return{people:pair.map((person,index)=>({id:person.userData.civilianId,active:person.userData.active,
            distance:person.position.distanceTo(starts[index]),position:person.position.toArray()})),...movement};
        },
        opening() {
          this.reset();
          const gun=emplacements.get('bridge-mg');
          const movement=this.step(1800,{x:gun.x,y:1,z:gun.z});
          return{remainingAtBridge:world.civilians.slice(0,60).filter(person=>
            !person.userData.arrived&&Math.hypot(person.position.x-gun.x,person.position.z-gun.z)<26)
            .map(person=>({id:person.userData.civilianId,active:person.userData.active,
              position:person.position.toArray(),waypoint:person.userData.waypoint,
              target:person.userData.route[person.userData.waypoint],stalled:person.userData.crowdStalled})),
            arrivals:nanjingCampaign.civiliansArrived,...movement};
        }
      };` });
  });
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/?campaign=nanjing');
  await page.waitForFunction(() => window.__battle?.state === 'menu' && window.combatEvacuationReview,
    null, { timeout: 180000 });
  const street = await page.evaluate(() => combatEvacuationReview.street());
  console.log(JSON.stringify({ street }));
  const pair = await page.evaluate(() => combatEvacuationReview.pair());
  console.log(JSON.stringify({ pair }));
  const opening = await page.evaluate(() => combatEvacuationReview.opening());
  console.log(JSON.stringify({ opening, errors }));
  if (process.env.CIVILIAN_EVACUATION_RESULT)
    await writeFile(process.env.CIVILIAN_EVACUATION_RESULT, JSON.stringify({ street, pair, opening, errors }, null, 2));
  assert.ok(street.active && street.evacuating && street.panicked && street.distance > 8,
    'nearby gunfire must switch a visible street resident into actual evacuation without waiting for the phase change');
  assert.ok(pair.people.every(person => person.active && person.distance > 8),
    'already-visible civilians with legal body clearance must not block each other from starting evacuation');
  assert.ok(pair.minSeparation >= .72 - 1e-6);
  assert.deepEqual(opening.remainingAtBridge, [], 'the opening refugees must leave the active bridge fire zone');
  assert.ok([street, pair, opening].every(result => result.maxStep <= .27), 'evacuation must not teleport civilians');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
