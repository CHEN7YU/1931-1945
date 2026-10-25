import * as THREE from 'three';
import './style.css';
import { soldierModel, tankModel, planeModel, weaponModel, rallyPointModel, baseSpawnModel, setModelSurfaces } from './world.js';
import { makeWorld } from './battlefield.js';
import { loadSceneMaterials } from './materials.js';
import { TYPES, MATCH_SECONDS, makeObjectives, advanceCapture, moveGround, circleBlocked, createNavigator, blastDamage, nextAlive, canDeploySquad, shotState } from './core.js';
import { SPAWN_RULES, SQUADS, makeBaseSpawns, deploymentBlockReason, supportsSquad, spawnBlockReason, rallyBuildBlockReason, spawnPositions } from './spawns.js';
import { createLocomotion, advanceLocomotion, stopLocomotion, recoverLocomotion, landLocomotion } from './locomotion.js';
import { RIFLE, createRifleState, reloadRifle, shootRifle, advanceRifle } from './rifle-action.js';
import { updateRifleModel, updateRifleArms } from './rifle-model.js';
import { createTactics, rememberThreat, expireThreat, peekTurn, selectCover, advancePosition, pointSegmentDistance } from './tactics.js';
import { createQualitySettings, QUALITY_EFFECTS } from './quality.js';
import { canWeaponDamageTarget, damageForTarget, rifleArmorResponse } from './combat-targets.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb7b6af, .0035);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .07, 650);
camera.rotation.order = 'YXZ';
scene.add(camera);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  $('loading').hidden = true;
  $('fatal').hidden = false;
  $('fatal-message').textContent = `无法创建 WebGL 渲染器。请使用支持硬件加速的桌面浏览器。${error.message}`;
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
scene.add(new THREE.HemisphereLight(0xc3d3e1, 0x766651, .6));
const sun = new THREE.DirectionalLight(0xffefd5, 2.5);
sun.position.set(-55, 70, 38);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 240 });
sun.shadow.bias = -.00015;
sun.shadow.normalBias = .025;
sun.shadow.radius = 2;
scene.add(sun);
let surface;
try {
  surface = await loadSceneMaterials(renderer, scene);
} catch (error) {
  $('loading').hidden = true;
  $('fatal').hidden = false;
  $('fatal-message').textContent = `场景材质加载失败：${error.message}。请重新加载，并检查本地 assets 文件是否完整。`;
  throw error;
}
setModelSurfaces(surface);
const world = makeWorld(scene, surface);
const graphics = createQualitySettings({ renderer, scene, sun, smoke: world.smoke, grain: document.querySelector('.grain') });
const navigate = createNavigator(world.doorSystem.navigationObstacles);
world.doorSystem.onNavigationChanged = navigate.refresh;
world.doorSystem.onRequested = door => doorSound(door);
const ray = new THREE.Raycaster();
const vector = new THREE.Vector3();
const direction = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const groundPlane = new THREE.Plane(up, 0);
const projectileGeometry = new THREE.SphereGeometry(.12, 6, 6);
const explosionGeometry = new THREE.IcosahedronGeometry(1, 1);
const shellMaterial = new THREE.MeshBasicMaterial({ color: 0xffce70 });
const radarContext = $('radar').getContext('2d');
const keys = new Set();
const effects = [];
const shells = [];
const feed = [];
const coverClaims = new Map();
const combatSounds = [];
const combatStats = { aiRifleShots: 0, aiRifleShotsAtArmor: 0, armorThreatsObserved: 0, rejectedRifleArmorDamage: 0 };
let actorSerial = 0;
let enemySquadSerial = 0;
let soundSerial = 0;
let state = 'menu';
let selectedType = 'infantry';
let objectives = makeObjectives();
let allies = [];
let enemies = [];
let current = 0;
let unit = null;
let weapon = null;
let vehicle = null;
let yaw = 0;
let pitch = 0;
let mouseDown = false;
let rightDown = false;
let aiming = false;
let time = 0;
let remaining = MATCH_SECONDS;
let waveAt = 0;
let kills = 0;
let teamKills = 0;
let deployments = 0;
let recoil = 0;
let damageFlash = 0;
let markerUntil = 0;
let toastUntil = 0;
let hudAt = 0;
let lastFrame = performance.now();
let audioContext;
let noiseBuffer;
let pointerHintShown = false;
let outsideTime = 0;
let stance = 'standing';
let breath = 1;
let lean = 0;
let jumpHeight = 0;
let jumpVelocity = 0;
let eyeHeight = 1.67;
let motionStrength = 1;
let playerFootsteps = 0;
let lastFootSurface = null;
let weaponObstruction = 0;
let obstructionBlend = 0;
let lastRifleTrace = null;
let commandDownAt = null;
let spawnPoints = makeBaseSpawns();
let spawnEvents = [];
let rallySerial = 0;
let pendingSquad = null;
let pendingSpawn = null;
let deploymentRefreshAt = 0;
let toolEquipped = false;
const construction = { blueprint: false, site: null, anchor: null, progress: 0 };
let fatal = false;
const mortarTarget = new THREE.Vector3();
const rallyPreview = rallyPointModel('friendly', true);
rallyPreview.visible = false;
scene.add(rallyPreview);
for (const point of spawnPoints.filter(point => point.kind === 'base' || point.kind === 'garage')) {
  const model = baseSpawnModel(point.team);
  model.position.set(point.x, 0, point.z);
  scene.add(model);
}

function toast(message, duration = 3) {
  $('toast').textContent = message;
  $('toast').style.opacity = '1';
  toastUntil = time + duration;
}

function sound(kind) {
  if (!audioContext || audioContext.state !== 'running') return;
  const t = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = kind === 'blast' ? 220 : 1000;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(kind === 'blast' ? .22 : .09, t);
  gain.gain.exponentialRampToValueAtTime(.001, t + (kind === 'blast' ? .65 : .13));
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start(t);
  source.stop(t + .7);
}

function mechanicalSound(cue) {
  if (!audioContext || audioContext.state !== 'running') return;
  const source = audioContext.createBufferSource(), gain = audioContext.createGain(), filter = audioContext.createBiquadFilter();
  const now = audioContext.currentTime, length = cue === 'extract' ? .1 : .045;
  source.buffer = noiseBuffer;
  filter.type = 'bandpass'; filter.frequency.value = cue === 'load' ? 2400 : cue === 'close' ? 1250 : 3200; filter.Q.value = 2;
  gain.gain.setValueAtTime(.045, now); gain.gain.exponentialRampToValueAtTime(.001, now + length);
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start(now, .3, length);
}

function doorSound(door) {
  if (!audioContext || audioContext.state !== 'running') return;
  const distance = Math.hypot(door.x - camera.position.x, door.z - camera.position.z);
  if (distance > 18) return;
  const now = audioContext.currentTime, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(95, now);
  oscillator.frequency.exponentialRampToValueAtTime(58, now + .4);
  gain.gain.setValueAtTime(.001, now);
  gain.gain.linearRampToValueAtTime(.018 / (1 + distance * .3), now + .04);
  gain.gain.exponentialRampToValueAtTime(.001, now + .45);
  const panner = audioContext.createStereoPanner();
  const local = camera.worldToLocal(new THREE.Vector3(door.x, camera.position.y, door.z));
  panner.pan.value = THREE.MathUtils.clamp(local.x / Math.max(1, distance), -.9, .9);
  oscillator.connect(gain).connect(panner).connect(audioContext.destination);
  oscillator.start(now); oscillator.stop(now + .46);
}

function initAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  if (!audioContext) {
    audioContext = new Audio();
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(error => console.warn('游戏音效未启用：', error));
}

function footstep(position, speed, landing = false) {
  const ground = world.groundSurface(position.x, position.z);
  lastFootSurface = ground;
  playerFootsteps++;
  if (!audioContext || audioContext.state !== 'running') return;
  const t = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  const crawling = stance === 'prone' && !landing;
  filter.frequency.value = crawling ? 420 : ground === 'stone' ? 950 : ground === 'wood' ? 560 : 380;
  filter.Q.value = .65;
  const gain = audioContext.createGain();
  const force = (.035 + Math.min(speed, 5) * .008) * (landing ? 1.8 : crawling ? .45 : 1);
  gain.gain.setValueAtTime(force, t);
  gain.gain.exponentialRampToValueAtTime(.001, t + .13);
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start(t, Math.random() * .5, .15);
  if (crawling) return;
  const thud = audioContext.createOscillator();
  thud.frequency.setValueAtTime(ground === 'stone' ? 110 : 75, t);
  thud.frequency.exponentialRampToValueAtTime(40, t + .1);
  const thudGain = audioContext.createGain();
  thudGain.gain.setValueAtTime(force * .65, t);
  thudGain.gain.exponentialRampToValueAtTime(.001, t + .12);
  thud.connect(thudGain).connect(audioContext.destination);
  thud.start(t); thud.stop(t + .14);
}

function lockMouse() {
  if (document.pointerLockElement === canvas) return;
  if (!canvas.requestPointerLock) {
    toast('当前浏览器不支持鼠标捕获：按住右键拖动瞄准', 6);
    return;
  }
  const request = canvas.requestPointerLock();
  if (request?.catch) request.catch(error => {
    console.warn('鼠标捕获未获准：', error.message);
    if (!pointerHintShown) {
      toast('鼠标捕获未获准：可点击画面重试，或按住右键拖动瞄准', 7);
      pointerHintShown = true;
    }
  });
}

function releaseMouse() {
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();
  mouseDown = false;
  rightDown = false;
  aiming = false;
  commandDownAt = null;
  $('scoreboard').hidden = true;
  if (allies[current]) stopLocomotion(allies[current].locomotion);
}

function actorAt(friendly, x, z, index, spawn) {
  const model = soldierModel(friendly);
  model.position.set(x, world.groundHeight(x, z), z);
  scene.add(model);
  const actor = { model, health: 100, friendly, index, spawnId: spawn.id, role: index === 0 ? 'engineer' : 'rifleman', nextFire: time + 1 + Math.random() * 2, nextThink: 0, target: null, walkPhase: Math.random() * 6, deathTime: 0, buildProgress: 0, locomotion: createLocomotion(), rifle: createRifleState() };
  actor.targetKind = 'person';
  actor.tactics = createTactics(++actorSerial, friendly ? deployments : enemySquadSerial + Math.floor(index / 4), index);
  model.rotation.y = friendly ? 0 : Math.PI;
  spawnEvents.push({ team: friendly ? 'friendly' : 'enemy', pointId: spawn.id, pointX: spawn.x, pointZ: spawn.z, x, z, time });
  if (spawnEvents.length > 160) spawnEvents.shift();
  model.traverse(child => { if (child.isMesh) child.userData.actor = actor; });
  return actor;
}

function hostilePositions(team) {
  return (team === 'friendly' ? enemies : allies).map(actor => ({ x: actor.model.position.x, z: actor.model.position.z, health: actor.health, altitude: actor === allies[current] ? unit?.altitude || 0 : 0 }));
}

function resetSpawns() {
  for (const point of spawnPoints) if (point.model) scene.remove(point.model);
  spawnPoints = makeBaseSpawns();
  spawnEvents = [];
  rallySerial = 0;
}

