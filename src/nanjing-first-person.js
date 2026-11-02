import * as THREE from 'three';

const $ = id => document.getElementById(id);
const sceneRoot = $('first-person');
const view = $('battle-canvas');
const camera = new THREE.PerspectiveCamera(72, 1, .08, 420);
camera.rotation.order = 'YXZ';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x89918a);
scene.fog = new THREE.FogExp2(0x89918a, .008);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
view.append(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xc8d4d7, 0x51483b, 1.3));
const sun = new THREE.DirectionalLight(0xffd9ad, 2.4);
sun.position.set(-38, 70, 28);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -72;
sun.shadow.camera.right = 72;
sun.shadow.camera.top = 82;
sun.shadow.camera.bottom = -82;
scene.add(sun);

const materials = {
  earth: new THREE.MeshStandardMaterial({ color: 0x777361, roughness: 1 }),
  road: new THREE.MeshStandardMaterial({ color: 0x77766a, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x777362, roughness: .95 }),
  stoneLight: new THREE.MeshStandardMaterial({ color: 0x96896f, roughness: .93 }),
  brick: new THREE.MeshStandardMaterial({ color: 0x765d4b, roughness: 1 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x514b40, roughness: .95 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x594a35, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ color: 0x375d68, roughness: .28, metalness: .12 }),
  sack: new THREE.MeshStandardMaterial({ color: 0x9a8b67, roughness: 1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x242a28, roughness: .9 }),
  friendly: [0x526554, 0x5e6753, 0x485d58].map(color => new THREE.MeshStandardMaterial({ color, roughness: .95 })),
  enemy: [0x665b4e, 0x6a5548, 0x57534a].map(color => new THREE.MeshStandardMaterial({ color, roughness: .95 })),
  civilian: [0x847564, 0x8c806a, 0x6e7062, 0x95836b, 0x727468].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: .95 })),
  skin: new THREE.MeshStandardMaterial({ color: 0xb69a7c, roughness: 1 }),
};

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const player = { x: 0, z: -7, yaw: 0, pitch: -.02 };
const heldKeys = new Set();
const enemies = [], civilians = [], boats = [], colliders = [];
const clock = new THREE.Clock();
let active = false;
let dragging = false;
let initialized = false;
let ferryMode = false;
const referenceLayout = { innerBarbicans: 3, alignedGateways: 4, rivers: 3, bridgeCrossings: 2 };

function box(parent, material, x, y, z, width, height, depth, options = {}) {
  const mesh = new THREE.Mesh(boxGeometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  if (options.collision) colliders.push({ x, z, halfX: width / 2, halfZ: depth / 2 });
  return mesh;
}

function makePerson({ x, z, team, child = false, bag = false, move = 0 }) {
  const group = new THREE.Group();
  const scale = child ? .76 : 1;
  const palette = team === 'friendly' ? materials.friendly : team === 'enemy' ? materials.enemy : materials.civilian;
  const uniform = palette[(Math.floor((x * 19 + z * 31 + 500) * 13) >>> 0) % palette.length];
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.19 * scale, .26 * scale, .7 * scale, 7), uniform);
  body.position.y = .92 * scale;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.14 * scale, 9, 7), materials.skin);
  head.position.y = 1.38 * scale;
  head.castShadow = true;
  group.add(head);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(.36 * scale, .46 * scale, .2 * scale), materials.dark);
  legs.position.set(0, .34 * scale, 0);
  legs.castShadow = true;
  group.add(legs);
  if (team !== 'civilian') {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(.17 * scale, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), uniform);
    helmet.position.y = 1.49 * scale;
    group.add(helmet);
  }
  if (bag) {
    const parcel = new THREE.Mesh(new THREE.BoxGeometry(.28, .34, .2), materials.wood);
    parcel.position.set(.28, .93 * scale, .08);
    parcel.castShadow = true;
    group.add(parcel);
  }
  group.position.set(x, 0, z);
  group.userData = { originX: x, originZ: z, move, phase: x * .7 + z };
  scene.add(group);
  if (team === 'enemy') enemies.push(group);
  else if (team === 'civilian') civilians.push(group);
  return group;
}

