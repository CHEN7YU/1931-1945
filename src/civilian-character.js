import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCivilianProtectivePose, restoreCivilianMotionPose } from './civilian-motion.js';

const CLOTH = [0x797366, 0x526266, 0x89765f, 0x675957, 0x555c50, 0x8e8879];
const SKIN = [0xb49478, 0xc3a084, 0xa5846b];
const JOINTS = ['root', 'torso', 'head', 'leftArm', 'leftElbow', 'rightArm', 'rightElbow',
  'leftLeg', 'leftKnee', 'leftFoot', 'rightLeg', 'rightKnee', 'rightFoot'];

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
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cloth = x < size / 2;
    const noise = random(x + y * size, 1);
    const weave = cloth ? ((x % 3 === 0 ? -9 : 0) + (y % 4 === 0 ? -7 : 0)) : 0;
    const value = Math.round((cloth ? 235 : 249) + weave - noise * (cloth ? 16 : 5));
    const offset = (y * size + x) * 4;
    data.set([value, value, value, 255], offset);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
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
    fabric = false, blend = null) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    geometry.applyMatrix4(matrix);
    const count = geometry.attributes.position.count, colors = new Float32Array(count * 3);
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    const tint = new THREE.Color(color), uv = geometry.attributes.uv, points = geometry.attributes.position;
    for (let vertex = 0; vertex < count; vertex++) {
      const variation = fabric ? .93 + .07 * Math.sin(points.getY(vertex) * 43 + points.getX(vertex) * 11) : 1;
      colors.set([tint.r * variation, tint.g * variation, tint.b * variation], vertex * 3);
      uv.setXY(vertex, (fabric ? .025 : .55) + uv.getX(vertex) * .4, .025 + uv.getY(vertex) * .95);
      const weight = blend ? THREE.MathUtils.smoothstep(points.getY(vertex), blend.low, blend.high) : 1;
      indices.set([JOINTS.indexOf(joint), blend ? JOINTS.indexOf(blend.other) : 0, 0, 0], vertex * 4);
      weights.set([weight, 1 - weight, 0, 0], vertex * 4);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    parts.push(geometry); components++;
  }
  function ellipsoid(position, scale, color, joint = 'head', detail = segments) {
    add(new THREE.SphereGeometry(1, detail, near ? 10 : 6), color, joint, position, scale);
  }
  function seam(points, radius, color, joint = 'torso') {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    add(new THREE.TubeGeometry(curve, near ? 12 : 4, radius, near ? 5 : 3, false), color, joint);
  }
  const longCoat = !child && wardrobe === 2;
  const hem = longCoat ? .55 : .86;
  add(loft([[hem, .15, .108], [hem + .025, .175, .116],
    [1.01, .158, .105], [1.17, woman ? .158 : .177, .105],
    [1.32, .205, .112], [1.38, .205, .099], [1.405, .17, .086], [1.455, .068, .064],
    [1.46, 0, 0]], segments, true), cloth, 'torso', undefined, undefined, undefined, true);
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
    // Flat patch with a stitched edge, rather than extra floating cloth layers.
    add(new THREE.PlaneGeometry(.062, .08), 0x6a6759, 'torso', [-.115, 1.02, -.109],
      undefined, [0, Math.PI, 0], true);
  }
  for (const [prefix, sign] of [['left', -1], ['right', 1]]) {
    const arm = `${prefix}Arm`, elbow = `${prefix}Elbow`, leg = `${prefix}Leg`, knee = `${prefix}Knee`;
    add(loft([[.88, 0, 0, sign * .232], [.9, .044, .044, sign * .232],
      [1.04, .058, .056, sign * .235], [1.12, .063, .056, sign * .23],
      [1.24, .068, .064, sign * .22], [1.36, .083, .075, sign * .20],
      [1.405, .07, .06, sign * .15], [1.42, 0, 0, sign * .13]], segments, true), cloth, arm,
      undefined, undefined, undefined, true, { other: elbow, low: 1.09, high: 1.16 });
    add(loft([[.865, .046, .044, sign * .232], [.9, .049, .047, sign * .232],
      [.92, .048, .046, sign * .232]], segments), cloth, elbow, undefined, undefined, undefined, true);
    ellipsoid([sign * .232, .83, -.005], [.035, .053, .024], skin, elbow);
    if (near) {
      for (let finger = 0; finger < 4; finger++)
        ellipsoid([sign * .232 + (finger - 1.5) * .015, .781 + Math.abs(finger - 1.4) * .006, -.008],
          [.009, .029, .011], skin, elbow, 8);
      ellipsoid([sign * .269, .824, -.012], [.014, .03, .014], skin, elbow, 8);
    }
    add(loft([[.105, .055, .05, sign * .095], [.14, .061, .057, sign * .095],
      [.32, .073, .069, sign * .095], [.47, .08, .073, sign * .095],
      [.62, .087, .083, sign * .095], [.82, .095, .095, sign * .095],
      [.9, .081, .085, sign * .095]], segments, true), pants, leg,
      undefined, undefined, undefined, true, { other: knee, low: .43, high: .51 });
    ellipsoid([sign * .095, .052, -.04], [.064, .052, .123], 0x30322d, `${prefix}Foot`);
    ellipsoid([sign * .095, .018, -.043], [.066, .017, .126], 0x5e594b, `${prefix}Foot`);
    if (near) seam([[sign * .095 - .047, .069, -.101], [sign * .095, .083, -.129],
      [sign * .095 + .047, .069, -.101]], .003, 0x8c8776, `${prefix}Foot`);
  }
  const headSize = child ? 1.17 : 1, faceY = 1.594;
  const faceSculpt = (x, y, z) => {
    const front = THREE.MathUtils.smoothstep(-z, .25, .75);
    const gaussian = (cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
    const nose = .012 * gaussian(0, .04, .14, .3) + .022 * gaussian(0, -.12, .17, .14);
    const cheeks = .008 * (gaussian(-.5, -.11, .26, .24) + gaussian(.5, -.11, .26, .24));
    const sockets = .008 * (gaussian(-.41, .13, .22, .12) + gaussian(.41, .13, .22, .12));
    return z * .102 * headSize - front * (nose + cheeks - sockets);
  };
  const faceDepth = (x, y, offset = 0) => {
    const ny = (y - faceY) / (.143 * headSize);
    const jaw = ny < -.15 ? 1 - .25 * (-ny - .15) : 1;
    const nx = x / (.105 * headSize * jaw);
    return faceSculpt(nx, ny, -Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))) - offset;
  };
  const faceLine = (points, radius, color) =>
    seam(points.map(([x, y]) => [x, y, faceDepth(x, y, radius)]), radius, color, 'head');
  const head = new THREE.SphereGeometry(1, near ? 48 : 10, near ? 32 : 8);
  const points = head.attributes.position;
  for (let vertex = 0; vertex < points.count; vertex++) {
    const y = points.getY(vertex), x = points.getX(vertex), z = points.getZ(vertex);
    const jaw = y < -.15 ? 1 - .25 * (-y - .15) : 1;
    points.setXYZ(vertex, x * .105 * jaw * headSize,
      faceY + y * .143 * headSize, faceSculpt(x, y, z));
  }
  head.computeVertexNormals();
  add(head, skin, 'head');
  add(new THREE.SphereGeometry(1, near ? 24 : 10, near ? 12 : 6, 0, Math.PI * 2, 0, Math.PI * .51),
    hair, 'head', [0, faceY + .017, .009], [.11 * headSize, .14 * headSize, .105 * headSize]);
  ellipsoid([0, faceY + .012, .073], [.092 * headSize, .12 * headSize, .047], hair);
  if (woman) {
    ellipsoid([0, faceY - .045, .12], [.055, .049, .041], hair);
    if (child) for (const sign of [-1, 1])
      ellipsoid([sign * .097, faceY - .046, .058], [.033, .06, .033], hair);
  }
  for (const sign of [-1, 1]) {
    ellipsoid([sign * .105 * headSize, faceY - .008, -.003], [.013, .027, .013], skin);
    if (near) {
      const eyeZ = faceDepth(sign * .042, faceY + .015, .001);
      ellipsoid([sign * .042, faceY + .013, eyeZ], [.020, .005, .003], 0x75604d);
      ellipsoid([sign * .042, faceY + .015, eyeZ - .002], [.015, .0035, .002], 0xafa38c);
      ellipsoid([sign * .042, faceY + .015, eyeZ - .004], [.0045, .0035, .0015], 0x2d2925, 'head', 8);
      faceLine([[sign * .022, faceY + .036], [sign * .041, faceY + .04],
        [sign * .065, faceY + .034]], .002, hair);
      if (old) for (let crease = 0; crease < 2; crease++)
        faceLine([[sign * .067, faceY + .009 - crease * .009],
          [sign * .083, faceY + .013 - crease * .012]], .001, 0x876f59);
    }
  }
  if (near) {
    faceLine([[-.022, faceY - .052], [0, faceY - .05], [.022, faceY - .052]], .002, 0x926f5c);
    faceLine([[-.022, faceY - .054], [0, faceY - .052], [.022, faceY - .054]], .0008, 0x584239);
  }
  if (!woman && wardrobe === 1) {
    add(loft([[1.687, .112, .104], [1.705, .115, .107], [1.75, .08, .08],
      [1.76, 0, 0]], segments), cloth, 'head', undefined, undefined, undefined, true);
  }
  if (carrying === 'luggage') {
    add(new THREE.BoxGeometry(.21, .24, .15), 0x67503b, 'leftElbow', [-.25, .66, -.035]);
    if (near) seam([[-.3, .78, -.035], [-.3, .815, -.035], [-.2, .815, -.035],
      [-.2, .78, -.035]], .009, 0x39362f, 'leftElbow');
  } else if (carrying === 'child') {
    ellipsoid([0, 1.1, -.21], [.13, .16, .08], CLOTH[(wardrobe + 3) % CLOTH.length], 'torso');
    ellipsoid([.045, 1.27, -.2], [.068, .078, .066], SKIN[1], 'torso');
    if (near) seam([[-.18, 1.38, -.08], [-.13, 1.11, -.27], [.1, 1.02, -.25],
      [.18, 1.38, -.08]], .025, 0x9c917b);
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
  const material = new THREE.MeshStandardMaterial({ map: surfaceAtlas(), vertexColors: true, roughness: .91 });
  return {
    templates, material,
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
      group.civilianSkin = { mesh, geometry, skeleton, joints: byName, level: 'near', profile };
      group.userData.civilianDetail = { clothTexture: 'shared-cloth-skin-atlas', face: true, layeredClothing: true,
        articulatedHands: true, hands: 'palm-four-fingers-thumb', feet: 'shoe-sole-toe',
        componentCount: geometry.near.userData.components, renderParts: 1,
        nearTriangles: geometry.near.index.count / 3, farTriangles: geometry.far.index.count / 3,
        template: profile.key, wardrobe: profile.wardrobe, skinned: true };
      return group;
    },
  };
}