function spawnEnemySquad(count = 4) {
  const hostiles = hostilePositions('enemy');
  const candidates = spawnPoints.filter(point => point.team === 'enemy' && !spawnBlockReason(point, 'infantry', hostiles, world.obstacles));
  const spawn = candidates.find(point => point.kind === 'rally') || candidates.find(point => point.kind === 'base');
  if (!spawn) return;
  for (const [index, position] of spawnPositions(spawn, count).entries()) {
    const actor = actorAt(false, position.x, position.z, index, spawn);
    enemies.push(actor);
  }
  enemySquadSerial += Math.ceil(count / 4);
}

function clearActors(list) {
  for (const actor of list) scene.remove(actor.model);
}

function clearTransient() {
  for (const effect of [...effects]) removeEffect(effect);
  for (const shell of shells) scene.remove(shell.mesh);
  shells.length = 0;
}

function beginMatch() {
  world.doorSystem.reset();
  coverClaims.clear();
  combatSounds.length = 0;
  for (const key of Object.keys(combatStats)) combatStats[key] = 0;
  clearActors(allies);
  clearActors(enemies);
  clearTransient();
  enemies = [];
  allies = [];
  resetSpawns();
  pendingSquad = pendingSpawn = null;
  objectives = makeObjectives();
  for (const flag of world.flags) flag.material.color.setHex(0xa19469);
  time = 0;
  remaining = MATCH_SECONDS;
  kills = teamKills = deployments = 0;
  waveAt = 14;
  feed.length = 0;
  playerFootsteps = 0;
  lastFootSurface = null;
  spawnEnemySquad(8);
  $('menu').hidden = true;
  $('hud').hidden = false;
  deploy(selectedType);
}

function deploy(squadId, spawnId = null) {
  const type = SQUADS[squadId]?.type;
  const blocked = deploymentBlockReason(state, allies, squadId, unit?.squadId);
  if (blocked) {
    $('deployment-error').textContent = blocked;
    toast(blocked, 4);
    return;
  }
  const spawn = spawnPoints.find(point => spawnId ? point.id === spawnId : point.team === 'friendly' && point.kind !== 'rally' && supportsSquad(point, type));
  const spawnError = !spawn || spawn.team !== 'friendly' ? '请选择己方可用重生点' : spawnBlockReason(spawn, type, hostilePositions('friendly'), world.obstacles);
  if (spawnError) {
    $('deployment-error').textContent = spawnError;
    toast(spawnError, 4);
    return;
  }
  clearActors(allies);
  if (vehicle) scene.remove(vehicle);
  if (weapon) {
    camera.remove(weapon);
    // View models own only their hierarchy; their geometry/materials are shared.
    weapon = null;
  }
  allies = [];
  const active = objectives.find(point => !point.captured);
  deployments++;
  current = 0;
  const positions = spawnPositions(spawn, TYPES[type].members);
  for (let i = 0; i < TYPES[type].members; i++) {
    const position = type === 'tank' || type === 'plane' ? spawn : positions[i];
    const actor = actorAt(true, position.x, position.z, i, spawn);
    actor.health = type === 'tank' ? 100 : TYPES[type].health;
    if (type !== 'infantry') actor.role = type === 'mortar' ? 'mortarman' : type === 'tank' ? 'tanker' : 'pilot';
    actor.targetKind = type === 'tank' ? 'closed-armor' : type === 'plane' ? 'aircraft' : 'person';
    if (type === 'tank') actor.model.visible = false;
    allies.push(actor);
  }
  allies[0].model.visible = false;
  unit = { type, squadId, spawnId: spawn.id, ammo: TYPES[type].magazine, nextShot: 0, reloadUntil: 0, altitude: type === 'plane' ? spawn.altitude : world.groundHeight(spawn.x, spawn.z), throttle: 1, heading: 0, vehicleHealth: type === 'tank' ? TYPES.tank.health : null };
  yaw = 0;
  pitch = type === 'mortar' ? -.18 : type === 'plane' ? -.14 : 0;
  recoil = damageFlash = outsideTime = 0;
  weaponObstruction = obstructionBlend = 0;
  lastRifleTrace = null;
  stance = 'standing';
  breath = 1;
  lean = jumpHeight = jumpVelocity = 0;
  eyeHeight = type === 'tank' ? 2.7 : 1.67;
  if (type === 'tank') vehicle = tankModel();
  else if (type === 'plane') vehicle = planeModel();
  else vehicle = null;
  if (vehicle) scene.add(vehicle);
  weapon = weaponModel(type);
  weapon.traverse(mesh => {
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.frustumCulled = false;
    }
  });
  camera.add(weapon);
  if (type === 'infantry') weapon.position.set(.18, -.22, -.14);
  toolEquipped = false;
  resetConstruction();
  $('unit-title').textContent = SQUADS[squadId].name;
  $('weapon-name').textContent = TYPES[type].weapon;
  $('ammo-max').textContent = `/ ${TYPES[type].magazine}`;
  $('aim-label').hidden = type !== 'mortar';
  $('squad-hint').textContent = type === 'plane' ? '单人飞行员 · 飞机损失后换队' : 'Y 切换队员 · 整队阵亡后换队';
  $('battle-controls').innerHTML = {
    infantry: 'WASD 慢跑 · C 慢走 · Shift 冲刺 / 举枪屏息 · F 开关门<br>Y 队员 · X 命令 · 工兵：1 步枪 / 2 工具 · 按住左键建造',
    tank: 'W S 前后 · A D 转向 · 鼠标 炮塔 · 右键 放大<br>左键 主炮 · Y 切换车组 · R 装填 · Esc 暂停',
    mortar: 'WASD 搬运 · C 慢走 · Shift 短时冲刺 · 鼠标 弹着点<br>左键 发射 · Y 炮组 · X 命令 · B 镜头步态 · Esc 暂停',
    plane: 'W S 调节速度 · A D 转向 · 鼠标 控制机头<br>Space 爬升 · Ctrl 下降 · 左键 机炮 · 无法空中占点',
  }[type];
  allies.forEach(actor => { actor.order = 'follow'; });
  $('overlay').hidden = true;
  pendingSquad = pendingSpawn = null;
  state = 'playing';
  hudAt = 0;
  initAudio();
  lockMouse();
  updateCamera(0);
  toast(type === 'plane' ? '从南侧空中入场点进入战场 · 飞机损失后可换其他小队' : `${TYPES[type].name}从${spawn.name}出击`, 5);
  updateHUD();
}

function showOverlay(kind = 'pause') {
  state = kind;
  releaseMouse();
  $('overlay').hidden = false;
  const ended = kind === 'victory' || kind === 'defeat';
  const dead = kind === 'dead';
  resetConstruction();
  $('overlay-kicker').textContent = kind === 'victory' ? '作战胜利 / VICTORY' : kind === 'defeat' ? '作战结束 / TIME EXPIRED' : dead ? '整队阵亡 / REDEPLOY' : '作战暂停 / PAUSED';
  $('overlay-title').textContent = kind === 'victory' ? '阵地已夺，山河犹在。' : kind === 'defeat' ? '时间耗尽，战线未竟。' : dead ? '重整队伍，再出发。' : '下一步，由你指挥。';
  $('overlay-description').textContent = ended ? '这是原创灰盒玩法演示，不代表真实历史战斗过程。' : dead ? '选择其他小队和可用重生点，再确认出击。战斗与计时仍在继续。' : '当前小队仍在作战。可切换本队存活队员；整队阵亡后才能选择其他小队。';
  $('resume').hidden = ended || dead;
  $('redeploy-choices').hidden = !canDeploySquad(kind, allies);
  $('deployment-options').hidden = !dead;
  $('motion-settings').hidden = kind !== 'pause';
  $('quality-settings').hidden = kind !== 'pause';
  pendingSquad = pendingSpawn = null;
  $('deployment-error').textContent = '';
  if (dead) refreshDeployment();
  $('battle-summary').textContent = `个人击倒 ${kills}　友军击倒 ${teamKills}　占领 ${objectives.filter(p => p.captured).length} / 3`;
}

function refreshDeployment() {
  if (state !== 'dead') return;
  for (const button of $('redeploy-choices').querySelectorAll('[data-type]')) {
    const id = button.dataset.type;
    const type = SQUADS[id].type;
    const reason = deploymentBlockReason(state, allies, id, unit.squadId);
    button.disabled = Boolean(reason);
    button.classList.toggle('selected', pendingSquad === id);
    button.setAttribute('aria-pressed', String(pendingSquad === id));
    button.querySelector('small').textContent = reason ? '刚刚阵亡 · 请选其他小队' : `${TYPES[type].members} 人 · 可出击`;
  }
  const active = objectives.find(point => !point.captured);
  $('deployment-objective').textContent = active ? `当前目标 ${active.id} · ${active.name}` : '据点已全部夺取';
  const pendingType = SQUADS[pendingSquad]?.type;
  $('deployment-selection').textContent = pendingSquad ? `${SQUADS[pendingSquad].name} / ${TYPES[pendingType].weapon}` : '选择其他小队，再选择重生点。';
  const candidates = pendingSquad ? spawnPoints.filter(point => point.team === 'friendly' && supportsSquad(point, pendingType)) : [];
  const hostiles = hostilePositions('friendly');
  const signature = candidates.map(point => point.id).join(',');
  if ($('spawn-choices').dataset.signature !== signature) {
    $('spawn-choices').innerHTML = candidates.map(point => `<button data-spawn="${point.id}"><span>${point.name}</span><small></small></button>`).join('');
    $('spawn-choices').dataset.signature = signature;
  }
  for (const button of $('spawn-choices').querySelectorAll('[data-spawn]')) {
    const point = candidates.find(candidate => candidate.id === button.dataset.spawn);
    const reason = spawnBlockReason(point, pendingType, hostiles, world.obstacles);
    button.disabled = Boolean(reason);
    button.classList.toggle('selected', pendingSpawn === point.id);
    button.setAttribute('aria-pressed', String(pendingSpawn === point.id));
    button.querySelector('small').textContent = reason || (point.kind === 'rally' ? `工兵建造 · 耐久 ${Math.ceil(point.health)}` : '默认重生点');
  }
  const selected = candidates.find(point => point.id === pendingSpawn);
  const blocked = selected ? spawnBlockReason(selected, pendingType, hostiles, world.obstacles) : null;
  $('confirm-deploy').disabled = !pendingSquad || !selected || Boolean(blocked);
  $('confirm-deploy').firstChild.textContent = pendingSquad ? `部署${SQUADS[pendingSquad].name} ` : '选择小队后出击 ';
  if (blocked) $('deployment-error').textContent = blocked;
  else if (selected) $('deployment-error').textContent = '';
  drawRadar($('deployment-map').getContext('2d'));
}

function resetConstruction() {
  construction.blueprint = false;
  construction.site = construction.anchor = null;
  construction.progress = 0;
  rallyPreview.visible = false;
  $('construction-panel').hidden = true;
}

