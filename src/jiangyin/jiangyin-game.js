// 江阴要塞阻击战 · 战斗模拟（与 DOM 解耦：输入通过 step(dt, input) 传入，可在 node 中无渲染运行）
import * as THREE from 'three';
import { createEmplacement, emplacementLook, emplacementPose, aimEmplacement, emplacementCanAimAt,
  fireEmplacement, advanceEmplacement, damageEmplacement, emplacementCooldown } from '../emplacements.js';
import { JIANGYIN_RULES, JIANGYIN_WAVES, JIANGYIN_POSTS, JIANGYIN_PROFILE_OVERRIDES, JIANGYIN_MOUNTS, ENEMY_TYPES,
  postFacing, groundHeight, naturalGroundHeight, insideWreck, RIVER_HALF, shipRoute, landingPoint, createJiangyinState, dueWaves, dueNavalWaves,
  evaluateOutcome, nextPostId, jiangyinSquadLoadout, LANDING_STREAM, NAVAL_RAMP, navalTarget, SHIP_AA, LAND_SPAWNS, AIR_SPAWN, riverCenter, BLOCKSHIPS, blockshipZone, NAVAL_WAVES, JIANGYIN_SQUAD,
  jiangyinRoads, roadRoute } from './jiangyin-rules.js';
// 复用项目现有的步枪/轻机枪状态机（弹匣、拉栓、换弹时间与主游戏一致）
import { createRifleState, shootRifle, advanceRifle, reloadRifle, infantryWeaponProfile, rifleReloadSeconds } from '../rifle-action.js';
// 复用项目现有的九七式中战车规则（车体尺寸、炮口/机枪位姿、射程与装填）
import { CHI_HA, CHI_HA_MG, chiHaMuzzle, chiHaMachineGunPose } from '../chi-ha.js';
import { createWarshipModel, createLandingCraftModel, createInfantryModel,
  createCruiserModel, createBlockshipModel, updateFlags, maximEye } from './jiangyin-models.js';
