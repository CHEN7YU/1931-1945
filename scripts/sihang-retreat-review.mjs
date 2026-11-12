import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { SIHANG_RULES } from '../src/sihang-campaign.js';
import { SIHANG_ASSEMBLY_ARRIVAL } from '../src/sihang-formation.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  await page.addInitScript(() => {
    const report = console.error;
    window.__nanGeometries = [];
    console.error = (...args) => {
      report(...args);
      if (String(args[0]).includes('Computed radius is NaN')) {
        window.__nanGeometries.push(args[1]?.uuid);
        report(new Error('NaN geometry call path').stack);
      }
    };
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|shader|WebGL|Uncaught|ReferenceError|TypeError/.test(message.text())) {
      errors.push(message.text()); console.error(message.text().slice(0, 1000));
    }
  });
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.retreatReview = {
        restart() { setGameState('menu'); beginMatch(); },
        defenseStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const formation = formations.find(f => f.id === 'enemy-0');
          const previous = new Set(formation.members.map(a => a.id));
          for (const actor of formation.members) actor.health = 0;
          clearActors(formation.members); enemies = enemies.filter(a => !previous.has(a.id)); rebuildForces();
          const forward = {id:'diagnostic-forward-rally',team:'enemy',kind:'base',permanent:true,
            allowNearbyEnemies:true,x:0,z:-46,altitude:0};
          spawnPoints.push(forward);
          const spawned = spawnFormation(formation);
          spawnPoints = spawnPoints.filter(p => p !== forward);
          const origin = sihangSpawns().find(p => p.id === formation.spawnId);
          if (!spawned || formation.members.some(a => Math.hypot(a.position.x-origin.x,a.position.z-origin.z)>20))
            throw new Error('Japanese reinforcements must ignore a forward rally and use their assigned original spawn');
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of allForces) actor.health = 100000;
          this.originalSappers = enemies.filter(actor => actor.formation.sihangDemolition);
          return this.defenseSnapshot();
        },
        defenseStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && sihangCampaign.stage === 'sihang-defense'; i++) {
            for (const actor of allForces) {
              actor.nextFire = time + 1000000; actor.grenades.ammo = actor.grenades.packs = 0;
            }
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause'); return this.defenseSnapshot();
        },
        defenseSnapshot() {
          return { time, stage: sihangCampaign.stage, breached: sihangCampaign.northWallBreached,
            demolition: sihangCombat.snapshot, charge: {...sihangCampaign.demolition},
            returned: enemies.filter(a => a.tactics.sihangDemolitionReturned).length,
            originalSappers: this.originalSappers?.map(actor => ({ id: actor.id, health: actor.health,
              returned: actor.tactics.sihangDemolitionReturned, position: actor.position.toArray(),
              lastHit: actor.lastHit, registered: entities.soldiers.has(actor.id) })),
            defenders: friendlyAI.filter(a => a.health > 0).map(a => ({ id: a.id, index: a.index,
              formation: a.formation.index, position: a.position.toArray(), duty: a.tactics.sihangDuty,
              mode: a.tactics.mode, mounted: a.emplacementId })),
            sappers: enemies.filter(a => a.formation.sihangDemolition).map(a => ({id:a.id,
              position: a.position.toArray(), heading: a.heading, goal: sihangCombat.goalFor(a, sihangCampaign),
              mode: a.tactics.mode, health:a.health, shield:a.sihangShield?.role,
              path: a.path?.slice(0,3), blocked: a.tactics.blockedBy })),
            spawns: spawnPoints.filter(p => p.team === 'enemy').map(p => ({id:p.id,x:p.x,z:p.z})) };
        },
        assaultStart() {
          for (const actor of enemies) actor.nextFire = time;
          return this.assaultSnapshot();
        },
        assaultStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && sihangCampaign.stage === 'sihang-defense'; i++) {
            for (const actor of friendlyForces) actor.nextFire = time + 1000000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause'); return this.assaultSnapshot();
        },
        assaultSnapshot() {
          return { time, stage: sihangCampaign.stage, point: { owner: objectives[0].owner },
            attackers: enemies.filter(actor => actor.health > 0 && !actor.vehicleId &&
              actor.hasFirearm !== false && !actor.tactics.sihangDemolitionReturned).map(actor => ({
                id: actor.id, position: actor.position.toArray(), mode: actor.tactics.mode,
                shots: actor.rifle.shots, targetFriendly: actor.target?.friendly === true,
                inCapture: objectiveContainsPosition(objectives[0], actor.position) })) };
        },
        geometryErrors() {
          const invalid = [];
          scene.traverse(mesh => {
            if (window.__nanGeometries.includes(mesh.geometry?.uuid))
              invalid.push({ name: mesh.name, parent: mesh.parent?.name,
                geometry: mesh.geometry.type, userData: mesh.userData,
                invalidAttributes: Object.entries(mesh.geometry.attributes).filter(([, attribute]) =>
                  attribute.array.some(value => !Number.isFinite(value))).map(([name]) => name) });
          });
          return invalid;
        },
        engineerStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of enemies) actor.health = 0;
          const engineer = friendlyForces.find(a => a.engineer && !a.playerUnit);
          if (!engineer) throw new Error('Expected an original AI engineer');
          engineer.position.set(18, SIHANG_WAREHOUSE.floorHeight, -31);
          if (!engineerPlacementReason(engineer, { ...engineer.position }))
            throw new Error('Upper-floor engineering was not rejected');
          this.engineerId = engineer.id;
          this.engineerMaterials = JSON.stringify(engineer.engineer.materials);
          operateAIEngineer(engineer, .05);
          if (engineer.tactics.mode !== 'engineer-descend' ||
            pathRequests.get(engineer.tactics.id)?.target.y !== 0 ||
            JSON.stringify(engineer.engineer.materials) !== this.engineerMaterials)
            throw new Error('Upper-floor engineer must request a real descent without spending materials');
          return this.engineerSnapshot();
        },
        engineerStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            if (engineerWorks.filter(work => work.builderId === this.engineerId).length === 2) break;
          }
          setGameState('pause'); return this.engineerSnapshot();
        },
        engineerSnapshot() {
          const actor = entities.soldiers.get(this.engineerId);
          return { time, id: actor.id, p: actor.position.toArray(), mode: actor.tactics.mode,
            materials: actor.engineer.materials, site: actor.engineer.site, path: actor.path?.slice(0, 3),
            works: engineerWorks.filter(work => work.builderId === actor.id)
              .map(work => ({ id: work.point.id, y: work.point.view.position.y })) };
        },
        capture(eye, target) {
          sihangNight.update(sihangCampaign); world.setNightLighting(sihangNight.snapshot.transition);
          camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld(true);
          const displayed = allForces.filter(actor => actor.health > 0);
          nraCharacter?.update(displayed.filter(actor => actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          ijaCharacter?.update(displayed.filter(actor => !actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          uniformExcludedIds.clear();
          for (const force of [nraCharacter, ijaCharacter])
            for (const id of force?.excludedIds ?? []) uniformExcludedIds.add(id);
          soldierRenderer.update(displayed, graphics.snapshot.preset, time,
            entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/png').split(',')[1];
        },
        regroupStart(partial = false) {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const actor of friendlyForces) actor.health = 100000;
          if (partial) {
            const removed = friendlyAI.slice(18), ids = new Set(removed.map(actor => actor.id));
            clearActors(removed);
            friendlyAI = friendlyAI.filter(actor => !ids.has(actor.id));
            for (const formation of formations.filter(f => f.team === 'friendly' && !f.player))
              formation.members = formation.members.filter(actor => !ids.has(actor.id));
            rebuildForces();
            sihangCampaign.reserve = 0;
            sihangCampaign.deployed = SIHANG_RULES.troopLimit;
          }
          for (const actor of friendlyAI) {
            actor.position.set(18, SIHANG_WAREHOUSE.floorHeight, -31);
            actor.rifle.ammo = 0;
          }
          const enemy = enemies.find(actor => !actor.vehicleId && !actor.formation.sihangDemolition);
          enemy.position.set(-20, 0, -30);
          this.regroupEnemy = enemy.id;
          this.oldAI = friendlyAI.map(actor => actor.id);
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          for (const actor of allies.filter(actor => actor.health > 0)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched';
          }
          const survivor = friendlyAI[0], goal = sihangActorAssemblyGoal(survivor);
          survivor.position.set(goal.x, goal.y, goal.z); survivor.stance = 'crouched';
          this.keptAI = survivor.id;
          this.playerEquipment = allies.map(actor => ({ id: actor.id, health: actor.health,
            ammo: actor.rifle.ammo, grenades: actor.grenades.ammo }));
          this.initialTotal = sihangCampaign.retreatTotal;
          this.births = {};
          this.assemblyVoice = null;
          updateSihangMission(.05);
          return this.regroupSnapshot();
        },
        regroupStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && !sihangCampaign.assemblyReleased; i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            if (sihangCampaign.assemblyReleased) this.assemblyVoice = { ...sihangVoices?.snapshot };
            for (const actor of friendlyAI) if (!this.oldAI.includes(actor.id)) {
              const record = this.births[actor.id] ??= { id: actor.id, x: actor.spawnPosition.x,
                z: actor.spawnPosition.z, ammo: actor.rifle.ammo, maxX: actor.position.x };
              record.maxX = Math.max(record.maxX, actor.position.x);
            }
          }
          setGameState('pause');
          return this.regroupSnapshot();
        },
        regroupWithdrawalStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && !sihangCampaign.counterattack; i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.regroupSnapshot();
        },
        regroupSnapshot() {
          const player = controlledSoldier(entities), enemy = entities.soldiers.get(this.regroupEnemy);
          return { time, elapsed: sihangCampaign.elapsed, stageElapsed: sihangCampaign.stageElapsed,
            total: sihangCampaign.retreatTotal, initialTotal: this.initialTotal,
            prepared: sihangCampaign.assemblyPrepared, released: sihangCampaign.assemblyReleased,
            wave: sihangCampaign.withdrawalWave && structuredClone(sihangCampaign.withdrawalWave),
            reserve: sihangCampaign.retreatReserve, lost: sihangCampaign.retreatLostIds.length,
            saved: sihangCampaign.evacuatedIds.length, counterattack: sihangCampaign.counterattack,
            assemblyVoice: this.assemblyVoice,
            oldPresent: friendlyAI.filter(actor => this.oldAI.includes(actor.id)).map(actor => actor.id),
            keptAI: this.keptAI, births: Object.values(this.births),
            playerEquipment: allies.map(actor => ({ id: actor.id, health: actor.health,
              ammo: actor.rifle.ammo, grenades: actor.grenades.ammo })),
            initialPlayerEquipment: this.playerEquipment,
            player: player.position.toArray(), enemy: enemy && { position: enemy.position.toArray(),
              mode: enemy.tactics.mode }, enemyPost: enemy && sihangEnemyPosts[enemy.formation.index * 11 + enemy.index],
            formations: formations.filter(f => f.team === 'friendly').map(f => ({ id: f.id,
              size: f.members.filter(a => a.health > 0).length, assembled: f.retreatAssembled,
              blocked: f.blockedReason, withdrawAt: f.withdrawAt,
              positions: f.members.filter(a => a.health > 0).map(a => ({ id: a.id,
                index: a.index, position: a.position.toArray(), goal: sihangActorAssemblyGoal(a) })),
              remaining: f.members.filter(a => a.health > 0 && a !== player &&
                (Math.hypot(a.position.x - sihangActorAssemblyGoal(a).x,
                  a.position.z - sihangActorAssemblyGoal(a).z) > SIHANG_ASSEMBLY_ARRIVAL ||
                  Math.abs(a.position.y) > .3 || a.stance !== 'crouched' ||
                  Math.cos(a.heading + Math.PI / 2) < .995))
                .map(a => ({ id: a.id, position: a.position.toArray(), goal: sihangActorAssemblyGoal(a),
                  mode: a.tactics.mode, path: a.path?.slice(0, 3), blocked: a.tactics.blockedBy,
                  heading: a.heading, traffic: a.tactics.traffic })) })) };
        },
        waveFixtureStart(liveCombat = false) {
          this.regroupStart();
          this.regroupStep(10);
          for (const actor of friendlyForces.filter(actor => actor.health > 0)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched'; actor.heading = -Math.PI / 2;
            if (liveCombat) actor.health = 100;
          }
          sihangCampaign.stageElapsed = SIHANG_RULES.nightfallSeconds;
          updateSihangMission(.05);
          if (!sihangCampaign.withdrawalWave) throw new Error('Wave fixture requires a complete first wave');
          return this.waveFixtureSnapshot();
        },
        waveFixtureContactStart() {
          this.waveFixtureStart();
          const wave = sihangCampaign.withdrawalWave;
          const slot = wave.squads.findIndex((ids, index) => index !== wave.coverSlot && ids.length);
          const actor = entities.soldiers.get(wave.squads[slot]?.find(id => entities.soldiers.get(id)?.health > 0));
          const enemy = enemies.find(candidate => candidate.health > 0 && !candidate.vehicleId &&
            !candidate.formation.sihangDemolition && candidate.hasFirearm !== false);
          if (!actor || !enemy) throw new Error('Retreat contact fixture requires a living AI and infantry target');
          const goal = sihangRetreatGoal(actor);
          const length = Math.hypot(goal.x - actor.position.x, goal.z - actor.position.z);
          const dx = (goal.x - actor.position.x) / length, dz = (goal.z - actor.position.z) / length;
          let found = null;
          for (const back of [18, 22, 26, 30, 34, 38]) for (const lateral of [0, -2, 2, -4, 4]) {
            const x = goal.x - dx * back - dz * lateral, z = goal.z - dz * back + dx * lateral;
            const targetX = x + dx * 10, targetZ = z + dz * 10;
            if (world.isDeepWater(x, z) || world.isDeepWater(targetX, targetZ)) continue;
            const y = world.walkHeight(x, z, goal.y ?? 0), targetY = world.walkHeight(targetX, targetZ, y);
            if (circleBlocked(x, z, .42, movementObstacles(x, z), y) ||
              circleBlocked(targetX, targetZ, .42, movementObstacles(targetX, targetZ), targetY)) continue;
            actor.position.set(x, y, z); enemy.position.set(targetX, targetY, targetZ);
            actorGrid.rebuild(allForces);
            const eye = soldierEyePosition(actor), aim = targetAimPoint(enemy);
            if (clearAIRifleLine(actor, new THREE.Vector3(eye.x, eye.y, eye.z),
              new THREE.Vector3(aim.x, aim.y, aim.z)) &&
              sihangNightVisibility(sihangCampaign, { x, z }, { x: targetX, z: targetZ })) {
              found = { x, y, z, targetX, targetY, targetZ };
              break;
            }
          }
          if (!found) throw new Error('Retreat contact fixture requires a clear, dry firing lane');
          actor.position.set(found.x, found.y, found.z);
          enemy.position.set(found.targetX, found.targetY, found.targetZ);
          actor.health = enemy.health = 100000;
          sihangCampaign.assemblyReleased = true;
          actor.formation.retreatAssembled = true;
          cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'sihang-contact-review');
          actor.tactics.sihangRetreatContact = null;
          actor.rifle.ammo = Math.max(1, actor.rifle.ammo);
          actor.rifle.action = 'idle';
          actor.nextFire = time;
          stopLocomotion(actor.locomotion);
          actor.locomotion.aimRecovery = 0;
          actor.target = enemy;
          actor.nextThink = enemy.nextThink = time + 100000;
          rememberThreat(actor.tactics, { x: found.targetX, y: found.targetY + 1.1, z: found.targetZ },
            time, 'person', 'vision', enemy.id);
          actor.tactics.sihangTrafficYield = null;
          actor.path = actor.pathGoal = null;
          actor.heading = Math.atan2(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z);
          actorGrid.rebuild(allForces);
          this.waveContact = { actor: actor.id, enemy: enemy.id, direction: { x: dx, z: dz } };
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureContactSetDistance(distance) {
          const actor = entities.soldiers.get(this.waveContact.actor), enemy = entities.soldiers.get(this.waveContact.enemy);
          const x = actor.position.x + this.waveContact.direction.x * distance;
          const z = actor.position.z + this.waveContact.direction.z * distance;
          enemy.position.set(x, world.walkHeight(x, z, actor.position.y), z);
          actor.target = enemy;
          rememberThreat(actor.tactics, { x, y: enemy.position.y + 1.1, z },
            time, 'person', 'vision', enemy.id);
          actor.heading = Math.atan2(actor.position.x - x, actor.position.z - z);
          actorGrid.rebuild(allForces);
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureContactStep(seconds) {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const enemy = entities.soldiers.get(this.waveContact.enemy), heldPosition = enemy.position.clone();
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            for (const hostile of enemies) hostile.nextFire = time + 1000000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            enemy.position.copy(heldPosition); enemy.path = enemy.pathGoal = null;
            enemy.target = null; enemy.nextThink = time + 100000;
            actor.target = enemy; actor.nextThink = time + 100000;
            rememberThreat(actor.tactics, { x: heldPosition.x, y: heldPosition.y + 1.1, z: heldPosition.z },
              time, 'person', 'vision', enemy.id);
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            enemy.position.copy(heldPosition); actorGrid.rebuild(allForces);
          }
          setGameState('pause');
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureContactSnapshot() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const enemy = entities.soldiers.get(this.waveContact.enemy);
          const eye = soldierEyePosition(actor), aim = targetAimPoint(enemy);
          return { elapsed: sihangCampaign.elapsed, actor: actor.id, target: enemy.id,
            stage: sihangCampaign.stage, wavePhase: sihangCampaign.withdrawalWave?.phase,
            distance: Math.hypot(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z),
            position: actor.position.toArray(), currentTarget: actor.target?.id ?? null,
            threatId: actor.tactics.threatId, threatSense: actor.tactics.threatSense,
            assemblyReleased: sihangCampaign.assemblyReleased,
            retreatAssembled: actor.formation.retreatAssembled, ceasefire: sihangCeasefire(actor),
            clearShotLine: Boolean(clearAIRifleLine(actor, new THREE.Vector3(eye.x, eye.y, eye.z), aim)),
            contactEligible: Boolean(actor.friendly && sihangCampaign.stage === 'sihang-retreat' &&
              actor.tactics.threatSense === 'vision' && actor.tactics.threatId === enemy.id &&
              Math.hypot(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z) <= 12 &&
              !sihangCeasefire(actor)),
            targetKind: enemy.targetKind, canDamage: canWeaponDamageTarget('rifle', enemy.targetKind),
            canTrack: canRiflemanTrackTarget(enemy.targetKind),
            engineer: Boolean(actor.engineer), playerUnit: actor.playerUnit,
            mode: actor.tactics.mode, ammo: actor.rifle.ammo, rifleShots: actor.rifle.shots,
            rifleBlocked: actor.aiRifle.blocked, stance: actor.stance,
            firingPose: actor.firingPose, speed: actor.locomotion.speed,
            dadaoSwings: actor.dadao?.swings ?? 0, dadaoHits: actor.dadao?.hits ?? 0 };
        },
        pursuitReviewStart() {
          this.waveFixtureStart();
          sihangCampaign.northWallBreached = true;
          world.breachNorthWall(); solidIndex.synchronize(world.solids);
          squadRoutes.clear(); pathRequests.clear();
          this.waveFixtureCross();
          const attackers = enemies.filter(actor => actor.health > 0 && !actor.vehicleId &&
            !actor.formation.sihangDemolition && actor.hasFirearm !== false && !actor.discharger).slice(0, 4);
          if (attackers.length !== 4) throw new Error('Expected four armed infantry for pursuit review');
          this.pursuitIds = attackers.map(actor => actor.id);
          attackers.forEach((actor, index) => {
            actor.position.set(-25 + index * 3, 0, -30);
            actor.path = actor.pathGoal = actor.target = null; actor.nextPath = 0;
            actor.tactics.sihangEnteredWarehouse = false;
          });
          return this.pursuitReviewSnapshot();
        },
        pursuitReviewStep(seconds) {
          this.waveFixturePathStep(seconds);
          return this.pursuitReviewSnapshot();
        },
        pursuitReviewSnapshot() {
          return { time, counterattack: sihangCampaign.counterattack,
            attackers: this.pursuitIds.map(id => {
              const actor = entities.soldiers.get(id);
              return { id, position: actor.position.toArray(), mode: actor.tactics.mode,
                entered: actor.tactics.sihangEnteredWarehouse,
                pursuit: actor.tactics.sihangPursuit, pathReason: actor.tactics.pathReason,
                path: actor.path?.slice(0, 3), blocked: actor.tactics.blockedBy };
            }) };
        },
        nightFireStart() {
          this.waveFixtureStart();
          this.waveFixtureCross();
          const shooter = enemies.find(actor => actor.health > 0 && !actor.vehicleId &&
            !actor.formation.sihangDemolition && actor.hasFirearm !== false && !actor.discharger);
          const target = controlledSoldier(entities);
          this.nightDischarger = enemies.find(actor => actor.discharger);
          if (!shooter || !this.nightDischarger) throw new Error('Night fixture requires a rifleman and a discharger');
          for (const actor of allForces) if (actor !== shooter && actor !== target) actor.health = 0;
          shooter.tactics.sihangEnteredWarehouse = true;
          const goal = sihangPursuitGoal(shooter);
          shooter.position.set(goal.x, 0, goal.z);
          shooter.tactics.stationCooldownUntil = time + 100000;
          shooter.nextThink = shooter.nextFire = 0;
          target.health = 100000;
          const eye = new THREE.Vector3(shooter.position.x, 1.45, shooter.position.z);
          let found = null;
          for (let z = -90; z < 0 && !found; z += 2) for (let x = -90; x < 90; x += 2) {
            const distance = Math.hypot(x - eye.x, z - eye.z);
            if (distance < 32 || distance > 42 || !sihangNorthBank({x,z}, .5) ||
              world.isDeepWater(x,z) || circleBlocked(x,z,.5,world.obstacles,0) ||
              Math.abs(world.walkHeight(x,z,0)) > .1) continue;
            const aim = new THREE.Vector3(x, 1.45, z);
            if (hasLine(eye, aim, 75)) { found = {x,z}; break; }
          }
          if (!found) throw new Error('No clear north-bank night-fire sightline');
          target.position.set(found.x,0,found.z);
          shooter.heading = Math.atan2(shooter.position.x - found.x, shooter.position.z - found.z);
          actorGrid.rebuild(allForces);
          this.nightShooter = shooter.id; this.nightTarget = target.id;
          sihangCampaign.counterattackAt = sihangCampaign.elapsed - 25;
          return this.nightFireSnapshot();
        },
        nightFireLight() {
          sihangCampaign.counterattackAt = sihangCampaign.elapsed - 3;
          const shooter = entities.soldiers.get(this.nightShooter);
          shooter.nextThink = 0;
          return this.nightFireSnapshot();
        },
        nightFireStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.nightFireSnapshot();
        },
        nightFireSnapshot() {
          const shooter = entities.soldiers.get(this.nightShooter), target = entities.soldiers.get(this.nightTarget);
          const discharger = this.nightDischarger;
          const old = discharger.position.clone(); discharger.position.copy(shooter.position);
          const dischargerVisible = dischargerTargetVisible(discharger, target);
          discharger.position.copy(old);
          return { time, shooter: shooter.position.toArray(), target: target.position.toArray(),
            mode: shooter.tactics.mode, shots: shooter.rifle.shots, aim: shooter.target?.id ?? null,
            visible: sihangNightVisibility(sihangCampaign, shooter.position, target.position),
            dischargerVisible, flare: sihangNight.snapshot.intensity };
        },
        nightFixedStart() {
          const shooter = entities.soldiers.get(this.nightShooter), target = entities.soldiers.get(this.nightTarget);
          const point = emplacements.get('sihang-cover-mg');
          point.team = 'enemy'; point.playerOnly = false; point.engineerBuilt = true;
          const floor = point.altitude ?? world.groundHeight(point.x, point.z);
          const eye = new THREE.Vector3(point.x, floor + point.weapon.settings.muzzleHeight + .8, point.z);
          let found = null;
          for (let z = -90; z < 0 && !found; z += 2) for (let x = -90; x < 90; x += 2) {
            const distance = Math.hypot(x - eye.x, z - eye.z);
            if (distance < 32 || distance > 42 || !sihangNorthBank({x,z}, .5) ||
              world.isDeepWater(x,z) || circleBlocked(x,z,.5,world.obstacles,0) ||
              Math.abs(world.walkHeight(x,z,0)) > .1) continue;
            const aim = new THREE.Vector3(x, 1.45, z);
            if (hasLine(eye, aim, point.weapon.settings.range)) { found = {x,z}; break; }
          }
          if (!found) throw new Error('No clear north-bank fixed-weapon sightline');
          target.position.set(found.x,0,found.z);
          point.heading = point.yaw = Math.atan2(point.x-found.x,point.z-found.z);
          point.operatorId = point.crewId = shooter.id;
          point.weapon.ownerId = shooter.id;
          shooter.emplacementId = shooter.tactics.stationId = point.id;
          shooter.emplacementWeaponId = point.weapon.id;
          const pose = emplacementPose(point, floor);
          shooter.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          actorGrid.rebuild(allForces);
          sihangCampaign.counterattackAt = sihangCampaign.elapsed - 25;
          return this.nightFixedSnapshot();
        },
        nightFixedLight() {
          sihangCampaign.counterattackAt = sihangCampaign.elapsed - 3;
          return this.nightFixedSnapshot();
        },
        nightFixedSnapshot() {
          const point = emplacements.get('sihang-cover-mg'), target = entities.soldiers.get(this.nightTarget),
            shooter = entities.soldiers.get(this.nightShooter);
          const floor = point.altitude ?? world.groundHeight(point.x, point.z);
          const aim = targetAimPoint(target), eye = new THREE.Vector3(point.x, floor + point.weapon.settings.muzzleHeight + .8, point.z);
          const muzzle = emplacementPose(point, floor).muzzle;
          const start = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
          const direction = new THREE.Vector3(aim.x, aim.y, aim.z).sub(start);
          const distance = direction.length(); direction.normalize();
          ray.set(start, direction); ray.far = distance;
          const hit = ray.intersectObjects(solidIndex.candidates(start, direction, distance)
            .filter(object => object.userData.emplacementId !== point.id || object.userData.emplacementCover), true)[0];
          ray.far = Infinity;
          return { time, shots: point.shots, ammo: point.weapon.ammo, operator: point.operatorId,
            visible: sihangNightVisibility(sihangCampaign, point, target.position),
            mode: shooter.tactics.mode, position: target.position.toArray(), aim, heading: point.heading, yaw: point.yaw,
            canAim: emplacementCanAimAt(point, aim, floor), line: hasLine(eye, new THREE.Vector3(aim.x, aim.y, aim.z), point.weapon.settings.range),
            blocker: hit && { distance: hit.distance, name: hit.object.name, emplacementId: hit.object.userData.emplacementId } };
        },
        engineerRetreatStart() {
          this.waveFixtureStart();
          setGameState('playing');
          return { roles: allies.map(actor => actor.role), current: current };
        },
        engineerRetreatSite() {
          const actor = controlledSoldier(entities);
          if (!actor.engineer) throw new Error('Select the actual player engineer first');
          for (const z of [-3, -4, -5, -6]) for (const x of [-32, -28, -24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 24]) {
            for (const heading of [Math.PI / 2, -Math.PI / 2]) {
              actor.position.set(x, 0, z); controlPose.yaw = actor.heading = heading;
              actor.engineer.heading = heading;
              const point = engineerPlacement(actor.position, heading);
              point.y = world.walkHeight(point.x, point.z, actor.position.y);
              if (!engineerPlacementReason(actor, point)) {
                actorGrid.rebuild(allForces);
                return { id: actor.id, position: actor.position.toArray(), point, heading,
                  materials: {...actor.engineer.materials} };
              }
            }
          }
          throw new Error('No clear player construction site on the warehouse quay');
        },
        engineerRetreatStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            for (const actor of enemies) actor.nextFire = time + 1000000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          const actor = controlledSoldier(entities);
          return { time, id: actor.id, held: held.primary, position: actor.position.toArray(),
            construction: {...actor.engineer.construction}, materials: {...actor.engineer.materials},
            works: engineerWorks.filter(work => work.builderId === actor.id)
              .map(work => ({ id: work.point.id, position: [work.point.x, work.point.altitude, work.point.z] })) };
        },
        followControlStart() {
          this.waveFixtureStart(true);
          setGameState('playing');
          return this.followControlSnapshot();
        },
        naturalWithdrawalStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const initial = friendlyForces.filter(actor => actor.health > 0).map(actor => ({
            id: actor.id, playerUnit: actor.playerUnit, position: actor.position.toArray() }));
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return { initial, state: this.naturalWithdrawalSnapshot() };
        },
        naturalWithdrawalPlayerStart(yaw) {
          controlPose.yaw = yaw;
          setGameState('playing');
          return this.naturalWithdrawalSnapshot();
        },
        naturalWithdrawalPause() {
          setGameState('pause');
          return this.naturalWithdrawalSnapshot();
        },
        naturalWithdrawalStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.naturalWithdrawalSnapshot();
        },
        naturalWithdrawalSnapshot() {
          return { time, stage: sihangCampaign.stage, stageElapsed: sihangCampaign.stageElapsed,
            assemblyReleased: sihangCampaign.assemblyReleased, counterattack: sihangCampaign.counterattack,
            wave: sihangCampaign.withdrawalWave && structuredClone(sihangCampaign.withdrawalWave),
            friendly: friendlyForces.filter(actor => actor.health > 0).map(actor => ({
              id: actor.id, playerUnit: actor.playerUnit, position: actor.position.toArray(),
              goal: actor.playerUnit ? playerOrderDestination(actor, controlledSoldier(entities))
                : sihangActorAssemblyGoal(actor), mode: actor.tactics.mode,
              path: actor.path?.slice(0, 3), blocked: actor.tactics.blockedBy })),
            formations: formations.filter(formation => formation.team === 'friendly').map(formation => ({ id: formation.id,
              player: formation.player, retreatAssembled: formation.retreatAssembled,
              living: formation.members.filter(actor => actor.health > 0).length })),
            player: controlledSoldier(entities)?.position.toArray() ?? null,
            enemyAlive: enemies.filter(actor => actor.health > 0).length };
        },
        waveFixturePlayerYieldStart() {
          this.waveFixtureStart(true);
          const player = controlledSoldier(entities), wave = sihangCampaign.withdrawalWave;
          const follower = allies.find(actor => actor !== player && actor.health > 0);
          const waitingId = wave.squads.find((ids, slot) => slot !== wave.coverSlot)?.find(id =>
            entities.soldiers.get(id)?.health > 0);
          const waiting = entities.soldiers.get(waitingId);
          const blockers = wave.squads.flat().filter(id => id !== waitingId).map(id =>
            entities.soldiers.get(id)).filter(actor => actor && actor.health > 0).slice(0, 3);
          if (!player || !follower || !waiting || blockers.length !== 3)
            throw new Error('Player-yield fixture requires a living player squad and retreat wave');
          for (const actor of friendlyForces) actor.tactics.traffic = null;
          const positions = [[40.891921, -17.69464], [39.27171, -17.362874],
            [39.361655, -16.249706], [41.075256, -16.520925]];
          for (const [actor, [x, z]] of [[follower, positions[0]],
            ...blockers.map((actor, index) => [actor, positions[index + 1]])])
            actor.position.set(x, world.walkHeight(x, z, 0), z);
          const waitingX = 40.22841, waitingZ = -16.912818;
          waiting.position.set(waitingX, world.walkHeight(waitingX, waitingZ, 0), waitingZ);
          waiting.tactics.mode = 'wait-for-spacing';
          waiting.tactics.blockedBy = follower.id;
          waiting.tactics.traffic = { waitSeconds: 3, direction: { x: .185506, z: -.982643 },
            progress: { x: waitingX, z: waitingZ }, yieldPoint: null, until: 0, side: 1, reason: null };
          follower.tactics.sihangTrafficYield = null;
          player.position.set(50, world.walkHeight(50, -25, 0), -25);
          player.locomotion.speed = 0;
          follower.order = 'follow';
          for (const enemy of enemies) enemy.health = 0;
          const before = follower.position.clone();
          const runAI = phase => {
            try {
              aiCursor = allForces.indexOf(follower);
              aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            }
            catch (error) {
              const invalidTraffic = allForces.filter(actor =>
                actor.tactics.traffic && !actor.tactics.traffic.progress).map(actor => ({
                id: actor.id, playerUnit: actor.playerUnit, mode: actor.tactics.mode,
                traffic: actor.tactics.traffic }));
              throw new Error('Player-yield ' + phase + ' AI update failed; invalid traffic=' +
                JSON.stringify(invalidTraffic) + '; ' + error.message);
            }
          };
          setGameState('playing');
          let frames = 0;
          while (frames < 120 && Math.hypot(follower.position.x - before.x,
            follower.position.z - before.z) <= .01) {
            runAI('stationary');
            frames++;
          }
          const state = follower.tactics.sihangTrafficYield;
          const mode = follower.tactics.mode, after = follower.position.toArray();
          const scheduler = { followerIndex: allForces.indexOf(follower), aiCursor,
            controlledId: entities.control.soldierId, currentId: allies[current]?.id };
          this.waveYieldFollowerId = follower.id;
          return { follower: follower.id, order: follower.order, waiting: waiting.id,
            goal: state?.goal, state, mode, before: before.toArray(), after, frames,
            stage: sihangCampaign.stage, assemblyReleased: sihangCampaign.assemblyReleased,
            playerUnit: follower.playerUnit, formationPlayer: follower.formation.player,
            formationAssembled: follower.formation.retreatAssembled, scheduler,
            playerBefore: player.position.toArray() };
        },
        waveFixturePlayerYieldSnapshot() {
          const follower = entities.soldiers.get(this.waveYieldFollowerId), player = controlledSoldier(entities);
          return { follower: follower.id, order: follower.order,
            position: follower.position.toArray(), mode: follower.tactics.mode,
            yield: follower.tactics.sihangTrafficYield ?? null, player: player.position.toArray() };
        },
        followControlSnapshot() {
          const player = controlledSoldier(entities);
          return { player: player.id, index: player.index, position: player.position.toArray(),
            allies: allies.filter(actor => actor.health > 0).map(actor => ({ id: actor.id, order: actor.order,
              position: actor.position.toArray(), goal: actor === player ? null : playerOrderDestination(actor, player) })) };
        },
        followAimAtGround() { controlPose.pitch = -1; },
        waveFixtureCross() {
          const wave = sihangCampaign.withdrawalWave;
          const id = wave.squads.find((ids, slot) => slot !== wave.coverSlot && ids.length)[0];
          entities.soldiers.get(id).position.set(88, 0, 35);
          updateSihangMission(.05);
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time); setGameState('pause');
          return this.waveFixtureSnapshot();
        },
        waveFixtureAttack() {
          const wave = sihangCampaign.withdrawalWave;
          const actor = entities.soldiers.get(wave.squads[wave.coverSlot][0]);
          const attacker = enemies.find(enemy => enemy.health > 0 && !enemy.vehicleId && enemy.hasFirearm !== false);
          setGameState('playing');
          hurt(actor, 1, captureAttackSource(entities, attacker, attacker.rifle), 'rifle', 'torso');
          aiDecisions.beginFrame(); advanceBattleStep(.05, time); setGameState('pause');
          return this.waveFixtureSnapshot();
        },
        waveFixtureResolveMain() {
          const wave = sihangCampaign.withdrawalWave;
          for (const [slot, ids] of wave.squads.entries()) if (slot !== wave.coverSlot)
            for (const id of ids) {
              const actor = entities.soldiers.get(id);
              if (actor && !sihangCampaign.evacuatedIds.includes(id)) actor.health = 0;
            }
          updateSihangMission(.05);
          return this.waveFixtureSnapshot();
        },
        waveFixtureThreat() {
          const wave = sihangCampaign.withdrawalWave;
          const cover = wave.squads[wave.coverSlot].map(id => entities.soldiers.get(id));
          const otherWave = wave.squads.flatMap((ids, slot) => slot === wave.coverSlot ? [] : ids)
            .map(id => entities.soldiers.get(id)).filter(actor => actor?.health > 0);
          for (const [index, actor] of otherWave.entries())
            actor.position.set(35 + index % 11 * 1.1, 0, -18 - Math.floor(index / 11) * 1.1);
          actorGrid.rebuild(allForces);
          const enemy = enemies.find(actor => actor.health > 0 && !actor.vehicleId &&
            !actor.formation.sihangDemolition && actor.hasFirearm !== false);
          if (!enemy) throw new Error('Cover fixture requires a living armed enemy');
          const point = { x: -15, z: -4 };
          if (world.isDeepWater(point.x, point.z) || circleBlocked(point.x, point.z, .35, world.obstacles))
            throw new Error('Cover fixture requires dry unobstructed ground');
          enemy.position.set(point.x, 0, point.z);
          enemy.health = 100000; enemy.nextFire = time + 1000;
          for (const actor of cover) {
            actor.heading = Math.atan2(actor.position.x - point.x, actor.position.z - point.z);
            actor.nextThink = 0;
          }
          this.waveThreatId = enemy.id;
          return this.waveFixtureSnapshot();
        },
        waveFixtureResolveCover() {
          const wave = sihangCampaign.withdrawalWave;
          for (const id of wave.squads[wave.coverSlot]) {
            const actor = entities.soldiers.get(id);
            if (actor && actor.health > 0) actor.position.set(88, 0, 35);
          }
          updateSihangMission(.05);
          this.waveSpawnRecords = [];
          this.waveGenerations = formations.filter(f => f.team === 'friendly' && !f.player).map(f => f.generation);
          return this.waveFixtureSnapshot();
        },
        waveFixtureStep(seconds, safeRefill = false) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            if (safeRefill) {
              for (const actor of friendlyForces) if (actor.health > 0) actor.health = 100000;
              for (const actor of enemies) actor.nextFire = time + 1000000;
              for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            }
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            if (this.waveGenerations) for (const [slot, formation] of formations.filter(f => f.team === 'friendly' && !f.player).entries()) {
              if (formation.generation > this.waveGenerations[slot]) {
                this.waveSpawnRecords.push({ slot, time, elapsed: sihangCampaign.elapsed });
                this.waveGenerations[slot] = formation.generation;
              }
            }
          }
          setGameState('pause');
          return this.waveFixtureSnapshot();
        },
        waveFixturePathStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            for (const actor of allForces) {
              if (actor.friendly && actor.health > 0) actor.health = 100000;
              if (!actor.friendly) actor.nextFire = time + 1000000;
            }
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.waveFixtureSnapshot();
        },
        waveFixtureAssembleNext() {
          for (const actor of friendlyAI.filter(actor => actor.health > 0 && !actor.sihangEvacuated)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched'; actor.heading = -Math.PI / 2;
          }
          updateSihangMission(.05);
          return this.waveFixtureSnapshot();
        },
        waveFixturePlayerAway() {
          controlledSoldier(entities).position.set(5, 0, -20);
        },
        waveFixtureSnapshot() {
          const wave = sihangCampaign.withdrawalWave;
          const cover = wave?.squads[wave.coverSlot] ?? [];
          const coverSight = wave?.covering ? cover.map(id => {
            const actor = entities.soldiers.get(id);
            if (!actor || actor.health <= 0) return { id, candidates: [] };
            const origin = soldierRifleMuzzle(actor);
            const muzzle = new THREE.Vector3(origin.x, origin.y, origin.z);
            const eye = soldierEyePosition(actor);
            return { id, position: actor.position.toArray(), candidates: enemies.filter(target =>
              target.health > 0 && !target.vehicleId && target.hasFirearm !== false).map(target => {
              const aim = targetAimPoint(target);
              const distance = actor.position.distanceTo(target.position);
              const blockers = actorGrid.near(actor.position.x, actor.position.z, muzzle.distanceTo(aim))
                .filter(other => other !== actor && other.friendly === actor.friendly && other.health > 0 &&
                  other.targetKind !== 'aircraft').filter(other => {
                  const segment = pointSegmentDistance(other.position, muzzle, aim);
                  const lineY = muzzle.y + (aim.y - muzzle.y) * segment.fraction;
                  return segment.fraction > .03 && segment.fraction < .97 && segment.distance < .55 &&
                    lineY > other.position.y - .1 &&
                    lineY < other.position.y + soldierPostureHeight(other, 'body');
                }).map(other => other.id);
              return { id: target.id, position: target.position.toArray(), distance,
                visible: sihangNightVisibility(sihangCampaign, actor.position, target.position),
                clearShot: Boolean(clearAIRifleLine(actor, new THREE.Vector3(eye.x, eye.y, eye.z), aim)),
                terrainClear: hasLine(muzzle, aim, 75), blockers };
            }).sort((a, b) => a.distance - b.distance).slice(0, 3) };
          }) : [];
          return { elapsed: sihangCampaign.elapsed, wave: wave && structuredClone(wave),
            reserve: sihangCampaign.retreatReserve, saved: sihangCampaign.evacuatedIds.length,
            lost: sihangCampaign.retreatLostIds.length, total: sihangCampaign.retreatTotal,
            counterattack: sihangCampaign.counterattack, voice: sihangVoices?.snapshot,
            coverSight,
            yielding: friendlyForces.filter(actor => actor.tactics.sihangTrafficYield).map(actor => ({
              id: actor.id, playerUnit: actor.playerUnit, order: actor.order, position: actor.position.toArray(),
              state: actor.tactics.sihangTrafficYield, mode: actor.tactics.mode })),
            coverModes: cover.map(id => entities.soldiers.get(id)?.tactics.mode ?? null),
            coverShots: cover.map(id => ({ id, shots: entities.soldiers.get(id)?.rifle.shots ?? 0,
              ammo: entities.soldiers.get(id)?.rifle.ammo, nextFire: entities.soldiers.get(id)?.nextFire,
              aim: entities.soldiers.get(id)?.aiRifle,
              observation: { sense: entities.soldiers.get(id)?.tactics.threatSense,
                targetId: entities.soldiers.get(id)?.tactics.threatId,
                time: entities.soldiers.get(id)?.tactics.observedAt },
              target: entities.soldiers.get(id)?.tactics.threatId ?? null,
              lastShot: entities.soldiers.get(id)?.tactics.lastShot ?? null })),
            retreatCombat: wave?.squads.flatMap((ids, slot) => ids.map(id => {
              const actor = entities.soldiers.get(id);
              return actor && { id, slot, rifleAmmo: actor.rifle.ammo, rifleAction: actor.rifle.action,
                rifleShots: actor.rifle.shots, dadaoEquipped: actor.dadao?.equipped ?? false,
                dadaoSwings: actor.dadao?.swings ?? 0, dadaoHits: actor.dadao?.hits ?? 0,
                mode: actor.tactics.mode, targetId: actor.tactics.threatId ?? null };
            }).filter(Boolean)) ?? [],
            pending: wave?.squads.flatMap((ids, slot) => ids.filter(id =>
              !sihangCampaign.evacuatedIds.includes(id) && !sihangCampaign.retreatLostIds.includes(id)).map(id => {
              const actor = entities.soldiers.get(id);
              const blocker = entities.soldiers.get(actor?.tactics.blockedBy);
              return { id, slot, position: actor?.position.toArray(), goal: actor && sihangRetreatGoal(actor),
                mode: actor?.tactics.mode, blocked: actor?.tactics.blockedBy,
                blocker: blocker && { id: blocker.id, playerUnit: blocker.playerUnit, friendly: blocker.friendly,
                  position: blocker.position.toArray(), mode: blocker.tactics.mode },
                target: actor?.target && { id: actor.target.id, health: actor.target.health,
                  position: actor.target.position.toArray() },
                nearby: actor && allForces.filter(other => other !== actor && other.health > 0 &&
                  Math.abs(other.position.y - actor.position.y) < 1.5 &&
                  Math.hypot(other.position.x - actor.position.x, other.position.z - actor.position.z) < 2)
                  .map(other => ({ id: other.id, friendly: other.friendly, playerUnit: other.playerUnit,
                    health: other.health, position: other.position.toArray(), mode: other.tactics.mode })),
                traffic: actor?.tactics.traffic, path: actor?.path?.slice(0, 3) };
            })) ?? [],
            geometryErrors: this.geometryErrors(),
            spawnRecords: this.waveSpawnRecords ?? [],
            threatId: this.waveThreatId ?? null,
            generations: formations.filter(f => f.team === 'friendly' && !f.player).map(f => f.generation) };
        },
        enemyRegroupStart(reachable = false) {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const actor of allForces) actor.health = 100000;
          const intruder = enemies.find(actor => !actor.vehicleId && !actor.formation.sihangDemolition);
          if (!intruder) throw new Error('Enemy regroup fixture requires an infantryman');
          intruder.position.set(-20, 0, -30);
          const tanks = [...entities.vehicles.values()].filter(v => v.type === 'tank' && v.team === 'enemy' && v.health > 0);
          if (tanks.length !== 2) throw new Error('Enemy regroup fixture requires both original tanks');
          for (const tank of tanks) {
            const sign = entities.units.get(tank.unitId).armorSlot === 0 ? -1 : 1;
            const start = [45, 50, 55, 60, 65].flatMap(x => (reachable ? [-30, -35, -40] : [-30, -24, -18]).map(z => ({ x: x * sign, z })))
              .find(point => sihangNorthBank(point, 3) &&
                armorNavigate.canSpawn(point, tanks.filter(other => other !== tank)) &&
                (!reachable || createNavigator(world.armorObstacles, 1.5, 3.1)(tank.position, point).length));
            if (!start) throw new Error('Enemy regroup tank start must be clear and connected: ' +
              JSON.stringify({ slot: entities.units.get(tank.unitId).armorSlot, position: tank.position.toArray() }));
            tank.position.set(start.x, 0, start.z);
          }
          this.regroupIntruder = intruder.id;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return this.enemyRegroupSnapshot();
        },
        enemyRegroupStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            for (const actor of allForces) actor.nextFire = time + 1000000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.enemyRegroupSnapshot();
        },
        enemyRegroupSnapshot() {
          return { time, counterattack: sihangCampaign.counterattack, intruder: this.regroupIntruder,
            infantry: enemies.filter(a => a.health > 0 && !a.vehicleId).map(a => ({
              id: a.id, position: a.position.toArray(), post: sihangEnemyPosts[a.formation.index * 11 + a.index],
              mode: a.tactics.mode, blocked: a.tactics.blockedBy, path: a.path?.slice(0, 3) })),
            tanks: [...entities.vehicles.values()].filter(v => v.type === 'tank' && v.team === 'enemy' && v.health > 0)
              .map(v => ({ id: v.id, position: v.position.toArray(), health: v.health,
                slot: entities.units.get(v.unitId).armorSlot, heading: v.heading, speed: v.speed,
                ai: v.ai && { mode: v.ai.mode, goal: v.ai.goal, path: v.ai.path?.slice(0, 3),
                  pathAt: v.ai.pathAt }, navigation: armorNavigate.stats(v),
                staticPath: v.ai?.goal && createNavigator(world.armorObstacles, 1.5, 3.1)(v.position, v.ai.goal),
                nearbyProtected: enemies.filter(a => a.health > 0 && a.tactics.sihangDemolitionReturned &&
                  Math.hypot(a.position.x - v.position.x, a.position.z - v.position.z) < 10)
                  .map(a => ({ id: a.id, position: a.position.toArray() })),
                crew: v.seats.map(seat => entities.soldiers.get(seat.occupantId)?.health ?? null) })) };
        },
        boundaryStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of friendlyForces) actor.health = 100000;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return this.boundaryPlace('sihang-cover-gun');
        },
        playerSpawnReview() {
          const defenseChoices = deploymentSpawnChoices('infantry').map(point => point.id);
          this.waveFixtureStart();
          const retreatChoices = deploymentSpawnChoices('infantry').map(point => point.id);
          for (const actor of allies) actor.health = 0;
          setGameState('dead');
          sihangCampaign.coverRespawnAt = 0;
          deploy('infantry', 'sihang-assembly-player');
          return { defenseChoices, retreatChoices, state, spawnId: unit?.spawnId,
            positions: allies.filter(actor => actor.health > 0).map(actor => actor.position.toArray()),
            error: document.getElementById('deployment-error').textContent };
        },
        playerSpawnUIStart() {
          this.waveFixtureStart();
          for (const actor of allies) actor.health = 0;
          showOverlay('dead');
          sihangCampaign.coverRespawnAt = 0;
          refreshDeployment();
        },
        boundaryPlace(id) {
          const actor = controlledSoldier(entities);
          setGameState('playing');
          releaseEmplacement(actor); keys.clear(); playerInput.clearFire();
          held.primary = held.secondary = held.aiming = false;
          const point = emplacements.get(id);
          const position = point ? emplacementPose(point, 0).operator : { x: 90, y: 0, z: 35 };
          actor.position.set(position.x, position.y, position.z);
          actor.stance = 'standing'; actor.firingPose = null;
          stopLocomotion(actor.locomotion);
          setGameState('playing');
          return this.boundarySnapshot();
        },
        boundaryStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.boundarySnapshot();
        },
        boundaryCrossing() {
          const player = controlledSoldier(entities);
          if (player.sihangEvacuated || sihangCampaign.assemblyReleased)
            throw new Error('Premature crossing must not lock the player out of the assembly');
          player.position.set(56, 0, -25);
          for (const actor of friendlyForces.filter(actor => actor !== player && actor.health > 0)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched'; actor.heading = -Math.PI / 2;
          }
          updateSihangMission(0);
          const waitedForPlayer = !sihangCampaign.assemblyReleased;
          const playerGoal = sihangActorAssemblyGoal(player);
          player.position.set(playerGoal.x, playerGoal.y, playerGoal.z);
          updateSihangMission(.05);
          for (const actor of friendlyForces.filter(actor => actor !== player && actor.health > 0)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched'; actor.heading = -Math.PI / 2;
          }
          updateSihangMission(.05);
          if (!sihangCampaign.assemblyReleased) throw new Error('All present soldiers and the returned player must release the assembly');
          const release = { elapsed: sihangCampaign.elapsed, stageElapsed: sihangCampaign.stageElapsed,
            wave: sihangCampaign.withdrawalWave && structuredClone(sihangCampaign.withdrawalWave) };
          const actor = friendlyAI.find(actor => actor.health > 0 && !actor.sihangEvacuated);
          actor.position.set(90, 0, 35);
          updateSihangMission(.05);
          return { ...this.boundarySnapshot(), waitedForPlayer, release };
        },
        boundarySnapshot() {
          const actor = controlledSoldier(entities);
          sihangNight.update(sihangCampaign);
          return { time, state, controlled: actor.id, position: actor.position.toArray(), traversal: actor.traversal.kind,
            focus: focusEmplacement(actor)?.id ?? null, door: world.doorSystem.focus(camera)?.id ?? null,
            pointerLock: Boolean(document.pointerLockElement), toast: document.getElementById('toast')?.textContent,
            ammo: actor.rifle.ammo,
            grenades: { ammo: actor.grenades.ammo, packs: actor.grenades.packs, action: actor.grenades.action?.phase ?? null },
            mounted: actor.emplacementId ?? null, counterattack: sihangCampaign.counterattack,
            evacuated: Boolean(actor.sihangEvacuated), released: sihangCampaign.assemblyReleased,
            night: sihangNight.snapshot, shells: shells.length, activeGrenades: grenades.active.length,
            enemyAmmo: enemies.filter(actor => actor.health > 0 && !actor.vehicleId).map(actor => [actor.id, actor.rifle.ammo]),
            planes: [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'plane' && vehicle.health > 0).length,
            positions: [...emplacements.values()].filter(point => point.retreatCover).map(point =>
              ({ id: point.id, health: point.health, ammo: point.weapon.ammo, operator: point.operatorId,
                position: [point.x, point.altitude, point.z] })) };
        },
        start() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          this.exitedIds = new Set(); this.exitRecords = []; this.maximumStatic = 0; this.fadeImage = null;
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of enemies) actor.health = 0;
          for (const actor of friendlyForces) actor.health = 100000;
          const player = controlledSoldier(entities);
          player.position.set(8, 0, -4);
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return this.snapshot();
        },
        step(seconds) {
          const started = performance.now(), peaks = [];
          for (let i = 0; i < Math.round(seconds / .05) && !sihangCampaign.outcome; i++) {
            setGameState('playing'); aiDecisions.beginFrame();
            const player = controlledSoldier(entities);
            if (sihangCampaign.assemblyReleased && !player.sihangEvacuated) {
              const goal = sihangRetreatGoal(player);
              if (!player.path?.length) {
                player.path = world.elevatedPath(player.position, goal);
                player.pathGoal = goal;
              }
              walkActor(player, goal, 3.5, .05, true);
            }
            const before = performance.now(); advanceBattleStep(.05, time);
            this.maximumStatic = Math.max(this.maximumStatic, sihangParade.count);
            for (const actor of friendlyForces) if (actor.sihangEvacuationOpacity < 1) {
              if (!this.exitedIds.has(actor.id)) {
                this.exitedIds.add(actor.id);
                this.exitRecords.push({ id: actor.id, position: actor.position.toArray(),
                  slot: actor.sihangParadeSlot, goal: actor.sihangParadeGoal });
              }
              if (!this.fadeImage && actor.sihangEvacuationOpacity >= .35 && actor.sihangEvacuationOpacity <= .6)
                this.fadeImage = this.capture([75, 8, 79], [61, 1, 66]);
            }
            if (performance.now() - before > 50) peaks.push({ time, ms: performance.now() - before });
          }
          setGameState('pause');
          return { ...this.snapshot(), wallMs: performance.now() - started, peaks };
        },
        snapshot() {
          return { fixture: 'full-finite-roster-real-walking-no-enemy-interference', time, stage: sihangCampaign.stage, outcome: sihangCampaign.outcome,
            open: sihangCampaign.playerRetreatOpen, evacuated: sihangCampaign.evacuatedIds.length,
            total: sihangCampaign.retreatTotal, reserve: sihangCampaign.reserve, released: sihangCampaign.assemblyReleased,
            counterattack: sihangCampaign.counterattack, static: sihangParade.count,
            maximumStatic: this.maximumStatic, faded: this.exitedIds?.size ?? 0,
            player: controlledSoldier(entities)?.position.toArray(),
            formations: formations.filter(f => f.team === 'friendly').map(f => ({
              id: f.id, size: f.members.filter(a => a.health > 0 && !a.sihangEvacuated).length,
              generation: f.generation, assembled: f.retreatAssembled, blocked: f.blockedReason,
              respawnAt: f.respawnAt, withdrawAt: f.withdrawAt })),
            navigation: world.navigationStats,
            remaining: friendlyForces.filter(a => a.health > 0 && a.id !== entities.control.soldierId)
              .map(a => ({ id: a.id, index: a.index, p: a.position.toArray(), mode: a.tactics.mode,
                goal: a.pathGoal, path: a.path?.slice(0, 3), reason: a.tactics.pathReason,
                preferredStair: a.tactics.preferredStair, blocked: a.tactics.blockedBy,
                stuck: a.stuckTime, progress: a.tactics.pathProgress,
                assemblyRoute: a.sihangAssemblyRoute, nextPath: a.nextPath,
                request: pathRequests.get(a.tactics.id)?.target, heading: a.heading,
                traffic: a.tactics.traffic, turning: a.turningToPath, stance: a.stance,
                locomotion: a.locomotion, postureReady: postureReady(a), posture: a.nativeMotion?.posture,
                emplacement: a.emplacementId, grounded: a.traversal.kind, paradeGoal: a.sihangParadeGoal,
                assembly: sihangActorAssemblyGoal(a) }))
          };
        }
      };` });
  });
  const url = new URL('/?campaign=sihang&resources=low-memory', process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await (async () => {
    await page.waitForFunction(() => window.retreatReview || !document.getElementById('fatal').hidden,
      null, { timeout: 300000 });
    await deployFromMenu(page);
  })().catch(async error => {
    await writeFile(join(directory, 'deployment-error.json'), JSON.stringify({ errors,
      fatal: await page.locator('#fatal-message').textContent(),
      loading: await page.locator('#loading').textContent(),
      body: (await page.locator('body').innerText()).slice(-8000),
      battle: await page.evaluate(() => window.__battle?.state ?? null) }, null, 2));
    throw error;
  });
  await page.waitForFunction(() => window.retreatReview && window.__battle?.state === 'playing' ||
    !document.querySelector('#fatal').hidden,
    null, { timeout: 180000 }).catch(async error => {
    await writeFile(join(directory, 'startup-error.json'), JSON.stringify({ errors,
      fatal: await page.locator('#fatal-message').textContent(),
      loading: await page.locator('#loading').textContent(),
      battle: await page.evaluate(() => window.__battle?.state ?? null) }, null, 2));
    throw error;
  });
  if (await page.locator('#fatal').isVisible()) {
    await writeFile(join(directory, 'startup-error.json'), JSON.stringify({ errors,
      fatal: await page.locator('#fatal-message').textContent() }, null, 2));
    throw new Error(await page.locator('#fatal-message').textContent());
  }
  await page.waitForFunction(() => !document.querySelector('#loading') ||
    document.querySelector('#loading').hidden, null, { timeout: 180000 });
  if (process.env.PLAYER_SPAWN_UI_REVIEW_ONLY === '1') {
    await page.evaluate(() => retreatReview.playerSpawnUIStart());
    await page.locator('#redeploy-choices [data-type="infantry"]').click();
    const choices = await page.locator('#spawn-choices [data-spawn]').evaluateAll(nodes =>
      nodes.map(node => ({ id: node.dataset.spawn, disabled: node.disabled })));
    assert.ok(choices.some(point => point.id === 'sihang-south-cover'));
    assert.ok(choices.some(point => point.id === 'sihang-assembly-player' && !point.disabled));
    await page.locator('#spawn-choices [data-spawn="sihang-assembly-player"]').click();
    await page.locator('#confirm-deploy').click();
    await page.waitForFunction(() => window.__battle.state === 'playing' &&
      window.__battle.spawnId === 'sihang-assembly-player', null, { timeout: 30000 });
    const result = await page.evaluate(() => ({ state: window.__battle.state, spawnId: window.__battle.spawnId,
      allies: window.__battle.allies.filter(actor => actor.health > 0).map(actor => actor.spawnId) }));
    await writeFile(join(directory, 'player-spawn-ui.json'), JSON.stringify({ fixture:
      'manual-wave-assembly-and-deaths-actual-deployment-ui', choices, result, errors }, null, 2));
    assert.equal(result.allies.length, 11);
    assert.ok(result.allies.every(id => id === 'sihang-assembly-player'));
    assert.deepEqual(errors, []);
    console.log('Player spawn UI passed.');
  }
  if (process.env.PURSUIT_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.pursuitReviewStart())];
    for (let step = 0; step < 12; step++) {
      records.push(await page.evaluate(() => retreatReview.pursuitReviewStep(5)));
      await writeFile(join(directory, 'pursuit.json'), JSON.stringify({
        fixture: 'manual-warehouse-positions-artificial-breach-and-counterattack-firing-disabled-health-raised',
        records, errors }, null, 2));
    }
    const first = records[0], last = records.at(-1);
    assert.equal(last.counterattack, true);
    assert.ok(last.attackers.every(actor => actor.entered && actor.pursuit === 'intercept-withdrawal'));
    assert.ok(last.attackers.filter((actor, index) => actor.position[0] - first.attackers[index].position[0] > 8).length >= 3,
      'armed soldiers inside the warehouse must physically progress toward the retreat corridor');
    assert.deepEqual(errors, []);
  }
  if (process.env.EMPLACEMENT_REVIEW_ONLY === '1') {
    const initial = await page.evaluate(() => retreatReview.boundaryStart());
    const image = await page.evaluate(() => retreatReview.capture([48, 30, -5], [48, 0, -38]));
    await writeFile(join(directory, 'retreat-emplacements.png'), Buffer.from(image, 'base64'));
    const records = [];
    for (const point of initial.positions.filter(item => item.id !== 'sihang-cover-aa')) {
      await page.evaluate(id => retreatReview.boundaryPlace(id), point.id);
      await page.keyboard.press('f');
      const mounted = await page.evaluate(() => retreatReview.boundarySnapshot());
      assert.equal(mounted.mounted, point.id, 'F must enter the prepared emplacement');
      await page.mouse.down();
      await page.evaluate(() => retreatReview.boundaryStep(.5));
      await page.mouse.up();
      const fired = await page.evaluate(() => retreatReview.boundarySnapshot());
      assert.ok(fired.positions.find(item => item.id === point.id).ammo < point.ammo,
        'the actual weapon must fire its owned ammunition');
      records.push({ mounted, fired });
    }
    if (process.env.PLAYER_ASSEMBLY_SPAWN_REVIEW_ONLY === '1') {
      const result = await page.evaluate(() => retreatReview.playerSpawnReview());
      await writeFile(join(directory, 'player-assembly-spawn.json'), JSON.stringify({ fixture:
        'manual-wave-assembly-and-deaths-actual-deployment-call', result, errors }, null, 2));
      assert.ok(!result.defenseChoices.includes('sihang-assembly-player'));
      assert.ok(result.retreatChoices.includes('sihang-assembly-player'));
      assert.ok(result.retreatChoices.includes('sihang-south-cover'));
      assert.equal(result.spawnId, 'sihang-assembly-player', result.error);
      assert.equal(result.positions.length, 11);
      assert.ok(result.positions.every(([x, y, z]) => x >= -33 && x <= -12 && Math.abs(y) < .1 && z >= -7.4 && z <= -1));
      assert.deepEqual(errors, []);
    }
    await writeFile(join(directory, 'retreat-emplacements.json'), JSON.stringify({
      fixture: 'manual-stage-transition-and-player-placement-actual-F-and-fire-input', initial, records, errors }, null, 2));
    assert.equal(records.length, 4);
    assert.deepEqual(errors, []);
  }
  if (process.env.NIGHT_FIRE_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.nightFireStart())];
    records.push(await page.evaluate(() => retreatReview.nightFireStep(6)));
    records.push(await page.evaluate(() => retreatReview.nightFireLight()));
    records.push(await page.evaluate(() => retreatReview.nightFireStep(10)));
    await writeFile(join(directory, 'night-fire.json'), JSON.stringify({
      fixture: 'two-man-isolated-north-bank-normal-sightlines-target-health-raised',
      records, errors }, null, 2));
    assert.equal(records[0].visible, false);
    assert.equal(records[0].dischargerVisible, false);
    assert.equal(records[1].shots, records[0].shots, 'an unseen distant target must not be shot in moonlight');
    assert.equal(records[2].visible, true);
    assert.equal(records[2].dischargerVisible, true);
    assert.ok(records[3].shots > records[2].shots, 'a visible distant target must be fired on under flares');
    const fixed = [await page.evaluate(() => retreatReview.nightFixedStart())];
    await page.evaluate(() => retreatReview.nightFireStep(6));
    fixed.push(await page.evaluate(() => retreatReview.nightFixedSnapshot()));
    fixed.push(await page.evaluate(() => retreatReview.nightFixedLight()));
    await page.evaluate(() => retreatReview.nightFireStep(8));
    fixed.push(await page.evaluate(() => retreatReview.nightFixedSnapshot()));
    await writeFile(join(directory, 'night-fixed.json'), JSON.stringify({
      fixture: 'isolated-fixed-gun-reassigned-to-japanese-operator-target-health-raised', fixed, errors }, null, 2));
    assert.equal(fixed[0].visible, false);
    assert.equal(fixed[1].shots, fixed[0].shots, 'fixed guns must not fire at unseen distant targets');
    assert.equal(fixed[2].visible, true);
    assert.ok(fixed[3].shots > fixed[2].shots, 'fixed guns must engage a visible target under flares');
    assert.deepEqual(errors, []);
  }
  if (process.env.RETREAT_ENGINEER_REVIEW_ONLY === '1') {
    const start = await page.evaluate(() => retreatReview.engineerRetreatStart());
    const engineer = start.roles.indexOf('engineer');
    assert.ok(engineer >= 0);
    for (let index = start.current; index !== engineer; index = (index + 1) % start.roles.length)
      await page.keyboard.press('y');
    const site = await page.evaluate(() => retreatReview.engineerRetreatSite());
    await page.keyboard.press('2');
    await page.mouse.down();
    const records = [];
    for (let step = 0; step < 5; step++) records.push(await page.evaluate(() => retreatReview.engineerRetreatStep(5)));
    await page.mouse.up();
    await writeFile(join(directory, 'retreat-engineer.json'), JSON.stringify({
      fixture: 'manual-quay-site-actual-y-tool-and-mouse-held-enemy-fire-disabled-health-raised',
      site, records, errors }, null, 2));
    assert.equal(records.at(-1).id, site.id);
    assert.equal(records.at(-1).works.length, 1, 'the player engineer must really build on the north-bank quay');
    assert.equal(records.at(-1).materials.maxim24, 0);
    assert.equal(records.at(-1).materials.bofors75, 1);
    assert.deepEqual(errors, []);
  }
  if (process.env.FOLLOW_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.followControlStart())];
    const save = () => writeFile(join(directory, 'follow-control.json'), JSON.stringify({ fixture:
      'manually-assembled-actual-keyboard-y-and-movement-normal-combat', records, errors }, null, 2));
    await save();
    await page.keyboard.press('y');
    records.push(await page.evaluate(() => retreatReview.followControlSnapshot()));
    await save();
    assert.notEqual(records[1].player, records[0].player, 'Y must switch the real controlled soldier');
    assert.ok(records[1].allies.every(actor => actor.order === 'follow'));
    await page.keyboard.down('w');
    await page.waitForTimeout(1800);
    await page.keyboard.up('w');
    records.push(await page.evaluate(() => retreatReview.followControlSnapshot()));
    await save();
    assert.ok(Math.hypot(records[2].position[0] - records[1].position[0],
      records[2].position[2] - records[1].position[2]) > .05, 'the controlled soldier must physically move');
    assert.ok(records[2].allies.every(actor => actor.order === 'follow' &&
      (!actor.goal || [actor.goal.x, actor.goal.y, actor.goal.z].every(Number.isFinite))));
    await page.evaluate(() => retreatReview.followAimAtGround());
    await page.keyboard.press('x');
    records.push(await page.evaluate(() => retreatReview.followControlSnapshot()));
    await save();
    assert.ok(records[3].allies.every(actor => actor.order === 'hold' || actor.order === 'advance'),
      'a short X command must remain a real non-follow order');
    await page.keyboard.down('x');
    await page.waitForTimeout(600);
    await page.keyboard.up('x');
    records.push(await page.evaluate(() => retreatReview.followControlSnapshot()));
    await save();
    assert.ok(records[4].allies.every(actor => actor.order === 'follow'),
      'a long X command must restore follow');
    assert.deepEqual(errors, []);
    console.log('Follow controls passed.');
  }
  if (process.env.WAVE_FOLLOW_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => retreatReview.waveFixturePlayerYieldStart());
    await writeFile(join(directory, 'wave-follow-yield.json'), JSON.stringify({ fixture:
      'manually-assembled-live-wave-production-AI-follow-yield-and-keyboard-movement-cancellation',
      result, errors }, null, 2));
    assert.ok(result.goal && [result.goal.x, result.goal.y, result.goal.z].every(Number.isFinite),
      'a stationary player follow soldier blocking a retreat lane must find a finite clear sidestep');
    assert.ok(Math.hypot(result.after[0] - result.before[0], result.after[2] - result.before[2]) > .01,
      'the blocked player follow soldier must actually move in the production AI update');
    assert.equal(result.order, 'follow', 'yielding must preserve the player soldier follow order');
    await page.keyboard.down('w');
    await page.waitForTimeout(350);
    const moving = await page.evaluate(() => retreatReview.waveFixturePlayerYieldSnapshot());
    await page.keyboard.up('w');
    await page.waitForTimeout(150);
    const stopped = await page.evaluate(() => retreatReview.waveFixturePlayerYieldSnapshot());
    await writeFile(join(directory, 'wave-follow-yield.json'), JSON.stringify({ fixture:
      'manually-assembled-live-wave-production-AI-follow-yield-and-keyboard-movement-cancellation',
      result, moving, stopped, errors }, null, 2));
    assert.ok(Math.hypot(moving.player[0] - result.playerBefore[0],
      moving.player[2] - result.playerBefore[2]) > .05, 'W must physically move the controlled soldier');
    assert.equal(moving.yield, null, 'the player soldier must stop yielding when the player moves');
    assert.equal(moving.order, 'follow', 'yield cancellation must preserve the player follow order');
    assert.equal(stopped.order, 'follow', 'the original player follow order must remain after movement');
    assert.deepEqual(errors, []);
    console.log('Wave follow yielding passed.');
  }
  if (process.env.NATURAL_RETREAT_REVIEW_ONLY === '1') {
    const started = await page.evaluate(() => retreatReview.naturalWithdrawalStart());
    const playerStart = await page.evaluate(() => retreatReview.naturalWithdrawalPlayerStart(Math.PI));
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(7000);
    await page.keyboard.up('w');
    const playerTravel = await page.evaluate(() => retreatReview.naturalWithdrawalPause());
    const records = [started.state, playerStart, playerTravel];
    for (let step = 0; step < 6; step++)
      records.push(await page.evaluate(() => retreatReview.naturalWithdrawalStep(5)));
    const initial = new Map(started.initial.map(actor => [actor.id, actor.position]));
    const moved = records.at(-1).friendly.filter(actor => !actor.playerUnit && initial.has(actor.id) &&
      Math.hypot(actor.position[0] - initial.get(actor.id)[0],
        actor.position[2] - initial.get(actor.id)[2]) > .5);
    await writeFile(join(directory, 'natural-retreat-formation.json'), JSON.stringify({ fixture:
      'natural-starting-positions-and-health-stage-clock-advanced-only-enemy-fire-enabled',
      started, records, moved: moved.map(actor => ({ id: actor.id, position: actor.position,
        goal: actor.goal, mode: actor.mode, path: actor.path, blocked: actor.blocked })),
      errors }, null, 2));
    assert.equal(records.at(-1).stage, 'sihang-retreat',
      'the controlled clock transition must enter the actual withdrawal stage');
    assert.ok(moved.length > 0,
      'at least one naturally spawned AI squad member must physically move from its original battlefield position toward assembly');
    assert.ok(playerTravel.player && Math.hypot(playerTravel.player[0] - playerStart.player[0],
      playerTravel.player[2] - playerStart.player[2]) > .5,
    'actual W and sprint input must move the naturally spawned player toward assembly');
    assert.deepEqual(errors, []);
    console.log('Natural-position withdrawal movement passed.');
  }
  if (process.env.WAVE_OBSERVATION_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.waveFixtureStart())];
    assert.equal(records[0].wave.covering, false);
    assert.equal(records[0].counterattack, false);
    records.push(await page.evaluate(() => retreatReview.waveFixtureThreat()));
    records.push(await page.evaluate(() => retreatReview.waveFixtureStep(2, true)));
    await writeFile(join(directory, 'wave-observation.json'), JSON.stringify({ fixture:
      'manually-placed-armed-threat-and-other-squads-enemy-fire-disabled-health-raised', records, errors }, null, 2));
    const last = records.at(-1);
    assert.equal(last.counterattack, false);
    assert.equal(last.wave.covering, true);
    assert.ok(last.coverShots.some(shot => shot.observation.sense === 'vision' &&
      shot.observation.targetId === last.threatId && shot.observation.time >= records[1].elapsed),
      'a fresh actual observation before the counterattack must activate cover');
    assert.deepEqual(errors, []);
    console.log('Wave observation passed.');
  }
  if (process.env.WAVE_REVIEW_ONLY === '1') {
    const records = [];
    records.push(await page.evaluate(() => retreatReview.waveFixtureStart()));
    assert.equal(records[0].wave.phase, 'main');
    assert.deepEqual(records[0].wave.squads.map(squad => squad.length), [11, 11, 11, 11, 11]);
    records.push(await page.evaluate(() => retreatReview.waveFixtureCross()));
    assert.equal(records.at(-1).counterattack, true);
    assert.equal(records.at(-1).wave.phase, 'main');
    records.push(await page.evaluate(() => retreatReview.waveFixtureAttack()));
    assert.equal(records.at(-1).wave.covering, true);
    assert.ok(records.at(-1).coverModes.every(mode =>
      ['sihang-wave-cover', 'sihang-wave-cover-position'].includes(mode)));
    if (process.env.WAVE_COMBAT_REVIEW === '1') {
      records.push(await page.evaluate(() => retreatReview.waveFixtureThreat()));
      records.push(await page.evaluate(() => retreatReview.waveFixtureStep(12)));
      await writeFile(join(directory, 'wave-combat.json'), JSON.stringify({ fixture:
        'production-ai-manually-placed-armed-threat-and-other-squads-elevated-health', records, errors }, null, 2));
      assert.ok(records.at(-1).coverShots.some(shot => shot.shots > 0 && shot.target === records.at(-1).threatId),
        'the covering squad must actually observe and shoot the armed threat');
    }
    records.push(await page.evaluate(() => retreatReview.waveFixtureResolveMain()));
    assert.equal(records.at(-1).wave.phase, 'cover');
    assert.equal(records.at(-1).voice.active, 'wave-cover');
    records.push(await page.evaluate(() => retreatReview.waveFixtureResolveCover()));
    assert.equal(records.at(-1).wave.phase, 'interval');
    const reserve = records.at(-1).reserve;
    records.push(await page.evaluate(() => retreatReview.waveFixtureStep(4.9, true)));
    assert.equal(records.at(-1).wave.phase, 'interval');
    assert.equal(records.at(-1).reserve, reserve);
    records.push(await page.evaluate(() => retreatReview.waveFixtureStep(.2, true)));
    assert.equal(records.at(-1).wave, null);
    assert.ok(records.at(-1).reserve < reserve);
    assert.equal(records.at(-1).generations.filter((generation, index) => generation > records[0].generations[index]).length, 1,
      'only one squad may spawn when the five-second interval ends');
    assert.equal(records.at(-1).total, records[0].total);
    records.push(await page.evaluate(() => retreatReview.waveFixtureStep(8.2, true)));
    const births = records.at(-1).spawnRecords;
    assert.equal(births.length, 5);
    assert.equal(new Set(births.map(birth => birth.slot)).size, 5);
    for (let index = 1; index < births.length; index++)
      assert.ok(births[index].time - births[index - 1].time >= SIHANG_RULES.retreatSpawnInterval - 1e-8,
        'successive squad spawns must be at least two simulation seconds apart');
    await page.evaluate(() => retreatReview.waveFixturePlayerAway());
    records.push(await page.evaluate(() => retreatReview.waveFixtureAssembleNext()));
    await writeFile(join(directory, 'wave.json'), JSON.stringify({ fixture:
      'production-wave-ai-manually-assembled-no-casualties-for-cover', records, errors }, null, 2));
    assert.equal(records.at(-1).wave?.number, 2);
    assert.equal(records.at(-1).voice.active, 'wave-start');
    await writeFile(join(directory, 'wave.json'), JSON.stringify({ fixture:
      'production-call-path-manually-assembled-teleported-one-crossing-and-cover-simulated-main-losses', records, errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log('Wave transitions passed.');
  }
  if (process.env.WAVE_PATH_REVIEW_ONLY === '1') {
    const liveCombat = process.env.WAVE_LIVE_COMBAT === '1';
    const contactStart = await page.evaluate(() => retreatReview.waveFixtureContactStart());
    const rangedContact = await page.evaluate(() => retreatReview.waveFixtureContactStep(2));
    assert.ok(rangedContact.rifleShots > contactStart.rifleShots,
      `a clear observed threat within 12 metres should draw a retreating rifle shot: start=${JSON.stringify(contactStart)} end=${JSON.stringify(rangedContact)}`);
    const meleeStart = await page.evaluate(() => retreatReview.waveFixtureContactSetDistance(6));
    const closeContact = await page.evaluate(() => retreatReview.waveFixtureContactStep(8));
    assert.equal(closeContact.dadaoSwings, meleeStart.dadaoSwings + 1,
      `a retreating soldier should make one bounded Dadao attack before leaving the same close contact: ${JSON.stringify(closeContact)}`);
    assert.ok(Math.hypot(closeContact.position[0] - meleeStart.position[0],
      closeContact.position[2] - meleeStart.position[2]) > .1,
      `the retreat should resume after the bounded close-contact attack: ${JSON.stringify(closeContact)}`);
    console.log(JSON.stringify({ rangedContact, closeContact }));
    assert.deepEqual(errors, []);
    if (process.env.WAVE_CONTACT_ONLY !== '1') {
    const records = [await page.evaluate(live => retreatReview.waveFixtureStart(live), liveCombat)];
    const steps = process.env.WAVE_EXTENDED_REVIEW === '1' ? 100 : 60;
    for (let step = 0; step < steps && records.at(-1).generations.every((generation, index) =>
      generation === records[0].generations[index]); step++) {
      records.push(await page.evaluate(live => live ? retreatReview.waveFixtureStep(5)
        : retreatReview.waveFixturePathStep(5), liveCombat));
      await writeFile(join(directory, 'wave-path.json'), JSON.stringify({ fixture:
        liveCombat ? 'production-ai-manually-assembled-normal-health-and-live-combat-afk-player'
          : 'production-ai-manually-assembled-actual-walking-enemy-fire-disabled-melee-enabled-friendly-health-raised',
        contact: { start: contactStart, ranged: rangedContact, meleeStart, close: closeContact },
        records, errors }, null, 2));
      console.log(JSON.stringify({ elapsed: records.at(-1).elapsed, phase: records.at(-1).wave?.phase,
        saved: records.at(-1).saved, lost: records.at(-1).lost }));
    }
    if (liveCombat) {
      const coverStart = records.find(record => record.wave?.phase === 'main' && record.wave.covering)?.elapsed;
      const coverRelease = records.find(record => record.wave?.phase === 'cover')?.elapsed;
      assert.ok(Number.isFinite(coverStart) && Number.isFinite(coverRelease),
        'the live-combat wave must enter and release its cover phase');
      assert.ok(records.some(record => record.wave?.phase === 'main' && record.wave.covering &&
        record.coverShots.some(shot => shot.lastShot?.mode === 'sihang-wave-cover' &&
          shot.lastShot.time >= coverStart && shot.lastShot.time < coverRelease)),
      'the covering squad must actually fire from its assigned defensive positions');
    }
    assert.ok(records.some(record => record.wave?.phase === 'cover'),
      'the other four squads must actually cross before the covering squad can leave');
    assert.ok(records.some(record => record.wave?.phase === 'interval' &&
      (liveCombat || record.saved + record.lost === 55)),
      liveCombat ? 'every member must be evacuated or killed before the interval'
        : 'all five squads must be evacuated or explicitly counted as losses before the interval');
    assert.ok(records.at(-1).generations.some((generation, index) => generation > records[0].generations[index]),
      'the next wave must begin only after the completed interval');
    assert.deepEqual(errors, []);
    console.log('Wave walking and refill passed.');
    }
  }
  if (process.env.ENEMY_REGROUP_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(reachable => retreatReview.enemyRegroupStart(reachable),
      process.env.ENEMY_REGROUP_REACHABLE === '1')];
    for (let step = 0; step < 12; step++) {
      records.push(await page.evaluate(() => retreatReview.enemyRegroupStep(10)));
      await writeFile(join(directory, 'enemy-regroup.json'), JSON.stringify({ fixture:
        'production-enemy-movement-intruder-and-two-tanks-manually-placed-firing-disabled-health-raised', records, errors }, null, 2));
    }
    const last = records.at(-1);
    assert.equal(last.counterattack, false);
    assert.ok(last.infantry.find(actor => actor.id === last.intruder)?.position[2] < -42,
      'the intruder must physically leave the warehouse');
    assert.ok(last.infantry.every(actor => actor.position[2] < -42 && Math.abs(actor.position[1]) < .3),
      'all living enemy infantry must physically regroup north of the warehouse');
    assert.equal(last.tanks.length, 2, 'both original Japanese tanks must remain present');
    assert.ok(last.tanks.every(tank => tank.position[2] < -42),
      'all living Japanese tanks must physically regroup north of the warehouse');
    assert.deepEqual(errors, []);
    console.log('Enemy regroup movement passed.');
  }
  if (process.env.REGROUP_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.regroupStart())];
    assert.equal(records[0].prepared, true);
    assert.equal(records[0].total, records[0].initialTotal);
    assert.equal(records[0].lost, 0);
    assert.equal(records[0].saved, 0);
    assert.deepEqual(records[0].oldPresent, [records[0].keptAI]);
    assert.deepEqual(records[0].playerEquipment, records[0].initialPlayerEquipment);
    const initialImage = await page.evaluate(() => retreatReview.capture([-64, 8, 8], [-40, 0, -4]));
    await writeFile(join(directory, 'west-spawn.png'), Buffer.from(initialImage, 'base64'));
    for (let step = 0; step < 60 && !records.at(-1).released; step++) {
      records.push(await page.evaluate(() => retreatReview.regroupStep(5)));
      await writeFile(join(directory, 'regroup.json'), JSON.stringify({ fixture:
        'production-call-path-manually-positioned-survivors-elevated-health', records, errors }, null, 2));
      console.log(JSON.stringify({ time: records.at(-1).time, released: records.at(-1).released,
        sizes: records.at(-1).formations.map(f => f.size),
        pending: records.at(-1).formations.map(f => f.remaining.length) }));
    }
    const last = records.at(-1);
    assert.equal(last.released, true, 'the first five squads must physically assemble');
    assert.equal(last.assemblyVoice?.active, 'assembled', 'real assembly release must trigger its voice');
    assert.deepEqual(last.formations.filter(f => f.id !== 'friendly-0').map(f => f.size), [11, 11, 11, 11, 11]);
    const blocks = last.formations.filter(f => f.id !== 'friendly-0');
    for (let slot = 1; slot < blocks.length; slot++) {
      const officer = blocks[slot - 1].positions.find(actor => actor.index === 2);
      const distance = Math.min(...blocks[slot].positions.filter(actor => actor.index !== 2).map(actor =>
        Math.hypot(actor.position[0] - officer.position[0], actor.position[2] - officer.position[2])));
      assert.ok(Math.abs(distance - 2) <= 2 * SIHANG_ASSEMBLY_ARRIVAL + 1e-8,
        'adjacent assembled blocks must keep the actual two-metre officer-to-soldier gap');
    }
    assert.ok(last.births.length >= 54 && last.births.every(actor => actor.x < -36 && actor.z >= -8));
    assert.ok(last.births.some(actor => actor.maxX - actor.x > 10), 'new soldiers must walk east from the western spawn');
    assert.ok(last.births.some(actor => actor.ammo > 0), 'returned soldiers must respawn with refreshed equipment');
    assert.deepEqual(last.playerEquipment, last.initialPlayerEquipment);
    assert.ok(last.enemy.position[2] < -42, 'an enemy originally in the warehouse must physically withdraw north');
    assert.ok(last.stageElapsed < SIHANG_RULES.nightfallSeconds ? last.wave === null :
      last.wave?.number === 1 && last.wave.phase === 'main' && last.wave.squads.every(squad => squad.length === 11),
    'the first wave must wait for nightfall and contain all five assembled squads');
    assert.deepEqual(errors, []);
    const image = await page.evaluate(() => retreatReview.capture([15, 5, 5], [-5, 1, -5]));
    await writeFile(join(directory, 'first-wave-assembled.png'), Buffer.from(image, 'base64'));
    for (const [name, eye, target] of [
      ['first-wave-west', [-20, 7, 5], [-21, 1, -4]],
      ['first-wave-east', [7, 7, 5], [6, 1, -4]],
    ]) {
      const png = await page.evaluate(({eye,target}) => retreatReview.capture(eye,target), {eye,target});
      await writeFile(join(directory, name + '.png'), Buffer.from(png, 'base64'));
    }
    const crossing = [];
    for (let step = 0; step < 36 && !crossing.at(-1)?.counterattack; step++) {
      crossing.push(await page.evaluate(() => retreatReview.regroupWithdrawalStep(5)));
      await writeFile(join(directory, 'regroup-crossing.json'), JSON.stringify({ crossing, errors }, null, 2));
    }
    assert.ok(crossing.at(-1)?.counterattack && crossing.at(-1).saved > 0,
      'a first-wave soldier must actually reach the south bank before the counterattack');
    const firstCrossing = crossing.at(-1), wave = firstCrossing.wave;
    assert.ok(wave && wave.number === 1 && wave.phase === 'main');
    const coverIds = new Set(wave.squads[wave.coverSlot]);
    assert.ok(firstCrossing.formations.flatMap(formation => formation.positions)
      .filter(actor => coverIds.has(actor.id)).every(actor => actor.position[2] < 0),
      'the covering squad must remain on the north bank until the other squads finish');
    await page.evaluate(() => retreatReview.restart());
    await page.waitForFunction(() => document.querySelector('#loading').hidden &&
      window.__battle?.state === 'playing', null, {timeout:180000});
    const partial = [await page.evaluate(() => retreatReview.regroupStart(true))];
    assert.equal(partial[0].total, 29);
    for (let step = 0; step < 60 && !partial.at(-1).released; step++) {
      partial.push(await page.evaluate(() => retreatReview.regroupStep(5)));
      await writeFile(join(directory, 'regroup-partial.json'), JSON.stringify({ partial, errors }, null, 2));
    }
    assert.equal(partial.at(-1).released, true, 'a genuinely depleted roster must not block assembly');
    assert.deepEqual(partial.at(-1).formations.filter(f => f.id !== 'friendly-0').map(f => f.size), [11, 7, 0, 0, 0]);
    assert.equal(partial.at(-1).lost, 0);
    assert.equal(partial.at(-1).saved, 0);
    assert.deepEqual(errors, []);
    console.log('Production regroup integration passed.');
  }
  if (process.env.NIGHT_BOUNDARY_REVIEW_ONLY === '1' || process.env.ALL_REVISION_REVIEW === '1') {
    const records = [];
    const image = async (name, eye, target) => {
      const png = await page.evaluate(({eye,target}) => retreatReview.capture(eye,target), {eye,target});
      await writeFile(join(directory, name + '.png'), Buffer.from(png, 'base64'));
    };
    const record = async () => {
      const state = await page.evaluate(() => retreatReview.boundarySnapshot());
      records.push(state);
      await writeFile(join(directory, 'boundaries.json'), JSON.stringify({ initial, halfway, regrouped, records, errors }, null, 2));
      return state;
    };
    const initial = await page.evaluate(() => retreatReview.boundaryStart());
    await image('native-nightfall-start', [15, 5, 5], [-5, 1, -5]);
    const halfway = await page.evaluate(() => retreatReview.boundaryStep(10));
    assert.ok(halfway.night.transition > .4 && halfway.night.transition < .6);
    await image('native-nightfall-halfway', [15, 5, 5], [-5, 1, -5]);
    const regrouped = await page.evaluate(() => retreatReview.boundaryStep(110));
    await writeFile(join(directory, 'boundaries.json'), JSON.stringify({ initial, halfway, regrouped, errors }, null, 2));
    assert.equal(regrouped.counterattack, false);
    assert.deepEqual(regrouped.enemyAmmo, initial.enemyAmmo, 'living ground enemies must hold fire during assembly');
    assert.equal(regrouped.planes, 0, 'surviving aircraft must really leave instead of attacking at night');
    for (const point of initial.positions) {
      await page.evaluate(id => retreatReview.boundaryPlace(id), point.id);
      await page.keyboard.press('f');
      const mounted = await record();
      assert.equal(mounted.mounted, point.id, 'F must enter the actual prepared cover position');
      await page.mouse.move(640, 360);
      await page.mouse.down();
      await page.evaluate(() => retreatReview.boundaryStep(.5));
      await page.mouse.up();
      const fired = await record();
      assert.ok(fired.positions.find(item => item.id === point.id).ammo < point.ammo, 'the real input must fire owned ammunition');
    }
    await page.evaluate(() => retreatReview.boundaryPlace('south'));
    const south = await record();
    await page.keyboard.press('1'); await page.mouse.down();
    await page.evaluate(() => retreatReview.boundaryStep(1)); await page.mouse.up();
    await page.evaluate(() => retreatReview.boundaryPlace('south'));
    await page.keyboard.press('g'); await page.mouse.down();
    await page.evaluate(() => retreatReview.boundaryStep(.5)); await page.mouse.up();
    const held = await record();
    assert.equal(held.ammo, south.ammo); assert.deepEqual(held.grenades, south.grenades);
    assert.equal(held.activeGrenades, south.activeGrenades);
    assert.equal(held.counterattack, false, 'player crossing alone must not start the counterattack');
    const crossing = await page.evaluate(() => retreatReview.boundaryCrossing());
    assert.equal(crossing.counterattack, true);
    assert.equal(crossing.waitedForPlayer, true, 'the assembled survivors must wait for the player to join them');
    assert.ok(crossing.release.stageElapsed >= SIHANG_RULES.nightfallSeconds
      ? crossing.release.wave?.phase === 'main'
      : crossing.release.wave === null, 'AI departure must wait for full nightfall');
    await page.evaluate(() => retreatReview.boundaryStep(4));
    const lit = await record(); assert.equal(lit.night.visible, 3);
    await image('native-flare-lit', [98, 15, 23], [58, 4, -26]);
    await page.evaluate(() => retreatReview.boundaryStep(23));
    assert.equal((await record()).night.visible, 0);
    await image('native-moonlit-assembly', [15, 5, 5], [-5, 1, -5]);
    await image('native-moonlit-south-bank', [105, 16, 30], [45, 3, 48]);
    await page.evaluate(() => retreatReview.boundaryStep(10));
    assert.equal((await record()).night.visible, 3);
    await writeFile(join(directory, 'boundaries.json'), JSON.stringify({ initial, halfway, regrouped, records, errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log('Native night ceasefire, three cover weapons, aircraft exit and flare cycles passed.');
  }
  if (process.env.NIGHT_BOUNDARY_REVIEW_ONLY !== '1' && process.env.REGROUP_REVIEW_ONLY !== '1' &&
    process.env.ENEMY_REGROUP_REVIEW_ONLY !== '1' && process.env.WAVE_REVIEW_ONLY !== '1' &&
    process.env.WAVE_OBSERVATION_REVIEW_ONLY !== '1' &&
    process.env.WAVE_PATH_REVIEW_ONLY !== '1' && process.env.FOLLOW_REVIEW_ONLY !== '1' &&
    process.env.WAVE_FOLLOW_REVIEW_ONLY !== '1' &&
    process.env.NATURAL_RETREAT_REVIEW_ONLY !== '1' &&
    process.env.PURSUIT_REVIEW_ONLY !== '1' && process.env.RETREAT_ENGINEER_REVIEW_ONLY !== '1' &&
    process.env.NIGHT_FIRE_REVIEW_ONLY !== '1' && process.env.EMPLACEMENT_REVIEW_ONLY !== '1' &&
    process.env.PLAYER_ASSEMBLY_SPAWN_REVIEW_ONLY !== '1' && process.env.PLAYER_SPAWN_UI_REVIEW_ONLY !== '1') {
  const restart = async () => {
    await page.evaluate(() => retreatReview.restart());
    await page.waitForFunction(() => document.querySelector('#loading').hidden &&
      window.__battle?.state === 'playing', null, {timeout:180000});
  };
  if (process.env.ALL_REVISION_REVIEW === '1') await restart();
  if (process.env.BATTLE_REVISION_REVIEW === '1') {
    const records = [await page.evaluate(() => retreatReview.defenseStart())];
    for (let i = 0; i < 44 && !records.at(-1).breached; i++) {
      records.push(await page.evaluate(() => retreatReview.defenseStep(5)));
      await writeFile(join(directory, 'defense.json'), JSON.stringify({ fixture: 'native-production-movement-firing-disabled-health-raised',
        records, errors }, null, 2));
      if (i % 5 === 0) console.log(JSON.stringify({time:records.at(-1).time, demolition:records.at(-1).demolition}));
      if (i === 8 || records.at(-1).charge.state === 'installing') {
        const eye = [records.at(-1).demolition.anchor.x + 8, 5, records.at(-1).demolition.anchor.z + 7];
        const target = [records.at(-1).demolition.anchor.x, 1, records.at(-1).demolition.anchor.z];
        const png = await page.evaluate(({eye,target}) => retreatReview.capture(eye,target), {eye,target});
        await writeFile(join(directory, records.at(-1).charge.state === 'installing' ? 'turtle-installing.png' : 'turtle-advance.png'),
          Buffer.from(png, 'base64'));
      }
    }
    assert.ok(records.some(record => record.charge.state === 'installing'), 'actual sappers must reach and install at the wall');
    assert.ok(records.at(-1).breached, 'the real demolition path must complete');
    const roof = records.at(-1).defenders.filter(actor => actor.position[1] > 21);
    assert.ok(roof.some(actor => actor.mounted === 'sihang-roof-aa'), 'assigned gunner must reach and operate rooftop AA');
    for (const seconds of [5, 5, 5, 5, 5, 5, 2]) {
      records.push(await page.evaluate(seconds => retreatReview.defenseStep(seconds), seconds));
    }
    await writeFile(join(directory, 'defense.json'), JSON.stringify({fixture:'native-production-movement-firing-disabled-health-raised',
      records, errors}, null, 2));
    assert.equal(records.at(-1).returned, 20, 'all original sappers must really return instead of being deleted on breach');
    if (process.env.ASSAULT_REVIEW === '1') {
      const assault = [await page.evaluate(() => retreatReview.assaultStart())];
      for (let step = 0; step < 20 && !(assault.at(-1).attackers.some(actor => actor.inCapture) &&
        assault.some(frame => frame.attackers.some(actor => actor.shots > 0 && actor.targetFriendly))); step++) {
        assault.push(await page.evaluate(() => retreatReview.assaultStep(5)));
        await writeFile(join(directory, 'assault.json'), JSON.stringify({
          fixture: 'native-production-assault-defender-and-vehicle-fire-disabled-health-raised', assault, errors }, null, 2));
      }
      assert.ok(assault.some(frame => frame.attackers.some(actor => actor.inCapture)),
        'original rear-spawn infantry must really enter the ground-floor capture area');
      assert.ok(assault.some(frame => frame.attackers.some(actor => actor.shots > 0 && actor.targetFriendly)),
        'assaulting infantry must observe and shoot actual Chinese defenders');
    }
    if (process.env.BATTLE_REVISION_REVIEW_ONLY !== '1') await restart();
  }
  if (process.env.BATTLE_REVISION_REVIEW_ONLY !== '1' && process.env.RETREAT_REVIEW_ONLY !== '1') {
    const frames = [await page.evaluate(() => retreatReview.engineerStart())];
    for (let step = 0; step < 48 && frames.at(-1).works.length < 2; step++) {
      frames.push(await page.evaluate(() => retreatReview.engineerStep(5)));
      await writeFile(join(directory, 'engineer.json'), JSON.stringify({ frames, errors }, null, 2));
    }
    console.log(JSON.stringify(frames.at(-1), null, 2));
    assert.equal(frames.at(-1).works.length, 2, 'the original upstairs engineer must really descend and finish both positions');
    assert.ok(frames.at(-1).works.every(work => Math.abs(work.y) <= .025));
    assert.deepEqual(frames.at(-1).materials, { maxim24: 0, bofors75: 0 });
    assert.deepEqual(errors, []);
  }
  if (process.env.ENGINEER_REVIEW_ONLY !== '1' && process.env.BATTLE_REVISION_REVIEW_ONLY !== '1') {
  const capture = async (name, eye, target) => {
    const png = await page.evaluate(({ eye, target }) => retreatReview.capture(eye, target), { eye, target });
    await writeFile(join(directory, `${name}.png`), Buffer.from(png, 'base64'));
  };
  const frames = [await page.evaluate(() => retreatReview.start())];
  await writeFile(join(directory, 'geometry-errors.json'), JSON.stringify(
    await page.evaluate(() => retreatReview.geometryErrors()), null, 2));
  await capture('night-regroup', [35, 18, 8], [-3, 0, -6]);
  let assemblyCaptured = false, flareCaptured = false;
  const save = async () => {
    await writeFile(join(directory, 'retreat.pending.json'), JSON.stringify({ frames, errors }, null, 2));
    await rename(join(directory, 'retreat.pending.json'), join(directory, 'retreat.json'));
  };
  for (let step = 0; step < 360 && !frames.at(-1).outcome; step++) {
    frames.push(await page.evaluate(() => retreatReview.step(5)));
    if (!assemblyCaptured && frames.at(-1).released) {
      await capture('assembled-withdrawal', [15, 5, 5], [-5, 1, -5]);
      assemblyCaptured = true;
    }
    if (!flareCaptured && frames.at(-1).counterattack) {
      await capture('counterattack-flares', [98, 15, 23], [58, 4, -26]);
      flareCaptured = true;
    }
    await save();
    assert.ok(frames.at(-1).released || step < 60,
      'assembly made no complete progress within the diagnostic window; inspect actual remaining paths');
    if (step % 5 === 0) console.log(JSON.stringify({ time: frames.at(-1).time, remaining: frames.at(-1).remaining.length,
      released: frames.at(-1).released, evacuated: frames.at(-1).evacuated, static: frames.at(-1).static,
      ms: Math.round(frames.at(-1).wallMs) }));
  }
  const last = frames.at(-1);
  await save();
  console.log(JSON.stringify(last, null, 2));
  assert.equal(last.outcome, 'evacuated', 'every original identity must physically reach safety and the parade ground');
  assert.equal(last.evacuated, last.total);
  assert.equal(last.static, Math.min(40, last.total - 1), 'only forty evacuees remain in the environmental formation');
  assert.equal(last.reserve, 0);
  assert.equal(last.remaining.length, 0);
  assert.equal(last.maximumStatic, Math.min(40, last.total - 1));
  assert.equal(last.faded, Math.max(0, last.total - 41));
  const exits = await page.evaluate(() => ({ records: retreatReview.exitRecords, image: retreatReview.fadeImage }));
  assert.ok(exits.records.every(actor => actor.position[2] > 72 && actor.slot >= 40 && actor.goal.exit));
  await writeFile(join(directory, 'exits.json'), JSON.stringify(exits.records, null, 2));
  assert.ok(exits.image, 'the real renderer must display an evacuee during the two-second fade');
  await writeFile(join(directory, 'native-evacuee-fade.png'), Buffer.from(exits.image, 'base64'));
  assert.deepEqual(errors, []);
  await capture('south-bank-formation', [91, 13, 30], [67, 1, 53]);
  }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
