import * as THREE from 'three';
import { SIHANG_DEMOLITION_POINT } from './sihang-layout.js';
import { advanceSihangDemolition, SIHANG_RULES } from './sihang-campaign.js';
import { nativeGaitDrop } from './nra-motion.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { supportWeaponTargets } from './support-weapon-pose.js';
import { attachSihangShieldGrips, SIHANG_SHIELD_CARRY } from './sihang-shield-pose.js';
import { sihangBreachGoal } from './sihang-tactics.js';
import { circleBlocked } from './core.js';
import { FormationPlacementError } from './battle-roster.js';
import { SPAWN_RULES } from './spawns.js';
import { FOOT_SPEEDS } from './locomotion.js';

export function sihangShieldLayout(slot, count, sideBias = 'left') {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(slot) || slot < 0 || slot >= count || count > 20)
    throw new RangeError('Invalid demolition shield slot');
  if (!['left', 'right'].includes(sideBias)) throw new RangeError('Invalid demolition shield side bias');
  const front = Math.min(2, count), rear = Math.min(2, count - front);
  const remaining = count - front - rear;
  const left = Math[sideBias === 'left' ? 'ceil' : 'floor'](remaining * 3 / 8);
  const right = Math[sideBias === 'left' ? 'floor' : 'ceil'](remaining * 3 / 8);
  const roof = remaining - left - right;
  const edge = Math.max(1.5, (Math.max(left, right) - 1) * .75 + .95);
  const role = slot < front ? 'front' : slot < front + rear ? 'rear'
    : slot < front + rear + left ? 'left' : slot < front + rear + left + right ? 'right' : 'roof';
  const roleIndex = role === 'front' ? slot : role === 'rear' ? slot - front
    : role === 'left' ? slot - front - rear
      : role === 'right' ? slot - front - rear - left : slot - front - rear - left - right;
  const mode = role === 'roof' ? 'roof' : 'front';
  const x = role === 'front' || role === 'rear'
    ? (roleIndex - ((role === 'front' ? front : rear) - 1) / 2) * 1.1
    : role === 'left' ? -1.1 : role === 'right' ? 1.1 : 0;
  const roofSpan = Math.max((roof - 1) * .5, edge - 1.8);
  const z = role === 'front' ? edge : role === 'rear' ? -edge
    : role === 'left' || role === 'right'
      ? (roleIndex - ((role === 'left' ? left : right) - 1) / 2) * 1.5
      : roof === 1 ? 0 : (roleIndex / (roof - 1) * 2 - 1) * roofSpan;
  return { ...SIHANG_SHIELD_CARRY[mode], offsetX: 0, rotationZ: 0, mode, role,
    x, z,
    facing: role === 'left' ? Math.PI / 2 : role === 'right' ? -Math.PI / 2 : role === 'rear' ? 0 : Math.PI };
}

function assignShieldSlots(squad, anchor) {
  const choices = ['left', 'right'].map(sideBias => assignShieldSlotsForBias(squad, anchor, sideBias));
  return choices[1].distance < choices[0].distance ? choices[1] : choices[0];
}

function assignShieldSlotsForBias(squad, anchor, sideBias) {
  const assigned = Array(squad.length), available = new Set(squad);
  let distance = 0;
  for (const roles of [['front'], ['rear'], ['left', 'right'], ['roof']]) {
    const pairs = [];
    for (let slot = 0; slot < squad.length; slot++) {
      const pose = sihangShieldLayout(slot, squad.length, sideBias);
      if (!roles.includes(pose.role)) continue;
      for (const actor of available) pairs.push({ actor, slot,
        distance: Math.hypot(actor.position.x - anchor.x - pose.x, actor.position.z - anchor.z - pose.z) });
    }
    pairs.sort((a, b) => a.distance - b.distance || a.slot - b.slot || a.actor.index - b.actor.index);
    for (const pair of pairs) if (!assigned[pair.slot] && available.has(pair.actor)) {
      const { actor, slot } = pair;
      assigned[slot] = actor;
      available.delete(actor);
      distance += pair.distance;
    }
  }
  return { assigned, sideBias, distance };
}