function equipTool(equipped) {
  if (equipped && allies[current]?.role !== 'engineer') {
    toast('只有工兵可以使用建造工具；按 Y 切换队员');
    return;
  }
  resetConstruction();
  toolEquipped = equipped;
  mouseDown = aiming = false;
  if (weapon) camera.remove(weapon);
  weapon = weaponModel(equipped ? 'hammer' : unit.type);
  weapon.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
  camera.add(weapon);
  if (!equipped && unit.type === 'infantry') weapon.position.set(.18, -.22, -.14);
  $('weapon-name').textContent = equipped ? '工兵建造工具' : TYPES[unit.type].weapon;
  unit.nextShot = time + .3;
  syncRifleUnit();
}

function completeRally(team, position) {
  for (const old of spawnPoints.filter(point => point.team === team && point.kind === 'rally')) scene.remove(old.model);
  spawnPoints = spawnPoints.filter(point => point.team !== team || point.kind !== 'rally');
  const point = { id: `${team}-rally-${++rallySerial}`, name: team === 'friendly' ? '工兵前线集结点' : '日军前线集结点', team, kind: 'rally', x: position.x, z: position.z, altitude: world.groundHeight(position.x, position.z), health: SPAWN_RULES.rallyHealth };
  point.model = rallyPointModel(team);
  point.model.position.set(point.x, point.altitude, point.z);
  point.model.traverse(mesh => { if (mesh.isMesh) mesh.userData.spawnPoint = point; });
  scene.add(point.model);
  spawnPoints.push(point);
  if (team === 'friendly') toast('集结点建成 · 整队阵亡后，可让其他地面小队从此出击', 6);
  return point;
}

function damageRally(point, damage) {
  if (point.kind !== 'rally' || point.health <= 0) return;
  point.health = Math.max(0, point.health - damage);
  if (point.health === 0) {
    scene.remove(point.model);
    impact(new THREE.Vector3(point.x, .7, point.z), true);
    toast(point.team === 'friendly' ? '我方工兵集结点已被摧毁，无法再从此重生！' : '敌军前线集结点已被摧毁', 6);
    if (state === 'dead') refreshDeployment();
  }
}

function updateConstruction(dt) {
  $('construction-panel').hidden = !toolEquipped;
  if (!toolEquipped) { rallyPreview.visible = false; return; }
  if (!construction.blueprint) {
    $('construction-status').textContent = '右键选择集结点蓝图';
    $('construction-fill').style.width = '0';
    return;
  }
  const actorPosition = allies[current].model.position;
  camera.getWorldDirection(direction);
  const candidate = new THREE.Vector3(actorPosition.x, 0, actorPosition.z);
  const horizontal = new THREE.Vector3(direction.x, 0, direction.z).normalize();
  candidate.addScaledVector(horizontal, SPAWN_RULES.buildRange);
  candidate.y = world.groundHeight(candidate.x, candidate.z);
  if (construction.site && actorPosition.distanceTo(construction.anchor) > .7) {
    construction.site = construction.anchor = null;
    construction.progress = 0;
    toast('移动中止了建造，请重新选择位置');
  }
  const position = construction.site || candidate;
  const reason = rallyBuildBlockReason(position, objectives, hostilePositions('friendly'), world.obstacles);
  rallyPreview.visible = true;
  rallyPreview.position.copy(position);
  rallyPreview.traverse(mesh => { if (mesh.isMesh) mesh.material.color.setHex(reason ? 0xd46550 : 0x93c285); });
  if (mouseDown && !reason) {
    if (!construction.site) {
      construction.site = candidate.clone();
      construction.anchor = actorPosition.clone();
    }
    construction.progress += dt;
    $('construction-status').textContent = `正在建造集结点 · ${Math.floor(construction.progress / SPAWN_RULES.buildSeconds * 100)}%`;
    if (construction.progress >= SPAWN_RULES.buildSeconds) {
      completeRally('friendly', construction.site);
      resetConstruction();
      mouseDown = false;
    }
  } else {
    construction.progress = 0;
    construction.site = construction.anchor = null;
    $('construction-status').textContent = reason || '位置可用 · 按住左键建造';
  }
  $('construction-fill').style.width = `${construction.progress / SPAWN_RULES.buildSeconds * 100}%`;
}

function switchMember(index) {
  if (index === current || !allies[index] || allies[index].health <= 0) return;
  allies[current].model.visible = unit.type !== 'tank' && allies[current].health > 0;
  stopLocomotion(allies[current].locomotion);
  current = index;
  if (unit.type !== 'plane') unit.altitude = world.groundHeight(allies[current].model.position.x, allies[current].model.position.z);
  allies[current].model.scale.y = 1;
  if (allies[current].tactics.cover) coverClaims.delete(allies[current].tactics.cover.id);
  allies[current].tactics.cover = null;
  stopLocomotion(allies[current].locomotion);
  allies[current].model.visible = false;
  if (unit.type === 'infantry') {
    syncRifleUnit();
  }
  unit.nextShot = time + .35;
  recoil = 0;
  jumpHeight = jumpVelocity = 0;
  eyeHeight = unit.type === 'tank' ? 2.7 : stance === 'prone' ? .45 : stance === 'crouched' ? 1.05 : 1.67;
  resetConstruction();
  if (toolEquipped) equipTool(false);
  updateCamera(0);
  toast(`已切换至 ${index + 1} 号队员`);
}

function changeMember(index) {
  switchMember(index);
}

function syncRifleUnit() {
  if (unit.type !== 'infantry') return;
  const rifle = allies[current].rifle;
  unit.ammo = rifle.ammo;
  unit.reloadUntil = !toolEquipped && rifle.action === 'reload' ? time + RIFLE.reloadSeconds - rifle.elapsed : 0;
}

function reload() {
  if (unit.type === 'infantry') {
    if (toolEquipped) { toast('先按 1 收起工具再装填步枪'); return; }
    if (reloadRifle(allies[current].rifle)) toast('装填步枪 · 换人或使用工具会暂存动作进度', RIFLE.reloadSeconds);
    syncRifleUnit();
    return;
  }
  if (unit.reloadUntil || unit.ammo === TYPES[unit.type].magazine) return;
  unit.reloadUntil = time + TYPES[unit.type].reload;
  toast('正在装填…', TYPES[unit.type].reload);
}

function hasLine(from, to, maxDistance = 120) {
  vector.copy(to).sub(from);
  const distance = vector.length();
  if (distance > maxDistance) return false;
  ray.set(from, vector.normalize());
  ray.far = Math.max(0, distance - .04);
  const blocked = ray.intersectObjects(world.solids, false).length > 0;
  ray.far = Infinity;
  return !blocked;
}

function tracer(start, end, color = 0xffd49a, life = .08) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8 }));
  scene.add(line);
  effects.push({ object: line, end: time + life, life, kind: 'line' });
}

function impact(position, large = false) {
  const mesh = new THREE.Mesh(explosionGeometry, new THREE.MeshBasicMaterial({ color: large ? 0xffb85c : 0xd0ba86, transparent: true, opacity: .85, depthWrite: false }));
  mesh.position.copy(position);
  mesh.scale.setScalar(large ? 1.5 : .12);
  scene.add(mesh);
  effects.push({ object: mesh, end: time + (large ? .65 : .18), life: large ? .65 : .18, kind: large ? 'blast' : 'spark' });
}

function removeEffect(effect) {
  scene.remove(effect.object);
  if (effect.kind === 'line') effect.object.geometry.dispose();
  effect.object.material.dispose();
  effects.splice(effects.indexOf(effect), 1);
}

function hurt(actor, damage, source = 'player', weaponKind = 'rifle') {
  if (actor.health <= 0 || (state !== 'playing' && state !== 'dead')) return;
  const effectiveDamage = damageForTarget(weaponKind, actor.targetKind, damage);
  if (effectiveDamage === 0) {
    if (damage > 0 && weaponKind === 'rifle' && actor.targetKind === 'closed-armor') combatStats.rejectedRifleArmorDamage++;
    return;
  }
  damage = effectiveDamage;
  if (actor.friendly && actor.targetKind === 'closed-armor' && unit.type === 'tank') {
    damageTank(damage);
    return;
  }
  actor.health = Math.max(0, actor.health - damage);
  actor.tactics.suppressedUntil = time + 4;
  if (actor.friendly && allies[current] === actor) {
    damageFlash = .65;
    if (actor.health > 0) return;
    if (allies.length > 1) {
      const next = nextAlive(allies, current);
      if (next >= 0) {
        changeMember(next);
        toast('当前队员阵亡 · 已切换至仍可战斗的队员', 4);
      } else showOverlay('dead');
    } else showOverlay('dead');
  }
  if (actor.health === 0) {
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.deathTime = time;
    actor.model.visible = true;
    actor.model.rotation.z = Math.PI / 2;
    actor.model.position.y = world.groundHeight(actor.model.position.x, actor.model.position.z) + .3;
    if (!actor.friendly) {
      if (source === 'player') kills++;
      else if (source === 'ally') teamKills++;
      markerUntil = time + .25;
      feed.unshift({ text: `${source === 'ally' ? '友军' : '你'}　›　日军守兵`, until: time + 5 });
      feed.length = Math.min(feed.length, 4);
    }
  }
}

function damageTank(damage) {
  const previousHealth = unit.vehicleHealth;
  unit.vehicleHealth = Math.max(0, previousHealth - damage);
  damageFlash = .5;
  if (!unit.vehicleHealth) {
    allies.forEach(actor => { actor.health = 0; actor.model.visible = false; });
    impact(vehicle.position.clone().add(new THREE.Vector3(0, 1.5, 0)), true);
    showOverlay('dead');
    return;
  }
  // Hull damage can remove crew, but changing seats never restores the hull.
  const lostCrew = Math.floor((TYPES.tank.health - unit.vehicleHealth) / 120);
  const alreadyLost = allies.filter(actor => actor.health <= 0).length;
  if (lostCrew > alreadyLost && allies.filter(actor => actor.health > 0).length > 1) {
    allies[current].health = 0;
    allies[current].model.visible = false;
    changeMember(nextAlive(allies, current));
    toast('车组成员阵亡 · 已接管存活车组成员', 4);
  }
}

function explode(position, damage, radius, source = 'player') {
  // A blast can auto-switch crew seats; keep one hull recipient for this explosion.
  const hullRecipient = unit.type === 'tank' ? allies[current] : null;
  impact(position, true);
  sound('blast');
  for (const actor of [...enemies, ...allies]) {
    if (actor.health <= 0) continue;
    if (actor.friendly && unit.type === 'tank' && actor !== hullRecipient) continue;
    const target = actor.model.position.clone();
    target.y = actor === allies[current] ? unit.altitude + 1 : actor.model.position.y + 1;
    const d = target.distanceTo(position);
    // Walls shield units from blast; raise the ray above ground to avoid self-occlusion.
    const origin = position.clone();
    origin.y = Math.max(origin.y, .5);
    if (d < radius && hasLine(origin, target, radius + 1)) hurt(actor, blastDamage(d, radius, damage), source, 'explosion');
  }
  for (const point of spawnPoints.filter(point => point.kind === 'rally' && point.health > 0)) {
    const target = new THREE.Vector3(point.x, point.altitude + .8, point.z);
    const distance = target.distanceTo(position);
    const origin = position.clone();
    origin.y = Math.max(.5, origin.y);
    if (distance < radius && hasLine(origin, target, radius + 1)) damageRally(point, blastDamage(distance, radius, damage));
  }
}

