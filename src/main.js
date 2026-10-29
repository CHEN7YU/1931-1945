import * as THREE from 'three';
import './style.css';
import { soldierModel, weaponModel, rallyPointModel, baseSpawnModel, setModelSurfaces } from './world.js';
import { makeWorld } from './battlefield.js';
import { loadSceneMaterials } from './materials.js';
import { TYPES, MATCH_SECONDS, DOMINATION_SECONDS, makeObjectives, advanceCapture, createConquest, advanceConquest, moveGround, circleBlocked, segmentClear, createNavigator, blastDamage, nextAlive, canDeploySquad, shotState } from './core.js';
import { floorDestination, multistoryPath } from './multistory.js';
import { RIVER } from './ground.js';
import { SPAWN_RULES, SQUADS, makeBaseSpawns, deploymentBlockReason, supportsSquad, spawnBlockReason, rallyBuildBlockReason, createRallyPoint, replaceTeamRally, damageRallyPoint } from './spawns.js';
import { FOOT_SPEEDS, createLocomotion, advanceLocomotion, advanceStamina, stopLocomotion, landLocomotion } from './locomotion.js';
import { RIFLE, createRifleState, reloadRifle, shootRifle, infantryWeaponProfile } from './rifle-action.js';
import { createBreathState, advanceBreath, aimSway } from './sniper-aim.js';
import { updateRifleModel, updateRifleArms, rifleTextureSnapshot } from './rifle-model.js';
import { createTactics, rememberThreat, expireThreat, peekTurn, selectCover, pointSegmentDistance,
  friendlyCoverAction, targetAimPoint, visibleTargetPoint, observeVisualThreat, objectiveDestination, objectiveAdvanceRequired,
  assignAssaultObjectives, assaultDestination, formationAssaultAction, resetObjectiveMovement } from './tactics.js';
import { createQualitySettings, QUALITY_EFFECTS } from './quality.js';
import { canWeaponDamageTarget, canRiflemanTrackTarget, damageForTarget, rifleArmorResponse, rifleAIFireDelay, rifleAIHitChance } from './combat-targets.js';
import { createDaylight } from './lighting.js';
import { createCombatEffects, captureImpact } from './combat-effects.js';
import { BATTLE_RULES, battleRoster, stagingSpawns, formationPositions, validateRoster, armySummary, sectionOffset, holdDestination, isVehicleUnit, FormationPlacementError, reinforcementDue, battleSpawn, infantryLoadout } from './battle-roster.js';
import { SpatialGrid, obstacleLookup } from './spatial.js';
import { createSolidIndex } from './solid-index.js';
import { createSoldierRenderer } from './soldier-renderer.js';
import { createSoldierHitSystem } from './soldier-hit-zones.js';
import { loadRifleAudio } from './rifle-audio.js';
import { loadFootstepAudio } from './footstep-audio.js';
import { loadRifleMechanicalAudio } from './rifle-mechanical-audio.js';
import { loadBattleVoices, createObjectiveVoiceTracker } from './battle-voices.js';
import { loadBattleReactions } from './battle-reactions.js';
import { createNraMotion, advanceNraMotion, sampleNraMotion, nativeAimReady, syncNativeAimGoal } from './nra-motion.js';
import { createNraAppearance } from './nra-appearance.js';
import { benchmarkConfig, seededRandom, diagnosticRoster, diagnosticSpawns, createFrameTelemetry } from './benchmark.js';
import { createEntityRegistry, registerUnit, registerSoldier, registerWeapon, createVehicleEntity, occupiedVehicle, seatSoldier,
  leaveGroundVehicle, selectControlledSoldier, controlledSoldier, createControlView, vehicleCollider, groundExit,
  damageVehicleEntity, resetEntities, controlOwner, captureAttackSource, releaseSupportWeapon, createControlPoseView, occupiedSeat,
  soldierRifleMuzzle, SOLDIER_FIRE_HEIGHT, soldierPostureHeight, soldierEyePosition } from './entities.js';
import { FIRING_POSES, chooseCombatPosture, postureReady, ownedFiringPose, wallFiringContact,
  chooseAdvancePace, chooseShotRelocation } from './combat-posture.js';
import { createDeathTransfer, startDeathTransfer, advanceDeathTransfer, deathTransferMask, resetDeathTransfer } from './control-transition.js';
import { createControlInput } from './control-input.js';
import { createControlEvents } from './control-events.js';
import { createProjectile, advanceProjectile, PROJECTILE_LIMIT } from './projectiles.js';
import { advanceOwnedWeapons, syncControlledRifleTiming } from './weapon-simulation.js';
import { AI_RIFLE, createAIRifleControl, resetAIRifleAim, attemptAIRifleShot } from './ai-rifle.js';
import { advanceAITurn, headingError, AI_TURN } from './ai-turning.js';
import { createCombatEvents } from './combat-events.js';
import { createCombatFeedback } from './combat-feedback.js';
import { createConstructionState, resetConstructionState, selectConstructionBlueprint, constructionCandidate, advanceConstruction } from './construction.js';
import { createRallyRenderer } from './rally-renderer.js';
import { createVehicleRenderer } from './vehicle-renderer.js';
import { createSimulationClock, SIMULATION_CLOCK } from './simulation-clock.js';
import { BATTLE_AREA, AIR_BATTLE_AREA, BOUNDARY_RULES, createBoundaryState, advanceBoundary } from './battle-boundary.js';
import { CORPSE_RULES, createCasualtyState, expiredCorpses, placeCasualty } from './casualties.js';
import { GRENADE, EXPLOSIVE_PACK, throwableProfile, throwableStock, throwableVehicleDamage, createGrenadeInventory, createGrenadeSystem, grenadePose, grenadeCanDamage } from './grenades.js';
import { createGrenadeRenderer } from './grenade-renderer.js';
import { advanceTankMachineGun, tankHeading, tankCannonPose, tankObservationPose } from './player-tank.js';
import { infantrySteering } from './infantry-spacing.js';
import { KILL_COLUMNS, createBattleStats } from './battle-stats.js';
import { campaignUnitName, campaignUnitDescription } from './battle-units.js';
import { chooseAIThrowable, planAIThrow } from './ai-throwables.js';
import { scoreIcon } from './score-icons.js';
import { CHI_HA, CHI_HA_MG, japaneseArmorSpawns, chiHaObjectiveDestination } from './chi-ha.js';
import { advanceChiHaAI } from './chi-ha-ai.js';
import { advanceChiHaMachineGuns } from './chi-ha-machine-guns.js';
import { createTankNavigation } from './tank-navigation.js';
import { chooseTankCover } from './armor-cooperation.js';

const buildStamp = Object.freeze(__BUILD_STAMP__);
const buildRevision = buildStamp.commit?.slice(0, 7);
const buildLabel = import.meta.env.DEV
  ? `开发预览 · ${buildRevision ? `基线 ${buildRevision}` : '版本未知'}`
  : buildRevision ? `构建 ${buildRevision}${buildStamp.dirty ? ' · 含未提交改动' : ''}` : '构建版本未知';
for (const element of document.querySelectorAll('[data-build-version]')) {
  element.textContent = buildLabel;
  element.title = `${import.meta.env.DEV ? '开发服务器启动基线，源码可热更新，非线上发布版本' : '此页面的实际构建版本'}\n提交：${buildStamp.commit ?? '未知'}\n构建时间（UTC）：${buildStamp.builtAt}`;
}

const benchmark = benchmarkConfig(location.search, import.meta.env.DEV);
const telemetry = createFrameTelemetry(Boolean(benchmark));
const entities = createEntityRegistry();
const controlPose = createControlPoseView(entities);
const deathTransfer = createDeathTransfer();
const playerInput = createControlInput();
const held = playerInput.held;
const controlEvents = createControlEvents();
const combatEvents = createCombatEvents();
const combatFeedback = createCombatFeedback();
const grenades = createGrenadeSystem();
const aiThrowReservations = new Map();
const battleStats = createBattleStats();
let scoreboardRevision = -1;

function registerBattleScore(formation) {
  formation.scoreLabel = campaignUnitName(formation);
  battleStats.register(formation);
}

function renderSquadScores() {
  if ($('scoreboard').hidden || scoreboardRevision === battleStats.revision) return;
  const container = $('squad-score-table'); container.replaceChildren();
  for (const team of ['friendly', 'enemy']) {
    const section = document.createElement('section'); section.className = `score-team ${team}`;
    const caption = document.createElement('div'); caption.className = 'score-team-caption';
    caption.textContent = team === 'friendly' ? '我军' : '日军'; section.append(caption);
    const scroll = document.createElement('div'); scroll.className = 'score-table-wrap';
    const table = document.createElement('table'); table.className = 'score-team-table';
    table.setAttribute('aria-label', `${caption.textContent}各小队击杀`);
    const head = document.createElement('thead'), heading = document.createElement('tr');
    for (const [kind, title] of [['squad', '小队'], ['total', '总击杀'], ...KILL_COLUMNS, ['destroyed', '毁车']]) {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.title = title; cell.setAttribute('aria-label', title);
      cell.dataset.stat = kind; cell.append(scoreIcon(kind)); heading.append(cell);
    }
    head.append(heading); table.append(head);
    const body = document.createElement('tbody');
    const rows = battleStats.snapshot.filter(row => row.team === team).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
    for (const [rank, row] of rows.entries()) {
      const line = document.createElement('tr'), label = document.createElement('th');
      const current = entities.units.get(entities.control.unitId);
      if (row.unitId === current?.id && row.squadId === (current.squadId ?? current.id)) line.className = 'controlled';
      label.scope = 'row'; label.setAttribute('aria-label', row.name);
      const number = document.createElement('span'); number.className = 'score-rank'; number.textContent = String(rank + 1);
      label.append(number, document.createTextNode(row.name.replace(/^(我方|日军)/, '').replace(/\s+(\d+)$/, '$1')));
      label.title = campaignUnitDescription(row.name); line.append(label);
      for (const value of [row.total, ...KILL_COLUMNS.map(([key]) => row.kills[key]), row.vehicles]) {
        const cell = document.createElement('td'); cell.textContent = String(value);
        if (!value) cell.className = 'score-zero';
        line.append(cell);
      }
      body.append(line);
    }
    table.append(body); scroll.append(table); section.append(scroll); container.append(section);
  }
  scoreboardRevision = battleStats.revision;
}
const boundaryStates = new Map();
const simulationClock = createSimulationClock(performance.now());
const activeStates = new Set(['playing', 'transferring', 'dead']);
const gameStates = new Set(['menu', 'playing', 'transferring', 'dead', 'pause', 'victory', 'defeat', 'draw']);
let pausedFrom = 'playing';
let battleRandom = benchmark ? seededRandom(benchmark.seed) : Math.random;

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
const hemisphere = new THREE.HemisphereLight(0xc3d3e1, 0x766651, .6);
scene.add(hemisphere);
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
  await setModelSurfaces(surface, renderer.capabilities.getMaxAnisotropy());
} catch (error) {
  $('loading').hidden = true;
  $('fatal').hidden = false;
  $('fatal-message').textContent = `场景材质加载失败：${error.message}。请重新加载，并检查本地 assets 文件是否完整。`;
  throw error;
}
const world = makeWorld(scene, surface);
const solidIndex = createSolidIndex(world.solids);
const soldierRenderer = createSoldierRenderer(scene, camera, BATTLE_RULES.unitsPerTeam * TYPES.infantry.members + TYPES.infantry.members);
const rallyRenderer = createRallyRenderer(scene);
const vehicleRenderer = createVehicleRenderer(scene);
let nraCharacter = null;
let ijaCharacter = null;
const uniformExcludedIds = new Set();
if (new URLSearchParams(location.search).get('character') !== 'procedural') {
  try {
    const { loadNraCharacter } = await import('./nra-character.js');
    const { createNraForceRenderer } = await import('./nra-force-renderer.js');
    nraCharacter = createNraForceRenderer(scene, camera, await loadNraCharacter());
    const { loadIjaCharacter, createIjaForceRenderer } = await import('./ija-character.js');
    ijaCharacter = createIjaForceRenderer(scene, camera, await loadIjaCharacter());
  } catch (error) {
    $('loading').hidden = true; $('fatal').hidden = false;
    $('fatal-message').textContent = `人物适配试验加载失败：${error.message}。未静默回退。`;
    throw error;
  }
}
const actorGrid = new SpatialGrid();
const soldierHits = createSoldierHitSystem((actor, now) => {
  const character = actor.friendly ? nraCharacter : ijaCharacter;
  if (!character) throw new Error('Native soldier has no anatomical pose factory');
  return character.sampleAnatomy(actor, now);
});
const bodyRay = new THREE.Raycaster();
const groundCollision = obstacleLookup(world.obstacles, 2.5);
const daylight = createDaylight(scene, sun, hemisphere, scene.fog);
const combatEffects = createCombatEffects(scene, camera, world.groundHeight);
const grenadeRenderer = createGrenadeRenderer(scene, camera, nraCharacter?.createGrenadeHand);
const graphics = createQualitySettings({ renderer, scene, sun, smoke: world.smoke, grain: document.querySelector('.grain') });
const navigate = createNavigator(world.doorSystem.navigationObstacles);
const armorNavigate = createTankNavigation(world.obstacles);
world.doorSystem.onNavigationChanged = bounds => { navigate.refresh(bounds); armorNavigate.refresh(bounds); groundCollision.rebuild(); };
world.doorSystem.onRequested = door => controlEvents.publish('door.requested', { doorId: door.id, opening: door.targetAngle !== 0,
  position: { x: door.x, y: world.groundHeight(door.x, door.z) + door.height / 2, z: door.z } }, time);
const ray = new THREE.Raycaster();
const vector = new THREE.Vector3();
const direction = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const groundPlane = new THREE.Plane(up, 0);
const projectileGeometry = new THREE.SphereGeometry(.12, 6, 6);
const impactGeometry = new THREE.IcosahedronGeometry(1, 1);
const shellMaterial = new THREE.MeshBasicMaterial({ color: 0xffce70 });
const radarContext = $('radar').getContext('2d');
const keys = playerInput.keys;
const effects = [];
const shells = [];
const shellViews = new Map();
const projectileImpacts = [];
let projectileSerial = 0;
const coverClaims = new Map();
const combatSounds = [];
const rifleReports = [];
const combatStats = { aiRifleShots: 0, aiRifleShotsAtArmor: 0, aiRifleShotsAtAircraft: 0, armorThreatsObserved: 0,
  rifleAircraftCandidatesIgnored: 0, rejectedRifleArmorDamage: 0, rejectedRifleAircraftDamage: 0 };
let actorSerial = 0;
let soundSerial = 0;
let state = 'menu';
let selectedType = 'infantry';
let objectives = makeObjectives();
let conquest = createConquest();
let assaultAssignmentAt = 0;
let allies = [];
let enemies = [];
let friendlyAI = [];
let friendlyForces = [];
const corpses = new Map();
let corpseCleanupAt = 0;
let allForces = [];
let formations = [];
let aiCursor = 0;
const pathRequests = new Map();
let sensorBudget = 0;
let coverBudget = 0;
let populationRefreshAt = 0;
let current = 0;
let unit = null;
let weapon = null;
let time = 0;
let remaining = MATCH_SECONDS;
let kills = 0;
let teamKills = 0;
let deployments = 0;
let recoil = 0;
let toastUntil = 0;
let hudAt = 0;
let lastFrame = performance.now();
const frameTimes = [];
let audioContext;
let noiseBuffer;
let rifleAudio = null, rifleAudioFailure = null, audioWarningShown = false, audioUnsupported = false;
let footstepAudio = null, footstepAudioFailure = null;
let mechanicalAudio = null, mechanicalAudioFailure = null;
let battleVoices = null, battleVoicesFailure = null;
let battleReactions = null, battleReactionsFailure = null;
const objectiveVoiceTracker = createObjectiveVoiceTracker();
try {
  rifleAudio = await loadRifleAudio();
} catch (error) {
  rifleAudioFailure = error.message;
  console.error('步枪录音未加载，将保留原合成声：', error);
}
try {
  footstepAudio = await loadFootstepAudio();
} catch (error) {
  footstepAudioFailure = error.message;
  console.error('脚步录音未加载，将保留原合成声：', error);
}
try {
  mechanicalAudio = await loadRifleMechanicalAudio();
} catch (error) {
  mechanicalAudioFailure = error.message;
  console.error('步枪机械录音未加载，将保留原合成声：', error);
}
try {
  battleVoices = await loadBattleVoices();
} catch (error) {
  battleVoicesFailure = error.message;
  console.error('战场语音未加载，喊话和指挥提示不可用：', error);
}
try {
  battleReactions = await loadBattleReactions((position, listener) =>
    !hasLine(new THREE.Vector3(position.x, position.y + 1.5, position.z), listener.position, 36));
} catch (error) {
  battleReactionsFailure = error.message;
  console.error('真人战斗反应录音未加载，短喊与受击人声不可用：', error);
}
let pointerHintShown = false;
let scoreboardInteractive = false, scoreboardReturnCapture = false, scoreboardRestoring = false;
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
let spawnPoints = [...makeBaseSpawns(), ...stagingSpawns()];
let spawnEvents = [];
let rallySerial = 0;
let pendingSquad = null;
let pendingSpawn = null;
let deploymentRefreshAt = 0;
let toolEquipped = false;
let grenadeEquipped = false;
let selectedThrowable = 'grenade';
let controlBinding = null;
const construction = createConstructionState();
let fatal = false;
const mortarTarget = new THREE.Vector3();
const rallyPreview = rallyPointModel('friendly', true);
rallyPreview.visible = false;
scene.add(rallyPreview);
for (const point of spawnPoints.filter(point => !point.aiOnly && (point.kind === 'base' || point.kind === 'garage'))) {
  const model = baseSpawnModel(point.team);
  model.position.set(point.x, 0, point.z);
  scene.add(model);
}

function toast(message, duration = 3) {
  $('toast').textContent = message;
  $('toast').style.opacity = '1';
  toastUntil = time + duration;
}

function setGameState(next) {
  if (!gameStates.has(next)) throw new RangeError(`Unknown game state: ${next}`);
  const active = activeStates.has(next);
  if (simulationClock.active !== active) simulationClock.setActive(active, performance.now());
  state = next;
  battleVoices?.sync(['playing', 'transferring', 'dead', 'victory', 'defeat', 'draw'].includes(state));
  battleReactions?.sync(['playing', 'transferring', 'dead'].includes(state));
  footstepAudio?.sync(entities.control.soldierId, state === 'playing' && !controlledSoldier(entities)?.vehicleId);
  syncMechanicalAudio();
}

function mechanicalPlayback() {
  const actor = controlledSoldier(entities);
  const owner = controlOwner(entities);
  return { owner, playing: Boolean(state === 'playing' && actor?.health > 0 &&
    !actor.vehicleId && actor.groundType === 'infantry' && !toolEquipped && !grenadeEquipped && owner.weaponId === actor.rifle?.id) };
}

function syncMechanicalAudio() {
  const { owner, playing } = mechanicalPlayback();
  mechanicalAudio?.sync(owner, playing);
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

function mechanicalSound(event) {
  if (mechanicalAudio) {
    mechanicalAudio.play(audioContext, event);
    return;
  }
  const { owner, playing } = mechanicalPlayback();
  if (!playing || event.soldierId !== owner.soldierId || event.weaponId !== owner.weaponId) return;
  if (!audioContext || audioContext.state !== 'running') return;
  const { cue } = event;
  const source = audioContext.createBufferSource(), gain = audioContext.createGain(), filter = audioContext.createBiquadFilter();
  const now = audioContext.currentTime, length = cue === 'extract' ? .1 : .045;
  source.buffer = noiseBuffer;
  filter.type = 'bandpass'; filter.frequency.value = cue === 'load' ? 2400 : cue === 'close' ? 1250 : 3200; filter.Q.value = 2;
  gain.gain.setValueAtTime(.045, now); gain.gain.exponentialRampToValueAtTime(.001, now + length);
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start(now, .3, length);
}

function playDoorSound(event) {
  if (!audioContext || audioContext.state !== 'running') return;
  const distance = Math.hypot(event.position.x - camera.position.x, event.position.z - camera.position.z);
  if (distance > 18) return;
  const now = audioContext.currentTime, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(95, now);
  oscillator.frequency.exponentialRampToValueAtTime(58, now + .4);
  gain.gain.setValueAtTime(.001, now);
  gain.gain.linearRampToValueAtTime(.018 / (1 + distance * .3), now + .04);
  gain.gain.exponentialRampToValueAtTime(.001, now + .45);
  const panner = audioContext.createStereoPanner();
  const local = camera.worldToLocal(new THREE.Vector3(event.position.x, camera.position.y, event.position.z));
  panner.pan.value = THREE.MathUtils.clamp(local.x / Math.max(1, distance), -.9, .9);
  oscillator.connect(gain).connect(panner).connect(audioContext.destination);
  oscillator.start(now); oscillator.stop(now + .46);
}

function initAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) { audioUnsupported = true; return; }
  if (!audioContext) {
    audioContext = new Audio();
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(error => {
    console.warn('游戏音效未启用：', error);
    toast('浏览器尚未允许音效，请点击游戏画面后重试', 6);
  });
}

function emitFootstep(position, speed, landing = false) {
  const ground = world.groundSurface(position.x, position.z);
  lastFootSurface = ground;
  playerFootsteps++;
  emitControlEvent('movement.footstep', { position, surface: ground, speed, landing, stance: controlPose.stance });
}

function playFootstep(event) {
  if (!audioContext || audioContext.state !== 'running') return;
  if (footstepAudio && (event.stance !== 'prone' || event.landing)) {
    footstepAudio.play(audioContext, event);
    return;
  }
  const { surface: ground, speed, landing } = event;
  const t = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  const crawling = event.stance === 'prone' && !landing;
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
  return request;
}

function releaseMouse() {
  scoreboardInteractive = scoreboardReturnCapture = scoreboardRestoring = false;
  if (document.pointerLockElement) document.exitPointerLock();
  playerInput.block();
  $('scoreboard').hidden = true;
  if (allies[current]) stopLocomotion(allies[current].locomotion);
}

function actorAt(friendly, x, z, index, spawn, formation) {
  const loadout = infantryLoadout(friendly ? 'friendly' : 'enemy', index, formation.type);
  const model = soldierModel(friendly, 'near', loadout.model);
  const position = new THREE.Vector3(x, world.groundHeight(x, z), z);
  // Apply the seeded gait phase only after a walk update; idle spawns retain neutral legs.
  const actor = { model, health: 100, friendly, index, spawnId: spawn.id, role: loadout.role, nextFire: time + 1 + battleRandom() * 2, nextThink: 0, target: null, walkPhase: battleRandom() * 6, walkPoseReady: false, deathTime: 0, buildProgress: 0, locomotion: createLocomotion(), rifle: createRifleState(loadout.model) };
  actor.targetKind = 'person';
  actor.aiRifle = createAIRifleControl();
  actor.breathControl = createBreathState();
  actor.grenades = createGrenadeInventory();
  actor.explosivePack = { get ammo() { return actor.grenades.packs; } };
  actor.rifleReady = false;
  actor.spawnPosition = { x, z };
  actor.spawnClear = !circleBlocked(x, z, .42, world.obstacles);
  actor.playerUnit = Boolean(formation?.player);
  actor.formation = formation;
  actor.section = Math.floor(index / BATTLE_RULES.sectionMembers);
  actor.tactics = createTactics(++actorSerial, (friendly ? 100 : 0) + (formation?.index || 0) * Math.ceil(TYPES.infantry.members / BATTLE_RULES.sectionMembers) + actor.section, index % BATTLE_RULES.sectionMembers);
  Object.assign(actor, { id: `soldier-${actor.tactics.id}`, unitId: formation.id, team: friendly ? 'friendly' : 'enemy',
    position, heading: friendly ? 0 : Math.PI, groundType: formation.type === 'mortar' ? 'mortar' : 'infantry' });
  if (friendly && nraCharacter) {
    actor.nativeMotion = createNraMotion(nraCharacter.motionProfile, actor);
    actor.avatarAppearance = createNraAppearance(actor);
  } else if (!friendly && ijaCharacter) {
    actor.nativeMotion = createNraMotion(ijaCharacter.motionProfile, actor);
  }
  registerSoldier(entities, actor);
  registerWeapon(entities, Object.assign(actor.rifle, { nextShot: 0, reloadUntil: 0 }), `${actor.id}:rifle`, actor.id, 'infantry');
  registerWeapon(entities, actor.grenades, `${actor.id}:grenades`, actor.id, 'grenade');
  registerWeapon(entities, actor.explosivePack, `${actor.id}:explosive-pack`, actor.id, 'explosive-pack');
  model.position.copy(position);
  model.rotation.y = actor.heading;
  spawnEvents.push({ team: friendly ? 'friendly' : 'enemy', pointId: spawn.id, pointX: spawn.x, pointZ: spawn.z, x, z, time,
    formationId: formation?.id, generation: (formation?.generation || 0) + 1 });
  if (spawnEvents.length > 2048) spawnEvents.shift();
  model.traverse(child => { if (child.isMesh) child.userData.actor = actor; });
  return actor;
}

function hostilePositions(team) {
  return (team === 'friendly' ? enemies : friendlyForces).map(actor => ({ x: actor.position.x, z: actor.position.z, health: actor.health, altitude: occupiedVehicle(entities, actor)?.type === 'plane' ? actor.position.y : 0 }));
}

function rebuildForces() {
  friendlyForces = [...allies, ...friendlyAI];
  allForces = [...enemies, ...friendlyForces];
  actorGrid.rebuild(allForces);
}

function movementObstacles(x, z, ignoreVehicleId = null) {
  const base = groundCollision.at(x, z);
  if (!entities.vehicles.size) return base;
  return [...base, ...[...entities.vehicles.values()].filter(item => item.id !== ignoreVehicleId && item.type === 'tank').map(vehicleCollider)];
}

function deploymentObstacles() {
  return entities.vehicles.size ? [...world.obstacles, ...[...entities.vehicles.values()].filter(item => item.type === 'tank').map(vehicleCollider)] : world.obstacles;
}

function vehicleSolids(ignoreVehicleId = null, from = null) {
  return [...entities.vehicles.values()].filter(item => item.id !== ignoreVehicleId &&
    (!from || from.distanceTo(item.position) > 3.2)).map(item => vehicleRenderer.model(item.id));
}

function battleSummary(team) {
  return { ...armySummary(formations, team), vehicles: [...entities.vehicles.values()].filter(item => item.team === team && item.health > 0).length };
}

function clearControlInputs() {
  playerInput.block();
  const actor = controlledSoldier(entities);
  if (actor) actor.breathControl.holding = false;
  resetConstruction();
}

function resetControlledSimulation() {
  toolEquipped = false;
  grenadeEquipped = false;
  selectedThrowable = 'grenade';
  jumpHeight = jumpVelocity = 0;
  resetConstruction();
}

