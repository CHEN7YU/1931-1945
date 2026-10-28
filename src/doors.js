import { circleBlocked } from './core.js';

export function makeDoors(town) {
  return town.passages.map(passage => {
    const building = town.buildings.find(item => passage.id.startsWith(`${item.id}-`));
    const initialAngle = passage.openAngle ?? (passage.id === 'west-0-east-door' || passage.id === 'courtyard-shop-east-door'
      ? 0 : passage.axis === 'z' && building ? Math.sign(building.x - passage.x) * Math.PI / 2 : Math.PI / 2);
    return { ...passage, height: building ? 2.42 : passage.height - .05, initialAngle, angle: initialAngle, targetAngle: initialAngle,
      state: initialAngle ? 'open' : 'closed', blocked: false, revision: 0 };
  });
}

export function doorCollider(door, angle = door.angle) {
  const along = door.width / 2;
  const hx = door.axis === 'x' ? along : .065, hz = door.axis === 'z' ? along : .065;
  const hingeX = door.x - (door.axis === 'x' ? along : 0);
  const hingeZ = door.z - (door.axis === 'z' ? along : 0);
  const c = Math.cos(angle), s = Math.sin(angle);
  const cx = hingeX + (door.axis === 'x' ? along * c : along * s);
  const cz = hingeZ + (door.axis === 'x' ? -along * s : along * c);
  const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
  return { id: door.id, door: true, angle, cos: c, sin: s, cx, cz, hx, hz, height: door.height,
    minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
}

function awayAngle(door, actor) {
  return door.axis === 'z' ? (actor.x >= door.x ? -1 : 1) * Math.PI / 2 : (actor.z >= door.z ? 1 : -1) * Math.PI / 2;
}

export function requestDoor(door, actor, openOnly = false) {
  if (openOnly && Math.abs(door.targetAngle) > .01) return false;
  door.targetAngle = Math.abs(door.targetAngle) > .01 ? 0 : awayAngle(door, actor);
  door.blocked = false;
  door.state = Math.abs(door.targetAngle) > .01 ? 'opening' : 'closing';
  return true;
}

export function advanceDoor(door, dt, occupants = []) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Door requires a non-negative finite timestep');
  if (dt === 0) return false;
  const difference = door.targetAngle - door.angle;
  if (Math.abs(difference) < .0001) return false;
  const travel = Math.sign(difference) * Math.min(Math.abs(difference), dt * 1.8);
  const steps = Math.max(1, Math.ceil(Math.abs(travel) / .025));
  let changed = false;
  for (let i = 0; i < steps; i++) {
    const next = door.angle + travel / steps;
    const collision = doorCollider(door, next);
    if (occupants.some(actor => circleBlocked(actor.x, actor.z, actor.radius || .42, [collision], actor.y ?? 0))) {
      door.blocked = true; door.state = 'blocked';
      return changed;
    }
    door.angle = next;
    changed = true;
  }
  door.blocked = false;
  if (Math.abs(door.targetAngle - door.angle) < .0001) {
    door.angle = door.targetAngle;
    door.state = Math.abs(door.angle) < .01 ? 'closed' : 'open';
    door.revision++;
  } else door.state = Math.abs(door.targetAngle) > .01 ? 'opening' : 'closing';
  return true;
}

export function resetDoors(doors) {
  for (const door of doors) {
    door.angle = door.targetAngle = door.initialAngle;
    door.state = door.initialAngle ? 'open' : 'closed';
    door.blocked = false;
    door.revision++;
  }
}