function fire() {
  const motion = allies[current].locomotion;
  if ((unit.type === 'infantry' || unit.type === 'mortar') && (motion.sprinting || motion.aimRecovery > 0)) return;
  if (unit.type === 'infantry') {
    if (time < unit.nextShot) return;
    if (weaponObstruction > 0 || obstructionBlend > .03) { toast('枪口受阻 · 后退或移开枪口'); return; }
    if (!shootRifle(allies[current].rifle)) { syncRifleUnit(); return; }
    syncRifleUnit();
  } else if (!shotState(unit, time, true)) return;
  sound(unit.type === 'tank' || unit.type === 'mortar' ? 'blast' : 'shot');
  combatSounds.push({ id: ++soundSerial, friendly: true, x: camera.position.x, y: camera.position.y, z: camera.position.z, time, radius: unit.type === 'infantry' ? 55 : 85 });
  if (combatSounds.length > 32) combatSounds.shift();
  recoil = unit.type === 'tank' ? .12 : .05;
  camera.getWorldDirection(direction);
  const start = camera.position.clone();
  if (unit.type === 'mortar') {
    const target = getMortarTarget();
    const mesh = new THREE.Mesh(projectileGeometry, shellMaterial);
    mesh.position.copy(start);
    scene.add(mesh);
    shells.push({ mesh, start, target: target.clone(), elapsed: 0, duration: 1.6 + target.distanceTo(start) / 35, damage: TYPES.mortar.damage });
  } else {
    ray.set(start, direction);
    ray.far = unit.type === 'plane' ? 260 : 180;
    const targets = [...world.solids, ...enemies.filter(e => e.health > 0).map(e => e.model), ...spawnPoints.filter(point => point.kind === 'rally' && point.health > 0).map(point => point.model)];
    let hit = ray.intersectObjects(targets, true)[0];
    const end = hit ? hit.point : start.clone().addScaledVector(direction, ray.far);
    const muzzle = unit.type === 'infantry' ? weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(.28, -.25, -1.25).applyMatrix4(camera.matrixWorld);
    if (unit.type === 'infantry') {
      // Aim at the sight ray's target, but resolve the shot from the physical muzzle.
      const travel = end.clone().sub(muzzle);
      if (travel.dot(direction) <= 0) travel.copy(direction);
      ray.set(muzzle, travel.normalize()); ray.far = 180;
      hit = ray.intersectObjects(targets, true)[0];
      end.copy(hit ? hit.point : muzzle.clone().addScaledVector(travel, ray.far));
      lastRifleTrace = { start: muzzle.toArray(), end: end.toArray(), time, hit: Boolean(hit), doorId: hit?.object.userData.doorIds?.[hit.instanceId] || null };
    }
    tracer(muzzle, end);
    for (const enemy of enemies) {
      if (enemy.health > 0 && pointSegmentDistance(enemy.model.position, muzzle, end).distance < 2.2) {
        enemy.tactics.suppressedUntil = time + 3;
        enemy.tactics.decisionAt = Math.min(enemy.tactics.decisionAt, time);
      }
    }
    if (unit.type === 'tank') {
      if (hit?.object.userData.actor) hurt(hit.object.userData.actor, TYPES.tank.damage, 'player', 'cannon');
      if (hit?.object.userData.spawnPoint) damageRally(hit.object.userData.spawnPoint, TYPES.tank.damage);
      explode(end, TYPES.tank.damage, 11);
    } else if (hit) {
      impact(end);
      if (hit.object.userData.actor) {
        hurt(hit.object.userData.actor, TYPES[unit.type].damage, 'player', unit.type === 'plane' ? 'aircraft-gun' : 'rifle');
        markerUntil = time + .2;
      }
      if (hit.object.userData.spawnPoint) damageRally(hit.object.userData.spawnPoint, TYPES[unit.type].damage);
    }
    ray.far = Infinity;
  }
}

function getMortarTarget() {
  camera.getWorldDirection(direction);
  ray.set(camera.position, direction);
  const intersection = ray.ray.intersectPlane(groundPlane, mortarTarget);
  if (!intersection || mortarTarget.distanceTo(camera.position) > 85) {
    mortarTarget.copy(direction);
    mortarTarget.y = 0;
    mortarTarget.normalize().multiplyScalar(85).add(camera.position);
    mortarTarget.y = .1;
  }
  mortarTarget.x = THREE.MathUtils.clamp(mortarTarget.x, -105, 105);
  mortarTarget.z = THREE.MathUtils.clamp(mortarTarget.z, -105, 105);
  mortarTarget.y = world.groundHeight(mortarTarget.x, mortarTarget.z) + .15;
  return mortarTarget;
}

const mortarMarker = new THREE.Mesh(new THREE.RingGeometry(.6, .85, 24), new THREE.MeshBasicMaterial({ color: 0xffd18a, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .8 }));
mortarMarker.rotation.x = -Math.PI / 2;
mortarMarker.visible = false;
scene.add(mortarMarker);

function updatePlayer(dt) {
  const settings = TYPES[unit.type];
  const actor = allies[current];
  const position = actor.model.position;
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const sideways = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = actor.locomotion;
  const holdingBreath = unit.type === 'infantry' && aiming && motion.aimRecovery === 0 && keys.has('ShiftLeft') && breath > .05;
  breath = THREE.MathUtils.clamp(breath + (holdingBreath ? -dt / 6 : dt / 4), 0, 1);
  const speed = settings.speed;
  if (unit.type === 'plane') {
    unit.throttle = THREE.MathUtils.clamp(unit.throttle + forward * dt * .35, .6, 1.5);
    yaw -= sideways * dt * .7;
    const flightSpeed = settings.speed * unit.throttle;
    position.x -= Math.sin(yaw) * flightSpeed * dt * Math.cos(pitch);
    position.z -= Math.cos(yaw) * flightSpeed * dt * Math.cos(pitch);
    unit.altitude += Math.sin(pitch) * flightSpeed * dt;
    if (keys.has('Space')) unit.altitude += dt * 9;
    if (keys.has('ControlLeft')) unit.altitude -= dt * 9;
    unit.altitude = Math.min(unit.altitude, 90);
    const colliding = world.obstacles.some(b => position.x > b.minX - 1 && position.x < b.maxX + 1 && position.z > b.minZ - 1 && position.z < b.maxZ + 1 && unit.altitude < b.height + 1);
    if (unit.altitude < 1.8 || colliding) {
      hurt(actor, actor.health, 'crash', 'collision');
      return;
    }
    if (Math.abs(position.x) > 170 || Math.abs(position.z) > 170) {
      outsideTime += dt;
      toast(`请返回作战区域 · ${Math.max(0, Math.ceil(10 - outsideTime))} 秒后失去飞机`, 1);
      if (outsideTime >= 10) hurt(actor, actor.health, 'crash', 'collision');
    } else outsideTime = 0;
  } else if (unit.type === 'tank') {
    unit.heading -= sideways * dt * .8;
    const dx = -Math.sin(unit.heading) * forward * speed * dt;
    const dz = -Math.cos(unit.heading) * forward * speed * dt;
    moveGround(position, dx, dz, 1.9, world.obstacles);
    for (const crew of allies) if (crew !== actor) crew.model.position.copy(position);
  } else {
    const steps = advanceLocomotion(motion, position, {
      type: unit.type, forward, sideways, yaw, stance, aiming,
      sprint: keys.has('ShiftLeft'), walking: keys.has('KeyC'),
      grounded: jumpHeight === 0 && jumpVelocity === 0,
      busy: unit.reloadUntil > time || (unit.type === 'infantry' && actor.rifle.action !== 'idle') || construction.blueprint || mouseDown,
    }, world.obstacles, dt);
    for (let i = 0; i < steps; i++) footstep(position, motion.speed);
  }
  if (foot) {
    if (jumpHeight > 0 || jumpVelocity > 0) {
      jumpVelocity -= 15 * dt;
      jumpHeight = Math.max(0, jumpHeight + jumpVelocity * dt);
      if (!jumpHeight) {
        landLocomotion(motion, jumpVelocity);
        footstep(position, motion.speed, true);
        jumpVelocity = 0;
      }
    }
  }
  if (unit.type !== 'plane') {
    unit.altitude = world.groundHeight(position.x, position.z);
    position.y = unit.altitude;
    if (unit.type === 'tank') for (const crew of allies) crew.model.position.copy(position);
  }
  actor.model.rotation.y = yaw;
  if (vehicle) {
    vehicle.position.copy(position);
    vehicle.position.y = unit.altitude;
    vehicle.rotation.y = unit.type === 'tank' ? unit.heading : yaw;
    if (unit.type === 'tank') vehicle.userData.turret.rotation.y = yaw - unit.heading;
    else {
      vehicle.rotation.x = pitch;
      vehicle.rotation.z = -sideways * .2;
    }
  }
  if (unit.type === 'infantry') {
    if (!toolEquipped) for (const cue of advanceRifle(actor.rifle, dt)) {
      if (cue !== 'ready') mechanicalSound(cue);
    }
    syncRifleUnit();
  } else shotState(unit, time, false);
  // Movement, stance, lean and mouse aim must be current before muzzle clearance/fire.
  updateCamera(dt);
  if (toolEquipped) updateConstruction(dt);
  else if (mouseDown) fire();
}