function bindControlInput() {
  const owner = controlOwner(entities);
  const previousToolEquipped = toolEquipped, previousJumpHeight = jumpHeight, previousJumpVelocity = jumpVelocity;
  const changed = playerInput.bind(owner, state === 'playing' && allies[current]?.health > 0);
  if (changed) {
    resetControlledSimulation();
    const incoming = controlledSoldier(entities);
    if (incoming) resetAIRifleAim(incoming.aiRifle, 'controlled');
  }
  syncRifleUnit();
  syncMechanicalAudio();
  if (state === 'playing' && controlledSoldier(entities)?.grenades.action) grenades.release(owner.soldierId, time);
  controlBinding = { ...owner, time, changed, previousToolEquipped, previousJumpHeight, previousJumpVelocity,
    toolEquipped, jumpHeight, jumpVelocity, ammo: unit?.ammo, reloadUntil: unit?.reloadUntil,
    viewHasRifle: Boolean(weapon?.userData.rifle) };
}

function emitControlEvent(type, data = {}) {
  controlEvents.publish(type, { soldierId: entities.control.soldierId, unitId: entities.control.unitId, ...data }, time);
}

function primaryViewAvailable() {
  return unit?.type !== 'tank' || Boolean(occupiedSeat(entities)?.controlsTurret);
}

function rifleAimAvailable() {
  const actor = controlledSoldier(entities);
  return Boolean(state === 'playing' && actor?.health > 0 && unit.type === 'infantry' && !actor.vehicleId &&
    held.aiming && !toolEquipped && !grenadeEquipped && !actor.grenades.action &&
    actor.rifle.action !== 'reload' && (!infantryWeaponProfile(actor.rifle).scoped || actor.rifle.action === 'idle') &&
    !actor.locomotion.sprinting && actor.locomotion.aimRecovery === 0 && weaponObstruction === 0 && obstructionBlend < .03);
}

function sniperScopeActive() {
  return rifleAimAvailable() && Boolean(infantryWeaponProfile(allies[current].rifle).scoped);
}

function refreshWeaponVisibility() {
  if (weapon) weapon.visible = state === 'playing' && controlledSoldier(entities)?.health > 0 &&
    !grenadeEquipped && !controlledSoldier(entities).grenades.action &&
    (primaryViewAvailable() || occupiedVehicle(entities, controlledSoldier(entities))?.type === 'tank') &&
    !weapon.userData.optical && !sniperScopeActive();
  syncMechanicalAudio();
}

function resetPersonalCombatFeedback() {
  combatFeedback.resetPersonal();
  $('hit-marker').style.opacity = $('damage-vignette').style.opacity = '0';
}

function presentCombatEvents(bornAt = time) {
  const position = point => new THREE.Vector3(point.x, point.y, point.z);
  combatEvents.drain(event => {
    if (event.type === 'shot') {
      if ((event.weaponType === 'infantry' || event.weaponType === 'tank' && event.sound === 'shot') && rifleAudio) {
        rifleReports.push(event);
      } else if (event.sound) sound(event.sound);
      const start = position(event.start);
      if (event.end) {
        const end = position(event.end);
        tracer(start, end, event.color, .08, bornAt);
        if (event.muzzle) combatEffects.muzzle(start, end.clone().sub(start).normalize(), bornAt);
      }
      if (state === 'playing' && event.source.soldierId === entities.control.soldierId &&
        event.source.weaponId === controlOwner(entities)?.weaponId) {
        recoil = event.recoil;
        if (unit.type === 'infantry' && !toolEquipped) {
          updateRifleModel(weapon, allies[current].rifle);
          weapon.userData.rifle.flash.visible &&= graphics.snapshot.effects.muzzle;
        }
      }
    } else if (event.type === 'impact') {
      if (event.kind) combatEffects.hit(event, bornAt);
      else renderImpact(position(event.position), bornAt);
    } else if (event.type === 'explosion') {
      combatEffects.explosion(position(event.position), bornAt, event.radius, event.style);
      if (event.sound) sound('blast');
    } else {
      battleStats.consume(event);
      if (event.type === 'damage') {
        battleReactions?.damage(audioContext, event, entities.soldiers.get(event.target.id),
          battleAudioListener(), battleVoices?.priorityActive ?? false);
      }
      combatFeedback.consume(event, { soldierId: entities.control.soldierId, weaponId: controlOwner(entities)?.weaponId,
        grenadeWeaponId: controlledSoldier(entities)?.grenades.id,
        explosivePackWeaponId: controlledSoldier(entities)?.explosivePack.id,
        machineGunWeaponIds: occupiedVehicle(entities, controlledSoldier(entities))?.machineGuns?.map(gun => gun.id) ?? [],
        active: state === 'playing' || state === 'transferring' }, time);
    }
  });
}

function battleAudioListener() {
  camera.updateMatrixWorld();
  const elements = camera.matrixWorld.elements;
  const actor = controlledSoldier(entities), transport = occupiedVehicle(entities, actor);
  return {
    position: camera.position, right: { x: elements[0], y: elements[1], z: elements[2] },
    soldierId: entities.control.soldierId, weaponId: controlOwner(entities)?.weaponId,
    ownedWeaponIds: occupiedSeat(entities)?.canFire ? (transport?.machineGuns ?? []).map(gun => gun.id) : [],
  };
}

function presentRifleReports() {
  const listener = battleAudioListener();
  rifleAudio?.playBatch(audioContext, rifleReports.splice(0), listener);
  battleVoices?.update(audioContext, allForces, listener, time, activeStates.has(state), (observer, target) => {
    const eye = soldierEyePosition(observer);
    return Boolean(visibleTargetPoint(target, point => hasLine(new THREE.Vector3(eye.x, eye.y, eye.z), point, 75, target.vehicleId)));
  });
  battleReactions?.update(audioContext, allForces, listener, time, battleVoices?.priorityActive ?? false, activeStates.has(state));
}

function battleVoiceEvent(cue, options = {}) {
  battleVoices?.event(audioContext, cue, { time, soldierId: entities.control.soldierId ?? 'commander', ...options });
}

function presentControlEvents() {
  footstepAudio?.sync(entities.control.soldierId, state === 'playing' && !controlledSoldier(entities)?.vehicleId);
  syncMechanicalAudio();
  const count = controlEvents.drain(event => {
    if (event.type === 'door.requested') { playDoorSound(event); return; }
    if (event.type === 'rally.destroyed') {
      if (event.team === 'friendly') battleVoiceEvent('rally-lost', { eventKey: `rally:${event.id}` });
      toast(event.team === 'friendly' ? '我方工兵集结点已被摧毁，无法再从此重生！' : '敌军前线集结点已被摧毁', 6);
      if (state === 'dead') refreshDeployment();
      return;
    }
    if (event.soldierId !== entities.control.soldierId) return;
    if (event.type === 'movement.footstep') {
      if (state === 'playing' && !controlledSoldier(entities)?.vehicleId) playFootstep(event);
    } else if (['control.changed', 'vehicle.exited', 'vehicle.entered'].includes(event.type)) {
      refreshControlSurface();
      if (event.type === 'vehicle.exited') toast('已离开原车 · 车体状态、主炮弹药与个人步枪均保留');
      else if (event.type === 'vehicle.entered') toast(`已返回原车 · ${event.label}`);
      else if (event.reason !== 'death') toast(`已切换至 ${event.index + 1} 号队员`);
    } else if (event.type === 'death.started') {
      refreshWeaponVisibility();
      hudAt = 0;
    } else if (event.type === 'death.completed') {
      refreshWeaponVisibility();
      resetPersonalCombatFeedback();
      toast('已接管存活队员 · 生命与弹药保持原状');
    } else if (event.type === 'weapon.reload-requested') {
      toast(event.queued ? '拉栓后装填 · 动作与成员状态保留' : '正在装填…', event.duration);
    } else if (event.type === 'weapon.mechanical') {
      mechanicalSound(event);
    } else if (event.type === 'construction.notice') {
      const messages = { completed: '集结点建成 · 整队阵亡后，可让其他地面小队从此出击',
        moved: '位置变化，建造进度重新计算', 'owner-changed': '控制者已改变，旧建造已取消', unavailable: '当前成员不能继续建造' };
      toast(messages[event.reason], event.reason === 'completed' ? 6 : 3);
    } else if (event.type === 'equipment.changed') renderEquippedTool();
  });
  if (count) renderConstruction();
}

function updateControlHelp() {
  const actor = controlledSoldier(entities), transport = occupiedVehicle(entities, actor);
  $('battle-controls').textContent = transport?.type === 'plane'
    ? 'W S 调节速度 · A D 转向 · 鼠标 控制机头 · Space 爬升 · Ctrl 下降 · 左键 机炮 · 无法空中占点'
    : transport ? primaryViewAvailable()
      ? 'W S 前后 · A D 车体转向 · 鼠标 炮塔 · 右键 放大 · 左键 主炮 · 按住空格 机枪 · R 主炮装填 · Y 换人 · F 地面离车'
      : 'WASD 驾驶 · 鼠标 有限观察（不转炮塔） · 主炮／机枪不可操作 · Y 换人 · F 下车'
    : unit.type === 'mortar'
      ? 'WASD 搬运 · C 慢走 · Shift 短时冲刺 · 鼠标 弹着点 · 左键 发射 · R 装填 · Y 炮组 · X 命令 · 1 主武器 · 5 手榴弹 · 6 炸药包 · 左键准备／松开投掷 · B 镜头步态'
      : actor.role === 'sniper'
        ? 'WASD 移动 · 右键 开镜 · 左 Shift 屏息 · 左键 单发 · R 装填 · Ctrl 蹲姿 · Z 卧姿 · Y 换人 · 1 主武器 · 5 手榴弹 · 6 炸药包 · 左键准备／松开投掷'
        : 'WASD 慢跑 · C 慢走 · Shift 冲刺 · 左键 射击 · 右键 瞄准 · R 装填 · F 交互 · Y 队员 · X 命令 · 1 主武器 · 2 工兵工具 · 5 手榴弹（G兼容选择） · 6 炸药包 · 左键准备／松开投掷 · 按住左键建造 · B 镜头步态';
}

function refreshControlSurface() {
  const actor = controlledSoldier(entities);
  if (weapon) camera.remove(weapon);
  weapon = weaponModel(toolEquipped ? 'hammer' : unit.type, actor.rifle, occupiedSeat(entities)?.role ?? 'commander');
  weapon.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = false; mesh.frustumCulled = false; } });
  camera.add(weapon);
  refreshWeaponVisibility();
  if (unit.type === 'infantry' && !toolEquipped) weapon.position.set(.18, -.22, -.14);
  $('weapon-name').textContent = toolEquipped ? '工兵建造工具'
    : primaryViewAvailable() ? unit.type === 'infantry' ? infantryWeaponProfile(actor.rifle).name : TYPES[unit.type].weapon : `${occupiedSeat(entities).label}观察 · 主炮不可操作`;
  $('ammo-max').textContent = `/ ${unit.type === 'infantry' ? infantryWeaponProfile(actor.rifle).magazine : TYPES[unit.type].magazine}`;
  $('aim-label').hidden = unit.type !== 'mortar';
  updateControlHelp();
  lean = recoil = 0;
  resetPersonalCombatFeedback();
  weaponObstruction = obstructionBlend = 0;
  eyeHeight = controlPose.eyeHeight;
  updateCamera(0);
}

function groundVehicleFocus() {
  const actor = allies[current];
  if (!actor || actor.vehicleId) return null;
  const direction = camera.getWorldDirection(new THREE.Vector3());
  return [...entities.vehicles.values()].filter(item => item.type === 'tank' && item.health > 0 && item.team === actor.team &&
    item.unitId === actor.unitId && item.crewIds.includes(actor.id) && actor.position.distanceTo(item.position) < 4.8)
    .sort((a, b) => actor.position.distanceToSquared(a.position) - actor.position.distanceToSquared(b.position))
    .find(item => {
      const toward = item.position.clone().sub(camera.position); toward.y = 0;
      return (toward.length() < 1 || toward.normalize().dot(new THREE.Vector3(direction.x, 0, direction.z).normalize()) > .4) &&
        hasLine(camera.position, item.position.clone().add(new THREE.Vector3(0, 1, 0)), 6, item.id);
    }) || null;
}

function interactVehicle() {
  const actor = allies[current], transport = occupiedVehicle(entities, actor);
  if (transport) {
    const exit = transport.type === 'tank' ? groundExit(transport, (point, from) =>
      !circleBlocked(point.x, point.z, .42, movementObstacles(point.x, point.z)) &&
      segmentClear(from, point, .42, movementObstacles(point.x, point.z, transport.id)) &&
      !allForces.some(other => other !== actor && !other.vehicleId && other.health > 0 && Math.hypot(other.position.x - point.x, other.position.z - point.z) < .9),
    world.groundHeight) : null;
    const reason = leaveGroundVehicle(entities, actor, exit);
    if (reason) { toast(reason); return true; }
    clearControlInputs(); bindControlInput();
    actor.order = 'hold'; actor.personalHold = true; actor.orderPoint = { x: actor.position.x, y: actor.position.y, z: actor.position.z };
    emitControlEvent('vehicle.exited', { vehicleId: transport.id });
    return true;
  }
  const nearby = groundVehicleFocus();
  if (!nearby) return false;
  const seat = nearby.seats.find(item => !item.occupantId || entities.soldiers.get(item.occupantId)?.health <= 0);
  if (!seat) { toast('车组席位已满'); return true; }
  const old = entities.soldiers.get(seat.occupantId);
  if (old) { old.vehicleId = old.seatId = null; seat.occupantId = null; }
  const reason = seatSoldier(entities, actor, nearby, seat.id);
  if (reason) { toast(reason); return true; }
  clearControlInputs(); bindControlInput();
  emitControlEvent('vehicle.entered', { vehicleId: nearby.id, seatId: seat.id, label: seat.label });
  return true;
}

function resetSpawns() {
  rallyRenderer.clear();
  spawnPoints = benchmark?.diagnostic ? diagnosticSpawns(benchmark.scenario) : [...makeBaseSpawns(), ...stagingSpawns(), ...japaneseArmorSpawns()];
  spawnEvents = [];
  rallySerial = 0;
}

function spawnFormation(formation, initial = false) {
  if (formation.variant === CHI_HA.id) return spawnJapaneseArmor(formation);
  if (formation.type !== 'infantry') throw new Error('自主载具单位尚未接入，不能用步兵冒充载具');
  const team = formation.team, hostiles = hostilePositions(team);
  const spawn = battleSpawn(formation, spawnPoints, hostiles, deploymentObstacles(), initial);
  const reason = spawn ? spawnBlockReason(spawn, 'infantry', hostiles, deploymentObstacles()) : '集结点不存在';
  if (reason) { formation.blockedReason = reason; formation.respawnAt = time + 2; return false; }
  const occupied = allForces.filter(actor => actor.health > 0).map(actor => actor.position);
  let positions;
  try {
    positions = formationPositions(spawn, formation.memberCount || BATTLE_RULES.infantryMembers, deploymentObstacles(), occupied, hostiles);
  } catch (error) {
    if (!(error instanceof FormationPlacementError)) throw error;
    formation.blockedReason = error.message; formation.respawnAt = time + 2;
    return false;
  }
  const members = positions.map((position, index) => actorAt(team === 'friendly', position.x, position.z, index, spawn, formation));
  formation.members = members; formation.generation++; formation.respawnAt = null;
  formation.blockedReason = null;
  if (team === 'friendly') friendlyAI.push(...members);
  else enemies.push(...members);
  rebuildForces();
  return true;
}

function spawnJapaneseArmor(formation) {
  const spawn = spawnPoints.find(point => point.id === formation.spawnId);
  const hostiles = hostilePositions(formation.team), obstacles = deploymentObstacles();
  const blocked = !spawn ? '日军装甲出发点不存在' : spawnBlockReason(spawn, 'tank', hostiles, obstacles) ||
    (!armorNavigate.canSpawn(spawn, [...entities.vehicles.values()]) ? '日军装甲出发点净空不足' : null);
  if (blocked) {
    formation.blockedReason = blocked; formation.respawnAt = time + 2;
    return false;
  }
  const transport = createVehicleEntity(entities, { id: `${formation.id}:vehicle-${formation.generation + 1}`,
    unitId: formation.id, type: 'tank', variant: CHI_HA.id, team: formation.team,
    position: new THREE.Vector3(spawn.x, world.groundHeight(spawn.x, spawn.z), spawn.z) });
  transport.heading = transport.turretYaw = Math.PI;
  transport.weapon.nextShot = time + 4;
  formation.members = transport.seats.map((seat, index) => {
    const actor = actorAt(false, spawn.x, spawn.z, index, spawn, formation);
    actor.role = 'tanker';
    const reason = seatSoldier(entities, actor, transport, seat.id);
    if (reason) throw new Error(reason);
    return actor;
  });
  formation.vehicleId = transport.id; formation.generation++;
  formation.respawnAt = null; formation.blockedReason = null;
  enemies.push(...formation.members);
  rebuildForces();
  vehicleRenderer.update(entities.vehicles.values());
  return true;
}

function clearActors(list, preserveCorpses = false) {
  const removed = list.filter(actor => !preserveCorpses || !corpses.has(actor.id));
  nraCharacter?.remove(removed);
  ijaCharacter?.remove(removed);
  for (const actor of removed) {
    grenades.forget(actor.id);
    scene.remove(actor.model);
    const transport = occupiedVehicle(entities, actor);
    if (transport) {
      transport.seats.find(seat => seat.id === actor.seatId).occupantId = null;
      actor.vehicleId = actor.seatId = null;
    }
    entities.soldiers.delete(actor.id);
    entities.weapons.delete(actor.rifle.id);
    entities.weapons.delete(actor.grenades.id);
    entities.weapons.delete(actor.explosivePack.id);
  }
}

function clearTransient() {
  grenades.clear();
  aiThrowReservations.clear();
  grenadeRenderer.clear();
  $('grenade-warning').hidden = true;
  corpseCleanupAt = 0;
  boundaryStates.clear();
  combatEvents.clear();
  battleStats.clear(); scoreboardRevision = -1;
  rifleReports.length = 0;
  rifleAudio?.reset();
  battleVoices?.reset();
  battleReactions?.reset();
  objectiveVoiceTracker.reset();
  combatFeedback.clear(); recoil = 0;
  $('hit-marker').style.opacity = $('damage-vignette').style.opacity = '0';
  combatEffects.clear();
  for (const effect of [...effects]) removeEffect(effect);
  for (const mesh of shellViews.values()) scene.remove(mesh);
  shellViews.clear();
  shells.length = 0;
  projectileImpacts.length = 0;
  projectileSerial = 0;
}

function beginMatch() {
  footstepAudio?.sync(null, false);
  mechanicalAudio?.reset();
  simulationClock.reset(performance.now());
  playerInput.reset(); controlEvents.clear();
  controlBinding = null;
  resetDeathTransfer(deathTransfer);
  if (benchmark) {
    battleRandom = seededRandom(benchmark.seed);
    actorSerial = soundSerial = 0;
    telemetry.reset();
  }
  world.doorSystem.reset();
  coverClaims.clear();
  combatSounds.length = 0;
  for (const key of Object.keys(combatStats)) combatStats[key] = 0;
  clearActors(allies);
  clearActors(enemies);
  clearActors(friendlyAI);
  clearActors([...corpses.values()]); corpses.clear();
  vehicleRenderer.clear();
  resetEntities(entities);
  armorNavigate.reset();
  clearTransient();
  enemies = [];
  allies = [];
  friendlyAI = []; friendlyForces = []; allForces = [];
  pathRequests.clear(); aiCursor = 0;
  resetSpawns();
  pendingSquad = pendingSpawn = null;
  objectives = makeObjectives();
  conquest = createConquest();
  assaultAssignmentAt = 0;
  for (const flag of world.flags) flag.material.color.setHex(0xa19469);
  time = 0;
  remaining = MATCH_SECONDS;
  kills = teamKills = deployments = 0;
  populationRefreshAt = 0;
  playerFootsteps = 0;
  lastFootSurface = null;
  frameTimes.length = 0;
  const playerType = SQUADS[selectedType].type;
  formations = benchmark?.diagnostic ? diagnosticRoster(benchmark.scenario) : battleRoster(playerType);
  for (const formation of formations) { registerUnit(entities, formation); registerBattleScore(formation); }
  if (!benchmark?.diagnostic) validateRoster(formations);
  for (const formation of formations.filter(item => !item.player)) {
    if (!spawnFormation(formation, true)) throw new Error(`开局集结失败：${formation.id}，未减少单位数作为回退`);
  }
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
  if (benchmark?.diagnostic && type !== (['control', 'ford'].includes(benchmark.scenario) ? 'tank' : 'infantry')) { toast('当前诊断场景的出击类型固定；正常出击使用无benchmark参数的网址'); return; }
  const spawn = spawnPoints.find(point => spawnId ? point.id === spawnId : !point.aiOnly && point.team === 'friendly' && point.kind !== 'rally' && supportsSquad(point, type));
  const spawnError = !spawn || spawn.team !== 'friendly' || spawn.aiOnly ? '请选择己方可用重生点' : spawnBlockReason(spawn, type, hostilePositions('friendly'), deploymentObstacles());
  if (spawnError) {
    $('deployment-error').textContent = spawnError;
    toast(spawnError, 4);
    return;
  }
  const formation = formations.find(item => item.player);
  if (!formation) { toast('请从作战部署开始新战局'); return; }
  if (isVehicleUnit(type) && [...entities.vehicles.values()].filter(item => item.team === 'friendly' && item.health > 0).length >= BATTLE_RULES.vehicleLimit) {
    toast('我方载具单位已达到2个上限'); return;
  }
  let positions = [];
  const memberCount = benchmark?.diagnostic ? formation.memberCount : TYPES[type].members;
  const initialPitch = type === 'mortar' ? -.18 : type === 'plane' ? -.14 : 0;
  try {
    if (type !== 'tank' && type !== 'plane') positions = formationPositions(spawn, memberCount, deploymentObstacles(),
      [...friendlyAI, ...enemies].filter(actor => actor.health > 0).map(actor => actor.position), hostilePositions('friendly'));
  } catch (error) {
    if (!(error instanceof FormationPlacementError)) throw error;
    $('deployment-error').textContent = error.message; toast(error.message); return;
  }
  clearActors(allies, true);
  if (weapon) {
    camera.remove(weapon);
    // View models own only their hierarchy; their geometry/materials are shared.
    weapon = null;
  }
  allies = [];
  const active = objectives.find(point => !point.captured);
  deployments++;
  resetDeathTransfer(deathTransfer);
  releaseSupportWeapon(entities, formation);
  formation.type = type; formation.squadId = squadId;
  registerBattleScore(formation);
  if (type === 'mortar') formation.supportWeapon = registerWeapon(entities, { ammo: TYPES.mortar.magazine, nextShot: 0, reloadUntil: 0 },
    `${formation.id}:mortar-${deployments}`, formation.id, 'mortar');
  current = 0;
  for (let i = 0; i < memberCount; i++) {
    const position = type === 'tank' || type === 'plane' ? spawn : positions[i];
    const actor = actorAt(true, position.x, position.z, i, spawn, formation);
    actor.lookPitch = initialPitch;
    actor.health = type === 'tank' ? 100 : TYPES[type].health;
    if (type !== 'infantry') actor.role = type === 'mortar' ? 'mortarman' : type === 'tank' ? 'tanker' : 'pilot';
    actor.targetKind = type === 'tank' ? 'closed-armor' : type === 'plane' ? 'aircraft' : 'person';
    allies.push(actor);
  }
  formation.type = type; formation.members = allies; formation.spawnId = spawn.id; formation.generation++;
  rebuildForces();
  entities.control.unitId = formation.id;
  selectControlledSoldier(entities, allies[0]);
  unit = createControlView(entities);
  controlPose.yaw = 0;
  recoil = 0; resetPersonalCombatFeedback();
  weaponObstruction = obstructionBlend = 0;
  lastRifleTrace = null;
  controlPose.stance = 'standing';
  lean = jumpHeight = jumpVelocity = 0;
  eyeHeight = controlPose.eyeHeight;
  if (type === 'tank' || type === 'plane') {
    const transport = createVehicleEntity(entities, { id: `${formation.id}:vehicle-${deployments}`, unitId: formation.id, type,
      team: 'friendly', position: new THREE.Vector3(spawn.x, type === 'plane' ? spawn.altitude : world.groundHeight(spawn.x, spawn.z), spawn.z) });
    transport.pitch = controlPose.pitch;
    formation.vehicleId = transport.id;
    for (let i = 0; i < allies.length; i++) {
      const reason = seatSoldier(entities, allies[i], transport, transport.seats[i].id);
      if (reason) throw new Error(reason);
    }
    vehicleRenderer.update(entities.vehicles.values(), time, occupiedVehicle(entities, controlledSoldier(entities))?.id);
  }
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
  $('squad-hint').textContent = type === 'plane' ? '单机出击 · 飞机损失后换队' : type === 'infantry' ? '11人班 · 10号狙击手／11号机枪手 · Y换人' : 'Y 切换队员 · 整队阵亡后换队';
  updateControlHelp();
  allies.forEach(actor => { actor.order = 'follow'; });
  $('overlay').hidden = true;
  pendingSquad = pendingSpawn = null;
  setGameState('playing');
  refreshWeaponVisibility();
  bindControlInput();
  hudAt = 0;
  initAudio();
  battleVoiceEvent('deploy');
  lockMouse();
  updateCamera(0);
  renderConstruction();
  toast(type === 'plane' ? '从南侧空中入场点进入战场 · 飞机损失后可换其他小队' : `${TYPES[type].name}从${spawn.name}出击`, 5);
  if ((audioUnsupported || rifleAudioFailure || footstepAudioFailure || mechanicalAudioFailure || battleVoicesFailure || battleReactionsFailure) && !audioWarningShown) {
    const warnings = [];
    if (rifleAudioFailure) warnings.push('步枪录音未加载，暂用原合成声；友军／敌军空间枪声暂不可用');
    if (footstepAudioFailure) warnings.push('脚步录音未加载，暂用原合成声');
    if (mechanicalAudioFailure) warnings.push('步枪机械录音未加载，暂用原合成声');
    if (battleVoicesFailure) warnings.push('战场语音未加载，喊话与指挥提示不可用');
    if (battleReactionsFailure) warnings.push('真人战斗反应录音未加载，短喊与受击人声不可用');
    toast(audioUnsupported ? '浏览器不支持Web Audio，当前无音效' : warnings.join('；'), 8);
    audioWarningShown = true;
  }
  updateHUD();
}

