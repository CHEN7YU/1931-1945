export const CHI_HA = Object.freeze({
  id: 'chi-ha', name: '九七式中战车 · 早期57毫米型',
  length: 5.5, width: 2.33, height: 2.21,
  health: 280, speed: 4.2, magazine: 1, reload: 5.5, interval: .5,
  damage: 125, blastRadius: 6, range: 95, turnRate: .48, turretRate: .55,
  clearance: 3, arrivalDistance: 1.25, stationOffset: 4.5, firePause: 1.2, firePauseInterval: 4,
  turret: Object.freeze({ x: .1, y: 1.41, z: -.42 }),
  gun: Object.freeze({ x: -.2, y: .30, z: -.60, length: .94 }),
});

export const CHI_HA_SEATS = Object.freeze([
  Object.freeze({ role: 'commander', label: '车长', eyeHeight: 2.1, canFire: true, controlsTurret: true }),
  Object.freeze({ role: 'gunner', label: '炮手', eyeHeight: 1.7, canFire: true, controlsTurret: true }),
  Object.freeze({ role: 'driver', label: '驾驶员', eyeHeight: 1.2, canFire: false, controlsTurret: false }),
  Object.freeze({ role: 'hull-gunner', label: '车体机枪手', eyeHeight: 1.2, canFire: false, controlsTurret: false }),
]);

export const CHI_HA_MG = Object.freeze({
  name: '九七式车载机枪', magazine: 20, reload: 3.8, interval: .12,
  burst: 5, cooldown: 1.6, damage: 35, range: 55, spread: .014,
  traverse: .5, minPitch: -.3, maxPitch: .3, turnRate: 1.4,
});
export const CHI_HA_MG_MOUNTS = Object.freeze([
  Object.freeze({ id: 'hull', role: 'hull-gunner', x: -.51, y: 1.28, z: -1.78, length: .44 }),
  Object.freeze({ id: 'rear', role: 'commander', x: .32, y: .27, z: .79, length: .38 }),
]);

export function chiHaMachineGunPose(vehicle, gun) {
  const mount = CHI_HA_MG_MOUNTS.find(item => item.id === gun.mount);
  if (!mount) throw new RangeError('Unknown Chi-Ha machine-gun mount');
  const rear = mount.id === 'rear', baseYaw = rear ? vehicle.turretYaw : vehicle.heading;
  const c = Math.cos(baseYaw), s = Math.sin(baseYaw);
  const hc = Math.cos(vehicle.heading), hs = Math.sin(vehicle.heading);
  const yaw = baseYaw + (rear ? Math.PI : 0) + gun.yaw;
  const pivot = {
    x: vehicle.position.x + mount.x * c + mount.z * s + (rear ? CHI_HA.turret.x * hc + CHI_HA.turret.z * hs : 0),
    y: vehicle.position.y + mount.y + (rear ? CHI_HA.turret.y : 0),
    z: vehicle.position.z - mount.x * s + mount.z * c + (rear ? -CHI_HA.turret.x * hs + CHI_HA.turret.z * hc : 0),
  };
  return { pivot, yaw, pitch: gun.pitch, start: {
    x: pivot.x - Math.sin(yaw) * Math.cos(gun.pitch) * mount.length,
    y: pivot.y + Math.sin(gun.pitch) * mount.length,
    z: pivot.z - Math.cos(yaw) * Math.cos(gun.pitch) * mount.length,
  } };
}

export function japaneseArmorRoster() {
  return [0, 1].map(slot => ({ id: `enemy-${8 + slot}`, team: 'enemy', index: 8 + slot,
    type: 'tank', variant: CHI_HA.id, player: false, members: [], generation: 0, respawnAt: null,
    spawnId: `japan-garage-${slot}` }));
}

export function chiHaObjectiveDestination(slot, objective) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 1) throw new RangeError('Chi-Ha deployment requires one of its two formation slots');
  if (objective?.captureArea) return { ...objective,
    x: slot === 0 ? objective.captureArea.minX - CHI_HA.stationOffset : objective.captureArea.maxX + CHI_HA.stationOffset };
  return objective ? { ...objective, x: objective.x + (slot === 0 ? -CHI_HA.stationOffset : CHI_HA.stationOffset) } : null;
}

export function japaneseArmorSpawns() {
  return [9, 16.5].map((x, slot) => ({ id: `japan-garage-${slot}`, name: `日军九七式装甲出发点 ${slot + 1}`,
    team: 'enemy', kind: 'garage', x, z: -94.5, altitude: 0, aiOnly: true }));
}

export function chiHaMuzzle(vehicle) {
  const c = Math.cos(vehicle.heading), s = Math.sin(vehicle.heading);
  const tc = Math.cos(vehicle.turretYaw), ts = Math.sin(vehicle.turretYaw);
  const pitch = vehicle.turretPitch;
  const z = CHI_HA.gun.z - CHI_HA.gun.length * Math.cos(pitch);
  return {
    x: vehicle.position.x + CHI_HA.turret.x * c + CHI_HA.turret.z * s + CHI_HA.gun.x * tc + z * ts,
    y: vehicle.position.y + CHI_HA.turret.y + CHI_HA.gun.y + CHI_HA.gun.length * Math.sin(pitch),
    z: vehicle.position.z - CHI_HA.turret.x * s + CHI_HA.turret.z * c - CHI_HA.gun.x * ts + z * tc,
  };
}
