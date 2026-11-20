// 江阴要塞阻击战 · 页面入口：渲染器、指针锁定输入、HUD、战术简图与合成音效。
import * as THREE from 'three';
import './jiangyin.css';
import { createEmplacementModel } from '../emplacement-model.js';
import { createJiangyinGame } from './jiangyin-game.js';
import { JIANGYIN_RULES, JIANGYIN_LANDMARKS, riverCenter, groundHeight, RIVER_HALF } from './jiangyin-rules.js';
import { createJiangyinGunModel, setCrewFactory } from './jiangyin-models.js';
// —— 复用项目现有模块：士兵与枪械、坦克/飞机渲染（含残骸与燃烧）、爆炸/烟尘/枪口焰 ——
import { soldierModel, weaponModel, setModelSurfaces } from '../world.js';
// 第一人称步枪/轻机枪（含双手与拉栓、换弹动作）与手榴弹：复用项目 rifle-model.js / grenade-model.js
import { updateRifleModel, updateRifleArms, configureRifleMaterials } from '../rifle-model.js';
import { grenadeModel } from '../grenade-model.js';
import { RIFLE } from '../rifle-action.js';
import { createVehicleRenderer } from '../vehicle-renderer.js';
import { createCombatEffects } from '../combat-effects.js';
import { loadJiangyinCharacters, createAnchor } from './jiangyin-soldiers.js';
import { loadSceneMaterials } from '../materials.js';
import { setSceneSurfaces } from './jiangyin-surfaces.js';
import { mountJiangyinPage } from './jiangyin-page.js';
import { getMenuMusic } from '../menu-music.js';

mountJiangyinPage();
// 大厅背景音乐：加载期间继续，进入战斗淡出，暂停时按主游戏规则处理
const menuMusic = (() => { try { return getMenuMusic(); } catch { return { setState() {} }; } })();
menuMusic.setState('loading');

const $ = id => document.getElementById(id);
const canvas = $('jy-world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .3, 12000);   // 江面宽 1.5 公里，远景需要看到对岸与下游弯道
camera.rotation.order = 'YXZ';
scene.add(camera);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ---------- 合成音效（无外部资源；正式版可替换为项目现有录音） ----------
let audio = null;
function sound(name, position) {
  if (!audio) return;
  const distance = position ? camera.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z)) : 0;
  const gain = Math.max(.03, Math.min(1, 40 / (distance + 20)));
  const spec = { gun: [.5, 900, .9], 'enemy-gun': [.45, 700, .7], boom: [.9, 420, .8], splash: [.6, 1400, .4], mg: [.07, 2600, .25],
    rifle: [.18, 2200, .5], lmg: [.08, 2400, .35], 'enemy-rifle': [.16, 1900, .3], throw: [.12, 900, .15] }[name];
  if (!spec) return;
  const [length, cutoff, volume] = spec, rate = audio.sampleRate, buffer = audio.createBuffer(1, rate * length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2.5;
  const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), amp = audio.createGain();
  source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = cutoff; amp.gain.value = volume * gain;
  source.connect(filter).connect(amp).connect(audio.destination); source.start();
}

