import * as THREE from 'three';
import { SIHANG_DEMOLITION_POINT } from './sihang-layout.js';
import { advanceSihangDemolition, SIHANG_RULES } from './sihang-campaign.js';
import { nativeGaitDrop } from './nra-motion.js';

function shotNear(shot, point) {
  if (shot.type !== 'shot' || shot.source?.team !== 'friendly' || !shot.end || shot.start.y > 3) return false;
  const dx = shot.end.x - shot.start.x, dy = shot.end.y - shot.start.y, dz = shot.end.z - shot.start.z;
  const length = dx * dx + dy * dy + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((point.x - shot.start.x) * dx +
    (point.y + 1 - shot.start.y) * dy + (point.z - shot.start.z) * dz) / length)) : 0;
  return Math.hypot(shot.start.x + dx * t - point.x, shot.start.y + dy * t - point.y - 1,
    shot.start.z + dz * t - point.z) < 3.5;
}

export function sihangShieldLayout(slot, count, turtle) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= count || count > 20)
    throw new RangeError('Invalid demolition shield slot');
  const columns = Math.min(5, count), rows = Math.ceil(count / columns);
  const row = Math.floor(slot / columns), column = slot % columns;
  const edgeX = column === 0 ? -1 : column === columns - 1 ? 1 : 0;
  const edgeZ = row === 0 ? 1 : row === rows - 1 ? -1 : 0;
  const shell = turtle && (edgeX || edgeZ);
  return { x: (column - (columns - 1) / 2) * 1.02, z: ((rows - 1) / 2 - row) * 1.46,
    height: shell ? edgeZ ? 1.31 : 1.53 : 1.96, offsetX: shell ? -edgeX * .3 : 0,
    offsetZ: shell ? -edgeZ * .38 : 0, rotationX: shell && edgeZ ? edgeZ * 1.05 : 0,
    rotationZ: shell && !edgeZ ? -edgeX * 1.05 : 0, mode: shell ? 'turtle' : 'roof' };
}