function showOverlay(kind = 'pause') {
  if (kind === 'pause') pausedFrom = state === 'transferring' ? 'transferring' : 'playing';
  else resetDeathTransfer(deathTransfer);
  setGameState(kind);
  releaseMouse();
  $('overlay').hidden = false;
  const ended = ['victory', 'defeat', 'draw'].includes(kind);
  if (ended) battleVoiceEvent(kind, { eventKey: `match:${kind}` });
  const dead = kind === 'dead';
  resetConstruction();
  renderConstruction();
  $('overlay-kicker').textContent = kind === 'victory' ? '作战胜利 / VICTORY' : kind === 'defeat' ? '作战失利 / DEFEAT' : kind === 'draw' ? '战局持平 / DRAW' : dead ? '整队阵亡 / REDEPLOY' : '作战暂停 / PAUSED';
  $('overlay-title').textContent = kind === 'victory' ? '阵地已夺，山河犹在。' : kind === 'defeat' ? '阵地失守，战线未竟。' : kind === 'draw' ? '时间耗尽，双方未分胜负。' : dead ? '重整队伍，再出发。' : '下一步，由你指挥。';
  $('overlay-description').textContent = ended ? `${conquest.dominationTime >= DOMINATION_SECONDS ? '连续控制三点20秒。' : '时间结束：先比较控制点数，同分比较累计控制点秒。'}这是原创玩法演示，不代表真实历史战斗过程。` : dead ? '选择其他小队和可用重生点，再确认出击。战斗与计时仍在继续。' : '三点同时争夺，双方可占领和反夺；连续控制三点20秒获胜。整队阵亡后才能换单位。';
  $('resume').hidden = ended || dead;
  $('redeploy-choices').hidden = !canDeploySquad(kind, allies);
  $('deployment-options').hidden = !dead;
  $('motion-settings').hidden = kind !== 'pause';
  $('quality-settings').hidden = kind !== 'pause';
  pendingSquad = pendingSpawn = null;
  $('deployment-error').textContent = '';
  if (dead) refreshDeployment();
  $('battle-summary').textContent = `个人击倒 ${kills}　友军击倒 ${teamKills}　我方控制 ${objectives.filter(p => p.owner === 'friendly').length}/3 · 日军 ${objectives.filter(p => p.owner === 'enemy').length}/3`;
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
  $('deployment-objective').textContent = `三点争夺 · 我方 ${objectives.filter(point => point.owner === 'friendly').length}/3 · 日军 ${objectives.filter(point => point.owner === 'enemy').length}/3`;
  const pendingType = SQUADS[pendingSquad]?.type;
  $('deployment-selection').textContent = pendingSquad ? `${SQUADS[pendingSquad].name} / ${TYPES[pendingType].weapon}` : '选择其他小队，再选择重生点。';
  const candidates = pendingSquad ? spawnPoints.filter(point => !point.aiOnly && point.team === 'friendly' && supportsSquad(point, pendingType)) : [];
  const hostiles = hostilePositions('friendly');
  const signature = candidates.map(point => point.id).join(',');
  if ($('spawn-choices').dataset.signature !== signature) {
    $('spawn-choices').innerHTML = candidates.map(point => `<button data-spawn="${point.id}"><span>${point.name}</span><small></small></button>`).join('');
    $('spawn-choices').dataset.signature = signature;
  }
  for (const button of $('spawn-choices').querySelectorAll('[data-spawn]')) {
    const point = candidates.find(candidate => candidate.id === button.dataset.spawn);
    const reason = spawnBlockReason(point, pendingType, hostiles, deploymentObstacles());
    button.disabled = Boolean(reason);
    button.classList.toggle('selected', pendingSpawn === point.id);
    button.setAttribute('aria-pressed', String(pendingSpawn === point.id));
    button.querySelector('small').textContent = reason || (point.kind === 'rally' ? `工兵建造 · 耐久 ${Math.ceil(point.health)}` : '默认重生点');
  }
  const selected = candidates.find(point => point.id === pendingSpawn);
  const blocked = selected ? spawnBlockReason(selected, pendingType, hostiles, deploymentObstacles()) : null;
  $('confirm-deploy').disabled = !pendingSquad || !selected || Boolean(blocked);
  $('confirm-deploy').firstChild.textContent = pendingSquad ? `部署${SQUADS[pendingSquad].name} ` : '选择小队后出击 ';
  if (blocked) $('deployment-error').textContent = blocked;
  else if (selected) $('deployment-error').textContent = '';
  drawRadar($('deployment-map').getContext('2d'));
}

function resetConstruction() {
  resetConstructionState(construction);
}

function equipTool(equipped) {
  if (equipped && allies[current]?.role !== 'engineer') {
    toast('只有工兵可以使用建造工具；按 Y 切换队员');
    return;
  }
  resetConstruction();
  grenadeEquipped = false;
  toolEquipped = equipped;
  held.primary = held.aiming = held.secondary = false;
  unit.nextShot = Math.max(unit.nextShot, time + .3);
  syncRifleUnit();
  emitControlEvent('equipment.changed', { equipped });
}

function equipGrenade(kind = 'grenade') {
  throwableProfile(kind);
  const actor = controlledSoldier(entities);
  if (!actor || actor.health <= 0 || actor.vehicleId) { toast('请先离开载具再选择投掷装备'); return; }
  if (throwableStock(actor.grenades, kind) === 0) {
    toast(kind === 'grenade' ? '手榴弹已用完，保持当前装备' : '炸药包已用完，保持当前装备');
    return;
  }
  resetConstruction();
  toolEquipped = false; grenadeEquipped = true;
  selectedThrowable = kind;
  held.primary = held.secondary = held.aiming = false;
  actor.rifleReady = false;
  refreshWeaponVisibility();
  $('weapon-name').textContent = `${kind === 'grenade' ? '手榴弹' : '炸药包'} · 左键准备／松开投掷`;
}

function equipPrimary() {
  grenadeEquipped = false;
  if (unit.type === 'infantry') equipTool(false);
  else {
    held.primary = held.secondary = held.aiming = false;
    refreshControlSurface();
  }
}

function renderEquippedTool() {
  const equipped = toolEquipped;
  if (weapon) camera.remove(weapon);
  weapon = weaponModel(equipped ? 'hammer' : unit.type, allies[current].rifle);
  weapon.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
  camera.add(weapon);
  refreshWeaponVisibility();
  if (!equipped && unit.type === 'infantry') weapon.position.set(.18, -.22, -.14);
  $('weapon-name').textContent = equipped ? '工兵建造工具' : unit.type === 'infantry' ? infantryWeaponProfile(allies[current].rifle).name : TYPES[unit.type].weapon;
}

function completeRally(team, position, builderId) {
  const builder = entities.soldiers.get(builderId);
  if (!builder || builder.team !== team || builder.role !== 'engineer' || builder.health <= 0) throw new Error('A completed rally requires its original living engineer');
  const point = createRallyPoint({ id: `${team}-rally-${++rallySerial}`, team, builderId,
    position: { x: position.x, y: world.groundHeight(position.x, position.z), z: position.z } });
  spawnPoints = replaceTeamRally(spawnPoints, point);
  return point;
}

function damageRally(point, damage, source) {
  const result = damageRallyPoint(point, damage);
  if (result.destroyed) {
    combatEvents.publish('explosion', { position: { x: point.x, y: .7, z: point.z }, source, sound: false }, time);
    controlEvents.publish('rally.destroyed', { rallyId: point.id, builderId: point.builderId, team: point.team,
      position: { x: point.x, y: point.altitude, z: point.z } }, time);
  }
}

function rallyFromHit(hit) {
  const id = hit?.object.userData.rallyId;
  if (!id) return null;
  const point = spawnPoints.find(point => point.id === id && point.kind === 'rally');
  if (!point) throw new Error(`Rally ray hit has no simulation owner: ${id}`);
  return point;
}

function updateConstruction(dt) {
  if (!construction.blueprint) return;
  const actor = controlledSoldier(entities);
  const result = advanceConstruction(construction, { builderId: actor.id, position: actor.position,
    candidate: constructionCandidate(actor.position, controlPose.yaw, world.groundHeight), holding: held.primary,
    allowed: state === 'playing' && actor.health > 0 && !actor.vehicleId && actor.role === 'engineer' && toolEquipped }, dt,
  position => actor.position.y > world.groundHeight(actor.position.x, actor.position.z) + 1
    ? '楼层内暂不支持建造集结点，请返回地面'
    : rallyBuildBlockReason(position, objectives, hostilePositions('friendly'), deploymentObstacles()));
  if (result.completed) {
    const point = completeRally('friendly', result.completed.position, result.completed.builderId);
    held.primary = false;
    emitControlEvent('construction.notice', { reason: 'completed', rallyId: point.id, position: result.completed.position });
  } else if (result.notice) emitControlEvent('construction.notice', { reason: result.notice });
}

function renderConstruction() {
  const visible = toolEquipped && state === 'playing';
  $('construction-panel').hidden = !visible;
  rallyPreview.visible = visible && Boolean(construction.preview);
  if (!visible) return;
  if (construction.preview) {
    rallyPreview.position.copy(construction.preview);
    rallyPreview.traverse(mesh => { if (mesh.isMesh) mesh.material.color.setHex(construction.blockedReason ? 0xd46550 : 0x93c285); });
  }
  $('construction-status').textContent = !construction.blueprint ? '右键选择集结点蓝图'
    : construction.mode === 'building' ? `正在建造集结点 · ${Math.floor(construction.progress / SPAWN_RULES.buildSeconds * 100)}%`
    : construction.blockedReason || '位置可用 · 按住左键建造';
  $('construction-fill').style.width = `${construction.progress / SPAWN_RULES.buildSeconds * 100}%`;
}

function switchMember(index) {
  if (index === current || !allies[index] || allies[index].health <= 0) return;
  interruptGrenade(allies[current]);
  clearControlInputs();
  stopLocomotion(allies[current].locomotion);
  current = index;
  selectControlledSoldier(entities, allies[current]);
  if (!allies[current].vehicleId) allies[current].position.y = world.walkHeight(allies[current].position.x, allies[current].position.z, allies[current].position.y);
  if (allies[current].tactics.cover) coverClaims.delete(allies[current].tactics.cover.id);
  allies[current].tactics.cover = null;
  stopLocomotion(allies[current].locomotion);
  bindControlInput();
  unit.nextShot = Math.max(unit.nextShot, time + .35);
  recoil = 0;
  eyeHeight = controlPose.eyeHeight;
  emitControlEvent('control.changed', { index, reason: state === 'transferring' ? 'death' : 'manual' });
}

function changeMember(index) {
  switchMember(index);
}

function syncRifleUnit() {
  syncControlledRifleTiming(entities, time, toolEquipped);
}

function reload() {
  if (grenadeEquipped) { toast('当前选择投掷装备；按 1 切回主武器'); return; }
  if (allies[current]?.grenades.action) { toast('先完成手榴弹动作再装填'); return; }
  if (unit.type === 'tank' && !occupiedSeat(entities).canFire) {
    toast('驾驶员席位不能装填主炮；按 Y 切换车长或炮手');
    return;
  }
  if (unit.type === 'infantry') {
    if (toolEquipped) { toast('先按 1 收起工具再装填步枪'); return; }
    if (reloadRifle(allies[current].rifle)) emitControlEvent('weapon.reload-requested', {
      weaponId: allies[current].rifle.id, duration: infantryWeaponProfile(allies[current].rifle).reloadSeconds, queued: allies[current].rifle.action === 'cycle' });
    syncRifleUnit();
    return;
  }
  if (unit.reloadUntil || unit.ammo === TYPES[unit.type].magazine) return;
  unit.reloadUntil = time + TYPES[unit.type].reload;
  emitControlEvent('weapon.reload-requested', { weaponId: controlOwner(entities).weaponId, duration: TYPES[unit.type].reload });
}

function hasLine(from, to, maxDistance = 120, ignoreVehicleId = null) {
  vector.copy(to).sub(from);
  const distance = vector.length();
  if (distance > maxDistance) return false;
  ray.set(from, vector.normalize());
  ray.far = Math.max(0, distance - .04);
  const transports = vehicleSolids(ignoreVehicleId, from);
  const blocked = ray.intersectObjects([...solidIndex.candidates(from, ray.ray.direction, distance), ...transports], true).length > 0;
  ray.far = Infinity;
  return !blocked;
}

function tracer(start, end, color = 0xffd49a, life = .08, bornAt = time) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8 }));
  scene.add(line);
  effects.push({ object: line, end: bornAt + life, bornAt, lastAt: bornAt, life, kind: 'line' });
}

function renderImpact(position, bornAt = time) {
  if (!graphics.snapshot.effects.hitParticles) return;
  const mesh = new THREE.Mesh(impactGeometry, new THREE.MeshBasicMaterial({ color: 0xd0ba86, transparent: true, opacity: .85, depthWrite: false }));
  mesh.position.copy(position);
  mesh.scale.setScalar(.12);
  scene.add(mesh);
  effects.push({ object: mesh, end: bornAt + .18, bornAt, lastAt: bornAt, life: .18, kind: 'spark' });
}

function removeEffect(effect) {
  scene.remove(effect.object);
  if (effect.kind === 'line') effect.object.geometry.dispose();
  effect.object.material.dispose();
  effects.splice(effects.indexOf(effect), 1);
}

function acceptedWeaponDamage(weaponKind, targetKind, amount, hitZone = null) {
  const damage = damageForTarget(weaponKind, targetKind, amount, hitZone);
  if (amount > 0 && damage === 0 && weaponKind === 'rifle') {
    if (targetKind === 'closed-armor') combatStats.rejectedRifleArmorDamage++;
    if (targetKind === 'aircraft') combatStats.rejectedRifleAircraftDamage++;
  }
  return damage;
}

function hurt(actor, damage, source, weaponKind = 'rifle', hitZone = null) {
  if (actor.health <= 0 || !['playing', 'transferring', 'dead'].includes(state)) return;
  damage = acceptedWeaponDamage(weaponKind, actor.targetKind, damage, hitZone);
  if (damage === 0) return;
  const transport = occupiedVehicle(entities, actor);
  if (transport) {
    damageVehicle(transport, damage, source, weaponKind);
    return;
  }
  const previous = actor.health;
  actor.health = Math.max(0, previous - damage);
  actor.lastHit = { time, hitZone, damage: previous - actor.health, weaponKind };
  if (weaponKind !== 'boundary') {
    actor.tactics.suppressedUntil = time + 4;
    if (actor.friendly) actor.tactics.decisionAt = Math.min(actor.tactics.decisionAt, time + .1);
  }
  const selected = actor === controlledSoldier(entities);
  if (previous > actor.health) combatEvents.publish('damage', { source, target: { kind: 'soldier', id: actor.id, unitId: actor.unitId, team: actor.team },
    amount: previous - actor.health, health: actor.health, observerId: selected ? actor.id : null, hitZone }, time);
  if (selected && actor.health === 0) {
    beginDeathFeedback(actor, weaponKind === 'boundary' ? '脱离战区' : ['explosion', 'grenade', 'explosive-pack'].includes(weaponKind) ? '爆炸' : '中弹');
  }
  if (actor.health === 0) finishActorDeath(actor, source);
}

function finishActorDeath(actor, source) {
  if (!actor.deathProcessed) {
    interruptGrenade(actor);
    actor.deathProcessed = true;
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.deathTime = time;
    actor.deathSource = typeof source === 'object' ? source : null;
    if (!actor.vehicleId) {
      actor.position.y = world.walkHeight(actor.position.x, actor.position.z, actor.position.y);
      const dropSide = actor.tactics.id % 2 ? .65 : -.65, c = Math.cos(actor.heading), s = Math.sin(actor.heading);
      const drop = circleBlocked(actor.position.x + dropSide * c, actor.position.z - dropSide * s, .12,
        movementObstacles(actor.position.x, actor.position.z)) ? [0, .05, 0] : [dropSide, .05, 0];
      actor.casualty = createCasualtyState(actor, time, actor.nativeMotion ? sampleNraMotion(actor) : null, { drop });
      const factory = actor.team === 'friendly' ? nraCharacter : ijaCharacter;
      if (factory && actor.nativeMotion) {
        const obstacles = movementObstacles(actor.position.x, actor.position.z);
        actor.casualty = placeCasualty(actor, actor.casualty, (variant, retain) => factory.casualtyBounds(variant, retain),
          (point, radius, height) => circleBlocked(point.x, point.z, radius, obstacles, point.y, height));
        if (actor.casualty.wallLimited) console.warn(`No collision-free falling pose for ${actor.id}; retaining a wall-constrained casualty pose`);
      }
      corpses.set(actor.id, actor);
    }
    if (!actor.friendly) {
      const credit = source?.credit ?? source;
      if (credit === 'player') kills++;
      else if (credit === 'ally') teamKills++;
    }
    combatEvents.publish('casualty', { source, target: { kind: 'soldier', id: actor.id, unitId: actor.unitId, team: actor.team }, health: 0 }, time);
  }
}

function damageVehicle(transport, damage, source, weaponKind) {
  damage = acceptedWeaponDamage(weaponKind, transport.type === 'tank' ? 'closed-armor' : 'aircraft', damage);
  if (damage === 0) return;
  if (source === 'crash') source = Object.freeze({ credit: 'environment', cause: 'crash', vehicleId: transport.id });
  const observer = controlledSoldier(entities);
  const observerId = observer?.health > 0 && occupiedVehicle(entities, observer)?.id === transport.id ? observer.id : null;
  const result = damageVehicleEntity(entities, transport, damage);
  if (result.damage > 0) combatEvents.publish('damage', { source,
    target: { kind: 'vehicle', id: transport.id, unitId: transport.unitId, team: transport.team },
    amount: result.damage, health: transport.health, observerId }, time);
  for (const actor of result.casualties) {
    finishActorDeath(actor, source);
    if (actor === allies[current]) beginDeathFeedback(actor, weaponKind === 'boundary' ? '脱离战区' : result.destroyed ? '载具被毁' : '车组成员阵亡');
  }
  if (result.destroyed) {
    transport.destroyedAt = time;
    combatEvents.publish('explosion', { position: transport.position.clone().add(new THREE.Vector3(0, 1.5, 0)),
      source, sound: transport.type === 'tank', style: transport.type === 'tank' ? 'tank-destruction' : 'default' }, time);
  }
}

function beginDeathFeedback(actor, reason) {
  if (state === 'pause' || state === 'menu') return;
  startDeathTransfer(deathTransfer, actor.id, reason);
  clearControlInputs();
  stopLocomotion(actor.locomotion);
  setGameState('transferring');
  emitControlEvent('death.started', { reason });
}

function updateDeathFeedback(dt) {
  if (state !== 'transferring') return;
  const event = advanceDeathTransfer(deathTransfer, dt);
  if (event === 'handoff') {
    const next = nextAlive(allies, current);
    if (next >= 0 && allies[next].health > 0) changeMember(next);
    else {
      resetDeathTransfer(deathTransfer);
      showOverlay('dead');
      return;
    }
  } else if (event === 'complete') {
    if (allies[current]?.health <= 0) {
      const next = nextAlive(allies, current);
      if (next < 0) { showOverlay('dead'); return; }
      changeMember(next);
    }
    setGameState('playing');
    clearControlInputs();
    bindControlInput();
    emitControlEvent('death.completed');
  }
}

function renderDeathFeedback() {
  const mask = deathTransferMask(deathTransfer), element = $('death-transfer');
  element.hidden = !deathTransfer.active;
  element.style.opacity = String(mask.opacity);
  const red = graphics.snapshot.effects.damageVignette ? mask.red : 0;
  element.style.background = `linear-gradient(rgba(5,5,5,${mask.dark}),rgba(5,5,5,${mask.dark})),radial-gradient(ellipse at center,rgba(65,0,0,${red * .5}),rgba(100,0,0,${red}))`;
  $('death-transfer-label').textContent = deathTransfer.handedOff ? '正在接管存活队员' : `当前队员阵亡 · ${deathTransfer.reason}`;
}

function explode(position, damage, radius, source, weaponKind = 'explosion') {
  combatEvents.publish('explosion', { position, source, sound: true, radius,
    style: weaponKind === 'explosive-pack' ? 'explosive-pack' : 'default' }, time);
  for (const transport of entities.vehicles.values()) {
    if (transport.health <= 0) continue;
    if (weaponKind === 'grenade') continue;
    if (weaponKind === 'explosive-pack') {
      const applied = throwableVehicleDamage(weaponKind, source, transport, position,
        (from, to, maxDistance) => hasLine(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z), maxDistance, transport.id));
      if (applied > 0) damageVehicle(transport, applied, source, weaponKind);
      continue;
    }
    const target = transport.position.clone().add(new THREE.Vector3(0, 1, 0));
    const distance = target.distanceTo(position), origin = position.clone();
    origin.y = Math.max(origin.y, .5);
    if (distance < radius && hasLine(origin, target, radius + 1, transport.id)) damageVehicle(transport, blastDamage(distance, radius, damage), source, 'explosion');
  }
  for (const actor of allForces) {
    if (actor.health <= 0) continue;
    if (actor.vehicleId) continue;
    if (['grenade', 'explosive-pack'].includes(weaponKind) && !grenadeCanDamage(source, actor, weaponKind)) continue;
    const target = actor.position.clone();
    target.y += ['grenade', 'explosive-pack'].includes(weaponKind) ? soldierPostureHeight(actor, 'aim') : 1;
    const d = target.distanceTo(position);
    // Walls shield units from blast; raise the ray above ground to avoid self-occlusion.
    const origin = position.clone();
    origin.y = Math.max(origin.y, .5);
    if (d < radius && hasLine(origin, target, radius + 1)) hurt(actor, blastDamage(d, radius, damage), source, weaponKind);
  }
  for (const point of spawnPoints.filter(point => point.kind === 'rally' && point.health > 0)) {
    if (['grenade', 'explosive-pack'].includes(weaponKind) && point.team === source.team) continue;
    const target = new THREE.Vector3(point.x, point.altitude + .8, point.z);
    const distance = target.distanceTo(position);
    const origin = position.clone();
    origin.y = Math.max(.5, origin.y);
    if (distance < radius && hasLine(origin, target, radius + 1)) damageRally(point, blastDamage(distance, radius, damage), source);
  }
}

function traceGrenade(from, to, radius) {
  const start = new THREE.Vector3(from.x, from.y, from.z), delta = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = delta.length();
  if (length < 1e-8) return null;
  const travel = delta.clone().normalize(), transports = vehicleSolids();
  let closest = null, distance = length + 1;
  // Sample the small projectile's extent as well as its centre, including thin walls and doors.
  for (const offset of [[0, 0, 0], [radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, -radius, 0], [0, 0, radius], [0, 0, -radius]]) {
    const origin = start.clone().add(new THREE.Vector3(...offset));
    ray.set(origin, travel); ray.far = length;
    const hit = ray.intersectObjects([...solidIndex.candidates(origin, travel, length), ...transports], true)[0];
    if (hit && hit.distance < distance) {
      distance = hit.distance;
      closest = { position: start.clone().addScaledVector(travel, distance), normal: captureImpact(hit, travel).normal,
        vehicleId: hit.object.userData.vehicleId ?? null };
    }
  }
  ray.far = Infinity;
  const clearance = fraction => {
    const x = from.x + delta.x * fraction, z = from.z + delta.z * fraction;
    return from.y + delta.y * fraction - radius - world.groundHeight(x, z);
  };
  if (clearance(1) < 0) {
    let low = 0, high = 1;
    for (let i = 0; i < 10; i++) {
      const middle = (low + high) / 2;
      if (clearance(middle) > 0) low = middle; else high = middle;
    }
    if (length * high <= distance) {
      const position = start.clone().addScaledVector(delta, high);
      position.y = world.groundHeight(position.x, position.z) + radius;
      const slopeX = (world.groundHeight(position.x + .02, position.z) - world.groundHeight(position.x - .02, position.z)) / .04;
      const slopeZ = (world.groundHeight(position.x, position.z + .02) - world.groundHeight(position.x, position.z - .02)) / .04;
      closest = { position, normal: new THREE.Vector3(-slopeX, 1, -slopeZ).normalize() };
    }
  }
  return closest;
}

function grenadeThrowPose(id, action) {
  const actor = entities.soldiers.get(id);
  if (!actor) throw new Error(`Missing grenade holder: ${id}`);
  const eye = soldierEyePosition(actor), pose = grenadePose(action, soldierPostureHeight(actor));
  const c = Math.cos(actor.heading), s = Math.sin(actor.heading), [x, y, z] = pose.position;
  const position = new THREE.Vector3(actor.position.x + x * c + z * s,
    actor.position.y + y + (actor === controlledSoldier(entities) ? jumpHeight : 0), actor.position.z - x * s + z * c);
  const origin = new THREE.Vector3(eye.x, eye.y + (actor === controlledSoldier(entities) ? jumpHeight : 0), eye.z);
  const hit = traceGrenade(origin, position, throwableProfile(action.kind).size);
  if (hit) position.copy(hit.position).addScaledVector(new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), .002);
  const direction = actor === controlledSoldier(entities) ? camera.getWorldDirection(new THREE.Vector3())
    : action.aiDirection ? new THREE.Vector3(action.aiDirection.x, action.aiDirection.y, action.aiDirection.z)
    : new THREE.Vector3(-s * Math.cos(actor.lookPitch), Math.sin(actor.lookPitch), -c * Math.cos(actor.lookPitch));
  return { position, direction };
}

function interruptGrenade(actor) {
  const action = actor?.grenades.action;
  if (action && action.phase !== 'recovering') action.position = grenadeThrowPose(actor.id, action).position;
  if (actor) grenades.interrupt(actor.id);
}

