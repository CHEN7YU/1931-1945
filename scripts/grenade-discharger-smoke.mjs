import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research\\japanese-support');
const campaigns = (process.env.SUPPORT_CAMPAIGNS ?? 'sihang,nanjing,taierzhuang-fort').split(',');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const campaign of campaigns) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const settings = defaultPreferences(); settings.quality.preset = 'low';
    await page.addInitScript(({ key, settings }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings });
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
import {isNativeOfficer as __supportOfficer} from '/src/officer-appearance.js';
const __supportOriginalBegin=beginMatch;
beginMatch=function(...args){
  __supportOriginalBegin(...args);
  window.__supportInitial=window.__battle.japaneseSupport;
};
window.__supportSetup=()=>{
  if(!sihangCampaignMode)return null;
  const actor=allies[current],point=emplacements.get('sihang-roof-aa');
  actor.position.set(point.x,point.altitude,point.z);
  actor.traversal.kind='grounded';
  if(!occupyEmplacement(point,actor)||point.operatorId!==actor.id)
    throw new Error('Native rooftop emplacement interaction failed');
  return {fixture:'Player positioned at the actual rooftop AA; real occupation and unchanged enemies',
    actor:actor.id,emplacement:point.id};
};
window.__supportScreenshot=()=>{
  const actor=enemies.find(actor=>actor.discharger?.presentationActive&&actor.health>0);
  if(!actor)return false;
  showOverlay('pause');missionBriefing.hide();$('overlay').hidden=true;if(weapon)weapon.visible=false;
  camera.position.copy(actor.position).add(new THREE.Vector3(3.2,2.4,3.8));
  camera.lookAt(actor.position.clone().add(new THREE.Vector3(0,.6,0)));
  camera.updateMatrixWorld(true);return actor.id;
};
window.__supportOfficerScreenshot=team=>{
  const actor=allForces.find(actor=>actor.team===team&&actor.health>0&&!actor.vehicleId&&__supportOfficer(actor));
  if(!actor)throw new Error('No living infantry officer for native screenshot');
  showOverlay('pause');missionBriefing.hide();$('overlay').hidden=true;if(weapon)weapon.visible=false;
  const forward=new THREE.Vector3(-Math.sin(actor.heading),0,-Math.cos(actor.heading));
  const side=new THREE.Vector3(-forward.z,0,forward.x);
  camera.position.copy(actor.position).addScaledVector(forward,2.8).addScaledVector(side,.8);
  camera.position.y+=1.35;camera.lookAt(actor.position.clone().add(new THREE.Vector3(0,1,0)));
  camera.updateMatrixWorld(true);
  return {id:actor.id,index:actor.index,team,formation:actor.formation.id};
};` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5183/');
    url.searchParams.set('campaign', campaign);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (await page.locator('#confirm-campaign').isVisible()) await page.locator('#confirm-campaign').click();
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__supportInitial && window.__battle?.state === 'playing',
      null, { timeout: 180000 });
    const initial = await page.evaluate(() => window.__supportInitial);
    const setup = await page.evaluate(() => window.__supportSetup());
    await writeFile(join(directory, `${campaign}-initial.json`), JSON.stringify({ initial, setup }, null, 2));
    for (const squad of initial.squads) {
      assert.equal(squad.dischargers, squad.demolition ? 0 : 2);
      assert.equal(squad.machineGunners, squad.demolition ? 0 : 2);
    }
    await page.waitForFunction(() => window.__battle.japaneseSupport.activeShells.length > 0,
      null, { timeout: 120000 });
    const flight = await page.evaluate(() => window.__battle.japaneseSupport);
    assert.ok(flight.activeShells.every(shell => shell.source.weaponClass === 'grenade-discharger'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__battle.state === 'pause');
    const paused = await page.evaluate(() => ({ time: window.__battle.time,
      shells: window.__battle.japaneseSupport.activeShells }));
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => ({ time: window.__battle.time,
      shells: window.__battle.japaneseSupport.activeShells })), paused);
    await page.locator('#resume').click();
    await page.waitForFunction(() => window.__battle.state === 'playing');
    await page.waitForFunction(() => window.__battle.projectileImpacts.some(event =>
      event.source.weaponClass === 'grenade-discharger'), null, { timeout: 30000 });
    const impact = await page.evaluate(() => window.__battle.projectileImpacts.find(event =>
      event.source.weaponClass === 'grenade-discharger'));
    assert.ok(impact.damage > 0); assert.ok(impact.radius > 0);
    const view = await page.evaluate(() => window.__supportScreenshot());
    await setQualityPreset(page, 'high');
    if (view) {
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(directory, `${campaign}-tube-operator.png`) });
    }
    const officers = [];
    for (const team of ['friendly', 'enemy']) {
      officers.push(await page.evaluate(team => window.__supportOfficerScreenshot(team), team));
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(directory, `${campaign}-${team}-officer.png`) });
    }
    assert.deepEqual(errors, []);
    const result = { campaign, initial, setup, flight, paused, impact, screenshotActor: view, officers, errors,
      limitation: 'Natural AI fire; camera only moved after the real flight and collision/impact checks.' };
    await writeFile(join(directory, `${campaign}-support.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ campaign, passed: true, squads: initial.squads.length,
      weaponId: impact.source.weaponId, collided: impact.collided, screenshotActor: view }));
    await page.close();
  }
} finally {
  await browser.close();
}