function updateCamera(dt) {
  if (!allies[current] || !unit) return;
  const position = allies[current].model.position;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = allies[current].locomotion;
  const desiredHeight = foot ? stance === 'prone' ? .45 : stance === 'crouched' ? 1.05 : 1.67 : unit.type === 'tank' ? 2.7 : 1.67;
  eyeHeight = THREE.MathUtils.lerp(eyeHeight, desiredHeight, 1 - Math.exp(-dt * 12));
  const desiredLean = foot ? (Number(keys.has('KeyE')) - Number(keys.has('KeyQ'))) * .23 : 0;
  const offsetX = Math.cos(yaw) * desiredLean;
  const offsetZ = -Math.sin(yaw) * desiredLean;
  const safeLean = foot && circleBlocked(position.x + offsetX, position.z + offsetZ, .35, world.obstacles) ? 0 : desiredLean;
  lean = THREE.MathUtils.lerp(lean, safeLean, Math.min(1, dt * 12));
  const cameraSway = foot ? motion.cameraX * motionStrength : 0;
  camera.position.set(position.x + Math.cos(yaw) * (lean + cameraSway), unit.altitude + eyeHeight + jumpHeight + (foot ? (motion.cameraY + motion.landing) * motionStrength : 0), position.z - Math.sin(yaw) * (lean + cameraSway));
  const holdingBreath = unit.type === 'infantry' && aiming && motion.aimRecovery === 0 && keys.has('ShiftLeft') && breath > .05;
  const sway = unit.type === 'infantry' && aiming ? Math.sin(time * 2.1) * (holdingBreath ? .00025 : .0016) : 0;
  camera.rotation.set(pitch + recoil + sway, yaw, -lean * .35 + (foot ? motion.cameraRoll * motionStrength : 0));
  recoil = Math.max(0, recoil - dt * .3);
  const rifleReloading = unit.type === 'infantry' && allies[current].rifle.action === 'reload';
  const effectiveAim = aiming && !toolEquipped && !rifleReloading && weaponObstruction === 0 && obstructionBlend < .03 && (!foot || motion.aimRecovery === 0);
  const desiredFov = effectiveAim && (unit.type === 'infantry' || unit.type === 'tank') ? 48 : unit.type === 'plane' ? 82 : 72;
  camera.fov = THREE.MathUtils.lerp(camera.fov, desiredFov, Math.min(1, dt * 12));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  if (weapon) {
    const aim = effectiveAim && unit.type === 'infantry';
    const response = 1 - Math.exp(-dt * 15);
    if (unit.type === 'infantry' && !toolEquipped) {
      const pose = updateRifleModel(weapon, allies[current].rifle);
      const swayScale = aim ? .025 : 1;
      const targetX = (aim ? 0 : .18) + motion.weaponX * swayScale;
      const targetY = (aim ? -RIFLE.sightHeight : -.22) + motion.weaponY * swayScale - pose.lower * .045;
      const targetZ = (aim ? -.2 : -.14) + pose.recoil * .035 + motion.sprintBlend * .08;
      const base = weapon.userData.basePosition ??= weapon.position.clone();
      base.x = THREE.MathUtils.lerp(base.x, targetX, response);
      base.y = THREE.MathUtils.lerp(base.y, targetY, response);
      base.z = THREE.MathUtils.lerp(base.z, targetZ, response);
      weapon.position.copy(base);
      weapon.rotation.set(motion.weaponPitch * swayScale - pose.lower * .14, 0, -motion.sprintBlend * .12 - pose.lower * .08);
      weapon.updateMatrixWorld(true);
      // Test the intended shoulder-to-muzzle segment, not the already-retracted gun.
      const start = new THREE.Vector3(targetX, targetY, -.1).applyMatrix4(camera.matrixWorld);
      const intendedMuzzle = new THREE.Vector3(targetX, targetY, targetZ - .891).applyMatrix4(camera.matrixWorld);
      const length = start.distanceTo(intendedMuzzle);
      ray.set(start, intendedMuzzle.clone().sub(start).normalize()); ray.far = length + .08;
      const blocked = ray.intersectObjects(world.solids, false)[0];
      // A parallel camera ray prevents a lateral stock offset from missing a corner.
      ray.set(camera.position, camera.getWorldDirection(new THREE.Vector3())); ray.far = length + .18;
      const centerBlocked = ray.intersectObjects(world.solids, false)[0];
      const nearest = Math.min(blocked?.distance ?? Infinity, centerBlocked?.distance ?? Infinity);
      weaponObstruction = Math.max(0, Math.min(1, (length + .08 - nearest) / .75));
      obstructionBlend = THREE.MathUtils.lerp(obstructionBlend, weaponObstruction, 1 - Math.exp(-dt * 20));
      // Retract immediately on approach; smooth the release without pushing through a wall.
      const retract = Math.max(weaponObstruction, obstructionBlend);
      weapon.position.z += retract * .72;
      weapon.position.y -= retract * .12;
      weapon.rotation.x -= retract * .55;
      updateRifleArms(weapon);
      weapon.updateMatrixWorld(true);
      ray.far = Infinity;
    } else {
      weaponObstruction = obstructionBlend = 0;
      weapon.position.x = THREE.MathUtils.lerp(weapon.position.x, foot ? motion.weaponX : 0, response);
      weapon.position.y = THREE.MathUtils.lerp(weapon.position.y, foot ? motion.weaponY : 0, response);
      weapon.position.z = recoil * 1.5 + (foot ? motion.sprintBlend * .08 : 0);
      weapon.rotation.x = (toolEquipped && construction.progress > 0 ? Math.sin(time * 18) * .35 : unit.reloadUntil ? Math.sin(time * 4) * .14 - .3 : 0) + (foot ? motion.weaponPitch : 0);
      weapon.rotation.z = foot ? -motion.sprintBlend * .12 : 0;
    }
  }
  $('crosshair').hidden = effectiveAim && unit.type === 'infantry';
}

function squadCommand(follow) {
  if (unit.type !== 'infantry' && unit.type !== 'mortar') return;
  updateCamera(0);
  camera.getWorldDirection(direction);
  ray.set(camera.position, direction);
  ray.far = 65;
  const hit = ray.intersectObjects(world.solids, false)[0];
  ray.far = Infinity;
  const target = hit ? hit.point : camera.position.clone().addScaledVector(direction, 45);
  const objective = objectives.find(p => !p.captured);
  const attack = objective && Math.hypot(target.x - objective.x, target.z - objective.z) < objective.radius;
  for (const actor of allies) {
    actor.order = follow ? 'follow' : attack ? 'advance' : 'hold';
    actor.orderPoint = { x: THREE.MathUtils.clamp(target.x, -100, 100), z: THREE.MathUtils.clamp(target.z, -100, 100) };
    actor.path = null;
    actor.tactics.decisionAt = 0;
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.tactics.cover = null;
  }
  toast(follow ? '小队命令：取消命令，跟随我' : attack ? '小队命令：进攻当前据点' : '小队命令：移动并守住标记位置');
}
function walkActor(actor, target, speed, dt) {
  const pos = actor.model.position;
  if (!actor.path || time >= actor.nextPath || !actor.pathGoal || Math.hypot(actor.pathGoal.x - target.x, actor.pathGoal.z - target.z) > .75) {
    actor.path = navigate(pos, target);
    actor.pathGoal = { x: target.x, z: target.z };
    actor.nextPath = time + 1.8;
  }
  while (actor.path.length && Math.hypot(actor.path[0].x - pos.x, actor.path[0].z - pos.z) < .1) actor.path.shift();
  const waypoint = actor.path[0];
  if (!waypoint) return;
  const waitingDoor = world.doorSystem.openAhead(pos, waypoint);
  if (waitingDoor) {
    actor.tactics.mode = 'open-door';
    actor.tactics.blockedBy = 'door';
    if (waitingDoor.blocked) {
      const hx = waitingDoor.x - (waitingDoor.axis === 'x' ? waitingDoor.width / 2 : 0);
      const hz = waitingDoor.z - (waitingDoor.axis === 'z' ? waitingDoor.width / 2 : 0);
      const dx = pos.x - hx, dz = pos.z - hz, distance = Math.max(.01, Math.hypot(dx, dz));
      moveGround(pos, dx / distance * dt * 1.8, dz / distance * dt * 1.8, .42, world.obstacles);
    }
    return;
  }
  const dx = waypoint.x - pos.x;
  const dz = waypoint.z - pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .05) return;
  actor.tactics.blockedBy = null;
  for (const other of [...allies, ...enemies]) {
    if (other === actor || other.health <= 0 || (other.friendly && unit.type === 'tank')) continue;
    const near = Math.hypot(other.model.position.x - pos.x, other.model.position.z - pos.z);
    const ahead = (other.model.position.x - pos.x) * dx / distance + (other.model.position.z - pos.z) * dz / distance;
    if (near < .92 && ahead > .15 && (other === allies[current] || actor.tactics.id > other.tactics.id)) {
      actor.tactics.blockedBy = other.tactics.id;
      return;
    }
  }
  const step = Math.min(speed * dt, distance);
  const beforeX = pos.x;
  const beforeZ = pos.z;
  moveGround(pos, dx / distance * step, dz / distance * step, .42, world.obstacles);
  if (Math.hypot(pos.x - beforeX, pos.z - beforeZ) < step * .3) {
    const side = actor.index % 2 ? -1 : 1;
    moveGround(pos, -dz / distance * step * side, dx / distance * step * side, .42, world.obstacles);
  }
  actor.model.rotation.y = Math.atan2(-dx, -dz);
  pos.y = world.groundHeight(pos.x, pos.z);
  actor.walkPhase += dt * speed * 2.5;
  const [left, right] = actor.model.userData.legs;
  left.rotation.x = Math.sin(actor.walkPhase) * .35;
  right.rotation.x = -left.rotation.x;
}

function fightFromCover(actor, target, dt) {
  const t = actor.tactics, position = actor.model.position;
  const armorThreat = (target?.targetKind || t.threatKind) === 'closed-armor';
  const threat = target ? target.model.position.clone() : new THREE.Vector3(t.lastSeen.x, t.lastSeen.y, t.lastSeen.z);
  if (target) threat.y = target === allies[current] ? unit.altitude + 1.1 : target.model.position.y + 1.1;
  if (time >= t.decisionAt) {
    t.decisionAt = time + 2.3 + t.slot * .17;
    const chosen = selectCover({
      state: t, position, threat,
      slots: actor.friendly && actor.order === 'hold' ? world.town.covers.filter(slot => Math.hypot(slot.x - actor.orderPoint.x, slot.z - actor.orderPoint.z) < 7) : world.town.covers,
      claims: coverClaims, now: time,
      blocked: point => circleBlocked(point.x, point.z, .46, world.obstacles),
      protectedAt: point => !hasLine(threat, new THREE.Vector3(point.x, 1.1, point.z), 90),
      seesTarget: point => hasLine(new THREE.Vector3(point.x, 1.3, point.z), threat, 90),
      pathTo: point => navigate(position, point),
    });
    if (chosen) {
      const changed = t.cover?.id !== chosen.cover.id;
      t.cover = chosen.cover;
      if (changed) { t.enteredCover = false; actor.path = chosen.path; actor.nextPath = time + 1.8; }
    } else if (t.cover && !hasLine(threat, new THREE.Vector3(t.cover.x, 1.1, t.cover.z), 90)) {
      coverClaims.set(t.cover.id, { owner: t.id, until: time + 7 });
    } else {
      if (t.cover) coverClaims.delete(t.cover.id);
      t.cover = null;
    }
  }
  let mayFire = true;
  if (t.cover) {
    coverClaims.set(t.cover.id, { owner: t.id, until: time + 7 });
    if (!t.enteredCover && Math.hypot(t.cover.x - position.x, t.cover.z - position.z) < .28) {
      t.enteredCover = true; t.arrivedAt = time;
    }
    const exposed = !armorThreat && t.enteredCover && peekTurn(t, time);
    const goal = exposed ? t.cover.peek : t.cover;
    const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
    t.mode = armorThreat ? distance > .25 ? 'evade-armor' : 'cover-from-armor' : distance > .25 ? 'take-cover' : exposed ? 'peek' : 'cover';
    mayFire = exposed && distance < .35;
    if (distance > .15) walkActor(actor, goal, 1.8, dt);
  } else {
    const distance = position.distanceTo(threat);
    t.mode = distance > 24 ? 'advance-under-cover' : 'engage';
    if (armorThreat) {
      t.mode = 'armor-alert';
      if (time >= (t.retreatAt || 0)) {
        t.retreatAt = time + 2;
        t.retreatPoint = rifleArmorResponse(position, threat, point => circleBlocked(point.x, point.z, .46, world.obstacles));
      }
      if (t.retreatPoint && Math.hypot(t.retreatPoint.x - position.x, t.retreatPoint.z - position.z) > .5) {
        t.mode = 'evade-armor';
        walkActor(actor, t.retreatPoint, 2.6, dt);
      }
      mayFire = false;
    } else if (actor.friendly && actor.order === 'hold') {
      const goal = { x: actor.orderPoint.x + (actor.index % 2 ? -1.2 : 1.2), z: actor.orderPoint.z + Math.floor(actor.index / 2) * 1.5 };
      if (Math.hypot(goal.x - position.x, goal.z - position.z) > .4) walkActor(actor, goal, 2.4, dt);
    } else if (distance > 24 && t.slot % 2 === Math.floor(time / 2.6) % 2) {
      const angle = Math.atan2(threat.z - position.z, threat.x - position.x);
      const flank = { x: threat.x - Math.cos(angle) * 18 + Math.sin(angle) * (t.slot % 2 ? 5 : -5), z: threat.z - Math.sin(angle) * 18 - Math.cos(angle) * (t.slot % 2 ? 5 : -5) };
      walkActor(actor, flank, 2.2, dt);
    }
  }
  actor.model.rotation.y = Math.atan2(position.x - threat.x, position.z - threat.z);
  const from = position.clone().add(new THREE.Vector3(0, 1.39 * actor.model.scale.y, 0));
  if (!target || !mayFire || !canWeaponDamageTarget('rifle', target.targetKind) || time < actor.nextFire || !hasLine(from, threat, 75)) return;
  const nearbyFriend = (actor.friendly ? allies : enemies).some(other => {
    if (other === actor || other.health <= 0) return false;
    const segment = pointSegmentDistance(other.model.position, position, threat);
    return segment.fraction > .03 && segment.fraction < .97 && segment.distance < .55;
  });
  if (nearbyFriend) return;
  actor.model.updateMatrixWorld(true);
  const muzzle = new THREE.Vector3(.13, 1.39, actor.friendly ? -.871 : -1.07).applyMatrix4(actor.model.matrixWorld);
  if (!hasLine(from, muzzle, 2) || !hasLine(muzzle, threat, 75)) return;
  actor.nextFire = time + (actor.friendly ? 1.1 : 1.8) + Math.random() * 1.6;
  combatStats.aiRifleShots++;
  if (target.targetKind === 'closed-armor') combatStats.aiRifleShotsAtArmor++;
  tracer(muzzle, threat, actor.friendly ? 0xf6d399 : 0xdfb17a);
  combatSounds.push({ id: ++soundSerial, friendly: actor.friendly, x: muzzle.x, y: muzzle.y, z: muzzle.z, time, radius: 40 });
  if (combatSounds.length > 32) combatSounds.shift();
  const accuracy = (actor.friendly ? .5 : .24) * Math.max(.25, 1 - from.distanceTo(threat) / 100) * (time < t.suppressedUntil ? .55 : 1);
  if (Math.random() < accuracy) hurt(target, actor.friendly ? 55 : 17, actor.friendly ? 'ally' : 'enemy', 'rifle');
}

