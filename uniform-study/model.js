import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function profileGeometry(rings, segments = 32) {
  const positions = [], uvs = [], indices = [];
  rings.forEach(([y, rx, rz, z = 0], row) => {
    for (let column = 0; column <= segments; column++) {
      const angle = column / segments * Math.PI * 2;
      positions.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + z);
      uvs.push(column / segments, row / (rings.length - 1));
      if (row && column) {
        const a = (row - 1) * (segments + 1) + column - 1, b = a + segments + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function roundedBox(width, height, depth, radius = .008) {
  const shape = new THREE.Shape(), x = -width / 2, y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - radius, bevelEnabled: true, bevelSize: radius / 2,
    bevelThickness: radius / 2, bevelSegments: 2, steps: 1, curveSegments: 4,
  });
  geometry.translate(0, 0, -(depth - radius) / 2);
  return geometry;
}

function trouserGeometry(rings, side) {
  const phase = side * 1.4;
  const bell = (value, center, width) => Math.exp(-(((value - center) / width) ** 2));
  const curve = new THREE.CatmullRomCurve3(rings.map(([y, x, z]) => new THREE.Vector3(x, y, z)));
  const sampled = [];
  for (let row = 0; row <= 80; row++) {
    const p = curve.getPoint(row / 80);
    const at = row / 80 * (rings.length - 1), lower = Math.floor(at), upper = Math.min(lower + 1, rings.length - 1);
    const offset = THREE.MathUtils.lerp(rings[lower][3] ?? 0, rings[upper][3] ?? 0, at - lower);
    sampled.push([p.y, p.x, p.z, offset]);
  }
  const geometry = profileGeometry(sampled, 48), positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const angle = index % 49 / 48 * Math.PI * 2;
    const rear = Math.max(0, -Math.cos(angle)) ** 3;
    const front = Math.max(0, Math.cos(angle)) ** 2;
    let fold = .0008 * Math.sin(angle * 5 + y * 9 + phase);
    fold += .0045 * Math.sin((y - .50) * 83 + angle * 1.6 + phase) * bell(y, .50, .043) * rear;
    fold += .0027 * Math.sin((y - .85) * 60 - angle * 2 + phase) * bell(y, .85, .045) * front;
    fold += .0028 * Math.sin((y - .44) * 110 + angle * 1.3 + phase) * bell(y, .445, .024);
    if (y > .76) {
      // Both leg panels end on the same curved crotch seam, rather than leaving a gap between two tubes.
      const t = (y - .76) / (.94 - .76), inner = Math.max(0, -side * Math.sin(angle));
      const waistX = inner > 0 ? 0 : Math.sin(angle) * .155;
      const drape = fold * Math.sin(Math.PI * t);
      positions.setXYZ(index,
        THREE.MathUtils.lerp(Math.sin(angle) * .082, waistX - side * .097, t) + Math.sin(angle) * drape,
        THREE.MathUtils.lerp(.76, .98 - .18 * inner, t),
        THREE.MathUtils.lerp(Math.cos(angle) * .084, -.026 + Math.cos(angle) * .120, t) + Math.cos(angle) * drape);
    } else {
      const ankleAlignment = side * .005 * (1 - THREE.MathUtils.smoothstep(y, .43, .70));
      positions.setXYZ(index, x + Math.sin(angle) * fold + ankleAlignment, y, z + Math.cos(angle) * fold);
    }
  }
  positions.needsUpdate = true; geometry.computeVertexNormals();
  geometry.userData.hasGeometricFolds = true;
  geometry.userData.foldZones = ['crotch', 'back-of-knee', 'puttee-top'];
  geometry.userData.joinedCrotch = true;
  return geometry;
}

function pouchFlapGeometry(width, height = .092, depth = .066) {
  const top = height / 2 + .005, front = depth / 2 + .004, thickness = .0025;
  const shape = new THREE.Shape();
  shape.moveTo(-depth / 2 + .003, top); shape.lineTo(front - .019, top);
  shape.quadraticCurveTo(front, top, front, top - .020);
  shape.lineTo(front, top - .042); shape.lineTo(front - thickness, top - .042); shape.lineTo(front - thickness, top - .020);
  shape.quadraticCurveTo(front - thickness, top - thickness, front - .019, top - thickness);
  shape.lineTo(-depth / 2 + .003, top - thickness); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 12, steps: 1 });
  geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2, 0, 0);
  geometry.userData.thicknessMetres = thickness;
  return geometry;
}

