import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCivilianProtectivePose, restoreCivilianMotionPose } from './civilian-motion.js';
import { applyCivilianRestPose } from './civilian-refugees.js';
import { setFerryPassengerMaterial } from './nanjing-ferry.js';

const CLOTH = [0x797366, 0x526266, 0x89765f, 0x675957, 0x555c50, 0x8e8879];
const SKIN = [0xb49478, 0xc3a084, 0xa5846b];
const JOINTS = ['root', 'torso', 'head', 'leftArm', 'leftElbow', 'rightArm', 'rightElbow',
  'leftLeg', 'leftKnee', 'leftFoot', 'rightLeg', 'rightKnee', 'rightFoot'];
const SURFACE_DETAIL = { low: { distance: 8, limit: 8 }, medium: { distance: 11, limit: 12 },
  high: { distance: 14, limit: 16 } };

function random(index, salt) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function civilianAppearanceProfile(index, age, presentation, carrying) {
  if (!Number.isInteger(index) || index < 0 || !['adult', 'elderly', 'child'].includes(age) ||
    !['man', 'woman'].includes(presentation) || !['none', 'luggage', 'child'].includes(carrying))
    throw new RangeError('Invalid civilian appearance');
  const wardrobe = Math.floor(random(index, 2) * 3);
  return { age, presentation, carrying, wardrobe,
    key: `${age}:${presentation}:${wardrobe}:${carrying}`,
    height: (age === 'child' ? .67 : age === 'elderly' ? .94 : presentation === 'woman' ? .95 : 1) *
      (.97 + random(index, 5) * .06),
    width: .94 + random(index, 8) * .12 };
}