function makeBuilding(x, z, width, depth, height, color) {
  const masonry = new THREE.MeshStandardMaterial({ color, roughness: .98 });
  box(scene, masonry, x, height / 2, z, width, height, depth, { collision: true });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * .78, 2.7, 4), materials.roof);
  roof.position.set(x, height + 1.1, z);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(width / Math.max(width, depth), 1, depth / Math.max(width, depth));
  roof.castShadow = true;
  scene.add(roof);
  for (const windowX of [-.25, .25]) {
    const wx = x + width * windowX;
    const window = box(scene, materials.dark, wx, Math.min(height - 1, 2.05), z - depth / 2 - .025,
      Math.min(1, width * .14), .72, .045, { castShadow: false });
    window.material = materials.dark;
  }
}

function makePortal(z, mainGate = false) {
  const width = 48;
  const height = mainGate ? 9.4 : 6.5;
  const radius = mainGate ? 4.2 : 3.15;
  const spring = mainGate ? 4.15 : 3.35;
  const depth = mainGate ? 3.8 : 2.6;
  const wallMaterial = mainGate ? materials.brick : materials.stone;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-radius, 0);
  opening.lineTo(-radius, spring);
  opening.absarc(0, spring, radius, Math.PI, 0, true);
  opening.lineTo(radius, 0);
  opening.closePath();
  shape.holes.push(opening);
  const wallGeometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  wall.position.set(0, 0, z - depth / 2);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  const jambMaterial = mainGate ? materials.stoneLight : materials.stoneLight;
  for (const side of [-1, 1]) {
    box(scene, jambMaterial, side * (radius + .38), spring * .55, z,
      .72, spring * 1.1, depth + .2, { collision: true });
    for (let course = 0; course < Math.floor(height / .72); course++) {
      box(scene, course % 3 === 0 ? materials.stoneLight : wallMaterial,
        side * (radius + .38), course * .72 + .34, z - depth / 2 - .02,
        .76, .12, .08, { castShadow: false });
    }
  }
  box(scene, materials.road, 0, .11, z, radius * 2 - .7, .22, depth + 1.3, { castShadow: false });
  if (!mainGate) return;

  for (const side of [-1, 1]) {
    const towerX = side * 17;
    box(scene, materials.stoneLight, towerX, 9.8, z, 10, .8, 5.2);
    for (let offset = -4; offset <= 4; offset += 2) {
      box(scene, materials.stoneLight, towerX + offset, 10.5, z, .9, .65, 4.8);
    }
  }
  for (let index = 0; index < 17; index++) {
    const x = -7.5 + index * .92;
    if (index % 4 === 1) continue;
    const y = 9.45 - (index % 3) * .52 - (index === 8 ? 1.3 : 0);
    box(scene, materials.brick, x, y, z, .85, .55, 4.8);
  }
  for (let index = 0; index < 30; index++) {
    const x = -8 + (index * 17 % 17);
    const rubble = box(scene, index % 4 === 0 ? materials.stoneLight : materials.brick,
      x, .28 + (index % 3) * .14, z + 4 + (index % 6) * .75,
      .35 + (index % 4) * .16, .34 + (index % 3) * .2, .4 + (index % 5) * .12);
    rubble.rotation.y = index * .73;
  }
  for (const side of [-1, 1]) {
    for (let zOffset = -16; zOffset <= 10; zOffset += 5) {
      const niche = box(scene, materials.dark, side * 23.88, 2.05, z + zOffset, .08, 1.35, 1.55,
        { castShadow: false });
      niche.material = materials.dark;
    }
  }
}

function makeGateComplex() {
  const courts = [-24, -8, 8, 24];
  for (let index = 0; index < courts.length; index++) {
    makePortal(courts[index], index === courts.length - 1);
  }
  for (const x of [-23.5, 23.5]) {
    box(scene, materials.stone, x, 3.35, 0, 1.5, 6.7, 51, { collision: true });
    for (let z = -23; z <= 22; z += 5.5) {
      box(scene, materials.dark, x - Math.sign(x) * .78, 2, z, .08, 1.3, 1.45, { castShadow: false });
    }
    for (const z of [-17, 0, 17]) {
      box(scene, materials.stoneLight, x, 6.95, z, 2.3, .65, 2.2);
    }
  }
  for (const z of [-24, -8, 8, 24]) {
    box(scene, materials.road, 0, .08, z, 7.5, .16, 7.5, { castShadow: false });
  }
  for (const z of [-17, 0, 17]) {
    for (const side of [-1, 1]) {
      for (let niche = 0; niche < 3; niche++) {
        box(scene, materials.dark, side * 22.65, 2.1, z - 4.2 + niche * 4.2, .12, 1.5, 2.05,
          { castShadow: false });
      }
    }
  }
  makeSandbags(-8, 13.5, 15, Math.PI / 2);
  makeSandbags(10, 4, 10, Math.PI / 2);
  makeSandbags(-8, -4, 10, Math.PI / 2);
  for (const [x, z] of [[5, 12], [15, 2], [6, -7], [-14, 14]]) {
    const ally = makePerson({ x, z, team: 'friendly' });
    ally.rotation.y = Math.PI;
  }
}