function haversackGeometry() {
  const rings = [
    [-.096, 0, 0], [-.086, .065, .024], [-.060, .084, .035],
    [0, .091, .037], [.055, .087, .033], [.086, .077, .026], [.090, 0, 0],
  ];
  const geometry = profileGeometry(rings, 32), positions = geometry.attributes.position;
  for (let row = 0; row < rings.length; row++) for (let column = 0; column <= 32; column++) {
    const angle = column / 32 * Math.PI * 2, sine = Math.sin(angle), cosine = Math.cos(angle);
    const [y, rx, rz] = rings[row], x = Math.sign(sine) * Math.abs(sine) ** .38 * rx;
    const face = Math.abs(cosine) ** 6, gathering = Math.exp(-(((y - .055) / .05) ** 2));
    const folds = .0025 * Math.cos(x * 95) * face * gathering * Math.min(1, rx / .065);
    positions.setXYZ(row * 33 + column, x, y,
      Math.sign(cosine) * (Math.abs(cosine) ** .38 * rz + folds));
  }
  geometry.computeVertexNormals();
  geometry.userData.softCanvas = true;
  geometry.userData.foldZones = ['rounded-loaded-bottom', 'gathered-top'];
  return geometry;
}

function haversackFlapGeometry() {
  const positions = [], uvs = [], indices = [], columns = 12, rows = 4;
  const count = (columns + 1) * (rows + 1);
  for (const layer of [1, -1]) for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const across = column / columns * 2 - 1, down = row / rows;
    positions.push(across * .095, .0405 - down * .081 - .007 * (1 - across ** 2) * down,
      .008 * Math.sin(Math.PI * down) + layer * .002);
    uvs.push(column / columns, down);
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + columns + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1,
      a + count, a + count + 1, b + count, a + count + 1, b + count + 1, b + count);
  }
  const boundary = [];
  for (let column = 0; column <= columns; column++) boundary.push(column);
  for (let row = 1; row <= rows; row++) boundary.push(row * (columns + 1) + columns);
  for (let column = columns - 1; column >= 0; column--) boundary.push(rows * (columns + 1) + column);
  for (let row = rows - 1; row > 0; row--) boundary.push(row * (columns + 1));
  boundary.forEach((a, index) => {
    const b = boundary[(index + 1) % boundary.length];
    indices.push(a, b, a + count, b, b + count, a + count);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.userData.drapedFlap = true; geometry.userData.thicknessMetres = .004;
  return geometry;
}

export function createUniformStudy({ textures = {}, upperBody } = {}) {
  if (!upperBody?.isMesh || !upperBody.userData.adaptedSourceGarment) throw new Error('Uniform study requires the inspected static garment; no geometric-person fallback is used');
  const root = new THREE.Group();
  root.name = '1938-uniform-study';
  const materials = {
    cloth: new THREE.MeshPhysicalMaterial({ color: 0x927c42, roughness: .97, sheen: .22, sheenColor: new THREE.Color(0xada078), sheenRoughness: 1, ...textures.cloth }),
    seam: new THREE.MeshStandardMaterial({ color: 0x75653b, roughness: 1 }),
    lining: new THREE.MeshStandardMaterial({ color: 0x6d5b32, roughness: 1 }),
    puttee: new THREE.MeshStandardMaterial({ color: 0x716b52, roughness: 1, ...textures.cloth }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3c3025, roughness: .88, ...textures.leather }),
    edge: new THREE.MeshStandardMaterial({ color: 0x62523b, roughness: .96 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4e533e, roughness: .9, metalness: .04, ...textures.paint }),
    buckle: new THREE.MeshStandardMaterial({ color: 0x756b46, roughness: .56, metalness: .65 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x696b50, roughness: 1, side: THREE.DoubleSide, ...textures.cloth }),
    collar: new THREE.MeshStandardMaterial({ color: 0x713b2c, roughness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x292a22, roughness: .92 }),
  };
  const groups = {};
  for (const name of ['uniform', 'head', 'helmet', 'equipment']) {
    groups[name] = new THREE.Group(); groups[name].name = name; root.add(groups[name]);
  }
  const add = (parent, geometry, material, position = [0, 0, 0], name = '') => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  };
  const box = (parent, size, position, material, name) =>
    add(parent, roundedBox(...size, Math.min(.008, Math.min(...size) / 4)), material, position, name);
  const oval = (parent, size, position, material, name) => {
    const mesh = add(parent, new THREE.SphereGeometry(1, 24, 16), material, position, name);
    mesh.scale.set(...size); return mesh;
  };
  const line = (parent, points, radius, material, name) => add(parent,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))), Math.max(8, points.length * 5), radius, 6, false),
    material, [0, 0, 0], name);
  const cylinder = (parent, from, to, top, bottom, material, name) => {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to), axis = end.clone().sub(start);
    const mesh = add(parent, new THREE.CylinderGeometry(top, bottom, axis.length(), 20),
      material, start.add(end).multiplyScalar(.5).toArray(), name);
    mesh.quaternion.setFromUnitVectors(UP, axis.normalize()); return mesh;
  };
  const strap = (parent, points, width, material, name) => {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const positions = [], uvs = [], indices = [], fitted = [];
    let contacts = 0;
    for (let step = 0; step <= 100; step++) {
      const t = step / 100, point = curve.getPoint(t);
      const outward = new THREE.Vector3(point.x, 0, point.z + (parent === groups.equipment ? .026 : 0)).normalize();
      if (parent === groups.equipment) {
        if (point.y > 1.415) {
          tunicRay.ray.origin.set(point.x, 1.8, point.z); tunicRay.ray.direction.set(0, -1, 0);
        } else {
          tunicRay.ray.origin.set(outward.x * .5, point.y, -.026 + outward.z * .5);
          tunicRay.ray.direction.copy(outward).negate();
        }
        const hit = tunicRay.intersectObject(torso, false).find(item => item.faceIndex < torso.geometry.userData.bodyTriangleCount);
        if (hit) {
          const weight = THREE.MathUtils.smoothstep(t, 0, .12) * (1 - THREE.MathUtils.smoothstep(t, .88, 1));
          point.lerp(hit.point.clone().addScaledVector(hit.face.normal, .004), weight);
          outward.lerp(hit.face.normal, weight).normalize(); contacts++;
        }
      }
      fitted.push({ point, outward });
    }
    if (parent === groups.equipment && contacts < 20) throw new Error(`Shoulder strap misses its garment: ${name}`);
    for (let step = 0; step <= 100; step++) {
      const t = step / 100, { point, outward } = fitted[step];
      const tangent = fitted[Math.min(step + 1, 100)].point.clone().sub(fitted[Math.max(step - 1, 0)].point).normalize();
      const across = new THREE.Vector3().crossVectors(tangent, outward).normalize().multiplyScalar(width / 2);
      for (const edge of [point.clone().sub(across), point.clone().add(across)]) {
        positions.push(...edge.toArray());
      }
      uvs.push(0, t * 5, 1, t * 5);
      if (step) { const a = (step - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const surfaceNormals = geometry.getAttribute('normal'), count = positions.length / 3;
    for (let index = 0; index < count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), index);
      point.addScaledVector(new THREE.Vector3().fromBufferAttribute(surfaceNormals, index), -.0012);
      positions.push(...point.toArray()); uvs.push(uvs[index * 2], uvs[index * 2 + 1]);
    }
    const front = [...indices];
    for (let triangle = 0; triangle < front.length; triangle += 3) indices.push(front[triangle] + count, front[triangle + 2] + count, front[triangle + 1] + count);
    for (let step = 0; step < 100; step++) {
      const a = step * 2, b = a + 2;
      indices.push(a, b, a + count, b, b + count, a + count,
        a + 1, a + count + 1, b + 1, b + 1, a + count + 1, b + count + 1);
    }
    indices.push(0, count, 1, 1, count, count + 1,
      count - 2, count - 1, count * 2 - 2, count - 1, count * 2 - 1, count * 2 - 2);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.deleteAttribute('normal'); geometry.computeVertexNormals();
    geometry.userData.thicknessMetres = .0012;
    geometry.userData.widthMetres = width; geometry.userData.fittedContactSamples = contacts;
    return add(parent, geometry, material, [0, 0, 0], name);
  };
  const { uniform, helmet, equipment } = groups;

  const torso = upperBody;
  torso.material.dispose(); torso.material = materials.cloth; uniform.add(torso);
  torso.updateMatrixWorld(true);
  const tunicRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, 1);
  const tunicFront = (x, y) => {
    tunicRay.ray.origin.set(x, y, .5);
    tunicRay.ray.direction.set(0, 0, -1);
    const hit = tunicRay.intersectObject(torso, false).find(item => item.faceIndex < torso.geometry.userData.bodyTriangleCount);
    if (!hit) throw new Error(`Tunic detail misses its cloth surface: ${x}, ${y}`);
    return hit.point.z;
  };
  for (const side of [-1, 1]) {
    const patch = box(uniform, [.034, .014, .002], [side * .039, 1.465, tunicFront(side * .039, 1.465) + .002], materials.collar, 'branch-position-only');
    patch.rotation.y = side * .53;
    const leg = add(uniform, trouserGeometry([
      [.115, .043, .048, -.006], [.25, .048, .054, -.008], [.35, .052, .058, -.009],
      [.41, .051, .055, -.003], [.43, .053, .057], [.49, .065, .067],
      [.56, .073, .076], [.69, .082, .083], [.81, .082, .085], [.94, .073, .078],
    ], side), materials.cloth, [side * .097, 0, 0], 'trouser-leg');
    leg.userData.wearerSide = side;
    const putteeRings = [
      [.112, .053, .062, -.006], [.17, .050, .058, -.008], [.25, .057, .065, -.011],
      [.33, .060, .068, -.011], [.39, .059, .066, -.005], [.43, .059, .064],
    ];
    const puttee = add(uniform, profileGeometry(putteeRings, 48), materials.puttee, [side * .102, 0, 0], 'spiral-puttee');
    const putteeProfile = y => {
      const upper = putteeRings.findIndex(ring => ring[0] >= y), lower = Math.max(0, upper - 1);
      const a = putteeRings[lower], b = putteeRings[upper];
      const t = a === b ? 0 : (y - a[0]) / (b[0] - a[0]);
      return [THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t),
        THREE.MathUtils.lerp(a[3] ?? 0, b[3] ?? 0, t)];
    };
    const wrapPoints = [];
    for (let step = 0; step <= 240; step++) {
      const t = step / 240, angle = t * Math.PI * 2 * 8, y = .12 + .30 * t;
      const [rx, rz, z] = putteeProfile(y);
      wrapPoints.push([side * .102 + Math.sin(angle) * (rx + .0007), y, z + Math.cos(angle) * (rz + .0007)]);
    }
    line(uniform, wrapPoints, .0005, materials.seam, 'puttee-wrap-edge');
    puttee.userData.wraps = 8;
    puttee.userData.shapedCalf = true;
    const bootGeometry = profileGeometry([
      [.021, .049, .117, .047], [.037, .053, .120, .047], [.061, .053, .114, .047],
      [.083, .050, .100, .039], [.109, .048, .073, .018], [.138, .045, .050, -.008],
      [.172, .044, .043, -.015], [.177, .045, .044, -.015],
    ], 48);
    const bootPositions = bootGeometry.getAttribute('position');
    for (let index = 0; index < bootPositions.count; index++) {
      const y = bootPositions.getY(index), z = bootPositions.getZ(index);
      const toe = THREE.MathUtils.smoothstep(z, .085, .145);
      if (y > .045) bootPositions.setY(index, .045 + (y - .045) * (1 - toe * .35));
    }
    bootGeometry.computeVertexNormals();
    const boot = add(uniform, bootGeometry, materials.leather, [side * .102, 0, 0], 'ankle-boot');
    boot.updateMatrixWorld(true);
    const bootRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, 1);
    const bootFront = (x, y) => {
      bootRay.ray.origin.set(side * .102 + x, y, .4);
      const hit = bootRay.intersectObject(boot, false)[0];
      if (!hit) throw new Error(`Boot construction misses its upper: ${x}, ${y}`);
      return [side * .102 + x, y, hit.point.z + .0012];
    };
    add(uniform, profileGeometry([
      [.006, .048, .117, .047], [.012, .054, .123, .047], [.022, .054, .123, .047], [.026, .052, .121, .047],
    ], 48), materials.dark, [side * .102, 0, 0], 'boot-sole');
    box(uniform, [.084, .022, .065], [side * .102, .015, -.033], materials.dark, 'boot-heel');
    const vamp = [];
    for (let step = 0; step <= 20; step++) {
      const angle = THREE.MathUtils.lerp(-Math.PI / 2, Math.PI / 2, step / 20);
      vamp.push(bootFront(Math.sin(angle) * .043, .086 - .018 * Math.cos(angle)));
    }
    line(uniform, vamp, .0006, materials.edge, 'boot-vamp-seam');
    for (let row = 0; row < 5; row++) {
      const y = .155 - row * .011;
      for (const direction of [-1, 1]) {
        line(uniform, [bootFront(direction * .017, y), bootFront(0, y - .003), bootFront(-direction * .017, y - .006)],
          .0009, materials.edge, 'boot-lace');
      }
    }
    const positions = [], uvs = [], indices = [];
    for (let row = 0; row <= 4; row++) for (let column = 0; column <= 20; column++) {
      const localX = (column / 20 - .5) * .096, x = side * .087 + localX;
      const bottom = -.024 + Math.abs(localX / .048) ** 1.6 * .019;
      const y = 1.315 + THREE.MathUtils.lerp(bottom, .015, row / 4);
      positions.push(x, y, tunicFront(x, y) + THREE.MathUtils.lerp(.003, .001, row / 4)); uvs.push(column / 20, row / 4);
      if (row && column) {
        const a = (row - 1) * 21 + column - 1, b = a + 21;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const flapGeometry = new THREE.BufferGeometry();
    flapGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    flapGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    flapGeometry.setIndex(indices); flapGeometry.computeVertexNormals();
    add(uniform, flapGeometry, materials.cloth, [0, 0, 0], 'internal-pocket-flap-approximation');
    const flapEdge = [];
    for (let step = 0; step <= 16; step++) {
      const localX = (step / 16 - .5) * .096, x = side * .087 + localX;
      const y = 1.315 - .024 + Math.abs(localX / .048) ** 1.6 * .019;
      flapEdge.push([x, y, tunicFront(x, y) + .0035]);
    }
    line(uniform, flapEdge, .00065, materials.seam, 'pocket-flap-edge');
    oval(uniform, [.004, .004, .002], [side * .087, 1.303, tunicFront(side * .087, 1.303) + .005], materials.buckle, 'pocket-button');
  }
  const placket = [], placketPositions = [], placketUvs = [], placketIndices = [];
  for (let step = 0; step <= 36; step++) {
    const y = THREE.MathUtils.lerp(.88, 1.455, step / 36);
    placket.push([.012, y, tunicFront(.012, y) + .0024]);
    for (const x of [-.010, .013]) {
      placketPositions.push(x, y, tunicFront(x, y) + .0018); placketUvs.push(x * 2, y * 2);
    }
    if (step) { const a = (step - 1) * 2; placketIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const placketGeometry = new THREE.BufferGeometry();
  placketGeometry.setAttribute('position', new THREE.Float32BufferAttribute(placketPositions, 3));
  placketGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(placketUvs, 2));
  placketGeometry.setIndex(placketIndices); placketGeometry.computeVertexNormals();
  add(uniform, placketGeometry, materials.cloth, [0, 0, 0], 'overlapping-front-placket');
  line(uniform, placket, .0005, materials.seam, 'front-placket-seam');
  for (const y of [1.405, 1.325, 1.245, 1.16, .965]) {
    oval(uniform, [.005, .005, .002], [.003, y, tunicFront(.003, y) + .004], materials.buckle, 'tunic-button');
  }

  const helmetGeometry = profileGeometry([
    [0, .112, .130], [.005, .115, .133], [.012, .112, .129],
    [.028, .112, .127], [.060, .106, .119], [.094, .094, .105],
    [.123, .071, .079], [.145, .042, .047], [.153, .022, .025], [.155, .012, .014], [.156, 0, 0],
  ], 48);
  const shellMaterial = materials.steel;
  shellMaterial.side = THREE.DoubleSide;
  add(helmet, helmetGeometry, shellMaterial, [0, 1.594, -.014], 'helmet-shell');
  const star = new THREE.Shape();
  for (let point = 0; point < 10; point++) {
    const angle = Math.PI / 2 + point * Math.PI / 5, radius = point % 2 ? .0045 : .010;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (point) star.lineTo(x, y); else star.moveTo(x, y);
  }
  star.closePath();
  const badge = add(helmet, new THREE.ShapeGeometry(star), materials.buckle, [0, 1.641, .113], 'army-star');
  badge.rotation.x = -.35;
  for (const side of [-1, 1]) {
    strap(helmet, [[side * .102, 1.608, -.015], [side * .077, 1.55, .035], [side * .035, 1.51, .053], [0, 1.505, .042]],
      .010, materials.canvas, 'helmet-tie-approximation');
  }
  for (const child of helmet.children) child.position.y -= 1.594;
  helmet.position.y = 1.594; helmet.rotation.x = -.14;

  const beltGeometry = profileGeometry([
    [1.04, .160, .115], [1.09, .160, .115], [1.09, .154, .109], [1.04, .154, .109],
  ]);
  const beltPositions = beltGeometry.getAttribute('position');
  let beltFront;
  for (let column = 0; column <= 32; column++) {
    const angle = column / 32 * Math.PI * 2, direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    let radius = 0;
    for (const y of [1.04, 1.065, 1.09]) {
      tunicRay.ray.origin.set(direction.x * .4, y, -.026 + direction.z * .4);
      tunicRay.ray.direction.copy(direction).negate();
      const hit = tunicRay.intersectObject(torso, false).find(item => item.faceIndex < torso.geometry.userData.bodyTriangleCount);
      if (!hit) throw new Error('Leather belt misses the reconstructed waist');
      radius = Math.max(radius, .4 - hit.distance);
    }
    for (let row = 0; row < 4; row++) {
      const at = row * 33 + column, offset = row < 2 ? .004 : .002;
      beltPositions.setXYZ(at, direction.x * (radius + offset), beltPositions.getY(at), -.026 + direction.z * (radius + offset));
    }
    if (column === 0) beltFront = -.026 + radius + .004;
  }
  beltGeometry.computeVertexNormals(); beltGeometry.userData.fittedToWaist = true;
  add(equipment, beltGeometry, materials.leather, [0, 0, 0], 'leather-belt');
  box(equipment, [.044, .044, .008], [0, 1.065, beltFront + .005], materials.buckle, 'belt-buckle');
  box(equipment, [.029, .028, .010], [0, 1.065, beltFront + .011], materials.leather, 'buckle-opening');
  for (const side of [-1, 1]) {
    const pouch = new THREE.Group();
    const front = Math.max(...[.98, 1.018, 1.065].map(y => tunicFront(side * .112, y)));
    pouch.name = 'front-ammunition-pouch'; pouch.position.set(side * .112, 1.018, front + .036);
    pouch.rotation.y = side * .25; equipment.add(pouch);
    box(pouch, [.135, .092, .066], [0, 0, 0], materials.leather, 'pouch-body');
    add(pouch, pouchFlapGeometry(.137), materials.leather, [0, 0, 0], 'pouch-flap');
    box(pouch, [.013, .047, .005], [0, -.006, .038], materials.leather, 'pouch-fastener');
    oval(pouch, [.0035, .0035, .002], [0, -.018, .042], materials.buckle);
    for (const x of [-.062, .062]) line(pouch, [[x, -.037, .035], [x, .025, .035]], .0008, materials.edge);
    for (const x of [-.042, .042]) box(pouch, [.014, .043, .005], [x, .043, -.035], materials.leather, 'pouch-belt-loop');
    pouch.userData.referenceRounds = 30;
  }
  tunicRay.ray.origin.set(0, 1.04, -.5); tunicRay.ray.direction.set(0, 0, 1);
  const back = tunicRay.intersectObject(torso, false).find(item => item.faceIndex < torso.geometry.userData.bodyTriangleCount);
  if (!back) throw new Error('Reserve pouch misses the reconstructed back');
  box(equipment, [.213, .105, .071], [0, 1.015, back.point.z - .039], materials.leather, 'rear-reserve-pouch');
  const rearFlap = add(equipment, pouchFlapGeometry(.22, .105, .071), materials.leather,
    [0, 1.015, back.point.z - .039], 'rear-pouch-flap');
  rearFlap.rotation.y = Math.PI;
  cylinder(equipment, [.13, 1.0, -.15], [.13, 1.07, -.15], .018, .018, materials.dark, 'oil-bottle-placeholder');

  const canteen = new THREE.Group();
  canteen.name = 'type-94-canteen'; canteen.position.set(-.221, .83, -.044);
  canteen.rotation.z = -.08; equipment.add(canteen);
  const canteenBody = add(canteen, profileGeometry([
    [-.1075, 0, 0], [-.099, .055, .029], [-.075, .080, .036], [-.01, .0885, .0375],
    [.05, .079, .034], [.077, .050, .025], [.09, .021, .016], [.1075, .018, .016], [.1075, 0, 0],
  ]), materials.steel, [0, 0, 0], 'canteen-body');
  canteenBody.userData.referenceSize = [.177, .215, .075];
  cylinder(canteen, [0, .098, 0], [0, .12, 0], .02, .02, materials.dark, 'canteen-stopper');
  for (const x of [-.042, .042]) {
    line(canteen, [[x, .07, .028], [x * 1.4, -.04, .038], [0, -.108, .008], [x * 1.4, -.04, -.038], [x, .07, -.028]],
      .004, materials.canvas, 'canteen-harness');
  }
  strap(equipment, [[-.21, .92, -.04], [-.21, 1.15, -.10], [-.145, 1.39, -.105],
    [-.14, 1.425, .014], [-.18, 1.18, .095], [-.23, .92, -.015]], .018, materials.canvas, 'canteen-sling');

  const bag = new THREE.Group();
  bag.name = 'type-30-haversack'; bag.position.set(.235, .86, -.035); bag.rotation.y = -.32;
  equipment.add(bag);
  add(bag, haversackGeometry(), materials.canvas, [0, 0, 0], 'haversack-body');
  add(bag, haversackFlapGeometry(), materials.puttee, [0, .062, .044], 'haversack-flap');
  for (const x of [-.055, .055]) {
    const tab = box(bag, [.014, .065, .004], [x, .017, .047], materials.lining, 'haversack-tab');
    const positions = tab.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      positions.setZ(index, positions.getZ(index) - .006 + .010 * THREE.MathUtils.smoothstep(.017 + positions.getY(index), -.012, .045));
    }
    tab.geometry.computeVertexNormals();
    oval(bag, [.004, .004, .002], [x, -.004, .044], materials.buckle);
  }
  strap(equipment, [[.30, .94, -.035], [.215, 1.11, -.12], [-.13, 1.40, -.105],
    [-.14, 1.426, .016], [.07, 1.22, .132], [.22, .94, .03]], .025, materials.canvas, 'haversack-shoulder-strap');
  root.userData = {
    studyOnly: true, rigged: false, historicalAcceptance: false,
    adaptedGarment: true, sourceClothingTextureIncluded: false,
    balancedSilhouette: true,
    localizedClothConstruction: true,
    referenceHeightMetres: 1.75, frontAxis: '+Z', wearerRightAxis: '-X',
    references: { helmet: [.230, .156, .266], canteen: [.177, .215, .075] },
  };
  root.updateMatrixWorld(true);
  return { root, groups, materials };
}

export function disposeUniformStudy(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
