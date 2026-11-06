import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const root = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'overload-rescue');
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 559 }, deviceScaleFactor: 1.5 }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    window.rescueReview={frames:[],inputs:[],initial:null,lastClick:null,
      snapshot(){return {state,time,level:automaticQuality.snapshot.level,backlog:simulationClock.snapshot.pendingSeconds,
        budget:stepWorkBudget.snapshot,static:staticRescue.snapshot,
        ammo:allies[current]?.rifle.ammo,action:allies[current]?.rifle.action,health:allies[current]?.health,
        drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
        roster:formations.map(f=>({id:f.id,type:f.type,requested:f.memberCount,members:f.members.length}))};}};
    document.addEventListener('pointerdown',event=>{
      if(event.button===0&&state==='playing')rescueReview.lastClick={at:event.timeStamp,received:performance.now()};
    },true);
    const __rescueOriginalFire=fire;
    fire=function(...args){
      const before=allies[current]?.rifle.shots;
      const result=__rescueOriginalFire(...args);
      if(allies[current]?.rifle.shots>before&&rescueReview.lastClick){
        const now=performance.now(),input=rescueReview.lastClick;
        rescueReview.inputs.push({eventToShotMs:now-input.at,processingToShotMs:now-input.received});
        rescueReview.lastClick=null;
      }
      return result;
    };
    const __rescueOriginalBegin=beginMatch;
    beginMatch=function(...args){__rescueOriginalBegin(...args);rescueReview.initial=rescueReview.snapshot();};
    const __rescueOriginalTick=tick;
    tick=function(now){
      const started=performance.now();__rescueOriginalTick(now);
      if(state==='playing'){
        rescueReview.frames.push({at:performance.now(),cpuMs:performance.now()-started,...rescueReview.snapshot()});
        if(rescueReview.frames.length>500)rescueReview.frames.shift();
      }
    };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5333/');
  url.searchParams.set('campaign', 'nanjing');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.rescueReview?.initial && __battle.state === 'playing', null, { timeout: 180000 });
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.waitForFunction(() => rescueReview.snapshot().level === 3 &&
    rescueReview.snapshot().static.ready, null, { timeout: 60000 });
  for (let index = 0; index < 3; index++) {
    await page.waitForFunction(() => rescueReview.snapshot().state === 'playing' &&
      rescueReview.snapshot().action === 'idle' && rescueReview.snapshot().ammo > 0, null, { timeout: 30000 });
    const previous = await page.evaluate(() => rescueReview.inputs.length);
    await page.mouse.click(640, 280, { delay: 30 });
    await page.waitForFunction(count => rescueReview.inputs.length > count, previous, { timeout: 10000 });
  }
  const result = await page.evaluate(() => ({
    initial: rescueReview.initial, final: rescueReview.snapshot(),
    inputs: rescueReview.inputs, frames: rescueReview.frames,
  }));
  await writeFile(join(root, 'six-times-cpu.json'), JSON.stringify({ test: 'native Nanjing, unchanged armies, 6x developer CPU throttle',
    ...result, errors }, null, 2));
  assert.equal(result.inputs.length, 3, 'brief down/up clicks must not be lost between heavy simulation frames');
  assert.ok(result.inputs.every(input => input.eventToShotMs < 1500),
    `input-to-shot delays: ${result.inputs.map(input => input.eventToShotMs.toFixed(1)).join(',')}ms`);
  assert.ok(result.final.budget.yieldedFrames > 0);
  assert.ok(result.final.static.savedSubmissions > 0);
  assert.deepEqual(result.final.roster.map(f => [f.id, f.type, f.requested]),
    result.initial.roster.map(f => [f.id, f.type, f.requested]));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, cpuThrottle: 6, inputToShotMs: result.inputs.map(input => input.eventToShotMs),
    savedStaticSubmissions: result.final.static.savedSubmissions, yieldedFrames: result.final.budget.yieldedFrames }));
} finally { await browser.close(); }