function updateAI(dt) {
  const player = allies[current];
  const objective = objectives.find(p => !p.captured);
  if (!objective) return;
  for (const actor of [...enemies, ...allies]) {
    if (actor.health <= 0 || actor === player) continue;
    if (actor.friendly) recoverLocomotion(actor.locomotion, dt);
    if (actor.friendly && unit.type === 'tank') continue;
    const position = actor.model.position;
    position.y = world.groundHeight(position.x, position.z);
    const tactics = actor.tactics;
    const from = position.clone().add(new THREE.Vector3(0, 1.45, 0));
    if (time >= actor.nextThink) {
      actor.nextThink = time + .35 + Math.random() * .15;
      const candidates = actor.friendly ? enemies : allies;
      let closest = 75;
      actor.target = null;
      for (const candidate of candidates) {
        if (candidate.health <= 0) continue;
        const to = candidate.model.position.clone();
        to.y = candidate === player ? unit.altitude + 1.1 : candidate.model.position.y + 1.1;
        const distance = from.distanceTo(to);
        const angle = Math.atan2(position.x - to.x, position.z - to.z);
        const inView = distance < 9 || Math.cos(angle - actor.model.rotation.y) > .25 || time < tactics.suppressedUntil;
        if (inView && distance < closest && hasLine(from, to, 75)) {
          closest = distance;
          actor.target = candidate;
        }
      }
      if (actor.target) {
        const seen = actor.target.model.position.clone();
        seen.y = actor.target === player ? unit.altitude + 1.1 : actor.target.model.position.y + 1.1;
        rememberThreat(tactics, seen, time, actor.target.targetKind);
        if (actor.target.targetKind === 'closed-armor') combatStats.armorThreatsObserved++;
      } else {
        for (const heard of [...combatSounds].reverse()) {
          if (heard.friendly === actor.friendly || time - heard.time > 2 || heard.id <= (tactics.lastSound || 0)) continue;
          const audible = hasLine(from, new THREE.Vector3(heard.x, heard.y, heard.z), 90) ? heard.radius : heard.radius * .45;
          if (Math.hypot(heard.x - position.x, heard.z - position.z) < audible) {
            tactics.lastSound = heard.id;
            rememberThreat(tactics, { x: heard.x + Math.sin(tactics.id) * 2, y: heard.y, z: heard.z + Math.cos(tactics.id) * 2 }, time);
            tactics.forgetAt = time + 3;
            break;
          }
        }
      }
      const previousCover = tactics.cover;
      if (expireThreat(tactics, time) && previousCover) coverClaims.delete(previousCover.id);
    }
    const target = actor.target?.health > 0 ? actor.target : null;
    const hostileRally = !actor.friendly && !target ? spawnPoints.find(point => point.team === 'friendly' && point.kind === 'rally' && point.health > 0 && Math.hypot(point.x - position.x, point.z - position.z) < 40 && hasLine(from, new THREE.Vector3(point.x, .8, point.z), 40)) : null;
    if (target) {
      actor.buildProgress = 0;
      fightFromCover(actor, target, dt);
    } else if (tactics.lastSeen) {
      if (tactics.cover || tactics.threatKind === 'closed-armor') fightFromCover(actor, null, dt);
      else {
        tactics.mode = 'search';
        if (actor.friendly && actor.order === 'hold') {
          walkActor(actor, { x: actor.orderPoint.x + (actor.index % 2 ? -1.2 : 1.2), z: actor.orderPoint.z + Math.floor(actor.index / 2) * 1.5 }, 2.4, dt);
        } else if (Math.hypot(position.x - tactics.lastSeen.x, position.z - tactics.lastSeen.z) > 3 && (tactics.slot % 2 === Math.floor(time / 2.6) % 2)) walkActor(actor, tactics.lastSeen, 2.3, dt);
      }
    } else if (hostileRally) {
      const targetPosition = new THREE.Vector3(hostileRally.x, .8, hostileRally.z);
      actor.model.rotation.y = Math.atan2(position.x - hostileRally.x, position.z - hostileRally.z);
      if (time >= actor.nextFire) {
        actor.nextFire = time + 1.4;
        tracer(from, targetPosition, 0xdfb17a);
        damageRally(hostileRally, 15);
      }
    } else if (actor.friendly) {
      tactics.mode = actor.order === 'hold' ? 'hold' : 'follow';
      if (actor.order === 'hold') {
        walkActor(actor, { x: actor.orderPoint.x + (actor.index % 2 ? -1.2 : 1.2), z: actor.orderPoint.z + Math.floor(actor.index / 2) * 1.5 }, 3, dt);
      } else if (actor.order === 'advance') {
        if (Math.hypot(position.x - objective.x, position.z - objective.z) > 5) walkActor(actor, { x: objective.x + (actor.index - 2) * 2, z: objective.z + 3 }, 3, dt);
      } else if (position.distanceTo(player.model.position) > 4 + actor.index) {
        walkActor(actor, { x: player.model.position.x + (actor.index % 2 ? -2 : 2), z: player.model.position.z + 3 }, 4.2, dt);
      }
    } else if (actor.role === 'engineer' && !spawnPoints.some(point => point.team === 'enemy' && point.kind === 'rally' && point.health > 0)) {
      tactics.mode = 'engineer';
      const buildSite = { x: -48, z: -53 };
      if (Math.hypot(position.x - buildSite.x, position.z - buildSite.z) > 1.3) walkActor(actor, buildSite, 3.4, dt);
      else {
        const reason = rallyBuildBlockReason(buildSite, objectives, hostilePositions('enemy'), world.obstacles);
        actor.buildProgress = reason ? 0 : actor.buildProgress + dt;
        if (actor.buildProgress >= SPAWN_RULES.buildSeconds) {
          completeRally('enemy', buildSite);
          actor.buildProgress = 0;
        }
      }
    } else {
      tactics.mode = 'advance';
      const goal = advancePosition(tactics, position, objective);
      if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7) walkActor(actor, goal, 3, dt);
    }
    for (const other of [...allies, ...enemies]) {
      if (other === actor || other.health <= 0 || (other.friendly && unit.type === 'tank')) continue;
      const dx = position.x - other.model.position.x;
      const dz = position.z - other.model.position.z;
      const distance = Math.hypot(dx, dz);
      const spacing = other === player ? 1.65 : 1.15;
      if (distance < spacing) {
        const angle = distance > .01 ? Math.atan2(dz, dx) : tactics.id * 2;
        const push = Math.min(.06, (spacing - distance) * dt * 3);
        moveGround(position, Math.cos(angle) * push, Math.sin(angle) * push, .42, world.obstacles);
      }
    }
    position.y = world.groundHeight(position.x, position.z);
    if (state !== 'playing' && state !== 'dead') break;
  }
  if (time >= waveAt && enemies.filter(actor => actor.health > 0).length < 13) {
    waveAt = time + SPAWN_RULES.waveInterval;
    spawnEnemySquad(Math.min(4, 13 - enemies.filter(actor => actor.health > 0).length));
  }
  enemies = enemies.filter(actor => {
    if (actor.health <= 0 && time - actor.deathTime > 12) {
      scene.remove(actor.model);
      return false;
    }
    return true;
  });
}

function updateObjectives(dt) {
  const active = objectives.find(p => !p.captured);
  if (!active) return;
  const inRadius = actor => Math.hypot(actor.model.position.x - active.x, actor.model.position.z - active.z) < active.radius && actor.health > 0;
  const friendly = allies.some(actor => inRadius(actor) && !(actor === allies[current] && unit.type === 'plane'));
  const hostile = enemies.some(inRadius);
  const status = advanceCapture(active, dt, friendly, hostile);
  $('objective-help').textContent = status === 'contested' ? '据点争夺中 · 清除范围内守军' : status === 'capturing' ? '正在占领 · 保持阵地 12 秒' : unit.type === 'plane' ? '航空支援 · 无法空中占领据点' : '进入据点范围并清除守军';
  $('capture-fill').style.width = `${active.progress * 100}%`;
  if (active.captured) {
    world.flags[objectives.indexOf(active)].material.color.setHex(0x70865d);
    toast(`${active.id} · ${active.name} 已占领！`, 4);
    if (objectives.every(p => p.captured)) showOverlay('victory');
  }
}

