import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const campaign of ['nanjing', 'taierzhuang-fort']) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
      window.airSquadReview = {
        pause() { showOverlay('pause'); },
        units() { return formations.filter(f=>f.team==='enemy'&&f.type==='plane'); },
        live(f) { return [...entities.vehicles.values()].filter(v=>v.unitId===f.id&&v.type==='plane'&&v.health>0); },
        snapshot() { return this.units().map(f=>({id:f.id,generation:f.generation,count:f.aircraftCount,
          alive:this.live(f).length,pilots:f.members.filter(a=>a.health>0).length,
          pending:f.respawnAt,enabled:f.respawnEnabled!==false})); },
        refresh(seconds=0) { time+=seconds;populationRefreshAt=0;updateAI(.01);return this.snapshot(); },
        wipe(id,count=3) { for(const v of this.live(this.units().find(f=>f.id===id)).slice(0,count))
          damageVehicle(v,100000,'crash','collision');
          return this.snapshot(); },
        priority(id) {
          for(const [index,actor] of allies.entries())
            if(actor.health>0)actor.position.set((index%3)*2,world.groundHeight(0,75),75+Math.floor(index/3));
          for(const [index,v] of this.live(this.units().find(f=>f.id===id)).entries()){
            v.position.set(index*24,60,130);v.heading=0;v.pitch=-.3;
            Object.assign(v.aiFlight,{nextSense:0,targetId:null,phase:'approach'});
          }
          updateVehicles(.01);
          return this.live(this.units().find(f=>f.id===id)).map(v=>
            entities.soldiers.get(v.aiFlight.targetId)?.unitId===allies[current].unitId);
        },
        withdrawal() { if(nanjingCampaignMode){nanjingCampaign.stage='withdrawal';nanjingCampaign.reinforcementStopped=true;} },
        secondStage() {
          for(const point of objectives)point.owner='friendly';
          advanceEncirclement(encirclement,objectives,formations,0,{restoreForces:true});
          for(let index=0;index<30&&encirclement.breakout.reinforcing;index++){
            time+=.5;restoreBreakoutForces();
          }
          if(encirclement.breakout.reinforcing)throw new Error('Second-stage restoration did not finish');
          return this.snapshot();
        },
        ending() { showOverlay('victory'); }
      };` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5333/');
    url.searchParams.set('campaign', campaign);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (campaign !== 'nanjing') await page.locator('#confirm-campaign').click();
    await deployFromMenu(page);
    await page.waitForFunction(() => window.airSquadReview && __battle.state === 'playing', null, { timeout: 180000 });
    await page.evaluate(() => airSquadReview.pause());
    const [initial] = await page.evaluate(() => airSquadReview.snapshot());
    assert.equal(initial.alive, 3); assert.equal(initial.count, 3);
    const cycle = async (id, delay) => {
      const before = (await page.evaluate(() => airSquadReview.snapshot())).find(f => f.id === id);
      assert.deepEqual(await page.evaluate(id => airSquadReview.priority(id), id), [true, true, true]);
      await page.evaluate(id => airSquadReview.wipe(id, 2), id);
      let units = await page.evaluate(() => airSquadReview.refresh(1));
      assert.equal(units.find(f => f.id === id).alive, 1);
      assert.equal(units.find(f => f.id === id).generation, before.generation);
      await page.evaluate(id => airSquadReview.wipe(id), id);
      await page.evaluate(() => airSquadReview.refresh());
      units = await page.evaluate(seconds => airSquadReview.refresh(seconds), delay - .01);
      assert.equal(units.find(f => f.id === id).generation, before.generation);
      units = await page.evaluate(() => airSquadReview.refresh(.02));
      const next = units.find(f => f.id === id);
      assert.equal(next.generation, before.generation + 1);
      assert.equal(next.alive, 3); assert.equal(next.pilots, 3);
    };
    for (let wave = 0; wave < 3; wave++) await cycle(initial.id, 17);
    if (campaign === 'nanjing') {
      await page.evaluate(() => airSquadReview.withdrawal());
      await cycle(initial.id, 17);
    } else {
      const units = await page.evaluate(() => airSquadReview.secondStage());
      assert.equal(units.length, 3);
      assert.ok(units.every(f => f.count === 3 && f.alive === 3 && f.enabled));
      for (const unit of units) await cycle(unit.id, 17);
    }
    await page.evaluate(() => airSquadReview.ending());
    const before = await page.evaluate(() => airSquadReview.snapshot());
    for (const unit of before) await page.evaluate(id => airSquadReview.wipe(id), unit.id);
    const after = await page.evaluate(() => airSquadReview.refresh(60));
    assert.deepEqual(after.map(f => f.generation), before.map(f => f.generation));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ campaign, passed: true, threePerSquad: true,
      fullWipeOnly: true, repeatedReplacement: true, playerPriority: true, stopsAfterResult: true }));
    await page.close();
  }
} finally { await browser.close(); }
