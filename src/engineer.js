import * as THREE from 'three';
import { createConstructionState, resetConstructionState } from './construction.js';
import { DADAO_HAND_TO_BLADE } from './dadao-model.js';
import { createEmplacement, emplacementObstacles } from './emplacements.js';
import { RIFLE_CONTACTS } from './rifle-contacts.js';

export const ENGINEER = Object.freeze({ kits: 2, buildSeconds: 20, reach: 3.2,
  profiles: Object.freeze(['maxim24', 'bofors75']) });
const toolWood = new THREE.MeshStandardMaterial({ color: 0x59422c, roughness: .85 });
const toolSteel = new THREE.MeshStandardMaterial({ color: 0x51585a, roughness: .6, metalness: .7 });

export function createEngineerState() {
  return { materials: { maxim24: 1, bofors75: 1 }, selected: 'maxim24', construction: createConstructionState(),
    planAt: 0, site: null, heading: null, built: [],
    get kits() { return this.materials.maxim24 + this.materials.bofors75; } };
}

export function cancelEngineer(state) {
  if (state) { resetConstructionState(state.construction); state.site = null; state.heading = null; }
}

export function selectEngineerEquipment(state) {
  cancelEngineer(state);
  state.selected = state.selected === 'maxim24' ? 'bofors75' : 'maxim24';
}

export function consumeEngineerMaterial(state, profile, id) {
  if (!ENGINEER.profiles.includes(profile) || state.materials[profile] !== 1 || !id)
    throw new Error('Engineer construction requires its unspent material and a new position identity');
  state.materials[profile] = 0; state.built.push(id);
}

export function engineerPlacement(position, heading) {
  if (![position?.x, position?.y, position?.z, heading].every(Number.isFinite))
    throw new RangeError('Engineer placement needs a finite owned pose');
  return { x: position.x - Math.sin(heading) * ENGINEER.reach,
    y: position.y, z: position.z - Math.cos(heading) * ENGINEER.reach };
}

export function engineerObstacle(id, position, heading, profile = 'maxim24') {
  if (!id) throw new Error('A fortification requires its original identity');
  engineerPlacement(position, heading);
  if (!ENGINEER.profiles.includes(profile)) throw new RangeError('Unknown engineer equipment');
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const hx = profile === 'maxim24' ? 2 : 1.3, hz = profile === 'maxim24' ? 1.4 : 2.4;
  const x = Math.abs(cos) * hx + Math.abs(sin) * hz, z = Math.abs(sin) * hx + Math.abs(cos) * hz;
  return { id, oriented: true, cx: position.x, cz: position.z, cos, sin, hx, hz, angle: heading,
    minX: position.x - x, maxX: position.x + x, minZ: position.z - z, maxZ: position.z + z,
    minY: position.y, height: position.y + 2 };
}

export function engineerConstructionReservations(actor, nearby) {
  const reservations = [];
  for (const builder of nearby) {
    const equipment = builder.engineer, construction = equipment?.construction;
    if (builder === actor || builder.team !== actor.team || builder.health <= 0 || builder.vehicleId ||
      construction?.mode !== 'building' || !construction.site) continue;
    const bounds = engineerObstacle(`construction-${builder.id}`, construction.site,
      equipment.heading ?? builder.heading, equipment.selected);
    bounds.nonSupporting = true;
    // The construction occupancy check uses a .45 m body radius; movement uses .42 m.
    bounds.hx += .05; bounds.hz += .05;
    const x = Math.abs(bounds.cos) * bounds.hx + Math.abs(bounds.sin) * bounds.hz;
    const z = Math.abs(bounds.sin) * bounds.hx + Math.abs(bounds.cos) * bounds.hz;
    bounds.minX = bounds.cx - x; bounds.maxX = bounds.cx + x;
    bounds.minZ = bounds.cz - z; bounds.maxZ = bounds.cz + z;
    reservations.push(bounds);
  }
  return reservations;
}

export function engineerBuiltSpec(actor, position, heading) {
  if (!actor.engineer || !['friendly', 'enemy'].includes(actor.team)) throw new Error('A built weapon requires its engineer');
  return { id: `engineer-${actor.id}-${actor.engineer.selected}`, profile: actor.engineer.selected,
    x: position.x, z: position.z, altitude: position.y, heading, team: actor.team,
    builderId: actor.id, builderUnitId: actor.unitId, engineerBuilt: true };
}

