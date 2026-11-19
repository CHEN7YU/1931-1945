// 江阴要塞阻击战 · 页面入口：渲染器、指针锁定输入、HUD、战术简图与合成音效。
import * as THREE from 'three';
import './jiangyin.css';
import { createEmplacementModel } from '../emplacement-model.js';
import { createJiangyinGame } from './jiangyin-game.js';
import { JIANGYIN_RULES, JIANGYIN_LANDMARKS, riverCenter, groundHeight, RIVER_HALF } from './jiangyin-rules.js';
import { createJiangyinGunModel, setCrewFactory } from './jiangyin-models.js';
// —— 复用项目现有模块：士兵与枪械、坦克/飞机渲染（含残骸与燃烧）、爆炸/烟尘/枪口焰 ——
import { soldierModel } from '../world.js';
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
const startButton = $('jy-start');
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
  const spec = { gun: [.5, 900, .9], 'enemy-gun': [.45, 700, .7], boom: [.9, 420, .8], splash: [.6, 1400, .4], mg: [.07, 2600, .25] }[name];
  if (!spec) return;
  const [length, cutoff, volume] = spec, rate = audio.sampleRate, buffer = audio.createBuffer(1, rate * length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2.5;
  const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), amp = audio.createGain();
  source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = cutoff; amp.gain.value = volume * gain;
  source.connect(filter).connect(amp).connect(audio.destination); source.start();
}