function surfaceAtlas() {
  const size = 256, data = new Uint8Array(size * size * 4), roughness = new Uint8Array(data.length);
  const normal = new Uint8Array(data.length);
  const height = (x, y, start, end) => {
    x = Math.max(start, Math.min(end - 1, x));
    y = (y + size) % size;
    const u = (x - start) / (end - start), v = y / size;
    if (start === 0) {
      const gathers = Math.exp(-(((v - .28) / .09) ** 2)) + .5 * Math.exp(-(((v - .72) / .1) ** 2));
      return 1.4 * gathers * Math.sin(u * Math.PI * 6 + Math.sin(v * Math.PI * 4)) +
        .012 * Math.cos(x * Math.PI) * Math.cos(y * Math.PI / 2);
    }
    if (start === 128) return .008 * Math.sin(x * 2.3) * Math.cos(y * 1.7);
    if (start === 192) return .45 * Math.sin((x - start) * 2.2 + .6 * Math.sin(v * Math.PI * 6));
    return .065 * Math.sin(x * 1.8 + y * .9) * Math.cos(y * 1.5);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cloth = x < 128, skin = x >= 128 && x < 192, hair = x >= 192 && x < 224;
    const noise = random(x + y * size, 1);
    const weave = cloth ? (x % 2 === 0 ? -5 : 0) + (y % 3 === 0 ? -4 : 0)
      : hair ? Math.sin(x * 2.8 + Math.sin(y * .08)) * 11 : 0;
    const value = Math.round((cloth ? 240 : skin ? 251 : 239) + weave - noise * (skin ? 5 : 13));
    const offset = (y * size + x) * 4;
    data.set([value, value, value, 255], offset);
    const matte = Math.round((cloth ? 246 : skin ? 199 : hair ? 225 : 219) - noise * 9);
    roughness.set([matte, matte, matte, 255], offset);
    const start = cloth ? 0 : skin ? 128 : hair ? 192 : 224;
    const end = cloth ? 128 : skin ? 192 : hair ? 224 : 256;
    const nx = height(x - 1, y, start, end) - height(x + 1, y, start, end);
    const ny = height(x, y - 1, start, end) - height(x, y + 1, start, end);
    const length = Math.hypot(nx, ny, 1);
    normal.set([Math.round((nx / length * .5 + .5) * 255),
      Math.round((ny / length * .5 + .5) * 255), Math.round((1 / length * .5 + .5) * 255), 255], offset);
  }
  const make = (pixels, colorSpace) => {
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.colorSpace = colorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  return { color: make(data, THREE.SRGBColorSpace), roughness: make(roughness, THREE.NoColorSpace),
    normal: make(normal, THREE.NoColorSpace) };
}

// Elliptical sections form shoulders, cloth folds and joints without stacked capsule seams.
function loft(rings, segments, folded = false) {
  const positions = [], uvs = [], indices = [];
  for (let row = 0; row < rings.length; row++) {
    const [y, rx, rz, cx = 0, cz = 0] = rings[row];
    for (let column = 0; column <= segments; column++) {
      const angle = column / segments * Math.PI * 2;
      const wrinkle = folded ? 1 + .035 * Math.sin(angle * 7 + row * .8) +
        .018 * Math.sin(angle * 11 - row * 1.7) : 1;
      positions.push(cx + Math.cos(angle) * rx * wrinkle, y, cz + Math.sin(angle) * rz * wrinkle);
      uvs.push(column / segments, row / (rings.length - 1));
      if (row && column) {
        const a = (row - 1) * (segments + 1) + column - 1, b = a + segments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeSkeleton() {
  const bones = JOINTS.map(name => { const bone = new THREE.Bone(); bone.name = name; return bone; });
  const byName = Object.fromEntries(bones.map(bone => [bone.name, bone]));
  const attach = (name, parent, x, y, z) => {
    byName[name].position.set(x, y, z); byName[parent].add(byName[name]);
  };
  attach('torso', 'root', 0, .87, 0);
  attach('head', 'torso', 0, .67, 0);
  for (const [prefix, sign] of [['left', -1], ['right', 1]]) {
    attach(`${prefix}Arm`, 'torso', sign * .205, .51, 0);
    attach(`${prefix}Elbow`, `${prefix}Arm`, sign * .025, -.265, 0);
    attach(`${prefix}Leg`, 'root', sign * .095, .87, 0);
    attach(`${prefix}Knee`, `${prefix}Leg`, 0, -.405, 0);
    attach(`${prefix}Foot`, `${prefix}Knee`, 0, -.395, 0);
  }
  byName.root.updateMatrixWorld(true);
  return { bones, byName, skeleton: new THREE.Skeleton(bones) };
}

function buildGeometry(profile, level) {
  const near = level === 'near', segments = near ? 16 : 8;
  const { age, presentation, wardrobe, carrying } = profile;
  const woman = presentation === 'woman', child = age === 'child', old = age === 'elderly';
  const cloth = CLOTH[(wardrobe * 2 + (woman ? 1 : 0)) % CLOTH.length];
  const pants = wardrobe === 1 ? 0x494b45 : 0x514b43;
  const skin = SKIN[(wardrobe + (old ? 1 : 0)) % SKIN.length];
  const hair = old ? 0x766f64 : 0x292823;
  const parts = [];
  let components = 0;
  function add(geometry, color, joint, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0],
    fabric = false, blend = null, surface = 'skin') {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    geometry.applyMatrix4(matrix);
    const count = geometry.attributes.position.count, colors = new Float32Array(count * 3);
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    const tint = new THREE.Color(color), uv = geometry.attributes.uv, points = geometry.attributes.position;
    const shading = geometry.attributes.color;
    const region = fabric ? [.015, .465] : surface === 'hair' ? [.765, .10]
      : surface === 'leather' ? [.89, .095] : [.51, .225];
    for (let vertex = 0; vertex < count; vertex++) {
      const variation = fabric ? (.95 + .05 * Math.sin(points.getY(vertex) * 43 + points.getX(vertex) * 11)) *
        (points.getY(vertex) < .22 ? .85 : 1) : 1;
      const dust = near && fabric ? .1 * Math.exp(-(((points.getY(vertex) - .18) / .12) ** 2)) *
        (.8 + .2 * Math.sin(points.getX(vertex) * 27 + points.getZ(vertex) * 19)) : 0;
      colors.set([tint.r * variation * (1 - dust * .6) * (shading?.getX(vertex) ?? 1),
        tint.g * variation * (1 - dust * .8) * (shading?.getY(vertex) ?? 1),
        tint.b * variation * (1 - dust) * (shading?.getZ(vertex) ?? 1)], vertex * 3);
      uv.setXY(vertex, region[0] + uv.getX(vertex) * region[1], .025 + uv.getY(vertex) * .95);
      const weight = blend ? THREE.MathUtils.smoothstep(points.getY(vertex), blend.low, blend.high) : 1;
      indices.set([JOINTS.indexOf(joint), blend ? JOINTS.indexOf(blend.other) : 0, 0, 0], vertex * 4);
      weights.set([weight, 1 - weight, 0, 0], vertex * 4);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    parts.push(geometry); components++;
  }
  function ellipsoid(position, scale, color, joint = 'head', detail = segments, surface = 'skin') {
    add(new THREE.SphereGeometry(1, detail, near && detail > 10 ? 10 : 6), color, joint,
      position, scale, undefined, false, null, surface);
  }
  function seam(points, radius, color, joint = 'torso') {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const short = points.every(point => Math.hypot(...point.map((value, axis) => value - points[0][axis])) < .09);
    add(new THREE.TubeGeometry(curve, near ? short ? 6 : 12 : 4, radius,
      near ? short ? 4 : 5 : 3, false), color, joint);
  }
  const longCoat = !child && wardrobe === 2;
  const hem = longCoat ? .55 : .86;
  const torsoRings = [[hem, .15, .108], [hem + .025, .175, .116],
    [1.01, .158, .105], [1.17, woman ? .158 : .177, .105],
    [1.32, .205, .112], [1.38, .205, .099], [1.405, .17, .086], [1.455, .068, .064],
    [1.46, 0, 0]];
  const frontCloth = (x, y) => {
    const upper = torsoRings.findIndex(ring => ring[0] >= y), top = torsoRings[Math.max(1, upper)];
    const bottom = torsoRings[Math.max(0, upper - 1)];
    const t = THREE.MathUtils.clamp((y - bottom[0]) / (top[0] - bottom[0]), 0, 1);
    const rx = THREE.MathUtils.lerp(bottom[1], top[1], t), rz = THREE.MathUtils.lerp(bottom[2], top[2], t);
    return -rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) - .006;
  };
  const clothPanel = (x, y, width, height, color) => {
    const geometry = new THREE.PlaneGeometry(width, height, 4, 4), vertices = geometry.attributes.position;
    for (let vertex = 0; vertex < vertices.count; vertex++) {
      const px = x + vertices.getX(vertex), py = y + vertices.getY(vertex);
      vertices.setXYZ(vertex, px, py, frontCloth(px, py));
    }
    const indices = geometry.index.array;
    for (let index = 0; index < indices.length; index += 3)
      [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
    geometry.computeVertexNormals();
    add(geometry, color, 'torso', undefined, undefined, undefined, true);
  };
  add(loft(torsoRings, segments, true), cloth, 'torso', undefined, undefined, undefined, true);
  add(loft([[.79, 0, 0], [.8, .15, .09], [.93, .155, .097], [.95, 0, 0]], segments, true),
    pants, 'root', undefined, undefined, undefined, true);
  add(loft([[1.41, .049, .045], [1.52, .048, .044]], segments), skin, 'head');
  add(loft([[1.424, .073, .066], [1.449, .073, .066], [1.453, .057, .05]], segments),
    cloth, 'torso', undefined, undefined, undefined, true);
  if (near) {
    const closure = woman ? .065 : .01;
    seam([[closure, hem + .03, -.12], [closure, 1.2, -.113], [closure, 1.36, -.104],
      [0, 1.435, -.068]], .004, 0x403f38);
    for (let index = 0; index < 5; index++) {
      const y = 1.06 + index * .07;
      seam([[closure - .022, y, -.12], [closure + .014, y, -.125], [closure + .026, y, -.118]],
        .004, 0xaca38c);
    }
    clothPanel(-.105, 1.015, .062, .08, 0x6a6759);
    clothPanel(.087, 1.235, .072, .085, cloth);
    for (const [x, y, width] of [[-.105, 1.015, .062], [.087, 1.235, .072]]) {
      seam([[x - width / 2, y + .04, frontCloth(x - width / 2, y + .04) - .001],
        [x, y + .037, frontCloth(x, y + .037) - .001],
        [x + width / 2, y + .04, frontCloth(x + width / 2, y + .04) - .001]], .0012, 0x9b927d);
    }
    seam([-.055, 0, .055].map(x => [x, 1.446, frontCloth(x, 1.446)]), .0015, 0x827965);
  }
  for (const [prefix, sign] of [['left', -1], ['right', 1]]) {
    const arm = `${prefix}Arm`, elbow = `${prefix}Elbow`, leg = `${prefix}Leg`, knee = `${prefix}Knee`;
    add(loft([[.88, 0, 0, sign * .232], [.9, .044, .044, sign * .232],
      [1.04, .058, .056, sign * .235], [1.12, .063, .056, sign * .23],
      [1.24, .068, .064, sign * .22], [1.36, .083, .075, sign * .20],
      ...(near ? [[1.385, .078, .07, sign * .185]] : []),
      [1.405, .07, .06, sign * .15], [1.42, 0, 0, sign * .13]], segments, true), cloth, arm,
      undefined, undefined, undefined, true, { other: elbow, low: 1.09, high: 1.16 });
    add(loft([[.865, .046, .044, sign * .232], [.9, .049, .047, sign * .232],
      [.92, .048, .046, sign * .232]], segments), cloth, elbow, undefined, undefined, undefined, true);
    ellipsoid([sign * .232, .83, -.005], [.035, .053, .024], skin, elbow);
    if (near) {
      for (let finger = 0; finger < 4; finger++) {
        const x = sign * .232 + (finger - 1.5) * .015, tip = .754 + Math.abs(finger - 1.4) * .006;
        add(loft([[tip, .003, .004, x, -.013], [tip + .007, .007, .008, x, -.013],
          [tip + .023, .009, .010, x, -.009], [.81, .009, .011, x, -.006]], 8),
        skin, elbow);
        add(new THREE.PlaneGeometry(.007, .010), 0xb89c84, elbow, [x, tip + .012, -.022],
          undefined, [0, Math.PI, 0]);
      }
      ellipsoid([sign * .269, .824, -.012], [.014, .03, .014], skin, elbow, 8);
    }
    add(loft([[.105, .055, .05, sign * .095], [.14, .061, .057, sign * .095],
      [.32, .073, .069, sign * .095], [.47, .08, .073, sign * .095],
      [.62, .087, .083, sign * .095], [.82, .095, .095, sign * .095],
      [.9, .081, .085, sign * .095]], segments, true), pants, leg,
      undefined, undefined, undefined, true, { other: knee, low: .43, high: .51 });
    if (near) {
      const shoe = new THREE.SphereGeometry(1, segments, 10), vertices = shoe.attributes.position;
      for (let vertex = 0; vertex < vertices.count; vertex++) {
        const x = vertices.getX(vertex), y = vertices.getY(vertex), z = vertices.getZ(vertex);
        const toe = (1 - z) / 2;
        vertices.setXYZ(vertex, sign * .095 + x * (.048 + .016 * toe),
          Math.max(.023, .06 - .018 * toe + y * (.043 - .015 * toe)), -.04 + z * .123);
      }
      shoe.computeVertexNormals();
      add(shoe, 0x30322d, `${prefix}Foot`, undefined, undefined, undefined, false, null, 'leather');
      add(loft([[.065, .032, .031, sign * .095, .012], [.085, .041, .039, sign * .095],
        [.125, .039, .037, sign * .095]], segments), 0x777365, `${prefix}Foot`,
      undefined, undefined, undefined, true);
    } else ellipsoid([sign * .095, .052, -.04], [.064, .052, .123], 0x30322d,
      `${prefix}Foot`, segments, 'leather');
    ellipsoid([sign * .095, .018, -.043], [.066, .017, .126], 0x5e594b, `${prefix}Foot`, segments, 'leather');
    if (near) seam([[sign * .095 - .047, .069, -.101], [sign * .095, .083, -.129],
      [sign * .095 + .047, .069, -.101]], .003, 0x8c8776, `${prefix}Foot`);
  }
  const headSize = child ? 1.17 : 1, faceY = 1.594;
  const headWidth = (woman ? .101 : .108) * (1 + (wardrobe - 1) * .035);
  const headHeight = child ? .137 : old ? .148 : .143;
  const gaussian = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
  const jawWidth = y => y < -.15 ? 1 - (woman ? .23 : .16) * (-y - .15) : 1;
  const faceSculpt = (x, y, z) => {
    const front = THREE.MathUtils.smoothstep(-z, .25, .75);
    const bump = (cx, cy, sx, sy) => gaussian(x, y, cx, cy, sx, sy);
    const nose = (child ? .007 : .010) * bump(0, .03, .15, .29) +
      (child ? .012 : .017) * bump(0, -.17, .16, .12) +
      .004 * (bump(-.13, -.2, .10, .08) + bump(.13, -.2, .10, .08));
    const cheeks = (old ? .004 : child ? .012 : .008) *
      (bump(-.5, -.17, .28, .23) + bump(.5, -.17, .28, .23));
    const sockets = .006 * (bump(-.41, .13, .23, .12) + bump(.41, .13, .23, .12));
    const brow = .003 * (bump(-.42, .28, .3, .11) + bump(.42, .28, .3, .11));
    const mouth = .004 * bump(0, -.4, .26, .1), chin = .005 * bump(0, -.68, .35, .18);
    return z * .102 * headSize - front * (nose + cheeks + brow + mouth + chin - sockets);
  };
  const faceDepth = (x, y, offset = 0) => {
    const ny = (y - faceY) / (headHeight * headSize);
    const nx = x / (headWidth * headSize * jawWidth(ny));
    return faceSculpt(nx, ny, -Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))) - offset;
  };
  const faceLine = (points, radius, color) =>
    seam(points.map(([x, y]) => [x, y, faceDepth(x, y, radius)]), radius, color, 'head');
  const head = new THREE.SphereGeometry(1, near ? 48 : 10, near ? 32 : 8);
  const points = head.attributes.position;
  const complexion = new Float32Array(points.count * 3);
  for (let vertex = 0; vertex < points.count; vertex++) {
    const y = points.getY(vertex), x = points.getX(vertex), z = points.getZ(vertex);
    points.setXYZ(vertex, x * headWidth * jawWidth(y) * headSize,
      faceY + y * headHeight * headSize, faceSculpt(x, y, z));
    const front = THREE.MathUtils.smoothstep(-z, .25, .75);
    const cheek = front * (gaussian(x, y, -.53, -.16, .3, .25) + gaussian(x, y, .53, -.16, .3, .25));
    const eye = front * (gaussian(x, y, -.4, .12, .25, .15) + gaussian(x, y, .4, .12, .25, .15));
    const weathering = old ? .055 : .025;
    complexion.set([1 - eye * .07, 1 - cheek * weathering - eye * .11,
      1 - cheek * (weathering + .02) - eye * .12], vertex * 3);
  }
  head.setAttribute('color', new THREE.Float32BufferAttribute(complexion, 3));
  head.computeVertexNormals();
  add(head, skin, 'head');
  const hairWidth = headWidth + .006;
  const scalp = new THREE.SphereGeometry(1, near ? 40 : 10, near ? 16 : 6, 0, Math.PI * 2, 0, Math.PI * .51);
  if (near) {
    const vertices = scalp.attributes.position;
    for (let vertex = 0; vertex < vertices.count; vertex++) {
      const x = vertices.getX(vertex), y = vertices.getY(vertex), z = vertices.getZ(vertex);
      const lock = 1 + .009 * Math.sin(Math.atan2(z, x) * 12 + y * 3);
      vertices.setXYZ(vertex, x * lock, y, z * lock);
    }
    scalp.computeVertexNormals();
  }
  add(scalp, hair, 'head', [0, faceY + .017, .009], [hairWidth * headSize, .14 * headSize, .105 * headSize],
    undefined, false, null, 'hair');
  ellipsoid([0, faceY + .012, .073], [.092 * headSize, .12 * headSize, .047], hair, 'head', segments, 'hair');
  if (woman) {
    ellipsoid([0, faceY - .045, .12], [.055, .049, .041], hair, 'head', segments, 'hair');
    if (child) for (const sign of [-1, 1])
      ellipsoid([sign * .097, faceY - .046, .058], [.033, .06, .033], hair, 'head', segments, 'hair');
  }
  for (const sign of [-1, 1]) {
    ellipsoid([sign * headWidth * headSize, faceY - .008, -.003], [.013, .027, .013], skin);
    if (near) {
      const eyeX = sign * .041, eyeY = faceY + .014, eyeWidth = child ? .016 : .017;
      const aperture = new THREE.CircleGeometry(1, 20), vertices = aperture.attributes.position;
      for (let vertex = 0; vertex < vertices.count; vertex++) {
        const x = vertices.getX(vertex), y = vertices.getY(vertex);
        const px = eyeX + x * eyeWidth, py = eyeY + y * (y > 0 ? .004 : .003);
        vertices.setXYZ(vertex, px, py, faceDepth(px, py, .0018));
      }
      const indices = aperture.index.array;
      for (let index = 0; index < indices.length; index += 3)
        [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
      aperture.computeVertexNormals();
      add(aperture, 0xb9afa0, 'head');
      ellipsoid([eyeX, eyeY, faceDepth(eyeX, eyeY, .0028)], [.0042, .0037, .001], 0x514333, 'head', 8);
      ellipsoid([eyeX, eyeY, faceDepth(eyeX, eyeY, .0035)], [.0021, .0028, .0007], 0x211e19, 'head', 8);
      faceLine([[eyeX - eyeWidth, eyeY], [eyeX, eyeY + .0045], [eyeX + eyeWidth, eyeY]],
        .0014, 0x9b7c63);
      faceLine([[eyeX - eyeWidth, eyeY], [eyeX, eyeY - .0032], [eyeX + eyeWidth, eyeY]],
        .0009, 0xaa8a70);
      faceLine([[sign * .023, faceY + .032], [sign * .041, faceY + .035],
        [sign * .062, faceY + .030]], .0012, hair);
      faceLine([[sign * .005, faceY - .029], [sign * .009, faceY - .031],
        [sign * .013, faceY - .029]], .0008, 0x8e6e56);
      ellipsoid([sign * (headWidth * headSize + .008), faceY - .009, -.012],
        [.004, .016, .006], 0xa5846b, 'head', 8);
      seam([[sign * (headWidth * headSize + .007), faceY + .009, -.010],
        [sign * (headWidth * headSize + .012), faceY + .012, -.012],
        [sign * (headWidth * headSize + .012), faceY - .019, -.013]], .001, skin, 'head');
      if (old) for (let crease = 0; crease < 2; crease++)
        faceLine([[sign * .067, faceY + .009 - crease * .009],
          [sign * .083, faceY + .013 - crease * .012]], .001, 0x876f59);
      if (old) faceLine([[sign * .021, faceY - .027], [sign * .029, faceY - .043],
        [sign * .028, faceY - .059]], .0008, 0x92755f);
    }
  }
  if (near) {
    faceLine([[-.021, faceY - .054], [-.008, faceY - .051], [0, faceY - .052],
      [.008, faceY - .051], [.021, faceY - .054]], .0013, 0x9b7765);
    faceLine([[-.019, faceY - .055], [0, faceY - .058], [.019, faceY - .055]], .0015, 0xaf8975);
    faceLine([[-.02, faceY - .054], [0, faceY - .0545], [.02, faceY - .054]], .0006, 0x765744);
    if (old) for (const y of [.062, .075])
      faceLine([[-.035, faceY + y], [0, faceY + y + .002], [.035, faceY + y]], .00065, 0xa0866e);
  }
  if (!woman && wardrobe === 1) {
    add(loft([[1.687, .112, .104], [1.705, .115, .107], [1.75, .08, .08],
      [1.76, 0, 0]], segments), cloth, 'head', undefined, undefined, undefined, true);
  }
  if (carrying === 'luggage') {
    add(new THREE.BoxGeometry(.21, .24, .15), 0x67503b, 'leftElbow', [-.25, .66, -.035],
      undefined, undefined, false, null, 'leather');
    if (near) {
      seam([[-.3, .78, -.035], [-.3, .815, -.035], [-.2, .815, -.035],
        [-.2, .78, -.035]], .009, 0x39362f, 'leftElbow');
      for (const x of [-.312, -.188]) {
        add(new THREE.BoxGeometry(.018, .239, .006), 0x3c372c, 'leftElbow', [x, .66, -.113]);
        add(new THREE.BoxGeometry(.023, .023, .009), 0x918269, 'leftElbow', [x, .7, -.119]);
      }
      seam([[-.35, .767, -.112], [-.25, .769, -.112], [-.15, .767, -.112]], .0015, 0xa08c6b, 'leftElbow');
    }
  } else if (carrying === 'child') {
    ellipsoid([0, 1.1, -.21], [.13, .16, .08], CLOTH[(wardrobe + 3) % CLOTH.length], 'torso');
    ellipsoid([.045, 1.27, -.2], [.068, .078, .066], SKIN[1], 'torso');
    if (near) {
      seam([[-.18, 1.38, -.08], [-.13, 1.11, -.27], [.1, 1.02, -.25],
        [.18, 1.38, -.08]], .025, 0x9c917b);
      for (const x of [.023, .067])
        seam([[x - .008, 1.28, -.264], [x, 1.278, -.267], [x + .008, 1.28, -.264]],
          .0012, 0x735d4c, 'torso');
      ellipsoid([.045, 1.263, -.266], [.008, .010, .006], SKIN[1], 'torso', 8);
      seam([[-.10, 1.15, -.257], [0, 1.1, -.291], [.10, 1.13, -.257]], .002, 0xb6aa91);
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!merged) throw new Error('Civilian skin geometry could not be merged');
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .85, 0), 1.5);
  merged.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -.4, -1), new THREE.Vector3(1, 2, 1));
  merged.userData.components = components;
  return merged;
}

export function createCivilianCharacterFactory() {
  const templates = new Map();
  const atlas = surfaceAtlas();
  const simpleMaterial = new THREE.MeshStandardMaterial({ map: atlas.color, roughnessMap: atlas.roughness,
    vertexColors: true, roughness: 1 });
  const material = simpleMaterial.clone();
  material.normalMap = atlas.normal;
  material.normalScale.set(.5, .5);
  const materials = { detailed: material, simple: simpleMaterial };
  return {
    templates, material, simpleMaterial,
    create(index, age, presentation, carrying) {
      const profile = civilianAppearanceProfile(index, age, presentation, carrying);
      if (!templates.has(profile.key)) templates.set(profile.key, {
        near: buildGeometry(profile, 'near'), far: buildGeometry(profile, 'far'),
      });
      const geometry = templates.get(profile.key);
      const group = new THREE.Group(), visual = new THREE.Group();
      group.add(visual);
      const { byName, skeleton } = makeSkeleton();
      visual.add(byName.root);
      const mesh = new THREE.SkinnedMesh(geometry.near, material);
      mesh.boundingSphere = geometry.near.boundingSphere.clone();
      mesh.boundingBox = geometry.near.boundingBox.clone();
      visual.add(mesh);
      visual.updateMatrixWorld(true);
      mesh.bind(skeleton, new THREE.Matrix4());
      visual.scale.set(profile.width * profile.height, profile.height, profile.height);
      mesh.castShadow = mesh.receiveShadow = true;
      group.civilianArms = [byName.leftArm, byName.rightArm];
      group.civilianLegs = [byName.leftLeg, byName.rightLeg];
      group.civilianTorso = byName.torso;
      group.civilianHead = byName.head;
      group.civilianSkin = { mesh, geometry, skeleton, joints: byName, level: 'near', profile,
        materials, surfaceLevel: 'detailed' };
      group.userData.civilianDetail = { clothTexture: 'shared-cloth-skin-atlas', face: true, layeredClothing: true,
        articulatedHands: true, hands: 'palm-four-fingers-thumb', feet: 'shoe-sole-toe',
        componentCount: geometry.near.userData.components, renderParts: 1,
        nearTriangles: geometry.near.index.count / 3, farTriangles: geometry.far.index.count / 3,
        template: profile.key, wardrobe: profile.wardrobe, skinned: true,
        faceDetails: 'sculpted-cheeks-nose-eyelids-iris-lips-ears', fabricDetails: 'curved-pockets-patches-stitching',
        materialRegions: ['cloth', 'skin', 'hair', 'leather'] };
      return group;
    },
  };
}

export function updateCivilianAppearance(civilians, camera, preset = 'high') {
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const position = new THREE.Vector3();
  const nearDistance = preset === 'low' ? 16 : preset === 'medium' ? 23 : 30;
  const surface = SURFACE_DETAIL[preset] ?? SURFACE_DETAIL.high, detailed = [];
  for (const civilian of civilians) {
    if (!civilian.visible || !civilian.parent) continue;
    const skin = civilian.civilianSkin;
    civilian.getWorldPosition(position);
    const distance = position.distanceTo(cameraPosition);
    const near = distance < nearDistance + (skin.level === 'near' ? 2 : -2);
    skin.level = near ? 'near' : 'far';
    skin.mesh.geometry = skin.geometry[skin.level];
    if (near && distance < surface.distance + (skin.surfaceLevel === 'detailed' ? 1 : -1)) {
      skin.surfacePriority = distance - (skin.surfaceLevel === 'detailed' ? .35 : 0);
      const index = detailed.findIndex(other => other.civilianSkin.surfacePriority > skin.surfacePriority);
      if (index >= 0) detailed.splice(index, 0, civilian);
      else if (detailed.length < surface.limit) detailed.push(civilian);
      if (detailed.length > surface.limit) detailed.pop();
    }
    skin.mesh.castShadow = distance < (preset === 'low' ? 12 : 26);
    restoreCivilianMotionPose(civilian);
    // Existing gameplay drives the upper joints; secondary joints preserve the same pose across LODs.
    for (const [side, index] of [['left', 0], ['right', 1]]) {
      skin.joints[`${side}Knee`].rotation.x = -Math.max(0, civilian.civilianLegs[index].rotation.x) * .85;
      skin.joints[`${side}Foot`].rotation.x = -skin.joints[`${side}Knee`].rotation.x * .45;
      if (civilian.userData.carrying === 'child') skin.joints[`${side}Elbow`].rotation.x = 1.05;
      else if (!civilian.userData.escapeMotion && !civilian.userData.boatman) skin.joints[`${side}Elbow`].rotation.x = .18;
    }
    if (civilian.userData.carrying === 'child')
      for (const [index, arm] of civilian.civilianArms.entries()) {
        arm.rotation.x = .25;
        arm.rotation.z = index ? -.18 : .18;
      }
    else if (civilian.userData.carrying === 'luggage') {
      civilian.civilianArms[0].rotation.x = -.04;
      skin.joints.leftElbow.rotation.x = .12;
    }
    applyCivilianProtectivePose(civilian);
    applyCivilianRestPose(civilian);
  }
  for (const civilian of civilians) {
    if (!civilian.visible || !civilian.parent) continue;
    const skin = civilian.civilianSkin;
    skin.surfaceLevel = detailed.includes(civilian) ? 'detailed' : 'simple';
    setFerryPassengerMaterial(skin.mesh, skin.materials[skin.surfaceLevel]);
  }
}
