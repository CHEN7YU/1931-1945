import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.regroupDefenseReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          if (sihangCampaign.stage !== 'sihang-retreat' || sihangCampaign.counterattack)
            throw new Error('Could not enter the real regroup phase');
          const player = controlledSoldier(entities);
          const enemy = enemies.find(actor => !actor.vehicleId && !actor.formation.sihangDemolition &&
            actor.hasFirearm !== false && !actor.discharger);
          this.fixtureTank = [...entities.vehicles.values()].find(vehicle => vehicle.team === 'enemy' && vehicle.type === 'tank');
          this.tankHealth = this.fixtureTank.health;
          const tankCrew = new Set(this.fixtureTank.seats.map(seat => seat.occupantId));
          for (const actor of allForces) if (actor !== player && actor !== enemy && !tankCrew.has(actor.id)) actor.health = 0;
          for (const vehicle of entities.vehicles.values()) vehicle.health = 0;
          for (const formation of formations) formation.respawnEnabled = false;
          player.health = 100000; enemy.health = 100000;
          let found = null, post = null;
          for (const candidate of sihangEnemyPosts) {
            if ([...emplacements.values()].some(point => Math.hypot(point.x - candidate.x, point.z - candidate.z) < 10)) continue;
            for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
              const x = candidate.x + Math.sin(angle) * 14, z = candidate.z + Math.cos(angle) * 14;
              const from = new THREE.Vector3(candidate.x, 1.4, candidate.z), to = new THREE.Vector3(x, 1.4, z);
              if (sihangSouthBank({ x, z }) || Math.abs(world.walkHeight(x, z, 0)) > .1 ||
                circleBlocked(x, z, .6, movementObstacles(x, z), 0) || !hasLine(from, to, 75)) continue;
              found = { x, z }; post = candidate; break;
            }
            if (found) break;
          }
          if (!found) throw new Error('No clear target position by regroup post');
          sihangEnemyPosts[enemy.formation.index * SIHANG_RULES.squadMembers + enemy.index] = post;
          enemy.position.set(post.x, 0, post.z);
          player.position.set(found.x, 0, found.z);
          enemy.heading = Math.atan2(post.x - found.x, post.z - found.z);
          enemy.nextThink = 0; enemy.nextFire = 0;
          this.enemy = enemy; this.player = player;
          this.post = { x: post.x, z: post.z };
          this.target = found;
          return { stage: sihangCampaign.stage, post: this.post, target: found };
        },
        step(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          const a = this.enemy;
          return { stage: sihangCampaign.stage, counterattack: sihangCampaign.counterattack,
            position: a.position.toArray(), mode: a.tactics.mode, target: a.target?.id ?? null,
            lastShot: a.tactics.lastShot ?? null, shots: a.rifle.shots, health: this.player.health };
        },
        south() {
          const x = this.post.x;
          this.player.position.set(x, 0, sihangRiverBounds(x).southZ + 3);
          this.enemy.target = null; this.enemy.tactics.lastSeen = null; this.enemy.nextThink = 0;
        },
        displaceFromPost() {
          for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
            const x = this.post.x + dx, z = this.post.z + dz;
            if (Math.abs(world.walkHeight(x, z, 0)) > .1 ||
              [0.5, 1].some(t => {
                const px = this.post.x + dx * t, pz = this.post.z + dz * t;
                return circleBlocked(px, pz, .6, movementObstacles(px, pz), 0);
              })) continue;
            this.enemy.position.set(x, 0, z);
            this.enemy.path = this.enemy.pathGoal = null;
            return { x, z };
          }
          throw new Error('No clear displacement near regroup post');
        },
        fixed() {
          const heading = Math.atan2(this.post.x - this.target.x, this.post.z - this.target.z);
          const spec = { id: 'review-regroup-mg', profile: 'maxim24', x: this.post.x, z: this.post.z,
            altitude: 0, heading, team: 'enemy', engineerBuilt: true, builderTeam: 'enemy' };
          const point = createEmplacement(spec);
          point.view = createEmplacementModel(point); scene.add(point.view);
          registerWeapon(entities, point.weapon, point.id + ':weapon', point.id, point.weapon.type);
          emplacements.set(point.id, point);
          const pose = emplacementPose(point, 0);
          this.enemy.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          this.enemy.path = this.enemy.pathGoal = null;
          this.player.position.set(this.target.x, 0, this.target.z);
          this.point = point;
        },
        fixedSnapshot() {
          const point = this.point, floor = point.altitude ?? 0, target = targetAimPoint(this.player);
          const eye = new THREE.Vector3(point.x, floor + point.weapon.settings.muzzleHeight + .8, point.z);
          const pose = emplacementPose(point, floor);
          const muzzle = new THREE.Vector3(pose.muzzle.x, pose.muzzle.y, pose.muzzle.z);
          const travel = new THREE.Vector3(target.x, target.y, target.z).sub(muzzle), distance = travel.length();
          ray.set(muzzle, travel.normalize()); ray.far = distance;
          const blocker = ray.intersectObjects([...solidIndex.candidates(muzzle, travel, distance)
            .filter(object => object.userData.emplacementId !== point.id || object.userData.emplacementCover),
            ...vehicleSolids()], true)[0];
          ray.far = Infinity;
          return { shots: this.point.shots, operator: this.point.operatorId,
            enemy: this.enemy.id, position: this.enemy.position.toArray(), target: this.player.position.toArray(),
            yaw: point.yaw, pitch: point.pitch, canAim: emplacementCanAimAt(point, target, floor),
            visible: hasLine(eye, target, point.weapon.settings.range),
            night: sihangNightVisibility(sihangCampaign, eye, this.player.position),
            blocker: blocker && { distance: blocker.distance, name: blocker.object.name,
              data: blocker.object.userData }, health: this.player.health, mode: this.enemy.tactics.mode };
        },
        tank() {
          this.enemy.health = 0;
          const tank = this.fixtureTank;
          tank.health = this.tankHealth;
          for (const seat of tank.seats) {
            const crew = entities.soldiers.get(seat.occupantId);
            if (crew) crew.health = 100000;
          }
          const from = tank.position.clone().add(new THREE.Vector3(0, 1.8, 0));
          let found = null;
          for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const x = tank.position.x + Math.sin(angle) * 20, z = tank.position.z + Math.cos(angle) * 20;
            const to = new THREE.Vector3(x, 1, z);
            if (sihangSouthBank({ x, z }) || Math.abs(world.walkHeight(x, z, 0)) > .1 ||
              circleBlocked(x, z, .6, movementObstacles(x, z), 0) ||
              !sihangNightVisibility(sihangCampaign, from, to) || !hasLine(from, to, CHI_HA.range + 5, tank.id)) continue;
            found = { x, z }; break;
          }
          if (!found) throw new Error('No visible tank target');
          this.player.position.set(found.x, 0, found.z);
          tank.ai = null;
          this.tank = tank;
          return { position: tank.position.toArray(), target: found };
        },
        async tankSnapshot() {
          const { chiHaMuzzle } = await import('/src/chi-ha.js');
          const muzzle = chiHaMuzzle(this.tank);
          const from = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
          const target = targetAimPoint(this.player);
          return { position: this.tank.position.toArray(), shots: this.tank.ai?.shots ?? 0,
            mode: this.tank.ai?.mode, target: this.tank.ai?.targetId,
            player: this.player.position.toArray(), playerHealth: this.player.health,
            valid: sihangEnemyTargetAllowed(this.player), night: sihangNightVisibility(sihangCampaign, from, target),
            visible: hasLine(from, target, CHI_HA.range + 5, this.tank.id),
            crew: this.tank.seats.map(seat => ({ id: seat.occupantId, health: entities.soldiers.get(seat.occupantId)?.health })),
            registered: friendlyForces.includes(this.player),
            stage: sihangCampaign.stage, counterattack: sihangCampaign.counterattack };
        },
        wall(on) {
          if (on) {
            const midX = (this.post.x + this.target.x) / 2, midZ = (this.post.z + this.target.z) / 2;
            const vertical = Math.abs(this.post.x - this.target.x) < 1;
            this.wallMesh = new THREE.Mesh(new THREE.BoxGeometry(vertical ? 6 : .5, 5, vertical ? .5 : 6),
              new THREE.MeshBasicMaterial());
            this.wallMesh.position.set(midX, 2.5, midZ);
            scene.add(this.wallMesh); this.wallMesh.updateMatrixWorld(true);
            world.solids.push(this.wallMesh);
          } else {
            world.solids.splice(world.solids.indexOf(this.wallMesh), 1);
            scene.remove(this.wallMesh);
            this.wallMesh.geometry.dispose(); this.wallMesh.material.dispose();
          }
          solidIndex.synchronize(world.solids);
          this.player.position.set(this.target.x, 0, this.target.z);
          this.enemy.target = null; this.enemy.tactics.lastSeen = null; this.enemy.nextThink = 0;
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  if (process.env.REVIEW_NATIVE !== '1') url.searchParams.set('character', 'procedural');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const setup = await page.evaluate(() => regroupDefenseReview.setup());
  const visible = await page.evaluate(() => regroupDefenseReview.step(12));
  assert.ok(visible.lastShot, JSON.stringify({ setup, visible }));
  assert.equal(visible.counterattack, false);
  assert.ok(Math.hypot(visible.position[0] - setup.post.x, visible.position[2] - setup.post.z) < .7);
  await page.evaluate(() => regroupDefenseReview.wall(true));
  const displaced = await page.evaluate(() => regroupDefenseReview.displaceFromPost());
  const blocked = await page.evaluate(() => regroupDefenseReview.step(12));
  assert.equal(blocked.shots, visible.shots, JSON.stringify({ setup, visible, blocked }));
  assert.equal(blocked.mode, 'sihang-regroup', JSON.stringify({ displaced, blocked }));
  assert.ok(Math.hypot(blocked.position[0] - setup.post.x, blocked.position[2] - setup.post.z) <= .7,
    JSON.stringify({ setup, displaced, blocked }));
  await page.evaluate(() => regroupDefenseReview.wall(false));
  await page.evaluate(() => regroupDefenseReview.south());
  const south = await page.evaluate(() => regroupDefenseReview.step(5));
  assert.equal(south.shots, blocked.shots, JSON.stringify({ setup, blocked, south }));
  await page.evaluate(() => regroupDefenseReview.fixed());
  await page.evaluate(() => regroupDefenseReview.step(10));
  const fixed = await page.evaluate(() => regroupDefenseReview.fixedSnapshot());
  assert.equal(fixed.operator, fixed.enemy, JSON.stringify(fixed));
  assert.ok(fixed.shots > 0, JSON.stringify(fixed));
  await page.evaluate(() => regroupDefenseReview.south());
  await page.evaluate(() => regroupDefenseReview.step(3));
  const fixedSouth = await page.evaluate(() => regroupDefenseReview.fixedSnapshot());
  assert.equal(fixedSouth.shots, fixed.shots, JSON.stringify({ fixed, fixedSouth }));
  const tankSetup = await page.evaluate(() => regroupDefenseReview.tank());
  await page.evaluate(() => regroupDefenseReview.step(15));
  const tank = await page.evaluate(() => regroupDefenseReview.tankSnapshot());
  assert.ok(tank.shots > 0, JSON.stringify({ tankSetup, tank }));
  assert.ok(Math.hypot(tank.position[0] - tankSetup.position[0], tank.position[2] - tankSetup.position[2]) < .2,
    JSON.stringify({ tankSetup, tank }));
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'regroup-defense.json'), JSON.stringify({
    fixture: `Real Sihang stage transition and battle steps; ${process.env.REVIEW_NATIVE === '1' ? 'native' : 'procedural'} actors placed at an existing regroup post, other combatants disabled, temporary wall and registered fixed gun.`,
    setup, visible, displaced, blocked, south, fixed, fixedSouth, tankSetup, tank, errors,
  }, null, 2));
  console.log(JSON.stringify({ setup, visible, blocked, south, fixed, fixedSouth, tankSetup, tank }));
} finally {
  await browser.close();
}
