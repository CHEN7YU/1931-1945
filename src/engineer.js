import * as THREE from 'three';
import { createConstructionState, resetConstructionState } from './construction.js';
import { hammerHandFrame, HAMMER_GRIP_RADIUS } from './engineer-hammer-pose.js';
import { createEmplacement, emplacementObstacles } from './emplacements.js';
import { RIFLE_CONTACTS } from './rifle-contacts.js';

export const ENGINEER = Object.freeze({ kits: 3, buildSeconds: 20, reach: 3.2,
  profiles: Object.freeze(['maxim24', 'bofors75', 'maxim24aa']) });
const toolWood = new THREE.MeshStandardMaterial({ color: 0x59422c, roughness: .85 });
const toolSteel = new THREE.MeshStandardMaterial({ color: 0x51585a, roughness: .6, metalness: .7 });

export function createEngineerState() {
  return { materials: { maxim24: 1, bofors75: 1, maxim24aa: 1 }, selected: 'maxim24', construction: createConstructionState(),
    planAt: 0, site: null, heading: null, unfinished: [], built: [],
    get kits() { return ENGINEER.profiles.reduce((total, profile) => total + this.materials[profile], 0); } };
}

export function rememberEngineerConstruction(state, construction = state.construction) {
  if (!construction.site || !construction.anchor || construction.progress <= 0) return;
  if (!construction.builderId || !Number.isFinite(state.heading))
    throw new Error('Unfinished construction requires its builder and heading');
  const saved = { builderId: construction.builderId, profile: state.selected, heading: state.heading,
    site: { ...construction.site }, anchor: { ...construction.anchor }, progress: construction.progress };
  const previous = state.unfinished.findIndex(item => item.builderId === saved.builderId &&
    item.profile === saved.profile && Math.hypot(item.site.x - saved.site.x,
      item.site.y - saved.site.y, item.site.z - saved.site.z) < .01);
  if (previous < 0) state.unfinished.push(saved);
  else state.unfinished[previous] = saved;
}

export function findEngineerConstruction(state, builderId, position, candidate) {
  return state.unfinished.filter(item => item.builderId === builderId && item.profile === state.selected &&
    Math.hypot(item.anchor.x - position.x, item.anchor.y - position.y, item.anchor.z - position.z) <= .7)
    .sort((a, b) => Math.hypot(a.site.x - candidate.x, a.site.y - candidate.y, a.site.z - candidate.z) -
      Math.hypot(b.site.x - candidate.x, b.site.y - candidate.y, b.site.z - candidate.z))[0];
}

export function resumeEngineerConstruction(state, builderId, position, candidate) {
  if (!state.construction.blueprint || state.construction.builderId !== builderId || state.construction.site) return;
  const saved = findEngineerConstruction(state, builderId, position, candidate);
  if (!saved) return;
  state.unfinished.splice(state.unfinished.indexOf(saved), 1);
  state.heading = saved.heading;
  Object.assign(state.construction, { site: { ...saved.site }, anchor: { ...saved.anchor }, progress: saved.progress });
}

export function cancelEngineer(state) {
  if (state) {
    rememberEngineerConstruction(state);
    resetConstructionState(state.construction); state.site = null; state.heading = null;
  }
}

export function selectEngineerEquipment(state) {
  cancelEngineer(state);
  state.selected = ENGINEER.profiles[(ENGINEER.profiles.indexOf(state.selected) + 1) % ENGINEER.profiles.length];
}

export function consumeEngineerMaterial(state, profile, id) {
  if (!ENGINEER.profiles.includes(profile) || state.materials[profile] !== 1 || !id)
    throw new Error('Engineer construction requires its unspent material and a new position identity');
  state.materials[profile] = 0; state.built.push(id);
  state.unfinished = state.unfinished.filter(item => item.profile !== profile);
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
  const hx = profile === 'maxim24' ? 2 : profile === 'maxim24aa' ? 1.15 : 1.3;
  const hz = profile === 'maxim24' ? 1.4 : profile === 'maxim24aa' ? 1.15 : 2.4;
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
    builderId: actor.id, builderUnitId: actor.unitId, builderTeam: actor.team, engineerBuilt: true };
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
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(HAMMER_GRIP_RADIUS, HAMMER_GRIP_RADIUS, .34, 16), toolWood);
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
  hand.poseGrip(1, 0, 'hammer');
  root.add(hand, tool);
  root.userData.engineerTool = { hand, tool };
  root.traverse(node => { if (node.isMesh) { node.castShadow = false; node.frustumCulled = false; } });
  return root;
}

// The native grip wraps around hand-local +X; the hammer's long head axis is its striking axis.
const hammerToHand = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.05, -Math.PI / 2, 'ZXY'));
const hammerRest = new THREE.Vector3(.28, -.13, -.59);
const hammerRaised = new THREE.Vector3(.30, -.045, -.57);
const hammerImpact = new THREE.Vector3(.21, -.26, -.78);
const hammerRestShaft = new THREE.Vector3(.05, .86, -.51);
const hammerRaisedShaft = new THREE.Vector3(.14, .91, -.39);
const hammerImpactShaft = new THREE.Vector3(-.12, .70, -.70);

export function updateEngineerTool(root, now, building, officer, blueFieldCap = false) {
  const { hand, tool } = root.userData.engineerTool;
  const shoulder = new THREE.Vector3(.25, -.28, -.38), pole = new THREE.Vector3(.60, -.15, .70);
  const wrist = hammerRest.clone(), shaft = hammerRestShaft.clone();
  if (building) {
    const cycle = ((now * 9 / (2 * Math.PI)) % 1 + 1) % 1;
    const move = (from, to, fromShaft, toShaft, t, arc) => {
      const progress = t * t * (3 - 2 * t);
      wrist.copy(from).lerp(to, progress).addScaledVector(arc, 4 * progress * (1 - progress));
      shaft.copy(fromShaft).lerp(toShaft, progress);
    };
    if (cycle < .28) {
      move(hammerRest, hammerRaised, hammerRestShaft, hammerRaisedShaft,
        cycle / .28, new THREE.Vector3(.015, .02, .014));
    } else if (cycle < .58) {
      move(hammerRaised, hammerImpact, hammerRaisedShaft, hammerImpactShaft,
        (cycle - .28) / .30, new THREE.Vector3(0, .018, -.035));
    } else if (cycle < .84) {
      move(hammerImpact, hammerRest, hammerImpactShaft, hammerRestShaft,
        (cycle - .58) / .26, new THREE.Vector3(.018, -.026, -.018));
    }
    shoulder.z -= .1 * (hammerRest.z - Math.min(wrist.z, hammerRest.z));
  }
  const orientation = hammerHandFrame(shoulder, wrist, pole, hand.userData.armLengths, shaft);
  hand.poseArm(shoulder, wrist, orientation, pole, 0);
  hand.poseGrip(1, 0, 'hammer'); hand.setOfficerAppearance?.(officer, blueFieldCap);
  root.updateMatrixWorld(true);
  const relative = root.matrixWorld.clone().invert().multiply(hand.attachmentFrame.matrixWorld);
  relative.decompose(tool.position, tool.quaternion, new THREE.Vector3());
  tool.position.add(new THREE.Vector3(...hand.userData.throwableGrips.hammer).applyQuaternion(tool.quaternion));
  tool.quaternion.multiply(hammerToHand);
  root.updateMatrixWorld(true);
}