// ---------- 游戏 ----------
let toastTimer = 0, hitTimer = 0, hurtTimer = 0;
function toast(text, alert = false) {
  const element = $('jy-toast'); element.textContent = text; element.className = `show${alert ? ' alert' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.className = ''; }, 2600);
}
// 场景材质：与主游戏相同，载入项目的 PBR 贴图（public/assets/materials）与 sky.hdr（天空背景 + 环境反射）。
// 地址加 ?surfaces=procedural 时跳过（低配/排查用），改用程序化噪声贴图与程序天穹。
if (new URLSearchParams(location.search).get('surfaces') !== 'procedural') {
  try {
    const surface = await loadSceneMaterials(renderer, scene, {});
    setSceneSurfaces(surface);
    scene.backgroundIntensity = .8; scene.environmentIntensity = .75;
    // 与主游戏相同：枪械木材/钢材贴图必须在人物加载前配置，否则士兵手中的枪是白色的默认材质
    await setModelSurfaces(surface, renderer.capabilities.getMaxAnisotropy()).catch(error => console.warn('weapon surfaces', error));
  } catch (error) {
    console.error(error);
    $('jy-kicker').textContent = '场景材质加载失败';
    $('jy-text').textContent = `无法加载项目贴图：${error.message}。可检查 public/assets/materials 与 sky.hdr，或使用 ?surfaces=procedural 进入。`;
    throw error;
  }
}
else await configureRifleMaterials(renderer.capabilities.getMaxAnisotropy()).catch(error => console.warn('rifle materials', error));
// 人物：默认与主游戏相同，使用项目的带骨骼原生人物（国军 nra-88 / 日军 ija-1938）；
// 地址加 ?character=procedural 时与主游戏一样退回 world.js 的程序化士兵（仅用于低配或排查）。
const proceduralCharacters = new URLSearchParams(location.search).get('character') === 'procedural';
let characters = null, characterErrorShown = false, stepErrorShown = false;
if (!proceduralCharacters) {
  const button = $('jy-start'), label = button.textContent;
  button.disabled = true;
  try {
    characters = await loadJiangyinCharacters({ scene, camera, renderer, walkHeight: (x, z) => groundHeight(x, z),
      onProgress: text => { button.textContent = text; } });
    button.textContent = label; button.disabled = false;
  } catch (error) {
    // 必要资源缺失须明确提示，不伪装成可正常继续
    console.error(error);
    $('jy-kicker').textContent = '人物资源加载失败';
    $('jy-text').textContent = `无法加载项目人物模型：${error.message}。可检查 public/assets/game/ 下的人物资源，或使用 ?character=procedural 以程序化士兵进入。`;
    button.textContent = '以程序化士兵进入 ↗'; button.disabled = false;
    button.onclick = () => { const url = new URL(location.href); url.searchParams.set('character', 'procedural'); location.assign(url); };
    throw error;
  }
}
// 炮位乘员：国军人物；敌步兵：日军人物（三八式步枪+刺刀 / 十一年式轻机枪）
setCrewFactory(characters ? () => characters.trackCrew(createAnchor('friendly', 'rifle', 'crew'))
  : () => soldierModel(true, 'near', 'unarmed'));
const vehicleRenderer = createVehicleRenderer(scene);
let clockTime = 0;
const combatEffects = createCombatEffects(scene, camera, (x, z) => Math.max(0, groundHeight(x, z)),
  (x, z) => groundHeight(x, z) >= 0);
combatEffects.configure({ preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } });
// 表现层出错不应打断战斗模拟：记录一次警告后跳过该特效
const safely = (name, run) => { try { run(); } catch (error) { if (!safely[name]) console.warn(`combat effect skipped: ${name}`, error); safely[name] = true; } };
const effects = {
  explosion: (p, radius, style, surface) => safely('explosion', () =>
    combatEffects.explosion(new THREE.Vector3(p.x, p.y, p.z), clockTime, Math.max(.5, radius), style, surface)),
  muzzle: (p, d) => safely('muzzle', () =>
    combatEffects.muzzle(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(d.x, d.y, d.z).normalize(), clockTime)),
};
const soldierFor = (team, weapon) => {
  if (characters) return createAnchor(team, weapon);
  try { return soldierModel(team === 'friendly', 'near', weapon); }
  catch (error) { console.warn('soldier model fallback', error); return soldierModel(team === 'friendly', 'near', 'unarmed'); }
};
const game = createJiangyinGame({ scene, camera, createGunModel: point => createJiangyinGunModel(point, createEmplacementModel),
  createSoldierModel: soldierFor, effects, quality: new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'high', onEvent(event) {
  if (event.type === 'toast') toast(event.text, event.alert);
  else if (event.type === 'sound') sound(event.name, event.position);
  else if (event.type === 'hit') { $('jy-crosshair').classList.add('hit'); clearTimeout(hitTimer);
    hitTimer = setTimeout(() => $('jy-crosshair').classList.remove('hit'), 160); }
  else if (event.type === 'transfer' && event.reason !== 'start')
    toast(event.reason === 'destroyed' ? `阵位失守 · 转移接管：${event.name}` : `接管：${event.name}`, event.reason === 'destroyed');
  else if (event.type === 'phase') { $('jy-caption').hidden = true; $('jy-hud').hidden = false;
    $('jy-crosshair').hidden = event.phase === 'scuttle'; $('jy-posts').hidden = event.phase === 'scuttle';
    document.querySelector('.jy-weapon').hidden = event.phase === 'scuttle'; $('jy-range').hidden = event.phase === 'scuttle'; }
  else if (event.type === 'deploy') { for (const id of ['jy-crosshair', 'jy-posts', 'jy-range']) $(id).hidden = false;
    document.querySelector('.jy-weapon').hidden = false; $('jy-hud').hidden = false; }
  else if (event.type === 'hurt') { $('jy-hurt').classList.add('show'); clearTimeout(hurtTimer); hurtTimer = setTimeout(() => $('jy-hurt').classList.remove('show'), 120); }
  else if (event.type === 'ended') showEnd(event.outcome, event.stats);
} });

// ---------- 输入 ----------
const input = { lookDX: 0, lookDY: 0, fireHeld: false, firePressed: false, aiming: false, skipIntro: false, switchPost: null, toggleView: false,
  move: { x: 0, z: 0 }, sprint: false, interact: false, cycleMember: false, reload: false, equip: null, crouch: false, sensitivity: 1 };
const keys = new Set();
let running = false, paused = false;
document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== canvas) return;
  input.lookDX += event.movementX; input.lookDY += event.movementY;
});
canvas.addEventListener('mousedown', event => {
  if (!running) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (event.button === 0) { input.fireHeld = true; input.firePressed = true; }
  if (event.button === 2) input.aiming = true;                   // 右键：放大瞄准（火炮/机枪/步枪）
  if (event.button === 0 && ['intro', 'scuttle'].includes(game.state.phase) && !game.deployed) input.skipIntro = true;
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
addEventListener('mouseup', event => { if (event.button === 0) input.fireHeld = false; if (event.button === 2) input.aiming = false; });
addEventListener('keydown', event => {
  if (!running || event.repeat) return;
  keys.add(event.code);
  if (['Space', 'Enter'].includes(event.code) && ['intro', 'scuttle'].includes(game.state.phase) && !game.deployed) input.skipIntro = true;
  if (event.code === 'KeyM') $('jy-radar').classList.toggle('large');
  if (event.code === 'KeyV') input.toggleView = true;
  if (event.code === 'Tab') event.preventDefault();
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  if (game.state.phase === 'naval') {                          // 第一阶段：Q/E 或 1–3 换舰
    if (event.code === 'KeyE') input.switchPost = 1;
    if (event.code === 'KeyQ') input.switchPost = -1;
    if (digit) input.switchPost = game.hud().posts.find(post => post.key === digit)?.id ?? null;
    return;
  }
  // 第二阶段：与其他地图一致 —— F 进出炮位、Y 切换队员、R 换弹、1 主武器、5/G 手榴弹、Ctrl/C 蹲下
  if (event.code === 'KeyF') input.interact = true;
  if (event.code === 'KeyY') input.cycleMember = true;
  if (event.code === 'KeyR') input.reload = true;
  if (['ControlLeft', 'KeyC'].includes(event.code)) input.crouch = true;
  if (event.code === 'KeyG' || digit === '5') input.equip = 'grenade';
  else if (digit === '1') input.equip = 'primary';
  else if (digit) input.equip = 'other';
});
addEventListener('keyup', event => keys.delete(event.code));
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas || !running || game.state.phase === 'ended') return;
  paused = true; input.fireHeld = false; menuMusic.setState('pause');
  $('jy-kicker').textContent = '作战暂停 / PAUSED'; $('jy-title').textContent = '战场仍在等待你。';
  $('jy-text').textContent = '点击继续，重新锁定鼠标。'; $('jy-start').textContent = '继续作战 ↗'; $('jy-overlay').hidden = false;
});
$('jy-start').addEventListener('click', () => {
  if (game.state.phase === 'ended') { location.reload(); return; }
  audio ??= new AudioContext(); void audio.resume();
  running = true; paused = false; $('jy-overlay').hidden = true; menuMusic.setState('playing');
  if (game.state.phase === 'intro') $('jy-caption').hidden = false;
  canvas.requestPointerLock();
});

function showEnd(outcome, stats) {
  running = false; document.exitPointerLock?.();
  const victory = outcome.result === 'victory';
  $('jy-kicker').textContent = victory ? '阻击成功 / HELD' : '要塞失守 / IN MEMORIAM';
  $('jy-title').textContent = victory ? (outcome.reason === 'repelled' ? '敌军攻势已被击退。' : '江阴封锁线坚守至最后一刻。')
    : '两岸阵地全部被日军摧毁。';
  $('jy-text').textContent = '历史上，江阴江面的海空作战自1937年8月持续至12月初；中国海军主力舰艇在此全部损失，12月初江阴要塞失守。';
  $('jy-stats').innerHTML = `击沉敌舰 ${stats.shipsSunk} · 击毁登陆艇 ${stats.landingSunk} · 歼灭日军步兵 ${stats.infantryKilled} · 击毁战车 ${stats.tanksDestroyed} · 击落飞机 ${stats.planesDowned}<br>玩家开火 ${stats.shots} · 我军步兵伤亡 ${stats.squadLost ?? 0}`;
  $('jy-start').textContent = '再战一次 ↗'; $('jy-overlay').hidden = false; $('jy-hud').hidden = true;
}

// ---------- HUD ----------
const radar = $('jy-radar'), radarContext = radar.getContext('2d');
let hudClock = 0;
function renderHud() {
  const hud = lastHud = game.hud();
  if (hud.phase === 'intro') { $('jy-caption').textContent = hud.caption; return; }
  hud.top.forEach((field, index) => {
    $(`jy-top-${index}-label`).textContent = field.label; $(`jy-top-${index}`).textContent = field.value;
    $(`jy-top-${index}`).classList.toggle('alert', Boolean(field.alert));
  });
  $('jy-posts').replaceChildren(...hud.posts.map(post => {
    const item = document.createElement('li');
    item.className = post.health <= 0 ? 'down' : post.controlled ? 'current' : post.eligible ? '' : 'locked';
    item.innerHTML = `<kbd${post.key ? '' : ' class="none"'}>${post.key || '·'}</kbd><span>${post.name}</span><div class="hp"><div style="width:${100 * post.health / post.maxHealth}%"></div></div>`;
    return item;
  }));
  $('jy-interact').textContent = hud.interact ?? '';
  if (hud.infantry) {
    const w = hud.infantry;
    $('jy-weapon-name').textContent = `${hud.squad.member} · ${w.name}`;
    $('jy-ammo').textContent = w.weapon === 'grenade' ? `× ${w.ammo}` : `${w.ammo} / ${w.reserve}`;
    $('jy-reload').style.width = `${w.reload !== null ? w.reload * 100 : 100}%`;
    $('jy-help').textContent = `WASD 移动 · Shift 奔跑 · Ctrl/C 蹲下 · 左键开火 · 右键瞄准 · R 换弹 · 1 主武器 · 5/G 手榴弹（剩 ${w.grenades}）· F 进出炮位 · Y 切换队员 · M 地图`;
  } else if (hud.weapon) {
    $('jy-weapon-name').textContent = hud.weapon.name;
    $('jy-ammo').textContent = hud.weapon.cannon ? `${hud.weapon.ammo} / ${hud.weapon.reserve}` : `${hud.weapon.ammo} / ${hud.weapon.reserve}`;
    const cooldown = hud.weapon.cooldown;
    $('jy-reload').style.width = `${cooldown ? cooldown.progress * 100 : 100}%`;
    $('jy-help').textContent = hud.weapon.ship ? `舰艇由 AI 航行（${hud.weapon.speed.toFixed(1)} m/s）· 鼠标操纵艏主炮塔 · 左键开火 · 右键放大 · V 视角 · Q/E 或 1–3 换舰 · M 地图`
      : cooldown?.mode === 'cooling' ? '枪管过热冷却中…' : '鼠标瞄准 · 左键开火 · 右键放大 · V 第一/第三人称 · F 离开炮位 · M 地图';
  }
  $('jy-range').textContent = hud.range ? `${Math.round(hud.range)} m` : '';
  drawRadar();
}
// 与主游戏 minimap-view.js 的 drawFacingSector 同样式（90° 扇形，浅金色），本地实现以免依赖其内部接口
function drawFacingSector(ctx, x, z, heading, radius = 48) {
  const direction = -Math.PI / 2 - heading, half = Math.PI / 4;
  ctx.save(); ctx.beginPath(); ctx.moveTo(x, z); ctx.arc(x, z, radius, direction - half, direction + half); ctx.closePath();
  ctx.fillStyle = '#f6e0a970'; ctx.fill(); ctx.strokeStyle = '#f6e0a9bd'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}
function drawRadar() {
  // 与其他战役的小地图保持一致：逻辑尺寸 176、北向上、深绿底色细网格、扇形表示当前朝向
  const data = game.radar(), size = 176, area = JIANGYIN_RULES.playArea, c = radarContext;
  const ratio = radar.width / size;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  const span = Math.max(area.maxX - area.minX, area.maxZ - area.minZ), scale = size / span;
  const ox = (size - (area.maxX - area.minX) * scale) / 2, oz = (size - (area.maxZ - area.minZ) * scale) / 2;
  const sx = x => ox + (x - area.minX) * scale, sz = z => oz + (z - area.minZ) * scale;
  c.fillStyle = '#273328'; c.fillRect(0, 0, size, size);
  c.fillStyle = '#3f788b';
  for (let px = 0; px < size; px += 1) { const x = area.minX + (px - ox) / scale, cz = riverCenter(x); c.fillRect(px, sz(cz - RIVER_HALF), 1.2, (2 * RIVER_HALF) * scale); }
  c.strokeStyle = '#a8b09316'; c.lineWidth = 1; c.beginPath();
  for (let v = 0; v <= size; v += 22) { c.moveTo(v, 0); c.lineTo(v, size); c.moveTo(0, v); c.lineTo(size, v); }
  c.stroke();
  c.fillStyle = '#5a4535';
  for (const zone of data.barrier) c.fillRect(sx(zone.minX), sz(zone.minZ), Math.max(1, (zone.maxX - zone.minX) * scale), Math.max(1, (zone.maxZ - zone.minZ) * scale));
  const dot = (x, z, r, color) => { c.fillStyle = color; c.beginPath(); c.arc(sx(x), sz(z), r, 0, Math.PI * 2); c.fill(); };
  const hull = (x, z, heading, length, color) => { c.save(); c.translate(sx(x), sz(z)); c.rotate(-heading); c.fillStyle = color;
    const l = Math.max(3, length * scale), b = Math.max(1.4, l * .18); c.fillRect(-b / 2, -l / 2, b, l); c.restore(); };
  if (data.player) drawFacingSector(c, sx(data.player.x), sz(data.player.z), data.player.heading, 34);
  for (const p of data.posts) if (!p.controlled) dot(p.x, p.z, 2.8, p.alive ? '#9fb27f' : '#555');
  for (const m of data.squad ?? []) if (!m.controlled) dot(m.x, m.z, 1.5, '#8fc3ea');
  for (const s of data.ourShips) if (!s.controlled) hull(s.x, s.z, s.heading, 100, s.alive ? '#7fb0d8' : '#555');
  for (const b of data.blockships) if (!b.sunk) hull(b.x, b.z, b.heading, b.length, '#8d8a7e');
  const seen = item => item.x < JIANGYIN_RULES.radarRevealX;   // 下游弯道后的出生区不显示
  for (const s of data.ships) if (seen(s)) dot(s.x, s.z, s.big ? 3.4 : 2.8, '#e05a48');
  for (const l of data.landings) if (seen(l)) dot(l.x, l.z, 1.8, '#e8a050');
  for (const t of data.troops) if (seen(t)) dot(t.x, t.z, 1.2, '#ffcf7a');
  for (const t of data.tanks ?? []) if (seen(t)) { c.fillStyle = '#e05a48'; c.fillRect(sx(t.x) - 2, sz(t.z) - 2, 4, 4); }
  for (const p of data.planes ?? []) if (seen(p)) { c.fillStyle = '#f4f0e6'; c.beginPath();
    const a = -p.heading - Math.PI / 2, x = sx(p.x), y = sz(p.z);
    c.moveTo(x + Math.cos(a) * 4.5, y + Math.sin(a) * 4.5); c.lineTo(x + Math.cos(a + 2.5) * 3, y + Math.sin(a + 2.5) * 3);
    c.lineTo(x + Math.cos(a - 2.5) * 3, y + Math.sin(a - 2.5) * 3); c.fill(); }
  if (data.player) { c.fillStyle = '#f6e0a9'; c.strokeStyle = '#151a16'; c.lineWidth = 1.2; c.beginPath(); c.arc(sx(data.player.x), sz(data.player.z), 3, 0, Math.PI * 2); c.fill(); c.stroke(); }
  if (radar.classList.contains('large')) {   // 展开时才标注地名，平时保持简洁
    c.fillStyle = 'rgba(235,228,205,.8)'; c.font = '6px serif'; c.textAlign = 'center';
    const placed = [];
    for (const mark of JIANGYIN_LANDMARKS) {
      const x = sx(mark.x), half = c.measureText(mark.name).width / 2 + 1, base = Math.min(size - 2, Math.max(8, sz(mark.z)));
      const y = [base, base + 7, base - 7].find(y => y <= size - 2 && y >= 7 && !placed.some(b => Math.abs(b.x - x) < b.half + half && Math.abs(b.y - y) < 7));
      if (y === undefined) continue;
      placed.push({ x, y, half }); c.fillText(mark.name, x, y);
    }
    c.textAlign = 'start';
  }
}

// ---------- 第一人称武器（单独一层渲染，近裁剪面很小，不受远景深度精度影响） ----------
const BASE_FOV = camera.fov;
let lastHud = null;
const viewScene = new THREE.Scene(), viewCamera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, .01, 10);
viewScene.add(new THREE.HemisphereLight(0xd8dde2, 0x5c5446, 1.1));
const viewSun = new THREE.DirectionalLight(0xfff1dc, 2.2); viewSun.position.set(-.6, 1, .5); viewScene.add(viewSun);
let viewWeapon = null, viewKey = '';
function updateViewWeapon(dt) {
  const member = game.member, hud = lastHud;
  const show = running && game.mode === 'infantry' && member && member.dead === null && game.state.phase !== 'ended';
  const key = show ? `${member.id}:${member.weapon}:${member.rifle.model ?? 'rifle'}` : '';
  if (key !== viewKey) {
    if (viewWeapon) viewScene.remove(viewWeapon);
    viewWeapon = null; viewKey = key;
    if (show) {
      try {
        viewWeapon = member.weapon === 'grenade' ? grenadeModel('near') : weaponModel('infantry', member.rifle);
        if (member.weapon === 'grenade') { viewWeapon.position.set(.2, -.24, -.42); viewWeapon.rotation.set(.3, .4, -.2); }
        else viewWeapon.position.set(.18, -.22, -.14);
        viewScene.add(viewWeapon);
      } catch (error) { console.warn('first-person weapon', error); viewWeapon = null; }
    }
  }
  if (!viewWeapon) return;
  if (member.weapon === 'primary') {
    const pose = updateRifleModel(viewWeapon, member.rifle);
    const aim = input.aiming && member.rifle.action !== 'reload', k = 1 - Math.exp(-dt * 15);
    const bob = member.speed > .5 ? Math.sin(performance.now() / 1000 * 9) * .012 : 0;
    const target = aim ? new THREE.Vector3(0, -RIFLE.sightHeight, -.2) : new THREE.Vector3(.18, -.22 + bob - (pose?.lower ?? 0) * .045, -.14);
    viewWeapon.position.lerp(target, k);
    viewWeapon.rotation.set(-(pose?.lower ?? 0) * .14 + (pose?.recoil ?? 0) * .05, 0, 0);
    updateRifleArms(viewWeapon);
  }
  viewCamera.fov = camera.fov; viewCamera.aspect = camera.aspect; viewCamera.updateProjectionMatrix();
  viewScene.environment = scene.environment;
  renderer.autoClear = false; renderer.clearDepth(); renderer.render(viewScene, viewCamera); renderer.autoClear = true;
}

// ---------- 主循环 ----------
let last = performance.now();
renderer.setAnimationLoop(time => {
  const dt = Math.max(0, Math.min(.05, (time - last) / 1000)); last = time;   // 首帧时间戳可能早于 performance.now()
  if (running && !paused) {
    input.move = { x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), z: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) };
    input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    input.sensitivity = camera.fov / BASE_FOV;                  // 放大时降低鼠标灵敏度
    try { game.step(dt, input); }
    catch (error) { console.error('[江阴] 战局更新', error); if (!stepErrorShown) { stepErrorShown = true; toast(`战局更新出错：${error.message}`, true); } }
    input.lookDX = input.lookDY = 0; input.firePressed = false; input.skipIntro = false; input.switchPost = null; input.toggleView = false;
    input.interact = input.cycleMember = input.reload = input.crouch = false; input.equip = null;
    hudClock += dt;
    if (hudClock > .1) { hudClock = 0; renderHud(); }
  } else if (game.state.phase !== 'ended') game.step(0, {});
  clockTime += dt;   // 表现层时钟单调递增（combat-effects 要求粒子时钟单调）
  vehicleRenderer.update(game.vehicles, clockTime);
  // 人物渲染出错时只跳过人物，不让整个画面卡死；第一次出错时在屏幕上提示错误内容，便于反馈
  try { characters?.sync([...game.troops, ...game.squad], clockTime, running && !paused ? dt : 0); }
  catch (error) { characters.errors?.push(String(error?.message ?? error)); console.error('[江阴] 人物同步', error); }
  if (characters?.errors?.length && !characterErrorShown) { characterErrorShown = true; toast(`人物显示出错（已跳过，战斗继续）：${characters.errors[0]}`, true); }
  safely('effects-update', () => combatEffects.update(dt, clockTime, game.vehicles));
  // 右键放大：火炮约 4 倍、机枪 2 倍、步枪机瞄
  const zoom = running && !paused && input.aiming && lastHud && game.state.phase !== 'ended' ? lastHud.zoom ?? 1 : 1;
  const fov = BASE_FOV / zoom;
  if (Math.abs(camera.fov - fov) > .01) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
  $('jy-crosshair').classList.toggle('scoped', zoom > 1.5);
  renderer.render(scene, camera);
  updateViewWeapon(dt);
});
