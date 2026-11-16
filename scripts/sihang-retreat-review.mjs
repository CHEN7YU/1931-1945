import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { SIHANG_RULES } from '../src/sihang-campaign.js';
import { SIHANG_ASSEMBLY_ARRIVAL } from '../src/sihang-formation.js';
import { SIHANG_BRIDGE, sihangBridgeCoordinates } from '../src/sihang-layout.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  if (process.env.REVIEW_SEED !== undefined) {
    const seed = Number(process.env.REVIEW_SEED);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Invalid review seed');
    await page.addInitScript(initial => {
      let state = initial;
      Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    }, seed);
  }
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
  if (process.env.BRIDGE_INTERCEPT_BASELINE === '1') await page.route('**/src/sihang-roster.js*', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const current = `  const post = SIHANG_INTERCEPT_POSTS[((actor.formation?.index ?? 0) * 11 + actor.index) % SIHANG_INTERCEPT_POSTS.length];
  return { x: SIHANG_BRIDGE.northX + post[0], y: 0, z: SIHANG_BRIDGE.northZ + post[1], transit: true };`;
    const original = `  return { x: SIHANG_BRIDGE.northX - 3 + (actor.index % 3 - 1) * 1.1, y: 0,
    z: SIHANG_BRIDGE.northZ - 3 - Math.floor(actor.index / 3) % 3 * 1.1, transit: true };`;
    if (!source.includes(current)) throw new Error('Cannot reconstruct bridge interception baseline');
    const approach = `  const approach = { x: 50 + actor.index % 11, y: 0,
    z: -55 - ((actor.formation?.index ?? 0) % 4) * 2, transit: true };
  if (!tactics.sihangInterceptStaged && Math.hypot(position.x - approach.x, position.z - approach.z) <= 1 &&
    Math.abs(position.y) < .4)
    tactics.sihangInterceptStaged = true;
  if (!tactics.sihangInterceptStaged) {
    tactics.sihangPursuit = 'approach-interception';
    return approach;
  }
`;
    if (!source.includes(approach)) throw new Error('Cannot reconstruct bridge approach baseline');
    const armor = "x: SIHANG_BRIDGE.northX - 13, z: SIHANG_BRIDGE.northZ - 32,";
    if (!source.includes(armor)) throw new Error('Cannot reconstruct bridge armor baseline');
    await route.fulfill({ response, body: source.replace(approach, '').replace(current, original)
      .replace(armor, "x: SIHANG_BRIDGE.northX, z: SIHANG_BRIDGE.northZ - 1.3,") });
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    let source = await response.text();
    if (process.env.MASS_MECHANICAL_BASELINE === '1') {
      const current = "  for (const cue of cues)\n    if (cue.soldierId === entities.control.soldierId) emitControlEvent('weapon.mechanical', cue);";
      if (!source.replace(/\r\n/g, '\n').includes(current))
        throw new Error('Cannot reconstruct mechanical feedback baseline');
      source = source.replace(/\r\n/g, '\n').replace(current,
        "  for (const cue of cues) emitControlEvent('weapon.mechanical', cue);");
    }
    if (process.env.NATURAL_TRACE_BRIDGE === '1') {
      const marker = '  presentControlEvents();\n  if (benchmark) telemetry.add(\'effectsMs\', performance.now() - started);';
      source = source.replace(/\r\n/g, '\n');
      if (!source.includes(marker)) throw new Error('Cannot instrument continuous bridge positions');
      source = source.replace(marker, `  presentControlEvents();
  if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && sihangCampaign.counterattack) {
    const records = window.__bridgeMinima ??= {};
    for (const subject of [...enemies.filter(actor => actor.health > 0 && !actor.vehicleId),
      ...[...entities.vehicles.values()].filter(vehicle => vehicle.team === 'enemy' &&
        vehicle.type === 'tank' && vehicle.health > 0)]) {
      const distance = Math.hypot(subject.position.x - SIHANG_BRIDGE.northX, subject.position.z - SIHANG_BRIDGE.northZ);
      if (!records[subject.id] || distance < records[subject.id].distance)
        records[subject.id] = { id: subject.id, index: subject.index, formation: subject.formation?.index,
          kind: subject.type === 'tank' ? 'tank' : 'soldier', distance, time, stageElapsed: sihangCampaign.stageElapsed,
          position: subject.position.toArray(), mode: subject.tactics?.mode ?? subject.ai?.mode,
          pursuit: subject.tactics?.sihangPursuit, target: subject.target?.id,
          path: subject.path?.slice(0, 3), pathGoal: subject.pathGoal };
    }
  }
  if (benchmark) telemetry.add('effectsMs', performance.now() - started);`);
    }
    if (process.env.NATURAL_TRACE_DEATHS === '1') {
      const marker = /function finishActorDeath\(actor, source\) \{\r?\n  if \(!actor\.deathProcessed\) \{/;
      if (!marker.test(source)) throw new Error('Cannot instrument actual soldier deaths');
      source = source.replace(marker, match => match + `
    if (actor.friendly) (window.__retreatDeaths ??= []).push({
      id: actor.id, time, stageElapsed: sihangCampaign?.stageElapsed,
      wave: sihangCampaign?.withdrawalWave?.number, position: actor.position.toArray(),
      mode: actor.tactics.mode, source: source && typeof source === 'object' ? { ...source } : null,
      lastHit: actor.lastHit ? { ...actor.lastHit } : null,
    });`);
    }
    if (process.env.BRIDGE_OBSTACLE_REVIEW_ONLY === '1') {
      const marker = /for \(const transport of entities\.vehicles\.values\(\)\) \{\r?\n    if \(transport\.health <= 0\)/;
      const start = source.indexOf('function updateVehicles(dt) {');
      if (start < 0 || !marker.test(source.slice(start))) throw new Error('Bridge probe cannot freeze its selected tank');
      source = source.slice(0, start) + source.slice(start).replace(marker, `for (const transport of entities.vehicles.values()) {
    if (window.__bridgeProbeTank === transport.id) {
      for (const seat of transport.seats) {
        const occupant = entities.soldiers.get(seat.occupantId);
        if (occupant) occupant.position.copy(transport.position);
      }
      continue;
    }
    if (transport.health <= 0)`);
    }
    if (process.env.WAVE_COVER_SPACING_REVIEW_ONLY === '1') {
      const marker = '  const steeringNeighbors = withdrawalCoverEgress ? neighbors.filter(other => other.friendly) : neighbors;';
      if (!source.includes(marker)) throw new Error('Cannot instrument cover egress traffic neighbors');
      source = source.replace(marker, marker + `
  if (withdrawalCoverEgress && actor.id === window.__coverSpacingActor)
    window.__coverSpacingNeighbors = { all: neighbors.map(other => ({ id: other.id, friendly: other.friendly })),
      steering: steeringNeighbors.map(other => other.id) };`);
    }
    await route.fulfill({ response, body: source + `
      window.retreatReview = {
        restart() { setGameState('menu'); beginMatch(); },
        massMechanicalCueStep() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const player = controlledSoldier(entities);
          const actors = [...entities.soldiers.values()].filter(actor =>
            actor.health > 0 && actor.hasFirearm !== false && !actor.vehicleId &&
            !actor.emplacementWeaponId && !actor.dying && !actor.fatalFall && !actor.blastReaction &&
            !infantryWeaponProfile(actor.rifle).automatic);
          if (!actors.includes(player) || actors.length < 65)
            throw new Error('Mass mechanical cue fixture requires a controlled rifle and at least 64 AI rifles');
          for (const actor of actors) {
            actor.rifle.action = 'idle'; actor.rifle.elapsed = 0; actor.rifle.queuedReload = false;
            actor.rifle.ammo = infantryWeaponProfile(actor.rifle).magazine - 1;
            if (!reloadRifle(actor.rifle)) throw new Error('Fixture rifle failed to start its owned reload');
          }
          controlEvents.clear();
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.15, time);
          const events = controlEvents.snapshot;
          setGameState('pause');
          return { player: player.id, actors: actors.length,
            advanced: actors.filter(actor => actor.rifle.elapsed > 0).length, events };
        },
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
        captureNaturalCrowd() {
          const position = camera.position.clone(), rotation = camera.quaternion.clone();
          const image = this.capture([25, 16, 8], [14, 0, -4]);
          camera.position.copy(position); camera.quaternion.copy(rotation); camera.updateMatrixWorld(true);
          return image;
        },
        regroupStart(partial = false, preservePositions = false) {
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
            if (!preservePositions) actor.position.set(18, SIHANG_WAREHOUSE.floorHeight, -31);
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
        regroupStep(seconds, holdAssemblyDeadline = false) {
          for (let i = 0; i < Math.round(seconds / .05) && !sihangCampaign.assemblyReleased; i++) {
            if (holdAssemblyDeadline && sihangCampaign.waveAssemblyAt !== null)
              sihangCampaign.waveAssemblyAt = sihangCampaign.elapsed;
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
            originalAI: [...this.oldAI],
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
          this.regroupStep(30);
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
        waveFixtureContactStart(cover = false, distance = 10) {
          this.waveFixtureStart();
          const wave = sihangCampaign.withdrawalWave;
          const slot = cover ? wave.coverSlot : wave.squads.findIndex((ids, index) => index !== wave.coverSlot && ids.length);
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
            const targetX = x + dx * distance, targetZ = z + dz * distance;
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
          if (cover) {
            wave.covering = true;
            for (const other of enemies) if (other !== enemy && !other.vehicleId) other.health = 0;
            actor.target = null; actor.nextThink = 0;
            actor.tactics.lastSeen = actor.tactics.threatId = actor.tactics.threatSense = null;
          }
          actorGrid.rebuild(allForces);
          this.waveContact = { actor: actor.id, enemy: enemy.id, direction: { x: dx, z: dz } };
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureCoverSpacing() {
          this.waveFixtureStart();
          sihangCampaign.withdrawalWave.covering = true;
          this.waveFixtureResolveMain();
          const wave = sihangCampaign.withdrawalWave;
          if (wave.phase !== 'cover') throw new Error('Cover spacing fixture requires cover withdrawal');
          const cover = wave.squads[wave.coverSlot].map(id => entities.soldiers.get(id))
            .filter(actor => actor?.health > 0);
          const [actor, peer] = cover;
          const enemy = enemies.find(other => other.health > 0 && !other.vehicleId);
          if (!actor || !peer || !enemy) throw new Error('Cover spacing fixture needs a soldier, ally and enemy');
          const point = { x: 45, z: -16 }, friendPoint = { x: 45, z: -15 },
            enemyPoint = { x: 46, z: -16 };
          for (const p of [point, friendPoint, enemyPoint])
            if (world.isDeepWater(p.x, p.z) || circleBlocked(p.x, p.z, .43, movementObstacles(p.x, p.z), 0))
              throw new Error('Cover spacing fixture requires clear dry positions');
          actor.position.set(point.x, 0, point.z);
          peer.position.set(friendPoint.x, 0, friendPoint.z);
          enemy.position.set(enemyPoint.x, 0, enemyPoint.z);
          for (const unit of [actor, peer, enemy]) {
            unit.health = 100000; unit.nextThink = time + 100000;
            unit.target = null; unit.tactics.lastSeen = null; unit.nextFire = time + 100000;
          }
          const goal = sihangRetreatGoal(actor);
          actor.path = [{ ...goal }]; actor.pathGoal = goal;
          actor.tactics.traffic = { waitSeconds: 3, reason: 'no-yield-space', side: 1,
            progress: { x: point.x, z: point.z }, direction: { x: 1, z: 0 }, yieldPoint: null, until: 0 };
          window.__coverSpacingActor = actor.id;
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time); setGameState('pause');
          return { phase: wave.phase, actor: actor.id, peer: peer.id, enemy: enemy.id,
            neighbors: window.__coverSpacingNeighbors ?? null };
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
        waveFixtureContactSwitchTarget() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const previous = entities.soldiers.get(this.waveContact.enemy);
          const next = enemies.find(candidate => candidate !== previous && candidate.health > 0 &&
            !candidate.vehicleId && !candidate.formation.sihangDemolition && candidate.hasFirearm !== false);
          if (!next) throw new Error('Target-switch fixture requires a second living infantry target');
          next.position.copy(previous.position);
          previous.position.set(previous.spawnPosition.x,
            world.walkHeight(previous.spawnPosition.x, previous.spawnPosition.z, 0), previous.spawnPosition.z);
          next.health = 100000;
          cancelAIMelee(actor);
          actor.target = null;
          actor.nextThink = 0;
          actor.heading = Math.atan2(actor.position.x - next.position.x, actor.position.z - next.position.z);
          this.waveContact.enemy = next.id;
          actorGrid.rebuild(allForces);
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureContactBreak() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          for (const enemy of enemies) if (enemy.health > 0 && !enemy.vehicleId &&
            Math.hypot(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z) <= 12) {
            enemy.position.set(enemy.spawnPosition.x,
              world.walkHeight(enemy.spawnPosition.x, enemy.spawnPosition.z, 0), enemy.spawnPosition.z);
            enemy.nextThink = time + 100000;
          }
          actor.target = null; actor.nextThink = time + 100000;
          actorGrid.rebuild(allForces);
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time); setGameState('pause');
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureContactReappear() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const enemy = entities.soldiers.get(this.waveContact.enemy);
          const x = actor.position.x + this.waveContact.direction.x * 10;
          const z = actor.position.z + this.waveContact.direction.z * 10;
          enemy.position.set(x, world.walkHeight(x, z, actor.position.y), z);
          actor.target = null; actor.nextThink = 0;
          actor.heading = Math.atan2(actor.position.x - x, actor.position.z - z);
          actorGrid.rebuild(allForces);
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureCoverBlock() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const enemy = entities.soldiers.get(this.waveContact.enemy);
          const blocker = friendlyForces.find(other => other !== actor && other !== controlledSoldier(entities) &&
            other.health > 0 && !other.vehicleId);
          if (!blocker) throw new Error('Cover fixture requires a living friendly blocker');
          this.coverBlocker = blocker.id;
          blocker.stance = 'standing'; blocker.firingPose = null;
          blocker.position.set((actor.position.x + enemy.position.x) / 2, actor.position.y,
            (actor.position.z + enemy.position.z) / 2);
          actorGrid.rebuild(allForces);
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureCoverRelease() {
          const blocker = entities.soldiers.get(this.coverBlocker);
          blocker.position.set(blocker.spawnPosition.x,
            world.walkHeight(blocker.spawnPosition.x, blocker.spawnPosition.z, 0), blocker.spawnPosition.z);
          this.coverBlocker = null;
          actorGrid.rebuild(allForces);
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureCoverAmmo(ammo, reserve) {
          const actor = entities.soldiers.get(this.waveContact.actor);
          actor.rifle.ammo = ammo; actor.rifle.reserve = reserve;
          actor.rifle.action = 'idle';
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureCoverHideTarget() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const enemy = entities.soldiers.get(this.waveContact.enemy);
          const eye = soldierEyePosition(actor), from = new THREE.Vector3(eye.x, eye.y, eye.z);
          let found = false;
          for (let dx = -35; dx <= 35 && !found; dx += 5) for (let dz = -35; dz <= 35; dz += 5) {
            const x = actor.position.x + dx, z = actor.position.z + dz, distance = Math.hypot(dx, dz);
            if (distance < 18 || distance > 40 || world.isDeepWater(x, z)) continue;
            const y = world.walkHeight(x, z, actor.position.y);
            if (Math.abs(y - actor.position.y) > .3 || circleBlocked(x, z, .42, movementObstacles(x, z), y)) continue;
            enemy.position.set(x, y, z);
            if (!visibleTargetPoint(enemy, point => hasLine(from, point, 75))) { found = true; break; }
          }
          if (!found) throw new Error('Cover fixture requires a real wall hiding its target');
          actor.target = enemy; actor.nextThink = time + 100000;
          actorGrid.rebuild(allForces);
          return this.waveFixtureContactSnapshot();
        },
        waveFixtureContactStep(seconds, naturalObservation = false) {
          const actor = entities.soldiers.get(this.waveContact.actor);
          const enemy = entities.soldiers.get(this.waveContact.enemy), heldPosition = enemy.position.clone();
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            if (this.coverBlocker) {
              const blocker = entities.soldiers.get(this.coverBlocker);
              blocker.position.set((actor.position.x + heldPosition.x) / 2, actor.position.y,
                (actor.position.z + heldPosition.z) / 2);
              actorGrid.rebuild(allForces);
            }
            for (const hostile of enemies) hostile.nextFire = time + 1000000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            enemy.position.copy(heldPosition); enemy.path = enemy.pathGoal = null;
            enemy.target = null; enemy.nextThink = time + 100000;
            if (!naturalObservation) {
              actor.target = enemy; actor.nextThink = time + 100000;
              rememberThreat(actor.tactics, { x: heldPosition.x, y: heldPosition.y + 1.1, z: heldPosition.z },
                time, 'person', 'vision', enemy.id);
            }
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
            visible: Boolean(visibleTargetPoint(enemy, point => hasLine(new THREE.Vector3(eye.x, eye.y, eye.z), point, 75))),
            contactEligible: Boolean(actor.friendly && sihangCampaign.stage === 'sihang-retreat' &&
              actor.tactics.threatSense === 'vision' && actor.tactics.threatId === enemy.id &&
              Math.hypot(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z) <= 12 &&
              !sihangCeasefire(actor)),
            targetKind: enemy.targetKind, canDamage: canWeaponDamageTarget('rifle', enemy.targetKind),
            canTrack: canRiflemanTrackTarget(enemy.targetKind),
            engineer: Boolean(actor.engineer), playerUnit: actor.playerUnit,
            contact: actor.tactics.sihangRetreatContact,
            cachedContacts: [...(actor.tactics.sihangRetreatContacts?.keys() ?? [])],
            mode: actor.tactics.mode, ammo: actor.rifle.ammo, rifleShots: actor.rifle.shots, nextFire: actor.nextFire,
            coverGoalDistance: Math.hypot(actor.position.x -
              sihangDefenseGoal(Math.max(1, Math.min(3, actor.formation.index)), actor.index).x,
            actor.position.z - sihangDefenseGoal(Math.max(1, Math.min(3, actor.formation.index)), actor.index).z),
            rifleBlocked: actor.aiRifle.blocked, stance: actor.stance,
            firingPose: actor.firingPose, speed: actor.locomotion.speed,
            dadaoSwings: actor.dadao?.swings ?? 0, dadaoHits: actor.dadao?.hits ?? 0 };
        },
        surroundedStart() {
          this.waveFixtureContactStart();
          const actor = entities.soldiers.get(this.waveContact.actor);
          const candidates = enemies.filter(enemy => enemy.health > 0 && !enemy.vehicleId &&
            !enemy.formation.sihangDemolition && enemy.hasFirearm !== false);
          const positions = [];
          for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4;
            const x = actor.position.x + Math.cos(angle) * 1.2;
            const z = actor.position.z + Math.sin(angle) * 1.2;
            if (Math.abs(world.walkHeight(x, z, actor.position.y) - actor.position.y) < .1 &&
              !circleBlocked(x, z, .42, movementObstacles(x, z), actor.position.y))
              positions.push({ x, y: actor.position.y, z });
          }
          if (positions.length !== 8 || candidates.length < 8 || !actor.dadao)
            throw new Error('Surrounded fixture requires eight clear positions and a Dadao soldier');
          this.surrounding = candidates.slice(0, 8).map((enemy, index) => {
            enemy.position.set(positions[index].x, positions[index].y, positions[index].z);
            enemy.health = 100000; enemy.target = null; enemy.nextThink = time + 100000;
            return { id: enemy.id, position: enemy.position.clone() };
          });
          actor.health = 100000; actor.nextThink = time; actor.target = null;
          actor.tactics.sihangRetreatContact = null; actor.tactics.traffic = null;
          actor.path = actor.pathGoal = null; cancelAIMelee(actor);
          actorGrid.rebuild(allForces);
          return this.surroundedSnapshot();
        },
        surroundedStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            for (const actor of allForces) {
              if (actor.friendly && actor.health > 0) actor.health = 100000;
              if (!actor.friendly) actor.nextFire = time + 1000000;
              if (actor.friendly && actor.id !== this.waveContact.actor) actor.nextFire = time + 1000000;
            }
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            for (const held of this.surrounding) {
              const enemy = entities.soldiers.get(held.id);
              enemy.position.copy(held.position); enemy.health = 100000;
              enemy.target = null; enemy.nextThink = time + 100000;
            }
            actorGrid.rebuild(allForces);
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.surroundedSnapshot();
        },
        surroundedRelease() {
          for (const held of this.surrounding) entities.soldiers.get(held.id).health = 0;
          this.surrounding = [];
          const actor = entities.soldiers.get(this.waveContact.actor);
          actor.target = null; actor.nextThink = time;
          actorGrid.rebuild(allForces);
          return this.surroundedSnapshot();
        },
        surroundedSnapshot() {
          const actor = entities.soldiers.get(this.waveContact.actor);
          return { elapsed: sihangCampaign.elapsed, position: actor.position.toArray(),
            mode: actor.tactics.mode, traffic: actor.tactics.traffic,
            contact: actor.tactics.sihangRetreatContact, target: actor.target?.id ?? null,
            swings: actor.dadao.swings, hits: actor.dadao.hits,
            enemies: this.surrounding.map(held => ({ id: held.id, position: held.position.toArray() })) };
        },
        bridgeProbeStart(replay = false, wreck = false) {
          this.waveFixtureStart();
          const wave = sihangCampaign.withdrawalWave;
          const actor = wave.squads.flatMap((ids, slot) => slot === wave.coverSlot ? [] : ids)
            .map(id => entities.soldiers.get(id)).find(member => member?.index % 5 === (replay ? 3 : 4));
          const tank = [...entities.vehicles.values()].find(vehicle =>
            vehicle.type === 'tank' && vehicle.team === 'enemy' && vehicle.health > 0);
          if (!actor || !tank) throw new Error('Bridge probe requires a withdrawal soldier and enemy tank');
          const goal = sihangRetreatGoal(actor);
          if (replay) {
            tank.position.set(74.76838959948437, 0, -31.500621994607055);
            tank.heading = 4.7097034657860535;
          } else tank.position.set(goal.x, 0, goal.z + .65);
          tank.speed = 0;
          if (wreck) tank.health = 0;
          window.__bridgeProbeTank = tank.id;
          for (const enemy of enemies) if (!enemy.vehicleId) enemy.health = 0;
          actor.position.set(replay ? 76.5 : 72, 0, replay ? -33.6 : -34);
          actor.path = actor.pathGoal = null;
          actor.nextPath = 0; actor.tactics.traffic = null;
          this.bridgeProbe = { actor: actor.id, tank: tank.id, tankPosition: tank.position.clone(), overlaps: 0 };
          actorGrid.rebuild(allForces);
          return this.bridgeProbeSnapshot();
        },
        bridgeWorkStart(withWork = true, profile = 'maxim24', group = false) {
          this.waveFixtureStart();
          const wave = sihangCampaign.withdrawalWave;
          const builder = friendlyForces.find(actor => !actor.playerUnit && actor.health > 0 &&
            actor.engineer?.materials[profile]);
          const candidates = wave.squads.flatMap((ids, slot) => slot === wave.coverSlot ? [] : ids)
            .map(id => entities.soldiers.get(id)).filter(member => member?.health > 0 &&
              member !== builder && member.index % 5 === 3);
          const actors = candidates.slice(0, group ? 4 : 1), actor = actors[0];
          if (!builder || !actor) throw new Error('Bridge work probe needs an engineer and a retreating soldier');
          if (group && actors.length !== 4) throw new Error('Bridge work group needs four soldiers');
          const heading = Math.atan2(SIHANG_BRIDGE.northX - SIHANG_BRIDGE.southX,
            SIHANG_BRIDGE.northZ - SIHANG_BRIDGE.southZ);
          const site = sihangBridgePoint(.5);
          const bx = site.x + Math.sin(heading) * ENGINEER.reach;
          const bz = site.z + Math.cos(heading) * ENGINEER.reach;
          const previous = builder.position.clone();
          let obstacles = [];
          if (withWork) {
            builder.position.set(bx, world.walkHeight(bx, bz, 0), bz);
            builder.engineer.heading = heading;
            builder.engineer.selected = profile;
            selectConstructionBlueprint(builder.engineer.construction, builder.id);
            const count = engineerWorks.length;
            for (let i = 0; i < 1000 && engineerWorks.length === count; i++)
              updateEngineerConstruction(builder, .05, true);
            if (engineerWorks.length !== count + 1)
              throw new Error('Bridge work construction failed: ' + builder.engineer.construction.blockedReason);
            obstacles = engineerWorks.at(-1).obstacles;
            builder.position.copy(previous);
          }
          for (const enemy of enemies) if (!enemy.vehicleId) enemy.health = 0;
          for (const [index, member] of actors.entries()) {
            member.position.set(76.5 - index * 1.1, 0, -33.6 - index * .95);
            member.path = member.pathGoal = null; member.nextPath = 0; member.tactics.traffic = null;
          }
          this.bridgeWork = { actor, actors, obstacles,
            overlaps: 0, crossed: new Set() };
          actorGrid.rebuild(allForces);
          return this.bridgeWorkSnapshot();
        },
        bridgeWorkStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            for (const actor of friendlyForces) if (actor.health > 0) actor.health = 100000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            for (const actor of this.bridgeWork.actors) {
              if (circleBlocked(actor.position.x, actor.position.z, .42, this.bridgeWork.obstacles, actor.position.y))
                this.bridgeWork.overlaps++;
              if (sihangBridgeCoordinates(actor.position).along > SIHANG_BRIDGE.length)
                this.bridgeWork.crossed.add(actor.id);
            }
          }
          setGameState('pause');
          return this.bridgeWorkSnapshot();
        },
        bridgeWorkSnapshot() {
          const actor = this.bridgeWork.actor;
          return { time, position: actor.position.toArray(), mode: actor.tactics.mode,
            overlaps: this.bridgeWork.overlaps, crossed: [...this.bridgeWork.crossed],
            positions: this.bridgeWork.actors.map(member => ({ id: member.id, position: member.position.toArray() })),
            goal: sihangRetreatGoal(actor),
            pathReason: actor.tactics.pathReason, path: actor.path?.slice(0, 3) };
        },
        bridgeProbeStep(seconds) {
          const tank = entities.vehicles.get(this.bridgeProbe.tank);
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            tank.position.copy(this.bridgeProbe.tankPosition); tank.speed = 0;
            for (const actor of friendlyForces) if (actor.health > 0) actor.health = 100000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            tank.position.copy(this.bridgeProbe.tankPosition);
            const actor = entities.soldiers.get(this.bridgeProbe.actor);
            if (circleBlocked(actor.position.x, actor.position.z, .42, [vehicleCollider(tank)], actor.position.y))
              this.bridgeProbe.overlaps++;
          }
          tank.position.copy(this.bridgeProbe.tankPosition);
          setGameState('pause');
          return this.bridgeProbeSnapshot();
        },
        bridgeProbeGraph() {
          const actor = entities.soldiers.get(this.bridgeProbe.actor);
          const collider = vehicleCollider(entities.vehicles.get(this.bridgeProbe.tank));
          const points = [{ x: actor.position.x, z: actor.position.z, kind: 'start' }];
          for (const margin of [.8, 1.4, 2.2]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const lx = sx * (collider.hx + margin), lz = sz * (collider.hz + margin);
            points.push({ x: collider.cx + collider.cos * lx + collider.sin * lz,
              z: collider.cz - collider.sin * lx + collider.cos * lz, kind: 'corner' });
          }
          for (const along of [-3, -2, -1]) for (const lateral of [-3, -2, -1, 0, 1, 2, 3])
            points.push({ ...sihangBridgePoint(along / SIHANG_BRIDGE.length, lateral), kind: 'entrance' });
          const valid = points.map((point, index) => index === 0 ||
            !infantryNavigationBlocked(point, actor.position, .46, actor) &&
            Math.abs(world.walkHeight(point.x, point.z, actor.position.y) - actor.position.y) <= .3);
          const costs = points.map(() => Infinity), paths = points.map(() => null), done = new Set();
          costs[0] = 0; paths[0] = [points[0]];
          while (done.size < points.length) {
            let current = -1;
            for (let i = 0; i < points.length; i++)
              if (!done.has(i) && valid[i] && (current < 0 || costs[i] < costs[current])) current = i;
            if (current < 0 || !Number.isFinite(costs[current])) break;
            if (points[current].kind === 'entrance') return { route: paths[current], cost: costs[current] };
            done.add(current);
            for (let i = 1; i < points.length; i++) {
              if (!valid[i] || done.has(i)) continue;
              const distance = Math.hypot(points[i].x - points[current].x, points[i].z - points[current].z);
              if (costs[current] + distance >= costs[i]) continue;
              if (!sampledRouteClear(points[current], points[i], (x, z) =>
                !infantryNavigationBlocked({ x, z }, actor.position, .46, actor) &&
                Math.abs(world.walkHeight(x, z, actor.position.y) - actor.position.y) <= .3)) continue;
              costs[i] = costs[current] + distance;
              paths[i] = [...paths[current], points[i]];
            }
          }
          return { route: null, valid: points.filter((_, i) => valid[i]) };
        },
        bridgeProbeSnapshot() {
          const actor = entities.soldiers.get(this.bridgeProbe.actor);
          const tank = entities.vehicles.get(this.bridgeProbe.tank);
          const goal = sihangRetreatGoal(actor);
          return { time, position: actor.position.toArray(), goal, selectedGoal: formationDestination(actor, true),
            overlaps: this.bridgeProbe.overlaps, mode: actor.tactics.mode,
            path: actor.path?.slice(0, 3), blocked: actor.tactics.blockedBy, traffic: actor.tactics.traffic,
            tank: { position: tank.position.toArray(), health: tank.health },
            goalBlocked: infantryNavigationBlocked(goal, actor.position, .43, actor),
            lanes: [-3, -2, -1, 0, 1, 2, 3].map(lateral => {
              const point = { ...sihangBridgePoint(-3 / SIHANG_BRIDGE.length, lateral), y: 0 };
              return { lateral, point, blocked: infantryNavigationBlocked(point, actor.position, .43, actor),
                routeClear: sampledRouteClear(actor.position, point, (x, z) =>
                  !infantryNavigationBlocked({ x, z }, actor.position, .43, actor)) };
            }) };
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
          shooter.tactics.sihangInterceptStaged = true;
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
        bridgeInterceptFireStart() {
          this.nightFireStart();
          const shooter = entities.soldiers.get(this.nightShooter), target = entities.soldiers.get(this.nightTarget);
          target.position.set(SIHANG_BRIDGE.northX, 0, SIHANG_BRIDGE.northZ);
          shooter.heading = Math.atan2(shooter.position.x - target.position.x, shooter.position.z - target.position.z);
          shooter.nextThink = shooter.nextFire = 0;
          sihangCampaign.stageElapsed = SIHANG_RULES.nightfallSeconds + 1;
          sihangCampaign.counterattackAt = sihangCampaign.elapsed - 25;
          actorGrid.rebuild(allForces);
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
            mode: shooter.tactics.mode, shots: shooter.rifle.shots, aim: shooter.target?.id ?? null, health: target.health,
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
        engineerRetreatSite(region = 'quay') {
          const actor = controlledSoldier(entities);
          if (!actor.engineer) throw new Error('Select the actual player engineer first');
          if (region === 'bridge') {
            const point = sihangBridgePoint(.5);
            const heading = Math.atan2(SIHANG_BRIDGE.northX - SIHANG_BRIDGE.southX,
              SIHANG_BRIDGE.northZ - SIHANG_BRIDGE.southZ);
            const x = point.x + Math.sin(heading) * ENGINEER.reach;
            const z = point.z + Math.cos(heading) * ENGINEER.reach;
            actor.position.set(x, world.walkHeight(x, z, 0), z);
            controlPose.yaw = actor.heading = actor.engineer.heading = heading;
            const candidate = engineerPlacement(actor.position, heading);
            candidate.y = world.walkHeight(candidate.x, candidate.z, actor.position.y);
            actorGrid.rebuild(allForces);
            const reason = engineerPlacementReason(actor, candidate);
            if (reason) throw new Error('Bridge construction fixture blocked: ' + reason);
            return { id: actor.id, position: actor.position.toArray(), point: candidate, heading,
              materials: {...actor.engineer.materials} };
          }
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
          this.naturalResumeState = 'playing';
          const initial = friendlyForces.filter(actor => actor.health > 0).map(actor => ({
            id: actor.id, playerUnit: actor.playerUnit, position: actor.position.toArray() }));
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return { initial, state: this.naturalWithdrawalSnapshot() };
        },
        naturalWithdrawalPlayerStart(yaw) {
          if (this.naturalResumeState !== 'playing') throw new Error('Cannot steer without a living player in control');
          controlPose.yaw = yaw;
          setGameState('playing');
          return this.naturalWithdrawalSnapshot();
        },
        naturalWithdrawalPause() {
          this.naturalResumeState = state;
          setGameState('pause');
          return this.naturalWithdrawalSnapshot();
        },
        naturalWithdrawalResume() {
          if (!activeStates.has(this.naturalResumeState))
            throw new Error('Cannot resume a finished withdrawal');
          setGameState(this.naturalResumeState);
        },
        bridgeContinuousSnapshot() {
          return Object.values(window.__bridgeMinima ?? {}).sort((a, b) => a.distance - b.distance);
        },
        naturalDeathStart() {
          setGameState('playing');
          const actor = controlledSoldier(entities);
          if (!actor || allies.filter(member => member.health > 0).length < 2)
            throw new Error('Death transition review needs two living player squad members');
          hurt(actor, actor.health, { credit: 'environment', cause: 'boundary', subjectId: actor.id }, 'boundary');
          this.naturalResumeState = state;
          setGameState('pause');
          return actor.id;
        },
        naturalWithdrawalStep(seconds) {
          if (state === 'pause') setGameState(this.naturalResumeState);
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            if (!activeStates.has(state)) break;
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          this.naturalResumeState = state;
          if (activeStates.has(state)) setGameState('pause');
          return this.naturalWithdrawalSnapshot();
        },
        naturalWithdrawalSnapshot() {
          return { time, gameState: state === 'pause' ? this.naturalResumeState : state,
            controlledId: entities.control.soldierId,
            stage: sihangCampaign.stage, stageElapsed: sihangCampaign.stageElapsed,
            assemblyReleased: sihangCampaign.assemblyReleased, counterattack: sihangCampaign.counterattack,
            assemblyPrepared: sihangCampaign.assemblyPrepared, outcome: sihangCampaign.outcome,
            saved: sihangCampaign.evacuatedIds.length, lost: sihangCampaign.retreatLostIds.length,
            savedIds: [...sihangCampaign.evacuatedIds], lostIds: [...sihangCampaign.retreatLostIds],
            reserve: sihangCampaign.retreatReserve,
            deaths: window.__retreatDeaths ?? [],
            wave: sihangCampaign.withdrawalWave && structuredClone(sihangCampaign.withdrawalWave),
            friendly: friendlyForces.filter(actor => actor.health > 0).map(actor => ({
              id: actor.id, playerUnit: actor.playerUnit, position: actor.position.toArray(),
              index: actor.index, slot: actor.formation.sihangSlot, order: actor.order,
              goal: actor.playerUnit ? playerOrderDestination(actor, controlledSoldier(entities))
                : sihangActorAssemblyGoal(actor), mode: actor.tactics.mode,
              assemblyGoal: sihangActorAssemblyGoal(actor), assemblySlot: actor.sihangAssemblySlot,
              assemblyRoute: actor.sihangAssemblyRoute,
              path: actor.path?.slice(0, 3), pathGoal: actor.pathGoal, pathReason: actor.tactics.pathReason,
              nextPath: actor.nextPath, blocked: actor.tactics.blockedBy,
              engineer: actor.engineer && { site: actor.engineer.site,
                mode: actor.engineer.construction.mode },
              traffic: actor.tactics.traffic && { reason: actor.tactics.traffic.reason,
                waitSeconds: actor.tactics.traffic.waitSeconds },
              ...(actor.playerUnit ? { traversal: actor.traversal.kind, grenadeAction: actor.grenades.action,
                blastReaction: actor.blastReaction, dying: actor.dying,
                pendingPath: pathRequests.get(actor.tactics.id)?.target,
              } : {}) })),
            formations: formations.filter(formation => formation.team === 'friendly').map(formation => ({ id: formation.id,
              player: formation.player, retreatAssembled: formation.retreatAssembled,
              living: formation.members.filter(actor => actor.health > 0).length,
              appearances: formation.members.filter(actor => actor.health > 0).map(actor => actor.avatarAppearance?.uniform ?? null) })),
            nativeNraLoaded: Boolean(nraCharacter),
            player: controlledSoldier(entities)?.position.toArray() ?? null,
            ...(${JSON.stringify(process.env.NATURAL_TRACE_BRIDGE === '1')} ? {
              bridgeEnemies: enemies.filter(actor => actor.health > 0 && !actor.vehicleId).map(actor => ({
                id: actor.id, index: actor.index, formation: actor.formation.index, position: actor.position.toArray(), mode: actor.tactics.mode,
                path: actor.path?.slice(0, 3), pathGoal: actor.pathGoal, target: actor.target?.id ?? null,
                pursuit: actor.tactics.sihangPursuit, shots: actor.rifle?.shots ?? 0 })),
              bridgeArmor: [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'tank' && vehicle.team === 'enemy')
                .map(vehicle => ({ id: vehicle.id, position: vehicle.position.toArray(), health: vehicle.health,
                  goal: vehicle.ai?.goal, mode: vehicle.ai?.mode, shots: vehicle.ai?.shots ?? 0 })),
            } : {}),
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
                JSON.stringify(invalidTraffic) + '; control events=' + JSON.stringify(controlEvents.snapshot) +
                '; ' + error.stack);
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
          this.waveFixtureTrackSpawns();
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
          if (!this.waveGenerations) this.waveFixtureBeginSpawnTracking();
          else this.waveFixtureTrackSpawns();
          return this.waveFixtureSnapshot();
        },
        waveFixtureBeginSpawnTracking() {
          this.waveSpawnRecords = [];
          this.waveGenerations = formations.filter(f => f.team === 'friendly' && !f.player).map(f => f.generation);
        },
        waveFixtureTrackSpawns() {
          if (this.waveGenerations) for (const [slot, formation] of formations.filter(f =>
            f.team === 'friendly' && !f.player).entries()) {
            if (formation.generation > this.waveGenerations[slot]) {
              this.waveSpawnRecords.push({ slot, time, elapsed: sihangCampaign.elapsed });
              this.waveGenerations[slot] = formation.generation;
            }
          }
        },
        waveFixtureStep(seconds, safeRefill = false) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            if (safeRefill) {
              for (const actor of friendlyForces) if (actor.health > 0) actor.health = 100000;
              for (const actor of enemies) actor.nextFire = time + 1000000;
              for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            }
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            this.waveFixtureTrackSpawns();
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
        waveFixtureEarlyRefillSnapshot() {
          const wave = sihangCampaign.withdrawalWave;
          const original = new Set(wave?.squads.flat() ?? []);
          return { elapsed: sihangCampaign.elapsed, assemblyAt: sihangCampaign.waveAssemblyAt,
            wave: wave && structuredClone(wave), reserve: sihangCampaign.retreatReserve,
            recruits: friendlyAI.filter(actor => actor.health > 0 && !original.has(actor.id)).map(actor => ({
              id: actor.id, slot: actor.formation.sihangSlot, position: actor.position.toArray(),
              mode: actor.tactics.mode })) };
        },
        waveFixtureLimitReserve(count) {
          if (!Number.isInteger(count) || count < 0 || count > sihangCampaign.retreatReserve)
            throw new RangeError('Fixture reserve must be within the actual remaining reserve');
          const removed = sihangCampaign.retreatReserve - count;
          sihangCampaign.retreatReserve -= removed;
          sihangCampaign.reserve -= removed;
          sihangCampaign.retreatTotal -= removed;
          return this.waveFixtureEarlyRefillSnapshot();
        },
        waveFixtureLoseEarlyRecruit() {
          const wave = sihangCampaign.withdrawalWave;
          const original = new Set(wave.squads.flat());
          const actor = friendlyAI.find(item => item.health > 0 && !original.has(item.id));
          if (!actor) throw new Error('Expected an early replacement soldier');
          actor.health = 0;
          updateSihangMission(.05);
          return { id: actor.id, original: original.has(actor.id),
            lost: sihangCampaign.retreatLostIds.includes(actor.id),
            phase: sihangCampaign.withdrawalWave?.phase };
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
            savedIds: [...sihangCampaign.evacuatedIds], lostIds: [...sihangCampaign.retreatLostIds],
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
                goalBlocked: actor && infantryNavigationBlocked(sihangRetreatGoal(actor), actor.position, .43, actor),
                mode: actor?.tactics.mode, blocked: actor?.tactics.blockedBy,
                blocker: blocker && { id: blocker.id, playerUnit: blocker.playerUnit, friendly: blocker.friendly,
                  position: blocker.position.toArray(), mode: blocker.tactics.mode },
                target: actor?.target && { id: actor.target.id, health: actor.target.health,
                  position: actor.target.position.toArray(), vehicleId: actor.target.vehicleId,
                  targetKind: actor.target.targetKind },
                vehicles: actor && [...entities.vehicles.values()].filter(vehicle =>
                  vehicle.type === 'tank' && vehicle.health > 0 &&
                  Math.hypot(vehicle.position.x - actor.position.x, vehicle.position.z - actor.position.z) < 12)
                  .map(vehicle => ({ id: vehicle.id, position: vehicle.position.toArray(), heading: vehicle.heading,
                    speed: vehicle.speed, collider: vehicleCollider(vehicle) })),
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
            refill: formations.filter(f => f.team === 'friendly' && !f.player).map(f => ({
              id: f.id, living: f.members.filter(actor => actor.health > 0).length,
              blocked: f.blockedReason, respawnAt: f.respawnAt })),
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
        armorInterceptStart() {
          this.waveFixtureStart();
          this.waveFixtureCross();
          const intruder = enemies.find(actor => !actor.vehicleId && !actor.formation.sihangDemolition);
          const tank = [...entities.vehicles.values()].find(vehicle => vehicle.type === 'tank' &&
            vehicle.team === 'enemy' && entities.units.get(vehicle.unitId).armorSlot === 1);
          if (!intruder || !tank) throw new Error('Armor interception fixture requires an intruder and the east tank');
          intruder.tactics.sihangEnteredWarehouse = true;
          tank.position.set(74.91434583905716, 0, -55.52891010576034);
          tank.ai = null;
          for (const actor of allForces) actor.health = 100000;
          this.armorInterceptId = tank.id;
          return this.armorInterceptSnapshot();
        },
        armorInterceptSnapshot() {
          const tank = entities.vehicles.get(this.armorInterceptId);
          const goal = tank.ai?.goal;
          const planner = goal && createNavigator(world.armorObstacles, 1.5, 3.1);
          const staticPath = planner ? planner(tank.position, goal) : null;
          return { time, position: tank.position.toArray(), mode: tank.ai?.mode, goal: tank.ai?.goal,
            path: tank.ai?.path?.slice(0, 3), navigation: armorNavigate.stats(tank), staticPath,
            staticStats: planner?.stats,
            goalBlockers: goal && world.armorObstacles.filter(obstacle =>
              circleBlocked(goal.x, goal.z, 3.1, [obstacle])).map(obstacle => ({ ...obstacle })),
            nearbyProtected: enemies.filter(actor => actor.health > 0 && actor.tactics.sihangDemolitionReturned &&
              Math.hypot(actor.position.x - tank.position.x, actor.position.z - tank.position.z) < 12)
              .map(actor => ({ id: actor.id, position: actor.position.toArray() })) };
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
                evacuated: Boolean(a.sihangEvacuated),
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
  if (process.env.MASS_MECHANICAL_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => retreatReview.massMechanicalCueStep());
    await writeFile(join(directory, 'mass-mechanical-cues.json'), JSON.stringify({
      fixture: 'production-battle-step-synchronized-owned-rifle-reloads', result, errors }, null, 2));
    assert.ok(result.actors >= 65 && result.advanced >= 65,
      'at least 65 real soldiers must advance their own rifle actions');
    const cues = result.events.history.filter(event => event.type === 'weapon.mechanical');
    assert.ok(cues.some(event => event.soldierId === result.player && event.cue === 'unlock'),
      'the controlled soldier must receive its own mechanical cue');
    assert.ok(cues.every(event => event.soldierId === result.player),
      'background cues must not enter the controlled feedback queue');
    assert.equal(result.events.pending, 0, 'the real battle step must drain its feedback');
    assert.deepEqual(errors, []);
    console.log('Mass mechanical cue feedback passed.');
  }
  if (process.env.NATURAL_DEATH_REVIEW_ONLY === '1') {
    await page.evaluate(() => retreatReview.naturalWithdrawalStart());
    const original = await page.evaluate(() => retreatReview.naturalDeathStart());
    const records = [];
    for (let step = 0; step < 12; step++)
      records.push(await page.evaluate(() => retreatReview.naturalWithdrawalStep(.1)));
    await writeFile(join(directory, 'natural-death-transition.json'), JSON.stringify({
      fixture: 'synthetic-boundary-damage-production-death-transfer-manual-0.05s-steps',
      original, records, errors }, null, 2));
    assert.ok(records.some(record => record.gameState === 'transferring' && record.controlledId === original));
    assert.ok(records.some(record => record.gameState === 'transferring' && record.controlledId !== original));
    assert.equal(records.at(-1).gameState, 'playing');
    assert.notEqual(records.at(-1).controlledId, original);
    assert.deepEqual(errors, []);
    console.log('Death transfer preserved across manual simulation batches.');
  }
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
    for (let step = 0; step < 18; step++) {
      records.push(await page.evaluate(() => retreatReview.pursuitReviewStep(5)));
      await writeFile(join(directory, 'pursuit.json'), JSON.stringify({
        fixture: 'manual-warehouse-positions-artificial-breach-and-counterattack-firing-disabled-health-raised',
        records, errors }, null, 2));
    }
    const first = records[0], last = records.at(-1);
    assert.equal(last.counterattack, true);
    assert.ok(records[12].attackers.every(actor => actor.entered));
    assert.ok(records[12].attackers.some(actor => actor.pursuit === 'intercept-withdrawal'));
    assert.ok(last.attackers.every(actor => actor.entered && actor.pursuit === 'intercept-withdrawal'));
    assert.ok(last.attackers.filter((actor, index) => actor.position[0] - first.attackers[index].position[0] > 8).length >= 3,
      'armed soldiers inside the warehouse must physically progress toward the retreat corridor');
    assert.deepEqual(errors, []);
  }
  if (process.env.BRIDGE_ENGINEER_REVIEW_ONLY === '1') {
    const profile = process.env.BRIDGE_ENGINEER_PROFILE ?? 'maxim24';
    const group = process.env.BRIDGE_ENGINEER_GROUP === '1';
    const records = [await page.evaluate(({ withWork, profile, group }) => retreatReview.bridgeWorkStart(withWork, profile, group),
      { withWork: process.env.BRIDGE_ENGINEER_BASELINE !== '1', profile, group })];
    for (let i = 0; i < (group ? 30 : 15); i++) records.push(await page.evaluate(() => retreatReview.bridgeWorkStep(2)));
    await writeFile(join(directory, 'bridge-engineer.json'), JSON.stringify({
      fixture: 'production-ai-manually-assembled-bridge-work-enemy-infantry-disabled-friendly-health-raised',
      profile, records, errors }, null, 2));
    console.log(JSON.stringify({ initial: records[0], final: records.at(-1) }));
    assert.ok(records.some(record => sihangBridgeCoordinates({ x: record.position[0], z: record.position[2] }).along > SIHANG_BRIDGE.length),
      'the retreating soldier must cross the bridge around the built emplacement');
    assert.equal(records.at(-1).crossed.length, group ? 4 : 1, 'every tracked soldier must cross');
    assert.equal(records.at(-1).overlaps, 0, 'the soldier must not overlap the built emplacement');
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
  if (process.env.BRIDGE_INTERCEPT_FIRE_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.bridgeInterceptFireStart())];
    for (let i = 0; i < 4; i++) records.push(await page.evaluate(() => retreatReview.nightFireStep(2)));
    await writeFile(join(directory, 'bridge-intercept-fire.json'), JSON.stringify({
      fixture: 'two-man-isolated-night-bridge-production-ai-target-health-raised', records, errors }, null, 2));
    const distance = Math.hypot(records[0].shooter[0] - records[0].target[0],
      records[0].shooter[2] - records[0].target[2]);
    assert.ok(distance > 20);
    assert.equal(records[0].visible, true);
    assert.ok(records.at(-1).shots > records[0].shots, 'the enemy must actually fire from the interception post');
    assert.ok(records.at(-1).health < records[0].health, 'the enemy must hit the bridge approach through the real firing path');
    assert.deepEqual(errors, []);
  }
  if (process.env.ARMOR_INTERCEPT_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.armorInterceptStart())];
    for (let i = 0; i < Number(process.env.ARMOR_INTERCEPT_STEPS ?? 10); i++) {
      await page.evaluate(() => retreatReview.enemyRegroupStep(2));
      records.push(await page.evaluate(() => retreatReview.armorInterceptSnapshot()));
    }
    await writeFile(join(directory, 'armor-intercept.json'), JSON.stringify({
      fixture: 'manual-observed-blocked-tank-position-production-updates-firing-disabled-health-raised',
      records, errors }, null, 2));
    const last = records.at(-1), goal = last.goal;
    assert.ok(goal && Math.hypot(last.position[0] - goal.x, last.position[2] - goal.z) <= 1.25,
      'the observed tank position must be within the new arrival radius');
    assert.ok(['hold', 'engage'].includes(last.mode), 'the tank must not remain blocked at its destination');
    assert.deepEqual(errors, []);
  }
  if (process.env.RETREAT_ENGINEER_REVIEW_ONLY === '1') {
    const start = await page.evaluate(() => retreatReview.engineerRetreatStart());
    const engineer = start.roles.indexOf('engineer');
    assert.ok(engineer >= 0);
    for (let index = start.current; index !== engineer; index = (index + 1) % start.roles.length)
      await page.keyboard.press('y');
    await page.keyboard.press('2');
    const artillery = process.env.RETREAT_ENGINEER_ARTILLERY;
    if (artillery && !['quay', 'bridge'].includes(artillery)) throw new Error('Invalid artillery review region');
    if (artillery) await page.keyboard.press('r');
    const site = await page.evaluate(region => retreatReview.engineerRetreatSite(region), artillery ?? 'quay');
    await page.mouse.down();
    const records = [];
    for (let step = 0; step < 5; step++) records.push(await page.evaluate(() => retreatReview.engineerRetreatStep(5)));
    await page.mouse.up();
    await writeFile(join(directory, artillery ? `retreat-engineer-artillery-${artillery}.json` : 'retreat-engineer.json'), JSON.stringify({
      fixture: `manual-${artillery ?? 'quay'}-site-actual-y-tool-${artillery ? 'r-and-' : ''}mouse-held-enemy-fire-disabled-health-raised`,
      site, records, errors }, null, 2));
    assert.equal(records.at(-1).id, site.id);
    assert.equal(records.at(-1).works.length, 1, 'the player engineer must really build at the selected site');
    assert.equal(records.at(-1).materials.maxim24, artillery ? 1 : 0);
    assert.equal(records.at(-1).materials.bofors75, artillery ? 0 : 1);
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
  if (process.env.WAVE_COVER_SPACING_REVIEW_ONLY === '1') {
    const result = await page.evaluate(() => retreatReview.waveFixtureCoverSpacing());
    await writeFile(join(directory, 'wave-cover-spacing.json'), JSON.stringify({
      fixture: 'manual-cover-egress-production-ai-step-with-nearby-friendly-and-enemy', result, errors }, null, 2));
    assert.ok(result.neighbors, 'the production cover-egress branch must actually run');
    assert.ok(result.neighbors.all.some(other => other.id === result.peer), 'the friendly must be in the actual traffic grid');
    assert.ok(result.neighbors.all.some(other => other.id === result.enemy), 'the enemy must be in the actual traffic grid');
    assert.ok(result.neighbors.steering.includes(result.peer), 'cover egress must still avoid nearby friendlies');
    assert.ok(!result.neighbors.steering.includes(result.enemy), 'cover egress must not let an enemy trap the soldier');
    assert.deepEqual(errors, []);
  }
  if (process.env.NATURAL_RETREAT_REVIEW_ONLY === '1') {
    const started = await page.evaluate(() => retreatReview.naturalWithdrawalStart());
    const playerStart = await page.evaluate(() => retreatReview.naturalWithdrawalPlayerStart(Math.PI));
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(1500);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(process.env.NATURAL_RETREAT_EXTENDED === '1' ? 8200 : 7000);
    await page.keyboard.up('w');
    const playerTravel = await page.evaluate(() => retreatReview.naturalWithdrawalPause());
    const records = [started.state, playerStart, playerTravel];
    if (process.env.NATURAL_RETREAT_EXTENDED === '1') {
      const legs = [
        { yaw: 0, axis: 2, limit: -14, direction: -1 },
        { yaw: -Math.PI / 2, axis: 0, limit: 30, direction: 1 },
        { yaw: Math.PI, axis: 2, limit: -5.5, direction: 1 },
        { yaw: Math.PI / 2, axis: 0, limit: 24, direction: -1 },
      ];
      for (const leg of legs) {
        await page.evaluate(yaw => retreatReview.naturalWithdrawalPlayerStart(yaw), leg.yaw);
        await page.keyboard.down('w');
        let stalled = 0;
        for (let step = 0; step < 100; step++) {
          const before = records.at(-1), next = await page.evaluate(() => retreatReview.naturalWithdrawalStep(.5));
          records.push(next);
          if (!next.player || leg.direction * (next.player[leg.axis] - leg.limit) >= 0) break;
          if (!before.player || Math.abs(next.player[leg.axis] - before.player[leg.axis]) < .02) stalled++;
          else stalled = 0;
          if (stalled >= 8) break;
        }
        await page.keyboard.up('w');
        await writeFile(join(directory, 'natural-retreat-steering.json'), JSON.stringify({
          fixture: 'natural-spawn-normal-health-live-combat-synthetic-W-manual-camera-steering', legs, records, errors }, null, 2));
        if (!records.at(-1).player || leg.direction * (records.at(-1).player[leg.axis] - leg.limit) < 0) break;
      }
    }
    const reachedAssembly = player => player && player[0] >= -34 && player[0] <= 26 &&
      player[2] >= -7.7 && player[2] <= -.4 && Math.abs(player[1]) < .4;
    const naturalWaves = Number(process.env.NATURAL_WAVES ?? 1);
    if (!Number.isInteger(naturalWaves) || naturalWaves < 1 || naturalWaves > 10)
      throw new RangeError('Invalid natural withdrawal wave count');
    const enteredAssembly = reachedAssembly(records.at(-1).player);
    const assemblyOnly = process.env.NATURAL_ASSEMBLY_ONLY === '1';
    const appearanceOnly = process.env.NATURAL_APPEARANCE_ONLY === '1';
    const realTime = process.env.NATURAL_REALTIME_REVIEW === '1';
    if (realTime && (!enteredAssembly || process.env.NATURAL_RETREAT_EXTENDED !== '1' || assemblyOnly || appearanceOnly))
      throw new Error('Real-time withdrawal requires the extended steering run and a player in the assembly area');
    if (realTime) await page.evaluate(() => retreatReview.naturalWithdrawalResume());
    let crowdCaptured = false;
    for (let step = 0; step < (assemblyOnly ? 24 : process.env.NATURAL_RETREAT_EXTENDED === '1' ? 60 * naturalWaves : 6) &&
      (process.env.NATURAL_RETREAT_EXTENDED !== '1' || enteredAssembly); step++) {
      if (realTime) {
        await page.waitForTimeout(5000);
        records.push(await page.evaluate(() => retreatReview.naturalWithdrawalSnapshot()));
      } else records.push(await page.evaluate(() => retreatReview.naturalWithdrawalStep(5)));
      if (process.env.NATURAL_RETREAT_EXTENDED === '1') {
        await writeFile(join(directory, 'natural-retreat-progress.json'), JSON.stringify({
          fixture: realTime
            ? 'natural-spawn-synthetic-input-and-manual-clock-jump-then-live-headless-frame-loop'
            : 'natural-spawn-actual-input-stage-clock-advanced-only-normal-health-and-live-combat-simulated-steps',
          started, records, errors }, null, 2));
        const latest = records.at(-1);
        if (process.env.NATURAL_CAPTURE_CROWD === '1' && !crowdCaptured &&
          latest.wave?.number === 1 && latest.stageElapsed >= 120) {
          const image = await page.evaluate(() => retreatReview.captureNaturalCrowd());
          await writeFile(join(directory, 'natural-crowd.png'), Buffer.from(image, 'base64'));
          crowdCaptured = true;
        }
        console.log(JSON.stringify({ elapsed: latest.stageElapsed, prepared: latest.assemblyPrepared,
          released: latest.assemblyReleased, wave: latest.wave?.number, phase: latest.wave?.phase, saved: latest.saved,
          lost: latest.lost, outcome: latest.outcome, player: latest.player }));
        if (appearanceOnly && latest.nativeNraLoaded &&
          latest.formations.some(formation => formation.id === 'friendly-10' && formation.appearances.includes('B')) ||
          assemblyOnly && latest.assemblyPrepared ||
          latest.wave?.number >= naturalWaves && latest.wave?.phase === 'interval' || latest.outcome) break;
      }
    }
    if (process.env.NATURAL_CAPTURE_CROWD === '1')
      assert.ok(crowdCaptured, 'the withdrawal crowd capture must actually be produced');
    const initial = new Map(started.initial.map(actor => [actor.id, actor.position]));
    const movedById = new Map();
    for (const record of records) for (const actor of record.friendly)
      if (!actor.playerUnit && initial.has(actor.id) &&
        Math.hypot(actor.position[0] - initial.get(actor.id)[0],
          actor.position[2] - initial.get(actor.id)[2]) > .5) movedById.set(actor.id, actor);
    const moved = [...movedById.values()];
    await writeFile(join(directory, 'natural-retreat-formation.json'), JSON.stringify({ fixture:
      process.env.NATURAL_RETREAT_EXTENDED === '1'
        ? realTime ? 'natural-spawn-synthetic-W-manual-steering-and-clock-jump-then-live-headless-frame-loop'
          : 'natural-spawn-normal-health-live-combat-synthetic-W-manual-camera-steering-stage-clock-jump-and-simulated-steps'
        : 'natural-starting-positions-and-health-stage-clock-advanced-only-enemy-fire-enabled',
      started, records, moved: moved.map(actor => ({ id: actor.id, position: actor.position,
        goal: actor.goal, mode: actor.mode, path: actor.path, blocked: actor.blocked })),
      errors }, null, 2));
    if (process.env.NATURAL_TRACE_BRIDGE === '1')
      await writeFile(join(directory, 'bridge-continuous-minima.json'), JSON.stringify({
        fixture: 'every-battle-step-after-counterattack', minima: await page.evaluate(() => retreatReview.bridgeContinuousSnapshot()),
        errors }, null, 2));
    assert.equal(records.at(-1).stage, 'sihang-retreat',
      'the controlled clock transition must enter the actual withdrawal stage');
    assert.ok(moved.length > 0,
      'at least one naturally spawned AI squad member must physically move from its original battlefield position toward assembly');
    assert.ok(playerTravel.player && Math.hypot(playerTravel.player[0] - playerStart.player[0],
      playerTravel.player[2] - playerStart.player[2]) > .5,
    'actual W and sprint input must move the naturally spawned player toward assembly');
    if (process.env.NATURAL_RETREAT_EXTENDED === '1') {
      if (appearanceOnly) {
        assert.ok(records.some(record => record.nativeNraLoaded &&
          record.formations.some(formation => formation.id === 'friendly-10' && formation.appearances.includes('B'))),
        'the tenth AI squad must spawn with the loaded native appearance');
      } else if (assemblyOnly) {
        assert.ok(records.some(record => record.assemblyPrepared),
          'the player and living squad must reach the assembly area within the diagnostic window');
      } else {
        assert.ok(records.some(record => record.assemblyReleased), 'the player squad must actually reach the assembly area');
        assert.ok(records.some(record => record.wave?.number >= naturalWaves && record.wave.phase === 'interval'),
          `withdrawal wave ${naturalWaves} must complete without changing positions or health`);
        for (let number = 1; number <= naturalWaves; number++) {
          const wave = records.find(record => record.wave?.number === number && record.wave.phase === 'interval');
          assert.ok(wave, `withdrawal wave ${number} must reach its interval`);
          const resolved = new Set([...wave.savedIds, ...wave.lostIds]);
          assert.ok(wave.wave.squads.flat().every(id => resolved.has(id)),
            `every original member of withdrawal wave ${number} must be evacuated or killed`);
        }
        if (process.env.NATURAL_FOLLOW_WALL_REVIEW === '1') {
          const release = records.find(record => record.assemblyReleased);
          const initialPositions = new Map(release.friendly.map(actor => [actor.id, actor.position]));
          assert.ok(records.some(record => record.wave?.number === 1 && record.friendly.filter(actor => {
            const start = initialPositions.get(actor.id);
            return actor.playerUnit && actor.id !== record.controlledId && actor.order === 'follow' && start &&
              Math.abs(actor.goal?.z + 6.7) < 1e-6 &&
              Math.hypot(actor.position[0] - actor.goal.x, actor.position[2] - actor.goal.z) < 1.2 &&
              Math.hypot(actor.position[0] - start[0], actor.position[2] - start[2]) > 1;
          }).length >= 3), 'following soldiers must physically move from assembly to their wall-side goals');
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log('Natural-position withdrawal movement passed.');
  }
  if (process.env.WAVE_EARLY_REFILL_REVIEW_ONLY === '1') {
    await page.evaluate(() => retreatReview.waveFixtureStart());
    await page.evaluate(() => retreatReview.waveFixtureCross());
    const covering = process.env.WAVE_EARLY_NO_COVER !== '1';
    if (covering) await page.evaluate(() => retreatReview.waveFixtureAttack());
    const cover = await page.evaluate(() => retreatReview.waveFixtureResolveMain());
    assert.equal(cover.wave?.phase, covering ? 'cover' : 'main');
    await page.evaluate(() => retreatReview.waveFixtureStep(6, true));
    const early = await page.evaluate(() => retreatReview.waveFixtureEarlyRefillSnapshot());
    assert.equal(early.wave?.phase, covering ? 'cover' : 'main',
      'the last original squad must still be withdrawing');
    assert.ok(early.recruits.length > 0, 'replacement soldiers must start preparing before cover completes');
    assert.ok(early.recruits.every(actor => actor.mode === 'sihang-assembly'),
      'new soldiers must prepare, not leave in the old wave');
    assert.ok(Number.isFinite(early.assemblyAt), 'next-wave countdown must start during cover withdrawal');
    await page.waitForTimeout(500);
    const paused = await page.evaluate(() => retreatReview.waveFixtureEarlyRefillSnapshot());
    assert.equal(paused.elapsed, early.elapsed, 'pausing must freeze the early assembly countdown');
    assert.equal(paused.assemblyAt, early.assemblyAt);
    const casualty = await page.evaluate(() => retreatReview.waveFixtureLoseEarlyRecruit());
    assert.equal(casualty.original, false);
    assert.equal(casualty.lost, true, 'a replacement casualty must retain its own loss identity');
    assert.equal(casualty.phase, early.wave.phase, 'a replacement loss must not resolve the original wave');
    await page.evaluate(() => retreatReview.waveFixtureResolveCover());
    await page.evaluate(() => retreatReview.waveFixtureStep(5.5, true));
    const next = await page.evaluate(() => retreatReview.waveFixtureEarlyRefillSnapshot());
    await writeFile(join(directory, 'wave-early-refill.json'), JSON.stringify({
      fixture: 'manual-wave-losses-cover-and-enemy-fire-disabled-production-mission-and-ai',
      cover, early, paused, casualty, next, errors,
    }, null, 2));
    assert.equal(next.assemblyAt, early.assemblyAt, 'interval must not restart the next-wave countdown');
    assert.deepEqual(errors, []);
    console.log('Early wave preparation passed.');
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
    assert.deepEqual(records[0].wave.squads.map(squad => squad.length),
      Array(SIHANG_RULES.retreatSquads).fill(SIHANG_RULES.squadMembers));
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
    await page.evaluate(() => retreatReview.waveFixtureBeginSpawnTracking());
    records.push(await page.evaluate(() => retreatReview.waveFixtureResolveMain()));
    assert.equal(records.at(-1).wave.phase, 'cover');
    assert.equal(records.at(-1).voice.active, 'wave-cover');
    records.push(await page.evaluate(() => retreatReview.waveFixtureResolveCover()));
    assert.equal(records.at(-1).wave.phase, 'interval');
    const reserve = records.at(-1).reserve;
    records.push(await page.evaluate(() => retreatReview.waveFixtureStep(4.9, true)));
    assert.equal(records.at(-1).wave.phase, 'interval');
    assert.ok(records.at(-1).reserve <= reserve);
    records.push(await page.evaluate(() => retreatReview.waveFixtureStep(.2, true)));
    assert.equal(records.at(-1).wave, null);
    assert.ok(records.at(-1).reserve < reserve);
    assert.ok(records.at(-1).spawnRecords.some(birth => birth.elapsed <= records.at(-3).elapsed),
      'at least one squad must begin preparing during cover withdrawal');
    assert.equal(records.at(-1).total, records[0].total);
    records.push(await page.evaluate(seconds => retreatReview.waveFixtureStep(seconds, true),
      (SIHANG_RULES.retreatSpawnInterval + .05) * (SIHANG_RULES.retreatSquads - 1) + .2));
    const births = records.at(-1).spawnRecords;
    await writeFile(join(directory, 'wave-refill.json'), JSON.stringify({ records, errors }, null, 2));
    assert.equal(births.length, SIHANG_RULES.retreatSquads);
    assert.equal(new Set(births.map(birth => birth.slot)).size, SIHANG_RULES.retreatSquads);
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
  if (process.env.BRIDGE_OBSTACLE_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(({ replay, wreck }) => retreatReview.bridgeProbeStart(replay, wreck),
      { replay: process.env.BRIDGE_TRACE_REPLAY === '1', wreck: process.env.BRIDGE_WRECK_REPLAY === '1' })];
    const graph = await page.evaluate(() => retreatReview.bridgeProbeGraph());
    for (let i = 0; i < 10; i++) records.push(await page.evaluate(() => retreatReview.bridgeProbeStep(2)));
    await writeFile(join(directory, 'bridge-obstacle.json'), JSON.stringify({
      fixture: `production-map-manually-placed-soldier-and-held-${process.env.BRIDGE_WRECK_REPLAY === '1' ? 'zero-health-tank' : 'tank'}-infantry-disabled-friendly-health-raised`,
      records, graph, errors }, null, 2));
    console.log(JSON.stringify({ initial: records[0], final: records.at(-1) }));
    assert.ok(records.some(record => sihangBridgeCoordinates({ x: record.position[0], z: record.position[2] }).along > SIHANG_BRIDGE.length),
      'the soldier must actually cross the bridge without passing through the tank');
    assert.equal(records.at(-1).overlaps, 0, 'the soldier must not overlap the tank while crossing');
    assert.deepEqual(errors, []);
  }
  if (process.env.WAVE_LIMITED_RESERVE_REVIEW_ONLY === '1') {
    const remaining = Number(process.env.WAVE_LIMITED_RESERVE);
    if (![0, 7].includes(remaining)) throw new RangeError('Fixture needs zero or seven remaining reserves');
    await page.evaluate(() => retreatReview.waveFixtureStart());
    await page.evaluate(() => retreatReview.waveFixtureCross());
    await page.evaluate(() => retreatReview.waveFixtureAttack());
    const before = await page.evaluate(count => retreatReview.waveFixtureLimitReserve(count), remaining);
    await page.evaluate(() => retreatReview.waveFixtureResolveMain());
    await page.evaluate(() => retreatReview.waveFixtureStep(6, true));
    const early = await page.evaluate(() => retreatReview.waveFixtureEarlyRefillSnapshot());
    await page.evaluate(() => retreatReview.waveFixtureResolveCover());
    await page.evaluate(() => retreatReview.waveFixtureStep(6, true));
    await page.evaluate(() => retreatReview.waveFixtureAssembleNext());
    const next = await page.evaluate(() => retreatReview.waveFixtureEarlyRefillSnapshot());
    await writeFile(join(directory, 'wave-limited-reserve.json'), JSON.stringify({
      fixture: 'manual-wave-losses-artificially-limited-reserve-enemy-fire-disabled-production-mission-and-ai',
      before, early, next, errors }, null, 2));
    assert.equal(early.wave?.phase, 'cover');
    assert.equal(early.reserve, 0);
    assert.equal(early.recruits.length, remaining, 'only the remaining real reserve may be spawned');
    assert.ok(early.recruits.every(actor => actor.mode === 'sihang-assembly'));
    assert.equal(Number.isFinite(early.assemblyAt), remaining > 0);
    if (remaining) {
      assert.equal(next.wave?.number, 2);
      assert.deepEqual(new Set(next.wave.squads.flat()), new Set(early.recruits.map(actor => actor.id)),
        'the last partial wave must contain exactly the actual replacement identities');
    } else assert.equal(next.wave, null, 'no phantom wave can start after reserves are exhausted');
    assert.deepEqual(errors, []);
  }
  if (process.env.SURROUNDED_REVIEW_ONLY === '1') {
    const records = [await page.evaluate(() => retreatReview.surroundedStart())];
    for (let i = 0; i < 8; i++) records.push(await page.evaluate(() => retreatReview.surroundedStep(1)));
    const released = await page.evaluate(() => retreatReview.surroundedRelease());
    const afterRelease = await page.evaluate(() => retreatReview.surroundedStep(4));
    await writeFile(join(directory, 'surrounded.json'), JSON.stringify({
      fixture: 'production-ai-manually-surrounded-held-enemies-raised-health-no-ranged-fire-then-enemies-removed',
      records, released, afterRelease, errors }, null, 2));
    assert.ok(records.at(-1).hits - records[0].hits >= 2,
      'a soldier who remains trapped by observed nearby enemies must defend again');
    assert.ok(Math.hypot(afterRelease.position[0] - released.position[0],
      afterRelease.position[2] - released.position[2]) > .5,
    'the soldier must resume retreat after the surrounding enemies are removed');
    assert.deepEqual(errors, []);
  }
  if (process.env.WAVE_COVER_APPROACH_REVIEW_ONLY === '1') {
    const start = await page.evaluate(() => retreatReview.waveFixtureContactStart(true, 20));
    const blocked = await page.evaluate(() => retreatReview.waveFixtureCoverBlock());
    const whileBlocked = await page.evaluate(() => retreatReview.waveFixtureContactStep(.8, true));
    const released = await page.evaluate(() => retreatReview.waveFixtureCoverRelease());
    const result = await page.evaluate(() => retreatReview.waveFixtureContactStep(3, true));
    const empty = await page.evaluate(() => retreatReview.waveFixtureCoverAmmo(0, 0));
    const whileEmpty = await page.evaluate(() => retreatReview.waveFixtureContactStep(.5, true));
    const hidden = await page.evaluate(() => retreatReview.waveFixtureCoverHideTarget());
    await page.evaluate(() => retreatReview.waveFixtureCoverAmmo(3, 0));
    const whileHidden = await page.evaluate(() => retreatReview.waveFixtureContactStep(.5, true));
    await writeFile(join(directory, 'cover-approach.json'), JSON.stringify({
      fixture: 'production-ai-manually-placed-cover-and-target-other-enemies-disabled-natural-sensing-held-friendly-blocker',
      start, blocked, whileBlocked, released, result, empty, whileEmpty, hidden, whileHidden, errors,
    }, null, 2));
    assert.ok(start.coverGoalDistance > 2 && start.distance > 12 && start.clearShotLine);
    assert.equal(blocked.clearShotLine, false, 'a friendly soldier must obstruct the real firing line');
    assert.equal(whileBlocked.rifleShots, start.rifleShots, 'the covering soldier must not fire through the friendly blocker');
    assert.equal(released.clearShotLine, true, 'the line must become clear when the blocker leaves');
    assert.equal(result.threatId, start.target, 'covering soldier must actually observe the threat');
    assert.ok(result.coverGoalDistance > 2, 'the soldier must still be away from the assigned position');
    assert.ok(result.rifleShots > start.rifleShots,
      `covering soldier must fire before reaching a distant assigned position: ${JSON.stringify({ start, result })}`);
    assert.equal(whileEmpty.rifleShots, empty.rifleShots, 'an empty rifle must not fire');
    assert.equal(whileEmpty.mode, 'sihang-wave-cover-position', 'an empty rifle must not hold the soldier in place');
    assert.equal(hidden.visible, false, 'the target must actually be hidden by map geometry');
    assert.equal(whileHidden.visible, false);
    assert.equal(whileHidden.clearShotLine, false, 'the wall must obstruct the real firing line');
    assert.equal(whileHidden.rifleShots, hidden.rifleShots, 'stale observation must not permit fire through a wall');
    assert.equal(whileHidden.mode, 'sihang-wave-cover-position', 'the soldier must resume moving toward the cover position');
    assert.deepEqual(errors, []);
  }
  if (process.env.WAVE_PATH_REVIEW_ONLY === '1') {
    const liveCombat = process.env.WAVE_LIVE_COMBAT === '1';
    const contactStart = await page.evaluate(() => retreatReview.waveFixtureContactStart());
    const rangedContact = await page.evaluate(() => retreatReview.waveFixtureContactStep(2));
    let meleeStart, closeContact;
    assert.ok(rangedContact.rifleShots > contactStart.rifleShots,
      `a clear observed threat within 12 metres should draw a retreating rifle shot: start=${JSON.stringify(contactStart)} end=${JSON.stringify(rangedContact)}`);
    if (process.env.WAVE_SWITCH_REVIEW_ONLY === '1') {
      await page.evaluate(() => retreatReview.waveFixtureContactSetDistance(10));
      const switched = await page.evaluate(() => retreatReview.waveFixtureContactSwitchTarget());
      const afterSwitch = await page.evaluate(() => retreatReview.waveFixtureContactStep(2, true));
      await page.evaluate(() => retreatReview.waveFixtureContactSetDistance(10));
      const switchedBack = await page.evaluate(() => retreatReview.waveFixtureContactSwitchTarget());
      const afterReturn = await page.evaluate(() => retreatReview.waveFixtureContactStep(.8, true));
      const gap = await page.evaluate(() => retreatReview.waveFixtureContactBreak());
      const reappeared = await page.evaluate(() => retreatReview.waveFixtureContactReappear());
      const afterGap = await page.evaluate(() => retreatReview.waveFixtureContactStep(2, true));
      await writeFile(join(directory, 'contact-switch.json'), JSON.stringify({
        fixture: 'production-ai-manually-placed-targets-natural-observation-enemy-fire-disabled-health-raised',
        start: contactStart, rangedContact, switched, afterSwitch, switchedBack, afterReturn, gap, reappeared, afterGap, errors,
      }, null, 2));
      assert.notEqual(switched.contact?.targetId, switched.target,
        'the new observed target must differ from the previous contact');
      assert.equal(switched.nextFire, rangedContact.nextFire, 'switching target must not reset weapon cooldown');
      assert.ok(switched.clearShotLine && switched.distance <= 12, 'the new target must be visible and in range');
      assert.equal(afterSwitch.threatId, switched.target, 'production sensing must observe the replacement');
      assert.equal(afterSwitch.threatSense, 'vision');
      assert.ok(afterSwitch.rifleShots > switched.rifleShots,
        `a new observed threat should not inherit the previous target's shot cooldown: ${JSON.stringify({ switched, afterSwitch })}`);
      assert.equal(afterSwitch.contact?.targetId, switched.target);
      assert.equal(switchedBack.target, contactStart.target);
      assert.equal(switchedBack.nextFire, afterSwitch.nextFire, 'switching back must not reset weapon cooldown');
      assert.equal(afterReturn.threatId, switchedBack.target, 'production sensing must observe the original target again');
      assert.equal(afterReturn.threatSense, 'vision');
      assert.equal(afterReturn.rifleShots, switchedBack.rifleShots,
        `switching back to the same contact must not allow an unlimited new shot: ${JSON.stringify({ switchedBack, afterReturn })}`);
      assert.equal(gap.contact, null, 'the contact ends when no living enemy is nearby');
      assert.deepEqual(gap.cachedContacts, []);
      assert.equal(reappeared.nextFire, gap.nextFire, 'reappearance must not reset weapon cooldown');
      assert.ok(reappeared.clearShotLine && reappeared.distance <= 12);
      assert.equal(afterGap.threatId, reappeared.target);
      assert.equal(afterGap.threatSense, 'vision');
      assert.ok(afterGap.rifleShots > reappeared.rifleShots,
        'the same target can be engaged again after the previous encounter has ended');
      assert.deepEqual(errors, []);
    } else {
      meleeStart = await page.evaluate(() => retreatReview.waveFixtureContactSetDistance(6));
      closeContact = await page.evaluate(() => retreatReview.waveFixtureContactStep(8));
      assert.equal(closeContact.dadaoSwings, meleeStart.dadaoSwings + 1,
        `a retreating soldier should make one bounded Dadao attack before leaving the same close contact: ${JSON.stringify(closeContact)}`);
      assert.ok(Math.hypot(closeContact.position[0] - meleeStart.position[0],
        closeContact.position[2] - meleeStart.position[2]) > .1,
        `the retreat should resume after the bounded close-contact attack: ${JSON.stringify(closeContact)}`);
      console.log(JSON.stringify({ rangedContact, closeContact }));
      assert.deepEqual(errors, []);
    }
    if (process.env.WAVE_CONTACT_ONLY !== '1' && process.env.WAVE_SWITCH_REVIEW_ONLY !== '1') {
    await page.evaluate(() => retreatReview.restart());
    await page.waitForFunction(() => document.querySelector('#loading').hidden &&
      window.__battle?.state === 'playing', null, { timeout: 180000 });
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
      'the other squads must actually cross before the covering squad can leave');
    assert.ok(records.some(record => record.wave?.phase === 'interval' &&
      (liveCombat || records[0].wave.squads.flat().every(id =>
        record.savedIds.includes(id) || record.lostIds.includes(id)))),
      liveCombat ? 'every member must be evacuated or killed before the interval'
        : 'all original squads must be evacuated or explicitly counted as losses before the interval');
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
    const records = [await page.evaluate(() => retreatReview.regroupStart(false, true))];
    assert.equal(records[0].prepared, true);
    assert.equal(records[0].total, records[0].initialTotal);
    assert.equal(records[0].lost, 0);
    assert.equal(records[0].saved, 0);
    assert.deepEqual(records[0].oldPresent, records[0].originalAI);
    assert.deepEqual(records[0].playerEquipment, records[0].initialPlayerEquipment);
    const initialImage = await page.evaluate(() => retreatReview.capture([-64, 8, 8], [-40, 0, -4]));
    await writeFile(join(directory, 'west-spawn.png'), Buffer.from(initialImage, 'base64'));
    const last = records.at(-1);
    await writeFile(join(directory, 'regroup.json'), JSON.stringify({ fixture:
      'production-call-path-original-survivor-positions-elevated-health-manual-player-position',
      records, errors }, null, 2));
    assert.equal(last.released, true, 'the controlled soldier releases the first wave');
    assert.deepEqual(last.playerEquipment, last.initialPlayerEquipment);
    assert.equal(last.wave?.number, 1);
    assert.equal(last.wave.phase, 'main');
    assert.ok(last.originalAI.every(id => last.wave.squads.flat().includes(id)),
      'the first wave preserves existing independent soldiers');
    assert.ok(last.stageElapsed < SIHANG_RULES.nightfallSeconds);
    assert.deepEqual(errors, []);
    const image = await page.evaluate(() => retreatReview.capture([15, 5, 5], [-5, 1, -5]));
    await writeFile(join(directory, 'first-wave-start.png'), Buffer.from(image, 'base64'));
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
    assert.deepEqual(partial.at(-1).formations.filter(f => f.id !== 'friendly-0').map(f => f.size),
      [11, 7, ...Array(SIHANG_RULES.retreatSquads - 2).fill(0)]);
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
    assert.equal(crossing.release.wave?.phase, 'main', 'the first wave starts when the controlled player arrives');
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
  if (process.env.MASS_MECHANICAL_REVIEW_ONLY !== '1' &&
    process.env.NIGHT_BOUNDARY_REVIEW_ONLY !== '1' && process.env.REGROUP_REVIEW_ONLY !== '1' &&
    process.env.ENEMY_REGROUP_REVIEW_ONLY !== '1' && process.env.WAVE_REVIEW_ONLY !== '1' &&
    process.env.WAVE_OBSERVATION_REVIEW_ONLY !== '1' && process.env.WAVE_EARLY_REFILL_REVIEW_ONLY !== '1' &&
    process.env.WAVE_LIMITED_RESERVE_REVIEW_ONLY !== '1' &&
    process.env.WAVE_PATH_REVIEW_ONLY !== '1' && process.env.WAVE_COVER_APPROACH_REVIEW_ONLY !== '1' &&
    process.env.SURROUNDED_REVIEW_ONLY !== '1' &&
    process.env.BRIDGE_OBSTACLE_REVIEW_ONLY !== '1' && process.env.BRIDGE_ENGINEER_REVIEW_ONLY !== '1' &&
    process.env.FOLLOW_REVIEW_ONLY !== '1' &&
    process.env.WAVE_FOLLOW_REVIEW_ONLY !== '1' && process.env.WAVE_COVER_SPACING_REVIEW_ONLY !== '1' &&
    process.env.NATURAL_DEATH_REVIEW_ONLY !== '1' &&
    process.env.NATURAL_RETREAT_REVIEW_ONLY !== '1' &&
    process.env.PURSUIT_REVIEW_ONLY !== '1' && process.env.RETREAT_ENGINEER_REVIEW_ONLY !== '1' &&
    process.env.NIGHT_FIRE_REVIEW_ONLY !== '1' && process.env.BRIDGE_INTERCEPT_FIRE_REVIEW_ONLY !== '1' &&
    process.env.ARMOR_INTERCEPT_REVIEW_ONLY !== '1' &&
    process.env.EMPLACEMENT_REVIEW_ONLY !== '1' &&
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
  assert.equal(last.outcome, 'evacuated', 'every original identity must physically reach safety');
  assert.equal(last.evacuated, last.total);
  assert.ok(last.static <= Math.min(40, last.total - 1), 'the environmental formation is limited to forty evacuees');
  assert.equal(last.reserve, 0);
  assert.ok(last.remaining.every(actor => actor.evacuated), 'only already evacuated actors may still be walking to the parade');
  assert.ok(last.maximumStatic <= Math.min(40, last.total - 1));
  assert.ok(last.faded <= Math.max(0, last.total - 41));
  const exits = await page.evaluate(() => ({ records: retreatReview.exitRecords, image: retreatReview.fadeImage }));
  assert.equal(exits.records.length, last.faded);
  assert.ok(exits.records.every(actor => actor.position[2] > 72 && actor.slot >= 40 && actor.goal.exit));
  await writeFile(join(directory, 'exits.json'), JSON.stringify(exits.records, null, 2));
  if (exits.records.length) {
    assert.ok(exits.image, 'the real renderer must display an evacuee during the two-second fade');
    await writeFile(join(directory, 'native-evacuee-fade.png'), Buffer.from(exits.image, 'base64'));
  }
  assert.deepEqual(errors, []);
  await capture('south-bank-formation', [91, 13, 30], [67, 1, 53]);
  }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
