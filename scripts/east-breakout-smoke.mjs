import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
try {
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.eastBreakoutReview = {
        range() {
          const actor=controlledSoldier(entities);
          dispatchControlCommand('equipTool');dispatchControlCommand('pressFire');
          time+=1.6;updateConstruction(1.6);
          document.dispatchEvent(new MouseEvent('mousemove',{movementY:100}));renderConstruction();
          const first=$('mortar-range-setting').textContent;
          document.dispatchEvent(new MouseEvent('mousemove',{movementY:-20}));renderConstruction();
          const second=$('mortar-range-setting').textContent;
          const visible=!$('mortar-objective-sight').hidden&&$('mortar-range-setting').getBoundingClientRect().width>0;
          dispatchControlCommand('equipRifle');return {first,second,visible};
        },
        prepare() {
          setGameState('menu');beginMatch();
          const player=controlledSoldier(entities);
          const survivors=enemies.filter(actor=>actor.health>0&&!actor.vehicleId).slice(0,9);
          const keep=new Set(survivors);
          for(const actor of allForces)if(actor!==player&&!keep.has(actor))actor.health=0;
          for(const formation of formations)formation.respawnEnabled=false;
          player.position.set(-80,0,40);
          for(const actor of survivors) {
            actor.target=null;actor.tactics.lastSeen=null;actor.tactics.cover=null;
            actor.position.set(36+actor.index%3*1.5,0,3+(actor.index%5-2)*1.5);
            actor.path=actor.pathGoal=null;resetAIRifleAim(actor.aiRifle,'fixture');
          }
          for(const point of objectives)Object.assign(point,{owner:'friendly',control:1,progress:1,enemyProgress:0,captured:true});
          advanceEncirclement(encirclement,objectives,formations,0);
          updateObjectives(0);
          for(const point of objectives)Object.assign(point,{owner:'enemy',control:-1,progress:0,enemyProgress:1,captured:false});
          return encirclement.breakout.strength;
        },
        escape() {
          let steps=0;
          for(;steps<1600&&!encirclement.breakout.escapedIds.length;steps++) {
            time+=.05;aiDecisions.beginFrame();
            world.doorSystem.update(.05,allForces.filter(actor=>actor.health>0).map(actor=>({
              x:actor.position.x,y:actor.position.y,z:actor.position.z,radius:.42})));
            updateWeaponSimulation(.05);updateAI(.05);
            for(const actor of allForces)if(actor.health>0&&actor.nativeMotion)advanceNraMotion(actor,.05);
            updateObjectives(.05);
          }
          updateHUD();
          camera.position.set(44,4,-3);camera.lookAt(58,3,3);
          for(const child of camera.children)child.visible=false;
          renderer.render(scene,camera);
          setGameState('pause');
          return {seconds:steps*.05,phase:encirclement.phase,breakout:structuredClone(encirclement.breakout),
            owners:objectives.map(point=>point.owner),grace:encirclement.enemyControlSeconds,
            task:$('objective-help').textContent,
            actors:enemies.filter(actor=>actor.health>0&&!actor.vehicleId).map(actor=>({
              id:actor.id,x:actor.position.x,z:actor.position.z,mode:actor.tactics.mode,pathReason:actor.tactics.pathReason}))};
        },
        win() {
          setGameState('playing');
          const source=captureAttackSource(entities,controlledSoldier(entities));
          for(const actor of enemies.filter(actor=>actor.health>0&&encirclement.breakout.initialIds.includes(actor.id))
            .slice(0,encirclement.breakout.requiredKills))hurt(actor,100,source,'rifle','torso');
          updateObjectives(0);
          return {state,breakout:structuredClone(encirclement.breakout)};
        },
        lose() {
          this.prepare();
          for(const id of encirclement.breakout.initialIds.slice(0,4))recordEncirclementEscape(encirclement,id);
          updateObjectives(0);
          return {state,breakout:structuredClone(encirclement.breakout),message:$('overlay-description').textContent};
        }
      };
    ` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203', { waitUntil: 'domcontentloaded' });
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const range = await page.evaluate(() => eastBreakoutReview.range());
  assert.deepEqual(range, { first: '50 m', second: '60 m', visible: true });
  assert.equal(await page.evaluate(() => eastBreakoutReview.prepare()), 9);
  const escape = await page.evaluate(() => eastBreakoutReview.escape());
  console.log(JSON.stringify({ range, escape }));
  assert.equal(escape.phase, 2);
  assert.equal(escape.breakout.strength, 9);
  assert.ok(escape.breakout.escapedIds.length > 0, 'survivors must physically pass the real C gate');
  assert.equal(escape.breakout.killed, 0, 'leaving the map never masquerades as a kill');
  assert.equal(escape.grace, 0);
  assert.ok(escape.owners.every(owner => owner === 'enemy'), 'phase two does not capture or recapture points');
  assert.match(escape.task, /东门/);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'east-gate.png') });
  }
  const win = await page.evaluate(() => eastBreakoutReview.win());
  const lose = await page.evaluate(() => eastBreakoutReview.lose());
  assert.equal(win.state, 'victory'); assert.equal(win.breakout.killed, 6);
  assert.equal(lose.state, 'defeat'); assert.equal(lose.breakout.escapedIds.length, 4);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'east-breakout.json'),
    JSON.stringify({ range, escape, win, lose, errors }, null, 2));
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({ errors, loading: await page.locator('#loading').textContent(),
    fatal: await page.locator('#fatal').textContent().catch(() => null) }));
  throw error;
} finally { await browser.close(); }
