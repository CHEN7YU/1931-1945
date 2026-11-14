import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    const original = await response.text();
    const loop = 'const actor = allForces[(index + aiCursor) % allForces.length];';
    assert.ok(original.includes(loop), 'Could not isolate the enemy AI in the fixture');
    const source = original.replace(loop, `${loop} if (actor === window.focusReview?.enemy) continue;`);
    await route.fulfill({ response, body: source + `
      window.focusReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const player = controlledSoldier(entities);
          const squad = allies.filter(actor => actor !== player && actor.health > 0).slice(0, 2);
          const enemy = enemies.find(actor => actor.health > 0 && !actor.vehicleId);
          if (squad.length < 2 || !enemy) throw new Error('Focus fixture needs squadmates and an enemy');
          grenades.clear();
          for (const actor of allForces) if (actor !== player && actor !== enemy && !squad.includes(actor)) actor.health = 0;
          for (const formation of formations) if (!formation.player) formation.respawnEnabled = false;
          for (const vehicle of entities.vehicles.values()) if (vehicle.team === 'enemy') vehicle.health = 0;
          for (const actor of [...squad, enemy]) actor.grenades.ammo = 0;
          enemy.grenades.packs = 0;
          let found;
          for (let z = battleArea.minZ + 20; z < battleArea.maxZ - 20 && !found; z += 5)
            for (let x = battleArea.minX + 20; x < battleArea.maxX - 20 && !found; x += 5) {
              const points = [{x, z: z + 15}, {x: x - 3, z: z + 12},
                {x: x + 3, z: z + 12}, {x, z}];
              if (points.some(p => Math.abs(world.walkHeight(p.x, p.z, 0)) > .05 ||
                circleBlocked(p.x, p.z, .5, movementObstacles(p.x, p.z), 0))) continue;
              if (!points.slice(0, 3).every(p => hasLine(new THREE.Vector3(p.x, 1.6, p.z),
                new THREE.Vector3(x, 1.4, z), 30))) continue;
              found = points;
            }
          if (!found) throw new Error('No clear focus fixture');
          [player, ...squad, enemy].forEach((actor, index) => {
            actor.position.set(found[index].x, 0, found[index].z);
            actor.heading = index === 3 ? Math.PI : 0;
            actor.stance = 'standing'; actor.firingPose = null;
            actor.nextFire = index === 3 ? time + 1000 : 0;
            if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          });
          enemy.health = 100000;
          actorGrid.rebuild(allForces);
          controlPose.yaw = 0; controlPose.pitch = -.01;
          updateCamera(0);
          const aim = targetAimPoint(enemy);
          controlPose.pitch = Math.atan2(aim.y - camera.position.y, camera.position.z - aim.z);
          this.player = player; this.squad = squad; this.enemy = enemy; this.points = found;
          return { enemy: enemy.id, squad: squad.map(actor => ({ id: actor.id, ammo: actor.rifle.ammo })) };
        },
        press() {
          setGameState('playing');
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true }));
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', bubbles: true }));
          setGameState('pause');
          return this.squad.map(actor => actor.orderTarget);
        },
        startAssembly() {
          if (!sihangCampaignMode) throw new Error('Assembly focus review requires Sihang');
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return { stage: sihangCampaign.stage, released: sihangCampaign.assemblyReleased,
            positions: [this.player, ...this.squad, this.enemy].map(actor => actor.position.toArray()) };
        },
        step(seconds) {
          setGameState('playing');
          for (let i = 0; i < seconds / .05; i++) {
            time += .05;
            aiDecisions.beginFrame();
            updateWeaponSimulation(.05);
            updateAI(.05);
            for (const actor of this.squad) if (actor.nativeMotion) {
              updateAIWeaponClearance(actor);
              advanceNraMotion(actor, .05);
            }
            updateGrenades(.05);
          }
          setGameState('pause');
          return { health: this.enemy.health, shots: combatStats.aiRifleShots,
            squad: this.squad.map(actor => ({ target: actor.target?.id, mode: actor.tactics.mode,
              order: actor.orderTarget, health: actor.health, registered: entities.soldiers.has(actor.id),
              inForces: allForces.includes(actor), inSquad: allies.includes(actor), controlled: actor === controlledSoldier(entities),
              orderHealth: actor.orderTarget ? entities.vehicles.get(actor.orderTarget.id)?.health : null,
              ammo: actor.rifle.ammo, lastShot: actor.aiRifle.lastShot })) };
        },
        cancel() {
          setGameState('playing');
          document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true }));
          held.orderStarted -= 500;
          document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', bubbles: true }));
          setGameState('pause');
          return this.squad.map(actor => ({ order: actor.order, target: actor.orderTarget }));
        },
        blockPlayerSight() {
          this.aim(this.enemy.position, targetAimPoint(this.enemy).y);
          const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 3, .5), new THREE.MeshBasicMaterial());
          wall.position.set((this.player.position.x + this.enemy.position.x) / 2, 1.5,
            (this.player.position.z + this.enemy.position.z) / 2);
          scene.add(wall); wall.updateMatrixWorld(true);
          world.solids.push(wall); solidIndex.synchronize(world.solids);
          this.wall = wall;
        },
        removeWall() {
          world.solids.splice(world.solids.indexOf(this.wall), 1);
          scene.remove(this.wall); this.wall.geometry.dispose(); this.wall.material.dispose();
          solidIndex.synchronize(world.solids);
        },
        blockSquadSight() {
          [this.player, ...this.squad, this.enemy].forEach((actor, index) => {
            const point = this.points[index];
            actor.position.set(point.x, 0, point.z);
            actor.heading = index === 3 ? Math.PI : 0;
            actor.stance = 'standing'; actor.firingPose = null;
            actor.target = null; actor.tactics.lastSeen = null; actor.nextThink = 0;
            stopLocomotion(actor.locomotion);
            if (index === 1 || index === 2) {
              actor.order = 'hold'; actor.orderPoint = { ...point, y: 0 };
            }
            if (actor.nativeMotion) actor.nativeMotion.position = { x: point.x, z: point.z };
          });
          actorGrid.rebuild(allForces);
          this.aim(this.enemy.position, targetAimPoint(this.enemy).y);
          const wall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, .6), new THREE.MeshBasicMaterial());
          wall.position.set(this.enemy.position.x - 1.8, 1.5, this.enemy.position.z + 6);
          scene.add(wall); wall.updateMatrixWorld(true);
          world.solids.push(wall); solidIndex.synchronize(world.solids);
          this.wall = wall;
        },
        observeSquadSight(seconds) {
          let blocked = 0, blockedShots = 0, blockedAssembly = 0, otherShots = 0;
          for (let i = 0; i < seconds / .05; i++) {
            const actor = this.squad[0], eye = soldierEyePosition(actor);
            const visible = Boolean(visibleTargetPoint(this.enemy,
              point => hasLine(new THREE.Vector3(eye.x, eye.y, eye.z), point, 75)));
            const before = this.squad.map(item => item.rifle.shots);
            this.step(.05);
            if (!visible) {
              blocked++;
              blockedShots += actor.rifle.shots - before[0];
              if (actor.tactics.mode === 'sihang-assembly') blockedAssembly++;
            }
            otherShots += this.squad[1].rifle.shots - before[1];
          }
          return { blocked, blockedShots, blockedAssembly, otherShots, squad: this.squad.map(actor => ({
            ammo: actor.rifle.ammo, health: actor.health, target: actor.target?.id,
            order: actor.orderTarget, mode: actor.tactics.mode, blast: Boolean(actor.blastReaction),
            reload: actor.rifle.reload, position: actor.position.toArray() })) };
        },
        tank() {
          this.enemy.health = 0;
          this.squad.forEach((actor, index) => {
            const point = this.points[index + 1];
            actor.position.set(point.x, 0, point.z);
            actor.heading = 0; actor.stance = 'standing'; actor.firingPose = null;
            stopLocomotion(actor.locomotion);
            if (actor.nativeMotion) actor.nativeMotion.position = { x: point.x, z: point.z };
          });
          actorGrid.rebuild(allForces);
          const tank = createVehicleEntity(entities, { id: 'focus-review-armor',
            unitId: this.enemy.unitId, type: 'tank', team: 'enemy',
            position: new THREE.Vector3(this.points[3].x, 0, this.points[3].z) });
          vehicleRenderer.update(entities.vehicles.values(), time);
          this.aim(tank.position, tank.position.y + 1);
          this.tank = tank;
          return { id: tank.id, packs: this.squad.map(actor => actor.grenades.packs) };
        },
        aim(point, height) {
          updateCamera(0);
          const dx = point.x - camera.position.x, dz = point.z - camera.position.z;
          controlPose.yaw = Math.atan2(-dx, -dz);
          controlPose.pitch = Math.atan2(height - camera.position.y, Math.hypot(dx, dz));
        },
        tankResult() {
          return { health: this.tank.health, packs: this.squad.map(actor => actor.grenades.packs),
            actions: this.squad.map(actor => actor.grenades.action?.kind ?? null),
            active: grenades.active.map(item => ({ kind: item.kind, target: item.source?.subjectId })),
            tank: this.tank.position.toArray(), player: this.player.position.toArray(),
            squad: this.squad.map(actor => ({ position: actor.position.toArray(), health: actor.health,
              order: actor.orderTarget, mode: actor.tactics.mode, intent: actor.tactics.throwIntent,
              approach: actor.tactics.packApproach, rejection: actor.tactics.throwRejection,
              decisionAt: actor.tactics.throwDecisionAt,
              ceasefire: sihangCeasefire(actor), inForces: allForces.includes(actor),
              reservation: aiThrowReservations.get(actor.team + ':' + this.tank.id) ?? null,
              sight: hasLine(new THREE.Vector3(actor.position.x, actor.position.y + 1.6, actor.position.z),
                this.tank.position.clone().add(new THREE.Vector3(0, 1, 0)), 30, this.tank.id) })) };
        },
        stock(values) {
          this.squad.forEach((actor, index) => { actor.grenades.packs = values[index]; });
        },
        rifleStock(values) {
          const previous = this.squad.map(actor => ({ ammo: actor.rifle.ammo, reserve: actor.rifle.reserve }));
          this.squad.forEach((actor, index) => Object.assign(actor.rifle, values[index]));
          return previous;
        },
        southBankFocus() {
          this.enemy.health = 100000;
          this.squad.forEach((actor, index) => {
            const point = sihangBridgePoint(1.6, index * 2);
            actor.position.set(point.x, 0, point.z);
            actor.orderTarget = { kind: 'person', id: this.enemy.id };
            actor.target = null; actor.tactics.lastSeen = null; actor.nextThink = 0;
            if (actor.nativeMotion) actor.nativeMotion.position = { x: point.x, z: point.z };
          });
          actorGrid.rebuild(allForces);
          return this.squad.map(actor => sihangCeasefire(actor));
        },
        startFarApproach() {
          const actor = this.squad[0], tank = this.tank;
          this.originalTankPosition = tank.position.clone();
          this.originalTankHealth = tank.health;
          const targets = [{ ...tank.position }];
          for (let z = battleArea.minZ + 10; z < battleArea.maxZ - 10; z += 10)
            for (let x = battleArea.minX + 10; x < battleArea.maxX - 10; x += 10)
              targets.push({ x, y: 0, z });
          let start = null, target = null;
          for (const candidate of targets) {
            if (Math.abs(world.walkHeight(candidate.x, candidate.z, candidate.y) - candidate.y) > .05 ||
              circleBlocked(candidate.x, candidate.z, 2, movementObstacles(candidate.x, candidate.z), candidate.y) ||
              world.isDeepWater?.(candidate.x, candidate.z) ||
              this.player.position.distanceTo(candidate) < 10 ||
              this.squad[1].position.distanceTo(candidate) < 10) continue;
            for (let angle = 0; angle < Math.PI * 2 && !start; angle += Math.PI / 12) {
              const dx = Math.cos(angle), dz = Math.sin(angle), distance = 34;
              const point = { x: candidate.x + dx * distance, y: candidate.y, z: candidate.z + dz * distance };
              if (point.x < battleArea.minX + 1 || point.x > battleArea.maxX - 1 ||
                point.z < battleArea.minZ + 1 || point.z > battleArea.maxZ - 1) continue;
              let clear = true;
              for (let d = 25; d <= distance; d++) {
                const x = candidate.x + dx * d, z = candidate.z + dz * d;
                if (Math.abs(world.walkHeight(x, z, point.y) - point.y) > .05 ||
                  world.isDeepWater?.(x, z) ||
                  circleBlocked(x, z, .5, movementObstacles(x, z), point.y)) { clear = false; break; }
              }
              if (clear && hasLine(new THREE.Vector3(point.x, point.y + 1.6, point.z),
                new THREE.Vector3(candidate.x, candidate.y + 1, candidate.z), 75, tank.id)) {
                start = point; target = candidate;
              }
            }
            if (start) break;
          }
          if (!start) throw new Error('No clear long-range approach fixture');
          tank.position.set(target.x, target.y, target.z);
          tank.health = 100000;
          vehicleRenderer.update(entities.vehicles.values(), time);
          actor.position.set(start.x, start.y, start.z);
          actor.heading = Math.atan2(start.x - tank.position.x, start.z - tank.position.z);
          actor.target = null; actor.tactics.lastSeen = null; actor.tactics.packApproach = null;
          actor.tactics.throwDecisionAt = actor.nextThink = 0;
          actor.path = actor.pathGoal = null; pathRequests.delete(actor.tactics.id);
          stopLocomotion(actor.locomotion);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: start.x, z: start.z };
          actorGrid.rebuild(allForces);
          return { start, distance: actor.position.distanceTo(tank.position) };
        },
        farApproachResult() {
          const actor = this.squad[0];
          return { distance: actor.position.distanceTo(this.tank.position),
            position: actor.position.toArray(), mode: actor.tactics.mode,
            order: actor.orderTarget, health: actor.health, packs: actor.grenades.packs };
        },
        resetSquadPositions() {
          this.tank.position.copy(this.originalTankPosition);
          this.tank.health = this.originalTankHealth;
          vehicleRenderer.update(entities.vehicles.values(), time);
          this.squad.forEach((actor, index) => {
            const point = this.points[index + 1];
            actor.position.set(point.x, 0, point.z);
            actor.heading = 0; actor.stance = 'standing'; actor.firingPose = null;
            actor.path = actor.pathGoal = null; pathRequests.delete(actor.tactics.id);
            actor.tactics.packApproach = null; actor.tactics.throwDecisionAt = 0;
            stopLocomotion(actor.locomotion);
            if (actor.nativeMotion) actor.nativeMotion.position = { x: point.x, z: point.z };
          });
          actorGrid.rebuild(allForces);
        },
        destroyTank() {
          this.tank.health = 0;
        },
        sight() {
          updateCamera(0); camera.getWorldDirection(direction);
          const end = camera.position.clone().addScaledVector(direction, 65);
          ray.set(camera.position, direction); ray.far = 65;
          const people = actorGrid.near(camera.position.x, camera.position.z, 65).filter(actor =>
            actor !== controlledSoldier(entities) && actor.health > 0 && !actor.vehicleId &&
            pointSegmentDistance(actor.position, camera.position, end).distance < 2)
            .map(actor => soldierHits.sync(actor, time));
          const hits = ray.intersectObjects([...solidIndex.candidates(camera.position, direction, 65),
            ...vehicleSolids(), ...people], true).slice(0, 4)
            .map(hit => ({ distance: hit.distance, name: hit.object.name,
              vehicle: hit.object.userData.vehicleId, person: hit.object.userData.actor?.id }));
          ray.far = Infinity;
          return { hits, camera: camera.position.toArray(), tank: this.tank.position.toArray(), direction: direction.toArray() };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  if (process.env.CAMPAIGN) url.searchParams.set('campaign', process.env.CAMPAIGN);
  else url.searchParams.set('benchmark', 'duel');
  url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href);
  if (!process.env.CAMPAIGN) await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 600000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const initial = await page.evaluate(() => focusReview.setup());
  if (process.env.FOCUS_ASSEMBLY_REVIEW === '1')
    console.log(JSON.stringify({ assembly: await page.evaluate(() => focusReview.startAssembly()) }));
  const ordered = await page.evaluate(() => focusReview.press());
  assert.ok(ordered.every(order => order?.kind === 'person' && order.id === initial.enemy), JSON.stringify(ordered));
  const result = await page.evaluate(() => focusReview.step(8));
  assert.ok(result.squad.every(actor => actor.target === initial.enemy), JSON.stringify(result));
  assert.ok(result.squad.every((actor, index) => actor.ammo < initial.squad[index].ammo), JSON.stringify(result));
  assert.ok(result.shots > 0, JSON.stringify(result));
  const cancelled = await page.evaluate(() => focusReview.cancel());
  assert.ok(cancelled.every(actor => actor.order === 'follow' && actor.target === null), JSON.stringify(cancelled));
  if (process.env.FOCUS_ASSEMBLY_REVIEW === '1') {
    const resumed = await page.evaluate(() => focusReview.step(1));
    assert.ok(resumed.squad.every(actor => actor.mode === 'sihang-assembly'), JSON.stringify(resumed));
    const stock = await page.evaluate(() => focusReview.rifleStock([{ ammo: 0, reserve: 0 }, { ammo: 0, reserve: 0 }]));
    const emptyOrder = await page.evaluate(() => focusReview.press());
    assert.ok(emptyOrder.every(order => order?.id === initial.enemy), JSON.stringify(emptyOrder));
    const emptyRifles = await page.evaluate(() => focusReview.step(1));
    assert.ok(emptyRifles.squad.every(actor => actor.mode === 'sihang-assembly' && actor.order?.id === initial.enemy),
      JSON.stringify(emptyRifles));
    await page.evaluate(values => focusReview.rifleStock(values), stock);
    await page.evaluate(() => focusReview.cancel());
  }
  await page.evaluate(() => focusReview.blockSquadSight());
  const memberOrder = await page.evaluate(() => focusReview.press());
  assert.ok(memberOrder.every(order => order?.id === initial.enemy), JSON.stringify(memberOrder));
  const memberSight = await page.evaluate(() => focusReview.observeSquadSight(5));
  assert.ok(memberSight.blocked > 5 && memberSight.blockedShots === 0 && memberSight.otherShots > 0,
    JSON.stringify(memberSight));
  if (process.env.FOCUS_ASSEMBLY_REVIEW === '1')
    assert.ok(memberSight.blockedAssembly > 5, JSON.stringify(memberSight));
  await page.evaluate(() => focusReview.removeWall());
  await page.evaluate(() => focusReview.cancel());
  await page.evaluate(() => focusReview.blockPlayerSight());
  const blocked = await page.evaluate(() => focusReview.press());
  assert.ok(blocked.every(order => !order), JSON.stringify(blocked));
  await page.evaluate(() => focusReview.removeWall());
  const tank = await page.evaluate(() => focusReview.tank());
  const sight = await page.evaluate(() => focusReview.sight());
  const armorOrder = await page.evaluate(() => focusReview.press());
  assert.ok(armorOrder.every(order => order?.kind === 'armor' && order.id === tank.id), JSON.stringify({ armorOrder, sight }));
  await page.evaluate(() => focusReview.stock([0, 0]));
  await page.evaluate(() => focusReview.step(3));
  const empty = await page.evaluate(() => focusReview.tankResult());
  assert.deepEqual(empty.packs, [0, 0]);
  assert.ok(empty.actions.every(action => action !== 'explosive-pack') &&
    empty.active.every(item => item.kind !== 'explosive-pack'), JSON.stringify(empty));
  if (process.env.FOCUS_ASSEMBLY_REVIEW === '1')
    assert.ok(empty.squad.every(actor => actor.mode === 'sihang-assembly' && actor.order?.id === tank.id),
      JSON.stringify(empty));
  const approach = await page.evaluate(() => focusReview.startFarApproach());
  await page.evaluate(() => focusReview.stock([1, 0]));
  await page.evaluate(() => focusReview.step(3));
  const approached = await page.evaluate(() => focusReview.farApproachResult());
  assert.ok(approached.health > 0 && approached.packs === 1 &&
    approached.order?.id === tank.id && approached.distance < approach.distance - 1,
  JSON.stringify({ approach, approached }));
  await page.evaluate(() => focusReview.step(12));
  const approachThrow = await page.evaluate(() => focusReview.farApproachResult());
  assert.ok(approachThrow.health > 0 && approachThrow.packs === 0 &&
    approachThrow.order?.id === tank.id, JSON.stringify({ approach, approached, approachThrow }));
  await page.evaluate(() => focusReview.resetSquadPositions());
  await page.evaluate(packs => focusReview.stock(packs), tank.packs);
  await page.evaluate(() => focusReview.step(8));
  const armorResult = await page.evaluate(() => focusReview.tankResult());
  assert.ok(armorResult.packs.some((packs, index) => packs < tank.packs[index]), JSON.stringify(armorResult));
  await page.evaluate(() => focusReview.destroyTank());
  const afterDestruction = await page.evaluate(() => focusReview.step(5));
  assert.ok(afterDestruction.squad.every(actor => actor.health <= 0 || !actor.registered || actor.order === null),
    JSON.stringify(afterDestruction));
  if (process.env.FOCUS_ASSEMBLY_REVIEW === '1') {
    const protectedSquad = await page.evaluate(() => focusReview.southBankFocus());
    assert.ok(protectedSquad.every(Boolean), JSON.stringify(protectedSquad));
    const protectedResult = await page.evaluate(() => focusReview.step(1));
    assert.equal(protectedResult.shots, afterDestruction.shots, JSON.stringify(protectedResult));
    assert.ok(protectedResult.squad.every(actor => actor.mode === 'sihang-assembly'), JSON.stringify(protectedResult));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: squad focus, rifle fire, blocked selection, cancellation, long-range approach, tank pack use and empty stock.');
} finally {
  await browser.close();
}