function tryAIThrowable(actor, target, dt) {
  const tactics = actor.tactics;
  if (!tactics.throwIntent && time < (tactics.throwDecisionAt ?? 0)) return false;
  const eye = soldierEyePosition(actor), origin = new THREE.Vector3(eye.x, eye.y, eye.z);
  const visible = candidate => hasLine(origin, new THREE.Vector3(candidate.position.x,
    candidate.position.y + (candidate.kind === 'armor' ? 1 : .6), candidate.position.z), 30, candidate.vehicleId);
  if (!tactics.throwIntent) {
    tactics.throwDecisionAt = time + 1.1 + tactics.id % 7 * .09;
    const targets = [];
    const armor = tactics.seenArmor && time - tactics.seenArmor.time < 1.5
      ? entities.vehicles.get(tactics.seenArmor.vehicleId) : null;
    if (armor?.health > 0 && armor.team !== actor.team) targets.push({
      id: armor.id, kind: 'armor', vehicleId: armor.id, position: { ...armor.position } });
    if (target?.health > 0 && !target.vehicleId) targets.push({
      id: target.id, kind: 'person', position: { ...target.position } });
    const choice = chooseAIThrowable(actor, targets.filter(visible), allForces.filter(other => other.team === actor.team));
    if (!choice || choice.kind === 'grenade' && time < (actor.formation.nextThrowableAt ?? 0)) return false;
    const key = `${actor.team}:${choice.target.id}`, reservation = aiThrowReservations.get(key);
    if (reservation && reservation.until > time && reservation.actorId !== actor.id) return false;
    aiThrowReservations.set(key, { actorId: actor.id, until: time + 2.5 });
    tactics.throwIntent = { ...choice, key, expires: time + 2 };
  }
  const intent = tactics.throwIntent;
  const live = intent.target.kind === 'armor' ? entities.vehicles.get(intent.target.id) : entities.soldiers.get(intent.target.id);
  const currentTarget = live ? { ...intent.target, position: { ...live.position } } : null;
  if (!live || live.health <= 0 || time > intent.expires || !visible(currentTarget) ||
    !throwableStock(actor.grenades, intent.kind)) {
    tactics.throwIntent = null;
    if (aiThrowReservations.get(intent.key)?.actorId === actor.id) aiThrowReservations.delete(intent.key);
    return false;
  }
  intent.target = currentTarget;
  actor.rifleReady = false;
  resetAIRifleAim(actor.aiRifle, 'throwable');
  tactics.mode = intent.kind === 'explosive-pack' ? 'prepare-anti-tank-pack' : 'prepare-grenade';
  const heading = Math.atan2(actor.position.x - intent.target.position.x, actor.position.z - intent.target.position.z);
  if (!advanceAITurn(actor, heading, dt).facing) return true;
  const profile = throwableProfile(intent.kind), launch = grenadeThrowPose(actor.id,
    { kind: intent.kind, phase: 'throwing', elapsed: profile.windup }).position;
  const point = { ...intent.target.position, y: world.groundHeight(intent.target.position.x, intent.target.position.z) + profile.size };
  const plan = planAIThrow(launch, point, intent.kind, traceGrenade, intent.target.vehicleId);
  if (!plan) { tactics.throwIntent = null; aiThrowReservations.delete(intent.key); return false; }
  const source = captureAttackSource(entities, actor, intent.kind === 'grenade' ? actor.grenades : actor.explosivePack);
  const reason = grenades.begin(actor.id, actor.grenades, source, time, intent.kind);
  if (reason) { tactics.throwRejection = reason; tactics.throwIntent = null; aiThrowReservations.delete(intent.key); return false; }
  const action = actor.grenades.action;
  action.aiDirection = Object.freeze({ ...plan.direction }); action.aiTargetId = intent.target.id;
  action.aiLanding = Object.freeze({ ...plan.landing }); actor.lookPitch = plan.pitch;
  action.position = grenadeThrowPose(actor.id, action).position;
  grenades.release(actor.id, time);
  aiThrowReservations.set(intent.key, { actorId: actor.id, until: time + profile.draw + profile.fuse + 1 });
  actor.formation.nextThrowableAt = time + 5;
  tactics.throwIntent = null;
  return true;
}

function prepareGrenade() {
  const actor = controlledSoldier(entities);
  if (!actor || actor.health <= 0) return;
  if (actor.vehicleId) { toast('车内不能投掷；先离开地面载具'); return; }
  if (!grenadeEquipped) return;
  if (actor.grenades.action) { toast('正在准备或投掷'); return; }
  startThrowableAction(actor, selectedThrowable);
}

function startThrowableAction(actor, kind) {
  const source = captureAttackSource(entities, actor, kind === 'explosive-pack' ? actor.explosivePack : actor.grenades);
  const reason = grenades.begin(actor.id, actor.grenades, source, time, kind);
  if (reason) { toast(reason); return; }
  held.primary = held.secondary = held.aiming = false;
  resetConstruction();
  toolEquipped = false; grenadeEquipped = true; selectedThrowable = kind;
  $('weapon-name').textContent = `${kind === 'grenade' ? '手榴弹' : '炸药包'} · 左键准备／松开投掷`;
  actor.rifleReady = false;
  const action = actor.grenades.action;
  action.position = grenadeThrowPose(actor.id, action).position;
  refreshWeaponVisibility();
}

function updateGrenades(dt) {
  grenades.advance(time, dt, {
    pose: grenadeThrowPose, trace: traceGrenade,
    primed: () => sound('click'),
    explode: event => {
      const profile = throwableProfile(event.kind);
      explode(new THREE.Vector3(event.position.x, event.position.y, event.position.z), profile.damage, profile.radius, event.source, event.kind);
    },
  });
  const actor = controlledSoldier(entities);
  if (state === 'playing' && grenadeEquipped && actor?.health > 0 && !actor.vehicleId &&
    !actor.grenades.action && throwableStock(actor.grenades, selectedThrowable) === 0) equipPrimary();
  refreshWeaponVisibility();
}

function renderGrenades() {
  const actor = controlledSoldier(entities);
  grenadeRenderer.update(grenades.active, actor, state === 'playing', grenadeEquipped, selectedThrowable);
  const action = actor?.grenades.action, label = $('grenade-status'), warning = $('grenade-warning');
  $('equipment-slots').hidden = !actor || Boolean(actor.vehicleId);
  label.hidden = !actor || Boolean(actor.vehicleId) || !action;
  const pack = (action?.kind ?? selectedThrowable) === 'explosive-pack', name = pack ? '炸药包' : '手榴弹';
  const count = pack ? actor?.grenades.packs ?? 0 : actor?.grenades.ammo ?? 0;
  label.textContent = action ? `${name} ${count} · ${action.phase === 'drawing' ? '准备中' :
    action.phase === 'cooking' ? '已拉弦 · 松开左键投掷' : action.phase === 'throwing' ? '投掷中' : '收回手臂'}`
    : `5 手雷 ${actor?.grenades.ammo ?? 0}/1 · 6 炸药包 ${actor?.grenades.packs ?? 0}/1${grenadeEquipped ? ' · 左键投掷' : ''}`;
  for (const element of document.querySelectorAll('[data-equipment-slot]')) {
    const slot = Number(element.dataset.equipmentSlot);
    const active = slot === (grenadeEquipped ? selectedThrowable === 'explosive-pack' ? 6 : 5 : toolEquipped ? 2 : 1);
    element.classList.toggle('selected', active); element.setAttribute('aria-current', String(active));
    if (slot === 5 || slot === 6) {
      const count = (slot === 5 ? actor?.grenades.ammo : actor?.grenades.packs) ?? 0;
      element.querySelector('.equipment-count').textContent = String(count);
      element.setAttribute('aria-label', `${slot} ${slot === 5 ? '手榴弹' : '炸药包'} ${count}/1`);
    }
  }
  const eye = actor ? soldierEyePosition(actor) : null;
  const nearby = state === 'playing' && actor?.health > 0 && !actor.vehicleId ? grenades.active.filter(grenade =>
    grenade.detonateAt !== null && grenade.holderId !== actor.id && grenadeCanDamage(grenade.source, actor, grenade.kind) &&
    Math.hypot(grenade.position.x - actor.position.x, grenade.position.z - actor.position.z,
      grenade.position.y - actor.position.y) < throwableProfile(grenade.kind).radius &&
    hasLine(new THREE.Vector3(eye.x, eye.y, eye.z),
      new THREE.Vector3(grenade.position.x, grenade.position.y + .08, grenade.position.z), throwableProfile(grenade.kind).radius + 2))
    .sort((a, b) => a.detonateAt - b.detonateAt)[0] : null;
  warning.hidden = !nearby;
  warning.textContent = nearby ? `${nearby.kind === 'explosive-pack' ? '炸药包' : '手榴弹'}危险 · 无法回掷，立即寻找掩护` : '';
}

function fire() {
  if (state !== 'playing' || allies[current]?.health <= 0) return;
  if (grenadeEquipped || allies[current].grenades.action) return;
  const transport = occupiedVehicle(entities, allies[current]);
  if (transport && !occupiedSeat(entities).canFire) {
    toast('驾驶员席位不能发射主炮；按 Y 切换车长或炮手');
    return;
  }
  const motion = allies[current].locomotion;
  if ((unit.type === 'infantry' || unit.type === 'mortar') && (motion.sprinting || motion.aimRecovery > 0)) return;
  if (unit.type === 'mortar' && shells.length >= PROJECTILE_LIMIT) { toast('在飞炮弹已达上限，请等待弹着后再射击'); return; }
  if (unit.type === 'infantry') {
    if (time < unit.nextShot) return;
    if (weaponObstruction > 0 || obstructionBlend > .03) { toast('枪口受阻 · 后退或移开枪口'); return; }
    if (!shootRifle(allies[current].rifle)) { syncRifleUnit(); return; }
    if (infantryWeaponProfile(allies[current].rifle).scoped) held.primary = false;
    syncRifleUnit();
  } else if (!shotState(unit, time, true)) return;
  const source = captureAttackSource(entities, allies[current]);
  combatSounds.push({ id: ++soundSerial, friendly: true, x: camera.position.x, y: camera.position.y, z: camera.position.z, time, radius: unit.type === 'infantry' ? 55 : 85 });
  if (combatSounds.length > 32) combatSounds.shift();
  camera.getWorldDirection(direction);
  const start = camera.position.clone();
  if (unit.type === 'mortar') {
    const target = getMortarTarget();
    combatEvents.publish('shot', { source, weaponType: unit.type, start, end: null, sound: 'blast', recoil: .05 }, time);
    const shell = createProjectile({ id: `shell-${++projectileSerial}`, source, start, target,
      firedAt: time, duration: 1.6 + target.distanceTo(start) / 35, damage: TYPES.mortar.damage, radius: 13 });
    const mesh = new THREE.Mesh(projectileGeometry, shellMaterial);
    mesh.userData.projectileId = shell.id;
    mesh.position.copy(shell.position);
    scene.add(mesh);
    shellViews.set(shell.id, mesh);
    shells.push(shell);
  } else {
    ray.set(start, direction);
    ray.far = unit.type === 'plane' ? 260 : RIFLE.range;
    const endOfRay = start.clone().addScaledVector(direction, ray.far);
    const enemyTargets = actorGrid.near(start.x, start.z, ray.far).filter(actor => !actor.friendly && !actor.vehicleId && actor.health > 0 && pointSegmentDistance(actor.position, start, endOfRay).distance < 2);
    const enemyModels = enemyTargets.map(actor => soldierHits.sync(actor, time));
    const rallyTargets = rallyRenderer.targets(spawnPoints);
    const targets = [...solidIndex.candidates(start, direction, ray.far), ...vehicleSolids(transport?.id), ...enemyModels, ...rallyTargets];
    let hit = ray.intersectObjects(targets, true)[0];
    const end = hit ? hit.point : start.clone().addScaledVector(direction, ray.far);
    const cannonPoint = unit.type === 'tank' ? tankCannonPose(transport).start : null;
    const muzzle = unit.type === 'infantry' ? weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3())
      : cannonPoint ? new THREE.Vector3(cannonPoint.x, cannonPoint.y, cannonPoint.z)
      : new THREE.Vector3(.28, -.25, -1.25).applyMatrix4(camera.matrixWorld);
    if (unit.type === 'infantry' || unit.type === 'tank') {
      // Aim at the sight ray's target, but resolve the shot from the physical muzzle.
      const travel = end.clone().sub(muzzle);
      if (travel.dot(direction) <= 0) travel.copy(direction);
      ray.set(muzzle, travel.normalize()); ray.far = RIFLE.range;
      hit = ray.intersectObjects([...solidIndex.candidates(muzzle, travel, ray.far), ...vehicleSolids(transport?.id), ...enemyModels, ...rallyTargets], true)[0];
      end.copy(hit ? hit.point : muzzle.clone().addScaledVector(travel, ray.far));
      if (unit.type === 'tank') {
        const ground = travel.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
        if (ground && ground.distanceTo(muzzle) < end.distanceTo(muzzle)) { end.copy(ground); hit = null; }
        transport.weapon.lastShot = Object.freeze({ time, start: Object.freeze(muzzle.toArray()), end: Object.freeze(end.toArray()) });
      } else lastRifleTrace = { start: muzzle.toArray(), end: end.toArray(), time, hit: Boolean(hit), doorId: hit?.object.userData.doorIds?.[hit.instanceId] || null,
        targetId: hit?.object.userData.actor?.id ?? null, hitZone: hit?.object.userData.hitZone ?? null,
        bodyPart: hit?.object.userData.bodyPart ?? null,
        rallyId: hit?.object.userData.rallyId || null, vehicleId: hit?.object.userData.vehicleId || null };
    }
    combatEvents.publish('shot', { source, weaponType: unit.type, start: muzzle, end, muzzle: ['infantry', 'tank'].includes(unit.type),
      automatic: unit.type === 'infantry' && infantryWeaponProfile(allies[current].rifle).automatic,
      sound: unit.type === 'tank' ? 'blast' : 'shot', recoil: unit.type === 'tank' ? .04 : .05 }, time);
    const hitRally = rallyFromHit(hit);
    for (const enemy of enemies) {
      if (enemy.health > 0 && pointSegmentDistance(enemy.position, muzzle, end).distance < 2.2) {
        enemy.tactics.suppressedUntil = time + 3;
        enemy.tactics.decisionAt = Math.min(enemy.tactics.decisionAt, time);
      }
    }
    if (unit.type === 'tank') {
      if (hit?.object.userData.actor) hurt(hit.object.userData.actor, TYPES.tank.damage, source, 'cannon');
      if (hitRally) damageRally(hitRally, TYPES.tank.damage, source);
      explode(end, TYPES.tank.damage, 11, source);
    } else if (hit) {
      const impact = hit.object.userData.actor ? { position: end, kind: null } : captureImpact(hit, end.clone().sub(muzzle).normalize());
      combatEvents.publish('impact', { ...impact, source }, time);
      if (hit.object.userData.vehicleId) {
        const hitVehicle = entities.vehicles.get(hit.object.userData.vehicleId);
        damageVehicle(hitVehicle, TYPES[unit.type].damage, source, unit.type === 'plane' ? 'aircraft-gun' : 'rifle');
      }
      if (hit.object.userData.actor) {
        hurt(hit.object.userData.actor, TYPES[unit.type].damage, source, unit.type === 'plane' ? 'aircraft-gun' : 'rifle', hit.object.userData.hitZone);
      }
      if (hitRally) damageRally(hitRally, TYPES[unit.type].damage, source);
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

function updateJapaneseArmor(transport, dt) {
  const vehicles = [...entities.vehicles.values()];
  const objective = objectives.find(point => !point.captured) ?? objectives[0];
  const crew = transport.seats.map(seat => entities.soldiers.get(seat.occupantId)).filter(actor => actor?.health > 0);
  const gunner = transport.seats.filter(seat => seat.canFire).map(seat => entities.soldiers.get(seat.occupantId)).find(actor => actor?.health > 0);
  const shot = advanceChiHaAI(transport, dt, time, {
    crew, canFire: Boolean(gunner), targets: friendlyForces, objective,
    destination: chiHaObjectiveDestination(entities.units.get(transport.unitId).index - 8, objective),
    visible: (from, to) => hasLine(new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z), CHI_HA.range + 5, transport.id),
    safeToFire: (from, to) => !enemies.some(actor => actor.health > 0 && !actor.vehicleId &&
      (Math.hypot(actor.position.x - to.x, actor.position.z - to.z) < CHI_HA.blastRadius + 1 ||
        pointSegmentDistance(actor.position, from, to).distance < 1.2)),
    pathTo: (from, to) => armorNavigate.pathTo(transport, to, vehicles),
    canTravel: (from, to) => armorNavigate.canTravel(transport, from, to, vehicles),
    move: (position, dx, dz) => {
      const scale = world.waterDepth(position.x, position.z) > .05 ? RIVER.tankSpeed : 1;
      return armorNavigate.move(transport, dx * scale, dz * scale, vehicles);
    },
  });
  transport.position.y = world.groundHeight(transport.position.x, transport.position.z);
  const machineGunShots = advanceChiHaMachineGuns(transport, dt, time, {
    crew, targets: friendlyForces, busyCrewIds: shot ? [gunner.id] : [],
    aimPoint: actor => ({ x: actor.position.x, y: actor.position.y + soldierPostureHeight(actor, 'aim'), z: actor.position.z }),
    visible: (from, to) => hasLine(new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z), CHI_HA_MG.range + 2, transport.id),
    safeToFire: (from, to) => !enemies.some(actor => actor.health > 0 && !actor.vehicleId &&
      pointSegmentDistance(actor.position, from, to).distance < .8),
  });
  for (const machineGunShot of machineGunShots) fireTankMachineGun(transport, machineGunShot);
  if (!shot) return;
  const source = captureAttackSource(entities, gunner, transport.weapon);
  const start = new THREE.Vector3(shot.start.x, shot.start.y, shot.start.z);
  const travel = new THREE.Vector3(-Math.sin(transport.turretYaw) * Math.cos(transport.turretPitch),
    Math.sin(transport.turretPitch), -Math.cos(transport.turretYaw) * Math.cos(transport.turretPitch));
  const endOfRay = start.clone().addScaledVector(travel, CHI_HA.range);
  const people = allForces.filter(actor => actor.health > 0 && !actor.vehicleId &&
    pointSegmentDistance(actor.position, start, endOfRay).distance < 2).map(actor => soldierHits.sync(actor, time));
  ray.set(start, travel); ray.far = CHI_HA.range;
  const hit = ray.intersectObjects([...solidIndex.candidates(start, travel, CHI_HA.range),
    ...vehicleSolids(transport.id), ...people, ...rallyRenderer.targets(spawnPoints)], true)[0];
  // The target point may be below a standing body's proxy; ground contact still ends the shell.
  const groundHit = travel.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
  let end = hit ? hit.point : endOfRay;
  if (groundHit && groundHit.distanceTo(start) < end.distanceTo(start)) end = groundHit;
  ray.far = Infinity;
  combatEvents.publish('shot', { source, weaponType: 'tank', start, end, sound: 'blast', recoil: 0 }, time);
  combatSounds.push({ id: ++soundSerial, friendly: false, x: start.x, y: start.y, z: start.z, time, radius: 85 });
  if (combatSounds.length > 32) combatSounds.shift();
  explode(end, CHI_HA.damage, CHI_HA.blastRadius, source);
}

function fireTankMachineGun(transport, shot) {
  const settings = shot.gun.settings, friendly = transport.team === 'friendly';
  const source = captureAttackSource(entities, shot.operator, shot.gun);
  const start = new THREE.Vector3(shot.start.x, shot.start.y, shot.start.z);
  const yaw = shot.yaw + (battleRandom() * 2 - 1) * settings.spread;
  const pitch = shot.pitch + (battleRandom() * 2 - 1) * settings.spread;
  const travel = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const endOfRay = start.clone().addScaledVector(travel, settings.range);
  const people = allForces.filter(actor => actor.health > 0 && !actor.vehicleId &&
    pointSegmentDistance(actor.position, start, endOfRay).distance < 2).map(actor => soldierHits.sync(actor, time));
  ray.set(start, travel); ray.far = settings.range;
  let hit = ray.intersectObjects([...solidIndex.candidates(start, travel, settings.range),
    ...vehicleSolids(transport.id), ...people, ...rallyRenderer.targets(spawnPoints)], true)[0];
  const groundHit = travel.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
  let end = hit ? hit.point : endOfRay;
  if (groundHit && groundHit.distanceTo(start) < end.distanceTo(start)) { end = groundHit; hit = null; }
  ray.far = Infinity;
  combatEvents.publish('shot', { source, weaponType: 'infantry', start, end, sound: 'shot', muzzle: true, automatic: true,
    color: friendly ? 0xf6d399 : 0xdfb17a }, time);
  combatSounds.push({ id: ++soundSerial, friendly, x: start.x, y: start.y, z: start.z, time, radius: 40 });
  if (combatSounds.length > 32) combatSounds.shift();
  if (!hit) return;
  const actor = hit.object.userData.actor;
  const impact = actor ? { position: end, kind: null } : captureImpact(hit, travel);
  combatEvents.publish('impact', { ...impact, source }, time);
  if (actor && actor.team !== transport.team) hurt(actor, settings.damage, source, 'rifle', hit.object.userData.hitZone);
  const vehicle = entities.vehicles.get(hit.object.userData.vehicleId);
  if (vehicle && vehicle.team !== transport.team) damageVehicle(vehicle, settings.damage, source, 'rifle');
  const rally = spawnPoints.find(point => point.id === hit.object.userData.spawnId);
  if (rally && rally.team !== transport.team) damageRally(rally, settings.damage, source);
}

function updateVehicles(dt) {
  for (const transport of entities.vehicles.values()) {
    if (transport.health <= 0) {
      if (time - transport.destroyedAt > 30 && !transport.seats.some(seat => entities.soldiers.has(seat.occupantId))) {
        entities.vehicles.delete(transport.id); entities.weapons.delete(transport.weapon.id);
        for (const gun of transport.machineGuns ?? []) entities.weapons.delete(gun.id);
      }
      continue;
    }
    if (transport.variant === CHI_HA.id) {
      updateJapaneseArmor(transport, dt);
      for (const seat of transport.seats) {
        const occupant = entities.soldiers.get(seat.occupantId);
        if (occupant) occupant.position.copy(transport.position);
      }
      continue;
    }
    const actor = allies[current];
    const controlled = state === 'playing' && actor?.health > 0 && actor.vehicleId === transport.id;
    const forward = controlled ? Number(keys.has('KeyW')) - Number(keys.has('KeyS')) : 0;
    const sideways = controlled ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : 0;
    transport.roll = transport.type === 'plane' ? -sideways * .2 : 0;
    const position = transport.position;
    if (transport.type === 'plane') {
      if (controlled) {
        transport.throttle = THREE.MathUtils.clamp(transport.throttle + forward * dt * .35, .6, 1.5);
        transport.heading -= sideways * dt * .7;
      }
      const speed = TYPES.plane.speed * transport.throttle;
      position.x -= Math.sin(transport.heading) * speed * dt * Math.cos(transport.pitch);
      position.z -= Math.cos(transport.heading) * speed * dt * Math.cos(transport.pitch);
      position.y += Math.sin(transport.pitch) * speed * dt;
      if (controlled && keys.has('Space')) position.y += dt * 9;
      if (controlled && keys.has('ControlLeft')) position.y -= dt * 9;
      position.y = Math.min(position.y, 90);
      const colliding = world.obstacles.some(b => position.x > b.minX - 1 && position.x < b.maxX + 1 && position.z > b.minZ - 1 && position.z < b.maxZ + 1 && position.y < b.height + 1);
      if (position.y < 1.8 || colliding) { damageVehicle(transport, transport.health, 'crash', 'collision'); continue; }
    } else {
      transport.heading -= sideways * dt * .8;
      const speed = TYPES.tank.speed * forward * (world.waterDepth(position.x, position.z) > .05 ? RIVER.tankSpeed : 1);
      moveGround(position, -Math.sin(transport.heading) * speed * dt, -Math.cos(transport.heading) * speed * dt, 1.9,
        movementObstacles(position.x, position.z, transport.id));
      position.y = world.groundHeight(position.x, position.z);
    }
    for (const seat of transport.seats) {
      const occupant = entities.soldiers.get(seat.occupantId);
      if (!occupant) continue;
      occupant.position.copy(position);
    }
  }
}

function updateWeaponSimulation(dt) {
  for (const actor of entities.soldiers.values()) {
    if (actor.health > 0 && (actor !== controlledSoldier(entities) || state !== 'playing')) advanceBreath(actor.breathControl, dt, false, false);
  }
  const cues = advanceOwnedWeapons(entities, dt, time, state === 'playing' && !toolEquipped && !grenadeEquipped, true);
  for (const cue of cues) emitControlEvent('weapon.mechanical', cue);
  if (state === 'playing') syncRifleUnit();
}

function updateBattleBoundary(dt) {
  const apply = (subject, area, vehicle) => {
    let boundary = boundaryStates.get(subject.id);
    if (!boundary) { boundary = createBoundaryState(); boundaryStates.set(subject.id, boundary); }
    const damage = advanceBoundary(boundary, subject.position, dt, area);
    if (damage > 0) {
      const source = { credit: 'environment', cause: 'boundary', subjectId: subject.id };
      if (vehicle) damageVehicle(subject, damage, source, 'boundary');
      else hurt(subject, damage, source, 'boundary');
    }
  };
  for (const actor of allies) if (actor.health > 0 && !actor.vehicleId) apply(actor, BATTLE_AREA, false);
  for (const transport of entities.vehicles.values()) {
    if (transport.health > 0 && entities.units.get(transport.unitId)?.player) {
      apply(transport, transport.type === 'plane' ? AIR_BATTLE_AREA : BATTLE_AREA, true);
    }
  }
}

function controlledBoundary() {
  const actor = controlledSoldier(entities);
  return actor ? boundaryStates.get(occupiedVehicle(entities, actor)?.id ?? actor.id) : null;
}

function renderBattleBoundary() {
  const boundary = controlledBoundary(), element = $('boundary-warning');
  element.hidden = state !== 'playing' || !boundary?.outside || controlledSoldier(entities)?.health <= 0;
  if (element.hidden) return;
  element.classList.toggle('damaging', boundary.damaging);
  const direction = `${boundary.returnX < 0 ? '西' : boundary.returnX > 0 ? '东' : ''}${boundary.returnZ < 0 ? '北' : boundary.returnZ > 0 ? '南' : ''}`;
  const distance = Math.ceil(Math.hypot(boundary.returnX, boundary.returnZ));
  $('boundary-detail').textContent = `向${direction}返回约 ${distance} 米 · ${boundary.damaging
    ? `正在损失生命（${BOUNDARY_RULES.damagePerSecond}/秒）` : `${Math.ceil(boundary.remaining)} 秒后开始掉血`}`;
}

function updatePlayer(dt) {
  const actor = allies[current];
  const { yaw, stance } = controlPose;
  const position = actor.position;
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const sideways = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  actor.aimWalking = false;
  if (forward || sideways) actor.firingPose = null;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = actor.locomotion;
  const wading = world.waterDepth(position.x, position.z, position.y) > .05;
  if (!actor.vehicleId) {
    const steps = advanceLocomotion(motion, position, {
      type: unit.type, forward, sideways, yaw, stance, aiming: held.aiming,
      sprint: keys.has('ShiftLeft') && !actor.grenades.action && !wading, walking: keys.has('KeyC'),
      speedScale: wading ? RIVER.infantrySpeed : 1,
      grounded: jumpHeight === 0 && jumpVelocity === 0,
      busy: Boolean(actor.grenades.action) || unit.reloadUntil > time || (unit.type === 'infantry' && actor.rifle.action !== 'idle') || construction.blueprint || held.primary,
    }, movementObstacles(position.x, position.z), dt, world.moveInfantry);
    for (let i = 0; i < steps; i++) emitFootstep(position, motion.speed);
  }
  if (foot) {
    if (jumpHeight > 0 || jumpVelocity > 0) {
      jumpVelocity -= 15 * dt;
      jumpHeight = Math.max(0, jumpHeight + jumpVelocity * dt);
      if (!jumpHeight) {
        landLocomotion(motion, jumpVelocity);
        emitFootstep(position, motion.speed, true);
        jumpVelocity = 0;
      }
    }
  }
  if (!actor.vehicleId) position.y = world.walkHeight(position.x, position.z, position.y);
  actor.heading = yaw;
  actor.aimWalking = foot && held.aiming && motion.speed > .06 && !motion.sprinting;
  actor.rifleReady = !grenadeEquipped && !actor.grenades.action && !toolEquipped && (held.aiming || held.primary) && !motion.sprinting && motion.aimRecovery === 0;
  advanceBreath(actor.breathControl, dt, keys.has('ShiftLeft'),
    rifleAimAvailable() && motion.speed < .1 && jumpHeight === 0 && jumpVelocity === 0);
  if (actor.nativeMotion) advanceNraMotion(actor, dt);
  // Movement, stance, lean and mouse aim must be current before muzzle clearance/fire.
  updateCamera(dt);
  const transport = occupiedVehicle(entities, actor);
  if (transport?.type === 'tank' && transport.variant === null) {
    const shot = advanceTankMachineGun(transport, actor, dt, time, keys.has('Space'));
    if (shot) fireTankMachineGun(transport, shot);
  }
  if (actor.grenades.action) return;
  if (toolEquipped) updateConstruction(dt);
  else if (held.primary) fire();
}

