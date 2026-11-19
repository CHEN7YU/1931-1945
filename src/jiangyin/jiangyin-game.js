// 江阴要塞阻击战 · 战斗模拟（与 DOM 解耦：输入通过 step(dt, input) 传入，可在 node 中无渲染运行）
import * as THREE from 'three';
import { createEmplacement, emplacementLook, emplacementPose, aimEmplacement, emplacementCanAimAt,
  fireEmplacement, advanceEmplacement, damageEmplacement, emplacementCooldown } from '../emplacements.js';
import { JIANGYIN_RULES, JIANGYIN_WAVES, JIANGYIN_POSTS, JIANGYIN_PROFILE_OVERRIDES, JIANGYIN_MOUNTS, ENEMY_TYPES,
  postFacing, groundHeight, insideWreck, RIVER_HALF, shipRoute, landingPoint, createJiangyinState, dueWaves, dueNavalWaves,
  evaluateOutcome, nextPostId, LAND_SPAWNS, AIR_SPAWN, riverCenter, BLOCKSHIPS, blockshipZone, NAVAL_WAVES } from './jiangyin-rules.js';
// 复用项目现有的九七式中战车规则（车体尺寸、炮口/机枪位姿、射程与装填）
import { CHI_HA, CHI_HA_MG, chiHaMuzzle, chiHaMachineGunPose } from '../chi-ha.js';
import { createWarshipModel, createLandingCraftModel, createInfantryModel,
  createCruiserModel, createBlockshipModel } from './jiangyin-models.js';
import { createJiangyinWorld } from './jiangyin-world.js';
import { TYPES } from '../core.js';
import { advanceAircraftAI, AIRCRAFT_GUN } from '../aircraft-ai.js';
import { AIR_BOMB, createAirBombs, createEnemyAirFlight } from '../air-support.js';

const GRAVITY = 9.81;
const SHELL_SPEED = 260;          // 我方 75mm 炮弹初速（玩法值）
const ENEMY_SHELL_SPEED = 330;    // 敌舰炮弹水平速度（玩法值）
const LOOK_SENSITIVITY = .0021;
const TAU = Math.PI * 2;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const forward = heading => ({ x: -Math.sin(heading), z: -Math.cos(heading) });

