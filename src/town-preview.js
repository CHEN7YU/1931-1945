import * as THREE from 'three';
import './town-preview.css';
import { makeWorld } from './battlefield.js';
import { loadSceneMaterials } from './materials.js';
import { configureSunShadow, createDaylight } from './lighting.js';
import { circleBlocked, createNavigator } from './core.js';
import { PREVIEW_BASES, PREVIEW_BOUNDS, PREVIEW_BRIDGE, PREVIEW_OBJECTIVES, makeTownPreviewLayout } from './town-preview-layout.js';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('view').append(renderer.domElement);
scene.fog = new THREE.FogExp2(0xb7b6af, .0035);
const sun = new THREE.DirectionalLight(0xffefd5, 2.5);
sun.position.set(-55, 70, 38); sun.castShadow = true; configureSunShadow(sun);
const hemisphere = new THREE.HemisphereLight(0xc3d3e1, 0x766651, .6);
scene.add(sun, hemisphere);
const camera = new THREE.PerspectiveCamera(70, 1, .07, 700);
camera.rotation.order = 'YXZ';
const overviewCamera = new THREE.PerspectiveCamera(55, 1, .1, 700);
overviewCamera.position.set(-92, 110, 108); overviewCamera.lookAt(4, 0, -8);
const position = new THREE.Vector3(8, 0, -5);
let yaw = 0, pitch = -.06, overview = false, dragging = false, ready = false, world;
const keys = new Set(), routes = [], clock = new THREE.Clock();
let routeRows = [];

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  for (const view of [camera, overviewCamera]) {
    view.aspect = innerWidth / innerHeight; view.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize); resize();

function setOverview(enabled) {
  overview = enabled;
  document.body.classList.toggle('overview', enabled);
  $('overview').textContent = enabled ? '返回第一人称' : '放大俯瞰';
  $('crosshair').hidden = enabled || !ready;
  keys.clear();
  if (enabled && document.pointerLockElement) document.exitPointerLock();
}
function visit(point) {
  if (!ready) return;
  const target = point.view ?? point;
  const y = world.groundHeight(target.x, target.z);
  if (circleBlocked(target.x, target.z, .34, world.obstacles, y)) throw new Error(`预览落点受阻：${point.name}`);
  position.set(target.x, y, target.z);
  yaw = target.yaw ?? 0; pitch = target.pitch ?? -.06;
  setOverview(false);
  $('status').textContent = `${point.name} · 可步行探索；这是布局草案，不进行占领计时。`;
}

renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
renderer.domElement.addEventListener('pointerdown', event => {
  if (!ready || overview) return;
  if (event.button === 2) { dragging = true; renderer.domElement.setPointerCapture(event.pointerId); }
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('mousemove', event => {
  if (overview || (!dragging && document.pointerLockElement !== renderer.domElement)) return;
  yaw -= event.movementX * .002; pitch = THREE.MathUtils.clamp(pitch - event.movementY * .002, -1.35, 1.35);
});
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('walking', Boolean(document.pointerLockElement));
  if (!document.pointerLockElement) keys.clear();
});
document.addEventListener('pointerlockerror', () => {
  $('status').textContent = '此窗口不支持锁定鼠标：请按住画面右键拖动环顾，WASD 仍可行走。';
});
$('walk').addEventListener('click', async () => {
  setOverview(false);
  if (document.pointerLockElement === renderer.domElement) { document.exitPointerLock(); return; }
  try { await renderer.domElement.requestPointerLock(); }
  catch (error) {
    $('status').textContent = `鼠标锁定不可用（${error.message}）；按住画面右键拖动环顾。`;
  }
});
$('overview').addEventListener('click', () => { if (ready) setOverview(!overview); });
$('home').addEventListener('click', () => visit({ name: '桥南入口', x: 8, z: -5 }));
for (const button of document.querySelectorAll('[data-point]')) {
  button.addEventListener('click', () => visit(PREVIEW_OBJECTIVES.find(point => point.id === button.dataset.point)));
}
function interact() {
  const door = world.doorSystem.focus(camera);
  if (door) world.doorSystem.interact(door, position);
}
window.addEventListener('keydown', event => {
  if (!ready || event.target.closest('input, textarea, select')) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyM') setOverview(!overview);
  if (event.code === 'KeyE' && !overview) interact();
  if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) visit(PREVIEW_OBJECTIVES[Number(event.code.at(-1)) - 1]);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); dragging = false; });

