import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'civilian-refugees');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    window.refugeeReview = {
      begin() {
        showOverlay('pause');
        for(const actor of allForces.filter(actor=>actor.team==='enemy'))actor.health=0;
        enemies=[];for(const formation of formations.filter(formation=>formation.team==='enemy'))formation.active=false;
        nanjingCampaign.stage='gate-defense';nanjingCampaign.dockActivated=false;
      },
      step(seconds) {
        for(let i=0;i<Math.ceil(seconds/.05);i++){
          time+=.05;
          world.doorSystem.update(.05,world.civilians.filter(p=>p.visible&&!p.userData.dead)
            .map(p=>({x:p.position.x,y:p.position.y,z:p.position.z,radius:.36})));
          updateNanjingCivilians(.05);
          presentControlEvents();
        }
        updateCivilianAppearance(world.civilianVisuals,camera,'high');return this.snapshot();
      },
      encounter() {
        nanjingCampaign.stage='withdrawal';nanjingCampaign.presentedStage='withdrawal';
        const person=world.civilians.find(p=>p.userData.resting&&!p.userData.dead);
        if(!person)throw new Error('No actually seated refugee to encounter');
        allies[current].position.set(person.position.x+3,0,person.position.z+2);updateCamera(0);
        return this.step(.1);
      },
      displaceResting() {
        const person=world.civilians.find(p=>p.userData.resting&&p.userData.waypoint===p.userData.route.length);
        if(!person)throw new Error('No completed rest route for the production crash regression');
        person.position.x+=.25;
        this.step(2);
        return {id:person.userData.civilianId,arrived:person.userData.arrived,
          waypoint:person.userData.waypoint,length:person.userData.route.length};
      },
      pump() {
        const elder=world.civilians.find(p=>p.userData.openingWave&&p.userData.ageGroup==='elderly'&&
          p.userData.presentation==='woman'&&!p.userData.dead);
        if(elder){allies[current].position.set(elder.position.x+4,0,elder.position.z+3);updateCamera(0);}
        this.step(.5);
        civilianVoices.update(audioContext,world.civilians,battleAudioListener(),'withdrawal',time,true,false,friendlyForces,enemies);
        return this.snapshot();
      },
      dock() {
        nanjingCampaign.stage='dock-defense';nanjingCampaign.dockActivated=true;
        allies[current].position.set(-66,.36,-80);
        return this.step(14);
      },
      snapshot() {
        return {voice:civilianVoices?.snapshot,waiting:nanjingCampaign.civiliansWaiting,
          rescued:nanjingCampaign.civiliansEvacuated,flight:{...world.civilianFlight},
          people:world.civilians.map(p=>({id:p.userData.civilianId,kind:p.userData.populationKind,
            resting:p.userData.resting,released:p.userData.fleeReleased,arrived:p.userData.arrived,
            group:p.userData.restGroup,pose:p.userData.restPose,blend:p.userData.restPoseWeight,
            waypoint:p.userData.waypoint,route:p.userData.route.length,restPoint:p.userData.refugeeRestPoint,
            target:p.userData.route[p.userData.waypoint],position:p.position.toArray()}))};
      },
      view(close=false) {
        $('overlay').hidden=true;$('toast').style.opacity='0';if(weapon)weapon.visible=false;
        const person=world.civilians.find(p=>p.userData.resting&&p.userData.restGroup===0);
        if(close&&person){camera.position.set(person.position.x+3.5,2.5,person.position.z+5);
          camera.lookAt(person.position.x,.6,person.position.z);}
        else{camera.position.set(-8,7,-7);camera.lookAt(-15,0,-30);}
        camera.updateMatrixWorld(true);
      }
    };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5333/');
  url.searchParams.set('campaign', 'nanjing');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.refugeeReview && __battle.state === 'playing');
  await page.evaluate(() => refugeeReview.begin());
  await page.waitForFunction(() => __battle.civilianVoices.clips === 135, null, { timeout: 45000 });
  const seated = await page.evaluate(() => refugeeReview.step(200));
  await writeFile(join(directory, 'seated.json'), JSON.stringify(seated, null, 2));
  assert.equal(seated.people.filter(person => person.kind === 'refugee').length, 60);
  assert.equal(seated.people.filter(person => person.kind === 'resident').length, 120);
  assert.equal(seated.people.filter(person => person.kind === 'refugee' && person.resting).length, 60,
    'all sixty unobstructed refugees must physically reach their rest places');
  assert.equal(seated.waiting, 0); assert.equal(seated.rescued, 0);
  assert.ok(seated.people.every(person => !person.released));
  const displaced = await page.evaluate(() => refugeeReview.displaceResting());
  assert.equal(displaced.arrived, false, 'a completed city rest route must never count as dock arrival');
  assert.equal(displaced.waypoint, displaced.length);
  await page.evaluate(() => refugeeReview.view());
  await page.screenshot({ path: join(directory, 'roadside-rest.png') });
  await page.evaluate(() => refugeeReview.view(true));
  await page.screenshot({ path: join(directory, 'roadside-first-group.png') });
  const encounter = await page.evaluate(() => refugeeReview.encounter());
  assert.notEqual(encounter.flight.encounterAt, null);
  let speech = encounter;
  for (let index = 0; index < 70 && (speech.voice?.encounterSpoken ?? 0) < 3; index++) {
    speech = await page.evaluate(() => refugeeReview.pump());
    await page.waitForTimeout(400);
  }
  assert.equal(speech.voice.encounters, 1);
  assert.equal(speech.voice.encounterSpoken, 3);
  assert.ok(speech.people.some(person => person.released) && speech.people.some(person => !person.released));
  const released = await page.evaluate(() => refugeeReview.dock());
  assert.ok(released.people.every(person => person.released));
  assert.ok(released.people.some(person => !person.arrived), 'a release order must not teleport every civilian to the dock');
  await writeFile(join(directory, 'escape-flow.json'), JSON.stringify({ encounter, speech, released, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, seatedRefugees: seated.people.filter(person => person.resting).length,
    actualEncounterLines: speech.voice.encounterSpoken, retainedCivilians: released.people.length }));
} finally { await browser.close(); }