import { createJiangyinWorld } from './jiangyin-world.js';
import { terrainStep } from '../terrain-gait.js';
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
    const post = { id: spec.id, name: spec.name, key: spec.key, holdKey: spec.holdKey ?? '', kind: spec.kind, bank: spec.bank, point, model, floor,
      aiNextShot: 2 + random() * 4, burstUntil: 0, pauseUntil: 0, destroyedAt: null, smokeAt: 0, boat: null };
    if (hull) {
      scene.add(hull);
      post.boat = { x: spec.x, z: spec.z, heading: spec.heading, speed: 3, hull, sinking: 0, sunk: false, deck: floor,
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
    boat.hull.rotation.set(-k * .1, boat.heading, boat.roll * Math.min(.45, k * .9) + (boat.heel ?? 0) * (1 - k), 'YXZ');   // 回转外倾
    post.floor = boat.deck - depth - k * 2;
    post.model.visible = !boat.sunk;   // 炮塔随舰体一起倾斜下沉（见 attachToHull），直到完全没入水中
    const wake = boat.hull.userData.wake;
    if (wake) for (const mesh of wake) mesh.visible = Math.abs(boat.speed) > .8 && k === 0;
  }
  // 艏炮塔固定在舰体上：位置与姿态取自舰体（含横倾、艏倾与下沉），炮塔自身只保留回旋与俯仰
  const hullAnchor = new THREE.Vector3();
  function attachToHull(post) {
    const { boat, model } = post;
    boat.hull.updateMatrixWorld(true);
    hullAnchor.set(0, boat.deck + .2, -boat.gunOffset).applyMatrix4(boat.hull.matrixWorld);
    model.position.copy(hullAnchor); model.quaternion.copy(boat.hull.quaternion);
    model.updateMatrixWorld(true);
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
  let laneCursor = 0;
  function spawnShip(type, early = false) {
    // 同批舰艇轮流占用北、中、南三条航道并列冲出弯道（而不是排成一列鱼贯而出）
    const cfg = ENEMY_TYPES[type], lane = [0, -320, 320, -160, 160][laneCursor++ % 5] + (random() - .5) * 60;
    const route = shipRoute(lane), model = createWarshipModel(type);
    // 实舰尺度下同批入场的舰艇按舰长错开，避免在弯道后方重叠
    const startX = Math.max(route[0].x + random() * 20, ...ships.filter(other => other.sinking === null && other.x > route[0].x - 600 && Math.abs((other.lane ?? 0) - lane) < 150)
      .map(other => other.x + (other.cfg.length + cfg.length) / 2 + 18));
    // early：开场第一批直接从弯道出口附近出发，约 15 秒后进入视野，玩家不用干等
    const ship = { id: `ship-${++serial}`, type, cfg, x: early ? startX - 250 : startX, z: early ? route[1].z : route[0].z, heading: Math.PI / 2, lane,
      health: cfg.health, route, wp: early ? 2 : 1, model, nextFire: now + 4 + random() * 3, sinking: null, speed: cfg.speed * .8 };
    assignHold(ship);
    const roster = cfg.ships ?? [], index = (shipSerial[type] = (shipSerial[type] ?? -1) + 1);
    ship.label = roster.length ? `${cfg.name}「${roster[index % roster.length]}」` : cfg.name;
    scene.add(model); ships.push(ship); syncShip(ship);
    emit({ type: 'toast', text: `${ship.label}自下游驶出弯道，逆流而上`, voice: 'jiangyin-enemy-ships' });
  }
  // 第一阶段拖得越久，日舰火力越集中（每多 1 分钟伤害 +100%），保证江面决战在约 3–5 分钟内分出结果
  const navalPressure = () => state.phase === 'naval' ? 1 + Math.max(0, state.navalTime - JIANGYIN_RULES.navalReinforceAfter) / 60 : 1;
  // 敌舰停泊炮击位置：第一阶段停在阻塞船锚地下游与我舰对射；封江后逼近阻塞线下游侧炮击两岸阵地
  // 第二阶段：每艘日舰选定一座岸防阵地，驶到它的正前方江面（距炮台约 450–700 米，堵塞线下游侧）抵近炮击
  function assignHold(ship) {
    if (state.phase === 'naval' || state.phase === 'intro') {
      ship.holdX = 580 + random() * 180; ship.holdZ = Math.max(-420, Math.min(420, ship.lane ?? 0)); ship.holdPost = null; return;
    }
    const shore = shorePosts().filter(post => alive(post) && post.point.weapon.settings.mount !== 'nest');
    const lead = deployed ? controlledMember() : null;
    const pick = shore.length ? (lead && random() < .5 ? shore.sort((a, b) => Math.hypot(a.point.x - lead.x, a.point.z - lead.z) - Math.hypot(b.point.x - lead.x, b.point.z - lead.z))[0]
      : shore[Math.floor(random() * shore.length)]) : null;
    ship.holdPost = pick?.id ?? null;
    const side = pick ? Math.sign(pick.point.z) : 0;
    ship.holdX = Math.max(90, (pick?.point.x ?? 300) + 120 + random() * 200);   // 不能越过堵塞线（x≈0）
    ship.holdZ = side * (RIVER_HALF - 305 - random() * 140);   // v19 阵地移近江边 45 米，停泊线同步后退，保持原来的 450–700 米交战距离
  }
  // 日舰有效交战距离（游戏压缩值）：实际舰炮射程可达十余公里，但本关地图只有约 3 公里，
  // 为了让玩家看得见是谁在开炮，日舰只在 1.4 公里（第一阶段）/ 1.2 公里（第二阶段）以内开火
  const ENGAGE_RANGE = { naval: 1400, hold: 1200 };
  function spawnLanding(bank) {
    const target = landingPoint(bank, random), model = createLandingCraftModel();
    const x0 = 1360 + random() * 40;   // 自弯道出口出发
    // 驶出弯道后直接斜插向本岸滩头（途经滩头下游约 250 米、离岸约 180 米处，船首对准滩头冲滩）
    const sign = bank === 'south' ? 1 : -1;
    const via = [{ x: target.x + 250 + random() * 80, z: sign * (RIVER_HALF - 160 - random() * 60) }];
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
      // 修正：原来写成 z = ±73 米（江面缩放到 1.5 公里宽之前的旧滩头坐标），登陆步兵被放进江心深水里，半天走不上岸。
      // 现在在登陆艇跳板前方的滩头下船（沿离岸方向 6–9 米）
      const model = makeSoldier('enemy', i === 0 ? 'type11' : 'rifle'), x = craft.x + (i - 2) * 1.6;
      let z = craft.z + sign * (6 + random() * 3);
      for (let k = 0; k < 20 && groundHeight(x, z) < .4; k++) z += sign * 2;   // 确保落在岸上
      const soldier = { id: `troop-${++serial}`, bank: craft.bank, x, z, health: cfg.health, model, nextAttack: 0,
        offset: (i - 2) * 1.8, dead: null, focus: random() < .6 };
      model.position.set(x, groundHeight(x, z), z); scene.add(model); troops.push(soldier);
    }
    emit({ type: 'toast', text: craft.bank === 'south' ? '日军在南岸滩头登陆！' : '日军在北岸滩头登陆！', voice: `jiangyin-landing-${craft.bank}` });
  }

  // ---------- 陆路步兵小队 / 坦克小队 / 航空小队（敌军自下游两岸与空中出发） ----------
  // escort：与坦克小队一起出发的伴随步兵（步坦协同），出现在坦克纵队后方的公路两侧，跟着坦克推进
  // 日军步兵小队与其他地图一致：小队全灭后 17 秒（BATTLE_RULES.respawnSeconds）在下游出发点重新集结，第二阶段持续补充
  const ENEMY_SQUAD_RESPAWN = 17, ENEMY_TROOP_CAP = 48;
  const enemySquads = [];
  function spawnSquad(bank, escort = null) {
    const spawn = escort ? escort.spawn : LAND_SPAWNS[bank], cfg = ENEMY_TYPES.infantry;
    const record = { bank, troops: [], respawnAt: null };
    enemySquads.push(record);
    for (let i = 0; i < ENEMY_TYPES.squad.size; i++) {
      const x = spawn.x + (i % 4) * 2.2 + random() + (escort ? escort.side.x * ((i % 2) * 2 - 1) * 5 : 0),
        z = spawn.z + Math.floor(i / 4) * 2.4 + random() + (escort ? escort.side.z * ((i % 2) * 2 - 1) * 5 : 0);
      const model = makeSoldier('enemy', i === 0 ? 'type11' : 'rifle');
      model.position.set(x, groundHeight(x, z), z); scene.add(model);
      troops.push({ id: `troop-${++serial}`, bank, x, z, health: cfg.health, model, nextAttack: 0,
        offset: (i - 5.5) * 1.6, dead: null, walk: random() * 6, land: true, focus: random() < .6,
        escortOf: escort ? escort.tanks[i % escort.tanks.length].id : null, escortSlot: i });
      record.troops.push(troops.at(-1));
    }
    if (!escort) emit({ type: 'toast', text: `${ENEMY_TYPES.squad.name}自${bank === 'south' ? '南' : '北'}岸下游陆路来袭`, alert: true, voice: 'jiangyin-infantry' });
  }
  // 坦克：已从下游滩头上岸，沿军用公路纵队开上山（车距约 25 米），到射程内停车射击
  // 登陆艇持续输送（第二阶段）
  function advanceLandingStream() {
    if (state.phase !== 'hold' || now < (state.landingAt ?? 0)) return;
    const active = landings.filter(craft => craft.sinking === null && craft.state !== 'empty').length;
    state.landingAt = now + (active >= LANDING_STREAM.maxActive ? 3 : LANDING_STREAM.interval);
    if (active >= LANDING_STREAM.maxActive || troops.filter(t => t.dead === null).length > ENEMY_TROOP_CAP - ENEMY_TYPES.landing.troops) return;
    spawnLanding(LANDING_STREAM.pattern[(state.landingIndex = (state.landingIndex ?? -1) + 1) % LANDING_STREAM.pattern.length]);
  }
  function advanceEnemySquads() {
    if (state.phase !== 'hold') return;
    for (let i = enemySquads.length - 1; i >= 0; i--) {
      const squadRecord = enemySquads[i];
      if (squadRecord.troops.some(t => t.dead === null)) continue;
      squadRecord.respawnAt ??= now + ENEMY_SQUAD_RESPAWN;
      if (now < squadRecord.respawnAt) continue;
      if (troops.filter(t => t.dead === null).length > ENEMY_TROOP_CAP - ENEMY_TYPES.squad.size) { squadRecord.respawnAt = now + 4; continue; }
      enemySquads.splice(i, 1);
      spawnSquad(squadRecord.bank);
    }
  }
  function spawnTankPlatoon(bank) {
    const road = jiangyinRoads().find(r => r.bank === bank);
    // 坦克出发点：沿公路从滩头往上，取第一个离本岸最近阵地约 260 米的路段（阵地移近江边后，固定里程会让坦克一出现就贴脸）
    const bankPosts = posts.filter(p => !p.boat && p.bank === bank);
    let startIndex = road.points.findIndex(([x, z]) => Math.min(...bankPosts.map(p => Math.hypot(p.point.x - x, p.point.z - z))) < 260);
    if (startIndex < 0) startIndex = road.lengths.findIndex(l => l >= (ENEMY_TYPES.tank.roadStart ?? 600));
    const startS = Math.max(ENEMY_TYPES.tank.platoon * 25 + 20, road.lengths[Math.max(0, startIndex)]);
    for (let i = 0; i < ENEMY_TYPES.tank.platoon; i++) {
      const s0 = Math.max(0, startS - i * 25);
      const index = Math.max(0, road.lengths.findIndex(l => l >= s0)), [x, z] = road.points[index], [x2, z2] = road.points[Math.min(index + 2, road.points.length - 1)];
      const heading = Math.atan2(-(x2 - x), -(z2 - z));
      vehicles.push({ id: `tank-${++serial}`, type: 'tank', variant: CHI_HA.id, team: 'enemy', bank, roadIndex: index,
        position: new THREE.Vector3(x, groundHeight(x, z), z), heading, pitch: 0, roll: 0,
        turretYaw: Math.PI / 2, turretPitch: 0, trackDistance: 0, health: CHI_HA.health, maxHealth: CHI_HA.health,
        machineGuns: [{ mount: 'hull', yaw: 0, pitch: 0 }, { mount: 'rear', yaw: 0, pitch: 0 }],
        nextShot: now + 3 + random() * 2, nextBurst: now + 2, destroyedAt: null });
    }
    emit({ type: 'toast', text: `日军坦克小队（${ENEMY_TYPES.tank.platoon}辆九七式中战车）带着伴随步兵沿${bank === 'south' ? '南' : '北'}岸公路开上山来`, alert: true, voice: 'jiangyin-tanks' });
    // 伴随步兵：一个步兵小队跟在坦克纵队后方约 20 米、分列公路两侧
    const tanks = vehicles.slice(-ENEMY_TYPES.tank.platoon);
    const tail = Math.max(0, Math.min(road.points.length - 1, road.lengths.findIndex(l => l >= Math.max(0, startS - ENEMY_TYPES.tank.platoon * 25 - 15))));
    const [tx, tz] = road.points[tail], [nx, nz] = road.points[Math.min(tail + 1, road.points.length - 1)], l = Math.hypot(nx - tx, nz - tz) || 1;
    spawnSquad(bank, { tanks, spawn: { x: tx, z: tz }, side: { x: -(nz - tz) / l, z: (nx - tx) / l } });
  }
  // 离指定点最近、且属于本阶段的我方阵位（第一阶段是我舰，第二阶段是两岸阵地）
  const nearestEligible = (x, z) => eligiblePosts().filter(alive)
    .sort((a, b) => Math.hypot(a.point.x - x, a.point.z - z) - Math.hypot(b.point.x - x, b.point.z - z))[0] ?? null;
  function spawnAirFlight() {
    const entry = nearestEligible(AIR_SPAWN.x, AIR_SPAWN.z) ?? nearestPost(AIR_SPAWN.x, AIR_SPAWN.z);
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
    emit({ type: 'toast', text: `日军航空小队（${ENEMY_TYPES.aircraft.flight}架）来袭！`, alert: true, voice: 'jiangyin-air-raid' });
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
    // 坦克压向玩家所在的阵地（玩家在同岸时），开到约 45 米处才停车，行进间射击
    const lead = deployed ? controlledMember() : null;
    const onBank = lead && lead.dead === null && Math.sign(lead.z) === Math.sign(tank.position.z);
    const target = onBank ? nearestPost(lead.x, lead.z, tank.bank) ?? nearestPost(tank.position.x, tank.position.z, tank.bank)
      : nearestPost(tank.position.x, tank.position.z, tank.bank);
    if (!target) return true;
    const dx = target.point.x - tank.position.x, dz = target.point.z - tank.position.z, distance = Math.hypot(dx, dz);
    const desired = Math.atan2(-dx, -dz);
    const standoff = 45;
    // 沿公路行驶：目标为前方约 14 米的路面点；离目标阵位进入射程或公路已到尽头时离开公路
    const road = jiangyinRoads().find(r => r.bank === tank.bank);
    let drive = desired;
    if (road && tank.roadIndex !== undefined && tank.roadIndex !== null && distance > standoff) {
      let best = tank.roadIndex, bd = Infinity;
      for (let i = tank.roadIndex; i < Math.min(road.points.length, tank.roadIndex + 12); i++) {
        const d = Math.hypot(road.points[i][0] - tank.position.x, road.points[i][1] - tank.position.z); if (d < bd) { bd = d; best = i; } }
      tank.roadIndex = best;
      const ahead = road.points[Math.min(road.points.length - 1, best + 6)];   // 看得更远，过弯不再左右摆头
      drive = Math.atan2(-(ahead[0] - tank.position.x), -(ahead[1] - tank.position.z));
      if (best >= road.points.length - 2 || distance < CHI_HA.range * 1.1) tank.roadIndex = null;
      // 公路在山腰盘绕：离目标 260 米内、直线地形可以开过去（坡度不大、不过江）时直接下路冲向目标
      else if (distance < 260 && now >= (tank.shortcutCheck ?? 0)) {
        tank.shortcutCheck = now + 2;
        let ok = true, prev = groundHeight(tank.position.x, tank.position.z);
        for (let k = 1; k <= 26 && ok; k++) {
          const px = tank.position.x + dx * k / 26, pz = tank.position.z + dz * k / 26, h = groundHeight(px, pz);
          if (h < 1.5 || Math.abs(h - prev) / (distance / 26) > .42) ok = false; prev = h;
        }
        if (ok) tank.roadIndex = null;
      }
    }
    // 步坦协同：坦克不甩开伴随步兵。最近的伴随步兵落后 30 米以上时减速，落后 45 米以上时停车等候（边等边射击）；
    // 伴随步兵全部阵亡后坦克才单独冲击
    let pace = 1;
    const escorts = troops.filter(t => t.dead === null && t.escortOf === tank.id);
    if (escorts.length) {
      const gap = Math.min(...escorts.map(t => Math.hypot(t.x - tank.position.x, t.z - tank.position.z)));
      pace = gap > 45 ? 0 : gap > 30 ? .5 : 1;
    }
    tank.waiting = pace === 0;
    if (distance > standoff && pace > 0) {
      tank.heading = wrap(tank.heading + Math.max(-CHI_HA.turnRate * dt, Math.min(CHI_HA.turnRate * dt, wrap(drive - tank.heading))));
      const f = forward(tank.heading), step = CHI_HA.speed * pace * (tank.roadIndex !== null && tank.roadIndex !== undefined ? 1.3 : 1) * dt;   // 公路上开得快些
      const nx = tank.position.x + f.x * step, nz = tank.position.z + f.z * step;
      const climb = Math.abs(groundHeight(nx, nz) - groundHeight(tank.position.x, tank.position.z)) / Math.max(step, 1e-6);
      if (groundHeight(nx, nz) > 1.5 && climb < .9) {
        tank.position.x = nx; tank.position.z = nz; tank.trackDistance += step;
      } else tank.heading = wrap(tank.heading + dt * .8);              // 遇到陡坡或江水时转向绕行
    }
    // 车体贴合山坡：按前后、左右履带接地点的地面高度求俯仰与侧倾（平滑过渡），车体高度取四个接地点的平均——不再“腾空”
    {
      const f = forward(tank.heading), r = { x: -f.z, z: f.x }, hl = CHI_HA.length * .42, hw = CHI_HA.width * .42;
      const at = (a, b) => groundHeight(tank.position.x + f.x * a + r.x * b, tank.position.z + f.z * a + r.z * b);
      const fl = at(hl, -hw), fr = at(hl, hw), bl = at(-hl, -hw), br = at(-hl, hw);
      const pitch = Math.atan2((fl + fr) / 2 - (bl + br) / 2, hl * 2), roll = Math.atan2((fr + br) / 2 - (fl + bl) / 2, hw * 2);
      const k = Math.min(1, dt * 6);
      tank.groundPitch = (tank.groundPitch ?? pitch) + (pitch - (tank.groundPitch ?? pitch)) * k;
      tank.groundRoll = (tank.groundRoll ?? roll) + (roll - (tank.groundRoll ?? roll)) * k;
      tank.position.y = Math.max((fl + fr + bl + br) / 4, groundHeight(tank.position.x, tank.position.z) - .15);
    }
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
      shells.at(-1).cause = 'tank-shell';
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
      if (Math.abs(wrap(desired - pose.yaw)) < .2) { damageEmplacement(target.point, CHI_HA_MG.damage * .25, { team: 'enemy' }, now); postHurt(target, tank.position, 'tank-mg'); }
      // 同时扫射车前方的我军步兵
      for (const m of squad) if (m.dead === null && !m.postId) {
        const d = Math.hypot(m.x - tank.position.x, m.z - tank.position.z);
        if (d < CHI_HA_MG.range * 1.6 && Math.abs(wrap(Math.atan2(-(m.x - tank.position.x), -(m.z - tank.position.z)) - tank.heading)) < CHI_HA_MG.traverse + .2 &&
          random() < .35 * (1 - d / (CHI_HA_MG.range * 2)) * (m.crouch ? .6 : 1) &&
          canSee({ x: tank.position.x, y: tank.position.y + 1.6, z: tank.position.z }, chest(m))) {
          damageMember(m, CHI_HA_MG.damage * .6, 'tank-mg', { x: tank.position.x, z: tank.position.z }); break; }
      }
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
    if (patrol && (!alive(patrol) || !eligiblePosts().includes(patrol))) {
      patrol = nearestEligible(plane.position.x, plane.position.z) ?? nearestPost(plane.position.x, plane.position.z);
      if (patrol) plane.patrolPostId = patrol.id;
    }
    const targets = eligiblePosts().filter(post => alive(post) && post.point.operatorId)
      .map(post => ({ id: post.id, unitId: post.point.operatorId === 'player' ? post.point.operatorId : post.id,
        team: 'friendly', health: post.point.health, post, position: { x: post.point.x, y: post.floor, z: post.point.z } }));
    const infantry = liveMembers().filter(member => !member.postId)
      .map(member => ({ id: member.id, unitId: 'player', team: 'friendly', health: member.health, member,
        position: { x: member.x, y: member.y, z: member.z } }));
    targets.push(...infantry);
    const visible = (from, to) => !airTerrainHit(from, to);
    const previous = plane.position.clone();
    // 共享的 aircraft-ai 按“约 40 米绝对高度”盘旋，适合平地地图；江阴阵地在 60–100 米高的山顶，
    // 因此以所巡逻阵地的地面高度为基准换算到相对坐标再交给共享 AI，算完换回（飞机在山顶上空 40 米左右盘旋俯冲）。
    const base = state.phase === 'naval' ? 0 : Math.max(0, (patrol?.floor ?? 0) - 6);
    const lift = point => ({ ...point, y: point.y + base });
    plane.position.y -= base;
    const relTargets = targets.map(t => ({ ...t, position: { ...t.position, y: t.position.y - base } }));
    let shot;
    try {
      shot = advanceAircraftAI(plane, dt, now, { targets: relTargets, canFire: true, visible: (from, to) => visible(lift(from), lift(to)),
        groundHeight: (x, z) => surfaceHeight(x, z) - base, patrolCenter: patrol?.point ?? plane.position, preferredUnitId: 'player' });
    } finally { plane.position.y += base; }
    if (shot) { shot.start = lift(shot.start); shot.aim = lift(shot.aim); }
    plane.velocity.copy(plane.position).sub(previous).multiplyScalar(1 / dt);
    if (shot) {
      const yaw = plane.heading + (random() * 2 - 1) * AIRCRAFT_GUN.spread;
      const pitch = plane.pitch + (random() * 2 - 1) * AIRCRAFT_GUN.spread;
      const dir = aimDirection({ yaw, pitch });
      let nearest = null, distance = rayTerrain(shot.start, dir, AIRCRAFT_GUN.range) ?? AIRCRAFT_GUN.range;
      for (const target of targets) {
        const hit = raySphere({ ...target.position, y: target.position.y + (target.post ? 1.2 : 1) },
          target.post ? 1.2 : .55, shot.start, dir, distance);
        if (hit !== null && hit < distance) { nearest = target; distance = hit; }
      }
      if (nearest?.post) { damageEmplacement(nearest.post.point, TYPES.plane.damage, { team: 'enemy' }, now); postHurt(nearest.post, shot.start, 'plane-mg'); }
      else if (nearest?.member) damageMember(nearest.member, TYPES.plane.damage, 'plane-mg', shot.start);
      effects?.muzzle?.(shot.start, dir);
      emit({ type: 'sound', name: 'mg', position: shot.start });
    }
    // 第一阶段俯冲轰炸我舰：把每艘舰的甲板沿舰长取 5 个点交给共享投弹规则（一艘舰即一个“聚集目标”），单机仍只有一枚航弹
    const bombTargets = state.phase === 'naval' ? shipPosts().filter(post => alive(post) && !post.boat.sunk).flatMap(post => {
      const f = forward(post.boat.heading);
      return [-8, -4, 0, 4, 8].map(o => ({ health: post.point.health, position: { x: post.boat.x + f.x * o, y: post.floor - 2, z: post.boat.z + f.z * o } }));
    }) : infantry;
    const end = bombs.drop(plane, now, bombTargets, { allowed: () => true, visible, groundHeight: surfaceHeight,
      source: () => ({ team: 'enemy' }) });
    const player = controlledMember() ?? postById(controlledId)?.point;
    if (end && player && Math.hypot(end.x - player.x, end.z - player.z) < 40)
      emit({ type: 'toast', text: '敌机投弹！寻找掩护', alert: true, voice: 'jiangyin-bomb' });
    return true;
  }
  function advanceBombs(dt) {
    bombs.update(dt, airTerrainHit, (point, source) => {
      blast(point, AIR_BOMB.radius, AIR_BOMB.damage, source.team, false, 'bomb');
      const water = groundHeight(point.x, point.z) < 0;
      if (water) { waterBurst(point, 1.8); emit({ type: 'sound', name: 'boom', position: point, heavy: true }); }   // 近失弹：巨大水柱
      else if (effects) {
        // 与仓库提交 7ce51ff 一致：落在地面的航弹传入 soil 表面，由共享 combat-effects 生成扬尘、焦痕与逐渐消散的灰黑烟（bomb-aftermath.js）
        effects.explosion(point, AIR_BOMB.radius, 'aircraft-bomb', { kind: 'soil', normal: { x: 0, y: 1, z: 0 } });
        emit({ type: 'sound', name: 'boom', position: point, heavy: true });
      } else explosion(point, 5, false);
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
  function explosion(position, size = 1, water = false, impactStyle = null, surfaceOverride = null) {
    if (water) world.puff?.({ x: position.x, y: 2, z: position.z }, { count: 6, radius: 3 * size, shade: .68, life: 5, rise: 1.2, grow: 2.2 });
    else world.puff?.({ x: position.x, y: position.y + 1, z: position.z }, { count: 8, radius: 1.6 * size, shade: .48, life: 8, rise: 1.6, grow: 1.8 * size });
    if (water) waterBurst(position, size);
    else if (effects) {
      const surface = surfaceOverride ?? (groundHeight(position.x, position.z) >= 0
        ? { kind: 'soil', normal: { x: 0, y: 1, z: 0 } } : undefined);
      effects.explosion(position, 3 + size * 3,
        impactStyle ?? (size >= 2 ? 'explosive-pack' : size >= 1 ? 'mortar' : 'grenade'), surface);
    } else {
      effect('flash', position, 2.2 * size, .25, 0xffb050, 0, 2.5);
      effect('smoke', { x: position.x, y: position.y + 1, z: position.z }, 2 * size, 3.5, 0x4a4743, 2.4, 2.2);
    }
    emit({ type: 'sound', name: water ? 'splash' : 'boom', position });
  }
  // ---------- 炮弹落水：弹体入水后在浅水处爆炸，掀起白色水柱（主柱 + 侧向喷射 + 水滴 + 泡沫圈 + 水雾） ----------
  // size≈1 对应 15 厘米级炮弹（水柱约 25 米），航弹约 1.8
  const burstGeometry = {
    column: (() => { const g = new THREE.CylinderGeometry(.18, 1, 1, 18, 8, true); g.translate(0, .5, 0);
      const p = g.attributes.position;   // 柱面加入起伏，避免规则圆柱
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
        const k = 1 + .28 * Math.sin(a * 5 + y * 7) * y + .12 * Math.sin(a * 11 - y * 3);
        p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
      g.computeVertexNormals(); return g; })(),
    jet: (() => { const g = new THREE.ConeGeometry(.5, 1, 7, 1, true); g.translate(0, .5, 0); return g; })(),
    ring: (() => { const g = new THREE.RingGeometry(.75, 1, 40, 1); g.rotateX(-Math.PI / 2); return g; })(),
    foam: (() => { const g = new THREE.CircleGeometry(1, 32); g.rotateX(-Math.PI / 2); return g; })(),
  };
  const waterMaterial = opacity => new THREE.MeshBasicMaterial({ color: 0xf1f4f2, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const bursts = [];
  const DROPS = 90;
  function waterBurst(position, size = 1) {
    if (bursts.length > 14) { const old = bursts.shift(); scene.remove(old.group); old.drops.geometry.dispose(); }
    const group = new THREE.Group(); group.position.set(position.x, 0, position.z); scene.add(group);
    const height = 24 * size, width = 2.8 * size;
    const parts = [];
    for (let k = 0; k < 3; k++) {   // 三层主柱：内层高而细，外层矮而粗
      const mesh = new THREE.Mesh(burstGeometry.column, waterMaterial(.82 - k * .18));
      mesh.rotation.y = random() * TAU; group.add(mesh);
      parts.push({ mesh, kind: 'column', h: height * (1 - k * .22) * (.85 + random() * .3), w: width * (1 + k * .55), delay: k * .05 });
    }
    for (let k = 0; k < 9; k++) {   // 侧向斜喷的水束
      const mesh = new THREE.Mesh(burstGeometry.jet, waterMaterial(.6)); const a = random() * TAU, tilt = .25 + random() * .5;
      mesh.rotation.set(Math.cos(a) * tilt, 0, Math.sin(a) * tilt); group.add(mesh);
      parts.push({ mesh, kind: 'jet', h: height * (.35 + random() * .35), w: width * (.25 + random() * .2), delay: random() * .08 });
    }
    const ring = new THREE.Mesh(burstGeometry.ring, waterMaterial(.7)); ring.position.y = .15; group.add(ring);
    const foam = new THREE.Mesh(burstGeometry.foam, waterMaterial(.55)); foam.position.y = .12; group.add(foam);
    parts.push({ mesh: ring, kind: 'ring', w: width }, { mesh: foam, kind: 'foam', w: width });
    // 水滴：沿抛物线飞散、落回江面
    const positions = new Float32Array(DROPS * 3), velocity = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      const a = random() * TAU, out = (1 + random() * 5) * Math.sqrt(size), up = (12 + random() * 16) * Math.sqrt(size);
      velocity.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      positions.set([Math.cos(a) * width * .4, height * .2 * random(), Math.sin(a) * width * .4], i * 3);
    }
    const dropsGeometry = new THREE.BufferGeometry(); dropsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const drops = new THREE.Points(dropsGeometry, new THREE.PointsMaterial({ color: 0xe9eeee, size: .45 * Math.sqrt(size), transparent: true, opacity: .9, depthWrite: false }));
    group.add(drops);
    bursts.push({ group, parts, drops, velocity, t: 0, size });
    world.puff?.({ x: position.x, y: height * .45, z: position.z }, { count: 7, radius: 2.6 * size, shade: .86, life: 6, rise: .4, grow: 2.4 });
  }
  function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.t += dt;
      const life = 3.2 + b.size;
      if (b.t > life + 4) { scene.remove(b.group); b.drops.geometry.dispose(); bursts.splice(i, 1); continue; }
      for (const part of b.parts) {
        const t = Math.max(0, b.t - (part.delay ?? 0));
        if (part.kind === 'column' || part.kind === 'jet') {
          const rise = Math.min(1, t / .55), fall = Math.max(0, (t - .9) / (life - .9));   // 0.5 秒冲高，随后塌落
          const k = rise * rise * (3 - 2 * rise) * (1 - fall * fall);
          part.mesh.scale.set(part.w * (1 + fall * 1.6), Math.max(.01, part.h * k), part.w * (1 + fall * 1.6));
          part.mesh.material.opacity = (part.kind === 'column' ? .8 : .6) * (1 - fall) * Math.min(1, t * 8);
          part.mesh.visible = fall < 1;
        } else if (part.kind === 'ring') {
          const k = Math.min(1, b.t / 2.2); part.mesh.scale.setScalar(part.w * (1 + k * 4));
          part.mesh.material.opacity = .7 * (1 - k);
        } else {
          const k = Math.min(1, b.t / (life + 4)); part.mesh.scale.setScalar(part.w * (1.2 + k * 2.4));
          part.mesh.material.opacity = .5 * (1 - k);
        }
      }
      const p = b.drops.geometry.attributes.position;
      for (let j = 0; j < DROPS; j++) {
        if (p.getY(j) < -.5) continue;
        b.velocity[j * 3 + 1] -= GRAVITY * dt;
        p.setXYZ(j, p.getX(j) + b.velocity[j * 3] * dt, p.getY(j) + b.velocity[j * 3 + 1] * dt, p.getZ(j) + b.velocity[j * 3 + 2] * dt);
      }
      p.needsUpdate = true;
      b.drops.material.opacity = .9 * Math.max(0, 1 - b.t / (life + 1));
    }
  }
  function updateEffects(dt) {
    updateBursts(dt);
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
  // 视线：从 from（射手眼高）到 to（目标胸口）之间没有山体遮挡。日军步枪、坦克机枪、舰艇机枪只能打看得见的目标
  function canSee(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz) || 1;
    const hit = rayTerrain(from, { x: dx / len, y: dy / len, z: dz / len }, len - 1.5);
    return hit === null;
  }
  const chest = m => ({ x: m.x, y: m.y + (m.crouch ? .9 : 1.3), z: m.z });
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
      if (vehicle.health <= 0 && vehicle.type !== 'tank') continue;
      const tank = vehicle.type === 'tank';
      const center = { x: vehicle.position.x, y: vehicle.position.y + (tank ? 1.1 : 0), z: vehicle.position.z };
      const t = raySphere(center, tank ? 2.4 : ENEMY_TYPES.aircraft.radius, origin, dir, Math.min(best.distance, maxDistance));
      if (t !== null && t < best.distance) best = { distance: t, target: vehicle, kind: vehicle.type };
    }
    return best.distance === Infinity ? null : best;
  }

  // ---------- 伤害 ----------
  // 炮弹命中舰船：远处也看得清的爆炸——白热闪光 + 橙红火球 + 飞溅的碎片火星 + 冲天黑烟；命中点留下持续燃烧的火头（最多 4 处），
  // 舰体越残破火越大、烟越浓。与落空时江面上的白色水柱一眼可分。
  // 88 毫米高射炮弹打船：登陆艇照常；炮舰、驱逐舰只能打坏上层建筑（伤害减半）；装甲巡洋舰基本打不穿（约四分之一）
  const vesselFactor = (shell, vessel) => !shell.flak || !vessel.cfg ? 1 : vessel.type === 'cruiser' ? .25 : .5;
  let lastHit = null;
  const HIT_BANNER_SECONDS = 2.5;   // 命中提示显示时长（原 5 秒，挡住下一次瞄准）
  const shipHitLocal = new THREE.Vector3();
  function shipHitFx(vessel, p, shell) {
    const big = shell.radius >= 8 ? 1.5 : 1.15;
    effect('flash', p, 5.5 * big, .16, 0xfff1c8, 0, 2.4);
    effect('flash', { x: p.x, y: p.y + 1.5, z: p.z }, 4 * big, .5, 0xff7a2a, 1.5, 2.2);
    if (effects) effects.explosion(p, shell.radius * 1.4, 'explosive-pack');
    if (world.puff) {
      world.puff({ x: p.x, y: p.y + 1, z: p.z }, { count: 10, radius: 1.6 * big, shade: .14, life: 9, rise: 3.2, grow: 2.2 * big, fire: 1 });
      for (let k = 0; k < 6; k++) {   // 炸飞的火星与碎片（拖着烟迹抛起后落水）
        const a = random() * TAU, up = .6 + random() * .8;
        world.puff({ x: p.x, y: p.y + .5, z: p.z }, { count: 2, radius: .3, shade: .3, life: 2.5, rise: 0, grow: .6,
          dir: { x: Math.cos(a) * .7, y: up, z: Math.sin(a) * .7 }, speed: 18 + random() * 14, fire: .8, spread: .2 });
      }
    }
    emit({ type: 'sound', name: 'boom', position: p, heavy: true });
    if (!vessel.cfg || vessel.sinking !== null) return;
    vessel.model.updateMatrixWorld(true);
    shipHitLocal.set(p.x, p.y, p.z); vessel.model.worldToLocal(shipHitLocal);
    vessel.fires ??= [];
    if (vessel.fires.length >= 4) vessel.fires.shift();
    vessel.fires.push({ local: [shipHitLocal.x, Math.max(2, shipHitLocal.y), shipHitLocal.z], at: now });
  }
  function damageVessel(vessel, amount, byPlayer) {
    if (vessel.sinking !== null || amount <= 0) return;
    vessel.health -= amount;
    if (vessel.health > 0) return;
    vessel.sinking = now;
    explosion({ x: vessel.x, y: 3, z: vessel.z }, vessel.cfg ? 2.4 : 1.4);
    if (vessel.cfg) { state.stats.shipsSunk++; emit({ type: 'toast', text: `${vessel.label ?? vessel.cfg.name}被击沉${byPlayer ? '（玩家）' : ''}`, voice: 'jiangyin-enemy-sunk' }); }
    else state.stats.landingSunk++;
  }
  let firstEnemyKillReported = false;
  function damageTroop(soldier, amount, byPlayer = false) {
    if (soldier.dead !== null || amount <= 0) return false;
    soldier.health -= amount;
    if (soldier.health > 0) return false;
    soldier.dead = now; state.stats.infantryKilled++;
    const firstKill = byPlayer && !firstEnemyKillReported;
    if (firstKill) {
      firstEnemyKillReported = true;
      emit({ type: 'first-enemy-kill' });
    }
    return firstKill;
  }
  function blast(position, radius, damage, team, byPlayer, cause = null) {
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
        if (d < radius) damageTroop(soldier, 160 * (1 - d / radius), byPlayer);
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
        if (d < reach) { damageEmplacement(post.point, damage * (1 - d / reach), { team: 'enemy' }, now); postHurt(post, position, cause ?? 'shell'); }
      }
      // 爆炸对我军步兵：与其他地图相同的线性衰减（core.js blastDamage：damage × (1 − 距离/半径)）；
      // 在战壕里（脚下比自然地面低 1 米以上）或趴伏/蹲下时受伤减半，炮位里的炮手减半
      for (const m of squad) {
        if (m.dead !== null) continue;
        const d = Math.hypot(m.x - position.x, m.y + 1 - position.y, m.z - position.z);
        if (d >= radius) continue;
        const inTrench = naturalGroundHeight(m.x, m.z) - m.y > 1;
        const cover = (m.postId ? .5 : 1) * (inTrench ? .5 : 1) * (m.crouch ? .7 : 1);
        damageMember(m, damage * (1 - d / radius) * cover, cause ?? 'shell', position);
      }
    }
  }

  // ---------- 炮弹 ----------
  // 炮弹：深色尖头弹体 + 弹底曳光（短而细的暖白光带），朝向随弹道变化；不再是黄色圆球
  const shellGeometry = (() => { const g = new THREE.CapsuleGeometry(.09, .5, 2, 8); g.rotateX(Math.PI / 2); return g; })();
  const tracerGeometry = (() => { const g = new THREE.CylinderGeometry(.035, .11, 1, 6, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, .5); return g; })();
  const shellBody = new THREE.MeshStandardMaterial({ color: 0x3a3631, metalness: .6, roughness: .5 });
  const tracerMaterial = { friendly: new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xffc493, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending }) };
  const shellAxis = new THREE.Vector3(0, 0, -1), shellDir = new THREE.Vector3();
  function orientShell(shell) {
    const speed = Math.hypot(shell.vx, shell.vy, shell.vz) || 1;
    shellDir.set(shell.vx / speed, shell.vy / speed, shell.vz / speed);
    shell.mesh.quaternion.setFromUnitVectors(shellAxis, shellDir);
    shell.mesh.position.set(shell.x, shell.y, shell.z);
    shell.mesh.children[0].scale.set(1, 1, Math.min(14, speed * .02));   // 曳光长度随速度（约 0.02 秒的光迹）
  }
  function launchShell(team, origin, velocity, damage, radius, byPlayer = false) {
    const mesh = new THREE.Mesh(shellGeometry, shellBody);
    mesh.add(new THREE.Mesh(tracerGeometry, tracerMaterial[team]));
    scene.add(mesh);
    shells.push({ team, x: origin.x, y: origin.y, z: origin.z, ox: origin.x, oz: origin.z, vx: velocity.x, vy: velocity.y, vz: velocity.z,
      damage, radius, life: 16, mesh, byPlayer });
    orientShell(shells.at(-1));
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
            const before = hit.health, factor = vesselFactor(shell, hit);
            damageVessel(hit, shell.damage * factor, shell.byPlayer);
            blast(p, shell.radius, shell.damage * factor, 'friendly', shell.byPlayer);
            shipHitFx(hit, p, shell);
            if (shell.byPlayer) {
              const max = hit.cfg?.health ?? ENEMY_TYPES.landing.health;
              lastHit = { at: now, label: hit.label ?? (hit.cfg ? hit.cfg.name : ENEMY_TYPES.landing.name), health: Math.max(0, hit.health) / max,
                damage: Math.min(before, shell.damage * factor), sunk: hit.sinking !== null, distance: Math.hypot(p.x - shell.ox, p.z - shell.oz) };
              emit({ type: 'hit', kind: hit.cfg ? 'ship' : 'landing', ...lastHit, position: p });
            }
            done = true; break;
          }
        } else {
          const ship = shipPosts().find(post => alive(post) && insideVessel(post.boat, p, .5));
          if (ship) { blast(p, shell.radius, shell.damage, 'enemy', false, shell.cause); explosion(p, 1.3); done = true; break; }
        }
        const ground = groundHeight(p.x, p.z);
        if (p.y <= Math.max(0, ground)) {
          const water = ground < 0;
          blast(p, shell.radius * (water ? .7 : 1), shell.damage, shell.team, shell.byPlayer, shell.cause);
          explosion(p, Math.max(.45, shell.radius / 8), water, 'tank-shell',
            water ? null : { kind: 'soil', normal: { x: 0, y: 1, z: 0 } }); done = true;
        }
        if (shell.life <= 0) done = true;
      }
      if (done) { scene.remove(shell.mesh); shells.splice(i, 1); }
      else orientShell(shell);
    }
  }
  function aimDirection(point, yawError = 0, pitchError = 0) {
    const yaw = point.yaw + yawError, pitch = point.pitch + pitchError;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }
  // 炮口焰与硝烟（大口径火炮）：橙白闪光 → 沿炮口方向喷出的炽热烟柱 → 向两侧翻卷的环状烟 → 缓缓飘散的灰白烟云 → 炮位地面被冲击波掀起的尘土
  const blastSide = new THREE.Vector3(), blastUp = new THREE.Vector3(), blastDir = new THREE.Vector3();
  function muzzleBlast(muzzle, dir, big, post) {
    effect('flash', muzzle, 1.5 * big, .09, 0xfff0c8, 0, 2.6);
    effect('flash', { x: muzzle.x + dir.x * 2.5 * big, y: muzzle.y + dir.y * 2.5 * big, z: muzzle.z + dir.z * 2.5 * big }, 1.1 * big, .14, 0xffa64a, 0, 3);
    if (effects) effects.muzzle(muzzle, dir);
    if (!world.puff) return;
    world.puff(muzzle, { count: Math.round(14 * big), radius: .5 * big, shade: .5, life: 6 + 2 * big, rise: .4, grow: 1.1 * big, dir, speed: 26 * big, fire: .9, spread: .4 });
    blastDir.set(dir.x, dir.y, dir.z); blastSide.set(-dir.z, 0, dir.x).normalize(); blastUp.crossVectors(blastSide, blastDir).normalize();
    for (let k = 0; k < 10; k++) {   // 环状翻卷
      const a = k / 10 * TAU, sx = Math.cos(a), sy = Math.sin(a);
      const side = { x: blastSide.x * sx + blastUp.x * sy + dir.x * .5, y: blastSide.y * sx + blastUp.y * sy + dir.y * .5, z: blastSide.z * sx + blastUp.z * sy + dir.z * .5 };
      world.puff({ x: muzzle.x + dir.x * 1.5 * big, y: muzzle.y + dir.y * 1.5 * big, z: muzzle.z + dir.z * 1.5 * big },
        { count: 2, radius: .45 * big, shade: .66, life: 5 + 2 * big, rise: .5, grow: 1.2 * big, dir: side, speed: 7 * big, spread: .3 });
    }
    world.puff({ x: muzzle.x + dir.x * 8 * big, y: muzzle.y + dir.y * 8 * big + .5, z: muzzle.z + dir.z * 8 * big },
      { count: Math.round(8 * big), radius: 2.2 * big, shade: .78, life: 14 + 4 * big, rise: .35, grow: 1.7 * big });   // 久久不散的烟云
    if (post && !post.boat && big >= 1.3) {   // 炮位地面扬尘
      const ground = { x: post.point.x + dir.x * 3, y: post.floor + .4, z: post.point.z + dir.z * 3 };
      world.puff(ground, { count: Math.round(10 * big), radius: 3.5 * big, shade: .56, life: 6, rise: .7, grow: 1.4 * big, spread: 2.2 });
    }
  }
  function shoot(post, byPlayer, error = 0) {
    const { point } = post, settings = point.weapon.settings;
    if (!fireEmplacement(point, now)) return false;
    const pose = postPose(post);
    if (byPlayer) state.stats.shots++;
    if (settings.type === 'field-gun') {
      // 玩家炮弹也有真实散布（装药差异导致初速 ±、方向偏差），辅助瞄准的落点椭圆按 2 倍标准差绘制
      const dir = aimDirection(point, gauss() * error + (byPlayer ? gauss() * AIM_ASSIST.yawSigma : 0), gauss() * error * .4);
      const v = shellSpeedOf(point) * (byPlayer ? 1 + gauss() * AIM_ASSIST.speedSigma : 1);
      launchShell('friendly', pose.muzzle, { x: dir.x * v, y: dir.y * v, z: dir.z * v },
        settings.damage, settings.radius, byPlayer);
      shells.at(-1).flak = settings.variant === 'flak88';   // 88 毫米高射炮弹：对大型舰艇效果有限（见 vesselFactor）
      const big = settings.mount === 'coastal' && settings.variant !== 'flak88' ? 2 : settings.mount === 'shipTurret' ? 1.7 : settings.variant === 'flak88' ? 1.3 : 1;
      muzzleBlast(pose.muzzle, dir, big, post);
      emit({ type: 'sound', name: 'gun', position: pose.muzzle, player: byPlayer });
    } else {
      const spread = settings.spread + error;
      const dir = aimDirection(point, gauss() * spread, gauss() * spread);
      const hit = traceRay(pose.muzzle, dir, settings.range);
      if (hit?.kind === 'troop') {
        const firstKill = damageTroop(hit.target, settings.damage, byPlayer);
        if (byPlayer) emit({ type: 'hit', kind: 'troop', firstKill });
      }
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
    emit({ type: 'toast', text: '第一阶段 · 江面决战：操纵我舰艏主炮迎击日舰（1–3 或 Q/E 换舰）', alert: true, voice: 'jiangyin-naval-start' });
  }
  const introCaption = () => {
    if (state.phase !== 'intro') return '';
    return state.introTime < 6 ? '1937年秋 · 江阴 · 长江滚滚东流。中国海军第一舰队“平海”“宁海”“逸仙”列阵江心迎敌，上游锚地停泊着待命的旧舰与商轮'
      : '日军舰队自吴淞方向逆流而上，意图摧毁江阴要塞 —— 迎战！';
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
    if (settings.mount === 'nest') {   // 高射机枪：眼睛在觇孔照门后方，透过环形准星瞄准（与枪膛轴线平行）
      const eye = maximEye(point, post.floor);
      viewEuler.set(point.pitch, point.yaw, 0, 'YXZ');
      return { position: new THREE.Vector3(eye.x, eye.y, eye.z), quaternion: new THREE.Quaternion().setFromEuler(viewEuler) };
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
  // 玩家所在炮位受击：屏幕上画指向开火方向的红色弧标并写明来源（与 v22 步兵受击提示同一套页面元素）；同一来源 0.5 秒内只提示一次
  const postHurtAt = {};
  function postHurt(post, from, cause) {
    if (!post || post.id !== controlledId || !from || state.phase !== 'hold' || transfer) return;
    if (now - (postHurtAt[cause] ?? -9) < .5) return;
    postHurtAt[cause] = now;
    const bearing = Math.atan2(-(from.x - post.point.x), -(from.z - post.point.z));
    emit({ type: 'hurt-from', angle: wrap(post.point.yaw - bearing), cause: CAUSE_LABEL[cause] ?? '敌火' });
    emit({ type: 'hurt', amount: 0 });
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
    if (!(state.phase === 'naval' || deployed && ['scuttle', 'hold'].includes(state.phase)) || transfer) return false;
    const id = typeof direction === 'string' ? direction : nextPostId(deployed ? holdOrder() : eligiblePosts(), controlledId, direction);
    if (!id || id === controlledId) return false;
    const post = postById(id);
    if (!post || !eligiblePosts().includes(post)) {
      emit({ type: 'toast', text: state.phase === 'naval' ? '第一阶段只能在我舰上复生' : '我舰已全部沉没，只能接管两岸阵地' }); return false;
    }
    if (!alive(post)) { emit({ type: 'toast', text: `${post.name}已${post.boat ? '沉没' : '被摧毁'}，无法接管` }); return false; }
    return beginTransfer(id, 'manual');
  }
  const cinematic = { position: new THREE.Vector3(-120, 40, 90), look: new THREE.Vector3(0, 0, 0) };
  // ---------- 辅助瞄准：按住右键时，沿当前炮口方向按真实弹道（重力、初速）推算落点，在江面/地面画出落点散布椭圆 ----------
  // 椭圆 = 初速 ±2σ 的远近落点 + 左右 ±2σ 方向偏差 + 弹丸杀伤半径；落点附近的日舰另画“飞行时间后的位置”（提前量标记）
  const AIM_ASSIST = Object.freeze({ speedSigma: .004, yawSigma: .0012, segments: 72 });
  const aimRing = (() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((AIM_ASSIST.segments + 1) * 3), 3));
    const ring = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: .95, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: .16, depthTest: false, depthWrite: false }));
    const lead = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: .9, depthTest: false, side: THREE.DoubleSide }));
    for (const o of [ring, fill, lead]) { o.renderOrder = 10; o.frustumCulled = false; o.visible = false; scene.add(o); }
    return { ring, fill, lead };
  })();
  let aimInfo = null;
  function predictImpact(origin, dir, speed) {
    let x = origin.x, y = origin.y, z = origin.z, vx = dir.x * speed, vy = dir.y * speed, vz = dir.z * speed, t = 0;
    const h = .04;
    while (t < 16) {
      vy -= GRAVITY * h; x += vx * h; y += vy * h; z += vz * h; t += h;
      const p = { x, y, z };
      const vessel = ships.find(v => v.sinking === null && insideVessel(v, p, .3));
      if (vessel) return { x, y, z, t, vessel };
      const ground = groundHeight(x, z);
      if (y <= Math.max(0, ground)) return { x, y: Math.max(0, ground), z, t, water: ground < 0 };
    }
    return null;
  }
  function updateAimAssist(input) {
    const post = mode === 'post' ? postById(controlledId) : null, point = post?.point;
    const on = Boolean(input.aiming && point && alive(post) && point.weapon.settings.type === 'field-gun' && !transfer &&
      (state.phase === 'naval' || (state.phase === 'hold' && deployed)));
    aimInfo = null;
    if (!on) { aimRing.ring.visible = aimRing.fill.visible = aimRing.lead.visible = false; return; }
    const pose = postPose(post), dir = aimDirection(point), v = shellSpeedOf(point), radius = point.weapon.settings.radius ?? 6;
    const mid = predictImpact(pose.muzzle, dir, v);
    if (!mid) { aimRing.ring.visible = aimRing.fill.visible = aimRing.lead.visible = false; return; }
    const near = predictImpact(pose.muzzle, dir, v * (1 - 2 * AIM_ASSIST.speedSigma)) ?? mid;
    const far = predictImpact(pose.muzzle, dir, v * (1 + 2 * AIM_ASSIST.speedSigma)) ?? mid;
    const ground = Math.hypot(mid.x - pose.muzzle.x, mid.z - pose.muzzle.z);
    const along = { x: dir.x, z: dir.z }, l = Math.hypot(along.x, along.z) || 1; along.x /= l; along.z /= l;
    const across = { x: -along.z, z: along.x };
    // 椭圆中心取远近落点中点，纵向半轴 = 远近落点差的一半 + 杀伤半径，横向半轴 = 2σ 方向偏差 × 距离 + 杀伤半径
    const cx = (near.x + far.x) / 2, cz = (near.z + far.z) / 2;
    const a = Math.hypot(far.x - near.x, far.z - near.z) / 2 + radius, b = 2 * AIM_ASSIST.yawSigma * ground + radius;
    const positions = aimRing.ring.geometry.attributes.position;
    for (let i = 0; i <= AIM_ASSIST.segments; i++) {
      const th = i / AIM_ASSIST.segments * Math.PI * 2, px = cx + along.x * Math.cos(th) * a + across.x * Math.sin(th) * b,
        pz = cz + along.z * Math.cos(th) * a + across.z * Math.sin(th) * b;
      positions.setXYZ(i, px, Math.max(0, groundHeight(px, pz)) + .6, pz);
    }
    positions.needsUpdate = true; aimRing.ring.geometry.computeBoundingSphere();
    aimRing.fill.position.set(cx, Math.max(0, groundHeight(cx, cz)) + .5, cz);
    aimRing.fill.scale.set(1, 1, 1); aimRing.fill.rotation.y = Math.atan2(along.x, along.z);
    aimRing.fill.scale.set(b, 1, a);
    // 落点附近的日舰：画出它在炮弹飞行时间后的位置（提前量）；椭圆罩住它时圈变红
    let threat = null, best = 260;
    for (const ship of ships) {
      if (ship.sinking !== null) continue;
      const d = Math.hypot(ship.x - cx, ship.z - cz); if (d < best) { best = d; threat = ship; }
    }
    let onTarget = Boolean(mid.vessel);
    if (threat) {
      const f = forward(threat.heading), s = threat.speed ?? threat.cfg.speed;
      const fx = threat.x + f.x * s * mid.t, fz = threat.z + f.z * s * mid.t;
      aimRing.lead.position.set(fx, 1.2, fz); aimRing.lead.visible = true;
      const u = (fx - cx) * along.x + (fz - cz) * along.z, w = (fx - cx) * across.x + (fz - cz) * across.z;
      onTarget = (u / (a + threat.cfg.length * .35)) ** 2 + (w / (b + threat.cfg.beam * .5)) ** 2 <= 1;
    } else aimRing.lead.visible = false;
    aimRing.ring.material.color.setHex(onTarget ? 0xff5a3c : 0xffd27a);
    aimRing.fill.material.color.setHex(onTarget ? 0xff5a3c : 0xffc04a);
    aimRing.ring.visible = aimRing.fill.visible = true;
    aimInfo = { distance: ground, flight: mid.t, onTarget, lead: Boolean(threat), spread: [Math.round(a * 2), Math.round(b * 2)] };
  }
  function updateCamera(dt) {
    if (state.phase === 'scuttle' && !deployed) {   // 自沉封江演出（登岸前 10 秒）：镜头跟随正在驶向最窄处 / 正在自沉的船
      const focus = blockships.find(ship => ship.state === 'transit' || ship.state === 'scuttling' || ship.state === 'sinking') ?? blockships.at(-1);
      const look = focus ? new THREE.Vector3(focus.x, 3, focus.z) : new THREE.Vector3(0, 0, 0);
      const side = focus && focus.z < 0 ? -1 : 1;
      const desired = look.clone().add(new THREE.Vector3(-230, 95, side * 240));
      const k = 1 - Math.exp(-dt * 1.2);
      cinematic.position.lerp(desired, k); cinematic.look.lerp(look, k);
      camera.position.copy(cinematic.position); camera.lookAt(cinematic.look);
      return;
    }
    let view;
    if (mode === 'infantry') {
      const m = controlledMember();
      if (!m) return;
      const eye = memberEye(m);
      // 防晕：① 视点高度用短时平滑跟随地面（坡面上的小起伏不再直接传到镜头），最多落后 0.3 米；
      // ② 镜头起伏幅度减小，并随坡度、玩家“镜头晃动强度”设置（与其他地图同一设置）进一步减弱；起伏与第一人称枪的晃动同相
      if (viewEye.id !== m.id || viewEye.y === null || dt > .25) { viewEye.id = m.id; viewEye.y = eye.y; viewEye.grade = 0; }
      viewEye.y += (eye.y - viewEye.y) * (1 - Math.exp(-dt / .09));
      viewEye.y = Math.max(eye.y - .3, Math.min(eye.y + .3, viewEye.y));
      viewEye.grade += ((m.speed > .5 ? m.grade ?? 0 : 0) - viewEye.grade) * (1 - Math.exp(-dt / .35));
      const bob = m.speed > .5 ? Math.sin(m.walk * 2.4) * memberBob(m) : 0;
      const dead = m.dead !== null ? Math.min(1, (now - m.dead) / .8) : 0;
      viewEuler.set(m.pitch * (1 - dead), m.heading, dead * .6, 'YXZ');
      view = { position: new THREE.Vector3(eye.x, viewEye.y + bob - dead * 1.2, eye.z), quaternion: new THREE.Quaternion().setFromEuler(viewEuler) };
    } else {
      const post = postById(controlledId);
      if (!post) return;
      view = viewFor(post);
      // 我舰沉没：炮手视角会随炮塔沉到水下（看到的是江底，很怪）。改为镜头离开炮塔、升到侧上方目送本舰下沉，绝不进入水下
      if (post.boat && post.destroyedAt !== null) {
        const boat = post.boat, k = Math.min(1, (now - post.destroyedAt) / 3.5), e = k * k * (3 - 2 * k);
        const side = { x: -Math.cos(boat.heading), z: Math.sin(boat.heading) }, back = forward(boat.heading);
        const outside = new THREE.Vector3(boat.x + side.x * boat.cfg.length * .55 - back.x * boat.cfg.length * .35, 14 + boat.cfg.length * .08,
          boat.z + side.z * boat.cfg.length * .55 - back.z * boat.cfg.length * .35);
        const look = new THREE.Vector3(boat.x, Math.max(-2, boat.hull.position.y + 3), boat.z);
        const watch = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(outside, look, new THREE.Vector3(0, 1, 0)));
        view.position.lerp(outside, e); view.quaternion.slerp(watch, e);
      }
      if (view.position.y < 1.2 && waterAt(view.position.x, view.position.z)) view.position.y = 1.2;   // 任何炮位视角都不会钻到江面以下
    }
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

  const waterAt = (x, z) => groundHeight(x, z) < 0;
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
  // 玩家操舰（简化的船舶操纵模型，参数按游戏尺度压缩，见 SHIP_HANDLING）：
  //  · 车钟分档：W/S 每按一下进/退一档（按住约 0.7 秒再进一档）：半速后退、微速后退、停车、微速、半速、全速；
  //  · 主机响应滞后：推力约 4 秒才跟上车钟（蒸汽轮机）；倒车推力只有正车的一半；
  //  · 水阻力 ∝ 航速²（另加少量线性阻力）：加速越来越慢、接近最高航速；停车后靠惯性滑行很远，不会像汽车一样刹住；
  //  · 舵：A/D 转舵约 5 秒到满舵，松开回中；舵效 ∝ 流过舵面的水速（航速 + 正车时的螺旋桨尾流），低速几乎转不动；
  //  · 转首有惯性：回转角速度约 5–6 秒才跟上舵角，回舵后舰首还会继续转一会儿；
  //  · 回转时阻力增大而掉速，船身向外侧横倾，航迹略滞后于船首（漂角，最大约 4°）。
  const SHIP_HANDLING = Object.freeze({
    notches: Object.freeze([-.5, -.25, 0, .33, .66, 1]),
    names: Object.freeze(['半速后退', '微速后退', '停车', '微速前进', '半速前进', '全速前进']),
    engineLag: 4, astern: .5, rudderTime: 5, minRadius: 1.5, repeat: .7, washFactor: 1.6,
    linearDrag: .012, turnDrag: .55, driftLag: 2.5, maxDrift: .07, heelGain: .28, maxHeel: .08,
  });
  // 最高航速（游戏尺度）与从静止加速到 90% 最高航速所需时间：平海/宁海（约 2400 吨）、逸仙（约 1550 吨）
  const shipPerformance = boat => boat.cfg.length >= 100 ? { top: 7, rise: 48 } : { top: 6.3, rise: 38 };
  function steerByPlayer(boat, move, dt) {
    const H = SHIP_HANDLING, { top, rise } = shipPerformance(boat);
    const a0 = 1.6 * top / rise;   // 满推力加速度：约 rise 秒达到 90% 最高航速（二次阻力的 tanh 解，含线性阻力修正）
    // 车钟：按键边沿进/退一档，按住时每 0.7 秒再进一档
    const z = Math.sign(move.z ?? 0);
    if (z && (z !== boat.lastBell || now >= boat.bellRepeatAt)) {
      boat.bell = Math.max(0, Math.min(H.notches.length - 1, boat.bell + z));
      boat.bellRepeatAt = now + (z !== boat.lastBell ? H.repeat * 1.4 : H.repeat);
    }
    boat.lastBell = z;
    boat.throttle = H.notches[boat.bell];
    // 主机：推力滞后跟随车钟
    const thrustGoal = boat.throttle >= 0 ? boat.throttle : boat.throttle * H.astern * 2;
    boat.thrust += (thrustGoal - boat.thrust) * Math.min(1, dt / H.engineLag);
    // 舵：A/D 转舵（A 左舵、D 右舵），松开回中，约 5 秒满舵
    const rudderGoal = -(move.x ?? 0);
    boat.rudder += Math.max(-dt / H.rudderTime, Math.min(dt / H.rudderTime, rudderGoal - boat.rudder));
    // 纵向：推力 − 二次水阻力（回转时阻力增大） − 少量线性阻力
    const quad = (a0 - H.linearDrag * top) / (top * top);   // 全推力时二次阻力 + 线性阻力 正好在最高航速处平衡
    const v = boat.speed, drag = quad * v * Math.abs(v) * (1 + H.turnDrag * Math.abs(boat.rudder)) + H.linearDrag * v;
    boat.speed += (a0 * boat.thrust - drag) * dt;
    if (boat.throttle === 0 && Math.abs(boat.speed) < .04) boat.speed = 0;
    // 转首：舵效取决于流过舵面的水速（航速 + 正车尾流），角速度带惯性地跟上
    const flow = Math.sign(boat.speed || 1) * Math.hypot(boat.speed, Math.max(0, boat.thrust) * H.washFactor);
    const yawGoal = boat.rudder * flow / (boat.cfg.length * H.minRadius);
    const yawLag = boat.cfg.length / 18;   // 109 米约 6 秒，82 米约 4.5 秒
    boat.yawRate += (yawGoal - boat.yawRate) * Math.min(1, dt / yawLag);
    boat.heading = wrap(boat.heading + boat.yawRate * dt);
    // 漂角（航迹滞后于船首）与外倾
    const driftGoal = Math.max(-H.maxDrift, Math.min(H.maxDrift, -boat.yawRate * H.driftLag * Math.sign(boat.speed || 1)));
    boat.drift += (driftGoal - boat.drift) * Math.min(1, dt / 2);
    const heelGoal = Math.max(-H.maxHeel, Math.min(H.maxHeel, -boat.speed * boat.yawRate * H.heelGain));
    boat.heel += (heelGoal - boat.heel) * Math.min(1, dt / 3);
  }
  function helmState(boat) {
    return boat.manual ? { bell: SHIP_HANDLING.names[boat.bell], throttle: boat.throttle, rudder: boat.rudder, knots: boat.speed * 1.944 } : null;
  }
  function moveBoat(post, dt, helm = null) {
    const boat = post.boat;
    const move = helm?.move ?? { x: 0, z: 0 };
    if (helm && alive(post) && (move.x || move.z) && !boat.manual) {
      boat.manual = true; boat.rudder = 0; boat.yawRate = 0; boat.drift = 0; boat.heel = boat.heel ?? 0; boat.lastBell = 0; boat.bellRepeatAt = 0;
      // 接管时车钟停在与当前航速最接近的一档，主机推力取维持当前航速所需的推力（不会一接管就突然加减速）
      const { top } = shipPerformance(boat), keep = Math.max(0, boat.speed / top) ** 2;
      boat.bell = SHIP_HANDLING.notches.reduce((best, n, i) => Math.abs(n - keep) < Math.abs(SHIP_HANDLING.notches[best] - keep) ? i : best, 2);
      boat.throttle = SHIP_HANDLING.notches[boat.bell]; boat.thrust = keep;
      emit({ type: 'toast', text: `${post.name}：你已接管操舰 · W/S 车钟 · A/D 转舵（换舰后交还舰员）` });
    }
    if (!helm && boat.manual) { boat.manual = false; boat.drift = 0; }
    if (!boat.manual) { boat.heel = (boat.heel ?? 0) * Math.max(0, 1 - dt / 3); boat.drift = 0; }
    if (!alive(post)) {
      boat.speed *= Math.max(0, 1 - dt * .6);
      boat.sinking = Math.min(1, boat.sinking + dt / 18);
      if (boat.sinking >= 1 && !boat.sunk) {
        boat.sunk = true; boat.hull.visible = false; post.model.visible = false;
        emit({ type: 'toast', text: `${post.name}完全沉没`, alert: true });
      }
    } else if (state.phase === 'naval' && boat.manual) {
      steerByPlayer(boat, move, dt);
    } else if (state.phase === 'naval') {
      // 按船首方向航行（不倒车、不横移）。艏主炮只能左右各转约 143°，所以我舰始终“艏向敌”：
      // 以最近的日舰（没有则正下游）为基准方位，左右蛇形机动规避（偏离基准不超过约 40°）；
      // 前出到警戒线或离敌太近时改为大角度横越（不超过约 70°）并减速，绝不掉头把舰尾对着敌人。
      const others = shipPosts().filter(other => other !== post && alive(other));
      let threat = null, best = Infinity;
      for (const ship of ships) {
        if (ship.sinking !== null) continue;
        const d = Math.hypot(ship.x - boat.x, ship.z - boat.z);
        if (d < best) { best = d; threat = ship; }
      }
      const bearing = threat ? Math.atan2(-(threat.x - boat.x), -(threat.z - boat.z)) : -Math.PI / 2;
      if (boat.zig === undefined) { boat.zig = boat.z > 0 ? -1 : 1; boat.zigAt = now + 18 + random() * 14; }
      const flip = () => { boat.zig = -boat.zig; boat.zigAt = now + 16 + random() * 14; };
      if (now > boat.zigAt) flip();
      const forwardLimit = boat.x > 400 || best < 520;
      let offset = boat.zig * (forwardLimit ? 1.2 : .45 + .25 * Math.sin(now * .13 + boat.cfg.length));
      // 前方约 2.5 倍舰长处若是浅滩、岸线、阻塞线或友舰：换到另一侧蛇形
      const probe = h => { const look = forward(h), reach = boat.cfg.length * 2.5, ax = boat.x + look.x * reach, az = boat.z + look.z * reach;
        return groundHeight(ax, az) > -4 || Math.abs(az) > RIVER_HALF - 170 || ax > 470 || ax < -280 ||
          others.some(o => Math.hypot(o.boat.x - ax, o.boat.z - az) < 170); };
      if (probe(wrap(bearing + offset))) {
        if (!probe(wrap(bearing - offset))) { flip(); offset = -offset; }
        else offset = boat.zig * 1.2;
      }
      const desired = wrap(bearing + offset), error = wrap(desired - boat.heading);
      // 舵效随航速，低速时仍保留少量回转（轮机差速）；最小回转半径约 2.2 倍舰长
      const rate = Math.max(.03, Math.abs(boat.speed) / (boat.cfg.length * 2.2));
      boat.heading = wrap(boat.heading + Math.max(-rate * dt, Math.min(rate * dt, error)));
      // 敌舰已到艏炮射界边缘（偏离船首 > 110°）时急转：降速、加大舵角，优先把船首转回来
      const offBow = Math.abs(wrap(bearing - boat.heading));
      const goal = offBow > 1.9 ? 2.6 : forwardLimit ? 2.8 : Math.abs(error) > 1.2 ? 3.4 : 5.5;
      boat.speed += Math.max(-.4 * dt, Math.min(.3 * dt, goal - boat.speed));
    }
    const f = forward(boat.heading), half = boat.cfg.length / 2, course = forward(wrap(boat.heading - (boat.drift ?? 0)));
    const nx = boat.x + course.x * boat.speed * dt, nz = boat.z + course.z * boat.speed * dt;
    const blocked = Math.abs(boat.speed) > .05 && [0, half - 4, -(half - 4)].some(o => groundHeight(nx + f.x * o, nz + f.z * o) > -1.4 ||
      Math.abs(nz + f.z * o) > RIVER_HALF - 140 || insideWreck(nx + f.x * o, nz + f.z * o, 2, wreckZones));
    if (blocked && alive(post)) { boat.speed *= .5; if (boat.manual) { boat.thrust = Math.min(boat.thrust, 0); boat.yawRate *= .5; } boat.zig = Math.sign(boat.z) || 1; boat.zigAt = now + 12; }   // 受阻：减速并换到离岸一侧蛇形
    else if (!blocked) { boat.x = nx; boat.z = nz; }
    syncBoatGun(post);
  }

  // ---------- AI 炮手 ----------
  function predicted(vessel, flight) {
    if (vessel.sinking !== null) return null;
    const speed = vessel.cfg ? (vessel.speed ?? vessel.cfg.speed) : vessel.state === 'approach' ? ENEMY_TYPES.landing.speed : 0;
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
        consider(tank, aim, d => settings.variant === 'flak88' ? d + 100 : d - 80);   // 高射炮：飞机优先，其次坦克
      }
      if (settings.variant === 'flak88') for (const plane of livePlanes()) {
        const rough = plane.position.distanceTo(new THREE.Vector3(point.x, post.floor, point.z)), flight = rough / shellSpeedOf(point);
        const aim = leadPlane(plane, flight); aim.y += .5 * GRAVITY * flight * flight;
        consider(plane, aim, d => d - 200);
      }
      for (const vessel of [...ships, ...landings]) {
        if (vessel.x >= JIANGYIN_RULES.radarRevealX) continue;   // 弯道后方看不见，双方都不开火
        // AI 大炮优先打日舰与坦克；登陆艇又小又快，AI 炮手只在它冲到滩头前 300 米内才开炮（主要留给玩家和机枪堡拦截），
        // 否则登陆艇几乎全在半路被 AI 击沉，登陆步兵根本上不了岸
        if (!vessel.cfg && (state.phase !== 'hold' || Math.hypot(vessel.target.x - vessel.x, vessel.target.z - vessel.z) > 300)) continue;
        const rough = Math.hypot(vessel.x - point.x, vessel.z - point.z), flight = rough / shellSpeedOf(point);
        const aim = predicted(vessel, flight);
        if (aim) aim.y += .5 * GRAVITY * flight * flight;
        // 高射炮（88 毫米）以对空、反坦克为主：登陆艇排在坦克之后，日舰只在附近没有飞机、坦克、登陆艇时才打
        const flakPenalty = settings.variant === 'flak88' ? (vessel.cfg ? 5000 : 600) : 0;
        consider(vessel, aim, d => flakPenalty + (vessel.cfg ? vessel.x + d * .3 : vessel.x + 120 + d * .3));
      }
    } else {
      for (const soldier of troops) if (soldier.dead === null)
        consider(soldier, { x: soldier.x, y: groundHeight(soldier.x, soldier.z) + .9, z: soldier.z }, d => d);
      for (const craft of landings) if (craft.sinking === null)
        consider(craft, predicted(craft, .4), d => d + 60);
      for (const plane of livePlanes()) consider(plane, leadPlane(plane, .35), d => d - 150);   // 高射机枪：飞机优先
    }
    if (!best) return;
    const aligned = aimEmplacement(point, best.aimPoint, dt, post.floor);
    if (!aligned) return;
    if (settings.type === 'field-gun') {
      if (now < post.aiNextShot) return;
      if (shoot(post, false, post.boat ? .011 : .007)) post.aiNextShot = now + (settings.aiInterval ?? 8.5) + random() * 4;
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
  // 第二阶段最多四艘，前两分钟补充；受创舰艇仍按原规则撤退。
  const HOLD_FLEET = Object.freeze({ max: 4, withdrawBelow: .4, withdrawSpeed: 2.6, topUpUntil: 120, topUpGap: 20, fireSlowdown: 1 / .7,
    roster: Object.freeze(['destroyer', 'gunboat', 'destroyer', 'gunboat']) });
  function topUpHoldFleet() {
    if (state.phase !== 'hold' || state.elapsed > HOLD_FLEET.topUpUntil || now < (state.holdTopUpAt ?? 0)) return;
    const engaged = ships.filter(ship => ship.sinking === null && !ship.withdrawing).length;
    if (engaged >= HOLD_FLEET.max) return;
    state.holdTopUpAt = now + HOLD_FLEET.topUpGap;
    spawnShip(HOLD_FLEET.roster[(state.holdTopUpIndex = (state.holdTopUpIndex ?? -1) + 1) % HOLD_FLEET.roster.length]);
  }
  function beginWithdraw(ship) {
    if (ship.withdrawing || ship.sinking !== null) return;
    ship.withdrawing = true; ship.aimTarget = null;
    ship.wp = Math.min(ship.route.length - 1, Math.max(0, ship.route.findIndex(p => p.x <= ship.x) - 1));
    if (ship.wp < 0) ship.wp = 0;
    emit({ type: 'toast', text: `${ship.label}${ship.health < ship.cfg.health * HOLD_FLEET.withdrawBelow ? '受创' : ''}退出战斗，顺流撤往下游` });
  }
  // 船体近似为沿船首方向的胶囊体：中心线长 (舰长 − 舰宽)，半径 = 舰宽/2。用于舰艇之间的避让与防穿模
  function hullSegment(v) {
    const L = v.cfg?.length ?? v.boat?.cfg.length, B = v.cfg?.beam ?? v.boat?.cfg.beam, h = forward(v.heading ?? v.boat.heading);
    const x = v.x ?? v.boat.x, z = v.z ?? v.boat.z, half = Math.max(0, L - B) / 2;
    return { ax: x - h.x * half, az: z - h.z * half, bx: x + h.x * half, bz: z + h.z * half, r: B / 2 };
  }
  function segmentGap(p, q) {   // 两条线段之间的最短距离及最近点（平面）
    const d1x = p.bx - p.ax, d1z = p.bz - p.az, d2x = q.bx - q.ax, d2z = q.bz - q.az, rx = p.ax - q.ax, rz = p.az - q.az;
    const a = d1x * d1x + d1z * d1z || 1e-6, e = d2x * d2x + d2z * d2z || 1e-6, f = d2x * rx + d2z * rz, c = d1x * rx + d1z * rz, b = d1x * d2x + d1z * d2z;
    const den = a * e - b * b;
    let s = den > 1e-6 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0, t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    const px = p.ax + d1x * s, pz = p.az + d1z * s, qx = q.ax + d2x * t, qz = q.az + d2z * t;
    return { d: Math.hypot(px - qx, pz - qz), nx: px - qx, nz: pz - qz };
  }
  // 避让：前方约 3 个舰长、左右各一个舰宽加 25 米的走廊内有别的船（日舰、我舰、阻塞船残骸外的水面舰）时，
  // 按右舷让左舷的惯例向右转并减速；若两船胶囊体已经相交，沿最近点方向把本舰推开，绝不互相穿过。
  function avoidOtherShips(ship, dt) {
    const mine = hullSegment(ship), f = forward(ship.heading), side = { x: -f.z, z: f.x };
    let steer = 0, slow = 1;
    const others = [...ships.filter(o => o !== ship && o.sinking === null), ...shipPosts().filter(post => !post.boat.sunk).map(post => ({ boat: post.boat }))];
    for (const other of others) {
      const seg = hullSegment(other), ox = (seg.ax + seg.bx) / 2, oz = (seg.az + seg.bz) / 2;
      const dx = ox - ship.x, dz = oz - ship.z, ahead = dx * f.x + dz * f.z, lateral = dx * side.x + dz * side.z;
      const reach = ship.cfg.length * 3, corridor = mine.r + seg.r + 25;
      if (ahead > 0 && ahead < reach && Math.abs(lateral) < corridor) {
        const k = 1 - ahead / reach;
        steer += (lateral >= 0 ? -1 : 1) * k;      // 对方在左侧就向右让，反之向左
        slow = Math.min(slow, .35 + .65 * (ahead / reach));
      }
      const gap = segmentGap(mine, seg), overlap = mine.r + seg.r + 3 - gap.d;
      if (overlap > 0) {
        const n = Math.hypot(gap.nx, gap.nz) || 1, nx = gap.d > 1e-3 ? gap.nx / n : side.x, nz = gap.d > 1e-3 ? gap.nz / n : side.z;
        const push = Math.min(overlap, 6 * dt + overlap * .5);
        if (groundHeight(ship.x + nx * push, ship.z + nz * push) < -1) { ship.x += nx * push; ship.z += nz * push; }
        ship.speed *= Math.max(.5, 1 - dt * 1.5);
      }
    }
    return { steer: Math.max(-1, Math.min(1, steer)), slow };
  }
  function advanceShip(ship, dt) {
    if (ship.sinking !== null) { syncShip(ship); return now - ship.sinking < 10; }
    if (state.phase === 'hold' && !ship.withdrawing && ship.health < ship.cfg.health * HOLD_FLEET.withdrawBelow) beginWithdraw(ship);
    if (ship.withdrawing) {   // 顺流撤退：沿进场航线倒序驶回下游弯道，出视野后离开战场
      const p = ship.route[ship.wp];
      if (Math.hypot(p.x - ship.x, p.z - ship.z) < 130 && ship.wp > 0) ship.wp--;
      const avoid = avoidOtherShips(ship, dt);
      const desired = Math.atan2(-(p.x - ship.x), -(p.z - ship.z)) + avoid.steer * .6, turn = wrap(desired - ship.heading);
      ship.speed += Math.max(-.3 * dt, Math.min(.3 * dt, HOLD_FLEET.withdrawSpeed * avoid.slow - ship.speed));
      const rate = Math.max(.006, ship.speed / (ship.cfg.length * 2.2));
      ship.heading = wrap(ship.heading + Math.max(-rate * dt, Math.min(rate * dt, turn)));
      const f = forward(ship.heading), nx = ship.x + f.x * ship.speed * dt, nz = ship.z + f.z * ship.speed * dt;
      if (groundHeight(nx, nz) < -1) { ship.x = nx; ship.z = nz; }
      shipMachineGuns(ship, dt); syncShip(ship);
      if (ship.x > JIANGYIN_RULES.radarRevealX + 150) { scene.remove(ship.model); return false; }   // 驶出弯道，离开战场
      return true;
    }
    const target = ship.route[ship.wp];
    const dx = target.x - ship.x, dz = target.z - ship.z;
    if (Math.hypot(dx, dz) < 130 && ship.wp < ship.route.length - 1) ship.wp++;   // 大舰回转半径约 150–250 米，航路点放宽
    // 到达停泊炮击位置后减速、侧舷对敌缓慢游弋；未到达时沿航线前进
    // 到达停泊炮击位置后减速到约 0.5 米/秒、船首仍朝上游顶流；按船首方向航行，回转半径约 2.2 倍舰长
    const holding = ship.x <= ship.holdX;
    const approaching = !holding && ship.x <= ship.holdX + 650;   // 出弯后转向目标阵地前方的停泊点
    const goal = holding ? { x: ship.x - 400, z: ship.holdZ } : approaching ? { x: ship.holdX, z: ship.holdZ } : target;
    const avoid = avoidOtherShips(ship, dt);
    const desired = Math.atan2(-(goal.x - ship.x), -(goal.z - ship.z)) + avoid.steer * .6, turn = wrap(desired - ship.heading);
    ship.speed += Math.max(-.4 * dt, Math.min(.4 * dt, (holding ? .5 : ship.cfg.speed) * avoid.slow - ship.speed));
    const rate = Math.max(.006, ship.speed / (ship.cfg.length * 2.2));
    ship.heading = wrap(ship.heading + Math.max(-rate * dt, Math.min(rate * dt, turn)));
    const speed = ship.speed, f = forward(ship.heading);
    const nx = ship.x + f.x * speed * dt, nz = ship.z + f.z * speed * dt;
    if (!insideWreck(nx - ship.cfg.length / 2, nz, 4, wreckZones) && groundHeight(nx, nz) < -1) { ship.x = nx; ship.z = nz; }
    const targetable = posts.filter(alive);
    const nearest = targetable.sort((a, b) => Math.hypot(targetPosition(a).x - ship.x, targetPosition(a).z - ship.z) - Math.hypot(targetPosition(b).x - ship.x, targetPosition(b).z - ship.z))[0];
    const aimAt = post => ({ point: targetPosition(post) });
    if (nearest && ship.model.userData.turrets) { ship.model.updateMatrixWorld(true); aimTurrets(ship, aimAt(ship.aimTarget && alive(ship.aimTarget) ? ship.aimTarget : nearest), dt); }
    // 驶出下游弯道（进入视野）后才开火；第一阶段开头 15 秒双方接近、不开火；自沉封江期间暂停炮击（演出）
    const engaged = ship.x < JIANGYIN_RULES.radarRevealX && !(state.phase === 'naval' && state.navalTime < 15);
    if (state.phase !== 'scuttle' && engaged && now >= ship.nextFire) {
      ship.nextFire = now + ship.cfg.fireInterval * (.8 + random() * .4) * (state.phase === 'hold' ? HOLD_FLEET.fireSlowdown : 1);
      const range = Math.min(ship.cfg.fireRange, state.phase === 'naval' ? ENGAGE_RANGE.naval : ENGAGE_RANGE.hold);
      let candidates = posts.filter(post => alive(post) &&
        Math.hypot(targetPosition(post).x - ship.x, targetPosition(post).z - ship.z) < range);
      const assigned = candidates.find(post => post.id === ship.holdPost);
      if (assigned && random() < .6) candidates = [assigned];   // 主要轰击自己选定的阵地
      // 第一阶段日舰只与我舰对射（两岸阵地留到第二阶段）
      if (state.phase === 'naval') candidates = candidates.filter(post => post.boat);
      if (candidates.length) {
        const player = candidates.find(post => post.id === controlledId);
        if (!player && mode === 'infantry' && random() < .25) {   // 偶尔向我军步兵所在山头开炮
          const m = controlledMember();
          if (m && m.dead === null && Math.hypot(m.x - ship.x, m.z - ship.z) < range) candidates.push({ infantry: m });
        }
        const target = player && random() < .45 ? player : candidates[Math.floor(random() * candidates.length)];
        if (!target.infantry) ship.aimTarget = target;
        const tp = target.infantry ? { x: target.infantry.x, y: target.infantry.y, z: target.infantry.z } : targetPosition(target);
        const lead = target.boat ? forward(target.boat.heading) : { x: 0, z: 0 }, ls = target.boat ? target.boat.speed * 1.4 : 0;
        const spread = ship.cfg.dispersion * (1 + Math.hypot(tp.x - ship.x, tp.z - ship.z) / 1500);   // 远距离散布更大
        const aim = { x: tp.x + lead.x * ls + gauss() * spread, y: tp.y, z: tp.z + lead.z * ls + gauss() * spread };
        const origin = (target.infantry ? null : turretMuzzle(ship, target)) ?? { x: ship.x, y: 4.5, z: ship.z };
        const distance = Math.hypot(aim.x - origin.x, aim.z - origin.z), flight = Math.max(.4, distance / ENEMY_SHELL_SPEED);
        launchShell('enemy', origin, { x: (aim.x - origin.x) / flight, y: (aim.y - origin.y + .5 * GRAVITY * flight * flight) / flight,
          z: (aim.z - origin.z) / flight }, ship.cfg.shellDamage * navalPressure(), ship.cfg.shellRadius);
        shells.at(-1).cause = 'ship-shell';
        const d = Math.hypot(aim.x - origin.x, aim.y - origin.y, aim.z - origin.z) || 1;
        muzzleBlast(origin, { x: (aim.x - origin.x) / d, y: (aim.y - origin.y) / d, z: (aim.z - origin.z) / d }, ship.type === 'cruiser' ? 1.6 : 1.3, null);   // 炮口火光与硝烟：玩家能看清是哪艘舰在开炮
        emit({ type: 'sound', name: 'enemy-gun', position: origin });
      }
    }
    shipMachineGuns(ship, dt);
    syncShip(ship);
    return true;
  }
  // 日舰近防机枪/机关炮扫射：距离内的我舰（第一阶段）、岸边阵位与我军步兵（第二阶段）；点射 + 冷却，带曳光弹道
  function shipMachineGuns(ship, dt) {
    const aa = SHIP_AA[ship.type];
    if (!aa || state.phase === 'scuttle' || ship.x > JIANGYIN_RULES.radarRevealX) return;
    ship.mg ??= Array.from({ length: aa.mounts }, (_, i) => ({ next: now + 2 + random() * 3 + i, burstEnd: 0, shotAt: 0, target: null, side: i % 2 ? 1 : -1 }));
    const f = forward(ship.heading), side = { x: -f.z, z: f.x };
    for (const gun of ship.mg) {
      const origin = { x: ship.x + side.x * gun.side * ship.cfg.beam * .35 + f.x * ship.cfg.length * .08, y: ship.cfg.height * .75,
        z: ship.z + side.z * gun.side * ship.cfg.beam * .35 + f.z * ship.cfg.length * .08 };
      if (now >= gun.next && now >= gun.burstEnd) {   // 选目标并开始一次点射
        const options = [];
        for (const post of posts) if (alive(post) && (state.phase !== 'naval' || post.boat)) {
          const tp = targetPosition(post), d = Math.hypot(tp.x - origin.x, tp.z - origin.z);
          if (d < aa.range) options.push({ post, d });
        }
        if (state.phase !== 'naval') for (const m of squad) if (m.dead === null && !m.postId) {
          const d = Math.hypot(m.x - origin.x, m.z - origin.z);
          if (d < aa.range * .8 && canSee(origin, chest(m))) options.push({ member: m, d: d * .8 });
        }
        options.sort((a, b) => a.d - b.d);
        gun.target = options[0] ?? null;
        gun.next = now + aa.cooldown * (.8 + random() * .5);
        if (gun.target) { gun.burstEnd = now + aa.burst * (.7 + random() * .6); gun.next = gun.burstEnd + aa.cooldown * (.8 + random() * .5); }
      }
      if (!gun.target || now >= gun.burstEnd || now < gun.shotAt) continue;
      gun.shotAt = now + aa.interval;
      const t = gun.target, tp = t.member ? { x: t.member.x, y: t.member.y + 1.2, z: t.member.z } : targetPosition(t.post);
      if (t.member ? t.member.dead !== null : !alive(t.post)) { gun.burstEnd = now; continue; }
      const dx = tp.x - origin.x, dy = tp.y - origin.y, dz = tp.z - origin.z, d = Math.hypot(dx, dy, dz) || 1;
      const spread = aa.spread * (1 + d / 800);
      const dir = { x: dx / d + gauss() * spread, y: dy / d + gauss() * spread * .6 + .0015 * d / 100, z: dz / d + gauss() * spread };
      fireTracer(origin, dir, Math.min(d * 1.15, aa.range * 1.2), 'enemy');
      // 命中判定：按离瞄准点的偏差估计（散布越小越容易命中）；对舰体只是轻伤，主要杀伤暴露的炮手与步兵
      const hitChance = Math.max(.05, .55 - d / aa.range * .35);
      if (random() < hitChance) {
        if (t.member) damageMember(t.member, aa.damage * 12 * (t.member.crouch ? .5 : 1), 'ship-mg', origin);
        else { damageEmplacement(t.post.point, aa.damage * (t.post.boat ? 1 : 1.6), { team: 'enemy' }, now); postHurt(t.post, origin, 'ship-mg'); }
      }
      if (random() < .3) emit({ type: 'sound', name: 'mg', position: origin });
    }
  }
  // 曳光弹：亮橙色短弹道，约 800 m/s 飞行，落水溅起小水花、落地扬起小尘土
  const tracers = [];
  const enemyTracerMaterial = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
  const tracerStreak = (() => { const g = new THREE.CylinderGeometry(.06, .06, 1, 5, 1, true); g.rotateX(Math.PI / 2); return g; })();
  function fireTracer(origin, dir, range, team) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1, v = { x: dir.x / len * 820, y: dir.y / len * 820, z: dir.z / len * 820 };
    if (tracers.length > 60) { const old = tracers.shift(); scene.remove(old.mesh); }
    const mesh = new THREE.Mesh(tracerStreak, enemyTracerMaterial); mesh.scale.set(1, 1, 9); scene.add(mesh);
    tracers.push({ x: origin.x, y: origin.y, z: origin.z, v, left: range / 820, mesh, team });
  }
  function advanceTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.vy = (t.vy ?? t.v.y) - GRAVITY * dt; t.x += t.v.x * dt; t.y += t.vy * dt; t.z += t.v.z * dt; t.left -= dt;
      const ground = groundHeight(t.x, t.z);
      if (t.left <= 0 || t.y <= Math.max(0, ground)) {
        if (t.y <= Math.max(0, ground) + .5 && random() < .5)
          effect(ground < 0 ? 'splash' : 'smoke', { x: t.x, y: Math.max(0, ground), z: t.z }, .3, .45, ground < 0 ? 0xe8eee8 : 0xa89a80, .4, 1);
        scene.remove(t.mesh); tracers.splice(i, 1); continue;
      }
      t.mesh.position.set(t.x, t.y, t.z);
      t.mesh.lookAt(t.x + t.v.x, t.y + t.vy, t.z + t.v.z);
    }
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
    // 约六成日军步兵直扑玩家小队所在的阵地（玩家在哪里，攻势就压到哪里），其余攻击最近的阵位
    const lead = deployed ? controlledMember() : null;
    const focusPoint = soldier.focus && lead && lead.dead === null && Math.sign(lead.z) === Math.sign(soldier.z) ? lead : null;
    for (const post of posts) {
      if (!alive(post) || post.bank !== soldier.bank) continue;
      const d = Math.hypot(post.point.x - soldier.x, post.point.z - soldier.z);
      const score = focusPoint ? Math.hypot(post.point.x - focusPoint.x, post.point.z - focusPoint.z) : d;
      if (score < (target ? target.score : Infinity)) { best = d; target = post; target.score = score; }
    }
    if (target) delete target.score;
    // 蜂拥冲锋：日军步兵边冲边打，不再停在 140 米外放冷枪（玩家既看不见、又会被远处的冷枪成片打死）。
    // 远处只在行进间点射（命中率低）；进入约 35 米才停下跪射，10 米内直接上刺刀冲向我军步兵。
    let foe = null, foeDistance = cfg.shootRange;
    for (const m of squad) {
      if (m.dead !== null) continue;
      const d = Math.hypot(m.x - soldier.x, m.z - soldier.z);
      if (d < foeDistance && d < best + 60) { foe = m; foeDistance = d; }
    }
    if (foe && now >= (soldier.losAt ?? 0)) {   // 视线判定（每 0.6 秒一次）：被山体挡住就不开枪，继续前进
      soldier.losAt = now + .6;
      soldier.sees = canSee({ x: soldier.x, y: groundHeight(soldier.x, soldier.z) + 1.5, z: soldier.z }, chest(foe));
    }
    if (foe && soldier.sees === false && foeDistance > cfg.chargeRange) foe = null;
    if (foe && now >= (soldier.nextShot ?? 0)) {
      const halted = foeDistance <= cfg.closeRange;
      soldier.nextShot = now + cfg.shootInterval * (halted ? .7 + random() * .6 : 1.1 + random() * .9);
      const chance = (halted ? .5 : .14) * (1 - foeDistance / (cfg.shootRange * 1.25)) * (foe.crouch ? .6 : 1) * (foe.postId ? .4 : 1);
      if (random() < chance) damageMember(foe, cfg.shootDamage * (.8 + random() * .4), 'rifle', soldier);
      emit({ type: 'sound', name: 'enemy-rifle', position: { x: soldier.x, y: groundHeight(soldier.x, soldier.z) + 1.4, z: soldier.z } });
      soldier.firedAt = now;
    }
    if (foe && foeDistance <= cfg.closeRange && foeDistance > cfg.chargeRange) {   // 近距离：停下跪射
      soldier.attacking = true;
      soldier.model.rotation.y = Math.atan2(-(foe.x - soldier.x), -(foe.z - soldier.z));
      soldier.model.position.set(soldier.x, groundHeight(soldier.x, soldier.z), soldier.z);
      return true;
    }
    if (foe && foeDistance <= cfg.chargeRange) {   // 白刃冲锋：直扑我军步兵，贴身时刺杀
      if (foeDistance < 1.6 && now >= soldier.nextAttack) { soldier.nextAttack = now + 1.4; damageMember(foe, 55, 'bayonet', soldier); }
      const dx = foe.x - soldier.x, dz = foe.z - soldier.z, len = Math.hypot(dx, dz) || 1;
      if (len > 1.2) { const step = terrainStep(groundHeight, soldier.x, soldier.z, dx / len, dz / len, cfg.speed * 1.25, dt);
        soldier.x += dx / len * (step.ok ? step.horizontal : cfg.speed * .3 * dt); soldier.z += dz / len * (step.ok ? step.horizontal : cfg.speed * .3 * dt); soldier.grade = step.grade; }
      soldier.walk = (soldier.walk ?? 0) + cfg.speed * dt * 3.2; soldier.attacking = false;
      soldier.model.rotation.y = Math.atan2(-dx, -dz);
      soldier.model.position.set(soldier.x, groundHeight(soldier.x, soldier.z), soldier.z);
      return true;
    }
    // 伴随步兵：以坦克为掩护，跟在车后 8–16 米、左右各约 5 米；坦克冲到阵地前（约 60 米内）或被毁后，转为正常冲锋
    const tank = soldier.escortOf ? vehicles.find(v => v.id === soldier.escortOf && v.health > 0) : null;
    if (tank && !(target && Math.hypot(target.point.x - tank.position.x, target.point.z - tank.position.z) < 60)) {
      const f = forward(tank.heading), side = { x: -f.z, z: f.x }, slot = soldier.escortSlot ?? 0;
      const back = 8 + Math.floor(slot / 2) % 3 * 4, lateral = (slot % 2 ? 1 : -1) * (3.5 + (slot % 4 < 2 ? 0 : 2.5));
      const gx = tank.position.x - f.x * back + side.x * lateral, gz = tank.position.z - f.z * back + side.z * lateral;
      const dx = gx - soldier.x, dz = gz - soldier.z, len = Math.hypot(dx, dz);
      soldier.attacking = false;
      if (len > 1.5) {
        const speed = cfg.speed * (len > 25 ? 1.3 : len > 6 ? 1 : .6);
        const step = terrainStep(groundHeight, soldier.x, soldier.z, dx / len, dz / len, speed, dt);
        const pace = step.ok ? step.horizontal : speed * .3 * dt;
        soldier.grade = step.grade; soldier.x += dx / len * pace; soldier.z += dz / len * pace;
        soldier.walk = (soldier.walk ?? 0) + pace * 3.2;
        soldier.model.userData.stride?.(now + soldier.offset);
        soldier.model.rotation.y = Math.atan2(-dx, -dz);
      } else soldier.model.rotation.y = tank.heading;
      soldier.model.position.set(soldier.x, groundHeight(soldier.x, soldier.z), soldier.z);
      return true;
    }
    // 冲向玩家小队所在位置（散兵线：左右拉开约 ±10 米），到达后再攻击阵位
    if (focusPoint && Math.hypot(focusPoint.x - soldier.x, focusPoint.z - soldier.z) > 30) {
      const dx = focusPoint.x + soldier.offset * 1.6 - soldier.x, dz = focusPoint.z - soldier.z, len = Math.hypot(dx, dz) || 1;
      const step = terrainStep(groundHeight, soldier.x, soldier.z, dx / len, dz / len, cfg.speed * (len > 120 ? 1.3 : 1), dt);   // 远处跑步前进
      const pace = step.ok ? step.horizontal / Math.max(dt, 1e-6) : cfg.speed * .25;
      soldier.grade = step.grade; soldier.attacking = false;
      soldier.x += dx / len * pace * dt; soldier.z += dz / len * pace * dt;
      soldier.walk = (soldier.walk ?? 0) + pace * dt * 3.2;
      soldier.model.userData.stride?.(now + soldier.offset);
      soldier.model.rotation.y = Math.atan2(-dx, -dz);
      soldier.model.position.set(soldier.x, groundHeight(soldier.x, soldier.z), soldier.z);
      return true;
    }
    if (!target) return true;
    soldier.attacking = best <= cfg.attackRange;   // 供人物表现层切换跪姿瞄准
    if (best > cfg.attackRange) {
      const dx = target.point.x + soldier.offset - soldier.x, dz = target.point.z - soldier.z, len = Math.hypot(dx, dz) || 1;
      const step = terrainStep(groundHeight, soldier.x, soldier.z, dx / len, dz / len, cfg.speed, dt);   // 坡地步态（与我军步兵共用）
      const pace = step.ok ? step.horizontal / Math.max(dt, 1e-6) : cfg.speed * .25;   // 石崖处手脚并用慢慢攀爬
      soldier.grade = step.grade;
      soldier.x += dx / len * pace * dt; soldier.z += dz / len * pace * dt;
      soldier.walk = (soldier.walk ?? 0) + pace * dt * 3.2;
      const legs = soldier.model.userData.legs;
      if (legs) { legs[0].rotation.x = Math.sin(soldier.walk) * .55; legs[1].rotation.x = -Math.sin(soldier.walk) * .55; }
      else soldier.model.userData.stride?.(now + soldier.offset);
      soldier.model.rotation.y = Math.atan2(-dx, -dz);
      soldier.model.position.set(soldier.x, groundHeight(soldier.x, soldier.z) + Math.abs(Math.sin(now * 9 + soldier.offset)) * .06, soldier.z);
    } else if (now >= soldier.nextAttack) {
      soldier.nextAttack = now + cfg.attackInterval * (.8 + random() * .4);
      damageEmplacement(target.point, cfg.attackDamage, { team: 'enemy' }, now); postHurt(target, soldier, 'grenade');
      explosion({ x: target.point.x + (random() - .5) * 2, y: target.floor + .6, z: target.point.z + (random() - .5) * 2 }, .5);
      if (target.id === controlledId) emit({ type: 'toast', text: '日军步兵正在用手榴弹攻击你的阵位！', alert: true, voice: 'jiangyin-grenades' });
    }
    return true;
  }


  // ---------- 第二阶段：我军守备班（v23 起由 AI 据守，玩家不再操纵步兵，只在两岸炮位之间切换） ----------
  // 11 人班编制与其他地图一致；在最前沿阵地前方散开据守、射击视线内的日军步兵；全班阵亡后 S.respawnSeconds 秒补充一个班
  const S = JIANGYIN_SQUAD;
  const squad = [], grenades = [];
  let mode = 'post';                  // 'post'：操纵火力点；'infantry'：步兵；第一阶段与演出时为 'post'
  let memberId = null, squadSerial = 0, squadRespawnAt = null, memberSwitchAt = null, deployed = false;
  const ROLE = index => jiangyinSquadLoadout(index).label;   // 与其他地图相同的 11 人班编制
  const controlledMember = () => squad.find(m => m.id === memberId) ?? null;
  const liveMembers = () => squad.filter(m => m.dead === null);
  const memberEye = m => ({ x: m.x, y: m.y + (m.crouch ? 1.05 : S.eye), z: m.z });
  const viewEye = { id: null, y: null, grade: 0 };
  let motionStrength = 1;   // 与其他地图共用的“镜头晃动强度”玩家设置（0–1），由页面层传入
  const memberBob = () => .018 * motionStrength / (1 + 4 * Math.abs(viewEye.grade));
  const viewDirection = (heading, pitch) => ({ x: -Math.sin(heading) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(heading) * Math.cos(pitch) });
  const memberName = m => `第${m.index + 1}名 · ${ROLE(m.index)}`;
  function squadSpawnPoint() {
    const order = ['huangshan-east', 'south-mg', 'huangshan-west', 'north-battery', 'north-mg'];   // 先在下游最前沿的长山炮台集结，正面迎击日军
    const post = order.map(postById).find(p => p && alive(p)) ?? postById(order[0]);
    const f = forward(post.point.heading);
    const r = { x: -f.z, z: f.x };   // 炮位后方约 11 米：炮台、高射炮、机枪堡都在 15–60 米内，几秒就能跑到
    return { x: post.point.x - f.x * 11 - r.x * 4, z: post.point.z - f.z * 11 - r.z * 4, heading: post.point.heading, post };
  }
  function deploySquad(reason = 'deploy') {
    for (const m of squad) scene.remove(m.model);
    squad.length = 0;
    const at = squadSpawnPoint(), serialId = ++squadSerial, f = forward(at.heading), r = { x: -f.z, z: f.x };
    for (let i = 0; i < S.members; i++) {
      const loadout = jiangyinSquadLoadout(i), weapon = loadout.model, col = i % 4 - 1.5, row = Math.floor(i / 4);
      // 守备班散开据守：左右间隔约 6 米、前后约 5 米（避免一颗航弹炸倒全班）
      let x = at.x + r.x * col * 6 - f.x * row * 5, z = at.z + r.z * col * 6 - f.z * row * 5;
      if (groundHeight(x, z) < .3) { x = at.x - f.x * row * 5; z = at.z - f.z * row * 5; }
      const model = makeSoldier('friendly', weapon);
      const m = { id: `squad-${serialId}-${i}`, index: i, x, y: groundHeight(x, z), z, heading: at.heading, pitch: 0, health: S.health,
        role: loadout.role, weapon: 'primary', rifle: createRifleState(weapon), reserve: S.reserve[weapon] ?? S.reserve.rifle, grenades: S.grenades, model, dead: null,
        attacking: false, hidden: false, postId: null, nextThink: random() * .5, target: null, nextShot: 0, crouch: false, speed: 0, walk: 0 };
      model.position.set(x, m.y, z); model.rotation.y = m.heading; scene.add(model);
      squad.push(m);
    }
    memberId = null; squadRespawnAt = null; memberSwitchAt = null;   // 守备班全部由 AI 控制
    if (reason !== 'deploy') emit({ type: 'toast', text: `守备班（${S.members}人）已补充到${at.post.name}前沿`, voice: 'jiangyin-squad-rally' });
  }
  // 第二阶段开始：玩家直接接管最前沿的岸防炮（长山炮台；已毁则按 holdKey 顺序找下一个尚存炮位）
  const holdOrder = () => shorePosts().slice().sort((a, b) => Number(a.holdKey || 9) - Number(b.holdKey || 9));
  // 炮位被毁后转移：先找同岸最近的尚存炮位，同岸全毁再去对岸
  function nearestShorePost(from) {
    const live = shorePosts().filter(alive);
    if (!from) return live[0] ?? null;
    const score = p => Math.hypot(p.point.x - from.point.x, p.point.z - from.point.z) + (p.bank === from.bank ? 0 : 5000);
    return live.sort((a, b) => score(a) - score(b))[0] ?? null;
  }
  function takeShorePost() {
    const post = holdOrder().find(alive);
    if (!post) return;
    mode = 'post';
    beginTransfer(post.id, 'deploy', 1.6);
    emit({ type: 'deploy', reason: 'deploy', post: post.name });
    emit({ type: 'toast', alert: true, voice: 'jiangyin-hold',
      text: `接管${post.name} · 1–8 或 Q/E 切换两岸炮位：岸防炮打舰、高射炮打飞机和坦克、高射机枪打飞机和步兵` });
  }
  function startReload(m, byPlayer = false) {
    if (m.rifle.action === 'reload' || m.rifle.ammo >= infantryWeaponProfile(m.rifle).magazine) return;
    if (m.reserve <= 0) { if (byPlayer) emit({ type: 'toast', text: '备弹已用完' }); return; }
    reloadRifle(m.rifle);
  }
  function advanceMemberWeapon(m, dt) {
    const before = m.rifle.ammo, events = advanceRifle(m.rifle, dt);
    if (events.includes('ready')) {
      const added = m.rifle.ammo - before;
      if (added > m.reserve) { m.rifle.ammo = before + m.reserve; m.reserve = 0; } else m.reserve -= added;
    }
  }
  function fireRifle(m, byPlayer, { aiming = false, aimAt = null, error = 0 } = {}) {
    if (m.rifle.ammo <= 0) { startReload(m, byPlayer); return false; }
    if (!shootRifle(m.rifle, false)) return false;
    const profile = infantryWeaponProfile(m.rifle), eye = memberEye(m);
    let dir;
    if (aimAt) {
      const dx = aimAt.x - eye.x, dy = aimAt.y - eye.y, dz = aimAt.z - eye.z, len = Math.hypot(dx, dy, dz) || 1;
      dir = { x: dx / len + gauss() * error, y: dy / len + gauss() * error, z: dz / len + gauss() * error };
    } else {
      const spread = (aiming ? .0025 : .016) + (m.speed > .6 ? .018 : 0) + (profile.automatic ? .006 : 0);
      dir = viewDirection(m.heading + gauss() * spread, m.pitch + gauss() * spread);
    }
    const len = Math.hypot(dir.x, dir.y, dir.z); dir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const hit = traceRay(eye, dir, S.rifleRange);
    if (hit?.kind === 'troop') {
      const firstKill = damageTroop(hit.target, S.rifleDamage, byPlayer);
      if (byPlayer) emit({ type: 'hit', kind: 'troop', firstKill });
    }
    else if (hit?.kind === 'tank' || hit?.kind === 'plane') damageVehicle(hit.target, hit.kind === 'plane' ? 4 : 1, byPlayer);
    if (byPlayer) state.stats.shots++;
    const muzzle = { x: eye.x + dir.x * .9, y: eye.y - .08 + dir.y * .9, z: eye.z + dir.z * .9 };
    if (effects && camera.position.distanceTo(new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z)) < 400) effects.muzzle(muzzle, dir);
    emit({ type: 'sound', name: profile.automatic ? 'lmg' : 'rifle', position: muzzle, player: byPlayer });
    if (m.rifle.ammo === 0 && !profile.automatic) startReload(m, byPlayer);
    return true;
  }
  const grenadeGeometry = new THREE.CylinderGeometry(.045, .045, .2, 8), grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x3b3a30, roughness: .8 });
  function throwGrenade(m) {
    if (m.grenades <= 0) { emit({ type: 'toast', text: '手榴弹已用完' }); m.weapon = 'primary'; emit({ type: 'equip', weapon: 'primary' }); return; }
    m.grenades--;
    const eye = memberEye(m), d = viewDirection(m.heading, m.pitch + .22), v = S.grenade.speed;
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial); scene.add(mesh);
    grenades.push({ x: eye.x + d.x * .5, y: eye.y + d.y * .5 - .1, z: eye.z + d.z * .5, vx: d.x * v, vy: d.y * v + 1.5, vz: d.z * v,
      fuse: now + S.grenade.fuse, mesh });
    emit({ type: 'sound', name: 'throw', position: eye, player: true });
    if (m.grenades === 0) { m.weapon = 'primary'; emit({ type: 'equip', weapon: 'primary' }); }
  }
  function advanceGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.vy -= GRAVITY * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const ground = groundHeight(g.x, g.z), floor = Math.max(ground, ground < 0 ? ground : 0) + .06;
      if (g.y <= floor) {
        g.y = floor;
        if (ground < 0) { g.vx *= .3; g.vz *= .3; g.vy = -.4; }               // 落水下沉
        else { g.vy = Math.abs(g.vy) * .25; g.vx *= .45; g.vz *= .45; }       // 落地弹跳、滚动
      }
      g.mesh.position.set(g.x, g.y, g.z); g.mesh.rotation.x += dt * 9;
      if (now >= g.fuse) {
        const p = { x: g.x, y: Math.max(g.y, 0), z: g.z };
        blast(p, S.grenade.radius, S.grenade.damage, 'friendly', true);
        explosion(p, .6, ground < -.3);
        scene.remove(g.mesh); grenades.splice(i, 1);
      }
    }
  }
  // cause：伤害来源（rifle 日军步枪、bayonet 刺刀、ship-mg 日舰机枪、ship-shell 舰炮、tank-shell 坦克炮、tank-mg 坦克机枪、
  // plane-mg 飞机扫射、bomb 航弹、grenade 手榴弹、post-destroyed 炮位被毁），用于阵亡提示与统计
  const CAUSE_LABEL = Object.freeze({ rifle: '日军步枪', bayonet: '日军刺刀', 'ship-mg': '日舰机枪', 'ship-shell': '日舰炮弹', 'tank-shell': '坦克炮',
    'tank-mg': '坦克机枪', 'plane-mg': '敌机扫射', bomb: '敌机航弹', 'post-destroyed': '炮位被毁', shell: '炮弹', grenade: '日军手榴弹', unknown: '敌火' });
  function damageMember(m, amount, cause = 'unknown', from = null) {
    if (m.dead !== null || amount <= 0) return;
    m.health -= amount; m.lastHitBy = cause;
    if (m.id === memberId && from) {   // 受击方向（相对玩家朝向，0 = 正前方，顺时针为正），页面在屏幕边缘画红色弧标
      const bearing = Math.atan2(-(from.x - m.x), -(from.z - m.z));
      emit({ type: 'hurt-from', angle: wrap(m.heading - bearing), cause: CAUSE_LABEL[cause] ?? '敌火' });
    }
    const tally = state.stats.squadDamage ??= {}; tally[cause] = (tally[cause] ?? 0) + Math.min(amount, m.health + amount);
    if (m.id === memberId) emit({ type: 'hurt', amount, health: Math.max(0, m.health), fatal: m.health <= 0 });
    if (m.health > 0) return;
    m.health = 0; m.dead = now; m.attacking = false; state.stats.squadLost = (state.stats.squadLost ?? 0) + 1;
    const deaths = state.stats.squadDeaths ??= {}; deaths[cause] = (deaths[cause] ?? 0) + 1;
    if (m.postId) { const post = postById(m.postId); if (post && alive(post)) post.point.operatorId = 'crew'; m.postId = null; }
    if (memberId !== null && m.id === memberId) {
      if (mode === 'post') { mode = 'infantry'; controlledId = null; }
      const next = liveMembers()[0];
      const by = CAUSE_LABEL[cause] ?? '敌火';
      emit({ type: 'toast', alert: true, text: next ? `${memberName(m)}被${by}击中阵亡 · 转为操纵${memberName(next)}` : `全班阵亡（${by}）` });
      if (next) memberSwitchAt = now + 1.4;
      else { squadRespawnAt = now + S.respawnSeconds; emit({ type: 'toast', alert: true, text: `全班阵亡，${S.respawnSeconds} 秒后新的步兵小队在炮台附近集结` }); }
    }
  }
  function enterPost(m, post) {
    m.postId = post.id; m.hidden = true; mode = 'post'; controlledId = post.id; post.point.operatorId = 'player';
    transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration: .5, local: true };
    emit({ type: 'transfer', id: post.id, name: post.name, reason: 'enter' });
  }
  function leavePost(m) {
    const post = postById(m.postId);
    m.postId = null; mode = 'infantry'; controlledId = null;
    if (post) {
      if (alive(post)) post.point.operatorId = 'crew';
      const f = forward(post.point.heading);
      for (const back of [3, 5, 8]) {
        const x = post.point.x - f.x * back, z = post.point.z - f.z * back;
        if (groundHeight(x, z) > .3) { m.x = x; m.z = z; break; }
      }
      m.y = groundHeight(m.x, m.z); m.heading = post.point.yaw; m.pitch = 0;
    }
    transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration: .5, local: true };
    emit({ type: 'transfer', id: null, name: memberName(m), reason: 'leave' });
  }
  function nearbyPost(m) {
    return shorePosts().filter(alive).map(post => ({ post, d: Math.hypot(post.point.x - m.x, post.point.z - m.z) }))
      .filter(item => item.d <= S.interactRange).sort((a, b) => a.d - b.d)[0]?.post ?? null;
  }
  function interact() {
    const m = controlledMember();
    if (!m || m.dead !== null) return;
    if (m.postId) { leavePost(m); return; }
    const post = nearbyPost(m);
    if (post) enterPost(m, post);
    else emit({ type: 'toast', text: '附近没有可操作的炮位（走到炮位旁按 F）' });
  }
  function cycleMember() {
    const current = controlledMember(), alive = liveMembers();
    if (alive.length < 2 && current?.dead === null) { emit({ type: 'toast', text: '小队没有其他存活队员' }); return; }
    if (current?.postId) leavePost(current);
    const start = Math.max(0, squad.indexOf(current));
    for (let n = 1; n <= squad.length; n++) {
      const next = squad[(start + n) % squad.length];
      if (next.dead !== null || next === current) continue;
      if (current) current.hidden = false;
      memberId = next.id; mode = 'infantry'; controlledId = null; next.target = null;
      transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration: .7 };
      emit({ type: 'toast', text: `切换到${memberName(next)}（${infantryWeaponProfile(next.rifle).name}）` });
      emit({ type: 'equip', weapon: next.weapon });
      return;
    }
  }
  function equip(m, weapon) {
    if (weapon === 'grenade' && m.grenades <= 0) { emit({ type: 'toast', text: '手榴弹已用完' }); return; }
    if (!['primary', 'grenade'].includes(weapon)) { emit({ type: 'toast', text: '本关步兵班未配备该装备' }); return; }
    if (m.weapon === weapon) return;
    m.weapon = weapon; emit({ type: 'equip', weapon });
  }
  function walkMember(m, dx, dz, speed, dt) {
    const area = JIANGYIN_RULES.playArea;
    const step = terrainStep(groundHeight, m.x, m.z, dx, dz, speed, dt);   // 坡地步态：上坡慢、下坡略快、过陡不可攀（src/terrain-gait.js，各地图可复用）
    if (!step.ok || groundHeight(step.x, step.z) < .3 || step.x < area.minX || step.x > area.maxX || step.z < area.minZ || step.z > area.maxZ) {
      m.speed = 0; m.grade = 0; return false;                                         // 不下水、不出界、太陡的石崖爬不上去
    }
    m.x = step.x; m.z = step.z; m.y = groundHeight(m.x, m.z); m.speed = step.horizontal / Math.max(dt, 1e-6); m.grade = step.grade;
    m.walk += step.path; m.moveHeading = Math.atan2(-dx, -dz);
    return true;
  }
  function controlInfantry(dt, input) {
    if (Number.isFinite(input.motionStrength)) motionStrength = Math.max(0, Math.min(1, input.motionStrength));
    const m = controlledMember();
    if (!m || m.dead !== null || m.postId) return;
    if (input.reload) startReload(m, true);
    if (input.equip) equip(m, input.equip);
    if (transfer) return;   // 镜头转换中不移动、不开火
    const sensitivity = LOOK_SENSITIVITY * (input.sensitivity ?? 1);
    m.heading = wrap(m.heading - (input.lookDX ?? 0) * sensitivity);
    m.pitch = Math.max(-1.3, Math.min(1.3, m.pitch - (input.lookDY ?? 0) * sensitivity));
    if (input.crouch) m.crouch = !m.crouch;
    const move = input.move ?? { x: 0, z: 0 }, f = forward(m.heading), r = { x: -f.z, z: f.x };
    let dx = f.x * move.z + r.x * move.x, dz = f.z * move.z + r.z * move.x;
    const len = Math.hypot(dx, dz);
    if (len > 0) walkMember(m, dx / len, dz / len, input.aiming || m.crouch ? S.aimWalk : input.sprint && move.z > 0 ? S.run : S.walk, dt);
    else m.speed = 0;
    if (m.weapon === 'primary') {
      if (infantryWeaponProfile(m.rifle).automatic ? input.fireHeld : input.firePressed) fireRifle(m, true, { aiming: Boolean(input.aiming) });
    } else if (input.firePressed) throwGrenade(m);
    m.attacking = Boolean(input.aiming || input.fireHeld);
  }
  function memberTarget(m) {
    const eye = memberEye(m);
    let best = null, bestDistance = S.rifleRange;
    for (const soldier of troops) {
      if (soldier.dead !== null) continue;
      const d = Math.hypot(soldier.x - m.x, soldier.z - m.z);
      if (d >= bestDistance) continue;
      const aim = { x: soldier.x, y: groundHeight(soldier.x, soldier.z) + 1.1, z: soldier.z }, len = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
      const dir = { x: (aim.x - eye.x) / len, y: (aim.y - eye.y) / len, z: (aim.z - eye.z) / len };
      if (rayTerrain(eye, dir, len - 1) !== null) continue;   // 被山体挡住
      best = soldier; bestDistance = d;
    }
    return best;
  }
  function advanceMember(m, dt) {
    advanceMemberWeapon(m, dt);
    if (m.dead !== null) return;
    const controlled = m.id === memberId;
    m.hidden = controlled && (mode === 'infantry' || Boolean(m.postId));
    if (!controlled) {
      if (now >= m.nextThink) { m.nextThink = now + .45 + random() * .3; m.target = memberTarget(m); }
      if (m.target?.dead !== null) m.target = null;
      // 队形：跟随玩家操纵的队员（或其所在炮位），在其后方与两侧散开
      const lead = controlledMember();
      const anchor = lead?.postId ? postById(lead.postId)?.point : lead;
      if (anchor && lead?.dead === null) {
        const h = lead.postId ? anchor.heading : lead.heading, f = forward(h), r = { x: -f.z, z: f.x };
        // 散开队形：左右间隔约 4 米、前后三排间隔约 4 米（原先 2.4 米 / 2.2 米，一枚航弹就能炸倒全班）
        const side = (m.index % 2 ? 1 : -1) * (3 + Math.ceil(m.index / 2) * 4), back = 4 + (m.index % 3) * 4 + (lead.postId ? 4 : 0);
        const gx = anchor.x - f.x * back + r.x * side, gz = anchor.z - f.z * back + r.z * side;
        const d = Math.hypot(gx - m.x, gz - m.z);
        if (d > (m.target ? 18 : 2.5)) walkMember(m, (gx - m.x) / d, (gz - m.z) / d, d > 14 ? S.run : S.walk, dt);
        else m.speed = 0;
      } else m.speed = 0;
      if (m.target) {
        const t = m.target, ty = groundHeight(t.x, t.z) + 1.1;
        m.heading = Math.atan2(-(t.x - m.x), -(t.z - m.z));
        m.attacking = true;
        if (now >= m.nextShot && m.rifle.action === 'idle') {
          const d = Math.hypot(t.x - m.x, t.z - m.z), auto = infantryWeaponProfile(m.rifle).automatic;
          if (fireRifle(m, false, { aimAt: { x: t.x, y: ty, z: t.z }, error: .004 + d / 9000 + (m.speed > .5 ? .02 : 0) }))
            m.nextShot = now + (auto ? .25 : 1.4 + random() * 1.6);
          if (auto && now > (m.burstEnd ??= now + 1.2)) { m.nextShot = now + 1.5 + random(); m.burstEnd = undefined; }
        }
      } else { m.attacking = false; if (m.speed > .2 && m.moveHeading !== undefined) m.heading = m.moveHeading; }   // 面朝行进方向（不再“倒着走”）
    }
    m.model.position.set(m.x, m.y, m.z); m.model.rotation.y = m.heading;
    if (!m.model.userData.nativeSoldier) m.model.visible = !m.hidden;
  }
  function advanceSquad(dt, input) {
    if (!deployed) return;
    // 全班阵亡兜底：同一枚航弹/炮弹可能先炸死当前操控的队员（此时还有活着的队友，于是排队切人），随后同一帧把其余队友也炸死，
    // 旧逻辑因此永远不会安排重生。现在只要全班无人存活、又没有排定集结，就立即排定重生。
    if (squadRespawnAt === null && liveMembers().length === 0) {
      memberSwitchAt = null; squadRespawnAt = now + S.respawnSeconds;
      emit({ type: 'toast', alert: true, text: `前沿守备班全部阵亡，${S.respawnSeconds} 秒后补充` });
    }
    if (squadRespawnAt !== null && now >= squadRespawnAt && shorePosts().some(alive)) deploySquad('respawn');
    if (memberSwitchAt !== null && now >= memberSwitchAt) {
      memberSwitchAt = null;
      const next = liveMembers()[0];
      if (next) { memberId = next.id; mode = 'infantry'; controlledId = null;
        transfer = { from: camera.position.clone(), fromQuat: camera.quaternion.clone(), t: 0, duration: .8 }; emit({ type: 'equip', weapon: next.weapon }); }
    }
    const m = controlledMember();
    if (m && m.dead === null && memberSwitchAt === null) {
      if (input.interact) interact();
      if (input.cycleMember) cycleMember();
      if (mode === 'infantry') controlInfantry(dt, input);
    }
    for (const member of squad) advanceMember(member, dt);
    advanceGrenades(dt);
  }

  // ---------- 自沉封江：阻塞船先四散，再一艘接一艘驶向最窄处就位、引爆自沉 ----------
  const wreckZones = [];
  const activePhase = () => state.phase === 'naval' || state.phase === 'scuttle' || state.phase === 'hold';
  const blockships = BLOCKSHIPS.map((spec, index) => {
    const model = createBlockshipModel({ kind: spec.kind, variant: spec.variant, length: spec.length, beam: spec.beam, seed: 101 + index * 37, name: spec.name });
    const ship = { spec, model, x: spec.start[0], z: spec.start[1], heading: -Math.PI / 2, speed: 0, y: 0, roll: 0, pitch: 0,   // 待命：已生火、船首朝下游堵塞点
      state: 'anchored', departAt: 0, chargesAt: 0, charges: 0, sinkAt: 0 };
    scene.add(model); syncBlockship(ship);
    return ship;
  });
  // 登岸 35 秒后第二阶段开始计时；尚未就位的阻塞船在背景中继续驶向堵塞点自沉
  const SCUTTLE = { disperse: 3, spacing: 1.3, speed: 15, charges: 3, sinkSeconds: 6, linger: 3, holdAfterDeploy: 35 };
  function syncBlockship(ship) {
    ship.model.position.set(ship.x, ship.y + Math.sin(now * 1.1 + ship.spec.length) * .06, ship.z);
    ship.model.rotation.set(ship.pitch, ship.heading, ship.roll, 'YXZ');
    for (const mesh of ship.model.userData.wake ?? []) mesh.visible = ship.speed > .8;
  }
  function steerBlockship(ship, goal, dt, speed) {
    const dx = goal.x - ship.x, dz = goal.z - ship.z, distance = Math.hypot(dx, dz);
    const desired = Math.atan2(-dx, -dz);
    const rate = Math.max(.03, Math.abs(ship.speed) / (ship.spec.length * 1.6));   // 回转半径约 1.6 倍船长
    ship.heading = wrap(ship.heading + Math.max(-rate * dt, Math.min(rate * dt, wrap(desired - ship.heading))));
    // 目标在回转圈内侧（航向偏差大）时减速，靠低速时更小的回转半径转过来，避免绕着目标打转
    const error = Math.abs(wrap(desired - ship.heading));
    const target = distance < 12 ? Math.max(1.2, distance * .4) : error > .5 ? Math.max(1.6, speed * (1 - error / Math.PI)) * (distance < ship.spec.length * 2 ? .4 : 1) : speed;
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
    // 演出直接从第一艘阻塞船自沉开始：先在后台快进航渡过程（不出声、不出提示），第一艘船抵达就位点、即将起爆时才开始播放，
    // 镜头直接切到它旁边；其余船按原先的间隔陆续跟进。登岸计时也从这里算起。
    prerolling = true;
    for (let guard = 0; blockships[0].state !== 'scuttling' && guard < 3000; guard++) advanceScuttle(.1);
    prerolling = false;
    scuttleStart = state.scuttleTime; blockships[0].chargesAt = now + 1.5;   // 留 1.5 秒看清船再起爆
    { const focus = blockships[0], side = focus.z < 0 ? -1 : 1;
      cinematic.look.set(focus.x, 3, focus.z); cinematic.position.set(focus.x - 230, 98, focus.z + side * 240); }
    emit({ type: 'phase', phase: 'scuttle' });
    emit({ type: 'toast', text: '我军三舰全部沉没 · 江防总指挥部下令：阻塞船自沉封江！（空格可直接接管岸防炮）', alert: true, voice: 'jiangyin-scuttle' });
  }
  let deployedAt = 0, prerolling = false, scuttleStart = 0;
  function deployNow() {
    if (deployed) return;
    deployed = true; deployedAt = state.scuttleTime; deploySquad('deploy'); takeShorePost();
  }
  function advanceScuttle(dt) {
    const t = state.scuttleTime += dt;
    const sunkCount = blockships.filter(ship => ship.state === 'sinking' && now - ship.sinkAt > SCUTTLE.sinkSeconds * .8 || ship.state === 'sunk').length;
    const shown = t - scuttleStart;   // 玩家实际看到的演出时长（不含后台快进）
    if (!prerolling && !deployed && (shown >= S.deployAfter && sunkCount >= S.deployAfterSunk || shown >= S.deployLatest)) deployNow();
    for (const ship of blockships) {
      const [sx, sz, sh] = ship.spec.slot;
      if (ship.state === 'disperse') {          // 四散开来：离开锚地，各自驶向等待位置
        steerBlockship(ship, { x: ship.spec.hold[0], z: ship.spec.hold[1] }, dt, 7);
        if (t >= ship.departAt) {
          ship.state = 'transit';
          if (!prerolling && ship.spec.flagship) emit({ type: 'toast', text: `${ship.spec.name}驶向江面最窄处` });
        }
      } else if (ship.state === 'transit') {    // 自上游顺流而下：先在江心转向，船首对准较近的一岸，再沿船首方向驶入就位点
        if (!ship.path) {
          const fs = forward(sh), r = ship.spec.length * 1.6;
          const entry = { x: sx - fs.x * 110, z: sz - fs.z * 110 };
          ship.path = [{ x: entry.x - r * 1.4, z: entry.z - fs.z * r }, entry, { x: sx, z: sz }];
        }
        const goal = ship.path[0], last = ship.path.length === 1;
        const distance = steerBlockship(ship, goal, dt, last ? 5 : SCUTTLE.speed);
        if (!last && distance < 35) ship.path.shift();
        else if (last && distance < 22) {   // 抵近后减速，小幅修正到就位点
          ship.settling ??= { x: ship.x, z: ship.z, heading: ship.heading, t: 0 };
          const k = Math.min(1, (ship.settling.t += dt) / 3.5), e = k * k * (3 - 2 * k);
          ship.x = ship.settling.x + (sx - ship.settling.x) * e; ship.z = ship.settling.z + (sz - ship.settling.z) * e;
          ship.heading = wrap(ship.settling.heading + wrap(sh - ship.settling.heading) * e); ship.speed = 2.5 * (1 - e);
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
            if (ship.spec.flagship || !deployed) emit({ type: 'toast', text: ship.spec.flagship ? `旗舰${ship.spec.name}自沉 · 江口已被阻断` : `${ship.spec.name}自沉` , alert: Boolean(ship.spec.flagship), voice: ship.spec.flagship ? 'jiangyin-river-sealed' : undefined });
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
    if (!prerolling && state.phase === 'scuttle' && (last.state === 'sunk' && now - last.sinkAt > SCUTTLE.sinkSeconds + SCUTTLE.linger ||
      deployed && t >= deployedAt + SCUTTLE.holdAfterDeploy)) beginHold();
  }
  function skipScuttle() {
    for (const ship of blockships) if (ship.state !== 'sunk') { ship.sinkAt = now; sinkBlockship(ship, true); }
    deployNow();
    beginHold();
  }
  function beginHold() {
    if (state.phase !== 'scuttle') return;
    state.phase = 'hold'; state.elapsed = 0; state.waveIndex = 0;
    // 第二阶段保留状态最好的舰艇，其余撤退。
    const afloat = ships.filter(ship => ship.sinking === null).sort((a, b) => b.health / b.cfg.health - a.health / a.cfg.health);
    afloat.forEach((ship, i) => { if (i >= HOLD_FLEET.max) beginWithdraw(ship); });
    for (const ship of ships) if (!ship.withdrawing) assignHold(ship);
    deployNow();
    emit({ type: 'phase', phase: 'hold' });
    emit({ type: 'toast', text: `第二阶段 · 死守两岸阵地 ${Math.round(JIANGYIN_RULES.durationSeconds / 60)} 分钟：日军海空来攻，目标是摧毁我军全部阵地`, alert: true });
  }

  // 烟源：日舰烟囱煤烟、正在下沉的舰船、开场被炸沉的宁海/平海、我方炮艇
  function smokeSources() {
    const list = [];
    for (const ship of ships) {
      if (ship.sinking === null) list.push({ object: ship.model, points: ship.model.userData.funnels ?? [], rate: 5, shade: .2, life: 10 });
      else if (now - ship.sinking < 30) list.push({ object: ship.model, points: [[0, 5, 0, ship.cfg.beam]], rate: 16, shade: .1, life: 14, rise: 3.5, grow: 2.4, fire: true });
      if (ship.sinking === null && ship.health < ship.cfg.health * .5) list.push({ object: ship.model, points: [[0, ship.cfg.height * .6, -ship.cfg.length * .15, 3]], rate: 8, shade: .09, life: 12, rise: 3, grow: 2, fire: true });
      if (ship.sinking === null && ship.fires?.length) {   // 每个被击中的部位：持续燃烧冒黑烟，伤得越重越猛
        const hurt = 1 - Math.max(0, ship.health) / ship.cfg.health;
        list.push({ object: ship.model, points: ship.fires.map(f => [f.local[0], f.local[1], f.local[2], 1.2 + hurt * 1.5]),
          rate: 2.5 + hurt * 4, shade: .1, life: 9 + hurt * 5, rise: 3, grow: 1.6 + hurt, fire: true });
      }
    }
    for (const post of shipPosts()) if (!post.boat.sunk) list.push(alive(post)
      ? { object: post.boat.hull, points: post.boat.hull.userData.funnels ?? [], rate: post.point.health < post.point.maxHealth * .5 ? 7 : 3, shade: post.point.health < post.point.maxHealth * .5 ? .12 : .28 }
      : { object: post.boat.hull, points: [[0, 8, -10, 6], [0, 7, 12, 5]], rate: 14, shade: .08, life: 14, rise: 3.4, grow: 2.6, fire: true });
    // 被毁的岸上阵位：软粒子烟柱（与舰船烟同一体积烟系统），不再用半透明多边形球。
    // 起火后约 40 秒内是带火光的浓黑烟柱，之后逐渐转为稀薄的灰烟，约 3 分钟后熄灭；几个烟源错开，形成不规则的烟柱。
    for (const post of posts) {
      if (post.boat || post.destroyedAt === null) continue;
      const age = now - post.destroyedAt;
      if (age > 180) continue;
      if (!post.smokeAnchor) {
        post.smokeAnchor = new THREE.Object3D();
        post.smokeAnchor.position.set(post.point.x, post.floor, post.point.z); post.smokeAnchor.rotation.y = random() * Math.PI * 2;
        post.smokeAnchor.updateMatrixWorld();
      }
      const fierce = Math.max(0, 1 - age / 40), fade = Math.max(0, 1 - age / 180);
      list.push({ object: post.smokeAnchor, points: [[0, 1.2, 0, 2.2], [1.6, .8, -1.1, 1.4], [-1.3, .9, 1.4, 1.2]],
        rate: 1 + 5 * fierce + 1.5 * fade, shade: .07 + .3 * (1 - fierce), life: 9 + 6 * fierce, rise: 2.2 + 1.6 * fierce,
        grow: 1.6 + .8 * fierce, fire: fierce > .3 });
    }
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
      for (const wave of dueNavalWaves(state)) {
        for (const type of wave.ships) spawnShip(type, wave.at <= 10);
        if (wave.air) spawnAirFlight();   // 第一阶段：日机主攻我军舰艇
      }
      // 逐步增援：在场日舰不足当前目标数（2 艘起，每 14 秒 +1，最多 7 艘）时补一艘，被击沉的也会补上
      const afloat = ships.filter(ship => ship.sinking === null).length;
      if (afloat < navalTarget(state.navalTime) && now >= (state.reinforceAt ?? 0)) {
        state.reinforceAt = now + NAVAL_RAMP.gap;
        spawnShip(NAVAL_RAMP.roster[(state.rampIndex = (state.rampIndex ?? -1) + 1) % NAVAL_RAMP.roster.length]);
      }
      for (const ship of blockships) syncBlockship(ship);
    } else if (state.phase === 'scuttle') {
      if (input.skipIntro && !deployed) deployNow();   // 空格：提前接管岸防炮（演出继续在背景进行）
      advanceScuttle(dt);
    } else if (state.phase === 'hold') {
      state.elapsed += dt;
      if (blockships.some(ship => ship.state !== 'sunk')) advanceScuttle(dt);
      for (const wave of dueWaves(state)) {
        if (wave.air) spawnAirFlight();
      }
    }
    if (activePhase()) {
      if ((state.phase === 'naval' || deployed) && input.switchPost) switchPost(input.switchPost);
      if (input.toggleView && mode === 'post' && (state.phase === 'naval' || deployed)) toggleView();
      for (const post of posts) advanceEmplacement(post.point, dt, now);
      if (mode === 'post' && (state.phase === 'naval' || deployed)) controlPlayer(dt, input);
      for (const post of shipPosts()) moveBoat(post, dt, post.id === controlledId && mode === 'post' && state.phase === 'naval' && !transfer ? input : null);
      for (const post of posts) if (alive(post) && (post.id !== controlledId || state.phase === 'scuttle' && !deployed)) operateAI(post, dt);
      advanceSquad(dt, input);
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
    advanceShells(dt); advanceTracers(dt); topUpHoldFleet();
    updateFlags(now, .75 + .25 * Math.sin(now * .31) * Math.sin(now * .17 + 1));   // 旗帜飘动，风力时强时弱
    for (const post of posts) {
      post.model.userData.update?.(); post.model.position.y = post.floor;
      if (post.boat) attachToHull(post);
      if (alive(post) || post.destroyedAt !== null) continue;
      post.destroyedAt = now; post.point.operatorId = null;
      if (post.boat) {
        const f = forward(post.boat.heading);
        for (const o of [-.25, .1, .3]) explosion({ x: post.boat.x + f.x * post.boat.cfg.length * o, y: 4, z: post.boat.z + f.z * post.boat.cfg.length * o }, 2.6);
        emit({ type: 'toast', text: `${post.name}被日舰击中要害，开始下沉！`, alert: true, voice: 'jiangyin-ship-hit' });
      } else {
        if (post.model.userData.destroy) post.model.userData.destroy();
        else { post.model.rotation.z = .35; post.model.position.y = post.floor - .3; }
        explosion({ x: post.point.x, y: post.floor + 1, z: post.point.z }, 2);
        emit({ type: 'toast', text: `${post.name}被摧毁`, alert: true, voice: 'jiangyin-post-lost' });
      }
      if (post.id === controlledId && (state.phase === 'naval' || deployed)) pendingAutoSwitch = now + 1.4;
      for (const m of squad) if (m.postId === post.id && m.dead === null) {   // 炮位被毁：炮位上的玩家被震出、受伤
        leavePost(m); damageMember(m, 45, 'post-destroyed');
        if (m.dead === null) emit({ type: 'toast', alert: true, text: `${post.name}被毁，你被气浪掀出炮位` });
      }
    }
    if (pendingAutoSwitch !== null && now >= pendingAutoSwitch && (state.phase === 'naval' || deployed)) {
      pendingAutoSwitch = null;
      const next = deployed ? nearestShorePost(postById(controlledId))?.id : nextPostId(eligiblePosts(), controlledId, 1);
      if (next) beginTransfer(next, 'destroyed', 1.3);
    }
    // 第一阶段结束：三舰全部完全沉没 → 自沉封江
    if (state.phase === 'naval' && shipPosts().every(post => post.boat.sunk)) beginScuttle();
    updateEffects(dt);
    if (activePhase()) {
      const shoreAlive = shorePosts().filter(alive).length;
      const outcome = state.phase === 'hold'
        ? evaluateOutcome({ elapsed: state.elapsed, shoreAlive })
        : shoreAlive <= 0 ? { result: 'defeat', reason: 'batteries' } : null;
      if (outcome) { bombs.clear(); state.outcome = outcome; state.phase = 'ended'; emit({ type: 'ended', outcome, stats: { ...state.stats } }); }
      updateCamera(dt);
      updateAimAssist(input);
    }
  }

  function hud() {
    const member = deployed ? controlledMember() : null;
    const infantry = mode === 'infantry' && member;
    const post = mode === 'post' ? postById(controlledId) : null, point = post?.point;
    const cooldown = point ? emplacementCooldown(point, now) : null;
    let range = null;
    if (point && alive(post) && (state.phase === 'naval' || deployed) && !transfer) {
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
        deployed ? { label: '接管岸防', value: postById(controlledId)?.name ?? '' } : { label: '提前转入第二阶段', value: '空格' },
      ] : [
        { label: '剩余坚守时间', value: (s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)(Math.ceil(Math.max(0, JIANGYIN_RULES.durationSeconds - state.elapsed))) },
        { label: '两岸阵地（日军目标）', value: `${shorePosts().filter(alive).length}/${shorePosts().length}`, alert: shorePosts().some(p => !alive(p)) },
        { label: '前沿守备班', value: squadRespawnAt !== null ? `${Math.ceil(squadRespawnAt - now)} 秒后补充` : `${liveMembers().length}/${S.members}`,
          alert: liveMembers().length < S.members / 2 },
      ],
      transferring: Boolean(transfer),
      posts: (state.phase === 'naval' || state.phase === 'intro' ? posts.filter(p => p.boat) : holdOrder()).map(p => ({ id: p.id, name: p.name, key: state.phase === 'naval' ? p.key : state.phase === 'hold' || deployed ? p.holdKey : '', kind: p.kind, health: Math.max(0, p.point.health),
        maxHealth: p.point.maxHealth, controlled: p.id === controlledId && mode === 'post', eligible: eligiblePosts().includes(p) })),
      mode: deployed ? mode : 'post', deployed,
      squad: deployed && memberId !== null ? { alive: liveMembers().length, total: S.members, member: member ? memberName(member) : null,
        health: member?.health ?? 0, respawnIn: squadRespawnAt !== null ? Math.max(0, squadRespawnAt - now) : null,
        members: squad.map(m => ({ index: m.index, role: ROLE(m.index), icon: m.role, alive: m.dead === null, active: m.id === memberId, hurt: m.dead === null && m.health < S.health * .5 })) } : null,
      interact: !deployed || memberId === null || !member || member.dead !== null ? null : member.postId ? `按 F 离开${post?.name ?? '炮位'}`
        : (p => p ? `按 F 操纵${p.name}` : null)(nearbyPost(member)),
      infantry: infantry ? { name: member.weapon === 'grenade' ? '二十四年式木柄手榴弹' : infantryWeaponProfile(member.rifle).name,
        weapon: member.weapon, model: member.rifle.model ?? 'rifle', rifle: member.rifle,
        ammo: member.weapon === 'grenade' ? member.grenades : member.rifle.ammo, reserve: member.weapon === 'grenade' ? null : member.reserve,
        grenades: member.grenades, reloading: member.rifle.action === 'reload',
        reload: member.rifle.action === 'reload' ? Math.min(1, member.rifle.elapsed / rifleReloadSeconds(member.rifle)) : null,
        speed: member.speed, crouch: member.crouch, dead: member.dead !== null } : null,
      weapon: point ? { name: point.weapon.settings.name,
        ammo: point.weapon.ammo, reserve: point.weapon.reserve, cooldown, cannon: point.weapon.settings.type === 'field-gun', mount: point.weapon.settings.mount ?? null, variant: point.weapon.settings.variant ?? null,
        heat: point.heat, ship: Boolean(post.boat), speed: post.boat?.speed ?? 0, helm: post.boat ? helmState(post.boat) : null } : null,
      range, aim: aimInfo, target: lastHit && now - lastHit.at < HIT_BANNER_SECONDS ? { ...lastHit, age: now - lastHit.at } : null, viewMode, zoom: point ? (point.weapon.settings.type === 'field-gun' ? 4 : 2) : infantry ? (controlledMember()?.rifle.model === 'sniper' ? 4 : 1.45) : 1,
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
      squad: squad.filter(m => m.dead === null).map(m => ({ x: m.x, z: m.z, controlled: m.id === memberId })),
      player: (() => {   // 玩家位置与朝向，小地图据此画扇形视野
        const member = deployed ? controlledMember() : null;
        if (mode === 'infantry' && member && member.dead === null) return { x: member.x, z: member.z, heading: member.heading };
        const post = postById(controlledId);
        if (!post) return null;
        return { x: post.boat ? post.boat.x : post.point.x, z: post.boat ? post.boat.z : post.point.z, heading: post.point.yaw };
      })(),
    };
  }

  return { state, step, hud, radar, switchPost, toggleView, vehicles, get viewMode() { return viewMode; }, posts, ships, landings, troops, squad,
    get mode() { return mode; }, get deployed() { return deployed; }, get member() { return controlledMember(); }, get viewBob() { const m = controlledMember(); return m && m.speed > .5 ? Math.sin(m.walk * 2.4) * memberBob(m) : 0; },
    blockships, wreckZones, get controlledId() { return controlledId; }, get now() { return now; },
    setGraphicsLevel: level => world.setGraphicsLevel?.(level),
    skipIntro() { if (state.phase === 'intro') finishIntro(); }, skipScuttle() { if (state.phase === 'scuttle') skipScuttle(); } };
}