export function sihangShieldSpawnPositions(spawn, count, obstacles, occupied = [], hostiles = []) {
  const positions = Array.from({ length: count }, (_, slot) => {
    const pose = sihangShieldLayout(slot, count);
    return { x: spawn.x + pose.x, z: spawn.z + pose.z };
  });
  const y = spawn.altitude ?? 0;
  const hostileClearance = spawn.permanent || spawn.allowNearbyEnemies ? 1.25 : SPAWN_RULES.enemyBlockRadius;
  if (positions.some(point => circleBlocked(point.x, point.z, .48, obstacles, y) ||
    occupied.some(other => Math.abs((other.y ?? y) - y) < 1.75 && Math.hypot(point.x - other.x, point.z - other.z) < 1.25) ||
    hostiles.some(actor => actor.health > 0 && Math.abs((actor.position?.y ?? actor.altitude ?? 0) - y) < 4 &&
      Math.hypot(point.x - (actor.position?.x ?? actor.x), point.z - (actor.position?.z ?? actor.z)) < hostileClearance)))
    throw new FormationPlacementError(`集结区 ${spawn.id} 无法安全容纳完整爆破龟壳；未凭空缩减兵力`);
  return positions;
}

export function createSihangCombat(scene, world) {
  const geometries = Object.fromEntries(Object.entries(SIHANG_SHIELD_CARRY).map(([mode, profile]) => {
    const pieces = [new THREE.BoxGeometry(profile.width, .065, profile.length)];
    for (const x of [-.3, .3]) {
      const handle = new THREE.CylinderGeometry(.016, .016, .18, 6);
      handle.rotateX(Math.PI / 2); handle.translate(x, -.08, 0); pieces.push(handle);
      for (const z of [-.075, .075]) pieces.push(new THREE.BoxGeometry(.03, .055, .03).translate(x, -.0575, z));
    }
    const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
    return [mode, geometry];
  }));
  const material = new THREE.MeshStandardMaterial({ color: 0x4c5150, metalness: .65, roughness: .72 });
  const shieldSlots = Array.from({ length: SIHANG_RULES.demolitionMembers }, () => {
    const mesh = new THREE.Mesh(geometries.front, material);
    attachSihangShieldGrips(mesh);
    mesh.userData.dynamicCollision = true; mesh.userData.sihangShieldPlate = true;
    mesh.userData.impactMaterial = 'generic';
    const raycast = mesh.raycast;
    mesh.raycast = function (ray, hits) { if (this.visible) raycast.call(this, ray, hits); };
    mesh.visible = false; mesh.castShadow = mesh.receiveShadow = true;
    const entry = { mesh, actorId: null, actor: null, knockedUntil: 0, broken: false };
    scene.add(mesh); world.solids.push(mesh);
    return entry;
  });
  const charge = new THREE.Mesh(new THREE.BoxGeometry(.58, .38, .32),
    new THREE.MeshStandardMaterial({ color: 0x6a5941, roughness: .95 }));
  charge.position.set(SIHANG_DEMOLITION_POINT.x, .4, SIHANG_DEMOLITION_POINT.z);
  charge.visible = false; scene.add(charge);
  const light = new THREE.Mesh(new THREE.SphereGeometry(.055, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffac55 }));
  light.position.set(.19, .23, .17); charge.add(light);
  const goals = new Map(), bindings = new Set();
  const ray = new THREE.Raycaster(), eye = new THREE.Vector3(), direction = new THREE.Vector3();
  const actorFrame = new THREE.Object3D(), desiredPosition = new THREE.Vector3();
  const desiredRotation = new THREE.Quaternion(), vertical = new THREE.Vector3(0, 1, 0);
  let anchor = null, home = null, path = null, nextPathAt = 0, readyAt = 0;
  let lastPlayer = null, defuser = null, mode = 'turtle', phase = 'advance', living = [], assigned = [], formed = false;
  let sideBias = 'left';
  const defuseAvailable = (campaign, player) => {
    if (campaign.stage !== 'sihang-defense' || campaign.demolition.state !== 'armed' ||
      player?.health <= 0 || !player || player.vehicleId ||
      Math.hypot(player.position.x - charge.position.x, player.position.z - charge.position.z) >= 2.2 ||
      Math.abs(player.position.y - charge.position.y) >= 1.7) return false;
    eye.copy(player.position); eye.y += .8;
    direction.copy(charge.position).sub(eye);
    ray.set(eye, direction.clone().normalize()); ray.far = Math.max(0, direction.length() - .15);
    return ray.intersectObjects(world.solids, false).length === 0;
  };
  return {
    defuseAvailable,
    breakShield(mesh) {
      const entry = shieldSlots.find(slot => slot.mesh === mesh);
      if (!entry || !entry.mesh.visible || entry.broken) return false;
      entry.broken = true;
      entry.mesh.visible = false;
      if (entry.actor?.sihangShield) entry.actor.sihangShield.active = false;
      return true;
    },
    goalFor(actor, campaign) { return sihangBreachGoal(actor, campaign) ??
      (actor.formation?.sihangDemolition ? goals.get(actor.id) ?? null : null); },
    prompt(campaign, player) {
      if (!defuseAvailable(campaign, player)) return null;
      const state = campaign.demolition;
      return state.defuseProgress > 0
        ? `拆除 ${state.defuseProgress.toFixed(1)}/${SIHANG_RULES.defuseSeconds}秒 · 按住F时暂停引信 · 中断保留${SIHANG_RULES.defuseGraceSeconds}秒`
        : `按住F ${SIHANG_RULES.defuseSeconds}秒拆除 · 距引爆 ${Math.ceil(state.fuseRemaining)}秒`;
    },
    update(dt, now, { campaign, actors, player, keys }) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now)) throw new RangeError('Invalid Sihang combat step');
      if (campaign.northWallBreached && !actors.some(actor => actor.health > 0 && actor.formation?.sihangDemolition)) {
        if (defuser) defuser.tactics.sihangDefusing = false;
        defuser = null;
        for (const actor of bindings) delete actor.sihangShield;
        bindings.clear(); goals.clear(); living = []; assigned = []; phase = 'breached'; formed = false;
        for (const slot of shieldSlots) slot.mesh.visible = false;
        charge.visible = light.visible = false;
        return null;
      }
      const squad = actors.filter(actor => actor.health > 0 && actor.formation?.sihangDemolition)
        .sort((a, b) => a.index - b.index);
      if (squad.length && !squad.some(actor => bindings.has(actor))) {
        anchor = home = path = null; nextPathAt = 0; readyAt = now + 1; phase = 'advance'; formed = false;
      }
      living = squad;
      for (const actor of bindings) if (!squad.includes(actor)) delete actor.sihangShield;
      bindings.clear(); goals.clear();
      if (squad.length && !anchor) {
        anchor = { x: squad.reduce((sum, actor) => sum + actor.position.x, 0) / squad.length,
          y: 0, z: squad.reduce((sum, actor) => sum + actor.position.z, 0) / squad.length };
        home = { ...anchor };
      }
      if (squad.length !== assigned.length || squad.some(actor => !assigned.includes(actor))) {
        const result = squad.length ? assignShieldSlots(squad, anchor) : { assigned: [], sideBias: 'left' };
        assigned = result.assigned; sideBias = result.sideBias;
      }
      if (phase !== 'withdraw' &&
        (campaign.northWallBreached || campaign.demolition.state === 'armed' || campaign.stage === 'sihang-retreat')) {
        phase = 'withdraw'; path = null; nextPathAt = now;
      }
      if (phase === 'withdraw' && home && Math.hypot(anchor.x - home.x, anchor.z - home.z) < .5 &&
        !campaign.northWallBreached && campaign.stage === 'sihang-defense' &&
        campaign.demolition.state === 'idle' && now >= campaign.demolition.cooldownUntil) {
        phase = 'advance'; path = null;
      }
      if (anchor && squad.length && !campaign.outcome && now >= readyAt) {
        const destination = phase === 'withdraw' ? home
          : { x: SIHANG_DEMOLITION_POINT.x, y: 0,
            z: SIHANG_DEMOLITION_POINT.z - sihangShieldLayout(0, squad.length, sideBias).z - .7 };
        const lag = Math.max(...assigned.map((actor, index) => {
          const pose = sihangShieldLayout(index, squad.length, sideBias);
          return Math.hypot(actor.position.x - anchor.x - pose.x, actor.position.z - anchor.z - pose.z);
        }));
        if ((!path || !path.length) && now >= nextPathAt) {
          path = world.elevatedPath(anchor, destination);
          nextPathAt = now + 2;
        }
        while (path?.length && Math.hypot(path[0].x - anchor.x, path[0].z - anchor.z) < .25) path.shift();
        const target = path?.[0];
        formed = lag < .18;
        const regroupScale = Math.max(0, Math.min(1, (1.05 - lag) / .75));
        if (target && regroupScale > 0 &&
          (campaign.demolition.state !== 'installing' || phase === 'withdraw')) {
          const dx = target.x - anchor.x, dz = target.z - anchor.z, distance = Math.hypot(dx, dz);
          const step = Math.min(distance, dt * FOOT_SPEEDS.infantry.jog * regroupScale);
          if (distance > .01) world.moveInfantry(anchor, dx / distance * step, dz / distance * step, .6);
        }
      }
      for (let index = 0; index < shieldSlots.length; index++) {
        const entry = shieldSlots[index], actor = assigned[index];
        if (!actor) {
          entry.mesh.visible = false; entry.actor = null; continue;
        }
        const rebound = entry.actorId !== actor.id;
        if (rebound) { entry.actorId = actor.id; entry.actor = actor; entry.knockedUntil = 0; entry.broken = false; }
        const pose = sihangShieldLayout(index, squad.length, sideBias);
        entry.mesh.geometry = geometries[pose.mode];
        goals.set(actor.id, { x: anchor.x + pose.x, y: 0, z: anchor.z + pose.z, transit: true,
          facing: pose.facing, backwards: phase === 'withdraw' });
        if (lastPlayer && player?.health > 0 && lastPlayer.id === player.id &&
          lastPlayer.y > actor.position.y + 1.8 && player.position.y <= actor.position.y + 2 &&
          player.position.y < lastPlayer.y && Math.hypot(player.position.x - actor.position.x,
            player.position.z - actor.position.z) < .9) {
          entry.knockedUntil = now + 3;
          player.tactics.sihangShieldLanding = now;
        }
        const knocked = now < entry.knockedUntil;
        const gaitDrop = nativeGaitDrop(actor);
        entry.mesh.visible = !knocked && !entry.broken;
        const placing = campaign.stage === 'sihang-defense' &&
          campaign.demolition.operatorId === actor.id && campaign.demolition.state === 'installing';
        const stride = actor.walkPhase ?? 0;
        const running = Math.min(1, (actor.locomotion?.speed ?? 0) / FOOT_SPEEDS.infantry.jog);
        const bob = Math.sin(stride * 2) * .022 * running;
        const roll = Math.sin(stride) * .028 * running;
        desiredPosition.set(pose.offsetX, placing ? .12 : pose.height - gaitDrop + bob, placing ? -.7 : pose.offsetZ)
          .applyAxisAngle(vertical, actor.heading).add(actor.position);
        desiredRotation.setFromEuler(new THREE.Euler(placing ? 0 : pose.rotationX, actor.heading, placing ? 0 : pose.rotationZ + roll, 'YXZ'));
        const blend = rebound ? 1 : 1 - Math.exp(-dt * 18);
        entry.mesh.position.copy(desiredPosition); entry.mesh.quaternion.slerp(desiredRotation, blend);
        entry.mesh.updateWorldMatrix(true, false);
        actorFrame.position.copy(actor.position); actorFrame.rotation.set(0, actor.heading, 0);
        actorFrame.updateMatrixWorld(true);
        const targets = supportWeaponTargets(entry.mesh, actorFrame);
        actor.sihangShield = { active: !knocked && !entry.broken, mode: pose.mode, role: pose.role, slot: index,
          targets, handTarget: targets.left.wrist, backwards: phase === 'withdraw', installing: placing };
        bindings.add(actor);
      }
      lastPlayer = player ? { id: player.id, ...player.position } : null;
      const formationReady = squad.every(actor => { const goal = goals.get(actor.id);
        return Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) < .22; });
      const eligible = phase === 'withdraw' || !formationReady ? [] : squad.filter(actor => actor.sihangShield?.role === 'front' && actor.position.y < 1.5 &&
        Math.hypot(actor.position.x - SIHANG_DEMOLITION_POINT.x, actor.position.z - SIHANG_DEMOLITION_POINT.z) < 2.1 &&
        !shieldSlots.find(entry => entry.actorId === actor.id && now < entry.knockedUntil));
      const operator = eligible.find(actor => actor.id === campaign.demolition.operatorId) ?? eligible[0];
      if (defuser && defuser !== player) defuser.tactics.sihangDefusing = false;
      defuser = player ?? null;
      const defusing = defuseAvailable(campaign, player) && keys.has('KeyF');
      if (player) player.tactics.sihangDefusing = defusing;
      const event = advanceSihangDemolition(campaign, dt, {
        operatorId: operator?.id ?? null,
        defusing,
        defuserId: player?.health > 0 ? player.id : null,
      });
      if (event === 'armed') { phase = 'withdraw'; path = null; nextPathAt = now; }
      for (const actor of squad) if (actor.sihangShield) {
        actor.sihangShield.installing = campaign.stage === 'sihang-defense' &&
          campaign.demolition.operatorId === actor.id && campaign.demolition.state === 'installing';
        if (actor.sihangShield.installing) goals.set(actor.id, { x: actor.position.x,
          y: actor.position.y, z: actor.position.z, transit: true });
      }
      charge.visible = campaign.stage === 'sihang-defense' && ['installing', 'armed'].includes(campaign.demolition.state);
      charge.scale.setScalar(campaign.demolition.state === 'installing' ? .4 + .6 *
        campaign.demolition.installProgress / SIHANG_RULES.installSeconds : 1);
      light.visible = charge.visible && campaign.demolition.state === 'armed' && Math.sin(now * 12) > 0;
      if (squad.length && (campaign.northWallBreached || campaign.stage === 'sihang-retreat') &&
        home && Math.hypot(anchor.x - home.x, anchor.z - home.z) < .3 &&
        squad.every(actor => { const goal = goals.get(actor.id);
          return Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) < .4; })) return 'withdrawn';
      return event;
    },
    reset() {
      if (defuser) defuser.tactics.sihangDefusing = false;
      defuser = null;
      for (const actor of bindings) delete actor.sihangShield;
      bindings.clear(); goals.clear();
      for (const slot of shieldSlots) {
        slot.mesh.visible = false; slot.actorId = null; slot.actor = null; slot.knockedUntil = 0; slot.broken = false;
      }
      charge.visible = false; anchor = home = path = lastPlayer = null; nextPathAt = readyAt = 0;
      mode = 'turtle'; phase = 'advance'; living = []; assigned = []; sideBias = 'left'; formed = false;
    },
    get formed() { return formed; },
    get snapshot() { return { mode, phase, formed, shields: shieldSlots.filter(slot => slot.mesh.visible).length,
      anchor: anchor && { ...anchor }, home: home && { ...home }, chargeVisible: charge.visible,
      members: living.map(actor => ({ id: actor.id, x: actor.position.x, y: actor.position.y, z: actor.position.z })) }; },
  };
}