export function updateCivilianAppearance(civilians, camera, preset = 'high') {
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const position = new THREE.Vector3();
  const nearDistance = preset === 'low' ? 16 : preset === 'medium' ? 23 : 30;
  for (const civilian of civilians) {
    if (!civilian.visible || !civilian.parent) continue;
    const skin = civilian.civilianSkin;
    civilian.getWorldPosition(position);
    const distance = position.distanceTo(cameraPosition);
    const near = distance < nearDistance + (skin.level === 'near' ? 2 : -2);
    skin.level = near ? 'near' : 'far';
    skin.mesh.geometry = skin.geometry[skin.level];
    skin.mesh.castShadow = distance < (preset === 'low' ? 12 : 26);
    restoreCivilianMotionPose(civilian);
    // Existing gameplay drives the upper joints; secondary joints preserve the same pose across LODs.
    for (const [side, index] of [['left', 0], ['right', 1]]) {
      skin.joints[`${side}Knee`].rotation.x = -Math.max(0, civilian.civilianLegs[index].rotation.x) * .85;
      skin.joints[`${side}Foot`].rotation.x = -skin.joints[`${side}Knee`].rotation.x * .45;
      skin.joints[`${side}Elbow`].rotation.x = civilian.userData.carrying === 'child' ? 1.05 : -.18;
    }
    if (civilian.userData.carrying === 'child')
      for (const [index, arm] of civilian.civilianArms.entries()) {
        arm.rotation.x = .25;
        arm.rotation.z = index ? -.18 : .18;
      }
    else if (civilian.userData.carrying === 'luggage') civilian.civilianArms[0].rotation.x = -.04;
    applyCivilianProtectivePose(civilian);
  }
}
