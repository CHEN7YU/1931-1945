import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5336/');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Local profiling must not upload player reports');
url.searchParams.set('campaign', process.env.PERFORMANCE_MAP ?? 'nanjing');
const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/api/performance', route => route.fulfill({ status: 201,
    json: { id: route.request().postDataJSON().id, saved: true } }));
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  await page.addInitScript(({ key, settings }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings }));
    window.playabilityFrames = [];
    let previous = null;
    function frame(now) {
      const state = window.playabilityState?.();
      if (state === 'playing' || state === 'dead') {
        if (previous !== null) window.playabilityFrames.push({ ms: now - previous, state });
        previous = now;
      } else previous = null;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.playabilityState=()=>state;
window.playabilityAircraftBench=()=>{
  const original=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='plane'&&vehicle.team==='enemy'&&vehicle.health>0);
  if(!original)throw new Error('No actual live aircraft for sweep comparison');
  const captured=JSON.parse(JSON.stringify(original)),blocks=[];
  const context={targets:[],canFire:false,visible:()=>false,obstacles:world.obstacles,groundHeight:world.groundHeight};
  const oldVehicle=JSON.parse(JSON.stringify(captured)),newVehicle=JSON.parse(JSON.stringify(captured));
  advanceAircraftAI(oldVehicle,.05,time,context);
  advanceAircraftAI(newVehicle,.05,time,{...context,collisionLookup:aircraftCollision});
  if(JSON.stringify(oldVehicle)!==JSON.stringify(newVehicle))throw new Error('Actual world indexed sweep differs from full scan');
  for(const indexed of [false,true,true,false]){
    const copies=Array.from({length:80},()=>JSON.parse(JSON.stringify(captured)));
    const input=indexed?{...context,collisionLookup:aircraftCollision}:context;
    const started=performance.now();
    for(const vehicle of copies)advanceAircraftAI(vehicle,.05,time,input);
    blocks.push({indexed,milliseconds:performance.now()-started});
  }
  return {obstacles:world.obstacles.length,blocks,equivalent:true,
    limitation:'Same live world and captured aircraft; local CPU comparison, not whole-match FPS.'};
};
` });
  });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.waitForTimeout(10000);
  const aircraftSweeps = await page.evaluate(() => window.playabilityAircraftBench());
  const snapshot = () => page.evaluate(() => ({
    state: __battle.state, time: __battle.time, army: __battle.army,
    quality: __battle.automaticQuality, performance: __battle.performance,
  }));
  const initial = await snapshot();
  await page.evaluate(() => { window.playabilityFrames = []; });
  await page.waitForTimeout(Number(process.env.PLAYABILITY_SECONDS ?? 30) * 1000);
  const frames = await page.evaluate(() => window.playabilityFrames), final = await snapshot();
  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.start');
  await page.waitForTimeout(10000);
  const { profile } = await client.send('Profiler.stop');
  const ordered = frames.map(frame => frame.ms).sort((a, b) => a - b);
  const percent = p => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))];
  const sampleMs = (profile.endTime - profile.startTime) / 1000 / profile.samples.length;
  const self = profile.nodes.filter(node => node.hitCount).map(node => ({
    name: node.callFrame.functionName, url: node.callFrame.url,
    line: node.callFrame.lineNumber + 1, ms: node.hitCount * sampleMs,
  })).sort((a, b) => b.ms - a.ms).slice(0, 35);
  const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    map: url.searchParams.get('campaign'), initial, final, frames: frames.length,
    frameStates: { playing: frames.filter(frame => frame.state === 'playing').length,
      redeployment: frames.filter(frame => frame.state === 'dead').length },
    frameMs: { p50: percent(.5), p95: percent(.95), p99: percent(.99), over100: frames.filter(frame => frame.ms > 100).length },
    aircraftSweeps, self, errors, limitations: 'Headless developer PC, unchanged population, ordinary inputs; redeployment-screen frames are counted separately. CPU profile is a separate window; not an affected-device or whole-match acceptance.' };
  await writeFile(join(directory, 'profile.json'), JSON.stringify(profile));
  await writeFile(join(directory, 'playability.json'), JSON.stringify(result, null, 2));
  await page.screenshot({ path: join(directory, 'battle.png') });
  assert.ok(frames.length > 20); assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
