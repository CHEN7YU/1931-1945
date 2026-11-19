import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'battle-ending');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations = [];
try {
  for (const scenario of [{ map: 'taierzhuang-fort', result: 'victory' },
    { map: 'nanjing', result: 'commemoration', boat: true }, { map: 'nanjing', result: 'commemoration' }]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
      window.endingReview = {
        ready(kind){return Boolean(endingNarration[kind])&&audioContext?.state==='running';},
        start(kind,boat) {
          for(const actor of allForces.filter(actor=>actor.team==='enemy'))actor.health=0;
          enemies=[];for(const f of formations.filter(f=>f.team==='enemy')){f.active=false;f.respawnEnabled=false;}
          const actor=allies[current];
          controlPose.pitch=.45;held.primary=false;weaponObstruction=obstructionBlend=0;
          if(boat) {
            for(const person of world.civilians){person.userData.dead=true;person.visible=false;}
            Object.assign(nanjingCampaign,{stage:'withdrawal-to-boats',dockActivated:true});
            for(const ally of friendlyAI) if (ally.health>0) ally.tactics.nanjingFerry={phase:'aboard'};
            const ferry=world.ferries[0];ferry.userData.state='docked';
            nanjingCampaign.playerBoardingBoatId=ferry.userData.ferryId;
            actor.tactics.nanjingFerry={phase:'aboard',ferryId:ferry.userData.ferryId,speed:0};
            ferry.userData.troopPassengers=[{actor,seat:0,local:new THREE.Vector3(-1.8,NANJING_FERRY_FLOOR,-.4)}];
            updateNanjingMission(0);
            if (nanjingCampaign.outcome || battleEnding.fading) throw Error('Ending started before the ferry departed');
            ferry.position.x=NANJING_DOCK.ferryX-2;ferry.userData.state='outbound';
            ferry.updateWorldMatrix(true,false);syncTroopFerryPassengers(ferry);
            controlPose.yaw=-Math.PI/2;
            updateNanjingMission(0);
          } else if (nanjingCampaignMode) {
            nanjingCampaign.outcome='gate-overrun';
            updateNanjingMission(0);
          } else showOverlay(kind);
          updateCamera(0);
          return this.snapshot();
        },
        snapshot(){const actor=allies[current],ferry=nanjingPlayerFerry();return{state,ending:battleEnding.snapshot,time,
          position:actor.position.toArray(),ammo:actor.rifle.ammo,shots:actor.rifle.shots,
          health:actor.health,traversal:actor.traversal.kind,keys:[...keys],heading:actor.heading,
          deckControlled:ferry?.userData.troopPassengers?.find(p=>p.actor===actor)?.deckControlled??false,
          local:ferry?.userData.troopPassengers?.find(p=>p.actor===actor)?.local.toArray()??null};}
      };` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5333/');
    url.searchParams.set('campaign', scenario.map);
    if (process.env.GAME_CHARACTER) url.searchParams.set('character', process.env.GAME_CHARACTER);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await deployFromMenu(page);
    await page.waitForFunction(kind => window.endingReview && __battle.state === 'playing' && endingReview.ready(kind),
      scenario.result, { timeout: 180000 });
    const before = await page.evaluate(scenario => endingReview.start(scenario.result, Boolean(scenario.boat)), scenario);
    assert.equal(before.state, 'playing'); assert.equal(before.ending.phase, 'fade');
    await page.keyboard.down('w'); await page.mouse.down();
    await page.waitForTimeout(1300);
    const during = await page.evaluate(() => endingReview.snapshot());
    await page.keyboard.up('w'); await page.mouse.up();
    const moved = await page.evaluate(() => endingReview.snapshot());
    assert.ok(moved.shots > before.shots, `${scenario.map}: firing must remain available during fade`);
    assert.ok(Math.hypot(...moved.position.map((value, index) => value - before.position[index])) > .1);
    if (scenario.boat) {
      assert.ok(Math.hypot(moved.local[0] - before.local[0], moved.local[2] - before.local[2]) > .1,
        JSON.stringify({ before, during, moved }));
      assert.ok(Math.abs(moved.position[1] - .47) < .01);
      await page.keyboard.press('Space'); await page.keyboard.press('Space');
      assert.equal((await page.evaluate(() => endingReview.snapshot())).traversal, 'grounded',
        'deck controls must not leave a permanent jump/vault state');
    }
    await page.keyboard.press('Escape');
    const paused = await page.evaluate(() => endingReview.snapshot());
    await page.waitForTimeout(500);
    assert.equal((await page.evaluate(() => endingReview.snapshot())).ending.elapsed, paused.ending.elapsed);
    await page.locator('#resume').click();
    await page.waitForFunction(() => __battle.battleEnding.phase === 'history', null, { timeout: 35000 });
    const black = await page.evaluate(() => endingReview.snapshot());
    await page.keyboard.down('w'); await page.mouse.down(); await page.waitForTimeout(500);
    await page.keyboard.up('w'); await page.mouse.up();
    const frozen = await page.evaluate(() => endingReview.snapshot());
    assert.equal(frozen.time, black.time);
    assert.deepEqual(frozen.position, black.position);
    assert.equal(frozen.shots, black.shots);
    await page.waitForFunction(() => __battle.battleEnding.canContinue);
    const text = await page.locator('#battle-ending-page').textContent();
    if (scenario.map === 'nanjing') { assert.ok(text.includes('中华门')); assert.ok(text.includes('上新河')); }
    await page.screenshot({ path: join(directory, `${scenario.map}-${scenario.boat ? 'departed' : scenario.result}.png`) });
    await page.setViewportSize({ width: 1280, height: 559 });
    await page.waitForTimeout(100);
    const bounds = await page.locator('#battle-ending-page').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 559 - 45,
      `${scenario.map}: the complete historical page must fit a short laptop viewport`);
    await page.locator('#battle-ending-continue').click();
    await page.waitForFunction(result => __battle.state === result && !document.getElementById('battle-results').hidden, scenario.result);
    if (scenario.map === 'nanjing') {
      assert.match(await page.locator('#overlay-kicker').textContent(), /历史铭记/);
      assert.match(await page.locator('#overlay-title').textContent(), scenario.boat ? /你已登船/ : /铭记南京/);
      assert.doesNotMatch(await page.locator('#overlay-description').textContent(), /胜利|失利|平局/);
    }
    assert.deepEqual(errors, []);
    observations.push({ scenario, before, moved, black, text, errors });
    await writeFile(join(directory, 'ending-sequences.json'), JSON.stringify(observations, null, 2));
    console.log(JSON.stringify({ ...scenario, controlDuringFade: true, historyBeforeResults: true, passed: true }));
    await page.close();
  }
} finally { await browser.close(); }
