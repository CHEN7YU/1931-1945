import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SEGMENTS = 72;
const ROWS = 88;

function attachSleeves(body, sleeves) {
  const positions = sleeves.getAttribute('position'), normals = sleeves.getAttribute('normal');
  const points = [], ids = [], owners = new Map(), edges = new Map();
  for (let index = 0; index < positions.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, index);
    const key = point.toArray().map(value => Math.round(value * 100000)).join(',');
    if (!owners.has(key)) {
      owners.set(key, points.length);
      points.push({ point, normal: new THREE.Vector3().fromBufferAttribute(normals, index) });
    }
    ids.push(owners.get(key));
  }
  for (let triangle = 0; triangle < ids.length; triangle += 3) for (let corner = 0; corner < 3; corner++) {
    const a = ids[triangle + corner], b = ids[triangle + (corner + 1) % 3];
    if (a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push([a, b]);
  }
  const bodyPositions = body.getAttribute('position'), triangle = new THREE.Triangle(), candidate = new THREE.Vector3(), attachments = new Map();
  const closest = id => {
    if (attachments.has(id)) return attachments.get(id);
    const vertex = points[id], result = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
    let nearest = Infinity;
    for (let index = 0; index < body.index.count; index += 3) {
      triangle.a.fromBufferAttribute(bodyPositions, body.index.getX(index));
      triangle.b.fromBufferAttribute(bodyPositions, body.index.getX(index + 1));
      triangle.c.fromBufferAttribute(bodyPositions, body.index.getX(index + 2));
      triangle.closestPointToPoint(vertex.point, candidate);
      const distance = candidate.distanceToSquared(vertex.point);
      if (distance < nearest) {
        nearest = distance; result.point.copy(candidate); triangle.getNormal(result.normal);
      }
    }
    if (Math.sqrt(nearest) > .08) throw new Error('Inspected sleeve opening is too far from the reconstructed shoulder');
    attachments.set(id, result); return result;
  };
  const output = [], outputNormals = [], uvs = [];
  let attachedEdges = 0;
  const armholeEdges = [...edges.values()].filter(occurrences => occurrences.length === 1)
    .map(occurrences => occurrences[0]).filter(([a, b]) => points[a].point.y >= 1.26 && points[b].point.y >= 1.26);
  for (const [a, b] of armholeEdges) { closest(a); closest(b); }
  const originalPoints = points.map(vertex => vertex.point.clone());
  for (let id = 0; id < points.length; id++) {
    let nearest = Infinity, seamId;
    for (const candidate of attachments.keys()) {
      const distance = originalPoints[id].distanceToSquared(originalPoints[candidate]);
      if (distance < nearest) { nearest = distance; seamId = candidate; }
    }
    if (nearest >= .05 ** 2) continue;
    const weight = .55 * (1 - Math.sqrt(nearest) / .05) ** 2, attachment = attachments.get(seamId);
    points[id].point.addScaledVector(attachment.point.clone().sub(originalPoints[seamId]), weight);
    points[id].normal.lerp(attachment.normal, weight).normalize();
  }
  for (let index = 0; index < ids.length; index++) {
    const vertex = points[ids[index]];
    positions.setXYZ(index, ...vertex.point.toArray()); normals.setXYZ(index, ...vertex.normal.toArray());
  }
  positions.needsUpdate = normals.needsUpdate = true;
  const addTriangle = (a, b, c) => {
    const vertices = [a, b, c];
    const faceNormal = new THREE.Vector3().crossVectors(b.point.clone().sub(a.point), c.point.clone().sub(a.point));
    const expected = a.normal.clone().add(b.normal).add(c.normal);
    if (faceNormal.dot(expected) < 0) vertices.reverse();
    for (const vertex of vertices) {
      output.push(...vertex.point.toArray()); outputNormals.push(...vertex.normal.toArray());
      uvs.push(vertex.point.z * 2, vertex.point.y * 2);
    }
  };
  for (const [a, b] of armholeEdges) {
    const innerA = closest(a), innerB = closest(b);
    addTriangle(points[a], points[b], innerA); addTriangle(points[b], innerB, innerA); attachedEdges++;
  }
  if (attachedEdges < 12) throw new Error('Inspected sleeve armhole contours changed');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(output, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outputNormals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.userData.attachedArmholeEdges = attachedEdges;
  return geometry;
}

export function tailorStudyGarment(reference, sleeves) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const target = new THREE.Mesh(reference, material);
  target.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(), 0, .48);
  const measured = [], centerZ = -.026, directions = [];
  for (let column = 0; column < SEGMENTS; column++) {
    const angle = column / SEGMENTS * Math.PI * 2;
    directions.push(new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)));
  }
  let validSamples = 0;
  for (let row = 0; row <= ROWS; row++) {
    const y = THREE.MathUtils.lerp(.86, 1.415, row / ROWS), radii = [];
    for (const direction of directions) {
      ray.ray.origin.set(direction.x * .45, y, centerZ + direction.z * .45);
      ray.ray.direction.copy(direction).negate();
      const hit = ray.intersectObject(target, false).find(item => item.distance < .43);
      radii.push(hit ? .45 - hit.distance : null);
      if (hit) validSamples++;
    }
    measured.push(radii);
  }
  material.dispose();
  const coverage = validSamples / ((ROWS + 1) * SEGMENTS);
  if (coverage < .60) throw new Error(`Insufficient inspected torso surface for reconstruction: ${coverage.toFixed(3)}`);
  const validRows = measured.map(radii => radii.filter(value => value !== null).length >= SEGMENTS * .35);

  // Reconstruct deliberately removed pockets/harness cutouts from adjacent measured cloth, not from placeholder body shapes.
  const filled = measured.map((radii, row) => {
    if (!validRows[row]) return Array(SEGMENTS).fill(null);
    return radii.map((radius, column) => {
      if (radius !== null) return radius;
      let before = 1, after = 1;
      while (radii[(column - before + SEGMENTS) % SEGMENTS] === null) before++;
      while (radii[(column + after) % SEGMENTS] === null) after++;
      return THREE.MathUtils.lerp(radii[(column - before + SEGMENTS) % SEGMENTS], radii[(column + after) % SEGMENTS], before / (before + after));
    });
  });
  for (let row = 0; row <= ROWS; row++) for (let column = 0; column < SEGMENTS; column++) {
    if (filled[row][column] !== null) continue;
    let before = row - 1, after = row + 1;
    while (before >= 0 && !validRows[before]) before--;
    while (after <= ROWS && !validRows[after]) after++;
    if (before < 0 && after > ROWS) throw new Error('Inspected torso is missing longitudinal fit references');
    filled[row][column] = before < 0 ? filled[after][column] : after > ROWS ? filled[before][column] :
      THREE.MathUtils.lerp(filled[before][column], filled[after][column], (row - before) / (after - before));
  }

  const positions = [], uvs = [], indices = [], profile = [];
  const bell = (y, center, width) => Math.exp(-(((y - center) / width) ** 2));
  for (let row = 0; row <= ROWS; row++) {
    const radii = directions.map((_, column) => {
      let sum = 0, weights = 0;
      for (let offset = -4; offset <= 4; offset++) {
        const weight = 5 - Math.abs(offset), at = THREE.MathUtils.clamp(row + offset, 0, ROWS);
        const adjacent = (column + SEGMENTS - 1) % SEGMENTS, next = (column + 1) % SEGMENTS;
        const mirror = (SEGMENTS - column) % SEGMENTS;
        sum += weight * (filled[at][column] * .55 + filled[at][mirror] * .15 +
          (filled[at][adjacent] + filled[at][next]) * .15);
        weights += weight;
      }
      return sum / weights;
    });
    const y = THREE.MathUtils.lerp(.86, 1.415, row / ROWS);
    profile.push({
      y, radii,
      widthEase: .016 * bell(y, 1.29, .115) + .003 * bell(y, 1.12, .08),
      depthEase: .018 * bell(y, 1.32, .11) + .004 * bell(y, 1.13, .09),
    });
  }
  const shoulder = profile[ROWS];
  for (let row = 1; row <= 10; row++) {
    const t = row / 10, radii = directions.map((direction, column) => {
      const neckRadius = 1 / Math.sqrt((direction.x / .066) ** 2 + (direction.z / .058) ** 2);
      const shoulderRadius = shoulder.radii[column] + direction.x ** 2 * shoulder.widthEase + direction.z ** 2 * shoulder.depthEase;
      return THREE.MathUtils.lerp(shoulderRadius, neckRadius, t);
    });
    profile.push({ t, radii });
  }
  for (const [height, scale] of [[.030, .97], [.030, .94], [.002, .94]]) {
    profile.push({ collar: true, height, radii: directions.map(direction => scale / Math.sqrt((direction.x / .066) ** 2 + (direction.z / .058) ** 2)) });
  }
  for (let row = 0; row < profile.length; row++) for (let column = 0; column <= SEGMENTS; column++) {
    const at = column % SEGMENTS, direction = directions[at], ring = profile[row], neckY = 1.465 - .025 * direction.z;
    const y = ring.collar ? neckY + ring.height : ring.t ? THREE.MathUtils.lerp(1.415, neckY, ring.t) : ring.y;
    const creaseY = 1.18 - .07 * Math.abs(direction.x);
    const tension = Math.max(0, direction.z) ** 3 * .0025 *
      (bell(y, creaseY, .016) - .5 * bell(y, creaseY + .025, .02));
    positions.push(direction.x * (ring.radii[at] + (ring.widthEase ?? 0) + tension), y,
      centerZ + direction.z * (ring.radii[at] + (ring.depthEase ?? 0) + tension));
    uvs.push(column / SEGMENTS, (y - .86) / .64);
    if (row && column) {
      const a = (row - 1) * (SEGMENTS + 1) + column - 1, b = a + SEGMENTS + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  body.setIndex(indices); body.computeVertexNormals();
  const normals = body.getAttribute('normal'), normal = new THREE.Vector3(), other = new THREE.Vector3();
  for (let row = 0; row < profile.length; row++) {
    const start = row * (SEGMENTS + 1), end = start + SEGMENTS;
    normal.fromBufferAttribute(normals, start).add(other.fromBufferAttribute(normals, end)).normalize();
    normals.setXYZ(start, normal.x, normal.y, normal.z); normals.setXYZ(end, normal.x, normal.y, normal.z);
  }
  const armholes = attachSleeves(body, sleeves), expanded = body.toNonIndexed(), result = mergeGeometries([expanded, sleeves, armholes]);
  body.dispose(); expanded.dispose(); armholes.dispose();
  if (!result) throw new Error('Refitted garment body and source sleeves could not be combined');
  result.userData = {
    hasGeometricFolds: true, rebuiltStandingCollar: true, waistJoined: true,
    measuredCoverage: coverage, reconstructedSamples: (ROWS + 1) * SEGMENTS - validSamples,
    bodyTriangleCount: indices.length / 3,
    attachedArmholeEdges: armholes.userData.attachedArmholeEdges,
    chestBackEase: true, smoothedTorsoPanels: true,
    construction: 'Measured torso with smoothed panels and chest/back ease, reconstructed cutouts, redrafted standing collar and fitted source sleeves; artistic fit, not anthropometric evidence.',
  };
  return result;
}
