import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'sihang-duties');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    window.dutyReview={
      snapshot(){
        const members=sihangCombat.snapshot.members;
        const nearest=actor=>members.length?Math.min(...members.map(member=>
          Math.hypot(actor.position.x-member.x,actor.position.z-member.z))):null;
        return {state,time,outcome:sihangCampaign.outcome,combat:sihangCombat.snapshot,coverActive:Boolean(sihangSupportContext),
          lights:world.concessionLighting,
          friendly:friendlyForces.map(actor=>({id:actor.id,unit:actor.unitId,playerUnit:actor.playerUnit,
            health:actor.health,position:actor.position.toArray(),spawn:actor.spawnPosition,
            duty:actor.tactics.sihangDuty,post:actor.tactics.sihangPost,mode:actor.tactics.mode,
            heading:actor.heading,target:actor.target?.id,aim:actor.aiRifle,
            firingPose:actor.firingPose,blocked:actor.weaponBlocked,pathReason:actor.tactics.pathReason,
            eligible:actor.tactics.eligiblePoses,speed:actor.locomotion.speed,
            preferredStair:actor.tactics.preferredStair,
            path:actor.path?.slice(0,2),
            shots:actor.rifle.shots,station:actor.emplacementId})),
          sappers:enemies.filter(actor=>actor.formation.sihangDemolition).map(actor=>({
            id:actor.id,health:actor.health,hasFirearm:actor.hasFirearm,rifleId:actor.rifle.id??null,
            ammo:actor.rifle.ammo,grenades:actor.grenades.ammo,packs:actor.grenades.packs,
            shield:actor.sihangShield,mode:actor.tactics.mode,position:actor.position.toArray()})),
          covering:enemies.filter(actor=>!actor.vehicleId&&!actor.formation.sihangDemolition&&actor.health>0)
            .map(actor=>({id:actor.id,mode:actor.tactics.mode,nearest:nearest(actor),shots:actor.rifle.shots})),
          flag:{national:world.landmarks.roofFlag.getObjectByName('sihang-roc-cloth').userData.flag.nation,
            positions:Array.from(world.landmarks.roofFlag.getObjectByName('sihang-roc-cloth').geometry.attributes.position.array)}};
      },
      view(kind){
        showOverlay('pause');missionBriefing.hide();$('overlay').hidden=true;if(weapon)weapon.visible=false;
        if(kind==='south'||kind==='south-night'){
          if(kind==='south-night'){
            scene.userData.timeOfDay='night';sun.intensity=.05;hemisphere.intensity=.12;
            scene.environmentIntensity=.12;scene.backgroundIntensity=.035;scene.fog.color.setHex(0x1d2633);
            world.setNightLighting(true);
          }
          camera.position.set(-4,30,-12);camera.lookAt(12,5,64);
        }
        else if(kind==='west'){camera.position.set(-64,17,-24);camera.lookAt(-36,13,-25);}
        else if(kind==='stairs'){camera.position.set(6,11,-37);camera.lookAt(-2,12,-27);}
        else if(kind==='flag'){
          const center=new THREE.Box3().setFromObject(world.landmarks.roofFlag.getObjectByName('sihang-roc-cloth'))
            .getCenter(new THREE.Vector3());
          camera.position.copy(center).add(new THREE.Vector3(3.2,1.3,4));camera.lookAt(center);
        }
        camera.updateMatrixWorld(true);
      }
    };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5334/');
  url.searchParams.set('campaign', 'sihang');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.dutyReview && __battle.state === 'playing', null, { timeout: 180000 });
  const frames = [];
  for (let index = 0; index < 70; index++) {
    const frame = await page.evaluate(() => dutyReview.snapshot());
    frames.push(frame);
    await writeFile(join(directory, 'natural-duties.json'), JSON.stringify({ frames, errors }, null, 2));
    if (frame.time >= 28 || frame.outcome || !['playing', 'pause'].includes(frame.state)) break;
    await page.waitForTimeout(1000);
  }
  const last = frames.at(-1), active = last.friendly.filter(actor => !actor.playerUnit);
  if (last.state === 'playing') await page.keyboard.press('Escape');
  await setQualityPreset(page, 'high');
  for (const kind of ['south', 'west', 'stairs', 'flag', 'south-night']) {
    await page.evaluate(kind => dutyReview.view(kind), kind); await page.waitForTimeout(200);
    await page.screenshot({ path: join(directory, `${kind}.png`) });
  }
  const moved = active.filter(actor => actor.shots > 0 || actor.station ||
    Math.hypot(actor.position[0] - actor.spawn.x, actor.position[2] - actor.spawn.z) > 1);
  assert.ok(moved.length >= Math.min(20, active.length), 'independent defenders must actually move or fight');
  const groundMaximum = Math.max(...frames.map(frame => frame.friendly.filter(actor =>
    actor.duty === 'ground-intercept' && actor.health > 0 && actor.position[1] < 2.4).length));
  assert.ok(groundMaximum >= 6, 'a majority of the interception squad must physically reach the first floor');
  const mannedMaximum = Math.max(...frames.map(frame => frame.friendly.filter(actor =>
    actor.health > 0 && actor.station?.startsWith('sihang-north-gate')).length));
  assert.ok(mannedMaximum >= 1, 'a real north-gate MG must have an active crew, not only a scenery model');
  assert.ok(frames.some(frame => frame.friendly.some(actor => actor.duty === 'wall-fire' && actor.shots > 0)),
    'wall guards must really fire, not only acquire a role label');
  for (const frame of frames) {
    for (const sapper of frame.sappers) {
      assert.equal(sapper.hasFirearm, false); assert.equal(sapper.rifleId, null);
      assert.equal(sapper.ammo, 0); assert.equal(sapper.grenades, 0); assert.equal(sapper.packs, 0);
    }
    for (const actor of frame.covering.filter(actor => frame.coverActive &&
      actor.mode === 'sihang-cover-fire' || actor.mode === 'operate-grenade-discharger'))
      assert.ok(actor.nearest >= 19.95, JSON.stringify(actor));
  }
  assert.notDeepEqual(frames[0].flag.positions, last.flag.positions, 'cloth must actually deform over game time');
  assert.equal(last.flag.national, 'ROC');
  assert.equal(last.lights.night, false); assert.equal(last.lights.windowIntensity, 0);
  assert.equal(last.lights.redIntensity, 0); assert.equal(last.lights.greenIntensity, 0);
  assert.equal(await page.evaluate(() => dutyReview.snapshot().lights.night), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, natural: true, simulatedSeconds: last.time,
    movingOrFighting: moved.length, groundGateDefenders: groundMaximum,
    wallShots: last.friendly.filter(actor => actor.duty === 'wall-fire').reduce((sum, actor) => sum + actor.shots, 0) }));
} finally { await browser.close(); }
