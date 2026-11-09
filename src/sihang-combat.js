import * as THREE from 'three';
import { SIHANG_DEMOLITION_POINT } from './sihang-layout.js';
import { advanceSihangDemolition, SIHANG_RULES } from './sihang-campaign.js';
import { nativeGaitDrop } from './nra-motion.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addSupportGrip, supportWeaponTargets } from './support-weapon-pose.js';
import { sihangBreachGoal } from './sihang-tactics.js';

export function sihangShieldLayout(slot, count, mode = 'front') {
  if (!Number.isInteger(slot) || slot < 0 || slot >= count || count > 20)
    throw new RangeError('Invalid demolition shield slot');
  if (!['front', 'roof'].includes(mode)) throw new RangeError('Unknown heavy shield carry mode');
  const columns = Math.min(5, count), rows = Math.ceil(count / columns);
  const row = Math.floor(slot / columns), column = slot % columns;
  return { x: (column - (columns - 1) / 2) * 1.02, z: ((rows - 1) / 2 - row) * 1.46,
    height: mode === 'roof' ? 1.96 : 1.06, offsetX: 0,
    offsetZ: mode === 'roof' ? 0 : -.38, rotationX: mode === 'roof' ? 0 : -1.15,
    rotationZ: 0, mode };
}

export function createSihangCombat(scene, world) {
  const pieces = [new THREE.BoxGeometry(1, .065, 1.5)];
  for (const x of [-.3, .3]) {
    const handle = new THREE.CylinderGeometry(.016, .016, .18, 6);
    handle.rotateX(Math.PI / 2); handle.translate(x, -.08, 0); pieces.push(handle);
    for (const z of [-.075, .075]) pieces.push(new THREE.BoxGeometry(.03, .055, .03).translate(x, -.0575, z));
  }
  const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
  const material = new THREE.MeshStandardMaterial({ color: 0x4c5150, metalness: .65, roughness: .72 });
  const shieldSlots = Array.from({ length: SIHANG_RULES.demolitionMembers }, () => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.supportWeapon = { grips: Object.fromEntries(['left', 'right'].map(side =>
      [side, addSupportGrip(mesh, `${side}-shield`, { center: [side === 'left' ? -.3 : .3, -.08, 0],
        radius: .016, normal: [0, -1, 0], forward: [0, 0, -1], axis: [0, 0, 1] })])) };
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
  const actorFrame = new THREE.Object3D(), desiredPosition = new THREE.Vector3();
  const desiredRotation = new THREE.Quaternion(), vertical = new THREE.Vector3(0, 1, 0);
  let anchor = null, home = null, path = null, nextPathAt = 0, readyAt = 0;
  let lastPlayer = null, defuser = null, mode = 'front', phase = 'advance', living = [];
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
      if (campaign.northWallBreached) {
        if (defuser) defuser.tactics.sihangDefusing = false;
        defuser = null;
        for (const actor of bindings) delete actor.sihangShield;
        bindings.clear(); goals.clear(); living = []; phase = 'breached';
        for (const slot of shieldSlots) slot.mesh.visible = false;
        charge.visible = light.visible = false;
        return null;
      }
      const squad = actors.filter(actor => actor.health > 0 && actor.formation?.sihangDemolition)
        .sort((a, b) => a.index - b.index);
      if (squad.length && !squad.some(actor => bindings.has(actor))) {
        anchor = home = path = null; nextPathAt = 0; readyAt = now + 1; phase = 'advance';
      }
      living = squad;
      for (const actor of bindings) if (!squad.includes(actor)) delete actor.sihangShield;
      bindings.clear(); goals.clear();
      if (squad.length && !anchor) {
        anchor = { x: squad.reduce((sum, actor) => sum + actor.position.x, 0) / squad.length,
          y: 0, z: squad.reduce((sum, actor) => sum + actor.position.z, 0) / squad.length };
        home = { ...anchor };
      }
      if (campaign.demolition.state === 'armed' || campaign.stage === 'sihang-retreat') phase = 'withdraw';
      if (phase === 'withdraw' && home && Math.hypot(anchor.x - home.x, anchor.z - home.z) < .5 &&
        campaign.stage === 'sihang-defense' && campaign.demolition.state === 'idle' && now >= campaign.demolition.cooldownUntil) {
        phase = 'advance'; path = null;
      }
      mode = phase === 'withdraw' || !anchor ||
        Math.hypot(anchor.x - SIHANG_DEMOLITION_POINT.x, anchor.z - SIHANG_DEMOLITION_POINT.z) > 6
        ? 'front' : 'roof';
      if (anchor && squad.length && !campaign.outcome && now >= readyAt) {
        const destination = phase === 'withdraw' ? home
          : { x: SIHANG_DEMOLITION_POINT.x, y: 0, z: SIHANG_DEMOLITION_POINT.z - 3.3 };
        const lag = squad.reduce((sum, actor) => sum + Math.hypot(actor.position.x - anchor.x, actor.position.z - anchor.z), 0) / squad.length;
        if ((!path || !path.length) && now >= nextPathAt) {
          path = world.elevatedPath(anchor, destination);
          nextPathAt = now + 2;
        }
        while (path?.length && Math.hypot(path[0].x - anchor.x, path[0].z - anchor.z) < .25) path.shift();
        const target = path?.[0];
        if (target && lag < 4.5) {
          const dx = target.x - anchor.x, dz = target.z - anchor.z, distance = Math.hypot(dx, dz);
          const step = Math.min(distance, dt);
          if (distance > .01) world.moveInfantry(anchor, dx / distance * step, dz / distance * step, .6);
        }
      }
      for (let index = 0; index < shieldSlots.length; index++) {
        const entry = shieldSlots[index], actor = squad[index];
        if (!actor) {
          entry.mesh.visible = false; if (actor) delete actor.sihangShield; continue;
        }
        const rebound = entry.actorId !== actor.id;
        if (rebound) { entry.actorId = actor.id; entry.knockedUntil = 0; }
        const pose = sihangShieldLayout(index, squad.length, mode);
        goals.set(actor.id, { x: anchor.x + pose.x, y: 0, z: anchor.z + pose.z, transit: true,
          backwards: phase === 'withdraw' });
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
        const placing = campaign.stage === 'sihang-defense' &&
          campaign.demolition.operatorId === actor.id && campaign.demolition.state === 'installing';
        desiredPosition.set(pose.offsetX, placing ? .12 : pose.height - gaitDrop, placing ? -.7 : pose.offsetZ)
          .applyAxisAngle(vertical, actor.heading).add(actor.position);
        desiredRotation.setFromEuler(new THREE.Euler(placing ? 0 : pose.rotationX, actor.heading, pose.rotationZ, 'YXZ'));
        const blend = rebound ? 1 : 1 - Math.exp(-dt * 8);
        entry.mesh.position.lerp(desiredPosition, blend); entry.mesh.quaternion.slerp(desiredRotation, blend);
        entry.mesh.updateWorldMatrix(true, false);
        actorFrame.position.copy(actor.position); actorFrame.rotation.set(0, actor.heading, 0);
        actorFrame.updateMatrixWorld(true);
        const targets = supportWeaponTargets(entry.mesh, actorFrame);
        actor.sihangShield = { active: !knocked, mode: pose.mode, slot: index,
          targets, handTarget: targets.left.wrist, backwards: phase === 'withdraw', installing: placing };
        bindings.add(actor);
      }
      lastPlayer = player ? { id: player.id, ...player.position } : null;
      const eligible = phase === 'withdraw' ? [] : squad.filter(actor => actor.position.y < 1.5 &&
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
      charge.visible = false; anchor = home = path = lastPlayer = null; nextPathAt = readyAt = 0;
      mode = 'front'; phase = 'advance'; living = [];
    },
    get snapshot() { return { mode, phase, shields: shieldSlots.filter(slot => slot.mesh.visible).length,
      anchor: anchor && { ...anchor }, home: home && { ...home }, chargeVisible: charge.visible,
      members: living.map(actor => ({ id: actor.id, x: actor.position.x, y: actor.position.y, z: actor.position.z })) }; },
  };
}
