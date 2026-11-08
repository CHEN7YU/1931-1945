import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
const errors = [];
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.__engineerFixturePlace=()=>{
  const actor=controlledSoldier(entities);
  if(!actor?.engineer)throw new Error('Fixture requires the actually controlled engineer');
  for(const other of allies)if(other!==actor){
    other.order='hold';other.personalHold=true;other.orderPoint={...other.position};
  }
  window.__engineerFixtureId=actor.id;
  controlPose.yaw=actor.heading=0;
  for(const z of [90,70,-90])for(const x of [-90,-70,-50,50,70,90]){
    if(circleBlocked(x,z,.5,world.obstacles)||Math.abs(world.walkHeight(x,z,0))>.1)continue;
    const candidate=engineerPlacement({x,y:0,z},0);
    if(engineerPlacementReason(actor,candidate))continue;
    actor.position.set(x,0,z);stopLocomotion(actor.locomotion);
    if(actor.nativeMotion)actor.nativeMotion.position={x,z};
    updateCamera(0);return true;
  }
  throw new Error('No actual clear support surface for the controlled fixture');
};
window.__engineerObserve=()=>{
 const actor=entities.soldiers.get(window.__engineerFixtureId);
 return {state,time,controlledId:entities.control.soldierId,role:controlledSoldier(entities)?.role,
   health:actor?.health,materials:actor?{...actor.engineer.materials}:null,selected:actor?.engineer.selected,
   progress:actor?.engineer.construction.progress,rifle:actor?{...actor.rifle}:null,
   points:[...emplacements.values()].filter(point=>point.builderId===actor?.id).map(point=>({
     id:point.id,profile:point.profile,team:point.team,health:point.health,x:point.x,z:point.z,
     ammo:point.weapon.ammo,shots:point.shots,operatorId:point.operatorId,ownerId:point.weapon.ownerId})),
   spawnIds:spawnPoints.map(point=>point.id)};
};` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5339/');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('seed', '1938');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => Boolean(window.__battle) || !document.getElementById('fatal').hidden,
    null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').innerText());
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await page.locator('#squad-choices [data-type="infantry"]').click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.keyboard.press('KeyY');
  await page.evaluate(() => __engineerFixturePlace());
  const snapshot = () => page.evaluate(() => __engineerObserve());
  const initial = await snapshot(); assert.equal(initial.role, 'engineer');
  const builds = [];
  for (const profile of ['maxim24', 'bofors75']) {
    await page.keyboard.press('Digit2');
    if ((await snapshot()).selected !== profile) await page.keyboard.press('KeyR');
    await page.evaluate(() => __engineerFixturePlace());
    await page.waitForTimeout(300);
    const before = await snapshot();
    await page.mouse.down();
    await page.waitForFunction(start => __engineerObserve().time >= start + 19, before.time, { timeout: 90000 });
    const unfinished = await snapshot();
    assert.equal(unfinished.points.length, builds.length, 'a position must not exist before its twentieth second');
    await page.waitForFunction(count => __engineerObserve().points.length > count, builds.length, { timeout: 30000 });
    await page.mouse.up();
    const complete = await snapshot();
    assert.ok(complete.time - before.time >= 19.95);
    assert.equal(complete.materials[profile], 0);
    assert.equal(complete.rifle.ammo, initial.rifle.ammo);
    builds.push({ profile, before, unfinished, complete });
    await page.screenshot({ path: join(directory, `${profile}-built.png`) });
    await page.keyboard.press('Digit1');
  }
  const complete = await snapshot();
  assert.deepEqual(complete.materials, { maxim24: 0, bofors75: 0 });
  assert.deepEqual(complete.spawnIds, initial.spawnIds, 'engineer builds must never create spawn points');
  await page.keyboard.press('KeyY');
  for (let index = 0; index < 20 && (await snapshot()).controlledId !== initial.controlledId; index++)
    await page.keyboard.press('KeyY');
  assert.equal((await snapshot()).controlledId, initial.controlledId);
  assert.deepEqual((await snapshot()).materials, complete.materials);
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyR');
  await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up();
  assert.equal((await snapshot()).points.length, 2, 'switching owner/tool cannot mint a third kit');
  await writeFile(join(directory, 'engineer-builds.json'), JSON.stringify({ initial, builds, final: await snapshot(), errors,
    limitation: 'Real Y/1/2/R and held-mouse builds in the explicit infantry equipment fixture. Positions and hold orders are test setup, not normal gameplay or performance.' }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, builds: builds.map(build => ({
    profile: build.profile, seconds: build.complete.time - build.before.time })), noNewSpawns: true }));
} catch (error) {
  const diagnostics = { message: error.message, errors,
    body: page ? (await page.locator('body').innerText()).slice(-8000) : null };
  await writeFile(join(directory, 'failure.json'), JSON.stringify(diagnostics, null, 2));
  if (page) await page.screenshot({ path: join(directory, 'failure.png') });
  console.error(JSON.stringify(diagnostics));
  throw error;
} finally { await browser.close(); }