function updateCamera(dt) {
  if (!allies[current] || !unit) return;
  const { yaw, pitch } = controlPose;
  const position = allies[current].position;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = allies[current].locomotion;
  const eyePoint = foot && !allies[current].vehicleId ? soldierEyePosition(allies[current]) : position;
  const desiredHeight = controlPose.eyeHeight;
  const tank = occupiedVehicle(entities, allies[current]), seat = occupiedSeat(entities);
  const observation = tank?.type === 'tank' ? tankObservationPose(tank, seat.role, held.aiming) : null;
  eyeHeight = tank?.type === 'tank' || !allies[current].vehicleId && allies[current].nativeMotion?.profile.headAim
    ? desiredHeight : THREE.MathUtils.lerp(eyeHeight, desiredHeight, 1 - Math.exp(-dt * 12));
  const desiredLean = foot ? (Number(keys.has('KeyE')) - Number(keys.has('KeyQ'))) * .23 : 0;
  const offsetX = Math.cos(yaw) * desiredLean;
  const offsetZ = -Math.sin(yaw) * desiredLean;
  const safeLean = foot && circleBlocked(eyePoint.x + offsetX, eyePoint.z + offsetZ, .35, world.obstacles, position.y) ? 0 : desiredLean;
  lean = THREE.MathUtils.lerp(lean, safeLean, Math.min(1, dt * 12));
  const cameraSway = foot ? motion.cameraX * motionStrength : 0;
  camera.position.set(eyePoint.x + Math.cos(yaw) * (lean + cameraSway), unit.altitude + eyeHeight + jumpHeight + (foot ? (motion.cameraY + motion.landing) * motionStrength : 0), eyePoint.z - Math.sin(yaw) * (lean + cameraSway));
  if (observation) camera.position.set(observation.x, observation.y, observation.z);
  const profile = infantryWeaponProfile(allies[current].rifle);
  const sway = rifleAimAvailable() ? aimSway(time, { scoped: Boolean(profile.scoped),
    holding: allies[current].breathControl.holding, moving: motion.speed > .1, stance: controlPose.stance }) : { pitch: 0, yaw: 0 };
  camera.rotation.set(pitch + recoil + sway.pitch, yaw + sway.yaw, -lean * .35 + (foot ? motion.cameraRoll * motionStrength : 0));
  recoil = Math.max(0, recoil - dt * .3);
  const rifleReloading = unit.type === 'infantry' && allies[current].rifle.action === 'reload';
  const effectiveAim = unit.type === 'infantry' ? rifleAimAvailable() : held.aiming && !grenadeEquipped && !allies[current].grenades.action && primaryViewAvailable() && !toolEquipped && !rifleReloading && weaponObstruction === 0 && obstructionBlend < .03 && (!foot || motion.aimRecovery === 0);
  const desiredFov = observation?.fov ?? (effectiveAim && unit.type === 'infantry' ? profile.aimFov ?? 48 : unit.type === 'plane' ? 82 : 72);
  camera.fov = observation ? desiredFov : THREE.MathUtils.lerp(camera.fov, desiredFov, Math.min(1, dt * 12));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  if (weapon && !grenadeEquipped && !allies[current].grenades.action) {
    const aim = effectiveAim && unit.type === 'infantry';
    const response = 1 - Math.exp(-dt * 15);
    if (unit.type === 'infantry' && !toolEquipped) {
      const pose = updateRifleModel(weapon, allies[current].rifle);
      weapon.userData.rifle.flash.visible &&= graphics.snapshot.effects.muzzle;
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
      const intendedMuzzle = weapon.userData.rifle.muzzle.position.clone().add(new THREE.Vector3(targetX, targetY, targetZ)).applyMatrix4(camera.matrixWorld);
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
      const tank = occupiedVehicle(entities, allies[current])?.type === 'tank';
      weapon.position.z = (tank ? 0 : recoil * 1.5) + (foot ? motion.sprintBlend * .08 : 0);
      weapon.rotation.x = tank ? 0 : (toolEquipped && construction.progress > 0 ? Math.sin(time * 18) * .35 : unit.reloadUntil ? Math.sin(time * 4) * .14 - .3 : 0) + (foot ? motion.weaponPitch : 0);
      weapon.rotation.z = foot ? -motion.sprintBlend * .12 : 0;
      if (weapon.userData.breech) weapon.userData.breech.position.z = recoil * .35;
    }
  }
  $('crosshair').hidden = !primaryViewAvailable() || observation?.aperture === 'scope' || (effectiveAim && unit.type === 'infantry');
}

function renderSniperScope() {
  const tank = occupiedVehicle(entities, controlledSoldier(entities));
  const optical = tank?.type === 'tank';
  $('tank-optics').hidden = !(['playing', 'transferring', 'pause'].includes(state) && optical);
  if (optical) {
    const role = occupiedSeat(entities).role;
    $('tank-optics').dataset.view = tankObservationPose(tank, role, held.aiming).aperture;
    $('tank-optics').setAttribute('aria-label', role === 'commander' ? '车长闭舱观察狭缝' : role === 'gunner' ? '炮手光学瞄具' : '驾驶员闭舱观察窗');
  } else $('tank-optics').dataset.view = tank?.type === 'tank' ? 'driver' : '';
  const active = sniperScopeActive(), scope = $('sniper-scope');
  scope.hidden = !active;
  refreshWeaponVisibility();
  if (!active) return;
  const breath = allies[current].breathControl, percent = Math.round(breath.remaining * 100);
  $('breath-meter').setAttribute('aria-valuenow', String(percent));
  $('breath-fill').style.width = `${percent}%`;
  $('breath-label').textContent = `${breath.holding ? '屏息中' : breath.exhausted ? '呼吸恢复 · 松开 Shift' : '按住左 Shift 屏息'} · ${percent}%`;
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
  const objective = objectives.find(point => Math.hypot(target.x - point.x, target.z - point.z) < point.radius);
  const attack = Boolean(objective);
  for (const actor of allies) {
    actor.order = follow ? 'follow' : attack ? 'advance' : 'hold';
    actor.personalHold = false;
    actor.orderPoint = floorDestination({ x: target.x, y: target.y, z: target.z },
      { x: THREE.MathUtils.clamp(target.x, -100, 100), z: THREE.MathUtils.clamp(target.z, -100, 100) }, world.town.buildings);
    actor.orderObjectiveId = attack && !follow ? objective.id : null;
    actor.path = null;
    actor.tactics.decisionAt = 0;
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.tactics.cover = null;
  }
  toast(follow ? '小队命令：取消命令，跟随我' : attack ? `小队命令：进攻 ${objective.id} 据点` : '小队命令：移动并守住标记位置');
  battleVoiceEvent(follow ? 'order-follow' : attack ? 'order-advance' : 'order-hold', { command: true });
}
function personalDestination(actor, target) {
  const state = actor.tactics;
  const enabled = ['formation-advance', 'assault', 'advance-to-objective', 'follow', 'hold', 'advance'].includes(state.mode);
  if (!enabled) return target;
  const floor = target.y ?? world.groundHeight(target.x, target.z);
  const cached = state.personalSlot;
  if (cached && Math.hypot(cached.anchor.x - target.x, cached.anchor.z - target.z,
    (cached.anchor.y ?? 0) - (target.y ?? 0)) < .7) {
    if (cached.point) { cached.expiresAt = time + 5; return cached.point; }
    if (time < cached.retryAt) return null;
  }
  const peers = allForces.filter(other => other !== actor && other.health > 0 && !other.vehicleId &&
    other.team === actor.team && Math.abs(other.position.y - floor) < 1.5);
  const mission = ['formation-advance', 'assault', 'advance-to-objective', 'advance'].includes(state.mode)
    ? objectives.find(point => point.id === state.objectiveId) : null;
  const candidates = [{ ...target }];
  for (const radius of [1.7, 3.4, 5.1]) for (let side = 0; side < 16; side++) {
    const angle = side * Math.PI / 8 + state.id * .618;
    candidates.push({ x: target.x + Math.cos(angle) * radius, z: target.z + Math.sin(angle) * radius,
      ...(target.y === undefined ? {} : { y: target.y }) });
  }
  const point = candidates.find(point => {
    if (mission && Math.hypot(point.x - mission.x, point.z - mission.z) > mission.radius - 1) return false;
    if (Math.abs(world.walkHeight(point.x, point.z, floor) - floor) > .3 ||
      circleBlocked(point.x, point.z, .5, movementObstacles(point.x, point.z), floor)) return false;
    return peers.every(other => {
      const reserved = other.tactics.personalSlot;
      return !(reserved?.point && reserved.expiresAt > time && Math.hypot(point.x - reserved.point.x, point.z - reserved.point.z) < 1.65) &&
        !(other.locomotion.speed < .2 && Math.hypot(point.x - other.position.x, point.z - other.position.z) < 1.45);
    });
  }) ?? null;
  state.personalSlot = { anchor: { ...target }, point, objectiveId: mission?.id ?? null,
    floor, expiresAt: time + 5, retryAt: time + 1 };
  return point;
}

function walkActor(actor, target, speed, dt, sprint = false) {
  target = personalDestination(actor, target);
  if (!target) { actor.tactics.mode = 'wait-for-position'; return; }
  if (target === actor.tactics.personalSlot?.point &&
    Math.hypot(actor.position.x - target.x, actor.position.z - target.z) < .45 &&
    Math.abs(actor.position.y - actor.tactics.personalSlot.floor) < .3) {
    actor.path = []; actor.pathGoal = target; pathRequests.delete(actor.tactics.id);
    return;
  }
  const profile = FOOT_SPEEDS[actor.groundType];
  const pos = actor.position;
  if ((!actor.path || !actor.path.length) && time >= (actor.nextPath || 0) ||
      !actor.pathGoal || Math.hypot(actor.pathGoal.x - target.x, actor.pathGoal.z - target.z,
        (actor.pathGoal.y ?? 0) - (target.y ?? 0)) > .75 ||
      actor.stuckTime > .6 && time >= (actor.nextPath || 0)) {
    pathRequests.set(actor.tactics.id, { actor, target: { ...target }, requestedAt: pathRequests.get(actor.tactics.id)?.requestedAt ?? time });
  }
  if (!actor.path) return;
  while (actor.path.length && Math.hypot(actor.path[0].x - pos.x, actor.path[0].z - pos.z) < .1) actor.path.shift();
  const waypoint = actor.path[0];
  if (!waypoint) return;
  const waitingDoor = pos.y < 1 ? world.doorSystem.openAhead(pos, waypoint) : null;
  if (waitingDoor) {
    actor.tactics.mode = 'open-door';
    actor.tactics.blockedBy = 'door';
    if (waitingDoor.blocked) {
      const hx = waitingDoor.x - (waitingDoor.axis === 'x' ? waitingDoor.width / 2 : 0);
      const hz = waitingDoor.z - (waitingDoor.axis === 'z' ? waitingDoor.width / 2 : 0);
      const dx = pos.x - hx, dz = pos.z - hz, distance = Math.max(.01, Math.hypot(dx, dz));
      world.moveInfantry(pos, dx / distance * dt * 1.8, dz / distance * dt * 1.8, .42, movementObstacles(pos.x, pos.z));
    }
    return;
  }
  const dx = waypoint.x - pos.x;
  const dz = waypoint.z - pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .05) return;
  const obstacles = movementObstacles(pos.x, pos.z);
  const heading = Math.atan2(-dx, -dz);
  let space = actor.tactics.movementSpace;
  if (!space || time >= space.expiresAt || Math.hypot(pos.x - space.x, pos.z - space.z) > .6 ||
    Math.cos(heading - space.heading) < .9) {
    space = { x: pos.x, z: pos.z, heading, expiresAt: time + .35,
      constrained: [-1, 1].some(side => circleBlocked(pos.x - dz / distance * side, pos.z + dx / distance * side, .42, obstacles)) };
    actor.tactics.movementSpace = space;
  }
  let pace = chooseAdvancePace({ preference: (actor.tactics.id * .61803398875) % 1, urgent: sprint,
    threat: Boolean(actor.tactics.lastSeen), distance: Math.hypot(target.x - pos.x, target.z - pos.z),
    exhausted: actor.locomotion.exhausted, stamina: actor.locomotion.stamina, constrained: space.constrained,
    catchUp: actor.playerUnit && actor.order === 'follow' });
  if (pace === 'aim' && actor.tactics.lastSeen) {
    const observed = actor.tactics.lastSeen, aimingHeading = Math.atan2(pos.x - observed.x, pos.z - observed.z);
    if (Math.cos(aimingHeading - heading) <= .8) pace = space.constrained ? 'walk' : 'jog';
  }
  sprint = pace === 'sprint';
  speed = Math.hypot(target.x - pos.x, target.z - pos.z) > 1.3 ? profile[pace] : Math.min(speed, profile[pace]);
  const inCaptureArea = objectives.some(point => Math.hypot(pos.x - point.x, pos.z - point.z) < point.radius);
  const steering = infantrySteering(actor, actorGrid.near(pos.x, pos.z, 3.2), { x: dx, z: dz }, {
    spacing: inCaptureArea ? 1.45 : 2.2, constrained: space.constrained,
    blocked: point => circleBlocked(point.x, point.z, .43, movementObstacles(point.x, point.z), pos.y),
  });
  speed *= steering.speed;
  actor.tactics.blockedBy = steering.waitingFor;
  if (speed < .05) {
    actor.tactics.mode = 'wait-for-spacing'; actor.locomotion.mode = 'idle';
    return;
  }
  if (world.waterDepth(pos.x, pos.z, pos.y) > .05) {
    sprint = false; pace = 'walk'; speed = profile.jog * RIVER.infantrySpeed;
  }
  actor.stance = 'standing'; actor.firingPose = null;
  if (!postureReady(actor)) {
    actor.turningThisStep = true;
    actor.locomotion.mode = 'rise';
    actor.tactics.mode = 'rise-to-move';
    return;
  }
  const turn = advanceAITurn(actor, Math.atan2(-steering.x, -steering.z), dt, true);
  actor.turningThisStep = true;
  if (!turn.mayMove) {
    actor.locomotion.mode = 'turn';
    actor.tactics.mode = 'turn-to-path';
    return;
  }
  const step = Math.min(speed * dt, distance);
  const beforeX = pos.x;
  const beforeZ = pos.z;
  world.moveInfantry(pos, steering.x * step, steering.z * step, .42, obstacles);
  if (Math.hypot(pos.x - beforeX, pos.z - beforeZ) < step * .3) {
    actor.stuckTime = (actor.stuckTime || 0) + dt;
    const side = actor.index % 2 ? -1 : 1;
    world.moveInfantry(pos, -dz / distance * step * side, dx / distance * step * side, .42, obstacles);
  } else actor.stuckTime = 0;
  pos.y = world.walkHeight(pos.x, pos.z, pos.y);
  actor.walkPhase += Math.hypot(pos.x - beforeX, pos.z - beforeZ) * 2.5;
  actor.walkPoseReady = true;
  actor.locomotion.speed = Math.hypot(pos.x - beforeX, pos.z - beforeZ) / dt;
  actor.locomotion.sprinting = sprint && actor.locomotion.speed > profile.jog + .1;
  actor.locomotion.mode = actor.locomotion.speed < .06 ? 'idle' : actor.locomotion.sprinting ? 'sprint' : pace;
  actor.aimWalking = pace === 'aim' && actor.locomotion.speed > .06;
  if (actor.aimWalking) actor.rifleReady = true;
}

const posturePreviews = new WeakMap();
function postureFireLine(actor, point, stance, threat) {
  const profile = actor.nativeMotion?.profile, track = profile && (stance === 'standing' ? profile.idle : profile[stance]);
  if (!track) throw new Error('Native combat posture is missing its carry profile');
  const heading = Math.atan2(point.x - threat.x, point.z - threat.z), c = Math.cos(heading), s = Math.sin(heading);
  let preview = null;
  if (profile.rifleContacts) {
    let cached = posturePreviews.get(actor);
    if (!cached) { cached = new Map(); posturePreviews.set(actor, cached); }
    if (!cached.has(stance)) cached.set(stance, { time: null, motion: { ...actor.nativeMotion, speed: 0,
      weight: 0, lowReady: 0, cheekWeight: profile.headAim ? 1 : 0, aim: 0,
      posture: Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, pose === stance ? 1 : 0])) } });
    const entry = cached.get(stance);
    if (entry.time !== time) {
      entry.motion.idleTime = actor.nativeMotion.idleTime;
      entry.motion.bodyLean = actor.nativeMotion.fireLean;
      const derived = { ...actor, rifleReady: true, rifle: { ...actor.rifle, action: 'idle' }, nativeMotion: entry.motion };
      syncNativeAimGoal(derived);
      entry.pose = sampleNraMotion(derived); entry.time = time;
    }
    preview = entry.pose;
  }
  if (preview?.headAim && (preview.headAim.sightError >= .004 || preview.headAim.cheekError >= .012 ||
    preview.headAim.gazeError >= .05 || preview.headAim.eyeRelief <= .04)) return false;
  const local = new THREE.Vector3(...profile.muzzle)
    .applyQuaternion(new THREE.Quaternion(...(preview?.weaponQuaternion ?? track.quaternions.slice(0, 4))))
    .add(new THREE.Vector3(...(preview?.weaponPosition ?? track.positions.slice(0, 3))));
  const y = world.walkHeight(point.x, point.z, actor.position.y);
  const muzzle = new THREE.Vector3(point.x + local.x * c + local.z * s, y + local.y, point.z - local.x * s + local.z * c);
  const eyeLocal = preview?.headAim?.eye ?? [0, stance === 'standing' ? 1.67 : FIRING_POSES[stance].eye, 0];
  const eye = new THREE.Vector3(point.x + eyeLocal[0] * c + eyeLocal[2] * s, y + eyeLocal[1],
    point.z - eyeLocal[0] * s + eyeLocal[2] * c);
  return hasLine(eye, muzzle, 2) && hasLine(muzzle, threat, 90);
}

function proneSpaceClear(actor, heading) {
  const c = Math.cos(heading), s = Math.sin(heading), base = actor.position.y;
  for (const z of [-1, -.5, 0, .5, 1]) for (const x of [-.18, .18]) {
    const point = { x: actor.position.x + x * c + z * s, z: actor.position.z - x * s + z * c };
    if (circleBlocked(point.x, point.z, .22, movementObstacles(point.x, point.z), base, .55) ||
      Math.abs(world.walkHeight(point.x, point.z, base) - base) > .16) return false;
  }
  return true;
}

function clearAIRifleLine(actor, from, threat) {
  const origin = soldierRifleMuzzle(actor), muzzle = new THREE.Vector3(origin.x, origin.y, origin.z);
  const nearbyFriend = actorGrid.near(actor.position.x, actor.position.z, muzzle.distanceTo(threat)).some(other => {
    if (other.friendly !== actor.friendly || other === actor || other.health <= 0 || other.targetKind === 'aircraft') return false;
    const segment = pointSegmentDistance(other.position, muzzle, threat);
    const lineY = muzzle.y + (threat.y - muzzle.y) * segment.fraction;
    return segment.fraction > .03 && segment.fraction < .97 && segment.distance < .55 &&
      lineY > other.position.y - .1 && lineY < other.position.y + soldierPostureHeight(other, 'body');
  });
  return !nearbyFriend && hasLine(from, muzzle, 2) && hasLine(muzzle, threat, 75) ? muzzle : null;
}

