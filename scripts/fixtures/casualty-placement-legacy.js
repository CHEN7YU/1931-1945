export function legacyPlaceCasualty(actor, casualty, boundsFor, blocked) {
  const variants = [casualty.variant, ...[0, 1, 2, 3].filter(value => value !== casualty.variant)]
    .filter(value => !(casualty.motion?.prone > .5) || value === 2);
  const offsets = [{ x: 0, z: 0 }];
  for (const radius of [.15, .3, .5, .75, 1, 1.5, 2]) for (let side = 0; side < 8; side++) {
    offsets.push({ x: Math.cos(side * Math.PI / 4) * radius, z: Math.sin(side * Math.PI / 4) * radius });
  }
  const cardinal = Math.round(actor.heading / (Math.PI / 2)) * Math.PI / 2;
  const headings = [actor.heading, cardinal, cardinal + Math.PI / 2];
  const shapes = new Map(variants.map(variant => {
    const bounds = boundsFor(variant, casualty.retainGun);
    const points = bounds.footprint ? [...bounds.footprint] : [];
    if (!bounds.footprint) for (let x = bounds.min[0]; x <= bounds.max[0] + .001; x += Math.min(.18, bounds.max[0] - x || .18)) {
      for (let z = bounds.min[2]; z <= bounds.max[2] + .001; z += Math.min(.18, bounds.max[2] - z || .18)) points.push([x, z]);
    }
    return [variant, points];
  }));
  for (const offset of offsets) for (const variant of variants) for (const heading of headings) {
    const yaw = Math.atan2(Math.sin(heading - actor.heading), Math.cos(heading - actor.heading));
    let clear = true;
    for (let phase = 1; phase <= 8 && clear; phase++) {
      const progress = phase / 8, grow = Math.sin(progress * Math.PI / 2);
      const angle = actor.heading + yaw * progress, c = Math.cos(angle), s = Math.sin(angle);
      const points = shapes.get(variant);
      for (let index = 0; index < points.length + 8; index++) {
        const x = index < points.length ? points[index][0] * grow : Math.cos((index - points.length) * Math.PI / 4) * .22;
        const z = index < points.length ? points[index][1] * grow : Math.sin((index - points.length) * Math.PI / 4) * .22;
        const point = { x: actor.position.x + offset.x * Math.sqrt(progress) + x * c + z * s,
          y: actor.position.y, z: actor.position.z + offset.z * Math.sqrt(progress) - x * s + z * c };
        if (blocked(point, .13, 1.85 * (1 - grow) + .75 * grow)) { clear = false; break; }
      }
    }
    if (clear) return Object.freeze({ ...casualty, variant, yaw, offset: Object.freeze(offset), wallLimited: false });
  }
  const variant = casualty.motion?.prone > .5 ? 2 : 3;
  const compact = boundsFor(variant, false);
  const points = compact.footprint ?? [[compact.min[0], compact.min[2]], [compact.max[0], compact.max[2]], [0, 0]];
  let best = null;
  for (const offset of offsets) for (const heading of [actor.heading, cardinal, cardinal + Math.PI / 2, cardinal + Math.PI, cardinal - Math.PI / 2]) {
    const distance = Math.hypot(offset.x, offset.z);
    if (best && distance >= best.score) continue;
    const c = Math.cos(heading), s = Math.sin(heading);
    let contacts = 0;
    for (const [x, z] of points) {
      const hit = blocked({ x: actor.position.x + offset.x + x * c + z * s, y: actor.position.y,
        z: actor.position.z + offset.z - x * s + z * c }, .13, .75);
      contacts += Number(hit);
      if (best && contacts * 100 + distance >= best.score) break;
    }
    const score = contacts * 100 + distance;
    if (!best || score < best.score) best = { score, contacts, offset, yaw: Math.atan2(Math.sin(heading - actor.heading), Math.cos(heading - actor.heading)) };
  }
  return Object.freeze({ ...casualty, variant, retainGun: false, yaw: best.yaw,
    offset: Object.freeze(best.offset), wallLimited: true });
}
