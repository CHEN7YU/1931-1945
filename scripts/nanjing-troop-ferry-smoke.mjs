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
      begin() {
        setGameState('pause');
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
          const keep=formation.members.slice(0,3),discard=formation.members.slice(3);
          clearActors(discard);formation.members=keep;
          for(const actor of keep) {
            const index=retained.length;
            actor.position.set(-67+(index%2),.36,-86+(index%5)*3);
            actor.nextThink=Infinity;actor.target=null;actor.tactics.cover=null;actor.path=[];
            retained.push(actor);
          }
        }
        friendlyAI=retained;rebuildForces();
        allies[current].position.set(-63,.36,-80);camera.position.set(-63,2.1,-80);camera.lookAt(-77,.9,-80);camera.updateMatrixWorld(true);
        nanjingCampaign.requiredAISquads=forces.length;
        this.ids=retained.map(actor=>actor.id);this.squadCount=forces.length;
        return this.snapshot();
      },
      snapshot() {
        return {alive:friendlyAI.filter(actor=>actor.health>0).length,
          evacuated:nanjingCampaign.evacuatedSquads.length,required:nanjingCampaign.requiredAISquads,
          playerEscaped:nanjingCampaign.playerEscaped,civilianEvacuated:nanjingCampaign.civiliansEvacuated,
          actors:friendlyAI.filter(actor=>this.ids.includes(actor.id)).map(actor=>({id:actor.id,x:actor.position.x,y:actor.position.y,z:actor.position.z,
            phase:actor.tactics.nanjingFerry?.phase??'approach'})),
          boats:world.ferries.map(ferry=>({state:ferry.userData.state,x:ferry.position.x,boarding:Boolean(ferry.userData.troopBoarding),
            troops:ferry.userData.troopPassengers?.length??0}))};
      },
      step(count) {
        for(let index=0;index<count;index++){
          time+=.05;aiDecisions.beginFrame();
          movementCollision.beginStablePass();
          try{updateAI(.05);}finally{movementCollision.endStablePass();}
          updateNanjingCivilians(.05);updateNanjingMission(.05);
          for(const actor of friendlyAI)if(actor.nativeMotion)advanceNraMotion(actor,.05);
        }
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
  const seen = { boarding: false, aboard: false, outgoing: false }, snapshots = [];
  let final = first;
  for (let chunk = 0; chunk < 240 && final.evacuated < final.required; chunk++) {
    final = await page.evaluate(() => troopFerryReview.step(10));
    const checkpoint = final.boats.some(boat => boat.boarding) && !seen.boarding ? 'boarding'
      : final.boats.some(boat => boat.state === 'outbound' && boat.troops > 0 && boat.x < -85) && !seen.outgoing ? 'outgoing'
      : final.boats.some(boat => boat.troops > 0) && !seen.aboard ? 'aboard' : null;
    if (checkpoint) {
      seen[checkpoint] = true; snapshots.push({ checkpoint, ...final });
      if (process.env.ARTIFACT_DIR) {
        await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `troops-${checkpoint}.png`) });
      }
    }
  }
  assert.ok(seen.boarding && seen.aboard && seen.outgoing, 'real troops must walk, board and leave aboard a visible ferry');
  assert.equal(final.evacuated, initial.required);
  assert.equal(final.alive, 0);
  assert.equal(final.playerEscaped, false, 'the player must remain in control and evacuate last');
  assert.equal(final.civilianEvacuated, initial.civilianEvacuated, 'military passages must not inflate civilian rescue counts');
  await page.evaluate(() => troopFerryReview.returnToLobby());
  await page.locator('#back-menu').click();
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  assert.deepEqual(await page.evaluate(() => troopFerryReview.restartStatus()), { stage: 'gate-defense', deployments: 1 },
    'a new match must recommend its initial gate positions, never the previous match dock spawn');
  assert.deepEqual(errors, []);
  const result = { passed: true, initial, final, seen, snapshots,
    limitation: 'Controlled empty-enemy dock fixture with three retained survivors in each actual AI formation; actual walking/navigation, boarding, ferry movement and mission functions, not a natural battle or FPS benchmark.' };
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'troop-ferries.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, squads: final.evacuated, seen, playerStayed: !final.playerEscaped }));
} finally { await browser.close(); }