// ---------- 游戏 ----------
let toastTimer = 0, hitTimer = 0;
function toast(text, alert = false) {
  const element = $('jy-toast'); element.textContent = text; element.className = `show${alert ? ' alert' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.className = ''; }, 2600);
}
// 场景材质：与主游戏相同，载入项目的 PBR 贴图（public/assets/materials）与 sky.hdr（天空背景 + 环境反射）。
// 地址加 ?surfaces=procedural 时跳过（低配/排查用），改用程序化噪声贴图与程序天穹。
if (new URLSearchParams(location.search).get('surfaces') !== 'procedural') {
  try {
    setSceneSurfaces(await loadSceneMaterials(renderer, scene, {}));
    scene.backgroundIntensity = .8; scene.environmentIntensity = .75;
  } catch (error) {
    console.error(error);
    $('jy-kicker').textContent = '场景材质加载失败';
    $('jy-text').textContent = `无法加载项目贴图：${error.message}。可检查 public/assets/materials 与 sky.hdr，或使用 ?surfaces=procedural 进入。`;
    throw error;
  }
}
// 人物：默认与主游戏相同，使用项目的带骨骼原生人物（国军 nra-88 / 日军 ija-1938）；
// 地址加 ?character=procedural 时与主游戏一样退回 world.js 的程序化士兵（仅用于低配或排查）。
const proceduralCharacters = new URLSearchParams(location.search).get('character') === 'procedural';
let characters = null;
if (!proceduralCharacters) {
  try {
    characters = await loadJiangyinCharacters({ scene, camera, renderer, walkHeight: (x, z) => groundHeight(x, z),
      onProgress: text => { startButton.textContent = text; } });
  } catch (error) {
    // 必要资源缺失须明确提示，不伪装成可正常继续
    console.error(error);
    $('jy-kicker').textContent = '人物资源加载失败';
    $('jy-text').textContent = `无法加载项目人物模型：${error.message}。可检查 public/assets/game/ 下的人物资源，或使用 ?character=procedural 以程序化士兵进入。`;
    startButton.textContent = '以程序化士兵进入 ↗'; startButton.disabled = false;
    startButton.onclick = () => { const url = new URL(location.href); url.searchParams.set('character', 'procedural'); location.assign(url); };
    throw error;
  }
}
// 炮位乘员：国军人物；敌步兵：日军人物（三八式步枪+刺刀 / 十一年式轻机枪）
setCrewFactory(characters ? () => characters.trackCrew(createAnchor('friendly', 'rifle', 'crew'))
  : () => soldierModel(true, 'near', 'unarmed'));
const vehicleRenderer = createVehicleRenderer(scene);
let clockTime = 0;
const combatEffects = createCombatEffects(scene, camera, (x, z) => Math.max(0, groundHeight(x, z)));
combatEffects.configure({ preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } });
// 表现层出错不应打断战斗模拟：记录一次警告后跳过该特效
const safely = (name, run) => { try { run(); } catch (error) { if (!safely[name]) console.warn(`combat effect skipped: ${name}`, error); safely[name] = true; } };
const effects = {
  explosion: (p, radius, style) => safely('explosion', () =>
    combatEffects.explosion(new THREE.Vector3(p.x, p.y, p.z), clockTime, Math.max(.5, radius), style)),
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
  else if (event.type === 'ended') showEnd(event.outcome, event.stats);
} });

// ---------- 输入 ----------
const input = { lookDX: 0, lookDY: 0, fireHeld: false, firePressed: false, throttle: 0, rudder: 0, skipIntro: false, switchPost: null, toggleView: false };
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
  if (['intro', 'scuttle'].includes(game.state.phase)) input.skipIntro = true;
});
addEventListener('mouseup', event => { if (event.button === 0) input.fireHeld = false; });
addEventListener('keydown', event => {
  if (!running || event.repeat) return;
  keys.add(event.code);
  if (['Space', 'Enter'].includes(event.code) && ['intro', 'scuttle'].includes(game.state.phase)) input.skipIntro = true;
  if (event.code === 'KeyE') input.switchPost = 1;
  if (event.code === 'KeyQ') input.switchPost = -1;
  if (event.code === 'KeyM') $('jy-radar').classList.toggle('large');
  if (event.code === 'KeyV') input.toggleView = true;
  const digit = /^Digit([1-8])$/.exec(event.code)?.[1];
  if (digit) input.switchPost = game.hud().posts.find(post => post.key === digit)?.id ?? null;
  if (event.code === 'Tab') event.preventDefault();
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
    : outcome.reason === 'breakthrough' ? '敌舰突破堵塞线，逆流驶向南京。' : '两岸炮台全部失守。';
  $('jy-text').textContent = '历史上，江阴江面的海空作战自1937年8月持续至12月初；中国海军主力舰艇在此全部损失，12月初江阴要塞失守。';
  $('jy-stats').innerHTML = `击沉敌舰 ${stats.shipsSunk} · 击毁登陆艇 ${stats.landingSunk} · 歼灭日军步兵 ${stats.infantryKilled} · 击毁战车 ${stats.tanksDestroyed} · 击落飞机 ${stats.planesDowned}<br>玩家开火 ${stats.shots} · 阵位转移 ${stats.transfers}`;
  $('jy-start').textContent = '再战一次 ↗'; $('jy-overlay').hidden = false; $('jy-hud').hidden = true;
}

// ---------- HUD ----------
const radar = $('jy-radar'), radarContext = radar.getContext('2d');
let hudClock = 0;
function renderHud() {
  const hud = game.hud();
  if (hud.phase === 'intro') { $('jy-caption').textContent = hud.caption; return; }
  hud.top.forEach((field, index) => {
    $(`jy-top-${index}-label`).textContent = field.label; $(`jy-top-${index}`).textContent = field.value;
    $(`jy-top-${index}`).classList.toggle('alert', Boolean(field.alert));
  });
  $('jy-posts').replaceChildren(...hud.posts.map(post => {
    const item = document.createElement('li');
    item.className = post.health <= 0 ? 'down' : post.controlled ? 'current' : post.eligible ? '' : 'locked';
    item.innerHTML = `<kbd>${post.key}</kbd><span>${post.name}</span><div class="hp"><div style="width:${100 * post.health / post.maxHealth}%"></div></div>`;
    return item;
  }));
  if (hud.weapon) {
    $('jy-weapon-name').textContent = hud.weapon.name;
    $('jy-ammo').textContent = hud.weapon.cannon ? `${hud.weapon.ammo} / ${hud.weapon.reserve}` : `${hud.weapon.ammo} / ${hud.weapon.reserve}`;
    const cooldown = hud.weapon.cooldown;
    $('jy-reload').style.width = `${cooldown ? cooldown.progress * 100 : 100}%`;
    $('jy-help').textContent = hud.weapon.ship ? `舰艇由 AI 航行（${hud.weapon.speed.toFixed(1)} m/s）· 鼠标操纵艏主炮塔 · 左键开火 · V 视角 · Q/E 或 1–3 换舰 · M 地图`
      : cooldown?.mode === 'cooling' ? '枪管过热冷却中…' : '鼠标瞄准 · 左键开火 · V 第一/第三人称 · Q/E 或 4–8 切换阵位 · M 地图';
  }
  $('jy-range').textContent = hud.range ? `${Math.round(hud.range)} m` : '';
  drawRadar();
}
function drawRadar() {
  const data = game.radar(), w = radar.width, h = radar.height, area = JIANGYIN_RULES.playArea;
  const sx = x => (x - area.minX) / (area.maxX - area.minX) * w, sz = z => (z - area.minZ) / (area.maxZ - area.minZ) * h;
  const c = radarContext;
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#4c5a55';
  for (let px = 0; px < w; px += 2) { const x = area.minX + px / w * (area.maxX - area.minX), cz = riverCenter(x); c.fillRect(px, sz(cz - RIVER_HALF), 2, sz(cz + RIVER_HALF) - sz(cz - RIVER_HALF)); }
  c.fillStyle = '#5a4535';
  for (const zone of data.barrier) c.fillRect(sx(zone.minX), sz(zone.minZ), sx(zone.maxX) - sx(zone.minX), sz(zone.maxZ) - sz(zone.minZ));
  c.strokeStyle = '#d4826b'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(sx(JIANGYIN_RULES.breakthroughX), 0); c.lineTo(sx(JIANGYIN_RULES.breakthroughX), h); c.stroke(); c.setLineDash([]);
  const dot = (x, z, r, color) => { c.fillStyle = color; c.beginPath(); c.arc(sx(x), sz(z), r, 0, Math.PI * 2); c.fill(); };
  for (const p of data.posts) dot(p.x, p.z, p.controlled ? 5 : 3.5, p.alive ? (p.controlled ? '#f0d397' : '#9fb27f') : '#555');
  const hull = (x, z, heading, length, color) => { c.save(); c.translate(sx(x), sz(z)); c.rotate(-heading); c.fillStyle = color;
    const l = Math.max(3, length / (area.maxX - area.minX) * w), b = Math.max(1.6, l * .16); c.fillRect(-b / 2, -l / 2, b, l); c.restore(); };
  for (const s of data.ourShips) hull(s.x, s.z, s.heading, 100, s.alive ? (s.controlled ? '#f0d397' : '#7fb0d8') : '#555');
  for (const b of data.blockships) if (!b.sunk) hull(b.x, b.z, b.heading, b.length, b.flagship ? '#c9b98c' : '#8d8a7e');
  for (const s of data.ships) if (s.x < JIANGYIN_RULES.radarRevealX) dot(s.x, s.z, s.big ? 5 : 4, '#e05a48');
  for (const l of data.landings) if (l.x < JIANGYIN_RULES.radarRevealX) dot(l.x, l.z, 2.6, '#e8a050');
  const seen = item => item.x < JIANGYIN_RULES.radarRevealX;   // 下游弯道后的出生区不显示
  for (const t of data.troops) if (seen(t)) dot(t.x, t.z, 1.6, '#ffcf7a');
  for (const t of data.tanks ?? []) if (seen(t)) { c.fillStyle = '#e05a48'; c.fillRect(sx(t.x) - 3, sz(t.z) - 3, 6, 6); }
  for (const p of data.planes ?? []) if (seen(p)) { c.fillStyle = '#f4f0e6'; c.beginPath();
    const a = -p.heading - Math.PI / 2, x = sx(p.x), y = sz(p.z);
    c.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); c.lineTo(x + Math.cos(a + 2.5) * 4, y + Math.sin(a + 2.5) * 4);
    c.lineTo(x + Math.cos(a - 2.5) * 4, y + Math.sin(a - 2.5) * 4); c.fill(); }
  c.fillStyle = '#ddd'; c.font = '10px serif'; c.fillText(`← ${JIANGYIN_RULES.leftLabel}`, 4, 12); c.textAlign = 'right'; c.fillText(`${JIANGYIN_RULES.rightLabel} →`, w - 4, 12); c.textAlign = 'start';
  c.fillStyle = 'rgba(235,228,205,.75)'; c.font = '9px serif'; c.textAlign = 'center';
  const placed = [];   // 地名避让：重叠时上下错开，实在放不下就略去
  for (const mark of JIANGYIN_LANDMARKS) {
    const x = sx(mark.x), half = c.measureText(mark.name).width / 2 + 1, base = Math.min(h - 3, Math.max(22, sz(mark.z)));
    const y = [base, base + 10, base - 10].find(y => y <= h - 2 && y >= 20 && !placed.some(b => Math.abs(b.x - x) < b.half + half && Math.abs(b.y - y) < 10));
    if (y === undefined) continue;
    placed.push({ x, y, half }); c.fillText(mark.name, x, y);
  }
  c.textAlign = 'start';
}

// ---------- 主循环 ----------
let last = performance.now();
renderer.setAnimationLoop(time => {
  const dt = Math.max(0, Math.min(.05, (time - last) / 1000)); last = time;   // 首帧时间戳可能早于 performance.now()
  if (running && !paused) {
    input.throttle = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    input.rudder = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    game.step(dt, input);
    input.lookDX = input.lookDY = 0; input.firePressed = false; input.skipIntro = false; input.switchPost = null; input.toggleView = false;
    hudClock += dt;
    if (hudClock > .1) { hudClock = 0; renderHud(); }
  } else if (game.state.phase !== 'ended') game.step(0, {});
  clockTime += dt;   // 表现层时钟单调递增（combat-effects 要求粒子时钟单调）
  vehicleRenderer.update(game.vehicles, clockTime);
  characters?.sync(game.troops, clockTime, running && !paused ? dt : 0);
  combatEffects.update(dt, clockTime, game.vehicles);
  renderer.render(scene, camera);
});
startButton.textContent = '进入战场 ↗';
startButton.disabled = false;
