import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';
import { EAST_BREAKOUT } from '../src/encirclement.js';

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
        spawnView() {
          setGameState('pause');
          camera.position.set(42, 3.2, 45);
          camera.lookAt(EAST_BREAKOUT.friendlySpawn.x, .5, EAST_BREAKOUT.friendlySpawn.z);
          for (const child of camera.children) child.visible = false;
          $('hud').hidden = true;
          renderer.render(scene, camera);
        },
        restartSpawnView() {
          resetSpawns();
          const base = spawnPoints.find(point => point.id === 'china-base');
          const view = baseSpawnViews.get(base.id);
          return { visible: view.visible, x: view.position.x, z: view.position.z, baseX: base.x, baseZ: base.z };
        },
        marker() {
          setGameState('pause');
          const index = objectives.findIndex(point => point.id === 'C');
          const marker = world.flags[index];
          camera.position.set(39, 3.2, -2);
          camera.lookAt(53, .2, 3);
          for (const child of camera.children) child.visible = false;
          $('hud').hidden = true;
          renderer.render(scene, camera);
          return { count: world.flags.length, marker: marker.userData.groundCaptureMarker,
            visible: marker.visible, radius: marker.geometry.parameters.outerRadius,
            rotation: marker.rotation.y, objectiveRadius: objectives[index].radius,
            otherMarkers: world.flags.slice(0, 2).map(flag => Boolean(flag.userData.groundCaptureMarker)) };
        },
        spawnPreference(playerX,playerZ) {
          setGameState('menu');beginMatch();
          const player=controlledSoldier(entities);
          for(const actor of allForces)if(actor!==player)actor.health=0;
          for(const formation of formations)formation.respawnEnabled=false;
          player.position.set(playerX,0,playerZ);
          camera.position.set(playerX,3,playerZ);
          camera.lookAt(playerX+20,3,playerZ+20);
          const before=new Set(enemies.map(actor=>actor.id));
          for(const point of objectives)Object.assign(point,{owner:'friendly',control:1,progress:1,enemyProgress:0,captured:true});
          updateObjectives(0);
          for(let index=0;index<30&&!enemies.some(actor=>!before.has(actor.id));index++) {
            time+=.35;restoreBreakoutForces();
          }
          return enemies.filter(actor=>!before.has(actor.id)).map(actor=>actor.spawnPosition);
        },
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
        restoreComposition() {
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
          updateObjectives(0);
          for(let index=0;encirclement.breakout?.reinforcing&&index<40;index++) {
            time+=.35;restoreBreakoutForces();
          }
          const base=spawnPoints.find(point=>point.id==='china-base');
          const baseView=baseSpawnViews.get(base.id);
          return {phase:encirclement.phase,reinforcing:encirclement.breakout?.reinforcing,
            restoration:encirclement.breakout?.restoration,
            base:{name:base.name,x:base.x,z:base.z},
            baseViewVisible:baseView?.visible,
            baseAvailable:deploymentSpawnChoices('infantry').some(point=>point.id===base.id),
            formations:formations.filter(unit=>unit.team==='enemy'&&unit.active)
              .map(({id,index,type})=>({id,index,type})),
            planes:[...entities.vehicles.values()].filter(vehicle=>vehicle.team==='enemy'&&vehicle.type==='plane').length};
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
          const thresholdState=state,objectiveStatus=encirclement.breakout.objectiveStatus;
          for(const actor of enemies.filter(actor=>actor.health>0&&encirclement.breakout.initialIds.includes(actor.id)&&
            !encirclement.breakout.escapedIds.includes(actor.id)))hurt(actor,100,source,'rifle','torso');
          updateObjectives(0);
          return {state,thresholdState,objectiveStatus,breakout:structuredClone(encirclement.breakout)};
        },
        lose() {
          this.prepare();
          for(const id of encirclement.breakout.initialIds.slice(0,4))recordEncirclementEscape(encirclement,id);
          updateObjectives(0);
          const thresholdState=state,objectiveStatus=encirclement.breakout.objectiveStatus;
          const source=captureAttackSource(entities,controlledSoldier(entities));
          for(const actor of enemies.filter(actor=>actor.health>0&&encirclement.breakout.initialIds.includes(actor.id)&&
            !encirclement.breakout.escapedIds.includes(actor.id)))hurt(actor,100,source,'rifle','torso');
          updateObjectives(0);
          return {state,thresholdState,objectiveStatus,breakout:structuredClone(encirclement.breakout),message:$('overlay-description').textContent};
        }
      };
    ` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203', { waitUntil: 'domcontentloaded' });
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' && document.getElementById('loading').hidden,
    null, { timeout: 180000 });
  if (process.env.EAST_GATE_MARKER_ONLY === '1') {
    const marker = await page.evaluate(() => eastBreakoutReview.marker());
    assert.deepEqual(marker, { count: 3, marker: 'C', visible: true, radius: marker.objectiveRadius,
      rotation: 0, objectiveRadius: 10, otherMarkers: [false, false] });
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'east-gate-marker.png') });
    }
    console.log(JSON.stringify({ passed: true, marker }));
  } else if (process.env.PHASE_TWO_SPAWN_ONLY === '1') {
    const far=await page.evaluate(() => eastBreakoutReview.spawnPreference(60,60));
    const near=await page.evaluate(() => eastBreakoutReview.spawnPreference(-52,-40));
    assert.equal(far.length,11,'a complete infantry squad must spawn');
    assert.ok(far.every(point=>point.x < -36 && point.z < -23),
      'the squad must appear northwest of A and north of the dry river');
    assert.equal(near.length,11,'fallback must spawn a complete infantry squad');
    assert.ok(near.every(point=>Math.hypot(point.x+52,point.z+40)>=28),
      'fallback squad must stay outside the player safety distance');
    console.log(JSON.stringify({passed:true,far,near}));
  } else if (process.env.PHASE_TWO_COMPOSITION_ONLY === '1') {
    const restoration = await page.evaluate(() => eastBreakoutReview.restoreComposition());
    await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 180000 });
    assert.equal(restoration.phase, 2);
    assert.equal(restoration.reinforcing, false);
    assert.deepEqual(restoration.base, { name: 'C点南侧集结地',
      x: EAST_BREAKOUT.friendlySpawn.x, z: EAST_BREAKOUT.friendlySpawn.z });
    assert.equal(restoration.baseViewVisible, false, 'the moved spawn keeps its function without its box model');
    assert.equal(restoration.baseAvailable, true, 'the moved spawn remains an infantry deployment choice');
    assert.equal(restoration.formations.filter(unit => unit.type === 'infantry').length, 8);
    assert.equal(restoration.formations.filter(unit => unit.type === 'tank').length, 1);
    assert.equal(restoration.formations.filter(unit => unit.type === 'plane').length, 1);
    assert.equal(restoration.planes, 3);
    if (process.env.ARTIFACT_DIR) {
      await page.evaluate(() => eastBreakoutReview.spawnView());
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'east-gate-spawn.png') });
      await writeFile(join(process.env.ARTIFACT_DIR, 'east-breakout.json'), JSON.stringify({ restoration, errors }, null, 2));
    }
    const restarted = await page.evaluate(() => eastBreakoutReview.restartSpawnView());
    assert.equal(restarted.visible, true);
    assert.equal(restarted.x, restarted.baseX);
    assert.equal(restarted.z, restarted.baseZ);
    console.log(JSON.stringify({ passed: true, phase: 2, infantrySquads: 8, tankSquads: 1, aircraft: restoration.planes, base: restoration.base }));
  } else {
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
    assert.equal(win.thresholdState,'playing');assert.equal(win.objectiveStatus,'achieved');
    assert.equal(lose.thresholdState,'playing');assert.equal(lose.objectiveStatus,'failed');
    assert.equal(win.state, 'victory'); assert.equal(win.breakout.killed, 8);
    assert.equal(lose.state, 'defeat'); assert.equal(lose.breakout.escapedIds.length, 4);
    if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'east-breakout.json'),
      JSON.stringify({ range, escape, win, lose, errors }, null, 2));
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({ errors, loading: await page.locator('#loading').textContent(),
    fatal: await page.locator('#fatal').textContent().catch(() => null) }));
  throw error;
} finally { await browser.close(); }