export function createSihangCombat(scene, world) {
  const geometry = new THREE.BoxGeometry(1, .065, 1.5);
  const material = new THREE.MeshStandardMaterial({ color: 0x4c5150, metalness: .65, roughness: .72 });
  const shieldSlots = Array.from({ length: SIHANG_RULES.demolitionMembers }, () => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.dynamicCollision = true; mesh.userData.impactMaterial = 'generic';
    const raycast = mesh.raycast;
    mesh.raycast = function (ray, hits) { if (this.visible) raycast.call(this, ray, hits); };
    mesh.visible = false; mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh); world.solids.push(mesh);
    return { mesh, actorId: null, knockedUntil: 0 };
  });
  const charge = new THREE.Mesh(new THREE.BoxGeometry(.58, .38, .32),
    new THREE.MeshStandardMaterial({ color: 0x6a5941, roughness: .95 }));
  charge.position.set(SIHANG_DEMOLITION_POINT.x, .4, SIHANG_DEMOLITION_POINT.z);
  charge.visible = false; scene.add(charge);
  const light = new THREE.Mesh(new THREE.SphereGeometry(.055, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffac55 }));
  light.position.set(.19, .23, .17); charge.add(light);
  const goals = new Map(), bindings = new Set();
  const ray = new THREE.Raycaster(), eye = new THREE.Vector3(), direction = new THREE.Vector3();
  const wrist = new THREE.Vector3(), vertical = new THREE.Vector3(0, 1, 0);
  let anchor = null, path = null, nextPathAt = 0, turtleUntil = 0, shotId = 0, lastPlayer = null, defuser = null, mode = 'roof';
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
    goalFor(actor) { return actor.formation?.sihangDemolition ? goals.get(actor.id) ?? null : null; },
    prompt(campaign, player) {
      if (!defuseAvailable(campaign, player)) return null;
      const state = campaign.demolition;
      return state.defuseProgress > 0
        ? `正在拆除 ${state.defuseProgress.toFixed(1)}/10秒 · 持续按住F · 引爆计时暂停`
        : `按住F 10秒拆除 · 距引爆 ${Math.ceil(state.fuseRemaining)}秒`;
    },
    update(dt, now, { campaign, actors, player, keys, shots = [] }) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(now)) throw new RangeError('Invalid Sihang combat step');
      const squad = actors.filter(actor => actor.health > 0 && actor.formation?.sihangDemolition)
        .sort((a, b) => a.index - b.index);
      if (squad.length && !squad.some(actor => bindings.has(actor))) { anchor = path = null; nextPathAt = 0; }
      for (const actor of bindings) if (!squad.includes(actor)) delete actor.sihangShield;
      bindings.clear(); goals.clear();
      if (squad.length && !anchor) anchor = { x: squad.reduce((sum, actor) => sum + actor.position.x, 0) / squad.length,
        y: 0, z: squad.reduce((sum, actor) => sum + actor.position.z, 0) / squad.length };
      for (const event of shots) {
        if (event.id <= shotId) continue;
        if (squad.some(actor => shotNear(event, actor.position))) turtleUntil = now + 5;
        shotId = Math.max(shotId, event.id);
      }
      mode = now < turtleUntil ? 'turtle' : 'roof';
      if (anchor && squad.length && campaign.stage === 'sihang-defense' && now >= 35) {
        const destination = { x: SIHANG_DEMOLITION_POINT.x, y: 0, z: SIHANG_DEMOLITION_POINT.z - 3.3 };
        const lag = squad.reduce((sum, actor) => sum + Math.hypot(actor.position.x - anchor.x, actor.position.z - anchor.z), 0) / squad.length;
        if ((!path || !path.length) && now >= nextPathAt) {
          path = world.elevatedPath(anchor, destination);
          nextPathAt = now + 2;
        }
        while (path?.length && Math.hypot(path[0].x - anchor.x, path[0].z - anchor.z) < .25) path.shift();
        const target = path?.[0];
        if (target && lag < 4.5) {
          const dx = target.x - anchor.x, dz = target.z - anchor.z, distance = Math.hypot(dx, dz);
          const step = Math.min(distance, dt * (mode === 'turtle' ? .85 : 1.35));
          if (distance > .01) world.moveInfantry(anchor, dx / distance * step, dz / distance * step, .6);
        }
      }
      for (let index = 0; index < shieldSlots.length; index++) {
        const entry = shieldSlots[index], actor = squad[index];
        if (!actor || campaign.stage !== 'sihang-defense') {
          entry.mesh.visible = false; if (actor) delete actor.sihangShield; continue;
        }
        if (entry.actorId !== actor.id) { entry.actorId = actor.id; entry.knockedUntil = 0; }
        const pose = sihangShieldLayout(index, squad.length, mode === 'turtle');
        goals.set(actor.id, { x: anchor.x + pose.x, y: 0, z: anchor.z + pose.z, transit: true });
        if (lastPlayer && player?.health > 0 && lastPlayer.id === player.id &&
          lastPlayer.y > actor.position.y + 1.8 && player.position.y <= actor.position.y + 2 &&
          player.position.y < lastPlayer.y && Math.hypot(player.position.x - actor.position.x,
            player.position.z - actor.position.z) < .9) {
          entry.knockedUntil = now + 3;
          player.tactics.sihangShieldLanding = now;
        }
        const knocked = now < entry.knockedUntil;
        const gaitDrop = nativeGaitDrop(actor);
        entry.mesh.visible = !knocked;
        entry.mesh.position.set(actor.position.x + pose.offsetX, actor.position.y + pose.height - gaitDrop, actor.position.z + pose.offsetZ);
        const blend = Math.min(1, dt * 6);
        entry.mesh.rotation.x += (pose.rotationX - entry.mesh.rotation.x) * blend;
        entry.mesh.rotation.z += (pose.rotationZ - entry.mesh.rotation.z) * blend;
        entry.mesh.updateWorldMatrix(true, false);
        wrist.set(-.3, (pose.mode === 'roof' ? 1.88 : 1.35) - gaitDrop,
          pose.mode === 'roof' ? 0 : -.3).applyAxisAngle(vertical, actor.heading).add(actor.position);
        const grip = entry.mesh.worldToLocal(wrist);
        grip.set(Math.max(-.45, Math.min(.45, grip.x)), -.08, Math.max(-.7, Math.min(.7, grip.z)));
        const handTarget = entry.mesh.localToWorld(grip).sub(actor.position)
          .applyAxisAngle(vertical, -actor.heading);
        actor.sihangShield = { active: !knocked, mode: pose.mode, slot: index,
          handTarget: handTarget.toArray(),
          installing: campaign.demolition.operatorId === actor.id && campaign.demolition.state === 'installing' };
        bindings.add(actor);
      }
      lastPlayer = player ? { id: player.id, ...player.position } : null;
      const eligible = squad.filter(actor => actor.position.y < 1.5 &&
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
      charge.visible = ['installing', 'armed'].includes(campaign.demolition.state);
      charge.scale.setScalar(campaign.demolition.state === 'installing' ? .4 + .6 *
        campaign.demolition.installProgress / SIHANG_RULES.installSeconds : 1);
      light.visible = campaign.demolition.state === 'armed' && Math.sin(now * 12) > 0;
      return event;
    },
    reset() {
      if (defuser) defuser.tactics.sihangDefusing = false;
      defuser = null;
      for (const actor of bindings) delete actor.sihangShield;
      bindings.clear(); goals.clear();
      for (const slot of shieldSlots) { slot.mesh.visible = false; slot.actorId = null; slot.knockedUntil = 0; }
      charge.visible = false; anchor = path = lastPlayer = null; nextPathAt = turtleUntil = shotId = 0; mode = 'roof';
    },
    get snapshot() { return { mode, shields: shieldSlots.filter(slot => slot.mesh.visible).length,
      anchor: anchor && { ...anchor }, chargeVisible: charge.visible }; },
  };
}