// createSoldierModel(team, weapon)：浏览器中传入项目 world.js 的 soldierModel；node 模拟时用内置简模。
// effects：可选，浏览器中传入包装后的 combat-effects（explosion/muzzle），node 中省略。
export function createJiangyinGame({ scene, camera, createGunModel, createSoldierModel = null, effects = null,
  random = Math.random, onEvent = () => {}, quality = 'high' }) {
  if (typeof createGunModel !== 'function') throw new TypeError('createGunModel is required');
  const world = createJiangyinWorld(scene, { quality });
  const surfaceHeight = world.surfaceHeight;
  const state = createJiangyinState();
  const emit = event => { try { onEvent(event); } catch (error) { console.error(error); } };
  let now = 0, serial = 0;
  const gauss = () => (random() + random() + random() - 1.5) / 1.5;

  // ---------- 我方火力点 ----------
  const posts = JIANGYIN_POSTS.map(spec => {
    const point = createEmplacement({ id: spec.id, profile: spec.profile, x: spec.x, z: spec.z, heading: postFacing(spec) });
    const override = { ...(JIANGYIN_PROFILE_OVERRIDES[spec.profile] ?? {}), ...(JIANGYIN_MOUNTS[spec.mount] ?? {}) };
    point.weapon.settings = Object.freeze({ ...point.weapon.settings, ...override });
    if (Number.isFinite(override.reserve)) point.weapon.reserve = override.reserve;
    if (spec.health) point.health = point.maxHealth = spec.health;
    point.operatorId = 'crew';
    // 我舰：舰体用 createCruiserModel（去掉艏炮塔），艏主炮塔由 createGunModel 生成并可由玩家操作
    const hull = spec.kind === 'ship' ? createCruiserModel(spec.name.replace('舰', ''), { length: spec.length, beam: spec.beam, omitBowTurret: true }) : null;
    const floor = hull ? hull.userData.bow.deck : groundHeight(spec.x, spec.z);
    point.altitude = floor;
    const model = createGunModel(point);
    model.position.y = floor; scene.add(model);
    const post = { id: spec.id, name: spec.name, key: spec.key, kind: spec.kind, bank: spec.bank, point, model, floor,
      aiNextShot: 2 + random() * 4, burstUntil: 0, pauseUntil: 0, destroyedAt: null, smokeAt: 0, boat: null };
    if (hull) {
      scene.add(hull);
      post.boat = { x: spec.x, z: spec.z, heading: spec.heading, speed: 0, hull, sinking: 0, sunk: false, deck: floor,
        gunOffset: -hull.userData.bow.z, cfg: { length: spec.length, beam: spec.beam, height: 11 }, waypoint: null, retarget: 0,
        roll: random() > .5 ? 1 : -1 };
      syncBoatGun(post);
    }
    return post;
  });
  const postById = id => posts.find(post => post.id === id);
  const alive = post => post.point.health > 0;
  for (const post of posts) Object.defineProperty(post, 'health', { get: () => post.point.health });

  // 本关自定义炮位（岸防炮塔/艇首炮）按 settings 计算耳轴与炮口；其余沿用 emplacements.js
  function postPose(post) {
    const { point } = post, s = point.weapon.settings;
    if (s.mount !== 'coastal' && s.mount !== 'deck' && s.mount !== 'shipTurret') return emplacementPose(point, post.floor);
    const cp = Math.cos(point.pitch), sp = Math.sin(point.pitch), fx = -Math.sin(point.yaw), fz = -Math.cos(point.yaw);
    const length = s.barrel - (point.recoil ?? 0) * 1.4;
    const trunnion = { x: point.x, y: post.floor + s.muzzleHeight, z: point.z };
    return { trunnion, eye: { ...trunnion }, muzzle: { x: trunnion.x + fx * cp * length, y: trunnion.y + sp * length, z: trunnion.z + fz * cp * length } };
  }
  const shellSpeedOf = point => point.weapon.settings.shellSpeed ?? SHELL_SPEED;

  function syncBoatGun(post) {
    const { boat, point } = post, f = forward(boat.heading);
    const delta = boat.heading - point.heading;
    point.heading = boat.heading;
    emplacementLook(point, point.yaw + delta, point.pitch);
    point.x = boat.x + f.x * boat.gunOffset; point.z = boat.z + f.z * boat.gunOffset;
    // 下沉：先横倾、艏部下沉，最终整舰没入江中（完全沉没）
    const k = boat.sinking, depth = k * k * (boat.cfg.height + 8);
    boat.hull.position.set(boat.x, -.2 - depth, boat.z);
    boat.hull.rotation.set(-k * .1, boat.heading, boat.roll * Math.min(.45, k * .9), 'YXZ');
    post.floor = boat.deck - depth - k * 2;
    post.model.visible = k < .55;
    const wake = boat.hull.userData.wake;
    if (wake) for (const mesh of wake) mesh.visible = Math.abs(boat.speed) > .8 && k === 0;
  }
  const shipPosts = () => posts.filter(post => post.kind === 'ship');
  const shorePosts = () => posts.filter(post => post.kind === 'battery');
  // 可复生/接管的阵位：第一阶段只能上我舰，第二阶段只能上两岸阵地
  const eligiblePosts = () => state.phase === 'naval' || state.phase === 'intro' ? shipPosts() : shorePosts();
  const targetPosition = post => post.boat ? { x: post.boat.x, y: 3, z: post.boat.z } : { x: post.point.x, y: post.floor, z: post.point.z };

  // ---------- 敌军 ----------
  const ships = [], landings = [], troops = [], shells = [];
  // 坦克与飞机按项目 vehicle-renderer.js 需要的记录格式保存，由页面层交给 createVehicleRenderer 渲染
  const vehicles = [], bombs = createAirBombs(scene);
  const makeSoldier = (team, weapon) => createSoldierModel ? createSoldierModel(team, weapon) : createInfantryModel();
  const shipSerial = {};
  function spawnShip(type) {
    const cfg = ENEMY_TYPES[type], lane = [-320, 0, 320][Math.floor(random() * 3)] + (random() - .5) * 80;
    const route = shipRoute(lane), model = createWarshipModel(type);
    // 实舰尺度下同批入场的舰艇按舰长错开，避免在弯道后方重叠
    const startX = Math.max(route[0].x + random() * 20, ...ships.filter(other => other.sinking === null && other.x > route[0].x - 600)
      .map(other => other.x + (other.cfg.length + cfg.length) / 2 + 18));
    const ship = { id: `ship-${++serial}`, type, cfg, x: startX, z: route[0].z, heading: Math.PI / 2, lane,
      health: cfg.health, route, wp: 1, model, nextFire: now + 4 + random() * 3, sinking: null, speed: cfg.speed };
    assignHold(ship);
    const roster = cfg.ships ?? [], index = (shipSerial[type] = (shipSerial[type] ?? -1) + 1);
    ship.label = roster.length ? `${cfg.name}「${roster[index % roster.length]}」` : cfg.name;
    scene.add(model); ships.push(ship); syncShip(ship);
    emit({ type: 'toast', text: `${ship.label}自下游驶出弯道，逆流而上` });
  }
  // 第一阶段拖得越久，日舰火力越集中（每多 1 分钟伤害 +100%），保证江面决战在约 3–5 分钟内分出结果
  const navalPressure = () => state.phase === 'naval' ? 1 + Math.max(0, state.navalTime - JIANGYIN_RULES.navalReinforceAfter) / 60 : 1;
  // 敌舰停泊炮击位置：第一阶段停在阻塞船锚地下游与我舰对射；封江后逼近阻塞线下游侧炮击两岸阵地
  function assignHold(ship) {
    ship.holdX = state.phase === 'naval' || state.phase === 'intro' ? 950 + random() * 300 : 220 + random() * 330;
    ship.holdZ = Math.max(-420, Math.min(420, ship.lane ?? 0));
  }
  function spawnLanding(bank) {
    const target = landingPoint(bank, random), model = createLandingCraftModel();
    const x0 = JIANGYIN_RULES.spawnX - 20 + random() * 30;
    // 先沿江道驶出弯道（途经点），再斜插向本岸滩头
    const via = [{ x: 1300, z: riverCenter(1300) + (random() - .5) * 300 }, { x: 900, z: (bank === 'south' ? 1 : -1) * (150 + random() * 250) }];
    const craft = { id: `landing-${++serial}`, bank, x: x0, z: riverCenter(x0) + (random() - .5) * 300, via,
      heading: Math.PI / 2, health: ENEMY_TYPES.landing.health, target, state: 'approach', unloadAt: 0, model, sinking: null };
    scene.add(model); landings.push(craft); syncShip(craft);
  }
  function syncShip(vessel) {
    const sinking = vessel.sinking === null ? 0 : now - vessel.sinking;
    vessel.model.position.set(vessel.x, -Math.min(6, sinking * .65) + Math.sin(now * 1.4 + vessel.x) * .08, vessel.z);
    vessel.model.rotation.set(Math.min(.25, sinking * .03), vessel.heading, Math.min(.6, sinking * .07));
  }
  function spawnTroops(craft) {
    const cfg = ENEMY_TYPES.infantry, sign = craft.bank === 'south' ? 1 : -1;
    for (let i = 0; i < ENEMY_TYPES.landing.troops; i++) {
      const model = makeSoldier('enemy', i === 0 ? 'type11' : 'rifle'), x = craft.x + (i - 2) * 1.6, z = sign * (73 + random() * 2);
      const soldier = { id: `troop-${++serial}`, bank: craft.bank, x, z, health: cfg.health, model, nextAttack: 0,
        offset: (i - 2) * 1.8, dead: null };
      model.position.set(x, groundHeight(x, z), z); scene.add(model); troops.push(soldier);
    }
    emit({ type: 'toast', text: craft.bank === 'south' ? '日军在南岸滩头登陆！' : '日军在北岸滩头登陆！' });
  }

  // ---------- 陆路步兵小队 / 坦克小队 / 航空小队（敌军自下游两岸与空中出发） ----------
  function spawnSquad(bank) {
    const spawn = LAND_SPAWNS[bank], cfg = ENEMY_TYPES.infantry;
    for (let i = 0; i < ENEMY_TYPES.squad.size; i++) {
      const x = spawn.x + (i % 4) * 2.2 + random(), z = spawn.z + Math.floor(i / 4) * 2.4 + random();
      const model = makeSoldier('enemy', i === 0 ? 'type11' : 'rifle');
      model.position.set(x, groundHeight(x, z), z); scene.add(model);
      troops.push({ id: `troop-${++serial}`, bank, x, z, health: cfg.health, model, nextAttack: 0,
        offset: (i - 3.5) * 1.6, dead: null, walk: random() * 6, land: true });
    }
    emit({ type: 'toast', text: `${ENEMY_TYPES.squad.name}自${bank === 'south' ? '南' : '北'}岸下游陆路来袭`, alert: true });
  }
  function spawnTankPlatoon(bank) {
    const spawn = LAND_SPAWNS[bank];
    for (let i = 0; i < ENEMY_TYPES.tank.platoon; i++) {
      const x = spawn.x + i * 9, z = spawn.z + (i - 1) * 6;
      vehicles.push({ id: `tank-${++serial}`, type: 'tank', variant: CHI_HA.id, team: 'enemy', bank,
        position: new THREE.Vector3(x, groundHeight(x, z), z), heading: Math.PI / 2, pitch: 0, roll: 0,
        turretYaw: Math.PI / 2, turretPitch: 0, trackDistance: 0, health: CHI_HA.health, maxHealth: CHI_HA.health,
        machineGuns: [{ mount: 'hull', yaw: 0, pitch: 0 }, { mount: 'rear', yaw: 0, pitch: 0 }],
        nextShot: now + 3 + random() * 2, nextBurst: now + 2, destroyedAt: null });
    }
    emit({ type: 'toast', text: `日军坦克小队（${ENEMY_TYPES.tank.platoon}辆九七式中战车）沿${bank === 'south' ? '南' : '北'}岸逼近`, alert: true });
  }
  function spawnAirFlight() {
    const entry = nearestPost(AIR_SPAWN.x, AIR_SPAWN.z);
    if (!entry) return;
    for (let i = 0; i < ENEMY_TYPES.aircraft.flight; i++) {
      const position = new THREE.Vector3(AIR_SPAWN.x + i * 26, AIR_SPAWN.y + i * 6, AIR_SPAWN.z + (i - 1) * 22);
      vehicles.push({ id: `plane-${++serial}`, type: 'plane', variant: null, team: 'enemy', position,
        velocity: new THREE.Vector3(-TYPES.plane.speed, 0, 0), heading: Math.PI / 2, pitch: 0, roll: 0,
        turretYaw: 0, turretPitch: 0, health: ENEMY_TYPES.aircraft.health, maxHealth: ENEMY_TYPES.aircraft.health,
        aiFlight: createEnemyAirFlight(now, i), patrolPostId: entry.id,
        weapon: { type: 'plane', ammo: TYPES.plane.magazine, nextShot: 0, reloadUntil: 0 },
        fall: null, destroyedAt: null });
    }
    emit({ type: 'toast', text: `日军航空小队（${ENEMY_TYPES.aircraft.flight}架）来袭！`, alert: true });
  }
  const liveTanks = () => vehicles.filter(v => v.type === 'tank' && v.health > 0);
  const livePlanes = () => vehicles.filter(v => v.type === 'plane' && v.health > 0);
  function damageVehicle(vehicle, amount, byPlayer) {
    if (vehicle.health <= 0 || amount <= 0) return;
    vehicle.health -= amount;
    if (vehicle.health > 0) return;
    vehicle.health = 0; vehicle.destroyedAt = now;
    if (vehicle.type === 'tank') {
      state.stats.tanksDestroyed++;
      explosion({ x: vehicle.position.x, y: vehicle.position.y + 1.5, z: vehicle.position.z }, 2);
      emit({ type: 'toast', text: `九七式中战车被击毁${byPlayer ? '（玩家）' : ''}` });
    } else {
      state.stats.planesDowned++;
      vehicle.fall = { grounded: false, sunk: false, spin: (random() - .5) * 2 };
      if (effects) effects.explosion(vehicle.position, 6, 'aircraft-hit');
      emit({ type: 'toast', text: `${ENEMY_TYPES.aircraft.name}被击落${byPlayer ? '（玩家）' : ''}` });
    }
  }
  const nearestPost = (x, z, bank = null) => posts.filter(post => alive(post) && (bank === null || post.bank === bank))
    .sort((a, b) => Math.hypot(a.point.x - x, a.point.z - z) - Math.hypot(b.point.x - x, b.point.z - z))[0] ?? null;

  // 坦克：沿本岸台地开向最近的我方阵位，进入 CHI_HA.range 后停车，用 57 毫米炮与车载机枪射击
  function advanceTank(tank, dt) {
    if (tank.health <= 0) return now - tank.destroyedAt < 60;
    const target = nearestPost(tank.position.x, tank.position.z, tank.bank);
    if (!target) return true;
    const dx = target.point.x - tank.position.x, dz = target.point.z - tank.position.z, distance = Math.hypot(dx, dz);
    const desired = Math.atan2(-dx, -dz);
    const standoff = CHI_HA.range * .8;
    if (distance > standoff) {
      tank.heading = wrap(tank.heading + Math.max(-CHI_HA.turnRate * dt, Math.min(CHI_HA.turnRate * dt, wrap(desired - tank.heading))));
      const f = forward(tank.heading), step = CHI_HA.speed * dt;
      const nx = tank.position.x + f.x * step, nz = tank.position.z + f.z * step;
      const climb = Math.abs(groundHeight(nx, nz) - groundHeight(tank.position.x, tank.position.z)) / Math.max(step, 1e-6);
      if (groundHeight(nx, nz) > 1.5 && climb < .9) {
        tank.position.x = nx; tank.position.z = nz; tank.trackDistance += step;
      } else tank.heading = wrap(tank.heading + dt * .8);              // 遇到陡坡或江水时转向绕行
    }
    tank.position.y = groundHeight(tank.position.x, tank.position.z);
    // 炮塔转向与俯仰
    tank.turretYaw = wrap(tank.turretYaw + Math.max(-CHI_HA.turretRate * dt, Math.min(CHI_HA.turretRate * dt, wrap(desired - tank.turretYaw))));
    const rise = target.floor + 1 - (tank.position.y + CHI_HA.turret.y);
    tank.turretPitch = Math.max(-.15, Math.min(.35, Math.atan2(rise, distance)));
    const aligned = Math.abs(wrap(desired - tank.turretYaw)) < .06;
    if (aligned && distance <= CHI_HA.range * 1.15 && now >= tank.nextShot) {
      tank.nextShot = now + CHI_HA.reload * (.9 + random() * .3);
      const muzzle = chiHaMuzzle(tank), flight = Math.max(.3, distance / 260);
      const aim = { x: target.point.x + gauss() * ENEMY_TYPES.tank.dispersion, y: target.floor + .8, z: target.point.z + gauss() * ENEMY_TYPES.tank.dispersion };
      launchShell('enemy', muzzle, { x: (aim.x - muzzle.x) / flight, y: (aim.y - muzzle.y + .5 * GRAVITY * flight * flight) / flight,
        z: (aim.z - muzzle.z) / flight }, CHI_HA.damage * .5, CHI_HA.blastRadius);
      if (effects) effects.muzzle(muzzle, { x: -Math.sin(tank.turretYaw), y: 0, z: -Math.cos(tank.turretYaw) });
      else effect('flash', muzzle, 1, .12, 0xffb060, 0, 2);
      emit({ type: 'sound', name: 'enemy-gun', position: muzzle });
    }
    // 车体机枪短点射：压制近处炮位
    const hull = tank.machineGuns[0];
    hull.yaw = Math.max(-CHI_HA_MG.traverse, Math.min(CHI_HA_MG.traverse, wrap(desired - tank.heading)));
    if (distance < CHI_HA_MG.range * 1.6 && now >= tank.nextBurst) {
      tank.nextBurst = now + CHI_HA_MG.cooldown + CHI_HA_MG.burst * CHI_HA_MG.interval;
      const pose = chiHaMachineGunPose(tank, hull);
      if (Math.abs(wrap(desired - pose.yaw)) < .2) damageEmplacement(target.point, CHI_HA_MG.damage * .25, { team: 'enemy' }, now);
      emit({ type: 'sound', name: 'mg', position: pose.start });
    }
    return true;
  }

  function airTerrainHit(from, to, clearance = 0) {
    const path = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const length = path.length();
    if (length <= 0) return null;
    path.multiplyScalar(1 / length);
    const start = new THREE.Vector3(from.x, from.y - clearance, from.z);
    const distance = rayTerrain(start, path, length);
    if (distance === null && to.y - clearance > surfaceHeight(to.x, to.z)) return null;
    const position = start.addScaledVector(path, distance ?? length);
    position.y = surfaceHeight(position.x, position.z) + clearance;
    return { position };
  }

  function advancePlane(plane, dt) {
    if (dt === 0) return true;
    if (plane.health <= 0) {
      if (!plane.fall.grounded) {
        plane.velocity.y -= GRAVITY * dt; plane.velocity.multiplyScalar(1 - .15 * dt);
        plane.position.addScaledVector(plane.velocity, dt);
        plane.roll += plane.fall.spin * dt * 2; plane.pitch = Math.max(-1.2, plane.pitch - dt * .6);
        if (!effects && random() < dt * 10) effect('smoke', plane.position, 1.4, 2.5, 0x2e2c29, 1, 2);
        if (plane.position.y <= Math.max(0, groundHeight(plane.position.x, plane.position.z)) + .5) {
          plane.fall.grounded = true; plane.position.y = Math.max(0, groundHeight(plane.position.x, plane.position.z));
          const water = groundHeight(plane.position.x, plane.position.z) < 0;
          explosion({ x: plane.position.x, y: plane.position.y + 1, z: plane.position.z }, 2, water);
          if (water) plane.fall.sunk = true;
        }
      }
      return now - plane.destroyedAt < 45;
    }
    let patrol = postById(plane.patrolPostId);
    if (patrol && !alive(patrol)) {
      patrol = nearestPost(plane.position.x, plane.position.z);
      if (patrol) plane.patrolPostId = patrol.id;
    }
    const targets = eligiblePosts().filter(post => alive(post) && post.point.operatorId)
      .map(post => ({ id: post.id, unitId: post.id, team: 'friendly', health: post.point.health,
        position: { x: post.point.x, y: post.floor, z: post.point.z } }));
    const visible = (from, to) => !airTerrainHit(from, to);
    const previous = plane.position.clone();
    const shot = advanceAircraftAI(plane, dt, now, { targets, canFire: true, visible, groundHeight: surfaceHeight,
      patrolCenter: patrol?.point ?? plane.position, preferredUnitId: controlledId });
    plane.velocity.copy(plane.position).sub(previous).multiplyScalar(1 / dt);
    if (shot) {
      const yaw = plane.heading + (random() * 2 - 1) * AIRCRAFT_GUN.spread;
      const pitch = plane.pitch + (random() * 2 - 1) * AIRCRAFT_GUN.spread;
      const dir = aimDirection({ yaw, pitch });
      let nearest = null, distance = rayTerrain(shot.start, dir, AIRCRAFT_GUN.range) ?? AIRCRAFT_GUN.range;
      for (const target of targets) {
        const hit = raySphere({ ...target.position, y: target.position.y + 1.2 }, 1.2, shot.start, dir, distance);
        if (hit !== null && hit < distance) { nearest = target; distance = hit; }
      }
      if (nearest) damageEmplacement(postById(nearest.id).point, TYPES.plane.damage, { team: 'enemy' }, now);
      effects?.muzzle?.(shot.start, dir);
      emit({ type: 'sound', name: 'mg', position: shot.start });
    }
    const end = bombs.drop(plane, now, targets, { allowed: () => true, visible, groundHeight: surfaceHeight,
      source: () => ({ team: 'enemy' }) });
    const playerPost = postById(controlledId);
    if (end && playerPost && Math.hypot(end.x - playerPost.point.x, end.z - playerPost.point.z) < 40)
      emit({ type: 'toast', text: '敌机投弹！寻找掩护', alert: true });
    return true;
  }
  function advanceBombs(dt) {
    bombs.update(dt, airTerrainHit, (point, source) => {
      blast(point, AIR_BOMB.radius, AIR_BOMB.damage, source.team);
      if (effects) {
        effects.explosion(point, AIR_BOMB.radius, 'aircraft-bomb');
        emit({ type: 'sound', name: 'boom', position: point });
      } else explosion(point, 5, groundHeight(point.x, point.z) < 0);
    });
  }

  // ---------- 特效（对象池） ----------
  const effectGeometry = { sphere: new THREE.SphereGeometry(1, 10, 8), cone: new THREE.ConeGeometry(1, 1, 10, 1, true) };
  const fxItems = [], pool = [];
  function effect(kind, position, size, life, color, velocityY = 0, grow = 1) {
    let item = pool.pop();
    if (!item) {
      const mesh = new THREE.Mesh(effectGeometry.sphere, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      item = { mesh }; scene.add(mesh);
    }
    item.mesh.geometry = kind === 'splash' ? effectGeometry.cone : effectGeometry.sphere;
    item.mesh.material.color.setHex(color); item.mesh.material.opacity = kind === 'flash' ? 1 : .75;
    item.mesh.material.blending = kind === 'flash' ? THREE.AdditiveBlending : THREE.NormalBlending;
    item.mesh.position.set(position.x, position.y, position.z); item.mesh.visible = true;
    Object.assign(item, { kind, size, life, t: 0, velocityY, grow });
    item.mesh.scale.setScalar(size);
    fxItems.push(item);
    if (fxItems.length > 160) recycle(fxItems.shift());
  }
  function recycle(item) { item.mesh.visible = false; pool.push(item); }
  function explosion(position, size = 1, water = false) {
    if (water) world.puff?.({ x: position.x, y: 2, z: position.z }, { count: 6, radius: 3 * size, shade: .68, life: 5, rise: 1.2, grow: 2.2 });
    else world.puff?.({ x: position.x, y: position.y + 1, z: position.z }, { count: 8, radius: 1.6 * size, shade: .48, life: 8, rise: 1.6, grow: 1.8 * size });
    if (water) {
      effect('splash', { x: position.x, y: 0, z: position.z }, 4.5 * size, 1.8, 0xdfe5e0, 0, 1.4);      // 大口径炮弹落水：十余米高的水柱
      effect('smoke', { x: position.x, y: 3, z: position.z }, 4 * size, 2.4, 0xcfd6d2, 6, 2);
    } else if (effects) {
      effects.explosion(position, 3 + size * 3, size >= 2 ? 'explosive-pack' : size >= 1 ? 'mortar' : 'grenade');
    } else {
      effect('flash', position, 2.2 * size, .25, 0xffb050, 0, 2.5);
      effect('smoke', { x: position.x, y: position.y + 1, z: position.z }, 2 * size, 3.5, 0x4a4743, 2.4, 2.2);
    }
    emit({ type: 'sound', name: water ? 'splash' : 'boom', position });
  }
  function updateEffects(dt) {
    for (let i = fxItems.length - 1; i >= 0; i--) {
      const item = fxItems[i]; item.t += dt;
      const k = item.t / item.life;
      if (k >= 1) { fxItems.splice(i, 1); recycle(item); continue; }
      item.mesh.position.y += item.velocityY * dt;
      if (item.kind === 'splash') item.mesh.scale.set(item.size * (1 + k), item.size * 4 * Math.sin(Math.PI * Math.min(1, k * 1.4)) + .01, item.size * (1 + k));
      else item.mesh.scale.setScalar(item.size * (1 + k * item.grow));
      item.mesh.material.opacity = (item.kind === 'flash' ? 1 : .75) * (1 - k);
    }
  }

  // ---------- 命中检测 ----------
  function vesselLocal(vessel, x, z) {
    const dx = x - vessel.x, dz = z - vessel.z, c = Math.cos(vessel.heading), s = Math.sin(vessel.heading);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }
  const vesselSize = vessel => vessel.cfg ?? ENEMY_TYPES.landing;
  function insideVessel(vessel, p, margin = 0) {
    const size = vesselSize(vessel), local = vesselLocal(vessel, p.x, p.z);
    return Math.abs(local.x) < size.beam / 2 + margin && Math.abs(local.z) < size.length / 2 + margin && p.y < size.height + margin && p.y > -1.5;
  }
  function rayVessel(vessel, origin, dir, maxDistance) {
    const size = vesselSize(vessel), c = Math.cos(vessel.heading), s = Math.sin(vessel.heading);
    const o = vesselLocal(vessel, origin.x, origin.z);
    const d = { x: dir.x * c - dir.z * s, z: dir.x * s + dir.z * c };
    let tMin = 0, tMax = maxDistance;
    for (const [oo, dd, half] of [[o.x, d.x, size.beam / 2], [origin.y - (size.height - 1.5) / 2, dir.y, (size.height + 1.5) / 2], [o.z, d.z, size.length / 2]]) {
      if (Math.abs(dd) < 1e-9) { if (Math.abs(oo) > half) return null; continue; }
      let t1 = (-half - oo) / dd, t2 = (half - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
    return tMin;
  }
  function raySphere(center, radius, origin, dir, maxDistance) {
    const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z, c = ox * ox + oy * oy + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t >= 0 && t <= maxDistance ? t : null;
  }
  function rayTerrain(origin, dir, maxDistance) {
    for (let t = 1; t <= maxDistance; t += t < 200 ? 1.5 : 4) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y <= surfaceHeight(x, z)) return t;
    }
    return null;
  }
  function traceRay(origin, dir, maxDistance, includeTroops = true) {
    let best = { distance: rayTerrain(origin, dir, maxDistance) ?? Infinity, target: null, kind: 'terrain' };
    for (const vessel of [...ships, ...landings]) {
      if (vessel.sinking !== null) continue;
      const t = rayVessel(vessel, origin, dir, Math.min(best.distance, maxDistance));
      if (t !== null && t < best.distance) best = { distance: t, target: vessel, kind: vessel.cfg ? 'ship' : 'landing' };
    }
    if (includeTroops) for (const soldier of troops) {
      if (soldier.dead !== null) continue;
      const center = { x: soldier.x, y: groundHeight(soldier.x, soldier.z) + .95, z: soldier.z };
      const t = raySphere(center, .55, origin, dir, Math.min(best.distance, maxDistance));
      if (t !== null && t < best.distance) best = { distance: t, target: soldier, kind: 'troop' };
    }
    if (includeTroops) for (const vehicle of vehicles) {
      if (vehicle.health <= 0) continue;
      const tank = vehicle.type === 'tank';
      const center = { x: vehicle.position.x, y: vehicle.position.y + (tank ? 1.1 : 0), z: vehicle.position.z };
      const t = raySphere(center, tank ? 2.4 : ENEMY_TYPES.aircraft.radius, origin, dir, Math.min(best.distance, maxDistance));
      if (t !== null && t < best.distance) best = { distance: t, target: vehicle, kind: vehicle.type };
    }
    return best.distance === Infinity ? null : best;
  }

  // ---------- 伤害 ----------
  function damageVessel(vessel, amount, byPlayer) {
    if (vessel.sinking !== null || amount <= 0) return;
    vessel.health -= amount;
    if (vessel.health > 0) return;
    vessel.sinking = now;
    explosion({ x: vessel.x, y: 3, z: vessel.z }, vessel.cfg ? 2.4 : 1.4);
    if (vessel.cfg) { state.stats.shipsSunk++; emit({ type: 'toast', text: `${vessel.label ?? vessel.cfg.name}被击沉${byPlayer ? '（玩家）' : ''}` }); }
    else state.stats.landingSunk++;
  }
  function damageTroop(soldier, amount) {
    if (soldier.dead !== null) return;
    soldier.health -= amount;
    if (soldier.health > 0) return;
    soldier.dead = now; state.stats.infantryKilled++;
  }
  function blast(position, radius, damage, team, byPlayer) {
    if (team === 'friendly') {
      for (const vessel of [...ships, ...landings]) {
        if (vessel.sinking !== null) continue;
        const local = vesselLocal(vessel, position.x, position.z), size = vesselSize(vessel);
        const dx = Math.max(0, Math.abs(local.x) - size.beam / 2), dz = Math.max(0, Math.abs(local.z) - size.length / 2);
        const d = Math.hypot(dx, dz, Math.max(0, position.y - size.height));
        if (d < radius) damageVessel(vessel, damage * .45 * (1 - d / radius), byPlayer);
      }
      for (const soldier of troops) {
        const d = Math.hypot(soldier.x - position.x, groundHeight(soldier.x, soldier.z) + 1 - position.y, soldier.z - position.z);
        if (d < radius) damageTroop(soldier, 160 * (1 - d / radius));
      }
      for (const vehicle of vehicles) {
        if (vehicle.health <= 0) continue;
        const reach = radius + (vehicle.type === 'tank' ? CHI_HA.length / 2 : ENEMY_TYPES.aircraft.radius);
        const d = Math.hypot(vehicle.position.x - position.x, vehicle.position.y + 1 - position.y, vehicle.position.z - position.z);
        if (d < reach) damageVehicle(vehicle, damage * (vehicle.type === 'tank' ? .9 : 1.6) * (1 - d / reach), byPlayer);
      }
    } else {
      for (const post of posts) {
        if (!alive(post)) continue;
        let d, reach = radius + 1.5;
        if (post.boat) {   // 舰体按长方体计算距离
          const local = vesselLocal(post.boat, position.x, position.z);
          d = Math.hypot(Math.max(0, Math.abs(local.x) - post.boat.cfg.beam / 2), Math.max(0, Math.abs(local.z) - post.boat.cfg.length / 2),
            Math.max(0, position.y - post.boat.cfg.height));
          reach = radius;
        } else d = Math.hypot(post.point.x - position.x, post.floor + 1 - position.y, post.point.z - position.z);
        if (d < reach) damageEmplacement(post.point, damage * (1 - d / reach), { team: 'enemy' }, now);
      }
    }
  }

  // ---------- 炮弹 ----------
  const shellGeometry = new THREE.SphereGeometry(.22, 6, 4);
  const shellMaterial = { friendly: new THREE.MeshBasicMaterial({ color: 0xffd38a }), enemy: new THREE.MeshBasicMaterial({ color: 0xff8a5a }) };
  function launchShell(team, origin, velocity, damage, radius, byPlayer = false) {
    const mesh = new THREE.Mesh(shellGeometry, shellMaterial[team]);
    mesh.position.set(origin.x, origin.y, origin.z); scene.add(mesh);
    shells.push({ team, x: origin.x, y: origin.y, z: origin.z, vx: velocity.x, vy: velocity.y, vz: velocity.z,
      damage, radius, life: 16, mesh, byPlayer });
  }
  function advanceShells(dt) {
    const steps = 4;
    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i]; let done = false;
      for (let s = 0; s < steps && !done; s++) {
        const h = dt / steps;
        shell.vy -= GRAVITY * h; shell.x += shell.vx * h; shell.y += shell.vy * h; shell.z += shell.vz * h;
        shell.life -= h;
        const p = { x: shell.x, y: shell.y, z: shell.z };
        if (shell.team === 'friendly') {
          const plane = livePlanes().find(v => v.position.distanceTo(p) < ENEMY_TYPES.aircraft.radius + 4);
          const tank = liveTanks().find(v => Math.hypot(v.position.x - p.x, v.position.z - p.z) < CHI_HA.length / 2 && p.y < v.position.y + CHI_HA.height);
          if (plane || tank) {   // 近炸引信（对空）/ 直接命中坦克
            blast(p, shell.radius, shell.damage, 'friendly', shell.byPlayer);
            if (effects) effects.explosion(p, shell.radius, plane ? 'aircraft-hit' : 'tank-shell'); else explosion(p, 1.2);
            if (shell.byPlayer) emit({ type: 'hit', kind: plane ? 'plane' : 'tank' });
            done = true; break;
          }
          const hit = [...ships, ...landings].find(vessel => vessel.sinking === null && insideVessel(vessel, p, .3));
          if (hit) {
            damageVessel(hit, shell.damage, shell.byPlayer);
            blast(p, shell.radius, shell.damage, 'friendly', shell.byPlayer);
            explosion(p, 1.2); if (shell.byPlayer) emit({ type: 'hit', kind: hit.cfg ? 'ship' : 'landing' });
            done = true; break;
          }
        } else {
          const ship = shipPosts().find(post => alive(post) && insideVessel(post.boat, p, .5));
          if (ship) { blast(p, shell.radius, shell.damage, 'enemy'); explosion(p, 1.3); done = true; break; }
        }
        const ground = groundHeight(p.x, p.z);
        if (p.y <= Math.max(0, ground)) {
          const water = ground < 0;
          blast(p, shell.radius * (water ? .7 : 1), shell.damage, shell.team, shell.byPlayer);
          explosion(p, 1, water); done = true;
        }
        if (shell.life <= 0) done = true;
      }
      if (done) { scene.remove(shell.mesh); shells.splice(i, 1); }
      else shell.mesh.position.set(shell.x, shell.y, shell.z);
    }
  }
  function aimDirection(point, yawError = 0, pitchError = 0) {
    const yaw = point.yaw + yawError, pitch = point.pitch + pitchError;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }
  function shoot(post, byPlayer, error = 0) {
    const { point } = post, settings = point.weapon.settings;
    if (!fireEmplacement(point, now)) return false;
    const pose = postPose(post);
    if (byPlayer) state.stats.shots++;
    if (settings.type === 'field-gun') {
      const dir = aimDirection(point, gauss() * error, gauss() * error * .4);
      const v = shellSpeedOf(point);
      launchShell('friendly', pose.muzzle, { x: dir.x * v, y: dir.y * v, z: dir.z * v },
        settings.damage, settings.radius, byPlayer);
      const big = settings.mount === 'coastal' ? 2 : 1;
      effect('flash', pose.muzzle, 1.2 * big, .12, 0xffc070, 0, 2);
      effect('smoke', pose.muzzle, 1 * big, 2.2 * big, 0xb8b2a6, 1.2, 2.4);
      world.puff?.(pose.muzzle, { count: 10 * big, radius: 1.2 * big, shade: .58, life: 7 + 3 * big, rise: .6, grow: 1.6 * big, dir, speed: 14 * big });
      emit({ type: 'sound', name: 'gun', position: pose.muzzle, player: byPlayer });
    } else {
      const spread = settings.spread + error;
      const dir = aimDirection(point, gauss() * spread, gauss() * spread);
      const hit = traceRay(pose.muzzle, dir, settings.range);
      if (hit?.kind === 'troop') { damageTroop(hit.target, settings.damage); if (byPlayer) emit({ type: 'hit', kind: 'troop' }); }
      else if (hit?.kind === 'landing') damageVessel(hit.target, 9, byPlayer);
      else if (hit?.kind === 'ship') damageVessel(hit.target, 1.5, byPlayer);
      else if (hit?.kind === 'plane') { damageVehicle(hit.target, settings.damage * .25, byPlayer); if (byPlayer) emit({ type: 'hit', kind: 'plane' }); }
      else if (hit?.kind === 'tank') damageVehicle(hit.target, 1, byPlayer);   // 机枪对战车基本无效
      if (hit && random() < .25) {
        const p = { x: pose.muzzle.x + dir.x * hit.distance, y: pose.muzzle.y + dir.y * hit.distance, z: pose.muzzle.z + dir.z * hit.distance };
        effect(groundHeight(p.x, p.z) < 0 && hit.kind === 'terrain' ? 'splash' : 'smoke', p, .35, .5, 0xd9d4c8, .5, 1);
      }
      emit({ type: 'sound', name: 'mg', position: pose.muzzle, player: byPlayer });
    }
    return true;
  }

  // ---------- 开场演出：镜头掠过我军三舰与下游锚地的阻塞船，远处日舰自下游弯道逆流驶来 ----------
  function advanceIntro(dt) {
    const t = state.introTime += dt;
    const orbit = .35 + t * .05;
    const cx = 150 + Math.cos(orbit) * 900, cz = Math.sin(orbit) * 420;
    camera.position.set(cx, Math.max(230 - t * 9, groundHeight(cx, cz) + 25), cz);
    camera.lookAt(150, 0, 0);
  }
  function finishIntro() {
    state.phase = 'naval';
    for (const ship of ships) assignHold(ship);
    beginTransfer(controlledId, 'start', 1.6);
    emit({ type: 'phase', phase: 'naval' });
    emit({ type: 'toast', text: '第一阶段 · 江面决战：操纵我舰艏主炮迎击日舰（1–3 或 Q/E 换舰）', alert: true });
  }
  const introCaption = () => {
    if (state.phase !== 'intro') return '';
    return state.introTime < 6 ? '1937年秋 · 江阴 · 长江滚滚东流。中国海军第一舰队“平海”“宁海”“逸仙”列阵迎敌，下游锚地停泊着待命自沉的旧舰与商轮'
      : '日军舰队自吴淞方向逆流而上 —— 第一阶段江面决战，第二阶段自沉封江、死守两岸炮台';
  };

  // ---------- 控制与“附身”切换 ----------
  let controlledId = 'pinghai', transfer = null, pendingAutoSwitch = null;
  const viewEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let viewMode = 'first';
  function viewFor(post) {
    const { point } = post, settings = point.weapon.settings, preset = settings.view ?? {};
    const third = viewMode === 'third';
    if (third || settings.mount === 'coastal' || settings.mount === 'deck' || settings.mount === 'shipTurret') {
      const v = third ? preset.third ?? { back: 7, up: 2.6 } : preset.first;
      const base = postPose(post).trunnion ?? { x: point.x, y: post.floor + settings.muzzleHeight, z: point.z };
      const position = new THREE.Vector3(base.x + Math.sin(point.yaw) * v.back, base.y + v.up, base.z + Math.cos(point.yaw) * v.back);
      if (third) position.y = Math.max(position.y, surfaceHeight(position.x, position.z) + 1.2);
      viewEuler.set(point.pitch - (third ? .1 : 0), point.yaw, 0, 'YXZ');
      return { position, quaternion: new THREE.Quaternion().setFromEuler(viewEuler) };
    }
    const pose = emplacementPose(point, post.floor);
    const cannon = settings.type === 'field-gun';
    // 火炮视角抬到防盾上沿之上，避免防盾挡住半个屏幕
    const back = cannon ? 2.3 : .45, up = cannon ? 1.15 : .12;
    const position = new THREE.Vector3(pose.eye.x + Math.sin(point.yaw) * back, pose.eye.y + up, pose.eye.z + Math.cos(point.yaw) * back);
    viewEuler.set(point.pitch, point.yaw, 0, 'YXZ');
    return { position, quaternion: new THREE.Quaternion().setFromEuler(viewEuler) };
  }
  function toggleView() {
    viewMode = viewMode === 'first' ? 'third' : 'first';
    if (activePhase()) transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration: .35, local: true };
    emit({ type: 'toast', text: viewMode === 'first' ? '第一人称：炮手视角' : '第三人称：炮位后上方视角' });
  }
  function beginTransfer(id, reason, duration = 1.1) {
    const post = postById(id);
    if (!post || !alive(post)) return false;
    const previous = postById(controlledId);
    if (previous && previous !== post && alive(previous)) previous.point.operatorId = 'crew';
    controlledId = id; post.point.operatorId = 'player';
    transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration };
    if (reason !== 'start') state.stats.transfers++;
    emit({ type: 'transfer', id, name: post.name, reason });
    return true;
  }
  function switchPost(direction) {
    if (!['naval', 'hold'].includes(state.phase) || transfer) return false;
    const id = typeof direction === 'string' ? direction : nextPostId(eligiblePosts(), controlledId, direction);
    if (!id || id === controlledId) return false;
    const post = postById(id);
    if (!post || !eligiblePosts().includes(post)) {
      emit({ type: 'toast', text: state.phase === 'naval' ? '第一阶段只能在我舰上复生' : '我舰已全部沉没，只能接管两岸阵地' }); return false;
    }
    if (!alive(post)) { emit({ type: 'toast', text: `${post.name}已${post.boat ? '沉没' : '被摧毁'}，无法接管` }); return false; }
    return beginTransfer(id, 'manual');
  }
  const cinematic = { position: new THREE.Vector3(-120, 40, 90), look: new THREE.Vector3(0, 0, 0) };
  function updateCamera(dt) {
    if (state.phase === 'scuttle') {   // 自沉封江演出：镜头跟随正在驶向最窄处 / 正在自沉的船
      const focus = blockships.find(ship => ship.state === 'transit' || ship.state === 'scuttling' || ship.state === 'sinking') ?? blockships.at(-1);
      const look = focus ? new THREE.Vector3(focus.x, 3, focus.z) : new THREE.Vector3(0, 0, 0);
      const side = focus && focus.z < 0 ? -1 : 1;
      const desired = look.clone().add(new THREE.Vector3(-230, 95, side * 240));
      const k = 1 - Math.exp(-dt * 1.2);
      cinematic.position.lerp(desired, k); cinematic.look.lerp(look, k);
      camera.position.copy(cinematic.position); camera.lookAt(cinematic.look);
      return;
    }
    const post = postById(controlledId);
    if (!post) return;
    const view = viewFor(post);
    if (transfer) {
      transfer.t += dt;
      const k = Math.min(1, transfer.t / transfer.duration), e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(transfer.from, view.position, e);
      if (!transfer.local) camera.position.y += Math.sin(Math.PI * k) * Math.min(40, transfer.from.distanceTo(view.position) * .25);
      camera.quaternion.slerpQuaternions(transfer.fromQuat, view.quaternion, e);
      if (k >= 1) transfer = null;
    } else {
      camera.position.copy(view.position); camera.quaternion.copy(view.quaternion);
    }
  }

  function controlPlayer(dt, input) {
    const post = postById(controlledId);
    if (!post || !alive(post) || transfer) return;
    const { point } = post;
    if (input.lookDX || input.lookDY)
      emplacementLook(point, point.yaw - input.lookDX * LOOK_SENSITIVITY * (input.sensitivity ?? 1),
        point.pitch - input.lookDY * LOOK_SENSITIVITY * (input.sensitivity ?? 1));
    const cannon = point.weapon.settings.type === 'field-gun';
    if (cannon ? input.firePressed || input.fireHeld : input.fireHeld) shoot(post, true);
  }
  // 我舰航行全部由 AI 负责（玩家只操作艏主炮塔）：在我方江段巡弋、变向规避，被击沉后横倾下沉直至完全没入江中
  function moveBoat(post, dt) {
    const boat = post.boat;
    if (!alive(post)) {
      boat.speed *= Math.max(0, 1 - dt * .6);
      boat.sinking = Math.min(1, boat.sinking + dt / 18);
      if (boat.sinking >= 1 && !boat.sunk) {
        boat.sunk = true; boat.hull.visible = false; post.model.visible = false;
        emit({ type: 'toast', text: `${post.name}完全沉没`, alert: true });
      }
    } else if (state.phase === 'naval') {
      // 百米级舰体在 120 米宽的江面上无法掉头：舰首始终朝下游（敌方），以进车/倒车往复机动、小舵角左右蛇行规避
      const others = shipPosts().filter(other => other !== post && alive(other));
      boat.dir ??= 1;
      if (!boat.waypoint || now > boat.retarget || (boat.dir > 0 ? boat.x > boat.waypoint.x : boat.x < boat.waypoint.x)) {
        if (boat.waypoint) boat.dir = -boat.dir;
        boat.waypoint = { x: boat.dir > 0 ? -200 + random() * 220 : -850 + random() * 250, z: (random() - .5) * 700 };   // 在堵塞点上游江面巡弋
        boat.retarget = now + 30 + random() * 15;
      }
      const crowd = others.map(o => ({ o, d: Math.hypot(o.boat.x - boat.x, o.boat.z - boat.z) })).sort((p, q) => p.d - q.d)[0];
      if (crowd && crowd.d < 220 && Math.abs(crowd.o.boat.z - boat.z) < 90) boat.waypoint.z = Math.max(-480, Math.min(480, crowd.o.boat.z + (boat.z >= crowd.o.boat.z ? 160 : -160)));
      const lateral = Math.max(-.3, Math.min(.3, (boat.waypoint.z - boat.z) * .004));
      const desired = -Math.PI / 2 - lateral * Math.sign(boat.speed || boat.dir);
      boat.heading = wrap(boat.heading + Math.max(-.06 * dt, Math.min(.06 * dt, wrap(desired - boat.heading))));
      const goal = boat.dir > 0 ? 5 : -3.2;
      boat.speed += Math.max(-.5 * dt, Math.min(.5 * dt, goal - boat.speed));
    }
    const f = forward(boat.heading), half = boat.cfg.length / 2;
    const nx = boat.x + f.x * boat.speed * dt, nz = boat.z + f.z * boat.speed * dt;
    const blocked = Math.abs(boat.speed) > .05 && [0, half - 4, -(half - 4)].some(o => groundHeight(nx + f.x * o, nz + f.z * o) > -1.4 ||
      Math.abs(nz + f.z * o) > RIVER_HALF - 140 || insideWreck(nx + f.x * o, nz + f.z * o, 2, wreckZones));
    if (blocked && alive(post)) { boat.speed = 0; boat.retarget = 0; }   // 受阻即换向（进车↔倒车）
    else if (!blocked) { boat.x = nx; boat.z = nz; }
    syncBoatGun(post);
  }

  // ---------- AI 炮手 ----------
  function predicted(vessel, flight) {
    if (vessel.sinking !== null) return null;
    const speed = vessel.cfg ? (Math.abs(vessel.x) < 40 ? vessel.cfg.gapSpeed : vessel.cfg.speed) : vessel.state === 'approach' ? ENEMY_TYPES.landing.speed : 0;
    const f = forward(vessel.heading);
    return { x: vessel.x + f.x * speed * flight, y: 1.6, z: vessel.z + f.z * speed * flight };
  }
  function operateAI(post, dt) {
    const { point } = post, settings = point.weapon.settings;
    let best = null, bestScore = Infinity;
    const consider = (target, aimPoint, score) => {
      if (!aimPoint) return;
      const distance = Math.hypot(aimPoint.x - point.x, aimPoint.z - point.z);
      if (distance > settings.range || !emplacementCanAimAt(point, aimPoint, post.floor)) return;
      if (score(distance) < bestScore) { best = { target, aimPoint, distance }; bestScore = score(distance); }
    };
    const leadPlane = (plane, flight) => ({ x: plane.position.x + plane.velocity.x * flight, y: plane.position.y + plane.velocity.y * flight,
      z: plane.position.z + plane.velocity.z * flight });
    if (settings.type === 'field-gun') {
      for (const tank of liveTanks()) {
        const rough = Math.hypot(tank.position.x - point.x, tank.position.z - point.z), flight = rough / shellSpeedOf(point);
        const aim = { x: tank.position.x, y: tank.position.y + 1 + .5 * GRAVITY * flight * flight, z: tank.position.z };
        consider(tank, aim, d => d - 80);
      }
      if (settings.variant === 'flak88') for (const plane of livePlanes()) {
        const rough = plane.position.distanceTo(new THREE.Vector3(point.x, post.floor, point.z)), flight = rough / shellSpeedOf(point);
        const aim = leadPlane(plane, flight); aim.y += .5 * GRAVITY * flight * flight;
        consider(plane, aim, d => d - 200);
      }
      for (const vessel of [...ships, ...landings]) {
        const rough = Math.hypot(vessel.x - point.x, vessel.z - point.z), flight = rough / shellSpeedOf(point);
        const aim = predicted(vessel, flight);
        if (aim) aim.y += .5 * GRAVITY * flight * flight;
        consider(vessel, aim, d => vessel.cfg ? vessel.x + d * .3 : vessel.x + 120 + d * .3);
      }
    } else {
      for (const soldier of troops) if (soldier.dead === null)
        consider(soldier, { x: soldier.x, y: groundHeight(soldier.x, soldier.z) + .9, z: soldier.z }, d => d);
      for (const craft of landings) if (craft.sinking === null)
        consider(craft, predicted(craft, .4), d => d + 60);
      for (const plane of livePlanes()) consider(plane, leadPlane(plane, .35), d => d - 40);
    }
    if (!best) return;
    const aligned = aimEmplacement(point, best.aimPoint, dt, post.floor);
    if (!aligned) return;
    if (settings.type === 'field-gun') {
      if (now < post.aiNextShot) return;
      if (shoot(post, false, .007)) post.aiNextShot = now + (settings.aiInterval ?? 8.5) + random() * 4;
    } else {
      if (now < post.pauseUntil) return;
      if (!post.burstUntil) post.burstUntil = now + .8;
      if (now > post.burstUntil) { post.burstUntil = 0; post.pauseUntil = now + 2.2 + random(); return; }
      shoot(post, false, .035);
    }
  }

  // ---------- 敌军行为 ----------
  // 敌舰炮塔：持续转向最近的我方火力点；开火时从朝向目标的那门炮口发射
  const turretWorld = new THREE.Vector3();
  function aimTurrets(ship, target, dt) {
    for (const turret of ship.model.userData.turrets ?? []) {
      const { base = 0, arc = 2.5, elevation } = turret.userData;
      turret.getWorldPosition(turretWorld);
      const desired = wrap(Math.atan2(turretWorld.x - target.point.x, turretWorld.z - target.point.z) - ship.heading - base);
      const goal = base + Math.max(-arc, Math.min(arc, desired));
      turret.rotation.y += Math.max(-.6 * dt, Math.min(.6 * dt, wrap(goal - turret.rotation.y)));
      turret.userData.onTarget = Math.abs(desired) <= arc && Math.abs(wrap(goal - turret.rotation.y)) < .15;
      if (elevation) elevation.rotation.x = .04 + Math.min(.25, Math.hypot(turretWorld.x - target.point.x, turretWorld.z - target.point.z) / 2000);
    }
  }
  function turretMuzzle(ship, target) {
    const ready = (ship.model.userData.turrets ?? []).filter(t => t.userData.onTarget);
    if (!ready.length) return null;
    const turret = ready[Math.floor(random() * ready.length)];
    turret.getWorldPosition(turretWorld);
    const yaw = ship.heading + turret.rotation.y, reach = turret.userData.muzzle ?? 3;
    return { x: turretWorld.x - Math.sin(yaw) * reach, y: turretWorld.y + 1, z: turretWorld.z - Math.cos(yaw) * reach };
  }
  function advanceShip(ship, dt) {
    if (ship.sinking !== null) { syncShip(ship); return now - ship.sinking < 10; }
    const target = ship.route[ship.wp];
    const dx = target.x - ship.x, dz = target.z - ship.z;
    if (Math.hypot(dx, dz) < 40 && ship.wp < ship.route.length - 1) ship.wp++;
    // 到达停泊炮击位置后减速、侧舷对敌缓慢游弋；未到达时沿航线前进
    const holding = ship.x <= ship.holdX;
    const goal = holding ? { x: ship.holdX + 90 * Math.sin(now * .03 + ship.lane), z: ship.holdZ + 110 * Math.cos(now * .025 + ship.lane) } : target;
    const desired = Math.atan2(-(goal.x - ship.x), -(goal.z - ship.z)), turn = wrap(desired - ship.heading);
    ship.heading = wrap(ship.heading + Math.max(-.3 * dt, Math.min(.3 * dt, turn)));
    const speed = holding ? 1.6 : ship.cfg.speed, f = forward(ship.heading);
    const nx = ship.x + f.x * speed * dt, nz = ship.z + f.z * speed * dt;
    if (!insideWreck(nx - ship.cfg.length / 2, nz, 4, wreckZones) && groundHeight(nx, nz) < -1) { ship.x = nx; ship.z = nz; }
    const targetable = posts.filter(alive);
    const nearest = targetable.sort((a, b) => Math.hypot(targetPosition(a).x - ship.x, targetPosition(a).z - ship.z) - Math.hypot(targetPosition(b).x - ship.x, targetPosition(b).z - ship.z))[0];
    const aimAt = post => ({ point: targetPosition(post) });
    if (nearest && ship.model.userData.turrets) { ship.model.updateMatrixWorld(true); aimTurrets(ship, aimAt(ship.aimTarget && alive(ship.aimTarget) ? ship.aimTarget : nearest), dt); }
    if (state.phase !== 'scuttle' && now >= ship.nextFire) {   // 自沉封江期间日舰暂停炮击（演出）
      ship.nextFire = now + ship.cfg.fireInterval * (.8 + random() * .4);
      let candidates = posts.filter(post => alive(post) &&
        Math.hypot(targetPosition(post).x - ship.x, targetPosition(post).z - ship.z) < ship.cfg.fireRange);
      // 第一阶段日舰只与我舰对射（两岸阵地留到第二阶段）
      if (state.phase === 'naval') candidates = candidates.filter(post => post.boat);
      if (candidates.length) {
        const player = candidates.find(post => post.id === controlledId);
        const target = player && random() < .45 ? player : candidates[Math.floor(random() * candidates.length)];
        ship.aimTarget = target;
        const tp = targetPosition(target), lead = target.boat ? forward(target.boat.heading) : { x: 0, z: 0 }, ls = target.boat ? target.boat.speed * 1.4 : 0;
        const aim = { x: tp.x + lead.x * ls + gauss() * ship.cfg.dispersion, y: tp.y, z: tp.z + lead.z * ls + gauss() * ship.cfg.dispersion };
        const origin = turretMuzzle(ship, target) ?? { x: ship.x, y: 4.5, z: ship.z };
        const distance = Math.hypot(aim.x - origin.x, aim.z - origin.z), flight = Math.max(.4, distance / ENEMY_SHELL_SPEED);
        launchShell('enemy', origin, { x: (aim.x - origin.x) / flight, y: (aim.y - origin.y + .5 * GRAVITY * flight * flight) / flight,
          z: (aim.z - origin.z) / flight }, ship.cfg.shellDamage * navalPressure(), ship.cfg.shellRadius);
        effect('flash', origin, 1.6, .15, 0xffb060, 0, 2);
        effect('smoke', origin, 1.2, 1.6, 0x9d978c, 1, 2);
        emit({ type: 'sound', name: 'enemy-gun', position: origin });
      }
    }
    if (ship.health < ship.cfg.health * .5 && random() < dt * 3)
      effect('smoke', { x: ship.x, y: 5, z: ship.z }, 1.6, 3, 0x343230, 3, 2);
    syncShip(ship);
    return true;
  }
  function advanceLanding(craft, dt) {
    if (craft.sinking !== null) { syncShip(craft); return now - craft.sinking < 8; }
    if (craft.state === 'approach') {
      while (craft.via?.length && Math.hypot(craft.via[0].x - craft.x, craft.via[0].z - craft.z) < 40) craft.via.shift();
      const goal = craft.via?.length ? craft.via[0] : craft.target;
      const dx = goal.x - craft.x, dz = goal.z - craft.z, distance = craft.via?.length ? 99 : Math.hypot(dx, dz);
      const desired = Math.atan2(-dx, -dz);
      craft.heading = wrap(craft.heading + Math.max(-.9 * dt, Math.min(.9 * dt, wrap(desired - craft.heading))));
      const f = forward(craft.heading), speed = ENEMY_TYPES.landing.speed * Math.min(1, distance / 10 + .3);
      craft.x += f.x * speed * dt; craft.z += f.z * speed * dt;
      if (distance < 3 || groundHeight(craft.x + f.x * 6, craft.z + f.z * 6) > -.4) {
        craft.state = 'unloading'; craft.unloadAt = now + ENEMY_TYPES.landing.unloadSeconds;
      }
    } else if (craft.state === 'unloading' && now >= craft.unloadAt) {
      craft.state = 'empty'; craft.model.userData.ramp.rotation.x = -1.2; craft.model.userData.unload?.(); spawnTroops(craft);
    }
    syncShip(craft);
    return true;
  }
  function advanceTroop(soldier, dt) {
    if (soldier.dead !== null) {
      const k = Math.min(1, (now - soldier.dead) / .6);
      soldier.model.rotation.x = -k * Math.PI / 2; soldier.model.position.y = groundHeight(soldier.x, soldier.z) + .2 * k;
      return now - soldier.dead < 20;
    }
    const cfg = ENEMY_TYPES.infantry;
    let target = null, best = Infinity;
    for (const post of posts) {
      if (!alive(post) || post.bank !== soldier.bank) continue;
      const d = Math.hypot(post.point.x - soldier.x, post.point.z - soldier.z);
      if (d < best) { best = d; target = post; }
    }
    if (!target) return true;
    soldier.attacking = best <= cfg.attackRange;   // 供人物表现层切换跪姿瞄准
    if (best > cfg.attackRange) {
      const dx = target.point.x + soldier.offset - soldier.x, dz = target.point.z - soldier.z, len = Math.hypot(dx, dz) || 1;
      const climb = Math.abs(groundHeight(soldier.x + dx / len, soldier.z + dz / len) - groundHeight(soldier.x, soldier.z));
      const pace = cfg.speed / (1 + climb * 1.1);   // 攀爬石崖时明显变慢
      soldier.x += dx / len * pace * dt; soldier.z += dz / len * pace * dt;
      soldier.walk = (soldier.walk ?? 0) + pace * dt * 3.2;
      const legs = soldier.model.userData.legs;
      if (legs) { legs[0].rotation.x = Math.sin(soldier.walk) * .55; legs[1].rotation.x = -Math.sin(soldier.walk) * .55; }
      else soldier.model.userData.stride?.(now + soldier.offset);
      soldier.model.rotation.y = Math.atan2(-dx, -dz);
      soldier.model.position.set(soldier.x, groundHeight(soldier.x, soldier.z) + Math.abs(Math.sin(now * 9 + soldier.offset)) * .06, soldier.z);
    } else if (now >= soldier.nextAttack) {
      soldier.nextAttack = now + cfg.attackInterval * (.8 + random() * .4);
      damageEmplacement(target.point, cfg.attackDamage, { team: 'enemy' }, now);
      explosion({ x: target.point.x + (random() - .5) * 2, y: target.floor + .6, z: target.point.z + (random() - .5) * 2 }, .5);
      if (target.id === controlledId) emit({ type: 'toast', text: '日军步兵正在用手榴弹攻击你的阵位！', alert: true });
    }
    return true;
  }

  // ---------- 自沉封江：阻塞船先四散，再一艘接一艘驶向最窄处就位、引爆自沉 ----------
  const wreckZones = [];
  const activePhase = () => state.phase === 'naval' || state.phase === 'scuttle' || state.phase === 'hold';
  const blockships = BLOCKSHIPS.map((spec, index) => {
    const model = createBlockshipModel({ kind: spec.kind, length: spec.length, beam: spec.beam, seed: 101 + index * 37, name: spec.name });
    const ship = { spec, model, x: spec.start[0], z: spec.start[1], heading: Math.PI / 2, speed: 0, y: 0, roll: 0, pitch: 0,   // 锚泊时船首朝上游（顶流）
      state: 'anchored', departAt: 0, chargesAt: 0, charges: 0, sinkAt: 0 };
    scene.add(model); syncBlockship(ship);
    return ship;
  });
  const SCUTTLE = { disperse: 4, spacing: 1.9, speed: 13, charges: 3, sinkSeconds: 6, linger: 3 };
  function syncBlockship(ship) {
    ship.model.position.set(ship.x, ship.y + Math.sin(now * 1.1 + ship.spec.length) * .06, ship.z);
    ship.model.rotation.set(ship.pitch, ship.heading, ship.roll, 'YXZ');
    for (const mesh of ship.model.userData.wake ?? []) mesh.visible = ship.speed > .8;
  }
  function steerBlockship(ship, goal, dt, speed) {
    const dx = goal.x - ship.x, dz = goal.z - ship.z, distance = Math.hypot(dx, dz);
    const desired = Math.atan2(-dx, -dz);
    ship.heading = wrap(ship.heading + Math.max(-.45 * dt, Math.min(.45 * dt, wrap(desired - ship.heading))));
    const target = distance < 12 ? Math.max(1.2, distance * .4) : speed;
    ship.speed += Math.max(-2 * dt, Math.min(2 * dt, target - ship.speed));
    const f = forward(ship.heading);
    ship.x += f.x * ship.speed * dt; ship.z += f.z * ship.speed * dt;
    return distance;
  }
  function sinkBlockship(ship, instant = false) {
    ship.state = 'sunk'; ship.speed = 0;
    const [x, z, heading] = ship.spec.slot;
    if (instant) { ship.x = x; ship.z = z; ship.heading = heading; }
    ship.y = -ship.spec.depth; ship.roll = (ship.spec.flagship ? .06 : .16) * (ship.spec.slot[1] >= 0 ? 1 : -1); ship.pitch = .03;
    wreckZones.push(blockshipZone(ship.spec));
    syncBlockship(ship);
  }
  function beginScuttle() {
    state.phase = 'scuttle'; state.scuttleTime = 0; transfer = null;
    const previous = postById(controlledId);
    if (previous) previous.point.operatorId = alive(previous) ? 'crew' : null;
    blockships.forEach((ship, index) => { ship.state = 'disperse'; ship.departAt = SCUTTLE.disperse + index * SCUTTLE.spacing; });
    cinematic.position.copy(camera.position);
    emit({ type: 'phase', phase: 'scuttle' });
    emit({ type: 'toast', text: '我军三舰全部沉没 · 江防总指挥部下令：阻塞船自沉封江！（空格跳过演出）', alert: true });
  }
  function advanceScuttle(dt) {
    const t = state.scuttleTime += dt;
    for (const ship of blockships) {
      const [sx, sz, sh] = ship.spec.slot;
      if (ship.state === 'disperse') {          // 四散开来：离开锚地，各自驶向等待位置
        steerBlockship(ship, { x: ship.spec.hold[0], z: ship.spec.hold[1] }, dt, 5);
        if (t >= ship.departAt) { ship.state = 'transit'; emit({ type: 'toast', text: `${ship.spec.name}驶向江面最窄处` }); }
      } else if (ship.state === 'transit') {    // 逆流而上：先到就位点下游侧，再横转到位
        const approach = { x: sx + 70, z: sz };
        const near = Math.hypot(approach.x - ship.x, approach.z - ship.z) < 25 || ship.x < approach.x + 2;
        if (!near && !ship.settling) steerBlockship(ship, approach, dt, SCUTTLE.speed);
        else {   // 抵近后减速滑入就位点并横转船身
          ship.settling ??= { x: ship.x, z: ship.z, heading: ship.heading, t: 0 };
          const k = Math.min(1, (ship.settling.t += dt) / 7), e = k * k * (3 - 2 * k);
          ship.x = ship.settling.x + (sx - ship.settling.x) * e; ship.z = ship.settling.z + (sz - ship.settling.z) * e;
          ship.heading = wrap(ship.settling.heading + wrap(sh - ship.settling.heading) * e); ship.speed = 3 * (1 - e);
          if (k >= 1) { ship.state = 'scuttling'; ship.chargesAt = now + .4; ship.charges = 0; }
        }
      } else if (ship.state === 'scuttling') {  // 船底炸药依次起爆
        ship.speed *= Math.max(0, 1 - dt * 3);
        if (now >= ship.chargesAt) {
          const f = forward(ship.heading), offset = (ship.charges - 1) * ship.spec.length * .3;
          explosion({ x: ship.x + f.x * offset, y: 1, z: ship.z + f.z * offset }, ship.spec.flagship ? 3.4 : 2.6, true);
          explosion({ x: ship.x + f.x * offset, y: 3, z: ship.z + f.z * offset }, ship.spec.flagship ? 2.6 : 2, false);
          ship.charges++; ship.chargesAt = now + .8;
          emit({ type: 'sound', name: 'boom', position: { x: ship.x, y: 2, z: ship.z } });
          if (ship.charges >= SCUTTLE.charges) {
            ship.state = 'sinking'; ship.sinkAt = now;
            emit({ type: 'toast', text: ship.spec.flagship ? `旗舰${ship.spec.name}自沉 · 江口已被阻断` : `${ship.spec.name}自沉` , alert: Boolean(ship.spec.flagship) });
          }
        }
      } else if (ship.state === 'sinking') {
        const k = Math.min(1, (now - ship.sinkAt) / SCUTTLE.sinkSeconds), e = k * k * (3 - 2 * k);
        ship.y = -ship.spec.depth * e; ship.roll = (ship.spec.flagship ? .06 : .16) * e * (sz >= 0 ? 1 : -1); ship.pitch = .03 * e;
        if (k >= 1) sinkBlockship(ship);
      }
      if (ship.state !== 'sunk') syncBlockship(ship);
    }
    const last = blockships.at(-1);
    if (last.state === 'sunk' && now - last.sinkAt > SCUTTLE.sinkSeconds + SCUTTLE.linger) beginHold();
  }
  function skipScuttle() {
    for (const ship of blockships) if (ship.state !== 'sunk') { ship.sinkAt = now; sinkBlockship(ship, true); }
    beginHold();
  }
  function beginHold() {
    if (state.phase !== 'scuttle') return;
    state.phase = 'hold'; state.elapsed = 0; state.waveIndex = 0;
    for (const ship of ships) assignHold(ship);
    const first = shorePosts().find(alive);
    controlledId = first?.id ?? controlledId;
    if (first) { first.point.operatorId = 'player'; transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration: 1.8 }; }
    emit({ type: 'phase', phase: 'hold' });
    emit({ type: 'toast', text: `第二阶段 · 死守两岸阵地 ${Math.round(JIANGYIN_RULES.durationSeconds / 60)} 分钟：日军海陆空三路来攻`, alert: true });
  }

  // 烟源：日舰烟囱煤烟、正在下沉的舰船、开场被炸沉的宁海/平海、我方炮艇
  function smokeSources() {
    const list = [];
    for (const ship of ships) {
      if (ship.sinking === null) list.push({ object: ship.model, points: ship.model.userData.funnels ?? [], rate: 5, shade: .2, life: 10 });
      else if (now - ship.sinking < 30) list.push({ object: ship.model, points: [[0, 5, 0, ship.cfg.beam]], rate: 16, shade: .1, life: 14, rise: 3.5, grow: 2.4, fire: true });
      if (ship.sinking === null && ship.health < ship.cfg.health * .5) list.push({ object: ship.model, points: [[0, ship.cfg.height * .6, -ship.cfg.length * .15, 3]], rate: 8, shade: .09, life: 12, rise: 3, grow: 2, fire: true });
    }
    for (const post of shipPosts()) if (!post.boat.sunk) list.push(alive(post)
      ? { object: post.boat.hull, points: post.boat.hull.userData.funnels ?? [], rate: post.point.health < post.point.maxHealth * .5 ? 7 : 3, shade: post.point.health < post.point.maxHealth * .5 ? .12 : .28 }
      : { object: post.boat.hull, points: [[0, 8, -10, 6], [0, 7, 12, 5]], rate: 14, shade: .08, life: 14, rise: 3.4, grow: 2.6, fire: true });
    for (const ship of blockships) {
      if (ship.state === 'scuttling' || ship.state === 'sinking') list.push({ object: ship.model, points: [[0, 5, 0, ship.spec.beam]], rate: 18, shade: .1, life: 12, rise: 3, grow: 2.4, fire: ship.state === 'scuttling' });
      else if (ship.state !== 'sunk') list.push({ object: ship.model, points: ship.model.userData.funnels ?? [], rate: ship.speed > .5 ? 4 : 1.2, shade: .18 });
    }
    return list;
  }

  // 江面航迹：所有仍在水面上的船（日舰、登陆艇、我舰、阻塞船）
  function vessels() {
    const list = [];
    for (const ship of ships) if (ship.sinking === null) list.push({ object: ship.model, length: ship.cfg.length, beam: ship.cfg.beam });
    for (const craft of landings) if (craft.sinking === null && craft.state !== 'unloading') list.push({ object: craft.model, length: ENEMY_TYPES.landing.length, beam: ENEMY_TYPES.landing.beam });
    for (const post of shipPosts()) if (!post.boat.sunk) list.push({ object: post.boat.hull, length: post.boat.cfg.length, beam: post.boat.cfg.beam });
    for (const ship of blockships) if (ship.state !== 'sunk') list.push({ object: ship.model, length: ship.spec.length, beam: ship.spec.beam });
    return list;
  }

  // ---------- 主循环 ----------
  function step(rawDt, input = {}) {
    const dt = Math.max(0, Math.min(.05, rawDt));
    now += dt;
    world.update(now, dt, smokeSources(), camera, vessels());
    if (state.phase === 'intro') {
      advanceIntro(dt);
      for (const ship of blockships) syncBlockship(ship);
      if (input.skipIntro || state.introTime >= JIANGYIN_RULES.introSeconds) finishIntro();
      updateEffects(dt);
      return;
    }
    if (state.phase === 'naval') {
      state.navalTime += dt;
      for (const wave of dueNavalWaves(state)) for (const type of wave.ships) spawnShip(type);
      // 迟迟分不出胜负时日军持续增援驱逐舰
      if (state.navalTime > JIANGYIN_RULES.navalReinforceAfter && now >= (state.reinforceAt ?? 0)) {
        state.reinforceAt = now + 22; spawnShip('destroyer');
      }
      for (const ship of blockships) syncBlockship(ship);
    } else if (state.phase === 'scuttle') {
      if (input.skipIntro) skipScuttle(); else advanceScuttle(dt);
    } else if (state.phase === 'hold') {
      state.elapsed += dt;
      for (const wave of dueWaves(state)) {
        for (const type of wave.ships) spawnShip(type);
        for (const bank of wave.landing) spawnLanding(bank);
        for (const bank of wave.infantry) spawnSquad(bank);
        for (const bank of wave.tanks) spawnTankPlatoon(bank);
        if (wave.air) spawnAirFlight();
      }
    }
    if (activePhase()) {
      if (state.phase !== 'scuttle') {
        if (input.switchPost) switchPost(input.switchPost);
        if (input.toggleView) toggleView();
      }
      for (const post of posts) advanceEmplacement(post.point, dt, now);
      if (state.phase !== 'scuttle') controlPlayer(dt, input);
      for (const post of shipPosts()) moveBoat(post, dt);
      for (const post of posts) if (alive(post) && (post.id !== controlledId || state.phase === 'scuttle')) operateAI(post, dt);
    }
    for (const [list, advance] of [[ships, advanceShip], [landings, advanceLanding], [troops, advanceTroop]]) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (!activePhase() && list !== troops && list[i].sinking === null) { syncShip(list[i]); continue; }
        if (!activePhase() && list === troops && list[i].dead === null) continue;
        if (!advance(list[i], dt)) { scene.remove(list[i].model); list.splice(i, 1); }
      }
    }
    if (activePhase()) {
      for (let i = vehicles.length - 1; i >= 0; i--) {
        const keep = vehicles[i].type === 'tank' ? advanceTank(vehicles[i], dt) : advancePlane(vehicles[i], dt);
        if (!keep) vehicles.splice(i, 1);
      }
      advanceBombs(dt);
    }
    advanceShells(dt);
    for (const post of posts) {
      post.model.userData.update?.(); post.model.position.y = post.floor;
      if (alive(post) || post.destroyedAt !== null) continue;
      post.destroyedAt = now; post.point.operatorId = null;
      if (post.boat) {
        const f = forward(post.boat.heading);
        for (const o of [-.25, .1, .3]) explosion({ x: post.boat.x + f.x * post.boat.cfg.length * o, y: 4, z: post.boat.z + f.z * post.boat.cfg.length * o }, 2.6);
        emit({ type: 'toast', text: `${post.name}被日舰击中要害，开始下沉！`, alert: true });
      } else {
        if (post.model.userData.destroy) post.model.userData.destroy();
        else { post.model.rotation.z = .35; post.model.position.y = post.floor - .3; }
        explosion({ x: post.point.x, y: post.floor + 1, z: post.point.z }, 2);
        emit({ type: 'toast', text: `${post.name}被摧毁`, alert: true });
      }
      if (post.id === controlledId && (state.phase === 'naval' || state.phase === 'hold')) pendingAutoSwitch = now + 1.4;
    }
    for (const post of posts) if (!post.boat && post.destroyedAt !== null && now > post.smokeAt) {
      post.smokeAt = now + .5 + random() * .5;
      effect('smoke', { x: post.point.x, y: post.floor + 1.5, z: post.point.z }, 1.2, 3, 0x2f2d2a, 2.5, 2);
    }
    if (pendingAutoSwitch !== null && now >= pendingAutoSwitch && (state.phase === 'naval' || state.phase === 'hold')) {
      pendingAutoSwitch = null;
      const next = nextPostId(eligiblePosts(), controlledId, 1);
      if (next) beginTransfer(next, 'destroyed', 1.3);
    }
    // 第一阶段结束：三舰全部完全沉没 → 自沉封江
    if (state.phase === 'naval' && shipPosts().every(post => post.boat.sunk)) beginScuttle();
    updateEffects(dt);
    if (activePhase()) {
      const shoreAlive = shorePosts().filter(alive).length;
      const enemiesAlive = ships.filter(s => s.sinking === null).length + landings.filter(c => c.sinking === null && c.state !== 'empty').length +
        troops.filter(t => t.dead === null).length + vehicles.filter(v => v.health > 0).length;
      const outcome = state.phase === 'hold'
        ? evaluateOutcome({ elapsed: state.elapsed, shoreAlive, wavesRemaining: JIANGYIN_WAVES.length - state.waveIndex, enemiesAlive })
        : shoreAlive <= 0 ? { result: 'defeat', reason: 'batteries' } : null;
      if (outcome) { bombs.clear(); state.outcome = outcome; state.phase = 'ended'; emit({ type: 'ended', outcome, stats: { ...state.stats } }); }
      updateCamera(dt);
    }
  }

  function hud() {
    const post = postById(controlledId), point = post?.point;
    const cooldown = point ? emplacementCooldown(point, now) : null;
    let range = null;
    if (point && (state.phase === 'naval' || state.phase === 'hold') && !transfer) {
      const pose = postPose(post);
      range = traceRay(pose.muzzle, aimDirection(point), 3500, false)?.distance ?? null;
    }
    return {
      phase: state.phase, caption: introCaption(), outcome: state.outcome, stats: { ...state.stats },
      timeLeft: Math.max(0, JIANGYIN_RULES.durationSeconds - state.elapsed),
      wave: state.waveIndex, waves: JIANGYIN_WAVES.length,
      // 顶部三栏：随阶段变化
      top: state.phase === 'naval' ? [
        { label: '第一阶段', value: '江面决战' },
        { label: '我舰尚存', value: `${shipPosts().filter(alive).length}/3`, alert: shipPosts().some(p => !alive(p)) },
        { label: '在场日舰', value: String(ships.filter(s => s.sinking === null).length) },
      ] : state.phase === 'scuttle' ? [
        { label: '过渡', value: '自沉封江' },
        { label: '已自沉', value: `${blockships.filter(b => b.state === 'sunk').length}/${blockships.length}` },
        { label: '跳过演出', value: '空格' },
      ] : [
        { label: '剩余坚守时间', value: (s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)(Math.ceil(Math.max(0, JIANGYIN_RULES.durationSeconds - state.elapsed))) },
        { label: '敌军波次', value: `${state.waveIndex}/${JIANGYIN_WAVES.length}` },
        { label: '两岸阵地', value: `${shorePosts().filter(alive).length}/${shorePosts().length}`, alert: shorePosts().some(p => !alive(p)) },
      ],
      transferring: Boolean(transfer),
      posts: posts.map(p => ({ id: p.id, name: p.name, key: p.key, kind: p.kind, health: Math.max(0, p.point.health),
        maxHealth: p.point.maxHealth, controlled: p.id === controlledId, eligible: eligiblePosts().includes(p) })),
      weapon: point ? { name: point.weapon.settings.name,
        ammo: point.weapon.ammo, reserve: point.weapon.reserve, cooldown, cannon: point.weapon.settings.type === 'field-gun',
        heat: point.heat, ship: Boolean(post.boat), speed: post.boat?.speed ?? 0 } : null,
      range, viewMode,
    };
  }
  function radar() {
    return {
      posts: posts.filter(p => !p.boat).map(p => ({ x: p.point.x, z: p.point.z, alive: alive(p), controlled: p.id === controlledId, yaw: p.point.yaw })),
      ships: ships.filter(s => s.sinking === null).map(s => ({ x: s.x, z: s.z, heading: s.heading, big: s.type !== 'gunboat' })),
      ourShips: shipPosts().filter(p => !p.boat.sunk).map(p => ({ x: p.boat.x, z: p.boat.z, heading: p.boat.heading, alive: alive(p), controlled: p.id === controlledId })),
      blockships: blockships.map(b => ({ x: b.x, z: b.z, heading: b.heading, length: b.spec.length, sunk: b.state === 'sunk', flagship: Boolean(b.spec.flagship) })),
      barrier: wreckZones.map(z => ({ ...z })),
      landings: landings.filter(c => c.sinking === null).map(c => ({ x: c.x, z: c.z })),
      troops: troops.filter(t => t.dead === null).map(t => ({ x: t.x, z: t.z })),
      tanks: liveTanks().map(v => ({ x: v.position.x, z: v.position.z, heading: v.heading })),
      planes: livePlanes().map(v => ({ x: v.position.x, z: v.position.z, heading: v.heading })),
    };
  }

  return { state, step, hud, radar, switchPost, toggleView, vehicles, get viewMode() { return viewMode; }, posts, ships, landings, troops,
    blockships, wreckZones, get controlledId() { return controlledId; }, get now() { return now; },
    skipIntro() { if (state.phase === 'intro') finishIntro(); }, skipScuttle() { if (state.phase === 'scuttle') skipScuttle(); } };
}