function fightFromCover(actor, target, dt, tankCover = null) {
  const t = actor.tactics, position = actor.position;
  const armorThreat = t.threatKind === 'closed-armor';
  const threat = new THREE.Vector3(t.lastSeen.x, t.lastSeen.y, t.lastSeen.z);
  const objective = formationObjective(actor, objectives[0]);
  if (!armorThreat && objective && time >= t.suppressedUntil &&
    objectiveAdvanceRequired(actor, objective, position.distanceTo(threat), AI_RIFLE.closeRange)) {
    if (t.cover) coverClaims.delete(t.cover.id);
    t.cover = null; t.wallContact = null; t.shotMovePending = false; t.shotMoveGoal = null;
    t.mode = 'advance-to-objective'; t.objectiveId = objective.id;
    walkActor(actor, formationDestination(actor, objective), 3, dt);
    resetAIRifleAim(actor.aiRifle, 'objective-advance');
    return;
  }
  t.engagementPoint ??= {};
  Object.assign(t.engagementPoint, t.lastSeen);
  if (tankCover) {
    if (t.cover?.id !== tankCover.id || Math.hypot(t.cover.x - tankCover.x, t.cover.z - tankCover.z) > .75) {
      if (t.cover) coverClaims.delete(t.cover.id);
      actor.path = actor.pathGoal = null; pathRequests.delete(t.id);
      t.enteredCover = false;
    }
    t.cover = tankCover;
  } else if (t.cover?.kind === 'tank') {
    coverClaims.delete(t.cover.id); t.cover = null; t.enteredCover = false; t.decisionAt = 0;
  }
  const committedMove = actor.friendly && t.cover && !t.enteredCover && time < (t.coverMoveUntil || 0) && time >= t.suppressedUntil;
  if (!tankCover && time >= t.decisionAt && coverBudget > 0 && !committedMove) {
    const coverStarted = benchmark ? performance.now() : 0;
    coverBudget--;
    t.decisionAt = time + 2.3 + t.slot * .17;
    const context = {
      state: t, position, threat,
      slots: position.y > 1 ? [] : actor.friendly && actor.order === 'hold' ? world.town.covers.filter(slot => Math.hypot(slot.x - actor.orderPoint.x, slot.z - actor.orderPoint.z) < 7)
        : actor.friendly && objective ? world.town.covers.filter(slot =>
          Math.hypot(slot.x - objective.x, slot.z - objective.z) <= Math.hypot(position.x - objective.x, position.z - objective.z) + 1.5)
        : !actor.friendly ? world.town.covers.filter(slot => {
          return objective && Math.hypot(slot.x - position.x, slot.z - position.z) < 10 &&
            Math.hypot(slot.x - objective.x, slot.z - objective.z) < Math.max(objective.radius - 2, Math.hypot(position.x - objective.x, position.z - objective.z));
        }) : world.town.covers,
      claims: coverClaims, now: time,
      blocked: point => circleBlocked(point.x, point.z, .46, world.obstacles),
      protectedAt: point => {
        const base = world.groundHeight(point.x, point.z);
        if (!actor.nativeMotion) return !hasLine(threat, new THREE.Vector3(point.x, base + 1.1, point.z), 90);
        const shielded = height => !hasLine(threat, new THREE.Vector3(point.x, base + height, point.z), 90);
        return shielded(.65) ? shielded(1.0) || shielded(.35) : shielded(1.0) && shielded(.35);
      },
      supportedAt: point => {
        if (!actor.nativeMotion) return false;
        const base = { ...point, y: world.groundHeight(point.x, point.z) };
        const heading = Math.atan2(point.x - threat.x, point.z - threat.z);
        const contact = wallFiringContact(base, heading, world.town.pieces);
        return Boolean(contact && postureFireLine(actor, point, contact.pose, threat));
      },
      seesTarget: point => actor.nativeMotion
        ? postureFireLine(actor, point, 'crouched', threat) || postureFireLine(actor, point, 'standing', threat)
        : hasLine(new THREE.Vector3(point.x, world.groundHeight(point.x, point.z) + 1.3, point.z), threat, 90),
      pathTo: point => navigate(position, point),
    };
    const currentProtected = t.cover && (t.cover.kind === 'wall-support' ? context.supportedAt(t.cover) : context.protectedAt(t.cover)) && (!actor.friendly ||
      !context.blocked(t.cover) && !context.blocked(t.cover.peek) && context.seesTarget(t.cover.peek));
    const chosen = actor.friendly && currentProtected ? null : selectCover(context);
    if (chosen) {
      const changed = t.cover?.id !== chosen.cover.id;
      if (changed && actor.friendly) {
        t.coverMoveUntil = time + 4;
        pathRequests.delete(t.id);
      }
      t.cover = chosen.cover;
      if (changed) { t.enteredCover = false; actor.path = chosen.path; actor.pathGoal = { x: chosen.cover.x, z: chosen.cover.z }; actor.nextPath = time + 1.8; }
    } else if (currentProtected) {
      coverClaims.set(t.cover.id, { owner: t.id, until: time + 7 });
    } else {
      if (t.cover) coverClaims.delete(t.cover.id);
      t.cover = null;
    }
    if (benchmark) telemetry.add('coverMs', performance.now() - coverStarted);
  }
  let mayFire = true;
  if (t.cover) {
    t.shotMovePending = false; t.shotMoveGoal = null;
    coverClaims.set(t.cover.id, { owner: t.id, until: time + 7 });
    if (!t.enteredCover && Math.hypot(t.cover.x - position.x, t.cover.z - position.z) < .28) {
      t.enteredCover = true; t.arrivedAt = time;
    }
    if (t.cover.kind === 'tank') {
      const exposed = target && !armorThreat && t.enteredCover && peekTurn(t, time);
      const goal = exposed ? t.cover.peek : t.cover;
      const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
      t.mode = exposed ? 'tank-peek' : distance > .6 ? 'follow-tank' : 'tank-cover';
      mayFire = Boolean(exposed && distance < .4);
      if (distance > .35) walkActor(actor, goal, 2.4, dt);
    } else if (actor.friendly && !armorThreat) {
      const action = friendlyCoverAction(t, position, time);
      t.mode = action.mode;
      mayFire = action.mayFire;
      if (action.moving) walkActor(actor, action.goal, 2.4, dt, action.sprint);
    } else {
      const exposed = !armorThreat && t.enteredCover && peekTurn(t, time);
      const goal = exposed ? t.cover.peek : t.cover;
      const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
      t.mode = armorThreat ? distance > .25 ? 'evade-armor' : 'cover-from-armor' : distance > .25 ? 'take-cover' : exposed ? 'peek' : 'cover';
      mayFire = exposed && distance < .35;
      if (distance > .15) walkActor(actor, goal, 1.8, dt);
    }
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
    } else if (actor.friendly && t.shotMovePending) {
      mayFire = false;
      if (!t.shotMoveGoal && time >= (t.shotMoveRetryAt ?? 0) && time >= t.shotMoveStartsAt) {
        t.shotMoveRetryAt = time + .8;
        t.shotMoveGoal = chooseShotRelocation({ position, threat, preference: (t.id * .61803398875) % 1,
          blocked: point => actor.order === 'hold' && Math.hypot(point.x - actor.orderPoint.x, point.z - actor.orderPoint.z) > 7 ||
            circleBlocked(point.x, point.z, .44, movementObstacles(point.x, point.z), position.y) ||
            actorGrid.near(point.x, point.z, 1).some(other => other !== actor && other.health > 0 &&
              Math.hypot(other.position.x - point.x, other.position.z - point.z) < .8),
          heightAt: point => world.walkHeight(point.x, point.z, position.y),
          canFinish: point => actor.nativeMotion ? ['standing', 'kneeling', 'crouched'].some(pose =>
            pose !== t.previousFiringPose && postureFireLine(actor, point, pose, threat))
            : hasLine(new THREE.Vector3(point.x, world.groundHeight(point.x, point.z) + SOLDIER_FIRE_HEIGHT, point.z), threat, 75) });
        if (t.shotMoveGoal) {
          t.shotMoveGoal.y = world.walkHeight(t.shotMoveGoal.x, t.shotMoveGoal.z, position.y);
          actor.path = actor.pathGoal = null; pathRequests.delete(t.id);
        }
      }
      t.mode = t.shotMoveGoal ? 'relocate-after-shot' : 'seek-clear-relocation';
      if (t.shotMoveGoal) {
        if (Math.hypot(position.x - t.shotMoveGoal.x, position.z - t.shotMoveGoal.z) > .25) walkActor(actor, t.shotMoveGoal, 2.8, dt);
        else {
          t.shotMovePending = false; t.shotMoveGoal = null;
          t.poseSequence = (t.poseSequence ?? 0) + 1;
          t.completedShotMoves = (t.completedShotMoves ?? 0) + 1;
          t.relocatedFireUntil = time + 3;
          t.postureDecisionAt = t.postureUntil = 0;
        }
      }
    } else if (actor.friendly && actor.order === 'hold') {
      const goal = floorDestination(actor.orderPoint, holdDestination(actor), world.town.buildings);
      if (time >= (t.relocatedFireUntil ?? 0) && Math.hypot(goal.x - position.x, goal.z - position.z) > .4) walkActor(actor, goal, 2.4, dt);
    } else if (distance > AI_RIFLE.closeRange && time >= (t.relocatedFireUntil ?? 0) && !actor.friendly) {
      const angle = Math.atan2(threat.z - position.z, threat.x - position.x);
      const flank = { x: threat.x - Math.cos(angle) * 18 + Math.sin(angle) * (t.slot % 2 ? 5 : -5), z: threat.z - Math.sin(angle) * 18 - Math.cos(angle) * (t.slot % 2 ? 5 : -5) };
      walkActor(actor, flank, 2.2, dt);
    }
  }
  if (actor.friendly && actor.nativeMotion) {
    const moving = actor.locomotion.speed > .1 || actor.turningThisStep;
    if (moving || t.postureNeedsChoice || time >= (t.postureDecisionAt ?? 0)) {
      t.postureDecisionAt = time + .35;
      const heading = Math.atan2(position.x - threat.x, position.z - threat.z);
      const suppressed = time < t.suppressedUntil, distance = position.distanceTo(threat);
      const wall = !moving ? wallFiringContact(position, heading, world.town.pieces) : null;
      const proneClear = !moving && distance >= 14 && !t.cover && proneSpaceClear(actor, heading);
      const eligiblePoses = [];
      const next = chooseCombatPosture({ distance, moving, covered: Boolean(t.cover),
        exposed: mayFire && ['peek', 'wall-supported-fire'].includes(t.mode), suppressed,
        proneClear, wall, previousPose: !t.cover && !t.shotMovePending ? t.previousFiringPose : null,
        preference: (t.id * .61803398875 + (t.poseSequence ?? 0) * .38196601125) % 1,
        canFire: stance => {
          const clear = postureFireLine(actor, position, stance, threat);
          if (clear) eligiblePoses.push(stance);
          return clear;
        } });
      t.wallContact = wall;
      const invalid = actor.firingPose === 'prone' && !proneClear ||
        actor.firingPose?.startsWith('wall') && wall?.pose !== actor.firingPose ||
        mayFire && !moving && eligiblePoses.length > 0 && !eligiblePoses.includes(ownedFiringPose(actor));
      if (moving || invalid || t.postureNeedsChoice || time >= (t.postureUntil ?? 0)) {
        if (ownedFiringPose(actor) !== next) {
          actor.firingPose = next === 'standing' ? null : next;
          actor.stance = FIRING_POSES[next]?.stance ?? 'standing';
          t.postureChangedAt = time; t.postureUntil = time + 2.6;
        }
        t.eligiblePoses = eligiblePoses;
        t.postureNeedsChoice = moving;
        if (moving) t.postureUntil = time;
      }
    }
  }
  const desiredHeading = Math.atan2(position.x - threat.x, position.z - threat.z);
  const facing = !actor.turningThisStep && actor.locomotion.speed <= .1 &&
    advanceAITurn(actor, desiredHeading, dt).facing;
  const eye = actor.nativeMotion ? soldierEyePosition(actor) : { x: position.x, y: position.y + SOLDIER_FIRE_HEIGHT, z: position.z };
  const from = new THREE.Vector3(eye.x, eye.y, eye.z);
  const suppressed = time < t.suppressedUntil;
  const solution = Boolean(target && t.threatSense === 'vision' && t.threatId === target.id && mayFire &&
    canWeaponDamageTarget('rifle', t.threatKind) && canRiflemanTrackTarget(t.threatKind));
  actor.rifleReady = actor.aimWalking || solution && facing && actor.locomotion.speed <= .1 && actor.locomotion.aimRecovery === 0;
  let muzzle = null, firingOptions = [];
  if (!attemptAIRifleShot(actor, { now: time, targetId: target?.id ?? null, suppressed,
    postureSettled: postureReady(actor) && nativeAimReady(actor),
    mayFire: solution && facing,
    confirmShot: () => {
      const observed = observeVisualThreat(t, target, time, point => hasLine(from, point, 75, target.vehicleId));
      if (!observed) { actor.target = null; return null; }
      threat.copy(observed);
      t.engagementPoint = { ...observed };
      if (Math.abs(headingError(actor.heading, Math.atan2(position.x - threat.x, position.z - threat.z))) > AI_TURN.fireAngle) return null;
      muzzle = clearAIRifleLine(actor, from, threat);
      if (!muzzle) return null;
      firingOptions = actor.friendly && actor.nativeMotion ? (t.eligiblePoses ?? []).filter(pose =>
        postureFireLine(actor, position, pose, threat)) : [];
      if (actor.friendly && t.shotMovePending && !infantryWeaponProfile(actor.rifle).automatic && !t.cover && !t.wallContact && t.lastShot && !t.lastShot.coverId) {
        if (Math.hypot(position.x - t.lastShot.position.x, position.z - t.lastShot.position.z) < 2) {
          t.shotMovePending = true; t.shotMoveGoal = null; t.shotMoveStartsAt = time;
          t.shotMoveRetryAt = 0; t.mode = 'seek-clear-relocation';
          return null;
        }
        if (ownedFiringPose(actor) === t.lastShot.firingPose && firingOptions.some(pose => pose !== t.lastShot.firingPose)) {
          t.postureNeedsChoice = true; t.postureUntil = 0;
          return null;
        }
      }
      return from.distanceTo(threat);
    } })) return;
  const distance = actor.aiRifle.lastShot.distance;
  actor.nextFire = time + (infantryWeaponProfile(actor.rifle).automatic
    ? actor.rifle.shots % 3 === 0 ? .8 : infantryWeaponProfile(actor.rifle).cycleSeconds
    : rifleAIFireDelay(distance, suppressed, battleRandom()));
  t.lastShot = { time, previousTime: t.lastShot?.time ?? null, mode: t.mode, stance: actor.stance, firingPose: ownedFiringPose(actor),
      heading: actor.heading, lowReady: actor.nativeMotion?.lowReady ?? null,
      headAim: actor.nativeMotion ? sampleNraMotion(actor).headAim ?? null : null,
      facingError: Math.abs(headingError(actor.heading, Math.atan2(position.x - threat.x, position.z - threat.z))),
      coverId: t.cover?.id ?? t.wallContact?.wallId ?? null, completedShotMoves: t.completedShotMoves ?? 0,
      eligiblePoses: firingOptions,
      speed: actor.locomotion.speed, aimRecovery: actor.locomotion.aimRecovery,
      position: { x: position.x, z: position.z } };
  if (actor.friendly) {
    if (suppressed && !t.cover && !t.wallContact && !infantryWeaponProfile(actor.rifle).automatic) {
      t.shotMovePending = true; t.shotMoveGoal = null;
      t.shotMoveStartsAt = time + .45;
      t.previousFiringPose = ownedFiringPose(actor);
    }
  }
  combatStats.aiRifleShots++;
  if (target.targetKind === 'closed-armor') combatStats.aiRifleShotsAtArmor++;
  if (target.targetKind === 'aircraft') combatStats.aiRifleShotsAtAircraft++;
  const source = captureAttackSource(entities, actor, actor.rifle);
  combatEvents.publish('shot', { source, weaponType: 'infantry', start: muzzle, end: threat,
    automatic: infantryWeaponProfile(actor.rifle).automatic,
    muzzle: true, color: actor.friendly ? 0xf6d399 : 0xdfb17a }, time);
  combatSounds.push({ id: ++soundSerial, friendly: actor.friendly, x: muzzle.x, y: muzzle.y, z: muzzle.z, time, radius: 40 });
  if (combatSounds.length > 32) combatSounds.shift();
  if (battleRandom() < rifleAIHitChance(distance, suppressed)) {
    const hit = soldierHits.raycast(target, time, muzzle, threat.clone().sub(muzzle).normalize(), bodyRay);
    if (hit && hit.distance <= 75 && hasLine(muzzle, hit.point, 75)) {
      hurt(target, TYPES.infantry.damage, source, 'rifle', hit.object.userData.hitZone);
    }
  }
}

function formationObjective(actor, fallback) {
  return objectives.find(point => point.id === (actor.playerUnit ? actor.orderObjectiveId : actor.formation.objectiveId)) ?? fallback;
}

function formationDestination(actor, active) {
  const point = formationObjective(actor, active);
  actor.tactics.objectiveId = point.id;
  return actor.friendly ? objectiveDestination(actor.tactics, actor.position, point) : assaultDestination(actor, point);
}

function updateAI(dt) {
  const player = allies[current];
  const yaw = controlPose.yaw;
  const objective = objectives.find(p => !p.captured) ?? objectives[0];
  if (time >= assaultAssignmentAt) {
    for (const formation of assignAssaultObjectives(formations, objectives)) {
      for (const actor of formation.members) {
        if (actor.health <= 0 || actor.vehicleId) continue;
        if (actor.tactics.cover && coverClaims.get(actor.tactics.cover.id)?.owner === actor.tactics.id) coverClaims.delete(actor.tactics.cover.id);
        pathRequests.delete(actor.tactics.id);
        resetObjectiveMovement(actor, formation.objectiveId);
      }
    }
    assaultAssignmentAt = time + 5;
  }
  actorGrid.rebuild(allForces);
  sensorBudget = 12; coverBudget = 1;
  let completedPaths = 0;
  for (const [id, request] of pathRequests) {
    pathRequests.delete(id);
    if (request.actor.health <= 0 || request.actor === player) continue;
    const pathStarted = benchmark ? performance.now() : 0;
    request.actor.path = multistoryPath(request.actor.position, request.target, world.town.buildings, navigate);
    if (benchmark) telemetry.add('pathMs', performance.now() - pathStarted);
    request.actor.pathGoal = request.target;
    request.actor.nextPath = time + (request.actor.path.length ? 1.8 : 3);
    request.actor.stuckTime = 0;
    if (++completedPaths >= 4) break;
  }
  if (benchmark) telemetry.add('pathsServiced', completedPaths);
  const builder = enemies.find(actor => actor.health > 0 && actor.role === 'engineer');
  const armor = [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'tank' && vehicle.health > 0);
  const escortObstacles = armor.length ? deploymentObstacles() : null;
  const escortClaims = new Map();
  for (const actor of allForces) {
    const escort = actor.tactics.armorEscort;
    if (actor.health > 0 && escort) escortClaims.set(`${escort.vehicleId}:${escort.slot}`, actor.id);
  }
  for (let index = 0; index < allForces.length; index++) {
    const actor = allForces[(index + aiCursor) % allForces.length];
    if (actor.health <= 0) continue;
    if (actor === player) { resetAIRifleAim(actor.aiRifle, 'controlled'); continue; }
    actor.locomotion.speed = 0; actor.locomotion.sprinting = false; actor.locomotion.mode = 'idle';
    actor.aimWalking = false;
    actor.rifleReady = false; actor.turningThisStep = false;
    const tactics = actor.tactics, previousCover = tactics.cover;
    if (expireThreat(tactics, time)) {
      actor.target = null;
      actor.path = actor.pathGoal = null;
      pathRequests.delete(tactics.id);
      tactics.coverMoveUntil = 0;
      tactics.shotMoveGoal = null; tactics.shotMovePending = false; tactics.wallContact = null;
      if (previousCover) coverClaims.delete(previousCover.id);
    }
    if (actor.vehicleId) { resetAIRifleAim(actor.aiRifle, 'seated'); continue; }
    if (actor.grenades.action) {
      const action = actor.grenades.action;
      actor.tactics.mode = action.kind === 'explosive-pack' ? 'throw-explosive-pack' : 'throw-grenade';
      resetAIRifleAim(actor.aiRifle, 'throwable');
      continue;
    }
    const dangers = grenades.active.filter(grenade => grenade.phase === 'flight' && grenade.detonateAt > time &&
      grenadeCanDamage(grenade.source, actor, grenade.kind) &&
      Math.hypot(grenade.position.x - actor.position.x, grenade.position.z - actor.position.z,
        grenade.position.y - actor.position.y) < throwableProfile(grenade.kind).radius).sort((a, b) => a.detonateAt - b.detonateAt);
    if (dangers.length) {
      const eye = soldierEyePosition(actor), origin = new THREE.Vector3(eye.x, eye.y, eye.z);
      const danger = dangers.find(grenade => hasLine(origin,
        new THREE.Vector3(grenade.position.x, grenade.position.y + .08, grenade.position.z), throwableProfile(grenade.kind).radius + 3));
      if (danger) {
        resetAIRifleAim(actor.aiRifle, 'moving');
        const distance = Math.hypot(actor.position.x - danger.position.x, actor.position.z - danger.position.z);
        const dx = distance > .01 ? actor.position.x - danger.position.x : Math.sin(actor.tactics.id);
        const dz = distance > .01 ? actor.position.z - danger.position.z : Math.cos(actor.tactics.id);
        const length = Math.hypot(dx, dz);
        actor.stance = 'standing'; actor.firingPose = null; actor.tactics.mode = 'evade-grenade';
        const beforeX = actor.position.x, beforeZ = actor.position.z;
        const turn = advanceAITurn(actor, Math.atan2(-dx, -dz), dt, true);
        if (turn.mayMove && postureReady(actor)) world.moveInfantry(actor.position,
          dx / length * dt * FOOT_SPEEDS[actor.groundType].jog, dz / length * dt * FOOT_SPEEDS[actor.groundType].jog, .42,
          movementObstacles(actor.position.x, actor.position.z));
        actor.position.y = world.walkHeight(actor.position.x, actor.position.z, actor.position.y);
        actor.locomotion.speed = Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ) / dt;
        actor.locomotion.mode = actor.locomotion.speed > .06 ? 'jog' : 'idle';
        actor.walkPhase += actor.locomotion.speed * dt * 2.5;
        actor.walkPoseReady = actor.locomotion.speed > .06;
        continue;
      }
    }
    if (actor.friendly && actor.nativeMotion && !tactics.lastSeen && actor.firingPose) { actor.stance = 'standing'; actor.firingPose = null; }
    const position = actor.position;
    position.y = world.walkHeight(position.x, position.z, position.y);
    const escape = position.y < 1 ? world.doorSystem.swingEscape(position) : null;
    if (escape) {
      const dx = escape.x - position.x, dz = escape.z - position.z, distance = Math.max(.01, Math.hypot(dx, dz));
      world.moveInfantry(position, dx / distance * Math.min(distance, dt * 2), dz / distance * Math.min(distance, dt * 2), .42, movementObstacles(position.x, position.z));
      position.y = world.walkHeight(position.x, position.z, position.y);
      tactics.mode = 'yield-door'; tactics.blockedBy = 'door';
      resetAIRifleAim(actor.aiRifle, 'moving');
      continue;
    }
    const eye = actor.nativeMotion ? soldierEyePosition(actor) : { x: position.x, y: position.y + 1.45, z: position.z };
    const from = new THREE.Vector3(eye.x, eye.y, eye.z);
    if (time >= actor.nextThink && sensorBudget > 0) {
      const sensingStarted = benchmark ? performance.now() : 0;
      sensorBudget--;
      actor.nextThink = time + .6 + battleRandom() * .2;
      const candidates = actorGrid.near(position.x, position.z, 75)
        .filter(candidate => {
          if (candidate.friendly === actor.friendly || candidate.health <= 0) return false;
          if (!canRiflemanTrackTarget(candidate.targetKind)) {
            combatStats.rifleAircraftCandidatesIgnored++;
            return false;
          }
          return true;
        })
        .sort((a, b) => position.distanceToSquared(a.position) - position.distanceToSquared(b.position)).slice(0, 8);
      let closest = 75, closestObservation = null;
      actor.target = null;
      for (const candidate of candidates) {
        if (candidate.health <= 0) continue;
        const to = targetAimPoint(candidate);
        const distance = from.distanceTo(to);
        const angle = Math.atan2(position.x - to.x, position.z - to.z);
        const inView = distance < 9 || Math.cos(angle - actor.heading) > .25 || time < tactics.suppressedUntil;
        const armorCandidate = candidate.targetKind === 'closed-armor' && actor.grenades.packs > 0;
        if (inView && (distance < closest || armorCandidate)) {
          const observed = visibleTargetPoint(candidate, point => hasLine(from, point, 75, candidate.vehicleId));
          if (candidate.id === tactics.threatId) tactics.lastSightCheck = { time, targetId: candidate.id, visible: Boolean(observed) };
          if (observed) {
            if (armorCandidate) tactics.seenArmor = { vehicleId: candidate.vehicleId, time };
            if (distance < closest) {
              closest = from.distanceTo(observed);
              closestObservation = observed;
              actor.target = candidate;
            }
          }
        }
      }
      if (actor.target) {
        rememberThreat(tactics, closestObservation, time, actor.target.targetKind, 'vision', actor.target.id);
        if (actor.target.targetKind === 'closed-armor') combatStats.armorThreatsObserved++;
      } else {
        for (const heard of [...combatSounds].reverse()) {
          if (heard.friendly === actor.friendly || time - heard.time > 2 || heard.id <= (tactics.lastSound || 0)) continue;
          const audible = hasLine(from, new THREE.Vector3(heard.x, heard.y, heard.z), 90) ? heard.radius : heard.radius * .45;
          if (Math.hypot(heard.x - position.x, heard.z - position.z) < audible) {
            tactics.lastSound = heard.id;
            rememberThreat(tactics, { x: heard.x + Math.sin(tactics.id) * 2, y: heard.y, z: heard.z + Math.cos(tactics.id) * 2 }, time, 'person', 'sound');
            break;
          }
        }
      }
      if (benchmark) telemetry.add('sensingMs', performance.now() - sensingStarted);
    }
    const target = actor.target?.health > 0 ? actor.target : null;
    if (tryAIThrowable(actor, target, dt)) continue;
    const oldEscort = tactics.armorEscort;
    if (oldEscort) escortClaims.delete(`${oldEscort.vehicleId}:${oldEscort.slot}`);
    const assaultObjective = formationObjective(actor, objective);
    const escort = actor === builder && !target ? null : chooseTankCover({ actor, vehicles: armor, objective: assaultObjective,
      threat: target?.position ?? tactics.lastSeen,
      reserved: (id, slot) => escortClaims.has(`${id}:${slot}`),
      blocked: point => circleBlocked(point.x, point.z, .46, movementObstacles(point.x, point.z)) ||
        actorGrid.near(point.x, point.z, 1).some(other => other !== actor && other.health > 0 && !other.vehicleId &&
          Math.hypot(other.position.x - point.x, other.position.z - point.z) < .9),
      clear: (from, to) => segmentClear(from, to, .46, escortObstacles),
    });
    tactics.armorEscort = escort ? { vehicleId: escort.vehicleId, slot: escort.slot, x: escort.x, z: escort.z } : null;
    if (escort) escortClaims.set(`${escort.vehicleId}:${escort.slot}`, actor.id);
    if (!escort && oldEscort) {
      if (tactics.cover?.kind === 'tank') { coverClaims.delete(tactics.cover.id); tactics.cover = null; }
      actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
    }
    const hostileRally = !actor.friendly && !target ? spawnPoints.find(point => point.team === 'friendly' && point.kind === 'rally' && point.health > 0 && Math.hypot(point.x - position.x, point.z - position.z) < 40 && hasLine(from, new THREE.Vector3(point.x, .8, point.z), 40)) : null;
    if (!target && !hostileRally) resetAIRifleAim(actor.aiRifle, 'no-target');
    const offensive = !actor.playerUnit || actor.order === 'advance';
    const closeFight = actor.friendly && target && Math.hypot(position.x - target.position.x, position.z - target.position.z) < 8;
    const assault = offensive && !closeFight &&
      formationAssaultAction(tactics, position, assaultObjective, time, Boolean(target || hostileRally)) === 'advance';
    const buildingRally = actor === builder && !spawnPoints.some(point => point.team === 'enemy' && point.kind === 'rally' && point.health > 0) && !target && !tactics.lastSeen;
    if (assault && !buildingRally) {
      if (tactics.cover) {
        coverClaims.delete(tactics.cover.id);
        tactics.cover = null; tactics.enteredCover = false;
        actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
      }
      tactics.mode = 'assault';
      resetAIRifleAim(actor.aiRifle, 'moving');
      const goal = formationDestination(actor, objective);
      if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7) walkActor(actor, goal, 3, dt, true);
    } else if (target) {
      actor.buildProgress = 0;
      fightFromCover(actor, target, dt, escort);
    } else if (escort) {
      tactics.mode = 'follow-tank';
      if (Math.hypot(position.x - escort.x, position.z - escort.z) > .6) walkActor(actor, escort, 3, dt);
      else tactics.mode = 'tank-cover';
    } else if (tactics.lastSeen && canRiflemanTrackTarget(tactics.threatKind) &&
      !(actor.friendly && (!actor.playerUnit || actor.order === 'advance') && tactics.threatKind !== 'closed-armor')) {
      if (tactics.cover || tactics.shotMovePending || time < (tactics.relocatedFireUntil ?? 0) ||
        tactics.threatKind === 'closed-armor') fightFromCover(actor, null, dt);
      else {
        tactics.mode = 'search';
        if (actor.playerUnit && actor.order === 'hold') {
          walkActor(actor, floorDestination(actor.orderPoint, holdDestination(actor), world.town.buildings), 2.4, dt);
        } else if (Math.hypot(position.x - tactics.lastSeen.x, position.z - tactics.lastSeen.z) > 3 && (tactics.slot % 2 === Math.floor(time / 2.6) % 2)) walkActor(actor, tactics.lastSeen, 2.3, dt);
      }
    } else if (hostileRally) {
      const targetPosition = new THREE.Vector3(hostileRally.x, .8, hostileRally.z);
      const facing = advanceAITurn(actor, Math.atan2(position.x - hostileRally.x, position.z - hostileRally.z), dt).facing;
      actor.rifleReady = facing && actor.locomotion.aimRecovery === 0;
      let muzzle = null;
      if (attemptAIRifleShot(actor, { now: time, targetId: hostileRally.id, mayFire: facing,
        postureSettled: postureReady(actor) && nativeAimReady(actor), suppressed: time < tactics.suppressedUntil,
        confirmShot: () => {
          muzzle = clearAIRifleLine(actor, from, targetPosition);
          return muzzle ? from.distanceTo(targetPosition) : null;
        } })) {
        actor.nextFire = time + (infantryWeaponProfile(actor.rifle).automatic
          ? actor.rifle.shots % 3 === 0 ? .8 : infantryWeaponProfile(actor.rifle).cycleSeconds : 1.4);
        const source = captureAttackSource(entities, actor, actor.rifle);
        combatStats.aiRifleShots++;
        combatEvents.publish('shot', { source, weaponType: 'infantry', start: muzzle, end: targetPosition,
          automatic: infantryWeaponProfile(actor.rifle).automatic, muzzle: true, color: 0xdfb17a }, time);
        damageRally(hostileRally, 15, source);
      }
    } else if (actor.friendly) {
      tactics.mode = actor.playerUnit && actor.order === 'hold' ? 'hold' : actor.playerUnit && actor.order === 'follow' ? 'follow' : 'formation-advance';
      if (actor.playerUnit && actor.order === 'hold') {
        walkActor(actor, floorDestination(actor.orderPoint, holdDestination(actor), world.town.buildings), 3, dt);
      } else if (!actor.playerUnit || actor.order === 'advance') {
        const goal = formationDestination(actor, objective);
        if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7) walkActor(actor, goal, 3, dt);
      } else {
        const offset = sectionOffset(actor.index % BATTLE_RULES.sectionMembers);
        const goal = floorDestination(player.position,
          { x: player.position.x + Math.cos(yaw) * offset.x * 1.5 + Math.sin(yaw) * (offset.z * 1.5 + 5),
            z: player.position.z - Math.sin(yaw) * offset.x * 1.5 + Math.cos(yaw) * (offset.z * 1.5 + 5) }, world.town.buildings);
        if (Math.hypot(position.x - goal.x, position.z - goal.z) > .65) walkActor(actor, goal, 3.5, dt);
      }
    } else if (buildingRally) {
      tactics.mode = 'engineer';
      const buildSite = { x: -48, z: -53 };
      if (Math.hypot(position.x - buildSite.x, position.z - buildSite.z) > 1.3) walkActor(actor, buildSite, 3.4, dt);
      else {
        const reason = rallyBuildBlockReason(buildSite, objectives, hostilePositions('enemy'), deploymentObstacles(), 'enemy');
        actor.buildProgress = reason ? 0 : actor.buildProgress + dt;
        if (actor.buildProgress >= SPAWN_RULES.buildSeconds) {
          completeRally('enemy', buildSite, actor.id);
          actor.buildProgress = 0;
        }
      }
    } else {
      tactics.mode = 'advance';
      const goal = formationDestination(actor, objective);
      if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7) walkActor(actor, goal, 3, dt);
    }
    if (actor.friendly && (actor.locomotion.speed > .1 || actor.turningThisStep)) {
      actor.stance = 'standing'; actor.firingPose = null; tactics.postureNeedsChoice = true; tactics.postureUntil = time;
    }
    const atObjective = objectives.some(point => Math.hypot(position.x - point.x, position.z - point.z) < point.radius);
    for (const other of actorGrid.near(position.x, position.z, 2)) {
      if (other === actor || other.health <= 0 || other.vehicleId || Math.abs(position.y - other.position.y) > 1.5) continue;
      const dx = position.x - other.position.x;
      const dz = position.z - other.position.z;
      const distance = Math.hypot(dx, dz);
      const spacing = other === player ? 1.75 : actor.tactics.cover ? .92 : atObjective ? 1.1 : 1.45;
      if (distance < spacing) {
        const angle = distance > .01 ? Math.atan2(dz, dx) : tactics.id * 2;
        const push = Math.min(.06, (spacing - distance) * dt * 3);
        const beforeX = position.x, beforeZ = position.z;
        world.moveInfantry(position, Math.cos(angle) * push, Math.sin(angle) * push, .42, movementObstacles(position.x, position.z));
        if (actor.locomotion.speed < .1 && Math.hypot(position.x - beforeX, position.z - beforeZ) / dt > .1) {
          actor.locomotion.speed = Math.hypot(position.x - beforeX, position.z - beforeZ) / dt;
          actor.locomotion.mode = 'walk'; actor.rifleReady = false;
        }
      }
    }
    position.y = world.walkHeight(position.x, position.z, position.y);
    if (!['playing', 'transferring', 'dead'].includes(state)) break;
  }
  for (const actor of allForces) {
    if (actor === player || actor.health <= 0 || actor.vehicleId) continue;
    advanceStamina(actor.locomotion, dt, actor.locomotion.sprinting, FOOT_SPEEDS[actor.groundType].load);
  }
  aiCursor = (aiCursor + 12) % Math.max(1, allForces.length);
  if (time >= populationRefreshAt) {
    populationRefreshAt = time + 1;
    const retainActor = actor => {
      if (actor.health > 0) return true;
      if (!corpses.has(actor.id)) clearActors([actor]);
      return false;
    };
    enemies = enemies.filter(retainActor);
    friendlyAI = friendlyAI.filter(retainActor);
    rebuildForces();
    for (const formation of formations.filter(item => !item.player)) {
      if (formation.members.some(actor => actor.health > 0)) continue;
      if (formation.variant !== CHI_HA.id) formation.respawnAt ??= time + BATTLE_RULES.respawnSeconds;
      if (reinforcementDue(formation, time)) spawnFormation(formation);
    }
  }
}