function makeBridge(z) {
  box(scene, materials.stoneLight, 0, .56, z, 10.5, .8, 32, { collision: false });
  box(scene, materials.road, 0, 1.02, z, 8.8, .16, 32, { collision: false });
  for (const x of [-5.15, 5.15]) {
    box(scene, materials.stone, x, 1.15, z, .55, 1.3, 32);
    for (let offset = -14; offset <= 14; offset += 4) {
      box(scene, materials.stoneLight, x, 1.95, z + offset, .8, .42, .95);
    }
  }
  for (const offset of [-5, 5]) {
    for (const x of [-3.6, 0, 3.6]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(.72, 1, 2.4, 8), materials.stone);
      pier.position.set(x, -.75, z + offset);
      pier.castShadow = true;
      scene.add(pier);
    }
  }
  for (const x of [-6.4, 6.4]) {
    box(scene, materials.stoneLight, x, .42, z - 17, 1.7, .7, 3.6);
    box(scene, materials.stoneLight, x, .42, z + 17, 1.7, .7, 3.6);
  }
}

function makeSandbags(x, z, count, direction = 0) {
  const group = new THREE.Group();
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / 5), column = index % 5;
    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .58, 3, 7), materials.sack);
    bag.position.set((column - 2) * .45, .34 + row * .35, 0);
    bag.rotation.z = Math.PI / 2;
    bag.castShadow = true;
    bag.receiveShadow = true;
    group.add(bag);
  }
  group.position.set(x, 0, z);
  group.rotation.y = direction;
  scene.add(group);
}

function makeFerryDock() {
  const river = new THREE.Mesh(new THREE.PlaneGeometry(24, 190), materials.water);
  river.rotation.x = -Math.PI / 2;
  river.position.set(-72, -.2, 8);
  river.receiveShadow = true;
  scene.add(river);
  box(scene, materials.earth, -59, .02, 8, 2, .2, 190, { castShadow: false });
  box(scene, materials.wood, -56, .18, 8, 12, .36, 18);
  for (let z = 0; z <= 16; z += 2) box(scene, materials.stoneLight, -56, .39, z, 12, .08, .12);
  for (const x of [-61, -51]) {
    for (const z of [0, 16]) box(scene, materials.wood, x, -.5, z, .45, 1.8, .45);
  }
  for (let index = 0; index < 5; index++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.65, 4.4, 4, 8), materials.wood);
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(.5, 1, .55);
    hull.position.y = .42;
    hull.castShadow = true;
    boat.add(hull);
    const rower = new THREE.Mesh(new THREE.SphereGeometry(.19, 8, 6), materials.skin);
    rower.position.set(0, .92, 0);
    boat.add(rower);
    const oar = new THREE.Mesh(new THREE.BoxGeometry(4.1, .07, .08), materials.stoneLight);
    oar.position.set(.2, .55, .55);
    oar.rotation.y = .18;
    boat.add(oar);
    boat.position.set(-69 - (index % 2) * 2, .05, 2 + index * 3);
    boat.userData = { phase: index * 1.7, originZ: boat.position.z };
    boats.push(boat);
    scene.add(boat);
  }
  for (let index = 0; index < 16; index++) {
    makePerson({
      x: -49 - (index % 3) * 1.1,
      z: 1 + Math.floor(index / 3) * 2.8,
      team: 'civilian',
      child: index % 5 === 0,
      bag: index % 6 === 2,
      move: .3,
    });
  }
  for (const z of [2, 8, 14]) {
    const attacker = makePerson({ x: -41, z, team: 'enemy' });
    attacker.rotation.y = -Math.PI / 2;
  }
  for (const z of [5, 11]) {
    const defender = makePerson({ x: -45, z, team: 'friendly' });
    defender.rotation.y = Math.PI / 2;
  }
}

