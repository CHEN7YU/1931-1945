import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLocomotion, advanceLocomotion, stopLocomotion } from './locomotion.js';
import { createSimulationClock } from './simulation-clock.js';
import { configureRifleMaterials, rifleWorldModel } from './rifle-model.js';
import { createCharacterProbe } from './character-probe.js';

const $ = id => document.getElementById(id);
if (!import.meta.env.DEV) throw new Error('The isolated asset probe is development-only');
const renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x81948f);
scene.add(new THREE.HemisphereLight(0xe8f1ef, 0x525849, 2));
const sunlight = new THREE.DirectionalLight(0xfff4df, 2.2);
sunlight.position.set(4, 8, 6); scene.add(sunlight);
const camera = new THREE.PerspectiveCamera(50, 1, .05, 100);
camera.position.set(5, 3.8, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .9, 2); controls.enableDamping = true; controls.maxDistance = 25; controls.minDistance = 2;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 20), new THREE.MeshStandardMaterial({ color: 0x6e7664, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
scene.add(new THREE.GridHelper(20, 20, 0xc8c5a0, 0x929a85));
const wall = { minX: -1.6, maxX: 1.6, minZ: -3.2, maxZ: -2.8, height: 2.2 };
const wallView = new THREE.Mesh(new THREE.BoxGeometry(3.2, wall.height, .4), new THREE.MeshStandardMaterial({ color: 0x8c7770 }));
wallView.position.set(0, wall.height / 2, -3); scene.add(wallView);
const obstacles = [wall,
  { minX: -8, maxX: -6, minZ: -12, maxZ: 12 }, { minX: 6, maxX: 8, minZ: -12, maxZ: 12 },
  { minX: -8, maxX: 8, minZ: -12, maxZ: -10 }, { minX: -8, maxX: 8, minZ: 10, maxZ: 12 }];
const position = new THREE.Vector3(0, 0, 4), keys = new Set();
let motion = createLocomotion(), probe, fatal = null, frameId, simTime = 0;
const clock = createSimulationClock(performance.now());
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
function active(value) {
  clock.setActive(value, performance.now());
  keys.clear(); stopLocomotion(motion);
  $('toggle').textContent = value ? '暂停样例' : '继续样例';
}
function fail(error) {
  console.error(error);
  fatal = error instanceof Error ? error.message : String(error);
  clock.setActive(false, performance.now());
  $('error').hidden = false; $('error').textContent = `导入或运行失败：${fatal}`;
  $('status').textContent = '未通过；没有使用程序人物静默代替';
  $('toggle').disabled = $('reset').disabled = true;
}
addEventListener('resize', resize);
addEventListener('keydown', event => {
  if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ShiftLeft', 'ShiftRight', 'Space'].includes(event.code)) return;
  event.preventDefault();
  if (!probe || fatal) return;
  if (event.code === 'Space' && !event.repeat) active(!clock.active);
  else if (clock.active) keys.add(event.code);
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => { if (probe && clock.active) active(false); });
$('toggle').addEventListener('click', () => active(!clock.active));
$('reset').addEventListener('click', () => {
  active(false); position.set(0, 0, 4); motion = createLocomotion();
  probe.update(0, position, motion);
});
resize();
function tick() {
  try {
    clock.beginFrame(performance.now());
    for (let dt; probe && !fatal && (dt = clock.takeStep()) > 0;) {
      simTime += dt;
      advanceLocomotion(motion, position, { type: 'infantry', stance: 'standing', yaw: 0, grounded: true,
        forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
        sideways: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), walking: keys.has('KeyC') }, obstacles, dt);
      probe.update(dt, position, motion);
    }
    controls.update();
    renderer.render(scene, camera);
    if (probe && !fatal) {
      $('status').textContent = clock.active ? `运行 · 实际速度 ${motion.speed.toFixed(2)} 米/秒` : '已暂停，可旋转查看';
      $('metrics').textContent = `真实蒙皮 ${probe.snapshot.skinnedMeshes} / 骨骼 ${probe.snapshot.bones}\n动作 ${probe.snapshot.active}\n位置 ${position.x.toFixed(2)}, ${position.z.toFixed(2)}\n归一静态身高 1.75m（非史实考据）\n体力 ${(motion.stamina * 100).toFixed(0)}%`;
    }
  } catch (error) { fail(error); }
  frameId = requestAnimationFrame(tick);
}
Object.defineProperty(window, '__assetProbe', { get: () => ({
  ready: Boolean(probe), fatal, simTime, active: clock.active, clock: clock.snapshot, position: position.toArray(),
  movement: { speed: motion.speed, stamina: motion.stamina }, character: probe?.snapshot ?? null,
  wall: { ...wall }, drawCalls: renderer.info.render.calls,
}) });
requestAnimationFrame(tick);
try {
  const base = '/assets/characters/kenney-survivor/';
  const [model, idleModel, runModel, skin] = await Promise.all([
    new FBXLoader().loadAsync(`${base}character.fbx`), new FBXLoader().loadAsync(`${base}idle.fbx`),
    new FBXLoader().loadAsync(`${base}run.fbx`), new THREE.TextureLoader().loadAsync(`${base}skin.png`),
  ]);
  skin.colorSpace = THREE.SRGBColorSpace;
  await configureRifleMaterials(renderer.capabilities.getMaxAnisotropy());
  const material = new THREE.MeshStandardMaterial({ map: skin, roughness: 1 });
  model.traverse(node => { if (node.isMesh) node.material = material; });
  probe = createCharacterProbe(model, {
    idle: idleModel.animations.find(clip => clip.name === 'Root|Idle'),
    run: runModel.animations.find(clip => clip.name === 'Root|Run'),
  }, rifleWorldModel());
  scene.add(probe.root);
  probe.update(0, position, motion);
  $('toggle').disabled = $('reset').disabled = false;
} catch (error) { fail(error); }
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frameId); controls.dispose(); probe?.dispose(); renderer.dispose();
});
