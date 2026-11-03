import { civilianPaceMultiplier, civilianWaypointReached, moveCivilianInCrowd } from './civilian-crowd.js';

export function resetCivilianStreetLife(person) {
  const street = person.userData.streetLife;
  if (!street) return;
  street.waypoint = street.initialWaypoint;
  street.wakeAt = street.initialDelay;
  street.cycles = 0;
  person.position.set(street.initialPosition.x, 0, street.initialPosition.z);
  person.visible = street.initialWaypoint > 0;
}

export function updateCivilianStreetLife(person, now, dt, peers, doorSystem) {
  const data = person.userData, street = data.streetLife;
  if (now < street.wakeAt) return;
  const target = street.route[street.waypoint];
  if (!person.visible) {
    if (peers.some(other => other !== person &&
      Math.hypot(person.position.x - other.position.x, person.position.z - other.position.z) < .74)) return;
    person.visible = true; peers.push(person);
  }
  if (!openCivilianHomeDoor(person, doorSystem)) {
    for (const leg of person.civilianLegs) leg.rotation.x = 0;
    return;
  }
  const dx = target.x - person.position.x, dz = target.z - person.position.z;
  const travel = Math.min(Math.hypot(dx, dz), dt * 1.15 * civilianPaceMultiplier(data.civilianId, now));
  const moved = moveCivilianInCrowd(person, target, travel, peers, street.movementObstacles, street.navigationObstacles);
  person.rotation.y = Math.atan2(-dx, -dz);
  data.walkPhase += moved * 5;
  const stride = moved > .001 ? Math.sin(data.walkPhase) * .32 : 0;
  for (let index = 0; index < 2; index++) {
    person.civilianLegs[index].rotation.x = stride * (index ? -1 : 1);
    person.civilianArms[index].rotation.x = -stride * (index ? -1 : 1);
  }
  person.civilianHead.rotation.y = Math.sin(now * .7 + data.civilianId) * .16;
  if (civilianWaypointReached(person.position, street.route, street.waypoint, street.navigationObstacles,street.navigationLookup))
    street.waypoint++;
  if (street.waypoint === street.route.length) {
    // Hide only after physically crossing the open doorway into the house.
    person.visible = false;
    street.cycles++;
    street.waypoint = 0;
    street.wakeAt = now + 8 + data.civilianId % 7 * 1.7;
    if (Math.abs(street.door.targetAngle) > .01) doorSystem.interact(street.door, person.position);
  }
}

export function openCivilianHomeDoor(person, doorSystem) {
  const street = person.userData.streetLife;
  if (Math.hypot(person.position.x - street.door.x, person.position.z - street.door.z) >= 2) return true;
  if (Math.abs(street.door.targetAngle) < .01) doorSystem.interact(street.door, street.exit);
  return Math.abs(street.door.angle) >= 1.5;
}

export function beginCivilianStreetEvacuation(person) {
  const data = person.userData, street = data.streetLife;
  const exitPath = street.navigate(person.position, street.exit);
  if (!exitPath.length) throw new Error(`Street civilian ${data.civilianId} cannot return to its evacuation route: ` +
    `${street.navigate.stats.reason}, ${JSON.stringify(person.position)} -> ${JSON.stringify(street.exit)}`);
  data.route = [...exitPath, ...data.homeRoute];
  data.waypoint = 0;
  data.crowdTarget = data.crowdPath = null;
  data.crowdStalled = 0;
  data.streetEvacuating = true;
}
