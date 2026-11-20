import * as THREE from 'three';
import { valueNoise2D } from './value-noise.js';

const MARK_LIMIT = 12, MARK_LIFE = 55, SMOKE_LIFE = 12, PUFF_LIFE = 4;

function scorchTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dz = (y + .5) / size * 2 - 1;
    const mottling = valueNoise2D(x * .17, y * .17), angle = Math.atan2(dz, dx);
    const edge = .79 + .08 * Math.sin(angle * 5) + .06 * Math.cos(angle * 9) + .16 * (mottling - .5);
    const opacity = THREE.MathUtils.smoothstep(edge - Math.hypot(dx, dz), 0, .45);
    pixels.set([19, 16, 13, Math.round(255 * opacity * (.64 + .36 * mottling))], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createBombAftermath(scene, view, groundHeight, smokeTexture) {
  const map = scorchTexture();
  const slots = Array.from({ length: MARK_LIMIT }, () => {
    const geometry = new THREE.PlaneGeometry(2, 2, 10, 10).rotateX(-Math.PI / 2);
    const grid = geometry.attributes.position.array.slice();
    const mark = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const puffs = Array.from({ length: 4 }, () => new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTexture, color: 0x383531, transparent: true, depthWrite: false,
    })));
    mark.visible = false;
    for (const puff of puffs) puff.visible = false;
    scene.add(mark, ...puffs);
    return { mark, grid, puffs, born: -Infinity, radius: 0, angle: 0 };
  });
  let serial = 0, activeMarks = 0, visibleMarks = 0, visiblePuffs = 0;
  return {
    add(point, time, radius) {
      const slot = slots[serial % MARK_LIMIT];
      slot.angle = ++serial * 2.399963;
      slot.born = time;
      slot.radius = THREE.MathUtils.clamp(radius * .48, 3, 10);
      const { mark, grid } = slot, positions = mark.geometry.attributes.position;
      const cos = Math.cos(slot.angle), sin = Math.sin(slot.angle);
      const height = groundHeight(point.x, point.z);
      mark.position.set(point.x, height, point.z);
      for (let i = 0; i < positions.count; i++) {
        const x = grid[i * 3] * slot.radius, z = grid[i * 3 + 2] * slot.radius * .8;
        const dx = x * cos - z * sin, dz = x * sin + z * cos;
        positions.setXYZ(i, dx, groundHeight(point.x + dx, point.z + dz) - height + .075, dz);
      }
      positions.needsUpdate = true;
      mark.geometry.computeBoundingSphere();
    },
    display(time, low) {
      activeMarks = visibleMarks = visiblePuffs = 0;
      for (const { mark, puffs, born, radius, angle } of slots) {
        const age = time - born, active = age >= 0 && age < MARK_LIFE;
        if (active) activeMarks++;
        mark.visible = active && view.intersects(mark.position, mark.geometry.boundingSphere.radius);
        if (mark.visible) {
          visibleMarks++;
          mark.material.opacity = .94 * Math.min(1, (MARK_LIFE - age) / 8);
        }
        for (const [i, puff] of puffs.entries()) {
          puff.visible = false;
          if (age >= SMOKE_LIFE + PUFF_LIFE || i >= (low ? 2 : 4)) continue;
          const interval = low ? 1.8 : 1, cycle = interval * (low ? 2 : 4);
          const first = .4 + i * interval;
          const emitted = first + Math.floor((age - first) / cycle) * cycle;
          if (emitted < first || emitted >= SMOKE_LIFE) continue;
          const elapsed = age - emitted, t = elapsed / PUFF_LIFE;
          if (t >= 1) continue;
          const spread = elapsed * .8, direction = angle + emitted * .19;
          puff.position.set(mark.position.x + Math.cos(direction) * spread,
            mark.position.y + 1.25 + elapsed * 1.55, mark.position.z + Math.sin(direction) * spread);
          const size = radius * (.39 + .55 * t);
          if (!view.intersects(puff.position, size)) continue;
          puff.visible = true; visiblePuffs++;
          puff.scale.set(size, size * 1.25, 1);
          puff.material.opacity = .78 * Math.min(1, elapsed / .5) * (1 - t) ** .8 * (1 - emitted / (SMOKE_LIFE + 4));
          puff.material.rotation = direction;
        }
      }
    },
    prepareBattleViews(point) {
      const { mark, puffs: [puff] } = slots[0];
      const objects = [mark, puff], saved = objects.map(object => [object.visible, object.position.clone()]);
      for (const object of objects) { object.visible = true; object.position.copy(point); }
      return () => objects.forEach((object, i) => { object.visible = saved[i][0]; object.position.copy(saved[i][1]); });
    },
    clear() {
      serial = 0;
      for (const slot of slots) slot.born = -Infinity;
    },
    get snapshot() { return { marks: activeMarks, visibleMarks, visiblePuffs }; },
  };
}