function makeDockAndWater() {
  const water = new THREE.Mesh(new THREE.PlaneGeometry(210, 24), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -.18, 51);
  water.receiveShadow = true;
  scene.add(water);
  const innerWater = water.clone();
  innerWater.position.set(0, -.18, -52);
  scene.add(innerWater);
  makeBridge(51);
  makeBridge(-52);
}

function makeEnvironment() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(210, 230), materials.earth);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -.2, -4);
  ground.receiveShadow = true;
  scene.add(ground);
  box(scene, materials.road, 0, -.04, 0, 11, .18, 130, { castShadow: false });
  box(scene, materials.road, 0, -.03, -71, 16, .2, 37, { castShadow: false });
  box(scene, materials.road, 0, -.03, 77, 14, .2, 37, { castShadow: false });
  makeDockAndWater();
  makeGateComplex();
  makeFerryDock();

  const blocks = [
    [-41, -77, 20, 19, 8, 0x867b65], [-16, -82, 16, 17, 7, 0x796f5b],
    [16, -81, 19, 18, 9, 0x8a7f68], [42, -73, 18, 21, 8, 0x756e5e],
    [-44, -58, 18, 12, 6, 0x857a63], [43, -56, 20, 14, 7, 0x897d68],
    [-44, 69, 19, 19, 9, 0x756c5b], [-16, 76, 17, 18, 7, 0x8b8068],
    [17, 77, 20, 18, 8, 0x7d725f], [44, 69, 17, 19, 7, 0x817865],
  ];
  for (const block of blocks) makeBuilding(...block);

  for (const x of [-17, -10, -3, 4, 11, 18]) {
    const enemy = makePerson({ x, z: 83 + (Math.abs(x) % 3) * 2, team: 'enemy' });
    enemy.rotation.y = Math.PI;
  }
  for (let i = 0; i < 8; i++) {
    const plume = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({
      color: 0x514e45, transparent: true, opacity: .14,
    }));
    plume.scale.set(2.2 + i % 3, 4 + i % 4, 2.3 + i % 2);
    plume.position.set(-25 + i * 7.2, 11 + i % 4 * 3, 39 + i % 3 * 4);
    scene.add(plume);
  }
  for (const x of [-57, -52, -47, 47, 52, 57]) {
    colliders.push({ x, z: 0, halfX: 1.4, halfZ: 91 });
  }
}

