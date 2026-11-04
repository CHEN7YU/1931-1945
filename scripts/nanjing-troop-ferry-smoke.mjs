import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    window.troopFerryReview = {
      returnToLobby() { showOverlay('pause'); },
      restartStatus() { return {stage:nanjingCampaign.stage,deployments}; },
      restart(count,aiCount=3) { setGameState('menu');beginMatch();return this.begin(count,aiCount); },
      readyForF() {
        const ferry=world.ferries.filter(candidate=>candidate.userData.state==='docked'&&
          (candidate.userData.troopPassengers?.length??0)<NANJING_BOAT_CAPACITY)
          .sort((a,b)=>Number(!(a.userData.troopPassengers?.length))-Number(!(b.userData.troopPassengers?.length))||
            (a.userData.troopPassengers?.length??0)-(b.userData.troopPassengers?.length??0))[0];
        if(!ferry)throw new Error('No actual ferry space remains for the player');
        allies[current].position.set(-72.2,.36,ferry.position.z);
        if(allies[current].nativeMotion)allies[current].nativeMotion.position={x:-72.2,z:ferry.position.z};
        setGameState('playing');bindControlInput();
      },
      observeDock() {
        camera.position.set(-65,2.1,-80);camera.lookAt(-91,.8,-80);camera.updateMatrixWorld(true);
      },
      begin(ownCount=11,aiCount=3) {
        setGameState('pause');
        missionBriefing.hide();
        missionBriefing.hide();
        for(const formation of formations.filter(item=>item.team==='enemy')) {
          formation.active=false;formation.respawnEnabled=false;
          for(const actor of formation.members)actor.health=0;
        }
        enemies=[];entities.vehicles.clear();vehicleRenderer.clear();
        Object.assign(nanjingCampaign,{stage:'withdrawal-to-boats',dockActivated:true,stageRemaining:0,
          civiliansWaiting:0,civiliansAboard:0,civilianCasualties:180,requiredAISquads:4});
        for(const person of world.civilians){person.visible=false;person.userData.dead=true;person.userData.health=0;}
        world.civilianQueue.length=0;
        const forces=formations.filter(item=>item.team==='friendly'&&!item.player);
        const retained=[];
        for(const formation of forces) {
          if(!formation.members.length)spawnFormation(formation,true);
          formation.reserve=false;formation.respawnEnabled=false;formation.objectiveId='dock';
          const keep=formation.members.slice(0,aiCount),discard=formation.members.slice(aiCount);
          clearActors(discard);formation.members=keep;
          for(const actor of keep) {
            const index=retained.length;
            actor.position.set(-67+(index%2),.36,-86+(index%5)*3);
            actor.nextThink=Infinity;actor.target=null;actor.tactics.cover=null;actor.path=[];
            retained.push(actor);
          }
        }
        friendlyAI=retained;rebuildForces();
        for(const [index,actor] of allies.entries()){
          actor.health=index<ownCount?100:0;actor.position.set(-65+index%3,.36,-86+index%5*3);
          actor.order='hold';actor.orderPoint=actor.position.clone();actor.nextThink=Infinity;actor.target=null;
        }
        allies[current].position.set(-72.2,.36,-80);controlPose.yaw=Math.PI/2;controlPose.pitch=-.13;
        this.tracked=[...retained,...allies.filter(actor=>actor.health>0)];
        this.playerId=entities.control.soldierId;updateCamera(0);
        nanjingCampaign.requiredAISquads=forces.length;
        this.ids=retained.map(actor=>actor.id);this.squadCount=forces.length;
        return this.snapshot();
      },
      snapshot() {
        return {alive:friendlyAI.filter(actor=>actor.health>0).length,
          evacuated:nanjingCampaign.evacuatedSquads.length,required:nanjingCampaign.requiredAISquads,
          boarded:nanjingAIBoardedCount(nanjingCampaign),personalBoatId:nanjingCampaign.playerBoardingBoatId,
          playerEscaped:nanjingCampaign.playerEscaped,civilianEvacuated:nanjingCampaign.civiliansEvacuated,
          ownLiving:allies.filter(actor=>actor.health>0).length,
          ownActors:allies.filter(actor=>actor.health>0).map(actor=>({id:actor.id,x:actor.position.x,y:actor.position.y,z:actor.position.z,
            phase:actor.tactics.nanjingFerry?.phase??'waiting',traversal:actor.traversal.kind,
            mode:actor.tactics.mode,pathReason:actor.tactics.pathReason,path:actor.path?.slice(0,2)})),
          trackedHealthy:this.tracked.every(actor=>actor.health===100),
          actors:friendlyAI.filter(actor=>this.ids.includes(actor.id)).map(actor=>({id:actor.id,x:actor.position.x,y:actor.position.y,z:actor.position.z,
            phase:actor.tactics.nanjingFerry?.phase??'approach'})),
          boats:world.ferries.map(ferry=>({state:ferry.userData.state,x:ferry.position.x,boarding:Boolean(ferry.userData.troopBoarding),
            troops:ferry.userData.troopPassengers?.length??0,
            ownPassengers:(ferry.userData.troopPassengers??[]).filter(person=>person.actor.playerUnit).map(person=>person.actor.id),
            allGrounded:(ferry.userData.troopPassengers??[]).every(person=>person.actor.traversal.kind==='grounded'),
            seatErrors:(ferry.userData.troopPassengers??[]).filter(person=>person.actor.health>0)
              .map(person=>ferry.worldToLocal(person.actor.position.clone()).distanceTo(person.local))}))};
      },
      step(count) {
        setGameState('playing');
        for(let index=0;index<count&&!nanjingCampaign.outcome;index++){
          aiDecisions.beginFrame();advanceBattleStep(.05,time+.05);
        }
        updateHUD();
        if(!nanjingCampaign.outcome)setGameState('pause');
        return this.snapshot();
      }
    };` });
  });
  await page.goto(`${process.env.GAME_URL ?? 'http://127.0.0.1:5203'}/?campaign=nanjing`);
  await page.waitForFunction(() => window.troopFerryReview &&
    document.getElementById('overlay').dataset.deploymentStep === 'identity', null, { timeout: 180000 });
  await page.locator('#confirm-identity').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  const initial = await page.evaluate(() => troopFerryReview.begin());
  const first = await page.evaluate(() => troopFerryReview.step(1));
  assert.equal(first.alive, initial.alive, 'a squad inside the 15m dock zone must not disappear');
  assert.equal(first.evacuated, 0);
  const seen = { boarding: false, aboard: false, outgoing: false }, snapshots = [], results = [];
  let final = first;
  const checkSeats = snapshot => {
    assert.ok(snapshot.trackedHealthy, 'no test survivor may suffer fake ground/fall damage while aboard');
    for (const boat of snapshot.boats) {
      assert.ok(boat.troops <= 10);
      assert.ok(boat.allGrounded, 'boarding and boat-deck support must not become a free fall');
      assert.ok(boat.seatErrors.every(error => error < 1e-5),
        `passengers must follow the actual moving ferry, not remain over the water: ${JSON.stringify(boat)}`);
    }
  };
  for (let chunk = 0; chunk < 240 && final.boarded < final.required; chunk++) {
    final = await page.evaluate(() => troopFerryReview.step(10));
    checkSeats(final);
    const checkpoint = final.boats.some(boat => boat.boarding) && !seen.boarding ? 'boarding'
      : final.boats.some(boat => boat.state === 'outbound' && boat.troops > 0 && boat.x < -76.1) && !seen.outgoing ? 'outgoing'
      : final.boats.some(boat => boat.troops > 0) && !seen.aboard ? 'aboard' : null;
    if (checkpoint) {
      seen[checkpoint] = true; snapshots.push({ checkpoint, ...final });
      if (process.env.ARTIFACT_DIR) {
        await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `troops-${checkpoint}.png`) });
      }
    }
  }
  assert.equal(final.boarded, final.required);
  assert.equal(final.evacuated, 0, 'player boarding must become available without waiting for partial AI boats to cross');
  assert.ok(final.boats.filter(boat => boat.troops > 0).every(boat => boat.state === 'docked'),
    'partially loaded AI boats must wait for player seats');
  async function boardAndExit(start, count) {
    await page.evaluate(() => troopFerryReview.readyForF());
    await page.keyboard.press('f');
    let snapshot = await page.evaluate(() => troopFerryReview.step(0));
    assert.notEqual(snapshot.personalBoatId, null);
    assert.equal(snapshot.playerEscaped, false, 'F begins physical boarding, not instant victory');
    const boatId = snapshot.personalBoatId;
    for (let chunk = 0; chunk < 300 && !snapshot.playerEscaped; chunk++) {
      snapshot = await page.evaluate(() => troopFerryReview.step(5)); checkSeats(snapshot);
      const boat = snapshot.boats[boatId];
      if (boat.ownPassengers.length) assert.equal(boat.ownPassengers[0], start.playerId, 'the player must board before their own AI');
      if (!seen.outgoing && snapshot.boats.some(item => item.state === 'outbound' && item.troops > 0 && item.x < -80)) {
        seen.outgoing = true;
        if (process.env.ARTIFACT_DIR) {
          await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
          await page.evaluate(() => troopFerryReview.observeDock());
          await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'troops-moving-aligned.png') });
        }
      }
      if (boat.state === 'outbound') assert.ok(boat.troops === 10 || boat.ownPassengers.length === count,
        'never leave early with only two or three own squad members when more can board');
    }
    if (!snapshot.playerEscaped) {
      if (process.env.ARTIFACT_DIR) {
        await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await writeFile(join(process.env.ARTIFACT_DIR, 'boarding-failure.json'), JSON.stringify(snapshot, null, 2));
      }
      console.error(JSON.stringify({ boatId, own: snapshot.ownActors, boat: snapshot.boats[boatId] }));
    }
    assert.equal(snapshot.playerEscaped, true);
    const boat = snapshot.boats[boatId];
    assert.ok(boat.state === 'outbound' && boat.x <= -77);
    assert.equal(snapshot.civilianEvacuated, start.civilianEvacuated);
    if (count === 11) assert.equal(boat.troops, 10, 'the full-boat branch must conclude without exceeding capacity');
    else assert.ok(boat.troops < 10 && boat.ownPassengers.length === count, 'a smaller surviving squad can leave once all its AI are aboard');
    results.push({ ownSurvivors: count, final: snapshot });
    return snapshot;
  }
  initial.playerId = await page.evaluate(() => troopFerryReview.playerId);
  final = await boardAndExit(initial, 11);
  assert.ok(seen.boarding && seen.aboard && seen.outgoing);
  const smallStart = await page.evaluate(() => troopFerryReview.restart(3));
  let small = smallStart;
  for (let chunk = 0; chunk < 240 && small.boarded < small.required; chunk++) {
    small = await page.evaluate(() => troopFerryReview.step(10)); checkSeats(small);
  }
  assert.equal(small.boarded, small.required);
  smallStart.playerId = await page.evaluate(() => troopFerryReview.playerId);
  await boardAndExit(smallStart, 3);
  const fullArmyStart = await page.evaluate(() => troopFerryReview.restart(11,11));
  assert.equal(fullArmyStart.alive, 44, 'also cover all four complete eleven-person AI squads');
  let fullArmy = fullArmyStart;
  for (let chunk = 0; chunk < 480 && fullArmy.boarded < fullArmy.required; chunk++) {
    fullArmy = await page.evaluate(() => troopFerryReview.step(10)); checkSeats(fullArmy);
  }
  assert.equal(fullArmy.boarded, fullArmy.required);
  fullArmyStart.playerId = await page.evaluate(() => troopFerryReview.playerId);
  await boardAndExit(fullArmyStart, 11);
  await page.evaluate(() => troopFerryReview.returnToLobby());
  await page.locator('#back-menu').click();
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  assert.deepEqual(await page.evaluate(() => troopFerryReview.restartStatus()), { stage: 'gate-defense', deployments: 1 },
    'a new match must recommend its initial gate positions, never the previous match dock spawn');
  assert.deepEqual(errors, []);
  const result = { passed: true, initial, final, seen, snapshots, results,
    limitation: 'Controlled empty-enemy dock fixtures covering both 12 surviving AI and all 44 full-strength AI, plus 11/3 own survivors. Complete production simulation includes grounding, movement, boarding, ferries and victory; not a natural battle or FPS benchmark.' };
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'troop-ferries.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, aiSquadsBoarded: final.boarded, playerBoardsFirst: true, fullAndSmallSquadExit: true, movingSeatsAligned: true }));
} finally { await browser.close(); }