function drawMap() {
  const canvas = $('map'), ctx = canvas.getContext('2d');
  const scale = 3.8, cx = 300, cz = 280;
  const xy = point => [cx + point.x * scale, cz + point.z * scale];
  ctx.fillStyle = '#b6ad8d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#9b9074'; ctx.fillRect(0, cz - 23 * scale, 600, 14 * scale);
  ctx.fillStyle = '#d1c5a5'; ctx.fillRect(cx, cz - 26.5 * scale, 16 * scale, 21 * scale);
  ctx.strokeStyle = '#d3c7a6'; ctx.lineWidth = 12 * scale;
  for (const z of [-51, 30]) {
    ctx.beginPath(); ctx.moveTo(20, cz + z * scale); ctx.lineTo(580, cz + z * scale); ctx.stroke();
  }
  ctx.strokeStyle = '#d3c7a6'; ctx.lineWidth = 8 * scale;
  ctx.beginPath(); ctx.moveTo(cx, cz + 68 * scale); ctx.lineTo(cx, cz);
  ctx.lineTo(cx + 8 * scale, cz - 30 * scale); ctx.lineTo(cx + 8 * scale, 15); ctx.stroke();
  for (const building of world.town.buildings) {
    const [x, z] = xy(building);
    ctx.fillStyle = building.id === 'canal-south-granary' ? '#6c6550' : '#8a8067';
    ctx.fillRect(x - building.w * scale / 2, z - building.d * scale / 2, building.w * scale, building.d * scale);
  }
  ctx.fillStyle = '#535849';
  for (const wall of world.town.fortifications.walls.filter(piece => !piece.id.includes('rubble'))) {
    const [x, z] = xy(wall);
    ctx.fillRect(x - wall.w * scale / 2, z - wall.d * scale / 2, wall.w * scale, wall.d * scale);
  }
  ctx.save(); ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
  for (const route of routes) {
    ctx.strokeStyle = route.team === 'friendly' ? '#386c65' : '#a15b4e';
    ctx.beginPath(); route.path.forEach((point, index) => ctx[index ? 'lineTo' : 'moveTo'](...xy(point))); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#dac28a'; ctx.setLineDash([4, 5]); ctx.lineWidth = 2;
  ctx.beginPath(); PREVIEW_OBJECTIVES.forEach((point, i) => ctx[i ? 'lineTo' : 'moveTo'](...xy(point))); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 19px sans-serif';
  for (const point of PREVIEW_OBJECTIVES) {
    const [x, z] = xy(point);
    ctx.fillStyle = '#efd39933'; ctx.beginPath(); ctx.arc(x, z, point.radius * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#303d35'; ctx.beginPath(); ctx.arc(x, z, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f9e6b8'; ctx.fillText(point.id, x, z);
  }
  ctx.font = '15px sans-serif';
  for (const base of PREVIEW_BASES) {
    const [x, z] = xy(base);
    ctx.fillStyle = base.team === 'friendly' ? '#356d60' : '#a05d4d';
    ctx.fillRect(x - 6, z - 6, 12, 12);
    ctx.fillStyle = '#26382f'; ctx.fillText(base.team === 'friendly' ? '中方' : '日方', x + 26, z);
  }
  const [px, pz] = xy(position);
  ctx.save(); ctx.translate(px, pz); ctx.rotate(-yaw);
  ctx.fillStyle = '#fff6db'; ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#27382d'; ctx.fillText('北 ↑', 36, 24);
  ctx.font = '12px sans-serif'; ctx.fillText('144 × 138 米裁切战区', 300, 555);
}

function measureRoutes() {
  const navigator = createNavigator(world.doorSystem.navigationObstacles, 1, .46);
  const distance = path => path.slice(1).reduce((total, point, index) =>
    total + Math.hypot(point.x - path[index].x, point.z - path[index].z), 0);
  routeRows = PREVIEW_OBJECTIVES.map(objective => {
    const result = { id: objective.id };
    for (const base of PREVIEW_BASES) {
      let best;
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        const goal = { x: objective.x + Math.cos(angle) * (objective.radius - 1),
          z: objective.z + Math.sin(angle) * (objective.radius - 1) };
        if (circleBlocked(goal.x, goal.z, .46, world.obstacles)) continue;
        const path = navigator(base, goal);
        if (!path.length) continue;
        if (path.some(point => point.x < PREVIEW_BOUNDS.minX || point.x > PREVIEW_BOUNDS.maxX ||
          point.z < PREVIEW_BOUNDS.minZ || point.z > PREVIEW_BOUNDS.maxZ)) continue;
        const full = [base, ...path], length = distance(full);
        if (!best || length < best.length) best = { path: full, length, team: base.team };
      }
      if (!best) throw new Error(`${base.name} 到 ${objective.name} 没有可通行的步行路线`);
      routes.push(best); result[base.team] = Math.round(best.length);
    }
    return result;
  });
  $('distances').replaceChildren(...routeRows.map(row => {
    const tr = document.createElement('tr');
    for (const value of [row.id, row.friendly, row.enemy]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    return tr;
  }));
}

async function initialize() {
  const surface = await loadSceneMaterials(renderer, scene);
  world = makeWorld(scene, surface, { town: makeTownPreviewLayout(), bridge: PREVIEW_BRIDGE, objectives: PREVIEW_OBJECTIVES });
  for (const puff of world.smoke) puff.removeFromParent();
  createDaylight(scene, sun, hemisphere, scene.fog).setEnabled(true);
  measureRoutes();
  ready = true;
  $('walk').textContent = '进入第一人称';
  for (const button of document.querySelectorAll('button')) button.disabled = false;
  visit({ name: '桥南入口', x: 8, z: -5 });
  window.__townPreview = {
    ready: true, combatActors: 0, bounds: PREVIEW_BOUNDS, objectives: PREVIEW_OBJECTIVES, bases: PREVIEW_BASES,
    routes: routeRows, bridge: PREVIEW_BRIDGE, town: world.town,
    get position() { return { x: position.x, y: position.y, z: position.z }; },
    get overview() { return overview; },
  };
}
initialize().catch(error => {
  console.error(error);
  $('error').hidden = false; $('error').textContent = `空地图未能加载：${error.message}`;
  $('status').textContent = '加载失败，不能将当前画面作为完成的预览。';
});

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05);
  if (!ready) return;
  if (!overview) {
    const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const length = Math.hypot(forward, side) || 1, speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6.4 : 3.8;
    const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) / length * speed * dt;
    const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) / length * speed * dt;
    world.moveInfantry(position, dx, dz, .34, world.obstacles);
    position.x = THREE.MathUtils.clamp(position.x, PREVIEW_BOUNDS.minX + .5, PREVIEW_BOUNDS.maxX - .5);
    position.z = THREE.MathUtils.clamp(position.z, PREVIEW_BOUNDS.minZ + .5, PREVIEW_BOUNDS.maxZ - .5);
    camera.position.copy(position); camera.position.y += 1.68;
    camera.rotation.set(pitch, yaw, 0);
  }
  world.doorSystem.update(dt, [{ x: position.x, y: position.y, z: position.z, radius: .34 }]);
  drawMap(); renderer.render(scene, overview ? overviewCamera : camera);
});