function updateEffects(dt) {
  for (const shell of [...shells]) {
    shell.elapsed += dt;
    const fraction = Math.min(1, shell.elapsed / shell.duration);
    const previous = shell.mesh.position.clone();
    shell.mesh.position.lerpVectors(shell.start, shell.target, fraction);
    shell.mesh.position.y += Math.sin(fraction * Math.PI) * (12 + shell.start.distanceTo(shell.target) * .22);
    vector.copy(shell.mesh.position).sub(previous);
    const travel = vector.length();
    ray.set(previous, vector.normalize());
    ray.far = travel;
    const hit = travel > .001 ? ray.intersectObjects(world.solids, false)[0] : null;
    ray.far = Infinity;
    if (hit || fraction >= 1) {
      explode(hit ? hit.point : shell.target, shell.damage, 13);
      scene.remove(shell.mesh);
      shells.splice(shells.indexOf(shell), 1);
    }
  }
  for (const effect of [...effects]) {
    if (time >= effect.end) {
      removeEffect(effect);
      continue;
    }
    const t = 1 - (effect.end - time) / effect.life;
    effect.object.material.opacity = (1 - t) * .8;
    if (effect.kind === 'blast') {
      effect.object.scale.setScalar(1 + t * 8);
      effect.object.position.y += dt * 2;
      effect.object.material.color.lerp(new THREE.Color(0x53574a), dt * 5);
    }
  }
  damageFlash = Math.max(0, damageFlash - dt * .65);
  $('damage-vignette').style.opacity = String(damageFlash);
  $('hit-marker').style.opacity = time < markerUntil ? '1' : '0';
  if (time >= toastUntil) $('toast').style.opacity = '0';
  mortarMarker.visible = state === 'playing' && unit.type === 'mortar';
  if (mortarMarker.visible) {
    mortarMarker.position.copy(getMortarTarget());
    $('aim-label').textContent = `弹着点 · ${Math.round(mortarMarker.position.distanceTo(camera.position))} 米`;
  }
}

function drawRadar(ctx = radarContext) {
  const size = 176;
  const map = (x, z) => [(x + 110) / 220 * size, (z + 110) / 220 * size];
  ctx.fillStyle = '#273328';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#a8b09316';
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  ctx.fillStyle = '#5a6c66';
  ctx.fillRect(0, map(0, -21)[1], size, 8);
  ctx.fillStyle = '#abb39744';
  for (const b of world.obstacles) {
    if (b.height < 2) continue;
    const [x, z] = map(b.minX, b.minZ);
    ctx.fillRect(x, z, (b.maxX - b.minX) / 220 * size, (b.maxZ - b.minZ) / 220 * size);
  }
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  for (const point of objectives) {
    const [x, z] = map(point.x, point.z);
    ctx.fillStyle = point.captured ? '#9aaa78' : '#d9bc7e';
    ctx.fillText(point.id, x, z);
  }
  for (const point of spawnPoints) {
    if (point.kind === 'air' || (point.kind === 'rally' && point.health <= 0)) continue;
    if (point.team === 'enemy' && point.kind === 'rally' && allies[current]?.model.position.distanceTo(new THREE.Vector3(point.x, 0, point.z)) > 35) continue;
    const [x, z] = map(point.x, point.z);
    ctx.fillStyle = point.team === 'friendly' ? '#91bca1' : '#be8d76';
    ctx.fillRect(x - 2.5, z - 2.5, 5, 5);
    if (point.id === pendingSpawn) {
      ctx.strokeStyle = '#f7dfa1';
      ctx.strokeRect(x - 5, z - 5, 10, 10);
    }
  }
  for (const actor of allies) {
    if (actor.health <= 0) continue;
    const [x, z] = map(actor.model.position.x, actor.model.position.z);
    ctx.fillStyle = actor === allies[current] ? '#f6e0a9' : '#94bea1';
    ctx.beginPath(); ctx.arc(x, z, actor === allies[current] ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    if (actor === allies[current]) {
      ctx.strokeStyle = '#f6e0a9';
      ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x - Math.sin(yaw) * 9, z - Math.cos(yaw) * 9); ctx.stroke();
    }
  }
}

