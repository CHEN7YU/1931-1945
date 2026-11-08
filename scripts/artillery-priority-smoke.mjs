import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
import {chiHaMuzzle} from './chi-ha.js';
window.__artilleryPriorityFixture=()=>{
  showOverlay('pause');
  const point=[...emplacements.values()].find(point=>point.profile==='bofors75'&&point.team==='friendly'&&point.health>0);
  const tank=[...entities.vehicles.values()].find(vehicle=>vehicle.variant===CHI_HA.id&&vehicle.health>0);
  const decoy=friendlyForces.find(actor=>actor.health>0&&!actor.vehicleId&&!actor.emplacementId&&actor.role==='rifleman');
  if(!point||!tank||!decoy)throw new Error('Actual live gun, tank and rifleman are required');
  if(point.operatorId)releaseEmplacement(entities.soldiers.get(point.operatorId),false);
  const target=new THREE.Vector3(point.x,(point.altitude??world.groundHeight(point.x,point.z))+.95,point.z);
  let chosen=false;
  for(const radius of [25,35,45])for(let angle=0;angle<Math.PI*2&&!chosen;angle+=Math.PI/12){
    const x=point.x+Math.sin(angle)*radius,z=point.z+Math.cos(angle)*radius;
    if(circleBlocked(x,z,2.2,world.obstacles)||Math.abs(world.walkHeight(x,z,0))>.1)continue;
    if([...emplacements.values()].some(other=>other!==point&&other.profile==='bofors75'&&other.health>0&&
      Math.hypot(x-other.x,z-other.z)<radius))continue;
    tank.position.set(x,world.groundHeight(x,z),z);
    tank.heading=tank.turretYaw=Math.atan2(x-point.x,z-point.z);
    tank.turretPitch=Math.atan2(target.y-(tank.position.y+1.3),radius);
    const muzzle=chiHaMuzzle(tank);
    if(!hasLine(new THREE.Vector3(muzzle.x,muzzle.y,muzzle.z),target,CHI_HA.range,tank.id,point.id))continue;
    if(enemies.some(actor=>actor.health>0&&!actor.vehicleId&&
      (actor.position.distanceTo(target)<CHI_HA.blastRadius+1||
        pointSegmentDistance(actor.position,muzzle,target).distance<1.2)))continue;
    const forward=target.clone().sub(tank.position).setY(0).normalize();
    const right=new THREE.Vector3(-forward.z,0,forward.x);
    decoy.position.copy(tank.position).addScaledVector(forward,12).addScaledVector(right,9);
    decoy.position.y=world.groundHeight(decoy.position.x,decoy.position.z);
    if(decoy.nativeMotion)decoy.nativeMotion.position={x:decoy.position.x,z:decoy.position.z};
    chosen=true;
  }
  if(!chosen)throw new Error('No clear physical tank-to-gun approach in the actual Nanjing map');
  for(const seat of tank.seats){
    const actor=entities.soldiers.get(seat.occupantId);if(actor)actor.position.copy(tank.position);
  }
  vehicleRenderer.update(entities.vehicles.values(),time);
  const healthBefore=point.health,ammoBefore=tank.weapon.ammo,shotsBefore=tank.ai?.shots??0;
  const selections=[];
  for(let step=0;step<500&&point.health===healthBefore;step++){
    time+=.05;updateJapaneseArmor(tank,.05);
    selections.push(tank.ai?.targetId);
    presentCombatEvents();controlEvents.drain(()=>{});
  }
  if(point.health===healthBefore)throw new Error('Tank did not physically damage the artillery position');
  const result={tankId:tank.id,gunId:point.id,decoyId:decoy.id,healthBefore,healthAfter:point.health,
    ammoBefore,ammoAfter:tank.weapon.ammo,shots:tank.ai.shots-shotsBefore,
    selections:[...new Set(selections)],damage:point.lastDamage};
  camera.position.set(point.x+8,(point.altitude??0)+5,point.z+8);
  camera.lookAt(new THREE.Vector3(point.x,(point.altitude??0)+1,point.z));camera.updateMatrixWorld(true);
  $('overlay').hidden=true;if(weapon)weapon.visible=false;
  return result;
};` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5339/');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  url.searchParams.set('campaign', 'nanjing');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const result = await page.evaluate(() => __artilleryPriorityFixture());
  await page.screenshot({ path: join(directory, 'tank-artillery-target.png') });
  await writeFile(join(directory, 'artillery-priority.json'), JSON.stringify({ result, errors,
    limitation: 'Actual existing tank, live gun, real AI selection/ammunition and physical ray/blast damage; positions and isolated simulation stepping are controlled fixture setup, not natural-play difficulty or FPS.' }, null, 2));
  assert.ok(result.selections.includes(`emplacement:${result.gunId}`));
  assert.ok(result.healthAfter < result.healthBefore);
  assert.equal(result.damage.source.weaponClass, 'tank');
  assert.ok(result.shots > 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
