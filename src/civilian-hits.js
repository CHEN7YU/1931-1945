export function traceCivilianBullet(civilians, start, direction, maximumDistance) {
  let closest = maximumDistance, result = null;
  for (const civilian of civilians) {
    const data = civilian.userData;
    if (!civilian.visible || data.dead || data.evacuated) continue;
    const scale = civilian.civilianSkin?.profile.height ?? 1;
    const height = scale * (1.72 - (data.escapeMotion?.crouch ?? 0) * .65);
    const radius = scale * .22;
    for (const y of [radius + .08, height * .53, height - radius]) {
      const dx = civilian.position.x - start.x, dy = civilian.position.y + y - start.y, dz = civilian.position.z - start.z;
      const along = dx * direction.x + dy * direction.y + dz * direction.z;
      const perpendicular = dx * dx + dy * dy + dz * dz - along * along;
      if (perpendicular > radius * radius) continue;
      const at = along - Math.sqrt(Math.max(0, radius * radius - perpendicular));
      if (at < 0 || at >= closest) continue;
      closest = at;
      result = { civilian, distance: at,
        position: { x: start.x + direction.x * at, y: start.y + direction.y * at, z: start.z + direction.z * at } };
    }
  }
  return result;
}
