import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';
import { SIHANG_WAREHOUSE } from '../src/sihang-layout.js';

const root = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'sihang');
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error(error.stack ?? error.message);
  });
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    import { advanceSihangDemolition as __reviewDemolition } from '/src/sihang-campaign.js';
    window.sihangReview = {
      snapshot() { return {state,time,position:allies[current]?.position.toArray(),
        campaign:{...sihangCampaign,demolition:{...sihangCampaign.demolition}},
        friendly:friendlyForces.map(a=>({id:a.id,playerUnit:a.playerUnit,health:a.health,
          position:a.position.toArray(),traversal:a.traversal.kind,mode:a.tactics.mode,
          pathReason:a.tactics.pathReason,path:a.path?.slice(0,2),nextPath:a.nextPath,stuck:a.stuckTime})),
        troops:formations.map(f=>({id:f.id,team:f.team,type:f.type,members:f.members.length,
          alive:f.members.filter(a=>a.health>0).length,generation:f.generation})),
        shields:sihangCombat.snapshot,ending:battleEnding.snapshot,
        voices:sihangVoices?.snapshot,narration:!!endingNarration.victory&&!!endingNarration.defeat}; },
      arrange() {
        showOverlay('pause');combatEvents.clear();
        for(const f of formations.filter(f=>f.team==='enemy')){
          f.respawnEnabled=false;
          for(const a of f.members){
            a.target=null;a.nextThink=Infinity;a.tactics.lastSeen=null;
            if(!f.sihangDemolition)a.health=0;
            else {
              a.position.set((a.index%5-2)*1.02,0,-44.7-Math.floor(a.index/5)*1.46);
              a.heading=Math.PI;a.path=a.pathGoal=null;a.locomotion.speed=0;
              if(a.nativeMotion)a.nativeMotion.position={x:a.position.x,z:a.position.z};
            }
          }
        }
        for(const a of friendlyForces){a.target=null;a.nextThink=Infinity;a.tactics.lastSeen=null;}
        sihangCombat.reset();
        sihangCombat.update(.05,time,{campaign:sihangCampaign,actors:allForces,player:allies[current],keys,shots:[]});
        return this.snapshot();
      },
      view(kind) {
        missionBriefing.hide();
        $('overlay').hidden=true;if(weapon)weapon.visible=false;
        if(kind==='shields'){camera.position.set(7,7,-55);camera.lookAt(0,1.5,-47);}
        else{camera.position.set(62,25,58);camera.lookAt(-4,13,-25);}
        camera.updateMatrixWorld(true);
      },
      arm() {
        showOverlay('pause');
        const operator=allForces.find(a=>a.health>0&&a.formation.sihangDemolition&&a.index===2);
        __reviewDemolition(sihangCampaign,10,{operatorId:operator.id});
        allies[current].position.set(1.7,0,-43.5);controlPose.pitch=0;controlPose.yaw=-Math.PI/2;
        if(allies[current].nativeMotion)allies[current].nativeMotion.position={x:1.7,z:-43.5};
        sihangCombat.update(.01,time,{campaign:sihangCampaign,actors:allForces,player:allies[current],keys,shots:[]});
        updateCamera(0);return this.snapshot();
      },
      retreat() {
        showOverlay('pause');sihangCampaign.stageElapsed=239.95;
        updateSihangMission(.1);
        allies[current].position.set(48,0,45);
        if(allies[current].nativeMotion)allies[current].nativeMotion.position={x:48,z:45};
        updateSihangMission(.05);
        return this.snapshot();
      },
      explode() {
        setGameState('menu');beginMatch();this.arrange();this.arm();
        sihangCampaign.demolition.fuseRemaining=.01;
        setGameState('playing');advanceBattleStep(.02,time);showOverlay('pause');
        updateSihangMission(.05);
        return this.snapshot();
      }
    };
    const __sihangOriginalBegin=beginMatch;
    beginMatch=function(...args){__sihangOriginalBegin(...args);window.sihangInitial=sihangReview.snapshot();};
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5333/');
  url.searchParams.set('campaign', 'sihang');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  try {
    await deployFromMenu(page);
  } catch (error) {
    await writeFile(join(root, 'startup-error.json'), JSON.stringify({
      errors, message: error.message, html: await page.locator('body').innerText(),
    }, null, 2));
    await page.screenshot({ path: join(root, 'startup-error.png') });
    throw error;
  }
  await page.waitForFunction(() => window.sihangInitial && __battle.state === 'playing', null, { timeout: 180000 });
  const initial = await page.evaluate(() => sihangInitial);
  await writeFile(join(root, 'initial.json'), JSON.stringify({ initial, errors }, null, 2));
  assert.equal(initial.troops.filter(f => f.team === 'friendly').reduce((n, f) => n + f.members, 0), 44);
  assert.equal(initial.troops.filter(f => f.team === 'enemy').reduce((n, f) => n + f.members, 0), 97);
  assert.equal(initial.campaign.reserve, 356);
  assert.equal(initial.position[1], SIHANG_WAREHOUSE.floorHeight);
  assert.equal(initial.voices.clips, 8);
  assert.equal(initial.narration, true);
  const arranged = await page.evaluate(() => sihangReview.arrange());
  assert.equal(arranged.shields.shields, 20);
  await setQualityPreset(page, 'high');
  await page.evaluate(() => sihangReview.view('warehouse'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(root, 'warehouse-river.png') });
  await page.evaluate(() => sihangReview.view('shields'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(root, 'shield-canopy.png') });
  await setQualityPreset(page, 'low');
  const armed = await page.evaluate(() => sihangReview.arm());
  assert.equal(armed.campaign.demolition.state, 'armed');
  await page.locator('#resume').click();
  await page.keyboard.down('f');
  await page.waitForFunction(() => __battle.campaign.demolition.defuseProgress >= 3 ||
    __battle.campaign.demolition.state === 'idle', null, { timeout: 30000 });
  const held = await page.evaluate(() => sihangReview.snapshot());
  assert.ok(held.campaign.demolition.fuseRemaining > 8, 'holding F must pause the fuse, not merely slow it');
  await page.waitForFunction(() => __battle.campaign.demolition.disarmed === 1, null, { timeout: 45000 });
  await page.keyboard.up('f');
  const disarmed = await page.evaluate(() => sihangReview.snapshot());
  assert.equal(disarmed.campaign.outcome, null);
  const retreat = await page.evaluate(() => sihangReview.retreat());
  assert.equal(retreat.campaign.stage, 'sihang-retreat');
  assert.equal(retreat.campaign.outcome, null, 'early player crossing cannot bypass other AI survivors');
  assert.equal(retreat.campaign.playerRetreatOpen, false);
  await page.locator('#resume').click();
  const retreatProgress = [];
  for (let index = 0; index < 36; index++) {
    const progress = await page.evaluate(() => sihangReview.snapshot());
    retreatProgress.push(progress);
    await writeFile(join(root, 'retreat-progress.json'), JSON.stringify(retreatProgress, null, 2));
    if (progress.campaign.outcome) break;
    await page.waitForTimeout(5000);
  }
  assert.equal(retreatProgress.at(-1).campaign.outcome, 'evacuated',
    'all real AI survivors must complete the warehouse-to-concession route');
  const victory = await page.evaluate(() => sihangReview.snapshot());
  assert.equal(victory.campaign.evacuatedIds.filter(id => victory.campaign.aiRetreatIds.includes(id)).length,
    victory.campaign.aiRetreatIds.length);
  await page.waitForFunction(() => __battle.battleEnding.canContinue, null, { timeout: 45000 });
  const endingBefore = await page.locator('#ending-music').evaluate(audio => ({ paused: audio.paused, time: audio.currentTime }));
  assert.equal(endingBefore.paused, false); assert.ok(endingBefore.time > 0);
  assert.equal(await page.locator('#menu-music').evaluate(audio => audio.paused), true);
  await page.screenshot({ path: join(root, 'historical-page.png') });
  await page.locator('#battle-ending-continue').click();
  await page.waitForFunction(() => __battle.state === 'victory');
  const endingAfter = await page.locator('#ending-music').evaluate(audio => audio.currentTime);
  assert.ok(endingAfter >= endingBefore.time, 'history-to-results must not restart the ending song');
  const destroyed = await page.evaluate(() => sihangReview.explode());
  assert.equal(destroyed.campaign.outcome, null);
  assert.equal(destroyed.campaign.northWallBreached, true);
  assert.equal(destroyed.ending.phase, 'idle');
  await page.evaluate(() => sihangReview.view('shields'));
  await page.screenshot({ path: join(root, 'demolition-scene.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(root, 'acceptance.json'), JSON.stringify({ fixture: 'controlled campaign boundaries; real held F and AI movement',
    initial, armed, held, disarmed, retreat, victory, destroyed, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, native: true, initialFriendly: 44, initialEnemy: 97,
    heldFDisarm: true, realAISouthCrossing: true, historicalThenResults: true, demolitionReset: true }));
} finally { await browser.close(); }