export function engineerColliders(spec) {
  return emplacementObstacles(createEmplacement(spec));
}

export function engineerFootprintBlocked(footprint, obstacle, clearance = .25) {
  if ((obstacle.height ?? Infinity) <= footprint.minY + .025 ||
    (obstacle.minY ?? -Infinity) >= footprint.height) return false;
  const dx = (obstacle.cx ?? (obstacle.minX + obstacle.maxX) / 2) - footprint.cx;
  const dz = (obstacle.cz ?? (obstacle.minZ + obstacle.maxZ) / 2) - footprint.cz;
  if (obstacle.circular) {
    const x = footprint.cos * dx - footprint.sin * dz, z = footprint.sin * dx + footprint.cos * dz;
    return (x - Math.max(-footprint.hx, Math.min(footprint.hx, x))) ** 2 +
      (z - Math.max(-footprint.hz, Math.min(footprint.hz, z))) ** 2 < (obstacle.radius + clearance) ** 2;
  }
  const c = obstacle.cos ?? (obstacle.oriented || obstacle.door ? Math.cos(obstacle.angle) : 1);
  const s = obstacle.sin ?? (obstacle.oriented || obstacle.door ? Math.sin(obstacle.angle) : 0);
  const hx = obstacle.hx ?? (obstacle.maxX - obstacle.minX) / 2;
  const hz = obstacle.hz ?? (obstacle.maxZ - obstacle.minZ) / 2;
  for (const [x, z] of [[footprint.cos, -footprint.sin], [footprint.sin, footprint.cos], [c, -s], [s, c]]) {
    const first = footprint.hx * Math.abs(x * footprint.cos - z * footprint.sin) +
      footprint.hz * Math.abs(x * footprint.sin + z * footprint.cos);
    const second = hx * Math.abs(x * c - z * s) + hz * Math.abs(x * s + z * c);
    if (Math.abs(dx * x + dz * z) >= first + second + clearance) return false;
  }
  return true;
}

export function engineerHammerModel() {
  const tool = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .34, 16), toolWood);
  handle.position.y = .06;
  const head = new THREE.Mesh(new THREE.BoxGeometry(.19, .07, .075), toolSteel);
  head.position.y = .24; tool.add(handle, head);
  return tool;
}

export function engineerAssemblyTools() {
  const tools = new THREE.Group(), hammer = engineerHammerModel();
  hammer.position.fromArray(RIFLE_CONTACTS.triggerPalm); hammer.position.x -= .014;
  hammer.rotation.x = -Math.PI / 2;
  const brace = new THREE.Mesh(new THREE.BoxGeometry(.055, .06, .10), toolWood);
  brace.position.fromArray(RIFLE_CONTACTS.supportPalm); brace.position.y += .03;
  tools.add(hammer, brace); tools.userData.personalWeapon = true; tools.userData.engineeringTool = true;
  tools.name = 'engineer-assembly-tools';
  return tools;
}

export function createEngineerTool(createHand) {
  if (typeof createHand !== 'function') throw new Error('Engineer equipment requires the native hand factory');
  const root = new THREE.Group(), hand = createHand('right'), tool = engineerHammerModel();
  root.add(hand, tool);
  root.userData.engineerTool = { hand, tool };
  root.traverse(node => { if (node.isMesh) { node.castShadow = false; node.frustumCulled = false; } });
  return root;
}

export function updateEngineerTool(root, now, building, officer) {
  const { hand, tool } = root.userData.engineerTool;
  const stroke = building ? Math.sin(now * 9) : 0;
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.15 + stroke * .15, -.2, -.5));
  hand.poseArm(new THREE.Vector3(.25, -.28, -.38), new THREE.Vector3(.24, -.14 + stroke * .035, -.58),
    orientation.clone().multiply(DADAO_HAND_TO_BLADE), new THREE.Vector3(.8, -.6, .1));
  hand.poseGrip(1, 0, 'dadao'); hand.setOfficerAppearance?.(officer);
  root.updateMatrixWorld(true);
  const relative = root.matrixWorld.clone().invert().multiply(hand.attachmentFrame.matrixWorld);
  relative.decompose(tool.position, tool.quaternion, new THREE.Vector3());
  tool.position.add(new THREE.Vector3(...hand.userData.throwableGrips.dadao).applyQuaternion(tool.quaternion));
  tool.quaternion.multiply(DADAO_HAND_TO_BLADE.clone().invert());
  root.updateMatrixWorld(true);
}