function updateObjectives(dt) {
  for (const [index, point] of objectives.entries()) {
    const inRadius = actor => actor.health > 0 && occupiedVehicle(entities, actor)?.type !== 'plane' &&
      Math.hypot(actor.position.x - point.x, actor.position.z - point.z) < point.radius;
    const owner = point.owner;
    const status = advanceCapture(point, dt, friendlyForces.some(inRadius), enemies.some(inRadius));
    for (const cue of objectiveVoiceTracker.update(point, status)) {
      battleVoiceEvent(cue, { eventKey: `objective:${point.id}:${cue}` });
    }
    if (owner !== point.owner) {
      world.flags[index].material.color.setHex(point.owner === 'friendly' ? 0x70865d : point.owner === 'enemy' ? 0xb66551 : 0xa19469);
      assaultAssignmentAt = 0;
      if (point.owner === 'friendly') {
        const next = objectives.filter(candidate => candidate.id !== point.id &&
          (candidate.owner !== 'friendly' || candidate.status === 'contested' || candidate.control < 1))
          .sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z))[0];
        if (next) for (const actor of allies.filter(actor => actor.health > 0 && actor.order === 'advance' && actor.orderObjectiveId === point.id)) {
          if (actor.tactics.cover && coverClaims.get(actor.tactics.cover.id)?.owner === actor.tactics.id) coverClaims.delete(actor.tactics.cover.id);
          pathRequests.delete(actor.tactics.id);
          actor.orderObjectiveId = next.id;
          actor.orderPoint = { x: next.x, y: world.groundHeight(next.x, next.z), z: next.z };
          resetObjectiveMovement(actor, next.id);
        }
      }
      toast(`${point.id} · ${point.name} ${point.owner === 'friendly' ? '我方占领' : point.owner === 'enemy' ? '日军占领' : '已被中和'}`, 4);
    }
  }
  const winner = advanceConquest(conquest, objectives, dt, remaining);
  if (winner) showOverlay(winner === 'friendly' ? 'victory' : winner === 'enemy' ? 'defeat' : 'draw');
}

function updateProjectiles(dt) {
  for (const shell of [...shells]) {
    const event = advanceProjectile(shell, dt, (from, to) => {
      const origin = new THREE.Vector3(from.x, from.y, from.z);
      direction.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const travel = direction.length();
      if (travel <= .001) return null;
      ray.set(origin, direction.normalize()); ray.far = travel;
      const hit = ray.intersectObjects([...solidIndex.candidates(origin, direction, travel), ...vehicleSolids(shell.source.vehicleId)], true)[0];
      ray.far = Infinity;
      return hit?.point || null;
    });
    shellViews.get(shell.id).position.copy(shell.position);
    if (event) {
      scene.remove(shellViews.get(shell.id));
      shellViews.delete(shell.id);
      shells.splice(shells.indexOf(shell), 1);
      projectileImpacts.push(event);
      if (projectileImpacts.length > 32) projectileImpacts.shift();
      explode(new THREE.Vector3(event.position.x, event.position.y, event.position.z), event.damage, event.radius, event.source);
    }
  }
}

function updateEffects(dt) {
  combatEffects.update(dt, time, entities.vehicles.values());
  for (const effect of [...effects]) {
    if (time >= effect.end) {
      removeEffect(effect);
      continue;
    }
    const t = Math.max(0, (time - effect.bornAt) / effect.life);
    effect.lastAt = Math.max(time, effect.bornAt);
    effect.object.material.opacity = (1 - t) * .8;
  }
  combatFeedback.update(dt);
  $('damage-vignette').style.opacity = graphics.snapshot.effects.damageVignette ? String(combatFeedback.flash) : '0';
  $('hit-marker').style.opacity = time < combatFeedback.markerUntil ? '1' : '0';
  if (time >= toastUntil) $('toast').style.opacity = '0';
  mortarMarker.visible = state === 'playing' && unit.type === 'mortar';
  if (mortarMarker.visible) {
    mortarMarker.position.copy(getMortarTarget());
    $('aim-label').textContent = `弹着点 · ${Math.round(mortarMarker.position.distanceTo(camera.position))} 米`;
  }
}

function drawRadar(ctx = radarContext) {
  const yaw = controlPose.yaw;
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
  const [areaX, areaZ] = map(BATTLE_AREA.minX, BATTLE_AREA.minZ);
  const areaW = (BATTLE_AREA.maxX - BATTLE_AREA.minX) / 220 * size;
  const areaD = (BATTLE_AREA.maxZ - BATTLE_AREA.minZ) / 220 * size;
  ctx.fillStyle = '#b9574538';
  ctx.fillRect(0, 0, size, areaZ);
  ctx.fillRect(0, areaZ + areaD, size, size - areaZ - areaD);
  ctx.fillRect(0, areaZ, areaX, areaD);
  ctx.fillRect(areaX + areaW, areaZ, size - areaX - areaW, areaD);
  ctx.strokeStyle = '#e5a078';
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(areaX, areaZ, areaW, areaD);
  ctx.setLineDash([]);
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  for (const point of objectives) {
    const [x, z] = map(point.x, point.z);
    ctx.fillStyle = point.status === 'contested' ? '#f6df92' : point.owner === 'friendly' ? '#9aaa78' : point.owner === 'enemy' ? '#ed9d8b' : '#d9bc7e';
    ctx.fillText(point.id, x, z);
    ctx.fillStyle = '#9aaa78';
    ctx.fillRect(x - 6, z + 3, 12 * point.progress, 2);
    ctx.fillStyle = '#ed9d8b';
    ctx.fillRect(x - 6, z + 6, 12 * point.enemyProgress, 2);
  }
  for (const point of spawnPoints) {
    if (point.kind === 'air' || (point.kind === 'rally' && point.health <= 0)) continue;
    if (point.team === 'enemy' && point.kind === 'rally' && allies[current]?.position.distanceTo(new THREE.Vector3(point.x, 0, point.z)) > 35) continue;
    const [x, z] = map(point.x, point.z);
    ctx.fillStyle = point.team === 'friendly' ? '#91bca1' : '#be8d76';
    ctx.fillRect(x - 2.5, z - 2.5, 5, 5);
    if (point.id === pendingSpawn) {
      ctx.strokeStyle = '#f7dfa1';
      ctx.strokeRect(x - 5, z - 5, 10, 10);
    }
  }
  for (const actor of friendlyForces) {
    if (actor.health <= 0) continue;
    const [x, z] = map(actor.position.x, actor.position.z);
    ctx.fillStyle = actor === allies[current] ? '#f6e0a9' : '#94bea1';
    ctx.beginPath(); ctx.arc(x, z, actor === allies[current] ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    if (actor === allies[current]) {
      ctx.strokeStyle = '#f6e0a9';
      ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x - Math.sin(yaw) * 9, z - Math.cos(yaw) * 9); ctx.stroke();
    }
  }
}