function setLocation(ferry) {
  ferryMode = ferry;
  if (ferry) {
    player.x = -42;
    player.z = 8;
    player.yaw = Math.PI / 2;
    player.pitch = -.01;
    $('scene-title').textContent = '上新河渡口 · 百姓撤离线';
    $('scene-objective-text').textContent = '守住渡口 · 掩护百姓登船';
    $('scene-civilian-message').hidden = false;
    $('scene-civilian-message').textContent =
      '你已经成功掩护 136 名百姓到达上新河渡口，其中 86 名已撤离南京，免于日军屠刀。';
    $('scene-gate').classList.remove('selected');
    $('scene-ferry').classList.add('selected');
    $('scene-status').textContent = '渡口样景 · 5艘木船往返接驳；百姓与战斗均为视觉示意。';
  } else {
    player.x = 0;
    player.z = -15;
    player.yaw = Math.PI;
    player.pitch = -.02;
    $('scene-title').textContent = '中华门 · 瓮城防线';
    $('scene-objective-text').textContent = '坚守中华门 · 阶段目标 07:00';
    $('scene-civilian-message').hidden = true;
    $('scene-gate').classList.add('selected');
    $('scene-ferry').classList.remove('selected');
    $('scene-status').textContent = '参照三道内瓮城、四道券门与双河桥位；城楼炮毁状态为概念表达。';
  }
  camera.position.set(player.x, 1.68, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

function resize() {
  if (!active) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function enter() {
  if (!initialized) {
    makeEnvironment();
    initialized = true;
  }
  sceneRoot.hidden = false;
  active = true;
  resize();
  setLocation(false);
  renderer.setAnimationLoop(animate);
  $('scene-status').textContent = '三道内瓮城、四道券门为结构概念；点击画面锁定鼠标，或按住右键拖动环顾。';
}

function exit() {
  active = false;
  heldKeys.clear();
  dragging = false;
  renderer.setAnimationLoop(null);
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  sceneRoot.hidden = true;
}

function updateLook(dx, dy) {
  player.yaw -= dx * .002;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * .002, -1.25, 1.25);
}

function overlaps(x, z) {
  return colliders.some(box => Math.abs(x - box.x) < box.halfX + .36 &&
    Math.abs(z - box.z) < box.halfZ + .36);
}

function animate() {
  const dt = Math.min(clock.getDelta(), .05);
  if (!active) return;
  const forward = Number(heldKeys.has('KeyW')) - Number(heldKeys.has('KeyS'));
  const side = Number(heldKeys.has('KeyD')) - Number(heldKeys.has('KeyA'));
  const length = Math.hypot(forward, side) || 1;
  const speed = heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight') ? 5.2 : 3.2;
  const dx = (-Math.sin(player.yaw) * forward + Math.cos(player.yaw) * side) / length * speed * dt;
  const dz = (-Math.cos(player.yaw) * forward - Math.sin(player.yaw) * side) / length * speed * dt;
  if (!overlaps(player.x + dx, player.z)) player.x += dx;
  if (!overlaps(player.x, player.z + dz)) player.z += dz;
  player.x = THREE.MathUtils.clamp(player.x, -90, 90);
  player.z = THREE.MathUtils.clamp(player.z, -95, 95);
  camera.position.set(player.x, 1.68, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  for (const [index, enemy] of enemies.entries()) {
    if (ferryMode) {
      const direction = index % 3;
      enemy.position.x += (direction === 0 ? .12 : direction === 1 ? -.09 : 0) * dt;
      enemy.position.z += (direction === 2 ? .14 : .035) * dt;
    } else {
      enemy.position.z -= .11 * dt;
    }
    enemy.position.z = Math.max(enemy.position.z, 27);
  }
  for (const [index, civilian] of civilians.entries()) {
    const { originX, originZ, move, phase } = civilian.userData;
    civilian.position.x = originX - (ferryMode ? .34 : .025) * ((clock.elapsedTime + phase) % 12);
    civilian.position.z = originZ + Math.sin(clock.elapsedTime * 1.1 + phase) * .08;
    const walk = Math.sin(clock.elapsedTime * 5 + index) * .04;
    civilian.children[2].rotation.x = walk;
  }
  for (const boat of boats) {
    boat.position.y = .05 + Math.sin(clock.elapsedTime * 1.25 + boat.userData.phase) * .12;
    boat.position.z = boat.userData.originZ + Math.sin(clock.elapsedTime * .17 + boat.userData.phase) * 5;
  }
  renderer.render(scene, camera);
}

renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
renderer.domElement.addEventListener('pointerdown', event => {
  if (!active || event.button !== 2) return;
  dragging = true;
  renderer.domElement.setPointerCapture(event.pointerId);
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('mousemove', event => {
  if (!active || (!dragging && document.pointerLockElement !== renderer.domElement)) return;
  updateLook(event.movementX, event.movementY);
});
document.addEventListener('pointerlockchange', () => {
  if (!active) return;
  if (document.pointerLockElement !== renderer.domElement) heldKeys.clear();
  $('scene-status').textContent = document.pointerLockElement === renderer.domElement
    ? '第一人称观察中 · Esc 释放鼠标，右上角可返回。'
    : '点击画面锁定鼠标，或按住右键拖动环顾。';
});
document.addEventListener('keydown', event => {
  if (!active) return;
  if (event.target instanceof HTMLButtonElement && ['Enter', 'Space'].includes(event.code)) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
  heldKeys.add(event.code);
});
document.addEventListener('keyup', event => heldKeys.delete(event.code));
window.addEventListener('blur', () => { heldKeys.clear(); dragging = false; });
window.addEventListener('resize', resize);
$('enter-first-person').addEventListener('click', enter);
$('scene-exit').addEventListener('click', exit);
$('scene-gate').addEventListener('click', () => setLocation(false));
$('scene-ferry').addEventListener('click', () => setLocation(true));
$('scene-look').addEventListener('click', async () => {
  if (!active) return;
  try {
    await renderer.domElement.requestPointerLock();
  } catch (error) {
    $('scene-status').textContent = `锁定鼠标不可用（${error.message}）；按住右键拖动仍可环顾。`;
  }
});

window.__nanjingFirstPerson = {
  get ready() { return initialized; },
  get active() { return active; },
  get location() { return ferryMode ? 'ferry' : 'gate'; },
  get position() { return { x: player.x, z: player.z }; },
  layout: referenceLayout,
  enter,
  exit,
  setLocation,
};
