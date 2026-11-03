import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {defaultPreferences,PREFERENCES_KEY} from '../src/player-preferences.js';

const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
page.setDefaultTimeout(180000);
try{
  const settings=defaultPreferences();settings.quality.preset='low';
  Object.keys(settings.quality.effects).forEach(key=>settings.quality.effects[key]=false);
  await page.addInitScript(({key,settings})=>localStorage.setItem(key,JSON.stringify({version:1,settings})),
    {key:PREFERENCES_KEY,settings});
  await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      window.feedbackReview={
        towerView(){
          setGameState('pause');$('hud').hidden=true;$('overlay').hidden=true;
          for(const child of camera.children)child.visible=false;
          camera.position.set(-40,1.65,16);camera.lookAt(-34,1.4,12.5);
          const door=world.doorSystem.doors.find(door=>door.id==='canal-south-granary-east-door');
          if(!door)throw Error('Missing retained A tower street entrance');
          if(Math.abs(door.targetAngle)<.01)world.doorSystem.interact(door,{x:door.x-.8,z:door.z});
          for(let frame=0;frame<60;frame++)world.doorSystem.update(1/60,[]);
          renderer.render(scene,camera);
          return{sealed:!world.doorSystem.doors.some(door=>door.id==='canal-south-granary-partition-door'),
            retained:door.state};
        },
        mobile(){
          setGameState('menu');beginMatch();
          const player=controlledSoldier(entities),crew=friendlyAI[0],gun=emplacements.get('dock-gun');
          const aa=emplacements.get('dock-aa');
          const aiAA=occupyEmplacement(aa,crew);
          for(const actor of friendlyForces)if(actor!==player)actor.position.set(0,0,60+actor.index);
          enemies=[];rebuildForces();
          const pose=emplacementPose(gun,0);player.position.set(pose.operator.x,0,pose.operator.z);
          dispatchControlCommand('interact');const mounted=player.emplacementId;
          gun.weapon.ammo=0;reloadEmplacement(gun,time);
          dispatchControlCommand('equipTool');
          const march=gun.position,start={x:gun.x,z:gun.z},weaponId=controlOwner(entities).weaponId;
          const timings=[];keys.add('KeyW');
          for(let frame=0;frame<100;frame++){
            time+=.05;const began=performance.now();updatePlayer(.05);timings.push(performance.now()-began);
          }
          keys.delete('KeyW');
          const moved=Math.hypot(gun.x-start.x,gun.z-start.z),shots=gun.shots;
          fireFixedWeapon(gun,player);
          const noMarchFire=gun.shots===shots;
          const collider=world.obstacles.find(box=>box.id===gun.id+':obstacle-0');
          const colliderMoved=Math.abs((collider.minX+collider.maxX)/2-gun.x)<1e-8;
          dispatchControlCommand('equipRifle');const returned=gun.position;
          advanceEmplacement(gun,0,time);
          const reloadPreserved=gun.weapon.reloadUntil>time&&gun.weapon.ammo===0;
          const sameWeapon=controlOwner(entities).weaponId===weaponId;
          releaseEmplacement(player);
          setGameState('pause');
          return{aiAA,mounted,march,returned,moved,noMarchFire,colliderMoved,reloadPreserved,sameWeapon,
            maximumMoveUpdate:Math.max(...timings),
            north:[...emplacements.values()].filter(point=>['dock-mg','dock-gun'].includes(point.id)).map(point=>({id:point.id,x:point.x,z:point.z,heading:point.heading}))};
        },
        armorFear(){
          setGameState('menu');beginMatch();
          const armor=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='tank'&&vehicle.team==='enemy');
          armor.position.set(-24,0,49);
          for(const seat of armor.seats){
            const crew=entities.soldiers.get(seat.occupantId);if(crew)crew.position.copy(armor.position);
          }
          vehicleRenderer.update(entities.vehicles.values(),time);
          const person=world.civilians.find(person=>person.userData.civilianId===0),data=person.userData;
          data.active=true;data.releaseAt=0;data.threatResponse=null;person.visible=true;person.position.set(-24,0,44);
          const before=person.position.distanceTo(armor.position);
          const original=enemies;
          enemies=enemies.filter(actor=>actor.vehicleId===armor.id);rebuildForces();
          for(let frame=0;frame<40;frame++){time+=.05;updateNanjingCivilians(.05);}
          const result={mode:data.escapeMode,threats:data.threatResponse?.threats,
            before,after:person.position.distanceTo(armor.position),position:person.position.toArray()};
          enemies=original;rebuildForces();setGameState('pause');return result;
        },
        restore(){
          setGameState('menu');beginMatch();
          const player=controlledSoldier(entities);
          player.position.set(-80,0,60);camera.position.set(-80,1.7,60);camera.lookAt(-90,1.7,60);
          for(const actor of allForces)if(actor.team==='friendly'&&actor!==player)actor.position.set(-85,0,70+actor.index*.1);
          const before=new Set(enemies.filter(actor=>actor.health>0).map(actor=>actor.id));
          for(const formation of formations)formation.respawnEnabled=false;
          for(const actor of enemies)if(!actor.vehicleId&&actor.index>2)actor.health=0;
          for(const point of objectives)Object.assign(point,{owner:'friendly',control:1,progress:1,enemyProgress:0,captured:true});
          updateObjectives(0);
          const durations=[];
          for(let frame=0;frame<500&&encirclement.breakout.reinforcing;frame++){
            time+=.05;const began=performance.now();updateObjectives(.05);durations.push(performance.now()-began);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          const newActors=enemies.filter(actor=>actor.health>0&&!before.has(actor.id));
          const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
          const visible=newActors.filter(actor=>frustum.intersectsSphere(new THREE.Sphere(actor.position.clone().add(new THREE.Vector3(0,1.2,0)),2))).map(actor=>actor.id);
          const ground=formations.filter(unit=>unit.team==='enemy'&&unit.type!=='plane').map(unit=>({
            id:unit.id,type:unit.type,living:unit.members.filter(actor=>actor.health>0).length}));
          const air=formations.filter(unit=>unit.team==='enemy'&&unit.type==='plane').map(unit=>unit.members.filter(actor=>actor.health>0&&actor.vehicleId).length);
          const goals=enemies.filter(actor=>actor.health>0&&!actor.vehicleId).map(actor=>breakoutDestination(actor));
          updateHUD();
          const countdown={title:$('objective-title').textContent,counts:$('objectives').textContent};
          const friend=friendlyAI.find(actor=>actor.health>0&&!actor.vehicleId);
          const enemy=enemies.find(actor=>actor.health>0&&!actor.vehicleId);
          const friendlyGoal=breakoutDestination(friend),enemyGoal=breakoutDestination(enemy);
          const assemblyStart=[{x:0,z:30},{x:20,z:30},{x:10,z:0},{x:20,z:0}].find(point=>
            !circleBlocked(point.x,point.z,.5,world.obstacles)&&navigate(point,friendlyGoal).length);
          if(!assemblyStart)throw Error('Missing physically valid approach position for friendly assembly fixture');
          friend.position.set(assemblyStart.x,0,assemblyStart.z);
          friend.path=friend.pathGoal=null;pathRequests.delete(friend.tactics.id);
          const friendlyBefore=friend.position.distanceTo(new THREE.Vector3(friendlyGoal.x,friendlyGoal.y,friendlyGoal.z));
          for(let frame=0;frame<100;frame++){
            time+=.05;aiDecisions.beginFrame();updateWeaponSimulation(.05);updateVehicles(.05);updateAI(.05);
            for(const actor of allForces)if(actor.health>0&&actor.nativeMotion)advanceNraMotion(actor,.05);
            updateObjectives(.05);controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          const assembly={stage:encirclement.breakout.stage,elapsed:encirclement.breakout.elapsed,
            friendlyBefore,friendlyAfter:friend.position.distanceTo(new THREE.Vector3(friendlyGoal.x,friendlyGoal.y,friendlyGoal.z)),
            enemyGoalX:enemyGoal.x,enemyGoalZ:enemyGoal.z,friendlyMode:friend.tactics.mode,
            pathReason:friend.tactics.pathReason,position:friend.position.toArray(),
            aircraftShots:[...entities.vehicles.values()].filter(vehicle=>vehicle.team==='enemy'&&vehicle.type==='plane')
              .reduce((sum,vehicle)=>sum+(vehicle.aiFlight.shots??0),0)};
          setGameState('pause');
          return{phase:encirclement.phase,winner:encirclement.winner,breakout:structuredClone(encirclement.breakout),
            ground,air,visible,newActors:newActors.length,maxRestoreUpdate:Math.max(...durations),
            goals:goals.slice(0,3),countdown,assembly};
        },
        eastAir(){
          setGameState('playing');
          const wait=Math.max(0,EAST_BREAKOUT.regroupSeconds-encirclement.breakout.elapsed);
          time+=wait;updateObjectives(wait);
          const player=controlledSoldier(entities);
          player.position.set(44,0,-12);
          for(const actor of friendlyForces)if(actor!==player)actor.position.set(42+actor.index%3*3,0,-12+Math.floor(actor.index/3)*2);
          const aircraft=[...entities.vehicles.values()].filter(vehicle=>vehicle.team==='enemy'&&vehicle.type==='plane'&&vehicle.health>0);
          const before=aircraft.map(vehicle=>vehicle.aiFlight.shots??0);
          for(let frame=0;frame<2400;frame++){
            time+=.05;updateWeaponSimulation(.05);updateVehicles(.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
            if(state!=='playing')setGameState('playing');
          }
          setGameState('pause');
          return aircraft.map((vehicle,index)=>({id:vehicle.id,health:vehicle.health,
            shots:(vehicle.aiFlight.shots??0)-before[index],phase:vehicle.aiFlight.phase,
            target:vehicle.aiFlight.targetId,position:vehicle.position.toArray()}));
        }
      };`});
  });
  const base=process.env.GAME_URL??'http://127.0.0.1:5203';
  let mobile;
  if(process.env.RESTORE_ONLY!=='1'){
  await page.goto(base+'/?campaign=nanjing');
  await page.waitForFunction(()=>window.__battle?.state==='menu');
  await page.locator('#deploy').click();
  await page.waitForFunction(()=>window.__battle?.state==='playing');
  mobile=await page.evaluate(()=>feedbackReview.mobile());
  console.log(JSON.stringify({mobile,errors}));
  assert.equal(mobile.aiAA,false);
  assert.equal(mobile.mounted,'dock-gun');assert.equal(mobile.march,'march');assert.equal(mobile.returned,'gunner');
  assert.ok(mobile.moved>3&&mobile.moved<5);
  assert.ok(mobile.noMarchFire&&mobile.colliderMoved&&mobile.reloadPreserved&&mobile.sameWeapon);
  const fear=await page.evaluate(()=>feedbackReview.armorFear());
  console.log(JSON.stringify({fear}));
  assert.ok(fear.threats.some(threat=>threat.vehicleId));
  assert.ok(fear.after>fear.before+.5||fear.mode==='cower');
  }
  await page.goto(base);
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(()=>window.__battle?.state==='playing');
  const restore=await page.evaluate(()=>feedbackReview.restore());
  console.log(JSON.stringify({restore,errors}));
  assert.equal(restore.phase,2);assert.equal(restore.winner,null);assert.equal(restore.breakout.reinforcing,false);
  assert.deepEqual(restore.ground.filter(unit=>unit.type==='infantry').map(unit=>unit.living),[11,11,11,11,11,11]);
  assert.equal(restore.ground.filter(unit=>unit.type==='tank').length,1);
  assert.deepEqual(restore.air,[1,1,1]);assert.deepEqual(restore.visible,[]);
  assert.equal(restore.breakout.strength,70);
  assert.match(restore.countdown.title,/20秒/);
  assert.match(restore.countdown.counts,/地面编制 70人/);
  assert.ok(restore.countdown.counts.includes('已歼 0/47'));
  assert.equal(restore.assembly.stage,'regroup');
  assert.equal(restore.assembly.aircraftShots,0,'the defense countdown must not start enemy strafing early');
  assert.ok(restore.assembly.friendlyAfter<restore.assembly.friendlyBefore);
  assert.ok(restore.assembly.enemyGoalX<52,'during the countdown enemies assemble, not charge the gate');
  const air=await page.evaluate(()=>feedbackReview.eastAir());
  console.log(JSON.stringify({eastAir:air}));
  assert.equal(air.length,3);
  assert.ok(air.reduce((count,plane)=>count+plane.shots,0)>0,'air support must actually fire near the east gate');
  if(process.env.ARTIFACT_DIR){
    const tower=await page.evaluate(()=>feedbackReview.towerView());
    assert.ok(tower.sealed);assert.equal(tower.retained,'open');
    await mkdir(process.env.ARTIFACT_DIR,{recursive:true});
    await page.screenshot({path:join(process.env.ARTIFACT_DIR,'a-tower-sealed-interior.png')});
  }
  assert.deepEqual(errors,[]);
  if(process.env.FEEDBACK_RESULT)await writeFile(process.env.FEEDBACK_RESULT,JSON.stringify({mobile,restore,air,errors},null,2));
}finally{await browser.close();}