function updateHUD() {
  renderSquadScores();
  const transport = occupiedVehicle(entities, allies[current]);
  const tank = transport?.type === 'tank' ? transport : null;
  $('tank-orientation').hidden = !tank;
  $('tank-machine-gun').hidden = !tank;
  document.querySelector('.weapon-status .ammo').hidden = Boolean(tank && !occupiedSeat(entities).canFire);
  if (tank) {
    const heading = tankHeading(tank, controlPose.yaw);
    for (const name of ['hull', 'turret', 'north']) {
      $(`tank-${name}`).setAttribute('transform', `rotate(${heading[name]} 44 44)`);
      $(`tank-${name}`).dataset.heading = String(heading[name]);
    }
    const gun = tank.machineGuns.find(gun => gun.mount === 'coax');
    $('tank-machine-gun').textContent = occupiedSeat(entities).canFire
      ? `空格机枪 ${gun.reloadUntil ? '换带中' : `${gun.ammo}/${gun.settings.magazine}`}` : '驾驶席 · Y切换武器席';
  }
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = allies[current].locomotion;
  $('movement-status').hidden = !foot || motion.stamina >= .999 && !motion.exhausted;
  if (foot) {
    const names = { idle: '站定', walk: '慢走', jog: '慢跑', sprint: '负重冲刺', crouch: '蹲行', prone: '匍匐', aim: '谨慎移动', turn: '转向' };
    $('pace-label').textContent = world.waterDepth(allies[current].position.x, allies[current].position.z, allies[current].position.y) > .05
      ? '浅水涉渡' : motion.aimRecovery > 0 && !motion.sprinting ? '收枪恢复中' : names[motion.mode];
    $('stamina-fill').style.width = `${motion.stamina * 100}%`;
    $('stamina-meter').setAttribute('aria-valuenow', String(Math.round(motion.stamina * 100)));
    $('stamina-label').textContent = `${motion.exhausted ? '体力不足 · 恢复中' : '体力'} ${Math.round(motion.stamina * 100)}%`;
    $('movement-status').classList.toggle('exhausted', motion.exhausted);
  }
  const position = allies[current].position;
  const distanceToPoint = point => (position.x - point.x) ** 2 + (position.z - point.z) ** 2;
  const active = objectives.reduce((nearest, point) => distanceToPoint(point) < distanceToPoint(nearest) ? point : nearest);
  const ownerLabel = point => point.owner === 'friendly' ? '我方控制' : point.owner === 'enemy' ? '日军控制' : '中立';
  const controlCount = team => objectives.filter(point => point.owner === team).length;
  $('objectives').innerHTML = `<span class="control-count friendly" aria-label="我方控制${controlCount('friendly')}点">我 ${controlCount('friendly')}</span>` +
    objectives.map(point => {
      const label = `${point.id} ${ownerLabel(point)}${point.status === 'contested' ? ' · 争夺中' : ''} · 我方 ${Math.round(point.progress * 100)}% / 日军 ${Math.round(point.enemyProgress * 100)}%`;
      return `<span class="objective-chip ${point.owner === 'friendly' ? 'captured' : point.owner === 'enemy' ? 'enemy' : 'neutral'} ${point.status === 'contested' ? 'contested' : ''}" role="img" aria-label="${label}" title="${label}">${point.id}<small class="point-progress" aria-hidden="true"><i style="width:${point.progress * 100}%"></i><b style="width:${point.enemyProgress * 100}%"></b></small></span>`;
    }).join('') + `<span class="control-count enemy" aria-label="日军控制${controlCount('enemy')}点">敌 ${controlCount('enemy')}</span>`;
  const inCaptureArea = unit.type !== 'plane' && distanceToPoint(active) <= active.radius ** 2;
  $('objective-title').textContent = inCaptureArea ? `${active.id} · ${active.name} · ${ownerLabel(active)}` : '三点控制';
  const domination = conquest.dominationTeam ? ` · ${conquest.dominationTeam === 'friendly' ? '我方' : '日军'}全控 ${Math.floor(conquest.dominationTime)}/${DOMINATION_SECONDS}秒` : '';
  document.querySelector('.objective-banner').hidden = !inCaptureArea && !conquest.dominationTeam;
  $('objective-help').textContent = `${!inCaptureArea ? '保持全点控制20秒获胜' : active.status === 'contested' ? '争夺中 · 清除圈内敌军' : active.status === 'capturing' ? '占领 / 反夺进行中' : active.owner === 'friendly' ? '守住阵地' : '进入范围占领'}${domination}`;
  $('capture-fill').style.width = `${Math.abs(active.control) * 100}%`;
  $('capture-fill').style.background = active.control < 0 ? '#ed9d8b' : '#9aaa78';
  $('timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`;
  $('ammo').textContent = grenadeEquipped ? String(selectedThrowable === 'explosive-pack' ? allies[current].grenades.packs : allies[current].grenades.ammo) : unit.reloadUntil ? '装填' : String(unit.ammo);
  $('ammo-max').textContent = `/ ${grenadeEquipped ? GRENADE.count : unit.type === 'infantry' ? infantryWeaponProfile(allies[current].rifle).magazine : TYPES[unit.type].magazine}`;
  $('ammo').style.fontSize = !grenadeEquipped && unit.reloadUntil ? '25px' : '';
  const health = occupiedVehicle(entities, allies[current])?.health ?? allies[current].health;
  $('health-fill').style.width = `${health / TYPES[unit.type].health * 100}%`;
  $('health-text').textContent = deathTransfer.active && !deathTransfer.handedOff
    ? `队员阵亡${occupiedVehicle(entities, allies[current]) ? ` · 车体 ${Math.ceil(health)}` : ''}`
    : `${unit.type === 'tank' ? '装甲' : '生命'} ${Math.ceil(health)}`;
  const deployedType = entities.units.get(entities.control.unitId).type;
  $('members').classList.toggle('platoon-members', deployedType === 'infantry');
  $('members').innerHTML = allies.map((actor, index) => {
    const label = unit.type === 'tank' ? ['车长', '炮手', '驾驶员'][index] : unit.type === 'plane' ? '飞行员' : unit.type === 'infantry' ? actor.role === 'sniper' ? '狙' : actor.role === 'machine-gunner' ? '机' : index + 1 : actor.role === 'engineer' ? '工兵' : `${index + 1} 号`;
    const title = `${Math.floor(index / BATTLE_RULES.sectionMembers) + 1}班 ${index + 1}号 ${['machine-gunner', 'sniper'].includes(actor.role) ? `${actor.role === 'sniper' ? '狙击手' : '轻机枪手'} · ${infantryWeaponProfile(actor.rifle).name}` : actor.role === 'engineer' ? '工兵' : '步枪手'}`;
    return `<span title="${title}" aria-label="${label}${actor.health <= 0 ? ' 阵亡' : ''}" class="member ${index === current ? 'active' : ''} ${actor.health <= 0 ? 'dead' : ''}">${actor.health <= 0 ? '×' : label}</span>`;
  }).join('');
  const china = battleSummary('friendly'), japan = battleSummary('enemy');
  const diagnosticLabel = benchmark?.diagnostic ? benchmark.scenario === 'ford' ? '浅河坦克通行诊断 · 非交火基准　' : benchmark.scenario === 'control' ? 'G2控制诊断 · 非正式人口　' : benchmark.scenario === 'bridge' ? '桥面几何诊断 · 非交火基准　' : benchmark.scenario === 'interior' ? '门与室内几何诊断 · 非交火基准　' : '5v5诊断 · 非正式人口　' : '';
  const audioLabel = audioUnsupported ? '音效不可用　'
    : `${rifleAudioFailure ? '步枪录音未加载（原合成声）　' : ''}${footstepAudioFailure ? '脚步录音未加载（原合成声）　' : ''}${mechanicalAudioFailure ? '步枪机械录音未加载（原合成声）　' : ''}${battleVoicesFailure ? '战场语音不可用　' : ''}${battleReactionsFailure ? '真人战斗反应不可用　' : ''}`;
  $('force-status').textContent = `${audioLabel}${nraCharacter ? `友军 A/B 军服／钢盔 · ${nraCharacter.issue ?? '基础动作'}　` : ''}${ijaCharacter ? '日军旧制军服／钢盔　' : ''}${diagnosticLabel}我方 ${china.units}/${china.rosterUnits}单位 · ${china.alive}人 · 载具${china.vehicles}/2　日军 ${japan.units}/${japan.rosterUnits}单位 · ${japan.alive}人 · 载具${japan.vehicles}/2`;
  $('hud-notice').hidden = !audioLabel && !diagnosticLabel;
  $('hud-notice').textContent = audioLabel + diagnosticLabel;
  if (!$('scoreboard').hidden) {
    $('scoreboard-clock').textContent = $('timer').textContent;
    const points = $('scoreboard-objectives'); points.replaceChildren();
    for (const point of objectives) {
      const chip = document.createElement('span'); chip.className = `score-point ${point.owner ?? 'neutral'}`;
      chip.textContent = point.id; chip.title = `${point.id} ${point.owner === 'friendly' ? '我军' : point.owner === 'enemy' ? '日军' : '中立'}`;
      points.append(chip);
    }
    const summary = $('scoreboard-stats'); summary.replaceChildren();
    const enemyTotal = battleStats.snapshot.filter(row => row.team === 'enemy').reduce((total, row) => total + row.total, 0);
    for (const [kind, value, label] of [['total', kills + teamKills, '我军人员击杀'], ['total', enemyTotal, '日军人员击杀']]) {
      const chip = document.createElement('span'); chip.title = label; chip.setAttribute('aria-label', `${label} ${value}`);
      chip.className = label.startsWith('我军') ? 'friendly-total' : 'enemy-total';
      chip.append(scoreIcon(kind), document.createTextNode(String(value))); summary.append(chip);
    }
  }
  $('section-status').hidden = deployedType !== 'infantry';
  $('section-status').textContent = deployedType === 'infantry' ? `本班 ${allies.filter(actor => actor.health > 0).length}/${allies.length}` : '';
  $('kill-feed').innerHTML = combatFeedback.entries(time).map(entry => `<span class="feed-entry">${entry.text}</span>`).join('');
  drawRadar();
}

function updateDoorPrompt() {
  const prompt = $('interaction-prompt');
  const usable = state === 'playing' && (unit?.type === 'infantry' || unit?.type === 'mortar') && !construction.blueprint;
  const door = usable ? world.doorSystem.focus(camera) : null;
  const transport = state === 'playing' ? occupiedVehicle(entities, allies[current]) : null;
  const nearby = usable && !door ? groundVehicleFocus() : null;
  prompt.hidden = !door && !transport && !nearby;
  prompt.textContent = transport ? transport.type === 'tank' ? 'F 离开当前席位 · 原车保留' : '空中离机尚未实现'
    : door ? `F  ${Math.abs(door.targetAngle) < .01 ? '开门' : '关门'}${door.blocked ? ' · 门后受阻，移开后继续' : ''}`
    : nearby ? 'F 返回原车空余席位' : '';
}

function menuCamera(now) {
  const t = now * .000035;
  camera.position.set(47 + Math.sin(t) * 4, 19, 70 + Math.cos(t) * 4);
  camera.lookAt(-9, 2, -1);
  camera.fov = 55;
  camera.updateProjectionMatrix();
}

function advanceBattleStep(dt, presentationTime) {
  time += dt;
  remaining = Math.max(0, remaining - dt);
  let started = benchmark ? performance.now() : 0;
  world.doorSystem.update(dt, allForces.filter(actor => actor.health > 0 && occupiedVehicle(entities, actor)?.type !== 'plane').map(actor => ({
    x: actor.position.x, y: actor.position.y, z: actor.position.z, radius: actor.vehicleId && occupiedVehicle(entities, actor).type === 'tank' ? 1.9 : .42,
  })));
  if (benchmark) { telemetry.add('doorsMs', performance.now() - started); started = performance.now(); }
  updateVehicles(dt);
  vehicleRenderer.update(entities.vehicles.values(), time, occupiedVehicle(entities, controlledSoldier(entities))?.id);
  updateWeaponSimulation(dt);
  if (state === 'playing') updatePlayer(dt);
  for (const actor of allForces) if (actor.nativeMotion && actor.health > 0 &&
    (state !== 'playing' || actor !== controlledSoldier(entities))) advanceNraMotion(actor, dt);
  if (benchmark) { telemetry.add('playerMs', performance.now() - started); started = performance.now(); }
  if (activeStates.has(state)) updateAI(dt);
  if (activeStates.has(state)) updateBattleBoundary(dt);
  if (benchmark) { telemetry.add('aiMs', performance.now() - started); started = performance.now(); }
  if (activeStates.has(state)) updateObjectives(dt);
  if (activeStates.has(state)) updateProjectiles(dt);
  if (activeStates.has(state)) updateGrenades(dt);
  if (corpses.size > CORPSE_RULES.softLimit && time >= corpseCleanupAt) {
    corpseCleanupAt = time + 1;
    for (const actor of expiredCorpses(corpses.values(), time)) {
      corpses.delete(actor.id); clearActors([actor]);
    }
  }
  presentCombatEvents(presentationTime);
  if (activeStates.has(state)) updateEffects(dt);
  updateDeathFeedback(dt);
  presentControlEvents();
  if (benchmark) telemetry.add('effectsMs', performance.now() - started);
}

function renderSimulationStatus() {
  const status = simulationClock.snapshot, element = $('simulation-status');
  element.hidden = !status.active || status.pendingSeconds < SIMULATION_CLOCK.lagWarningSeconds;
  if (!element.hidden) {
    element.textContent = `模拟积压 ${status.pendingSeconds.toFixed(1)}秒 · 缓慢追赶`;
    element.title = `模拟缓慢追赶 · 上限${status.limits.maxRecoveryRate.toFixed(1)}倍，未丢弃积压时间`;
  }
}

function tick(now) {
  if (fatal) return;
  footstepAudio?.beginBatch(entities.control.soldierId, state === 'playing' && !controlledSoldier(entities)?.vehicleId);
  const mechanical = mechanicalPlayback();
  mechanicalAudio?.beginBatch(mechanical.owner, mechanical.playing);
  const cpuStarted = benchmark ? performance.now() : 0;
  const frameInterval = now - lastFrame;
  const activeFrame = activeStates.has(state);
  const presentationTime = time + simulationClock.beginFrame(performance.now());
  if (benchmark && activeFrame) telemetry.begin(now, frameInterval, 0);
  if (state === 'playing') {
    frameTimes.push(now - lastFrame);
    if (frameTimes.length > 180) frameTimes.shift();
  }
  lastFrame = now;
  if (state === 'menu') menuCamera(now);
  if (activeFrame) {
    for (let dt; activeStates.has(state) && (dt = simulationClock.takeStep()) > 0;) {
      if (benchmark) telemetry.add('simulatedDt', dt);
      advanceBattleStep(dt, presentationTime);
    }
    const started = benchmark ? performance.now() : 0;
    if (time >= hudAt) { updateHUD(); hudAt = time + .12; }
    if (state === 'dead' && time >= deploymentRefreshAt) { refreshDeployment(); deploymentRefreshAt = time + .25; }
    if (benchmark) telemetry.add('hudMs', performance.now() - started);
  }
  presentRifleReports();
  for (const puff of world.smoke) {
    if (!puff.visible) continue;
    const phase = (now * .000025 + puff.userData.phase) % 1;
    puff.position.set(puff.userData.originX + phase * 8, 4 + phase * 27, puff.userData.originZ);
    puff.scale.setScalar(5 + phase * 16);
  }
  for (const flag of world.flags) flag.rotation.y = Math.sin(now * .0015) * .08;
  updateDoorPrompt();
  renderGrenades();
  renderSniperScope();
  renderDeathFeedback();
  renderConstruction();
  renderSimulationStatus();
  renderBattleBoundary();
  rallyRenderer.update(spawnPoints);
  const instancesStarted = benchmark ? performance.now() : 0;
  const displayed = [...new Set([...allForces.filter(actor => actor.health > 0), ...corpses.values()])];
  nraCharacter?.update(displayed.filter(actor => actor.team === 'friendly'), time, entities.control.soldierId, graphics.snapshot.preset);
  ijaCharacter?.update(displayed.filter(actor => actor.team === 'enemy'), time, entities.control.soldierId, graphics.snapshot.preset);
  uniformExcludedIds.clear();
  for (const force of [nraCharacter, ijaCharacter]) for (const id of force?.excludedIds ?? []) uniformExcludedIds.add(id);
  soldierRenderer.update(displayed, graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds);
  const renderStarted = benchmark ? performance.now() : 0;
  if (benchmark) telemetry.add('instancesMs', renderStarted - instancesStarted);
  renderer.render(scene, camera);
  if (benchmark && activeFrame) {
    telemetry.add('renderMs', performance.now() - renderStarted);
    telemetry.add('cpuMs', performance.now() - cpuStarted);
    telemetry.end({ simulationTime: time, state, current, shots: combatStats.aiRifleShots, kills, queuedPaths: pathRequests.size,
      simulationSteps: simulationClock.snapshot.stepsThisFrame, simulationBacklogSeconds: simulationClock.snapshot.pendingSeconds,
      activeSeconds: simulationClock.snapshot.activeSeconds,
      oldestPathWaitSeconds: pathRequests.size ? Math.max(...[...pathRequests.values()].map(request => time - request.requestedAt)) : 0,
      friendlyAlive: friendlyForces.filter(actor => actor.health > 0).length,
      enemyAlive: enemies.filter(actor => actor.health > 0).length, drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles, effects: effects.length, shells: shells.length });
  }
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
  pendingSpawn = spawnPoints.find(point => !point.aiOnly && point.team === 'friendly' && supportsSquad(point, type) && !spawnBlockReason(point, type, hostilePositions('friendly'), deploymentObstacles()))?.id || null;
  $('deployment-error').textContent = '';
  refreshDeployment();
});
$('spawn-choices').addEventListener('click', event => {
  const button = event.target.closest('[data-spawn]');
  if (!button || state !== 'dead') return;
  const point = spawnPoints.find(point => point.id === button.dataset.spawn && point.team === 'friendly');
  if (!point || !pendingSquad) return;
  const reason = spawnBlockReason(point, SQUADS[pendingSquad].type, hostilePositions('friendly'), deploymentObstacles());
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
  if (state !== 'pause' || (!allies.some(actor => actor.health > 0) && pausedFrom !== 'transferring')) {
    $('deployment-error').textContent = '整队阵亡后必须选择其他小队出击';
    return;
  }
  setGameState(pausedFrom);
  bindControlInput();
  $('overlay').hidden = true;
  lockMouse();
});
$('back-menu').addEventListener('click', () => {
  setGameState('menu');
  simulationClock.reset(performance.now());
  releaseMouse();
  clearActors(allies);
  clearActors(enemies);
  clearActors(friendlyAI);
  clearActors([...corpses.values()]); corpses.clear();
  vehicleRenderer.clear();
  resetEntities(entities); resetDeathTransfer(deathTransfer);
  armorNavigate.reset();
  playerInput.reset(); controlEvents.clear();
  mechanicalAudio?.reset();
  controlBinding = null;
  clearTransient();
  allies = [];
  enemies = [];
  friendlyAI = []; formations = []; pathRequests.clear(); rebuildForces();
  if (weapon) { camera.remove(weapon); weapon = null; }
  unit = null;
  resetControlledSimulation();
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
  daylight.setEnabled(settings.effects.overcast);
  combatEffects.configure(settings);
  if (weapon?.userData.rifle && allies[current]) {
    updateRifleModel(weapon, allies[current].rifle);
    weapon.userData.rifle.flash.visible &&= settings.effects.muzzle;
  }
  $('damage-vignette').style.opacity = settings.effects.damageVignette ? String(combatFeedback.flash) : '0';
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

function performControlCommand(command) {
  const { action, payload } = command;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  if (allies[current]?.grenades.action && !['look', 'cycleMember', 'releaseGrenade'].includes(action)) {
    if (action === 'pressFire') return;
    toast('正在操作投掷装备；松开左键投掷，换人会丢下已启动的投掷物');
    return;
  }
  if (action === 'prepareGrenade') { prepareGrenade(); return; }
  if (action === 'equipGrenade') { equipGrenade(); return; }
  if (action === 'equipExplosivePack') { equipGrenade('explosive-pack'); return; }
  if (action === 'releaseGrenade') { grenades.release(entities.control.soldierId, time); return; }
  if (action === 'interact') {
    updateCamera(0);
    if (occupiedVehicle(entities, allies[current])) interactVehicle();
    else if (construction.blueprint) toast('先收起建造蓝图，再按 F 操作房门');
    else {
      const door = world.doorSystem.focus(camera);
      if (door) world.doorSystem.interact(door, allies[current].position);
      else if (!interactVehicle()) toast('靠近房门或原车，并看向交互目标再按 F');
    }
  } else if (action === 'reload') reload();
  else if (action === 'equipRifle' && foot) {
    equipPrimary();
  }
  else if (action === 'equipTool' && unit.type === 'infantry') equipTool(true);
  else if (action === 'cycleMember') {
    const next = nextAlive(allies, current);
    if (next >= 0) changeMember(next);
  } else if (action === 'crouch' && foot) controlPose.stance = controlPose.stance === 'crouched' ? 'standing' : 'crouched';
  else if (action === 'prone' && foot) controlPose.stance = controlPose.stance === 'prone' ? 'standing' : 'prone';
  else if (action === 'jump' && foot && jumpHeight === 0) {
    if (controlPose.stance !== 'standing') controlPose.stance = 'standing';
    else if (allies[current].locomotion.stamina >= .1) {
      jumpVelocity = 5;
      allies[current].locomotion.stamina -= .08;
      allies[current].locomotion.regenDelay = 1.4;
    } else toast('体力不足，暂时无法起跳');
  } else if (action === 'startOrder') held.orderStarted = payload.now;
  else if (action === 'finishOrder' && held.orderStarted !== null) {
    squadCommand(payload.now - held.orderStarted > 450);
    held.orderStarted = null;
  } else if (action === 'pressFire') {
    if (grenadeEquipped) prepareGrenade();
    else held.primary = true;
  }
  else if (action === 'pressAim') {
    held.secondary = true;
    if (toolEquipped) selectConstructionBlueprint(construction, entities.control.soldierId);
    else if (!grenadeEquipped) held.aiming = true;
  } else if (action === 'look') {
    const sensitivity = sniperScopeActive() ? infantryWeaponProfile(allies[current].rifle).aimSensitivity : held.aiming ? .6 : 1;
    controlPose.yaw -= payload.x * .0022 * sensitivity;
    controlPose.pitch -= payload.y * .0022 * sensitivity;
  }
}

function dispatchControlCommand(action, payload) {
  const command = playerInput.capture(action, payload);
  const result = playerInput.execute(command, controlOwner(entities), state === 'playing' && controlledSoldier(entities)?.health > 0, performControlCommand);
  if (result.status === 'rejected') toast(result.reason === 'stale-owner' ? '控制对象已改变，旧操作已取消' : '当前操作已取消');
  presentControlEvents();
  return result;
}

const keyActions = { KeyF: 'interact', KeyR: 'reload', Digit1: 'equipRifle', Digit2: 'equipTool', KeyY: 'cycleMember',
  ControlLeft: 'crouch', KeyZ: 'prone', Space: 'jump', Digit5: 'equipGrenade', Digit6: 'equipExplosivePack', KeyG: 'equipGrenade' };
document.addEventListener('wheel', event => {
  if ($('scoreboard').hidden) return;
  const panel = event.target.closest('.score-table-wrap') ?? document.querySelector('.score-table-wrap');
  if (event.shiftKey) panel.scrollLeft += event.deltaY;
  else {
    const before = panel.scrollTop; panel.scrollTop += event.deltaY;
    $('scoreboard').scrollTop += event.deltaY - (panel.scrollTop - before);
  }
  event.preventDefault();
}, { passive: false });

document.addEventListener('keydown', event => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.code === 'Escape' && state === 'transferring' && !event.repeat) { showOverlay(); return; }
  if (event.repeat || state !== 'playing') return;
  keys.add(event.code);
  const action = keyActions[event.code];
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  if (action && (!['crouch', 'prone', 'jump'].includes(action) || foot) &&
      (action !== 'equipTool' || unit.type === 'infantry')) dispatchControlCommand(action);
  if (event.code === 'KeyX') dispatchControlCommand('startOrder', { now: performance.now() });
  if (event.code === 'Tab') {
    if ($('scoreboard').hidden) scoreboardReturnCapture = document.pointerLockElement === canvas;
    $('scoreboard').hidden = false;
    held.primary = held.secondary = held.aiming = false;
    if (unit?.type === 'tank') keys.delete('Space');
    updateHUD();
  }
  if (['AltLeft', 'AltRight'].includes(event.code) && !$('scoreboard').hidden) {
    event.preventDefault(); scoreboardInteractive = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }
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
  if (event.code === 'Tab') {
    $('scoreboard').hidden = true;
    const restore = scoreboardReturnCapture && state === 'playing' && document.pointerLockElement !== canvas;
    scoreboardInteractive = scoreboardReturnCapture = false;
    if (restore) {
      scoreboardRestoring = true;
      const request = lockMouse();
      if (request?.then) request.then(() => { scoreboardRestoring = false; }, () => { scoreboardRestoring = false; });
    }
  }
  if (event.code === 'KeyX' && held.orderStarted !== null) {
    if (state === 'playing') dispatchControlCommand('finishOrder', { now: performance.now() });
    held.orderStarted = null;
  }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('mousedown', event => {
  if (state !== 'playing' || !$('scoreboard').hidden) return;
  if (event.button === 0) {
    if (document.pointerLockElement !== canvas && !held.secondary) lockMouse();
    dispatchControlCommand('pressFire');
  }
  if (event.button === 2) {
    dispatchControlCommand('pressAim');
  }
});
document.addEventListener('mouseup', event => {
  if (event.button === 0) {
    held.primary = false;
    if (state === 'playing' && controlledSoldier(entities)?.grenades.action) dispatchControlCommand('releaseGrenade');
  }
  if (event.button === 2) { held.secondary = false; held.aiming = false; }
});
document.addEventListener('mousemove', event => {
  if (state !== 'playing' || !$('scoreboard').hidden || (document.pointerLockElement !== canvas && !held.secondary)) return;
  dispatchControlCommand('look', { x: event.movementX, y: event.movementY });
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    scoreboardRestoring = false;
    if (!['playing', 'transferring'].includes(state)) { document.exitPointerLock(); return; }
  }
  if (scoreboardInteractive || scoreboardRestoring) return;
  if (!document.pointerLockElement && ['playing', 'transferring'].includes(state)) showOverlay();
});
document.addEventListener('pointerlockerror', () => { scoreboardRestoring = false; });
window.addEventListener('blur', () => { if (['playing', 'transferring'].includes(state)) showOverlay(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && ['playing', 'transferring'].includes(state)) showOverlay(); });
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
  corpses: { rules: CORPSE_RULES, count: corpses.size, members: [...corpses.values()].map(actor => ({
    id: actor.id, team: actor.team, time: actor.casualty.time, age: time - actor.casualty.time,
    variant: actor.casualty.variant, retainGun: actor.casualty.retainGun,
    offset: actor.casualty.offset ? { ...actor.casualty.offset } : null,
    yaw: actor.casualty.yaw ?? 0, wallLimited: actor.casualty.wallLimited ?? false,
    position: { x: actor.position.x, y: actor.position.y, z: actor.position.z } })) },
  build: { ...buildStamp, development: import.meta.env.DEV },
  state, type: unit?.type, squadId: unit?.squadId, time, remaining, kills, teamKills, deployments,
  squadScores: battleStats.snapshot,
  control: { ...entities.control },
  controlBinding: controlBinding ? { ...controlBinding } : null,
  controlSimulation: { toolEquipped, grenadeEquipped, selectedThrowable, jumpHeight, jumpVelocity },
  historicalCharacter: nraCharacter?.focusedSnapshot ?? null,
  historicalForce: nraCharacter?.snapshot ?? null,
  enemyHistoricalCharacter: ijaCharacter?.focusedSnapshot ?? null,
  enemyHistoricalForce: ijaCharacter?.snapshot ?? null,
  battleVoices: audioUnsupported ? { status: 'unavailable' } : battleVoices
    ? { ...battleVoices.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'unavailable', error: battleVoicesFailure },
  battleReactions: audioUnsupported ? { status: 'unavailable' } : battleReactions
    ? battleReactions.snapshot : { status: 'unavailable', error: battleReactionsFailure },
  rifleAudio: audioUnsupported ? { status: 'unavailable' } : rifleAudio
    ? { ...rifleAudio.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'fallback', error: rifleAudioFailure },
  footstepAudio: audioUnsupported ? { status: 'unavailable' } : footstepAudio
    ? { ...footstepAudio.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'fallback', error: footstepAudioFailure },
  mechanicalAudio: audioUnsupported ? { status: 'unavailable' } : mechanicalAudio
    ? { ...mechanicalAudio.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'fallback', error: mechanicalAudioFailure },
  simulationClock: simulationClock.snapshot,
  boundary: { area: { ...BATTLE_AREA }, airArea: { ...AIR_BATTLE_AREA }, rules: { ...BOUNDARY_RULES },
    ...controlledBoundary(), members: allies.map(actor => ({ id: actor.id, ...boundaryStates.get(actor.id) })) },
  outskirts: { buildings: world.outskirts.buildings.length, nearBuildings: world.outskirts.buildings.filter(house => house.near).length,
    ruinedBuildings: world.outskirts.buildings.filter(house => house.ruined).length, hills: world.outskirts.hills.map(hill => ({ ...hill })) },
  entityCounts: { units: entities.units.size, soldiers: entities.soldiers.size, weapons: entities.weapons.size, vehicles: entities.vehicles.size },
  vehicleViews: vehicleRenderer.snapshot,
  deathTransfer: { ...deathTransfer, mask: deathTransferMask(deathTransfer) },
  vehicles: [...entities.vehicles.values()].map(transport => ({ id: transport.id, type: transport.type, unitId: transport.unitId,
    team: transport.team, variant: transport.variant, name: transport.variant === CHI_HA.id ? CHI_HA.name : TYPES[transport.type].name,
    maxHealth: transport.maxHealth, trackDistance: transport.trackDistance, speed: transport.speed,
    ai: transport.ai ? { mode: transport.ai.mode, targetId: transport.ai.targetId, shots: transport.ai.shots,
      objectiveId: transport.ai.objectiveId, goal: transport.ai.goal ? { ...transport.ai.goal } : null,
      distanceToObjective: transport.ai.distanceToObjective, firePauseUntil: transport.ai.firePauseUntil,
      navigation: armorNavigate.stats(transport),
      path: transport.ai.path.map(point => ({ ...point })) } : null,
    health: transport.health, position: { x: transport.position.x, y: transport.position.y, z: transport.position.z },
    heading: transport.heading, pitch: transport.pitch, turretYaw: transport.turretYaw, turretPitch: transport.turretPitch,
    weapon: { ...transport.weapon }, machineGuns: transport.machineGuns?.map(gun => ({ ...gun })),
    seats: transport.seats.map(seat => ({ ...seat })) })),
  benchmark: benchmark ? { ...benchmark } : null,
  position: allies[current] ? { x: allies[current].position.x, y: allies[current].position.y, z: allies[current].position.z } : null,
  current, ammo: unit?.ammo, health: occupiedVehicle(entities, allies[current])?.health ?? allies[current]?.health,
  weaponVisible: Boolean(weapon?.visible && primaryViewAvailable()),
  vehicleObservationVisible: !$('tank-optics').hidden || Boolean(weapon?.visible && unit?.type === 'tank' && weapon.userData.observationSeat),
  tankObservation: unit?.type === 'tank' ? { role: occupiedSeat(entities)?.role, aperture: $('tank-optics').dataset.view,
    closed: !$('tank-optics').hidden, eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, fov: camera.fov } : null,
  spawnId: unit?.spawnId, pendingSquad, pendingSpawn,
  aiming: held.aiming, fov: camera.fov, stance: controlPose.stance, breath: allies[current]?.breathControl.remaining ?? 1,
  scope: { active: sniperScopeActive(), breath: allies[current] ? { ...allies[current].breathControl } : null },
  controlInput: playerInput.snapshot, controlEvents: controlEvents.snapshot,
  combatEvents: combatEvents.snapshot,
  combatFeedback: combatFeedback.snapshot(time),
  projectiles: shells.map(shell => ({ id: shell.id, source: { ...shell.source }, position: { ...shell.position },
    target: { ...shell.target }, elapsed: shell.elapsed, duration: shell.duration, firedAt: shell.firedAt })),
  projectileViews: shellViews.size,
  projectileSceneObjects: scene.children.filter(object => object.userData.projectileId).length,
  projectileImpacts: projectileImpacts.map(event => ({ ...event, source: { ...event.source }, position: { ...event.position } })),
  grenades: { rules: { ...GRENADE }, packRules: { ...EXPLOSIVE_PACK }, active: grenades.active.map(grenade => ({ ...grenade,
    source: { ...grenade.source }, originalSource: { ...grenade.originalSource },
    position: { ...grenade.position }, velocity: { ...grenade.velocity } })),
    history: grenades.history, renderer: grenadeRenderer.snapshot,
    equipped: grenadeEquipped,
    selected: selectedThrowable,
    inventory: controlledSoldier(entities) ? { ammo: controlledSoldier(entities).grenades.ammo, packs: controlledSoldier(entities).grenades.packs,
      phase: controlledSoldier(entities).grenades.action?.phase ?? null } : null },
  graphics: graphics.snapshot, combatStats: { ...combatStats },
  population: { rules: { ...BATTLE_RULES }, friendly: battleSummary('friendly'), enemy: battleSummary('enemy'),
    renderer: { ...soldierRenderer.snapshot,
      visible: soldierRenderer.snapshot.visible + (nraCharacter?.counts.near ?? 0) + (nraCharacter?.counts.far ?? 0) + (ijaCharacter?.counts.near ?? 0) + (ijaCharacter?.counts.far ?? 0),
      near: soldierRenderer.snapshot.near + (nraCharacter?.counts.near ?? 0) + (ijaCharacter?.counts.near ?? 0),
      far: soldierRenderer.snapshot.far + (nraCharacter?.counts.far ?? 0) + (ijaCharacter?.counts.far ?? 0),
      batches: soldierRenderer.snapshot.batches + (nraCharacter?.counts.batches ?? 0) + (ijaCharacter?.counts.batches ?? 0),
      procedural: soldierRenderer.snapshot, historical: nraCharacter?.counts ?? null, japanese: ijaCharacter?.counts ?? null }, queuedPaths: pathRequests.size,
    units: formations.map(formation => ({ id: formation.id, team: formation.team, type: formation.type, player: formation.player,
      respawnAt: formation.respawnAt, blockedReason: formation.blockedReason ?? null,
      memberCount: formation.members.length, alive: formation.members.filter(actor => actor.health > 0).length,
      generation: formation.generation, spawnId: formation.spawnId, objectiveId: formation.objectiveId ?? null,
      members: formation.members.map(actor => ({ id: actor.tactics.id, soldierId: actor.id, role: actor.role, weaponModel: actor.rifle.model ?? 'rifle', ammo: actor.rifle.ammo, shots: actor.rifle.shots,
        x: actor.position.x, z: actor.position.z, health: actor.health, spawnId: actor.spawnId, section: actor.section, spawnClear: actor.spawnClear, spawnPosition: { ...actor.spawnPosition } })) })) },
  performance: { samples: frameTimes.length, averageFrameMs: frameTimes.length ? frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length : 0,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
  combatEffects: combatEffects.snapshot,
  rifleTextures: rifleTextureSnapshot(),
  daylight: { sunIntensity: sun.intensity, fillIntensity: hemisphere.intensity, environmentIntensity: scene.environmentIntensity },
  look: { yaw: controlPose.yaw, pitch: controlPose.pitch },
  bridgeSurfaces: { ...world.bridgeSurfaces },
  river: { ...RIVER, surfaces: { ...world.riverSurfaces },
    depth: allies[current] ? world.waterDepth(allies[current].position.x, allies[current].position.z, allies[current].position.y) : 0 },
  staticDamage: { craters: world.staticDamage.craters.map(crater => ({ ...crater })),
    ruinedShops: [...world.staticDamage.ruinedShops], wrecks: world.staticDamage.wrecks.map(wreck => ({ ...wreck })) },
  doors: world.doorSystem.doors.map(({ id, x, z, angle, targetAngle, state, blocked }) => ({ id, x, z, angle, targetAngle, state, blocked })),
  town: { streetWidth: world.town.streetWidth, buildings: world.town.buildings.map(building => ({ ...building })), visibility: { ...world.visibility },
    navigation: navigate.stats, inside: allies[current] ? world.town.buildings.find(building => {
      const p = allies[current].position;
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
  allies: allies.map(actor => ({ id: actor.id, unitId: actor.unitId, vehicleId: actor.vehicleId, seatId: actor.seatId,
    weaponId: actor.rifle.id, health: actor.health, eyeHeight: soldierPostureHeight(actor),
    deathSource: actor.deathSource ? { ...actor.deathSource } : null,
    x: actor.position.x, y: actor.position.y, z: actor.position.z, stance: actor.stance, manualStance: actor.manualStance,
    lookPitch: actor.lookPitch, order: actor.order,
    orderPoint: actor.orderPoint ? { ...actor.orderPoint } : null, mode: actor.tactics.mode, coverId: actor.tactics.cover?.id || null, bodyScaleY: actor.model.scale.y,
    role: actor.role, targetKind: actor.targetKind, spawnId: actor.spawnId, stamina: actor.locomotion.stamina,
    grenades: { ammo: actor.grenades.ammo, packs: actor.grenades.packs, phase: actor.grenades.action?.phase ?? null }, rifle: { ...actor.rifle } })),
  construction: { tool: toolEquipped, builderId: construction.builderId, blueprint: construction.blueprint, mode: construction.mode,
    progress: construction.progress, blockedReason: construction.blockedReason, preview: construction.preview ? { ...construction.preview } : null,
    site: construction.site ? { x: construction.site.x, z: construction.site.z } : null },
  spawnPoints: spawnPoints.map(({ id, team, kind, name, x, z, health, builderId }) => ({ id, team, kind, name, x, z, health, builderId: builderId ?? null })),
  rallyViews: rallyRenderer.snapshot,
  spawnEvents: spawnEvents.map(event => ({ ...event })),
  enemies: enemies.filter(actor => actor.health > 0).length,
  friendlyPositions: friendlyForces.filter(actor => actor.health > 0 && actor !== controlledSoldier(entities)).map(actor => ({
    id: actor.tactics.id, soldierId: actor.id, squad: actor.tactics.squad, slot: actor.tactics.slot,
    formationId: actor.formation.id, pathGoal: actor.pathGoal ? { ...actor.pathGoal } : null, pathLength: actor.path?.length ?? 0,
    heading: actor.heading, rifleReady: actor.rifleReady, lowReady: actor.nativeMotion?.lowReady ?? null,
    bodyLean: actor.nativeMotion?.bodyLean ?? null,
    turningToPath: Boolean(actor.turningToPath), lastHit: actor.lastHit ? { ...actor.lastHit } : null,
    rifle: { ...actor.rifle }, aiRifle: { ...actor.aiRifle, lastShot: actor.aiRifle.lastShot ? { ...actor.aiRifle.lastShot } : null },
    stance: actor.stance, firingPose: ownedFiringPose(actor), aimWalking: Boolean(actor.aimWalking),
    postureReady: postureReady(actor), posture: actor.nativeMotion ? { ...actor.nativeMotion.posture } : null,
    completedShotMoves: actor.tactics.completedShotMoves ?? 0, shotMovePending: Boolean(actor.tactics.shotMovePending),
    wallContact: actor.tactics.wallContact ? { ...actor.tactics.wallContact } : null,
    x: actor.position.x, z: actor.position.z, health: actor.health, order: actor.order, mode: actor.tactics.mode,
    objectiveId: actor.tactics.objectiveId ?? null,
    cover: actor.tactics.cover ? { id: actor.tactics.cover.id, x: actor.tactics.cover.x, z: actor.tactics.cover.z,
      kind: actor.tactics.cover.kind, peek: { ...actor.tactics.cover.peek } } : null, enteredCover: actor.tactics.enteredCover,
    suppressedUntil: actor.tactics.suppressedUntil,
    observation: { sense: actor.tactics.threatSense, targetId: actor.tactics.threatId, time: actor.tactics.observedAt,
      forgetAt: actor.tactics.forgetAt, point: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null },
    engagementPoint: actor.tactics.engagementPoint ? { ...actor.tactics.engagementPoint } : null,
    sightCheck: actor.tactics.lastSightCheck ? { ...actor.tactics.lastSightCheck } : null,
    movement: { speed: actor.locomotion.speed, mode: actor.locomotion.mode, sprinting: actor.locomotion.sprinting, stamina: actor.locomotion.stamina,
      exhausted: actor.locomotion.exhausted, aimRecovery: actor.locomotion.aimRecovery },
    lastShot: actor.tactics.lastShot ? { ...actor.tactics.lastShot, position: { ...actor.tactics.lastShot.position } } : null,
    blockedBy: actor.tactics.blockedBy, bodyScaleY: actor.model.scale.y })),
  enemyPositions: enemies.filter(actor => actor.health > 0).map(actor => ({ x: actor.position.x, z: actor.position.z, health: actor.health,
    armorEscort: actor.tactics.armorEscort ? { ...actor.tactics.armorEscort } : null,
    formationId: actor.formation.id, objectiveId: actor.formation.objectiveId ?? null,
    pathGoal: actor.pathGoal ? { ...actor.pathGoal } : null, pathLength: actor.path?.length ?? 0,
    rifleReady: actor.rifleReady, lowReady: actor.nativeMotion?.lowReady ?? null,
    bodyLean: actor.nativeMotion?.bodyLean ?? null,
    turningToPath: Boolean(actor.turningToPath), lastHit: actor.lastHit ? { ...actor.lastHit } : null,
    soldierId: actor.id, speed: actor.locomotion.speed, aimRecovery: actor.locomotion.aimRecovery,
    postureReady: postureReady(actor), rifle: { ...actor.rifle },
    aiRifle: { ...actor.aiRifle, lastShot: actor.aiRifle.lastShot ? { ...actor.aiRifle.lastShot } : null },
    lastShot: actor.tactics.lastShot ? { ...actor.tactics.lastShot, position: { ...actor.tactics.lastShot.position } } : null,
    id: actor.tactics.id, squad: actor.tactics.squad, mode: actor.tactics.mode, coverId: actor.tactics.cover?.id || null, bodyScaleY: actor.model.scale.y,
    heading: actor.heading, selectedTargetId: actor.target?.id ?? null, nextSenseAt: actor.nextThink,
    sightCheck: actor.tactics.lastSightCheck ? { ...actor.tactics.lastSightCheck } : null,
    targetKind: actor.target?.targetKind || null, threatKind: actor.tactics.threatKind,
    observation: { sense: actor.tactics.threatSense, targetId: actor.tactics.threatId, time: actor.tactics.observedAt,
      forgetAt: actor.tactics.forgetAt, point: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null },
    engagementPoint: actor.tactics.engagementPoint ? { ...actor.tactics.engagementPoint } : null,
    lastSeen: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null, blockedBy: actor.tactics.blockedBy })),
  coverClaims: [...coverClaims].filter(([, claim]) => claim.until > time).map(([id, claim]) => ({ id, ...claim })),
  objectives: objectives.map(point => ({ ...point })),
  conquest: { ...conquest },
  drawCalls: renderer.info.render.calls,
}), configurable: false });

if (benchmark) Object.defineProperty(window, '__battleTelemetry', { get: () => telemetry.snapshot, configurable: false });

try {
  await nraCharacter?.prepare(renderer);
  await ijaCharacter?.prepare(renderer);
} catch (error) {
  $('loading').hidden = true; $('fatal').hidden = false;
  $('fatal-message').textContent = `人物渲染初始化失败：${error.message}。未静默回退。`;
  throw error;
}
$('loading').hidden = true;
$('menu').hidden = false;
requestAnimationFrame(tick);