function updateHUD() {
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = allies[current].locomotion;
  $('movement-status').hidden = !foot;
  if (foot) {
    const names = { idle: '站定', walk: '慢走', jog: '慢跑', sprint: '负重冲刺', crouch: '蹲行', prone: '匍匐', aim: '举枪移动' };
    $('pace-label').textContent = motion.aimRecovery > 0 && !motion.sprinting ? '收枪恢复中' : names[motion.mode];
    $('stamina-fill').style.width = `${motion.stamina * 100}%`;
    $('stamina-meter').setAttribute('aria-valuenow', String(Math.round(motion.stamina * 100)));
    $('stamina-label').textContent = `${motion.exhausted ? '体力不足 · 恢复中' : '体力'} ${Math.round(motion.stamina * 100)}%`;
    $('movement-status').classList.toggle('exhausted', motion.exhausted);
  }
  const active = objectives.find(p => !p.captured);
  $('objectives').innerHTML = objectives.map(point => `<span class="objective-chip ${point.captured ? 'captured' : point === active ? 'active' : ''}">${point.id}</span>`).join('');
  if (active) $('objective-title').textContent = `夺取 ${active.id} · ${active.name}`;
  $('timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`;
  $('ammo').textContent = unit.reloadUntil ? '装填' : String(unit.ammo);
  $('ammo').style.fontSize = unit.reloadUntil ? '25px' : '';
  const health = unit.type === 'tank' ? unit.vehicleHealth : allies[current].health;
  $('health-fill').style.width = `${health / TYPES[unit.type].health * 100}%`;
  $('health-text').textContent = `${unit.type === 'tank' ? '装甲' : '生命'} ${Math.ceil(health)}`;
  $('members').innerHTML = allies.map((actor, index) => `<span class="member ${index === current ? 'active' : ''} ${actor.health <= 0 ? 'dead' : ''}">${unit.type === 'tank' ? ['车长', '炮手', '驾驶员'][index] : unit.type === 'plane' ? '飞行员' : actor.role === 'engineer' ? '工兵' : `${index + 1} 号`} ${actor.health <= 0 ? '×' : '▮'}</span>`).join('');
  $('scoreboard-stats').textContent = `个人击倒 ${kills}　友军击倒 ${teamKills}\n占领据点 ${objectives.filter(p => p.captured).length} / 3　出击小队 ${deployments}\n当前存活 ${allies.filter(actor => actor.health > 0).length} / ${allies.length}`;
  $('kill-feed').innerHTML = feed.filter(entry => entry.until > time).map(entry => `<span class="feed-entry">${entry.text}</span>`).join('');
  drawRadar();
}

function updateDoorPrompt() {
  const prompt = $('interaction-prompt');
  const usable = state === 'playing' && (unit?.type === 'infantry' || unit?.type === 'mortar') && !construction.blueprint;
  const door = usable ? world.doorSystem.focus(camera) : null;
  prompt.hidden = !door;
  prompt.textContent = door ? `F  ${Math.abs(door.targetAngle) < .01 ? '开门' : '关门'}${door.blocked ? ' · 门后受阻，移开后继续' : ''}` : '';
}

function menuCamera(now) {
  const t = now * .000035;
  camera.position.set(47 + Math.sin(t) * 4, 19, 70 + Math.cos(t) * 4);
  camera.lookAt(-9, 2, -1);
  camera.fov = 55;
  camera.updateProjectionMatrix();
}

function tick(now) {
  if (fatal) return;
  const dt = Math.min((now - lastFrame) / 1000, .05);
  lastFrame = now;
  if (state === 'menu') menuCamera(now);
  if (state === 'playing' || state === 'dead') {
    time += dt;
    remaining = Math.max(0, remaining - dt);
    world.doorSystem.update(dt, [...allies, ...enemies].filter(actor => actor.health > 0 && !(actor === allies[current] && unit.type === 'plane')).map(actor => ({
      x: actor.model.position.x, z: actor.model.position.z, radius: actor === allies[current] && unit.type === 'tank' ? 1.9 : .42,
    })));
    if (state === 'playing') updatePlayer(dt);
    if (state === 'playing' || state === 'dead') updateAI(dt);
    if (state === 'playing' || state === 'dead') updateObjectives(dt);
    if (state === 'playing' || state === 'dead') updateEffects(dt);
    if (time >= hudAt) { updateHUD(); hudAt = time + .12; }
    if (state === 'dead' && time >= deploymentRefreshAt) { refreshDeployment(); deploymentRefreshAt = time + .25; }
    if (!remaining && (state === 'playing' || state === 'dead')) showOverlay('defeat');
  }
  for (const puff of world.smoke) {
    if (!puff.visible) continue;
    const phase = (now * .000025 + puff.userData.phase) % 1;
    puff.position.set(puff.userData.originX + phase * 8, 4 + phase * 27, puff.userData.originZ);
    puff.scale.setScalar(5 + phase * 16);
  }
  for (const flag of world.flags) flag.rotation.y = Math.sin(now * .0015) * .08;
  updateDoorPrompt();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

document.querySelectorAll('.squad-choice').forEach(button => button.addEventListener('click', () => {
  selectedType = button.dataset.type;
  document.querySelectorAll('.squad-choice').forEach(choice => {
    const selected = choice === button;
    choice.classList.toggle('selected', selected);
    choice.setAttribute('aria-pressed', String(selected));
  });
}));
$('deploy').addEventListener('click', beginMatch);
$('redeploy-choices').innerHTML = Object.entries(SQUADS).map(([id, squad]) => `<button data-type="${id}" aria-pressed="false"><strong>${squad.name}</strong><small>${TYPES[squad.type].members} 人 · 可出击</small></button>`).join('');
$('redeploy-choices').addEventListener('click', event => {
  const button = event.target.closest('[data-type]');
  if (!button) return;
  const id = button.dataset.type;
  const type = SQUADS[id].type;
  const reason = deploymentBlockReason(state, allies, id, unit?.squadId);
  if (reason) { $('deployment-error').textContent = reason; toast(reason); return; }
  pendingSquad = id;
  pendingSpawn = spawnPoints.find(point => point.team === 'friendly' && supportsSquad(point, type) && !spawnBlockReason(point, type, hostilePositions('friendly'), world.obstacles))?.id || null;
  $('deployment-error').textContent = '';
  refreshDeployment();
});
$('spawn-choices').addEventListener('click', event => {
  const button = event.target.closest('[data-spawn]');
  if (!button || state !== 'dead') return;
  const point = spawnPoints.find(point => point.id === button.dataset.spawn && point.team === 'friendly');
  if (!point || !pendingSquad) return;
  const reason = spawnBlockReason(point, SQUADS[pendingSquad].type, hostilePositions('friendly'), world.obstacles);
  if (reason) { $('deployment-error').textContent = reason; return; }
  pendingSpawn = point.id;
  $('deployment-error').textContent = '';
  refreshDeployment();
});
$('confirm-deploy').addEventListener('click', () => {
  if (!pendingSquad || !pendingSpawn) { $('deployment-error').textContent = '请选择小队和重生点'; return; }
  deploy(pendingSquad, pendingSpawn);
});
$('pause-button').addEventListener('click', () => { if (state === 'playing') showOverlay(); });
$('resume').addEventListener('click', () => {
  if (state !== 'pause' || !allies.some(actor => actor.health > 0)) {
    $('deployment-error').textContent = '整队阵亡后必须选择其他小队出击';
    return;
  }
  state = 'playing';
  $('overlay').hidden = true;
  lockMouse();
});
$('back-menu').addEventListener('click', () => {
  state = 'menu';
  releaseMouse();
  clearActors(allies);
  clearActors(enemies);
  clearTransient();
  allies = [];
  enemies = [];
  if (weapon) { camera.remove(weapon); weapon = null; }
  if (vehicle) { scene.remove(vehicle); vehicle = null; }
  toolEquipped = false;
  resetConstruction();
  resetSpawns();
  mortarMarker.visible = false;
  $('overlay').hidden = true;
  $('hud').hidden = true;
  $('menu').hidden = false;
});

function setMotionStrength(value) {
  motionStrength = value;
  $('motion-strength').value = String(value);
}
$('motion-strength').addEventListener('change', event => setMotionStrength(Number(event.target.value)));

function syncQualityControls() {
  const settings = graphics.snapshot;
  for (const selector of document.querySelectorAll('[data-quality-toggle]')) selector.value = settings.preset;
  for (const checkbox of document.querySelectorAll('[data-quality-effect]')) checkbox.checked = settings.effects[checkbox.dataset.qualityEffect];
  $('quality-status').textContent = `${settings.preset === 'high' ? '高' : '低'}画质 · ${settings.pixelRatio.toFixed(2)}× · 阴影${settings.shadowsEnabled ? settings.shadowSize : '关闭'}`;
}
for (const selector of document.querySelectorAll('[data-quality-toggle]')) selector.addEventListener('change', () => {
  graphics.setPreset(selector.value);
  syncQualityControls();
});
for (const checkbox of document.querySelectorAll('[data-quality-effect]')) checkbox.addEventListener('change', () => {
  if (!QUALITY_EFFECTS.includes(checkbox.dataset.qualityEffect)) throw new RangeError('Unknown graphics effect control');
  graphics.setEffect(checkbox.dataset.qualityEffect, checkbox.checked);
  syncQualityControls();
});
syncQualityControls();

document.addEventListener('keydown', event => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.repeat || state !== 'playing') return;
  keys.add(event.code);
  if (event.code === 'KeyF') {
    updateCamera(0);
    if (unit.type !== 'infantry' && unit.type !== 'mortar') toast('载具席位离开尚未实现；当前 F 用于步兵开关门');
    else if (construction.blueprint) toast('先收起建造蓝图，再按 F 操作房门');
    else {
      const door = world.doorSystem.focus(camera);
      if (door) world.doorSystem.interact(door, allies[current].model.position);
      else toast('靠近房门并看向门板或门口，再按 F');
    }
  }
  if (event.code === 'KeyR') reload();
  if (event.code === 'Digit1' && unit.type === 'infantry') equipTool(false);
  if (event.code === 'Digit2' && unit.type === 'infantry') equipTool(true);
  if (event.code === 'KeyY') {
    const next = nextAlive(allies, current);
    if (next >= 0) changeMember(next);
  }
  if (event.code === 'KeyX') commandDownAt = performance.now();
  if (event.code === 'ControlLeft' && (unit.type === 'infantry' || unit.type === 'mortar')) stance = stance === 'crouched' ? 'standing' : 'crouched';
  if (event.code === 'KeyZ' && (unit.type === 'infantry' || unit.type === 'mortar')) stance = stance === 'prone' ? 'standing' : 'prone';
  if (event.code === 'Space' && (unit.type === 'infantry' || unit.type === 'mortar') && jumpHeight === 0) {
    if (stance !== 'standing') stance = 'standing';
    else if (allies[current].locomotion.stamina >= .1) {
      jumpVelocity = 5;
      allies[current].locomotion.stamina -= .08;
      allies[current].locomotion.regenDelay = 1.4;
    } else toast('体力不足，暂时无法起跳');
  }
  if (event.code === 'Tab') $('scoreboard').hidden = false;
  if (event.code === 'KeyM') $('minimap').classList.toggle('expanded');
  if (event.code === 'KeyB') {
    const levels = [1, .35, 0];
    setMotionStrength(levels[(levels.indexOf(motionStrength) + 1) % levels.length]);
    toast(`镜头步态：${motionStrength === 1 ? '标准' : motionStrength ? '减弱' : '关闭'} · 不影响移动速度`);
  }
  if (event.code === 'Escape') showOverlay();
});
document.addEventListener('keyup', event => {
  keys.delete(event.code);
  if (event.code === 'Tab') $('scoreboard').hidden = true;
  if (event.code === 'KeyX' && commandDownAt !== null) {
    if (state === 'playing') squadCommand(performance.now() - commandDownAt > 450);
    commandDownAt = null;
  }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('mousedown', event => {
  if (state !== 'playing') return;
  if (event.button === 0) {
    if (document.pointerLockElement !== canvas && !rightDown) lockMouse();
    mouseDown = true;
  }
  if (event.button === 2) {
    rightDown = true;
    if (toolEquipped) construction.blueprint = true;
    else aiming = true;
  }
});
document.addEventListener('mouseup', event => {
  if (event.button === 0) mouseDown = false;
  if (event.button === 2) { rightDown = false; aiming = false; }
});
document.addEventListener('mousemove', event => {
  if (state !== 'playing' || (document.pointerLockElement !== canvas && !rightDown)) return;
  yaw -= event.movementX * .0022 * (aiming ? .6 : 1);
  pitch -= event.movementY * .0022 * (aiming ? .6 : 1);
  pitch = THREE.MathUtils.clamp(pitch, unit.type === 'plane' ? -.7 : -1.25, unit.type === 'plane' ? .65 : 1.25);
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') showOverlay();
});
window.addEventListener('blur', () => { if (state === 'playing') showOverlay(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') showOverlay(); });
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize(innerWidth, innerHeight);
  syncQualityControls();
});
window.addEventListener('error', event => {
  fatal = true;
  releaseMouse();
  $('loading').hidden = true;
  $('fatal').hidden = false;
  $('fatal-message').textContent = `运行时发生错误：${event.message}。请重新加载；若仍出现，请保留浏览器控制台信息。`;
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  fatal = true;
  releaseMouse();
  $('fatal').hidden = false;
  $('fatal-message').textContent = '显卡上下文已丢失。请关闭占用显存的其他页面后重新加载。';
});

// A read-only snapshot makes local smoke tests observable without exposing gameplay mutations.
Object.defineProperty(window, '__battle', { get: () => ({
  state, type: unit?.type, squadId: unit?.squadId, time, remaining, kills, teamKills, deployments,
  position: allies[current] ? { x: allies[current].model.position.x, y: unit.altitude, z: allies[current].model.position.z } : null,
  current, ammo: unit?.ammo, health: unit?.type === 'tank' ? unit.vehicleHealth : allies[current]?.health,
  spawnId: unit?.spawnId, pendingSquad, pendingSpawn,
  aiming, fov: camera.fov, stance, breath,
  graphics: graphics.snapshot, combatStats: { ...combatStats },
  look: { yaw, pitch },
  bridgeSurfaces: { ...world.bridgeSurfaces },
  doors: world.doorSystem.doors.map(({ id, x, z, angle, targetAngle, state, blocked }) => ({ id, x, z, angle, targetAngle, state, blocked })),
  town: { streetWidth: world.town.streetWidth, buildings: world.town.buildings.map(building => ({ ...building })), visibility: { ...world.visibility },
    navigation: navigate.stats, inside: allies[current] ? world.town.buildings.find(building => {
      const p = allies[current].model.position;
      return Math.abs(p.x - building.x) < building.w / 2 && Math.abs(p.z - building.z) < building.d / 2;
    })?.id || null : null },
  rifle: unit?.type === 'infantry' ? { ...allies[current].rifle, obstruction: weaponObstruction, obstructionBlend, trace: lastRifleTrace,
    model: weapon?.userData.rifle ? {
      boltLift: weapon.userData.rifle.bolt.rotation.z, boltTravel: weapon.userData.rifle.bolt.position.z,
      clipVisible: weapon.userData.rifle.clip.visible, chargerVisible: weapon.userData.rifle.clip.getObjectByName('charger').visible,
      cartridges: weapon.userData.rifle.clip.children.filter(child => child.name.startsWith('cartridge') && child.visible).length,
      flashVisible: weapon.userData.rifle.flash.visible,
      dimensions: { ...weapon.userData.dimensions },
      arms: weapon.userData.armLengths ? { right: { ...weapon.userData.armLengths.right }, left: { ...weapon.userData.armLengths.left } } : null,
    } : null,
    muzzle: weapon?.userData.rifle ? weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3()).toArray() : null,
    sights: weapon?.userData.rifle ? ['rearSight', 'frontSight'].map(name => {
      const point = weapon.userData.rifle[name].getWorldPosition(new THREE.Vector3()).project(camera);
      return { x: point.x, y: point.y };
    }) : null } : null,
  locomotion: allies[current] ? { ...allies[current].locomotion, motionStrength, footsteps: playerFootsteps, surface: lastFootSurface, eyeHeight,
    cameraHeight: camera.position.y, cameraRoll: camera.rotation.z,
    weaponOffset: weapon ? { x: weapon.position.x, y: weapon.position.y, z: weapon.position.z, pitch: weapon.rotation.x } : null } : null,
  allies: allies.map(actor => ({ health: actor.health, x: actor.model.position.x, z: actor.model.position.z, order: actor.order,
    orderPoint: actor.orderPoint ? { ...actor.orderPoint } : null, mode: actor.tactics.mode, coverId: actor.tactics.cover?.id || null, bodyScaleY: actor.model.scale.y,
    role: actor.role, targetKind: actor.targetKind, spawnId: actor.spawnId, stamina: actor.locomotion.stamina, rifle: { ...actor.rifle } })),
  construction: { tool: toolEquipped, blueprint: construction.blueprint, progress: construction.progress, site: construction.site ? { x: construction.site.x, z: construction.site.z } : null },
  spawnPoints: spawnPoints.map(({ id, team, kind, name, x, z, health }) => ({ id, team, kind, name, x, z, health })),
  spawnEvents: spawnEvents.map(event => ({ ...event })),
  enemies: enemies.filter(actor => actor.health > 0).length,
  enemyPositions: enemies.filter(actor => actor.health > 0).map(actor => ({ x: actor.model.position.x, z: actor.model.position.z, health: actor.health,
    id: actor.tactics.id, squad: actor.tactics.squad, mode: actor.tactics.mode, coverId: actor.tactics.cover?.id || null, bodyScaleY: actor.model.scale.y,
    targetKind: actor.target?.targetKind || null, threatKind: actor.tactics.threatKind,
    lastSeen: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null, blockedBy: actor.tactics.blockedBy })),
  coverClaims: [...coverClaims].filter(([, claim]) => claim.until > time).map(([id, claim]) => ({ id, ...claim })),
  objectives: objectives.map(({ id, progress, captured }) => ({ id, progress, captured })),
  drawCalls: renderer.info.render.calls,
}), configurable: false });

$('loading').hidden = true;
$('menu').hidden = false;
requestAnimationFrame(tick);
