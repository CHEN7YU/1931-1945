// 江阴要塞阻击战 · 人物桥接：把本关的简化步兵/炮手记录交给项目现有的“带骨骼原生人物”渲染。
// 复用：nra-character.js（国军 FBX 骨骼人物）、ija-character.js（日军 GLB 骨骼人物）、nra-force-renderer.js（近景蒙皮 + 远景实例化）、
//       nra-motion.js（步态/姿态）、rifle-action.js（枪械状态）、casualties.js（阵亡倒地）。与 src/main.js 的加载与更新方式一致。
// 本文件不改动以上模块；本关的模拟（jiangyin-game.js）仍只管位置、朝向、血量，人物外观完全由项目模块负责。
import * as THREE from 'three';
import { createNraMotion, advanceNraMotion, sampleNraMotion } from '../nra-motion.js';
import { createRifleState } from '../rifle-action.js';
import { createCasualtyState } from '../casualties.js';
import { loadDadaoSurfaces } from '../dadao-surface.js';

// 与 main.js 相同的加载顺序：国军模板 → 国军队伍渲染器 → 日军模板 → 日军队伍渲染器 → 预编译。
export async function loadJiangyinCharacters({ scene, camera, renderer, walkHeight, capacity = 160, onProgress = () => {} }) {
  onProgress('加载我军士兵与人物动作…');
  const { loadNraCharacter } = await import('../nra-character.js');
  const { createNraForceRendererAsync } = await import('../nra-force-renderer.js');
  // The shared renderer bakes melee poses even when Jiangyin actors do not equip dadao.
  await loadDadaoSurfaces(renderer.capabilities.getMaxAnisotropy());
  const nraTemplate = await loadNraCharacter(walkHeight);
  // Jiangyin crews and infantry do not use the shared portable support weapons.
  const friendly = await createNraForceRendererAsync(scene, camera, { ...nraTemplate, supportWeaponPoses: false }, capacity, {
    onProgress: ({ completed, total }) => onProgress(`准备我军人物动作 ${completed}/${total}…`) });
  onProgress('加载日军士兵与人物动作…');
  const { loadIjaCharacter, createIjaForceRendererAsync } = await import('../ija-character.js');
  const ijaTemplate = await loadIjaCharacter(walkHeight);
  const enemy = await createIjaForceRendererAsync(scene, camera, { ...ijaTemplate, supportWeaponPoses: false }, capacity, {
    onProgress: ({ completed, total }) => onProgress(`准备日军人物动作 ${completed}/${total}…`) });
  onProgress('编译人物着色器…');
  await friendly.prepare(renderer);
  await enemy.prepare(renderer);
  return createNativeSoldierBridge({ friendly, enemy });
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
      locomotion: { speed: 0, mode: 'walk' }, rifle: { ...createRifleState(weapon === 'type11' ? 'type11' : 'rifle') } };
    actor.rifle.id = `${actor.id}:rifle`;
    actor.nativeMotion = createNraMotion((team === 'friendly' ? friendly : enemy).motionProfile, actor);
    return actor;
  }

  function trackCrew(anchor) { crews.add(anchor); return anchor; }

  // troops：jiangyin-game 的步兵记录 { id, x, z, dead, attacking, model }；model 为 createAnchor 返回的定位节点。
  function sync(troops, now, dt, preset = 'high', controlledId = null) {
    const live = { friendly: [], enemy: [] }, seen = new Set();
    for (const troop of troops) {
      const anchor = troop.model, spec = anchor?.userData.nativeSoldier;
      if (!spec) continue;
      seen.add(troop);
      let actor = actors.get(troop);
      if (!actor) { actor = createActor(spec.team, spec.weapon, anchor.position, anchor.rotation.y); actors.set(troop, actor); }
      if (actor.health > 0 && troop.dead !== null) {
        actor.health = 0; actor.deathTime = now; actor.locomotion.speed = 0; actor.rifleReady = false;
        actor.casualty = createCasualtyState(actor, now, sampleNraMotion(actor), { retainGun: false });
      } else if (actor.health > 0) {
        const step = Math.hypot(anchor.position.x - actor.position.x, anchor.position.z - actor.position.z);
        actor.locomotion.speed = dt > 0 ? Math.min(6, step / dt) : 0;
        actor.locomotion.mode = actor.locomotion.speed > 2.4 ? 'jog' : 'walk';
        actor.position.copy(anchor.position); actor.heading = anchor.rotation.y;
        const attacking = Boolean(troop.attacking);
        actor.rifleReady = attacking;
        actor.stance = attacking ? 'crouched' : 'standing'; actor.firingPose = attacking ? 'kneeling' : null;
        if (dt > 0) advanceNraMotion(actor, dt);
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
      if (dt > 0) advanceNraMotion(actor, dt);
      live.friendly.push(actor);
    }
    const gone = { friendly: [], enemy: [] };
    for (const [source, actor] of actors) if (!seen.has(source)) { gone[actor.team].push(actor); actors.delete(source); }
    if (gone.friendly.length) friendly.remove(gone.friendly);
    if (gone.enemy.length) enemy.remove(gone.enemy);
    friendly.update(live.friendly, now, controlledId, preset);
    enemy.update(live.enemy, now, controlledId, preset);
  }

  return { native: true, friendly, enemy, sync, trackCrew, get count() { return actors.size; } };
}
