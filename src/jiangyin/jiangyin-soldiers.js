// 江阴要塞阻击战 · 人物桥接：把本关的简化步兵/炮手记录交给项目现有的“带骨骼原生人物”渲染。
// 复用：nra-character.js（国军 FBX 骨骼人物）、ija-character.js（日军 GLB 骨骼人物）、nra-force-renderer.js（近景蒙皮 + 远景实例化）、
//       nra-motion.js（步态/姿态）、rifle-action.js（枪械状态）、casualties.js（阵亡倒地）。与 src/main.js 的加载与更新方式一致。
// 本文件不改动以上模块；本关的模拟（jiangyin-game.js）仍只管位置、朝向、血量，人物外观完全由项目模块负责。
import * as THREE from 'three';
import { createNraMotion, advanceNraMotion, sampleNraMotion } from '../nra-motion.js';
import { createRifleState } from '../rifle-action.js';
import { createCasualtyState } from '../casualties.js';
import { applyTerrainGait } from '../terrain-gait.js';

// 与 main.js 相同的加载顺序：国军模板 → 国军队伍渲染器 → 日军模板 → 日军队伍渲染器 → 预编译。
export async function loadJiangyinCharacters({ scene, camera, renderer, walkHeight, capacity = 160, onProgress = () => {} }) {
  onProgress('加载我军士兵与人物动作…');
  // 项目人物渲染器会为国军预烘焙大刀姿态，创建大刀模型前必须先加载大刀材质（与主游戏加载顺序一致）
  try {
    const { loadDadaoSurfaces } = await import('../dadao-surface.js');
    await loadDadaoSurfaces(Math.max(1, renderer.capabilities?.getMaxAnisotropy?.() ?? 1));
  } catch (error) { console.warn('[江阴] 大刀材质未加载', error); }
  const { loadNraCharacter } = await import('../nra-character.js');
  const { createNraForceRendererAsync } = await import('../nra-force-renderer.js');
  const nraTemplate = await loadNraCharacter(walkHeight);
  // 本关没有迫击炮/掷弹筒等需要人物双手握持的支援武器；关闭这组预烘焙姿态，避免“支援武器握点超出原生手臂可达范围”的启动错误
  nraTemplate.supportWeaponPoses = false;
  const friendly = await createNraForceRendererAsync(scene, camera, nraTemplate, capacity, {
    onProgress: ({ completed, total }) => onProgress(`准备我军人物动作 ${completed}/${total}…`) });
  onProgress('加载日军士兵与人物动作…');
  const { loadIjaCharacter, createIjaForceRendererAsync } = await import('../ija-character.js');
  const ijaTemplate = await loadIjaCharacter(walkHeight);
  const enemy = await createIjaForceRendererAsync(scene, camera, ijaTemplate, capacity, {
    onProgress: ({ completed, total }) => onProgress(`准备日军人物动作 ${completed}/${total}…`) });
  onProgress('编译人物着色器…');
  await friendly.prepare(renderer);
  await enemy.prepare(renderer);
  const bridge = createNativeSoldierBridge({ friendly, enemy });
  // 预热近景人物：项目渲染器第一次在近处显示某队人物时才创建带骨骼的近景模型（每队最多 6 个）并编译着色器。
  // 第二阶段登岸时 11 名队员与日军先头部队同时出现，这一步若放到战斗中会造成明显卡顿，所以在加载阶段先做完。
  onProgress('预热近景人物…');
  try { bridge.warmUp(camera, renderer, scene); } catch (error) { console.warn('jiangyin character warm-up skipped', error); }
  return bridge;
}

// 原生模式下，本关模拟拿到的“士兵模型”只是一个空的定位节点；真正的人物由队伍渲染器按 actor 绘制。
export function createAnchor(team, weapon, role = 'infantry') {
  const anchor = new THREE.Group();
  anchor.userData.nativeSoldier = { team, weapon, role };
  return anchor;
}

