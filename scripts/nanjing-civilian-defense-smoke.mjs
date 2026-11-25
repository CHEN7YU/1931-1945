import { setQualityPreset, deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

if (process.argv.includes('--campaign-behavior-only')) {
  process.env.NANJING_CAMPAIGN_BEHAVIOR_ONLY = '1';
  if (!process.env.GAME_CHARACTER) process.env.GAME_CHARACTER = 'procedural';
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(120000);
try {
  const preferences=defaultPreferences();
  preferences.quality.preset='low';
  for(const effect of Object.keys(preferences.quality.effects))preferences.quality.effects[effect]=false;
  await page.addInitScript(({key,settings})=>localStorage.setItem(key,
    JSON.stringify({version:1,settings})),{key:PREFERENCES_KEY,settings:preferences});
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.civilianDefenseReview = {
        resume() { $('hud').hidden=false;setGameState('playing'); },
        openingAssault() {
          setGameState('menu');beginMatch();
          const infantry=formations.filter(unit=>unit.team==='enemy'&&unit.type==='infantry');
          const aircraft=formations.find(unit=>unit.team==='enemy'&&unit.type==='plane');
          const armor=formations.find(unit=>unit.team==='enemy'&&unit.variant===CHI_HA.id);
          nanjingCampaign.civiliansCrossedRiver=60;
          advanceNanjingCampaign(nanjingCampaign,19.99);updateNanjingMission(0);
          const held={released:nanjingCampaign.openingAssaultReleased,
            squads:infantry.filter(unit=>unit.members.length).length,
            vehicles:[...entities.vehicles.values()].filter(vehicle=>vehicle.team==='enemy').length};
          nanjingCampaign.civiliansCrossedRiver=0;
          advanceNanjingCampaign(nanjingCampaign,.01);updateNanjingMission(0);
          return {held,released:nanjingCampaign.openingAssaultReleased,
            squads:infantry.filter(unit=>unit.members.length===11).length,
            aircraft:aircraft.members.length,armor:armor.members.length,
            south:infantry.map(unit=>unit.members[0]?.spawnPosition.z)};
        },
        async restartCrossing() {
          const ready=()=>new Promise((resolve,reject)=>{
            let frames=0;
            const check=()=>{
              if(!battlePreparing)resolve();
              else if(++frames>2400)reject(Error('Battle preparation did not finish'));
              else requestAnimationFrame(check);
            };
            check();
          });
          await ready();
          setGameState('menu');beginMatch();
          await ready();
          const opening=world.civilians.filter(civilian=>civilian.userData.openingWave);
          for(const civilian of opening.slice(0,54)) {
            civilian.position.z=37.9;
            recordNanjingCivilianRiverCrossing(nanjingCampaign,civilian);
          }
          setGameState('menu');beginMatch();
          await ready();
          const reset=opening.filter(civilian=>civilian.userData.crossedRiver).length;
          for(const civilian of world.civilians) {
            civilian.visible=false;
            civilian.userData.active=false;
            civilian.userData.releaseAt=Infinity;
          }
          const infantry=formations.filter(unit=>unit.team==='enemy'&&unit.type==='infantry');
          const progress=[];
          for(const civilian of opening.slice(0,54)) {
            const data=civilian.userData;
            civilian.position.set(-24,0,38.01);civilian.visible=true;
            data.active=true;data.route=[{x:-24,z:37}];data.waypoint=0;
            updateNanjingCivilians(.05);updateNanjingMission(0);
            progress.push(nanjingCampaign.civiliansCrossedRiver);
            civilian.visible=false;data.active=false;data.releaseAt=Infinity;
          }
          const beforeDelay=nanjingCampaign.openingAssaultReleased;
          advanceNanjingCampaign(nanjingCampaign,20);updateNanjingMission(0);
          return {reset,progress,beforeDelay,released:nanjingCampaign.openingAssaultReleased,
            squads:infantry.filter(unit=>unit.members.length===11).length};
        },
        releaseAssault() {
          advanceNanjingCampaign(nanjingCampaign,Math.max(0,20-nanjingCampaign.stageElapsed));
          updateNanjingMission(0);
        },
        fieldReload() {
          setGameState('menu');beginMatch();
          const actor=controlledSoldier(entities),point=emplacements.get('bridge-gun');
          const pose=emplacementPose(point,0);
          actor.position.set(pose.operator.x,0,pose.operator.z);
          if(!enterEmplacement(actor))throw Error('Cannot mount the bridge mountain gun');
          fireFixedWeapon(point,actor);
          const sample=()=>{
            renderWeaponReload();
            return {hidden:$('tank-reload').hidden,text:$('tank-reload-time').textContent,
              value:Number($('tank-reload').getAttribute('aria-valuenow'))};
          };
          const start=sample();setGameState('pause');
          advanceEmplacement(point,0,time);const paused=sample();
          setGameState('playing');time+=2.75;advanceEmplacement(point,2.75,time);
          const half=sample();releaseEmplacement(actor);const left=sample();
          enterEmplacement(actor);const resumed=sample();
          time+=2.75;advanceEmplacement(point,2.75,time);const complete=sample();
          releaseEmplacement(actor);
          return {start,paused,half,left,resumed,complete};
        },
        airframeBurst() {
          setGameState('menu');beginMatch();
          this.releaseAssault();
          const crew=controlledSoldier(entities),point=emplacements.get('gate-aa'),floor=point.altitude;
          const pose=emplacementPose(point,floor);
          crew.position.set(pose.operator.x,floor,pose.operator.z);occupyEmplacement(point,crew);
          const planes=[...entities.vehicles.values()].filter(vehicle=>vehicle.type==='plane'&&vehicle.team==='enemy');
          const target=planes[0],pilot=entities.soldiers.get(target.seats[0].occupantId);
          for(const plane of planes)plane.position.set(-400,100,-400);
          target.position.set(point.x,floor+35,point.z+65);
          vehicleRenderer.update(entities.vehicles.values(),time);
          enemies=[];rebuildForces();
          const hits=[];let previous=target.health;
          for(let step=0;step<1200&&target.health>0;step++) {
            time+=.05;advanceEmplacement(point,.05,time);
            if(aimEmplacement(point,target.position,.05,floor))fireFixedWeapon(point,crew);
            if(target.health!==previous) {
              hits.push({health:target.health,pilot:pilot.health,time,shots:point.shots});
              previous=target.health;
            }
          }
          releaseEmplacement(crew,false);
          return {hits,maxHealth:target.maxHealth};
        },
        sceneView(id) {
          setGameState('pause');
          $('hud').hidden=true;
          for(const child of camera.children)child.visible=false;
          if(id==='north-background') {
            camera.position.set(10,25,-83);camera.lookAt(10,7,-105);
          } else if(id==='ruins') {
            const home=world.landmarks.residentialBuildings.find(home=>home.damaged&&home.floors===2&&!home.facing);
            if(!home)throw Error('Missing two-storey ruined house for visual regression');
            camera.position.set(home.x+home.width/2+.9,1.65,home.z-home.depth/2-1.3);
            camera.lookAt(home.x-home.width*.1,home.height*.65,home.z);
          } else if(id.endsWith('-sight')) {
            const point=emplacements.get(id.replace('-sight',''));
            const pose=emplacementPose(point,point.altitude??world.groundHeight(point.x,point.z));
            camera.position.set(pose.eye.x,pose.eye.y,pose.eye.z);
            camera.lookAt(camera.position.clone().add(new THREE.Vector3(-Math.sin(point.yaw),0,-Math.cos(point.yaw))));
          } else {
            const detail=id.endsWith('-detail'),point=emplacements.get(id.replace('-detail',''));
            const angle=point.heading+.85,y=point.altitude??0,distance=detail?2:7;
            camera.position.set(point.x+Math.sin(angle)*distance,y+(detail?2.3:3.8),point.z+Math.cos(angle)*distance);
            camera.lookAt(point.x,y+(detail?1.1:.7),point.z);
          }
          renderer.render(scene,camera);
        },
        async run() {
          const openingAssault=this.openingAssault();
          await new Promise((resolve,reject)=>{
            let frames=0;
            const ready=()=>{
              if(window.__battle?.state==='playing'&&$('loading').hidden)resolve();
              else if(++frames>2400)reject(Error('Battle rendering did not finish after the opening-assault fixture'));
              else setTimeout(ready,50);
            };
            ready();
          });
          const operator = controlledSoldier(entities), checks = [];
          for (const point of emplacements.values()) {
            releaseEmplacement(operator);
            operator.position.set(point.x, point.altitude ?? world.groundHeight(point.x, point.z), point.z + 2);
            const entered = enterEmplacement(operator);
            const assigned = operator.emplacementId;
            const owner = controlOwner(entities);
            const captured = playerInput.capture('pressFire');
            const before = point.shots;
            if (assigned) fireFixedWeapon(point, operator);
            const shots = point.shots - before;
            releaseEmplacement(operator);
            const stale = assigned ? playerInput.execute(captured, controlOwner(entities), true, () => { throw Error('stale fixed-gun input ran'); })
              : { status: 'not-mounted' };
            checks.push({ id: point.id, entered, assigned, ownerWeapon: owner.weaponId, shots,
              stale: stale.status, released: !point.operatorId && !operator.emplacementId });
          }
          const planes = [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'plane' && vehicle.team === 'enemy');
          const sharedPlanes = planes.map(plane => ({ health: plane.health, maxHealth: plane.maxHealth,
            magazine: plane.weapon.ammo, type: plane.weapon.type, pilot: plane.seats[0].occupantId }));
          operator.position.set(-4, 0, 27);
          dispatchControlCommand('equipTool');
          dispatchControlCommand('pressFire');
          time += 1.6; updateConstruction(1.6);
          const ammunitionBefore = operator.mortar.ammo;
          document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 100 }));
          renderConstruction();
          const range50 = $('mortar-range-setting').textContent;
          document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -20 }));
          renderConstruction();
          const rectangle = $('mortar-range-setting').getBoundingClientRect();
          const mortarReadout = { phase: operator.mortar.phase, first: range50,
            second: $('mortar-range-setting').textContent,
            visible: !$('mortar-objective-sight').hidden && rectangle.width > 0 &&
              rectangle.top >= 0 && rectangle.bottom <= innerHeight,
            unchangedAmmo: ammunitionBefore === operator.mortar.ammo };
          dispatchControlCommand('equipRifle');
          const originalEnemies = enemies;
          const attacker = enemies.find(actor => !actor.vehicleId && actor.index % 11 === 10);
          if (!attacker) throw Error('No Japanese machine gunner available');
          enemies = [attacker];
          for (const person of world.civilians) {
            person.visible = false; person.userData.releaseAt = Infinity;
            person.userData.active = false;
          }
          const person = world.civilians.find(person => person.userData.ageGroup === 'adult' &&
            person.userData.carrying === 'none');
          const data = person.userData;
          Object.assign(data, { active: true, arrived: false, dead: false, health: 100,
            streetLife: null, route: [{ x: -67, z: -85 }], waypoint: 0, threatResponse: null });
          person.visible = true; person.position.set(-67, .36, -77);
          attacker.position.set(-67, .36, -81);
          attacker.target = null; attacker.tactics.suppressedUntil = 0;
          const beforeDistance = person.position.distanceTo(attacker.position);
          for (let frame = 0; frame < 20; frame++) { time += .05; updateNanjingCivilians(.05); }
          const afterDistance = person.position.distanceTo(attacker.position), mode = data.escapeMode;
          const selectedByMachineGunner = nanjingCivilianPursuitTarget(attacker) === person;
          data.threatResponse = { mode: 'cower', target: null, nextThinkAt: time + 10,
            until: time + 10, threats: [{ ...attacker.position }] };
          for (let frame = 0; frame < 30; frame++) { time += .05; updateNanjingCivilians(.05); }
          updateCivilianAppearance(world.civilians, camera, 'high');
          const crouching = { root: person.civilianSkin.joints.root.position.y,
            knees: person.civilianSkin.joints.leftKnee.rotation.x,
            arm: person.civilianSkin.joints.leftArm.rotation.x };
          data.escapeMotion = null;
          person.position.set(-67, .36, -77);
          const source = captureAttackSource(entities, attacker, attacker.rifle);
          const start = new THREE.Vector3(-67, 1.26, -73);
          const damageBefore = nanjingCampaign.civilianCasualties;
          const gun = { settings: { range: RIFLE.range, damage: TYPES.infantry.damage } };
          fireAutomaticShot({ id: null, team: 'friendly' }, { gun },
            { ...source, credit: 'ally', team: 'friendly' }, start, 0, 0);
          const friendlySafe = !data.dead;
          fireAutomaticShot({ id: null, team: 'enemy' }, { gun }, source, start, 0, 0);
          const casualties = nanjingCampaign.civilianCasualties - damageBefore;
          const bayonetAttacker = originalEnemies.find(actor => actor.health > 0 && !actor.vehicleId &&
            !actor.discharger && !actor.engineer && hasBayonet(actor));
          const bayonetPerson = world.civilians.find(candidate => candidate !== person);
          if (!bayonetAttacker || !bayonetPerson) throw Error('Missing bayonet pursuit fixture');
          const { createTraversal } = await import('/src/infantry-traversal.js');
          bayonetAttacker.traversal = createTraversal();
          let corridor = null;
          for (let x = -72; x <= 72 && !corridor; x += 3) for (let z = -30; z <= 60 && !corridor; z += 3) {
            const start = { x, z }, end = { x, z: z - 32 };
            const clear = Array.from({ length: 33 }, (_, i) => ({ x, z: z - i })).every(point =>
              !world.isDeepWater(point.x, point.z) && !nanjingDockMovementLimited(point) &&
              Math.abs(world.groundHeight(point.x, point.z)) < .1 &&
              !circleBlocked(point.x, point.z, .5, movementObstacles(point.x, point.z)) &&
              !circleBlocked(point.x, point.z, .5, civilianNavigationLookup.at(point.x, point.z)));
            if (clear && segmentClear(start, end, .5, world.civilianNavigationObstacles,
              (px, pz) => civilianNavigationLookup.at(px, pz))) corridor = { start, end };
          }
          if (!corridor) throw Error('Missing clear civilian pursuit fixture');
          for (const civilian of world.civilians) {
            civilian.visible = false; civilian.userData.active = false;
          }
          Object.assign(bayonetPerson.userData, { active: true, dead: false, health: 100,
            evacuated: false, threatResponse: null, streetLife: null,
            route: [corridor.end], waypoint: 0 });
          bayonetPerson.visible = true;
          bayonetPerson.position.set(corridor.start.x, 0, corridor.start.z - 4);
          bayonetAttacker.position.set(corridor.start.x, 0, corridor.start.z);
          bayonetAttacker.heading = 0;
          bayonetAttacker.rifle.ammo = 0;
          bayonetAttacker.target = null;
          bayonetAttacker.tactics.civilianTarget = null;
          bayonetAttacker.tactics.civilianThinkAt = 0;
          bayonetAttacker.tactics.nanjingRegroup = { x: -24, y: 0, z: 24 };
          bayonetAttacker.bayonet.strikes = bayonetAttacker.bayonet.hits = 0;
          bayonetAttacker.bayonet.nextAttackAt = 0;
          civilianCombatTime = null;
          const bayonetShotsBefore = bayonetAttacker.rifle.shots;
          const selectedByBayonetRifleman = nanjingCivilianPursuitTarget(bayonetAttacker) === bayonetPerson;
          nanjingCampaign.stage = 'withdrawal';
          const previousForces = { allies, friendlyAI, friendlyForces, enemies, allForces };
          allies = [controlledSoldier(entities)]; friendlyAI = []; friendlyForces = [...allies];
          enemies = [bayonetAttacker]; rebuildForces();
          for (let frame = 0; frame < 120 && !bayonetPerson.userData.dead; frame++) {
            time += .05;
            aiDecisions.beginFrame();
            updateWeaponSimulation(.05);
            updateAI(.05);
            if (bayonetAttacker.nativeMotion) advanceNraMotion(bayonetAttacker, .05);
          }
          const bayonetPursuit = { selected: selectedByBayonetRifleman,
            strikes: bayonetAttacker.bayonet.strikes,
            hits: bayonetAttacker.bayonet.hits,
            damage: 100 - bayonetPerson.userData.health,
            shots: bayonetAttacker.rifle.shots - bayonetShotsBefore,
            mode: bayonetAttacker.tactics.mode,
            health: bayonetAttacker.health, traversal: bayonetAttacker.traversal.kind,
            reaction: Boolean(bayonetAttacker.blastReaction || bayonetAttacker.dying),
            attacker: bayonetAttacker.position.toArray(), civilian: bayonetPerson.position.toArray() };
          const movingPerson = world.civilians.filter(candidate => candidate !== person && candidate !== bayonetPerson &&
            candidate.userData.ageGroup === 'adult')
            .sort((a, b) => civilianPaceMultiplier(a.userData.civilianId, time) -
              civilianPaceMultiplier(b.userData.civilianId, time))[0];
          if (!movingPerson) throw Error('Missing moving civilian pursuit fixture');
          bayonetPerson.visible = false;
          bayonetPerson.userData.active = false;
          const movingData = movingPerson.userData;
          Object.assign(movingData, { active: true, dead: false, health: 100, arrived: false,
            evacuated: false, panicked: true, streetLife: null, streetEvacuating: false,
            fleeReleased: true, restPoseWeight: 0, resting: false, route: [corridor.end], waypoint: 0,
            threatResponse: { mode: 'flee', target: corridor.end, nextThinkAt: time + 60,
              until: time + 60, threats: [] }, crowdTarget: null, crowdPath: null,
            crowdStalled: 0, crowdPathStalled: 0 });
          movingPerson.visible = true;
          movingPerson.position.set(corridor.start.x, world.groundHeight(corridor.start.x, corridor.start.z - 10.6),
            corridor.start.z - 10.6);
          bayonetAttacker.position.set(corridor.start.x, world.groundHeight(corridor.start.x, corridor.start.z),
            corridor.start.z);
          bayonetAttacker.heading = 0;
          bayonetAttacker.rifle.ammo = 1;
          bayonetAttacker.locomotion = createLocomotion();
          bayonetAttacker.traversal = createTraversal();
          bayonetAttacker.path = bayonetAttacker.pathGoal = null;
          pathRequests.delete(bayonetAttacker.tactics.id);
          cancelBayonet(bayonetAttacker.bayonet);
          bayonetAttacker.bayonet.nextAttackAt = 0;
          bayonetAttacker.tactics.civilianTarget = null;
          bayonetAttacker.tactics.civilianThinkAt = 0;
          civilianCombatTime = null;
          const movingStart = movingPerson.position.clone(), movingInitialDistance =
            bayonetAttacker.position.distanceTo(movingPerson.position), movingShots = bayonetAttacker.rifle.shots;
          const movingSamples = [];
          for (let frame = 0; frame < 120 && movingData.health === 100; frame++) {
            time += .05; aiDecisions.beginFrame();
            updateWeaponSimulation(.05); updateAI(.05); updateNanjingCivilians(.05);
            if (bayonetAttacker.nativeMotion) advanceNraMotion(bayonetAttacker, .05);
            if (frame % 10 === 0) movingSamples.push({ distance: bayonetAttacker.position.distanceTo(movingPerson.position),
              speed: bayonetAttacker.locomotion.speed, mode: bayonetAttacker.tactics.mode,
              stamina: bayonetAttacker.locomotion.stamina });
          }
          const movingPursuit = { corridor, initialDistance: movingInitialDistance, samples: movingSamples,
            civilianTravel: movingStart.distanceTo(movingPerson.position), damage: 100 - movingData.health,
            shots: bayonetAttacker.rifle.shots - movingShots };
          ({ allies, friendlyAI, friendlyForces, enemies, allForces } = previousForces);
          rebuildForces();
          enemies = originalEnemies;
          rebuildForces();
          state = 'pause';
          return { openingAssault, checks, sharedPlanes, beforeDistance, afterDistance, mode,
            selectedByMachineGunner, crouching, friendlySafe, casualties, civilianDead: data.dead, bayonetPursuit, movingPursuit,
            houses: world.landmarks.residentialBuildings.length, mortarReadout };
        },
        retreat() {
          setGameState('menu');
          beginMatch();
          const player = controlledSoldier(entities);
          enemies = []; rebuildForces();
          const follower = allies.find(actor => actor !== player);
          const walk = world.landmarks.wallWalk;
          player.position.set(-60, world.groundHeight(-60,-80), -80);
          follower.position.set((walk.minX + walk.maxX)/2, walk.height, 0);
          follower.order = 'follow';
          nanjingCampaign.stage = 'withdrawal'; nanjingCampaign.reinforcementStopped = true;
          for (const formation of formations.filter(unit => unit.team === 'friendly' && !unit.player))
            formation.objectiveId = 'dock';
          for (const actor of allForces) {
            actor.target = null; actor.tactics.lastSeen = null;
            actor.tactics.cover = null; actor.path = actor.pathGoal = null;
          }
          let steps = 0;
          for (; steps < 3600 && follower.position.distanceTo(player.position) > 12; steps++) {
            time += .05; aiDecisions.beginFrame();
            updateWeaponSimulation(.05); updateAI(.05);
            world.doorSystem.update(.05, allForces.filter(actor => actor.health > 0)
              .map(actor => ({ x: actor.position.x, y: actor.position.y, z: actor.position.z, radius: .42 })));
            for (const actor of allForces) if (actor.nativeMotion && actor.health > 0)
              advanceNraMotion(actor,.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          const arrival = { simulatedSeconds: steps*.05, position:follower.position.toArray(),
            distance:follower.position.distanceTo(player.position), mode:follower.tactics.mode,
            floor:world.groundHeight(follower.position.x,follower.position.z),
            pathReason:follower.tactics.pathReason, blockedBy:follower.tactics.blockedBy };
          nanjingCampaign.stage = 'dock-defense'; nanjingCampaign.dockActivated = true;
          nanjingCampaign.presentedStage = 'withdrawal';
          camera.position.set(-60, 2, -80); camera.lookAt(-90, 1, -80);
          updateNanjingMission(0);
          const immediately = formations.filter(unit => unit.team === 'friendly' && unit.index >= 3)
            .map(unit=>unit.members.length);
          time += 10; updateNanjingMission(0);
          const reserves = formations.filter(unit => unit.team === 'friendly' && unit.index >= 3)
            .map(unit=>({id:unit.id,members:unit.members.length,spawnId:unit.spawnId,
              spawnedAt:unit.members[0]?.spawnPosition}));
          const leaders=formations.filter(unit=>unit.team==='friendly'&&unit.index>=3).map(unit=>unit.members[0]);
          enemies=[];rebuildForces();
          if(leaders.some(actor=>actor.health<=0))throw Error('Reserve march fixture starts with a dead leader');
          const reinforcementMarch=leaders.map(actor=>({id:actor.id,start:actor.position.toArray(),arrival:null,maxStep:0}));
          for(let frame=0;frame<3000&&reinforcementMarch.some(record=>!record.arrival);frame++){
            const before=leaders.map(actor=>actor.position.clone());
            time+=.05;aiDecisions.beginFrame();updateWeaponSimulation(.05);updateAI(.05);
            world.doorSystem.update(.05,allForces.filter(actor=>actor.health>0).map(actor=>({
              x:actor.position.x,y:actor.position.y,z:actor.position.z,radius:.42})));
            for(const actor of allForces)if(actor.nativeMotion&&actor.health>0)advanceNraMotion(actor,.05);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
            for(let index=0;index<leaders.length;index++){
              const actor=leaders[index],record=reinforcementMarch[index];
              record.maxStep=Math.max(record.maxStep,actor.position.distanceTo(before[index]));
              if(!record.arrival&&Math.hypot(actor.position.x-NANJING_DOCK.x,actor.position.z-NANJING_DOCK.z)<25)
                record.arrival={seconds:(frame+1)*.05,position:actor.position.toArray()};
            }
            reinforcementMarch.forEach((record,index)=>{const actor=leaders[index];record.final={
              health:actor.health,mode:actor.tactics.mode,pathReason:actor.tactics.pathReason,position:actor.position.toArray()};});
          }
          state='pause';
          return {arrival,immediately,reserves,reinforcementMarch};
        },
        operators() {
          setGameState('menu'); beginMatch();
          this.releaseAssault();
          const player=controlledSoldier(entities), originalEnemies=[...enemies], results=[];
          const crew=friendlyAI.find(actor=>actor.health>0);
          for(const [index,friend] of friendlyForces.entries())if(friend!==crew)
            friend.position.set(-80+index%4*2,0,40+Math.floor(index/4)*2);
          for(const point of [...emplacements.values()].filter(point=>!point.weapon.settings.antiAircraft)) {
            releaseEmplacement(crew,false);releaseEmplacement(player);
            nanjingCampaign.stage=point.id.startsWith('dock-')?'dock-defense':'gate-defense';
            nanjingCampaign.dockActivated=point.id.startsWith('dock-');
            const floor=point.altitude??world.groundHeight(point.x,point.z);
            const pose=emplacementPose(point,floor);
            crew.position.set(pose.operator.x,floor,pose.operator.z);
            occupyEmplacement(point,crew);
            let target;
            if(point.weapon.settings.antiAircraft) {
              target=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='plane'&&vehicle.health>0);
              target.position.set(point.x,floor+35,point.z+65);
              vehicleRenderer.update(entities.vehicles.values(),time);
              enemies=[];
            } else {
              target=originalEnemies.find(actor=>actor.health>0&&!actor.vehicleId);
              const choices=point.id.startsWith('bridge-')?[[-24,45],[-24,48],[-24,52],[-22,44]]:
                [[-35,-94],[-30,-93],[-40,-94],[-38,-92],[-32,-91]];
              const location=choices.find(([x,z])=>!circleBlocked(x,z,.46,world.obstacles)&&
                emplacementCanAimAt(point,{x,y:world.groundHeight(x,z)+1.1,z},floor)&&
                hasLine(new THREE.Vector3(point.x,floor+2,point.z),
                  new THREE.Vector3(x,world.groundHeight(x,z)+.9,z),point.weapon.settings.range));
              if(!location)throw Error('No visible target fixture for '+point.id);
              target.position.set(location[0],world.groundHeight(...location),location[1]);
              enemies=[target];
            }
            rebuildForces();
            const health=target.health,shots=point.shots;
            for(let step=0;step<600&&target.health===health;step++) {
              time+=.05;advanceEmplacement(point,.05,time);operateAIEmplacement(crew,.05);
              updateProjectiles(.05);
            }
            const damage=health-target.health, fired=point.shots-shots, ammo=point.weapon.ammo,heat=point.heat;
            player.position.set(pose.operator.x,floor,pose.operator.z);
            enterEmplacement(player);
            const takeover=point.operatorId===player.id&&!crew.emplacementId&&
              point.weapon.ammo===ammo&&point.heat===heat;
            releaseEmplacement(player);
            results.push({id:point.id,damage,fired,takeover,target:target.position.toArray(),
              lastShot:point.weapon.lastShot,impact:projectileImpacts.at(-1)});
          }
          state='pause';
          return results;
        }
      };
    ` });
  });
  const gameUrl = new URL('/?campaign=nanjing', process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  if (process.env.GAME_CHARACTER) gameUrl.searchParams.set('character', process.env.GAME_CHARACTER);
  await page.goto(gameUrl.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 120000 });
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  if (process.env.ARTIFACT_DIR && process.env.RETREAT_ONLY!=='1') {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    for (const id of ['bridge-mg','bridge-gun','dock-mg','dock-gun','dock-mg-sight','dock-gun-sight',
      'gate-aa','dock-aa','dock-aa-detail','north-background','ruins']) {
      await page.evaluate(id => civilianDefenseReview.sceneView(id), id);
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `${id}.png`) });
    }
    await page.evaluate(() => civilianDefenseReview.resume());
  }
  let result;
  if(process.env.RETREAT_ONLY!=='1') {
  result = await page.evaluate(() => civilianDefenseReview.run());
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'defense-result.json'), JSON.stringify({ result, errors }, null, 2));
  }
  console.log(JSON.stringify({ result, errors }));
  if (process.env.NANJING_CAMPAIGN_BEHAVIOR_ONLY === '1') {
    assert.deepEqual(result.openingAssault.held,
      { released:false,squads:0,vehicles:0 },
      'Japanese forces must not spawn before 20 seconds, even if everyone has crossed');
    assert.equal(result.openingAssault.released,true);
    assert.equal(result.openingAssault.squads,8);
    assert.equal(result.openingAssault.aircraft,3);
    assert.equal(result.openingAssault.armor,4);
    assert.ok(result.openingAssault.south.every(z=>z>38&&z<=96),
      'all opening Japanese infantry must spawn south of the river and inside the battle boundary');
    assert.ok(result.bayonetPursuit.selected);
    assert.ok(result.bayonetPursuit.strikes > 0 && result.bayonetPursuit.damage > 0,
      'bayonet-qualified Japanese infantry must charge and damage a nearby civilian');
    assert.equal(result.bayonetPursuit.shots, 0,
      'bayonet pursuit must not fire the rifle at the civilian, even with an empty magazine');
    assert.ok(result.movingPursuit.initialDistance > 8 && result.movingPursuit.civilianTravel > 2);
    assert.ok(result.movingPursuit.samples.some(sample => sample.mode === 'pursue-civilians') &&
      result.movingPursuit.samples.some(sample => sample.distance < 8),
      'a moving civilian must be pursued from outside charge range and approached');
    assert.equal(result.movingPursuit.shots, 0);
    const restarted = await page.evaluate(() => civilianDefenseReview.restartCrossing());
    assert.equal(restarted.reset, 0, 'starting a new match must clear previous civilian crossings');
    assert.deepEqual(restarted.progress, Array.from({length:54}, (_,index)=>index+1),
      'actual civilian movement must count every crossing after restarting');
    assert.equal(restarted.beforeDelay, false);
    assert.equal(restarted.released, true);
    assert.equal(restarted.squads, 8);
    assert.deepEqual(errors, []);
  } else {
    assert.equal(result.checks.length, 7);
    assert.ok(result.checks.every(check => check.assigned === check.id && check.shots === 1 &&
      check.stale === 'rejected' && check.released), 'all seven stations must really mount, shoot and release');
    assert.equal(result.sharedPlanes.length, 3);
    assert.ok(result.sharedPlanes.every(plane => plane.health === 180 && plane.maxHealth === 180 &&
      plane.magazine <= 60 && plane.magazine >= 0 && plane.type === 'plane' && plane.pilot));
    assert.deepEqual(result.mortarReadout, { phase:'ready',first:'50 m',second:'60 m',visible:true,unchangedAmmo:true });
    assert.ok(result.afterDistance > result.beforeDistance + 1 || result.mode === 'cower');
    assert.ok(result.selectedByMachineGunner);
    assert.ok(result.bayonetPursuit.selected);
    assert.ok(result.bayonetPursuit.strikes > 0 && result.bayonetPursuit.damage > 0,
      'bayonet-qualified Japanese infantry must charge and damage a nearby civilian');
    assert.equal(result.bayonetPursuit.shots, 0,
      'bayonet pursuit must not fire the rifle at the civilian, even with an empty magazine');
    assert.ok(result.crouching.root < -.28 && result.crouching.knees < -1.7 && result.crouching.arm > 1.9);
    assert.ok(result.friendlySafe);
    assert.equal(result.casualties, 1);
    assert.ok(result.civilianDead);
  }
  }
  if (process.env.NANJING_CAMPAIGN_BEHAVIOR_ONLY !== '1') {
  const retreat = await page.evaluate(() => civilianDefenseReview.retreat());
  console.log(JSON.stringify({retreat}));
  assert.ok(retreat.arrival.distance < 12 && Math.abs(retreat.arrival.position[1]-retreat.arrival.floor)<.03,
    'a real wall-top squadmate must descend and physically catch up through the city');
  assert.deepEqual(retreat.immediately,[0,0], 'reserve squads cannot suddenly appear next to the player at stage start');
  assert.ok(retreat.reserves.every(unit=>unit.members===11 &&
    Math.hypot(unit.spawnedAt.x+60,unit.spawnedAt.z+80)>28 && unit.spawnId==='nanjing-west-dock'));
  assert.equal(retreat.reinforcementMarch.length,2);
  assert.ok(retreat.reinforcementMarch.every(record=>record.arrival&&record.maxStep<.6&&
    record.final.mode!=='withdrawal-wall'),
    'both reserve squad leaders must actually march from the city to the dock defenses without teleporting');
  if(process.env.RETREAT_ONLY!=='1') {
  const operators=await page.evaluate(()=>civilianDefenseReview.operators());
  console.log(JSON.stringify({operators}));
  assert.equal(operators.length,4);
  assert.ok(operators.every(point=>point.fired>0&&point.damage>0&&point.takeover),
    'AI must use all weapon types against real targets and allow resource-preserving player takeover');
  const fieldReload=await page.evaluate(()=>civilianDefenseReview.fieldReload());
  assert.deepEqual(fieldReload.start,{hidden:false,text:'5.5s',value:0});
  assert.deepEqual(fieldReload.paused,fieldReload.start);
  assert.equal(fieldReload.half.value,50);
  assert.equal(fieldReload.half.hidden,false);
  assert.equal(fieldReload.left.hidden,true);
  assert.deepEqual(fieldReload.resumed,fieldReload.half);
  assert.equal(fieldReload.complete.hidden,true);
  const airframe=await page.evaluate(()=>civilianDefenseReview.airframeBurst());
  assert.equal(airframe.maxHealth,180);
  assert.equal(airframe.hits.length,15,'actual AA ray hits, not shots fired, must take fifteen hits');
  assert.ok(airframe.hits.slice(0,14).every(hit=>hit.health>0&&hit.pilot===100));
  assert.equal(airframe.hits.at(-1).health,0);
  assert.equal(airframe.hits.at(-1).pilot,0);
  console.log(JSON.stringify({fieldReload,airframe}));
  assert.deepEqual(errors, []);
  if(process.env.ARTIFACT_DIR)await writeFile(join(process.env.ARTIFACT_DIR,'defense-result.json'),
    JSON.stringify({result,retreat,operators,fieldReload,airframe,errors},null,2));
  } else {
    assert.deepEqual(errors,[]);
    if(process.env.ARTIFACT_DIR)await writeFile(join(process.env.ARTIFACT_DIR,'reinforcement-march.json'),
      JSON.stringify({retreat,errors},null,2));
  }
  }
} catch (error) {
  const loading = await page.locator('#loading').count()
    ? await page.locator('#loading').textContent() : 'loading indicator unavailable';
  console.error(JSON.stringify({ error: error.message, errors, loading }));
  throw error;
} finally {
  await browser.close();
}