const yawOf = (object, quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ')) =>
  euler.setFromQuaternion(object.getWorldQuaternion(quaternion)).y;

export function createNativeSoldierBridge({ friendly, enemy }) {
  const actors = new Map();            // 来源对象（步兵记录或炮手定位节点）→ actor
  const crews = new Set();             // 炮位乘员定位节点
  let serial = 0;

  function createActor(team, weapon, position, heading) {
    const actor = { id: `jiangyin-${team}-${++serial}`, team, unitId: `jiangyin-${team}`, friendly: team === 'friendly',
      position: position.clone(), heading, walkPhase: Math.random() * 6, health: 100, deathTime: 0, vehicleId: null,
      groundType: 'infantry', stance: 'standing', firingPose: null, rifleReady: false, target: null,
      locomotion: { speed: 0, mode: 'walk' }, rifle: { ...createRifleState(['type11', 'zb26', 'sigm1920', 'sniper'].includes(weapon) ? weapon : 'rifle') } };
    actor.rifle.id = `${actor.id}:rifle`;
    actor.nativeMotion = createNraMotion((team === 'friendly' ? friendly : enemy).motionProfile, actor);
    return actor;
  }

  function trackCrew(anchor) { crews.add(anchor); return anchor; }

  // 出错不拖垮整帧：记录第一条错误（供页面提示），并把出错的人物退回最简单的站立姿态再试一次
  const errors = [];
  const report = (where, error) => { if (errors.length < 5) { errors.push(`${where}: ${error?.message ?? error}`); console.error(`[江阴] 人物渲染 ${where}`, error); } };
  const calm = actor => { actor.stance = 'standing'; actor.firingPose = null; actor.rifleReady = false; actor.aimPitch = 0; actor.target = null; };
  function advance(actor, dt) {
    if (dt <= 0) return;
    try { advanceNraMotion(actor, dt); }
    catch (error) {
      report('动作', error); calm(actor);
      try { advanceNraMotion(actor, dt); } catch { actor.locomotion.speed = 0; }
    }
  }
  function render(renderer, list, now, controlledId, preset, name) {
    try { renderer.update(list, now, controlledId, preset); return; }
    catch (error) { report(`${name}更新`, error); }
    for (const actor of list) calm(actor);
    try { renderer.update(list, now, controlledId, preset); }
    catch (error) { report(`${name}更新（简化后）`, error); try { renderer.update([], now, controlledId, preset); } catch {} }
  }
  // 加载阶段在镜头前临时放 6 个人物各渲染一帧，让项目渲染器提前创建近景模型并编译着色器，然后移除
  function warmUp(camera, threeRenderer, scene) {
    const ahead = new THREE.Vector3(), forwardDir = new THREE.Vector3();
    camera.updateMatrixWorld(); camera.getWorldDirection(forwardDir);
    const dummies = { friendly: [], enemy: [] };
    for (const team of ['friendly', 'enemy']) for (let i = 0; i < 6; i++) {
      ahead.copy(camera.position).addScaledVector(forwardDir, 6 + i * 1.5);
      ahead.x += (i % 3 - 1) * 1.2;
      dummies[team].push(createActor(team, i === 1 ? (team === 'enemy' ? 'type11' : 'zb26') : 'rifle', ahead, 0));
    }
    friendly.update(dummies.friendly, 0, null, 'high'); enemy.update(dummies.enemy, 0, null, 'high');
    threeRenderer.compile?.(scene, camera);
    threeRenderer.render(scene, camera);
    friendly.remove(dummies.friendly); enemy.remove(dummies.enemy);
    friendly.update([], 0, null, 'high'); enemy.update([], 0, null, 'high');
  }

  // troops：jiangyin-game 的步兵记录 { id, x, z, dead, attacking, hidden, model }（日军步兵与玩家步兵小队）；model 为 createAnchor 返回的定位节点。
  function sync(troops, now, dt, preset = 'high', controlledId = null) {
    const live = { friendly: [], enemy: [] }, seen = new Set();
    for (const troop of troops) {
      const anchor = troop.model, spec = anchor?.userData.nativeSoldier;
      if (!spec) continue;
      seen.add(troop);
      let actor = actors.get(troop);
      if (!actor) {
        actor = createActor(spec.team, spec.weapon, anchor.position, anchor.rotation.y); actors.set(troop, actor);
        // 我军步兵班：带上班内序号与编制，让项目的人物渲染按 officerSlot 给第 3 人换上军官服饰（与其他地图一致）
        if (spec.team === 'friendly' && Number.isInteger(troop.index)) { actor.index = troop.index; actor.formation = { type: 'infantry', memberCount: 11 }; }
      }
      if (actor.health > 0 && troop.dead !== null) {
        actor.health = 0; actor.deathTime = now; actor.locomotion.speed = 0; actor.rifleReady = false;
        actor.casualty = createCasualtyState(actor, now, sampleNraMotion(actor), { retainGun: false });
      } else if (actor.health > 0) {
        actor.vehicleId = troop.hidden ? 'hidden' : null;   // 玩家第一人称操纵的队员不绘制本体
        const step = Math.hypot(anchor.position.x - actor.position.x, anchor.position.z - actor.position.z);
        actor.locomotion.speed = dt > 0 ? Math.min(6, step / dt) : 0;
        actor.locomotion.mode = actor.locomotion.speed > 2.4 ? 'jog' : 'walk';
        actor.position.copy(anchor.position); actor.heading = anchor.rotation.y;
        const attacking = Boolean(troop.attacking);
        actor.rifleReady = attacking;
        actor.stance = attacking ? 'crouched' : 'standing'; actor.firingPose = attacking ? 'kneeling' : null;
        if (dt > 0) applyTerrainGait(actor, troop.grade ?? 0);   // 坡地：按沿坡面的路程缩短步幅，避免“平移”上坡
        advance(actor, dt);
      }
      live[actor.team].push(actor);
    }
    const anchorPosition = new THREE.Vector3();
    for (const anchor of crews) {
      let shown = anchor.parent !== null;
      for (let node = anchor; shown && node; node = node.parent) if (!node.visible) shown = false;
      anchor.getWorldPosition(anchorPosition);
      let actor = actors.get(anchor);
      if (!actor) { actor = createActor('friendly', 'rifle', anchorPosition, yawOf(anchor)); actors.set(anchor, actor); }
      seen.add(anchor);
      if (!shown) { actor.vehicleId = 'hidden'; live.friendly.push(actor); continue; }   // 与项目一致：vehicleId 非空即不绘制
      actor.vehicleId = null;
      const moved = Math.hypot(anchorPosition.x - actor.position.x, anchorPosition.z - actor.position.z);
      actor.position.copy(anchorPosition); actor.heading = yawOf(anchor);
      actor.locomotion.speed = dt > 0 && moved < 1 ? moved / dt : 0;
      advance(actor, dt);
      live.friendly.push(actor);
    }
    const gone = { friendly: [], enemy: [] };
    for (const [source, actor] of actors) if (!seen.has(source)) { gone[actor.team].push(actor); actors.delete(source); }
    try { if (gone.friendly.length) friendly.remove(gone.friendly); } catch (error) { report('移除我军人物', error); }
    try { if (gone.enemy.length) enemy.remove(gone.enemy); } catch (error) { report('移除日军人物', error); }
    render(friendly, live.friendly, now, controlledId, preset, '我军人物');
    render(enemy, live.enemy, now, controlledId, preset, '日军人物');
  }

  return { native: true, friendly, enemy, sync, trackCrew, warmUp, errors, get count() { return actors.size; } };
}
