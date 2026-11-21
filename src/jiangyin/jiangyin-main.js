// 江阴要塞阻击战 · 页面入口：渲染器、指针锁定输入、HUD、战术简图与合成音效。
import * as THREE from 'three';
import './jiangyin.css';
import { createEmplacementModel } from '../emplacement-model.js';
import { createJiangyinGame } from './jiangyin-game.js';
import { JIANGYIN_RULES, JIANGYIN_LANDMARKS, riverCenter, groundHeight, RIVER_HALF, JIANGYIN_VOICE_LINES, JIANGYIN_VOICE_FILE } from './jiangyin-rules.js';
import { createJiangyinGunModel, setCrewFactory } from './jiangyin-models.js';
import { soldierRoleIcon } from '../soldier-role-icons.js';
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
// 与其他战役统一：爆炸/开炮的镜头余震与闪光（blast-feedback）、近距爆炸耳鸣（blast-tinnitus）、录音枪声（rifle-audio）
import { createBlastFeedback } from '../blast-feedback.js';
import { createBlastTinnitus } from '../blast-tinnitus.js';
import { loadRifleAudio } from '../rifle-audio.js';
import { createJiangyinVoiceReactions } from './jiangyin-voice.js';

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

// ---------- 声音 ----------
// 步枪/轻机枪/机枪：使用项目的录音枪声（rifle-audio.js，与其他战役同一套声音与距离衰减）；加载失败时退回合成音。
// 大口径舰炮/岸防炮/爆炸：合成的多层炮声——尖锐的炮口爆音 + 低频冲击 + 长尾隆隆声 + 江面山谷回声，经压缩器避免削波。
let audio = null, master = null, rifleAudio = null, tinnitus = null, shotSerial = 0;
const blastFeedback = createBlastFeedback();
function ensureAudio() {
  if (audio) return;
  audio = new AudioContext();
  const compressor = audio.createDynamicsCompressor();
  compressor.threshold.value = -16; compressor.knee.value = 12; compressor.ratio.value = 4; compressor.attack.value = .003; compressor.release.value = .25;
  master = audio.createGain(); master.gain.value = 1;
  master.connect(compressor).connect(audio.destination);
  try { tinnitus = createBlastTinnitus(audio, master); } catch (error) { console.warn('[江阴] 耳鸣效果不可用', error); }
  loadRifleAudio().then(mixer => { rifleAudio = mixer; mixer.setOutput(master); })
    .catch(error => console.warn('[江阴] 录音枪声加载失败，改用合成音', error));
}
// 战场语音：按 cue 懒加载 Azure 生成的 mp3（见 JIANGYIN_VOICE_LINES）；文件不存在时静默跳过，只保留文字提示
const voiceCache = new Map(), voiceHeard = new Map();
const voiceReactions = createJiangyinVoiceReactions();
let voiceBusyUntil = 0;
function playVoice(cue, urgent = false, variant = 0) {
  if (!audio || !JIANGYIN_VOICE_LINES.some(line => line.cue === cue)) return;
  const now = audio.currentTime;
  if (!urgent && (now < voiceBusyUntil || now - (voiceHeard.get(cue) ?? -1e9) < 25)) return;   // 不叠播；同一句 25 秒内不重复
  voiceHeard.set(cue, now);
  const cacheKey = `${cue}:${variant}`;
  if (!voiceCache.has(cacheKey)) voiceCache.set(cacheKey, fetch(JIANGYIN_VOICE_FILE(cue, variant))
    .then(response => response.ok ? response.arrayBuffer() : null)
    .then(data => data ? audio.decodeAudioData(data) : null)
    .catch(() => null));
  voiceCache.get(cacheKey).then(buffer => {
    if (!buffer || !audio) return;
    const source = audio.createBufferSource(), amp = audio.createGain(), radio = audio.createBiquadFilter();
    radio.type = 'highpass'; radio.frequency.value = 160; amp.gain.value = 1.15;
    source.buffer = buffer; source.connect(radio).connect(amp).connect(master);
    const at = Math.max(audio.currentTime, voiceBusyUntil);
    voiceBusyUntil = at + buffer.duration + .25; source.start(at);
  });
}
// 命中确认音：炮弹命中舰船时立刻给一声清脆的金属撞击（击沉时再加一声低沉的轰鸣），远处的爆炸声随后按距离延迟传来
function hitConfirm(sunk) {
  if (!audio) return;
  const at = audio.currentTime;
  burst(at, { seconds: .12, cutoff: 2600, gain: .5, decay: 30, type: 'bandpass', q: 6 });
  burst(at, { seconds: .2, cutoff: 1400, gain: .35, decay: 18, type: 'bandpass', q: 9, delay: .03 });
  if (sunk) burst(at, { seconds: 1.4, cutoff: 160, gain: .9, decay: 2.2, delay: .08 });
}
const noiseCache = new Map();
function noiseBuffer(seconds) {
  const key = Math.round(seconds * 10);
  if (noiseCache.has(key)) return noiseCache.get(key);
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * seconds), audio.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(key, buffer); return buffer;
}
function burst(at, { seconds, cutoff, gain, decay = 3, type = 'lowpass', q = .7, pan = 0, delay = 0, to = master }) {
  const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), amp = audio.createGain(), panner = audio.createStereoPanner();
  source.buffer = noiseBuffer(seconds); filter.type = type; filter.frequency.value = cutoff; filter.Q.value = q; panner.pan.value = pan;
  amp.gain.setValueAtTime(0, at + delay); amp.gain.linearRampToValueAtTime(gain, at + delay + .004);
  amp.gain.setTargetAtTime(0, at + delay + .01, seconds / decay);
  source.connect(filter).connect(amp).connect(panner).connect(to); source.start(at + delay); source.stop(at + delay + seconds);
}
function thump(at, { from, toHz, seconds, gain, delay = 0 }) {
  const osc = audio.createOscillator(), amp = audio.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(from, at + delay); osc.frequency.exponentialRampToValueAtTime(toHz, at + delay + seconds * .7);
  amp.gain.setValueAtTime(0, at + delay); amp.gain.linearRampToValueAtTime(gain, at + delay + .006); amp.gain.setTargetAtTime(0, at + delay + .02, seconds / 4);
  osc.connect(amp).connect(master); osc.start(at + delay); osc.stop(at + delay + seconds);
}
const listenerRight = new THREE.Vector3();
function panOf(position) {
  if (!position) return 0;
  listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const dx = position.x - camera.position.x, dz = position.z - camera.position.z, d = Math.hypot(dx, dz) || 1;
  return Math.max(-.85, Math.min(.85, (dx * listenerRight.x + dz * listenerRight.z) / d));
}
function heavyGun(position, own, scale = 1) {
  const at = audio.currentTime, d = position ? camera.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z)) : 0;
  const near = own ? 1 : Math.max(.04, Math.min(1, 60 / (d + 40)));
  const delay = own ? 0 : Math.min(3, d / 340);                      // 远处炮声随距离延迟（声速）
  const pan = own ? 0 : panOf(position), bright = own ? 1 : Math.max(.15, 1 - d / 1800);
  burst(at, { seconds: .12, cutoff: 5200 * bright, gain: 1.1 * near * scale, decay: 6, pan, delay });            // 炮口爆音
  thump(at, { from: 95, toHz: 32, seconds: 1.3, gain: 1.25 * near * scale, delay });                              // 低频冲击
  burst(at, { seconds: 2.8 * scale, cutoff: 260, gain: .9 * near * scale, decay: 2.2, pan, delay: delay + .02 });   // 隆隆长尾
  burst(at, { seconds: 2.2, cutoff: 420, gain: .32 * near * scale, decay: 2, pan: -pan * .6, delay: delay + .55 + Math.random() * .25 });   // 江面与两岸山谷回声
  burst(at, { seconds: 1.8, cutoff: 300, gain: .18 * near * scale, decay: 2, pan: pan * .4, delay: delay + 1.3 + Math.random() * .3 });
}
function sound(name, position, event = {}) {
  if (!audio) return;
  const own = Boolean(event.player);
  if (['rifle', 'lmg', 'enemy-rifle', 'mg'].includes(name) && rifleAudio && position) {
    listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const owned = own && name !== 'mg';
    const shot = { id: ++shotSerial, start: { x: position.x, y: position.y, z: position.z }, automatic: name === 'lmg' || name === 'mg',
      weaponType: name === 'mg' ? 'machine-gun' : 'rifle',
      source: { soldierId: owned ? 'player' : `jy-${name}-${shotSerial % 13}`, weaponId: owned ? 'player-weapon' : `jy-${name}-gun`,
        team: name === 'enemy-rifle' ? 'enemy' : 'friendly', credit: name === 'enemy-rifle' ? 'enemy' : 'friendly',
        weaponClass: name === 'rifle' ? 'rifle' : name === 'enemy-rifle' ? 'rifle' : 'machine-gun' } };
    const listener = { position: camera.position, right: listenerRight, soldierId: 'player', weaponId: 'player-weapon' };
    try { rifleAudio.play(audio, shot, listener, owned); return; } catch (error) { console.warn('[江阴] 枪声播放失败', error); }
  }
  if (name === 'gun') { heavyGun(position, own, event.heavy ? 1.2 : 1); return; }
  if (name === 'enemy-gun') { heavyGun(position, false, .8); return; }
  if (name === 'boom') { heavyGun(position, false, event.heavy ? 1.4 : 1); return; }
  const distance = position ? camera.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z)) : 0;
  const gain = Math.max(.03, Math.min(1, 40 / (distance + 20)));
  const spec = { splash: [.9, 900, .5], mg: [.07, 2600, .25], rifle: [.18, 2200, .5], lmg: [.08, 2400, .35], 'enemy-rifle': [.16, 1900, .3], throw: [.12, 900, .15] }[name];
  if (!spec) return;
  burst(audio.currentTime, { seconds: spec[0], cutoff: spec[1], gain: spec[2] * gain, decay: 3, pan: panOf(position) });
}
// 镜头余震：开炮与近处爆炸都会触发（与其他战役同一套 blast-feedback 参数）
function blastNear(position, style) {
  if (!position) return;
  try {
    const exposure = blastFeedback.trigger(position, camera.position, style);
    if (tinnitus && audio && exposure.strength >= .25) tinnitus.play(position, { position: camera.position }, style);
  } catch (error) { console.warn('[江阴] 余震效果', error); }
}

// ---------- 游戏 ----------
let toastTimer = 0, hitTimer = 0, hurtTimer = 0, lastInteract = '', interactShownAt = 0;
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
  if (event.type === 'toast') { toast(event.text, event.alert); if (event.voice) playVoice(event.voice); }
  else if (event.type === 'sound') {
    sound(event.name, event.position, event);
    if (event.name === 'gun' && event.player) blastNear(event.position, 'explosive-pack');          // 自己开炮：强烈余震
    else if (event.name === 'boom') blastNear(event.position, event.heavy ? 'aircraft-bomb' : 'explosive-pack');
    else if (event.name === 'gun' || event.name === 'enemy-gun') blastNear(event.position, 'mortar');
  }
  else if (event.type === 'hit') {
    if (event.kind === 'troop') {
      const reaction = voiceReactions.troopHit(game.now, event.firstKill);
      if (reaction) playVoice(reaction.cue, false, reaction.variant);
    }
    $('jy-crosshair').classList.add('hit'); clearTimeout(hitTimer);
    hitTimer = setTimeout(() => $('jy-crosshair').classList.remove('hit'), event.kind === 'ship' || event.kind === 'landing' ? 420 : 160);
    if (event.kind === 'ship' || event.kind === 'landing') { hitConfirm(event.sunk); $('jy-hitinfo').classList.remove('pop'); void $('jy-hitinfo').offsetWidth; $('jy-hitinfo').classList.add('pop'); } }
  else if (event.type === 'transfer' && event.reason !== 'start')
    toast(event.reason === 'destroyed' ? `阵位失守 · 转移接管：${event.name}` : `接管：${event.name}`, event.reason === 'destroyed');
  else if (event.type === 'phase') { $('jy-caption').hidden = true; $('jy-hud').hidden = false;
    $('jy-crosshair').hidden = event.phase === 'scuttle'; $('jy-posts').hidden = event.phase === 'scuttle';
    document.querySelector('.jy-weapon').hidden = event.phase === 'scuttle'; $('jy-range').hidden = event.phase === 'scuttle'; }
  else if (event.type === 'deploy') { const fade = $('jy-fade'); fade.classList.remove('out'); void fade.offsetWidth; fade.classList.add('out'); for (const id of ['jy-crosshair', 'jy-posts', 'jy-range']) $(id).hidden = false;
    document.querySelector('.jy-weapon').hidden = false; $('jy-hud').hidden = false; }
  else if (event.type === 'first-enemy-kill') {
    const reaction = voiceReactions.firstKill();
    if (reaction) playVoice(reaction.cue, false, reaction.variant);
  }
  else if (event.type === 'hurt') {
    $('jy-hurt').classList.add('show'); clearTimeout(hurtTimer); hurtTimer = setTimeout(() => $('jy-hurt').classList.remove('show'), 120);
    const reaction = voiceReactions.wounded(game.now, event.health);
    if (!event.fatal && reaction) playVoice(reaction.cue, false, reaction.variant);
  }
  else if (event.type === 'ended') { playVoice(event.outcome?.result === 'victory' ? 'jiangyin-victory' : 'jiangyin-defeat', true); showEnd(event.outcome, event.stats); }
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
  if (event.code === 'KeyM') $('jy-minimap').classList.toggle('large');
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
  ensureAudio(); void audio.resume();
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
  // 交互提示：只在提示内容变化时显示约 3 秒后淡出（进炮位后“按 F 离开”不再一直挡在准星下方）；放在屏幕下方，不压住瞄准区
  const interactText = hud.interact ?? '';
  if (interactText !== lastInteract) { lastInteract = interactText; interactShownAt = performance.now(); $('jy-interact').textContent = interactText; }
  const interactAge = (performance.now() - interactShownAt) / 1000;
  $('jy-interact').style.opacity = interactText ? String(Math.max(0, Math.min(1, (3.6 - interactAge) / .6))) : '0';
  // 左下：小队成员概况（与其他战役一样的成员格：编号 + 兵种，存活/阵亡/当前操纵）
  const squadBox = $('jy-squad-status');
  squadBox.hidden = !hud.squad;
  if (hud.squad) {
    $('jy-unit-title').textContent = hud.squad.respawnIn !== null ? `步兵小队 · ${Math.ceil(hud.squad.respawnIn)} 秒后集结` : `步兵小队 ${hud.squad.alive}/${hud.squad.total}`;
    const key = hud.squad.members.map(m => `${m.index}${m.alive ? 1 : 0}${m.active ? 1 : 0}${m.hurt ? 1 : 0}`).join('');
    if (squadBox.dataset.key !== key) {
      squadBox.dataset.key = key;
      $('jy-members').replaceChildren(...hud.squad.members.map(m => {
        const chip = document.createElement('span');
        chip.className = `member${m.active ? ' active' : ''}${m.alive ? '' : ' dead'}${m.hurt ? ' hurt' : ''}`;
        chip.title = `${m.index + 1} · ${m.role}${m.alive ? '' : '（阵亡）'}`;
        // 与其他地图一致：用兵种图标（src/soldier-role-icons.js）而不是汉字；阵亡显示骷髅图标
        chip.replaceChildren(soldierRoleIcon(m.alive ? m.icon : 'dead'));
        const number = document.createElement('b'); number.textContent = String(m.index + 1); chip.append(number);
        return chip;
      }));
    }
  }
  // 右下：武器、弹药、装备栏、生命（与其他战役相同的排布）
  const equip = $('jy-equipment');
  if (hud.infantry) {
    const w = hud.infantry;
    $('jy-weapon-name').textContent = w.weapon === 'grenade' ? '二十四年式木柄手榴弹' : w.name;
    $('jy-ammo').textContent = w.weapon === 'grenade' ? String(w.ammo) : String(w.ammo);
    $('jy-ammo-max').textContent = w.weapon === 'grenade' ? '' : `/ ${w.reserve}`;
    $('jy-reload').style.width = `${w.reload !== null ? w.reload * 100 : 100}%`;
    $('jy-pace').textContent = w.dead ? '阵亡' : w.reloading ? '换弹' : w.crouch ? '蹲姿' : w.speed > 4 ? '奔跑' : w.speed > .3 ? '行进' : '站定';
    equip.innerHTML = `<span class="${w.weapon === 'primary' ? 'selected' : ''}"><b>1</b>主</span><span class="${w.weapon === 'grenade' ? 'selected' : ''}"><b>5</b>雷 ${w.grenades}</span>`;
    $('jy-health-fill').style.width = `${Math.max(0, hud.squad?.health ?? 0)}%`;
    $('jy-health-text').textContent = `生命 ${Math.max(0, Math.round(hud.squad?.health ?? 0))}`;
    $('jy-help').textContent = 'WASD 移动 · Shift 奔跑 · Ctrl/C 蹲下 · 右键瞄准 · R 换弹 · 1/5 武器 · F 进出炮位 · Y 换人 · M 地图';
  } else if (hud.weapon) {
    $('jy-weapon-name').textContent = hud.weapon.name;
    $('jy-ammo').textContent = String(hud.weapon.ammo);
    $('jy-ammo-max').textContent = `/ ${hud.weapon.reserve}`;
    const cooldown = hud.weapon.cooldown;
    $('jy-reload').style.width = `${cooldown ? cooldown.progress * 100 : 100}%`;
    $('jy-pace').textContent = cooldown?.mode === 'cooling' ? '枪管冷却' : cooldown && cooldown.progress < 1 ? '装填中' : '待发';
    equip.innerHTML = '';
    const post = hud.posts.find(p => p.controlled);
    const integrity = post ? Math.round(100 * post.health / post.maxHealth) : 100;
    $('jy-health-fill').style.width = `${integrity}%`;
    $('jy-health-text').textContent = `${hud.weapon.ship ? '舰体' : '阵位'} ${integrity}%`;
    const helm = hud.weapon.helm;
    const rudder = helm ? (Math.abs(helm.rudder) < .05 ? '正舵' : `${helm.rudder > 0 ? '左' : '右'}舵 ${Math.round(Math.abs(helm.rudder) * 35)}°`) : '';
    $('jy-help').textContent = hud.weapon.ship && integrity <= 0 ? '本舰已被击沉 · 稍后自动转到下一艘仍在作战的舰艇' : hud.weapon.ship ? (helm === null
      ? `舰艇由 AI 航行（${hud.weapon.speed.toFixed(1)} m/s）· WASD 接管操舰 · 左键开火 · 右键放大 · V 视角 · Q/E 或 1–3 换舰 · M 地图`
      : `手动操舰 · 车钟：${helm.bell} · ${rudder} · ${hud.weapon.speed.toFixed(1)} m/s · W/S 车钟进退一档 · A/D 转舵（大舰惯性大，提前操舵）· 换舰后交回 AI`)
      : '鼠标瞄准 · 左键开火 · 右键放大 · V 第一/第三人称 · F 离开炮位 · M 地图';
  }
  // 辅助瞄准（按住右键）：显示预测落点距离、弹丸飞行时间与散布；落点椭圆罩住日舰提前量位置时提示“可命中”
  $('jy-range').textContent = hud.aim
    ? `落点 ${Math.round(hud.aim.distance)} m · 飞行 ${hud.aim.flight.toFixed(1)} s · 散布 ${hud.aim.spread[0]}×${hud.aim.spread[1]} m${hud.aim.onTarget ? ' · 可命中' : hud.aim.lead ? ' · 对准红色提前量标记' : ''}`
    : hud.range ? `${Math.round(hud.range)} m` : '';
  $('jy-range').classList.toggle('on-target', Boolean(hud.aim?.onTarget));
  // 命中提示：准星下方显示被命中舰船的名称、本次伤害与剩余耐久（血条），2.5 秒内渐隐；击沉时显示“击沉！”
  const target = hud.target, info = $('jy-hitinfo');
  info.classList.toggle('show', Boolean(target));
  if (target) {
    info.querySelector('b').textContent = target.sunk ? '击沉！' : '命中！';
    info.querySelector('span').textContent = `${target.label} −${Math.round(target.damage)} · 剩余 ${Math.round(target.health * 100)}%`;
    info.querySelector('em').style.width = `${Math.round(target.health * 100)}%`;
    info.style.opacity = String(Math.min(1, (2.5 - target.age) / .6));   // 2.5 秒：前 1.9 秒完全显示，最后 0.6 秒淡出
    info.classList.toggle('sunk', Boolean(target.sunk));
  }
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
  if ($('jy-minimap').classList.contains('large')) {   // 展开时才标注地名，平时保持简洁
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
// 共享的 vehicle-renderer 只按航向摆放坦克（其他地图是平地）。江阴是山地：渲染器摆好之后，按战局算出的
// groundPitch / groundRoll 让车体贴合坡面（不改共享模块）。车辆模型通过网格上的 userData.vehicleId 找到。
const tankModels = new Map();
function tiltTanks() {
  for (const v of game.vehicles) {
    if (v.type !== 'tank' || v.groundPitch === undefined) continue;
    let model = tankModels.get(v.id);
    if (!model || !model.parent) {
      model = scene.children.find(o => { let id = null; o.traverse(c => { if (id === null && c.userData?.vehicleId) id = c.userData.vehicleId; }); return id === v.id; }) ?? null;
      if (model) tankModels.set(v.id, model); else continue;
    }
    model.rotation.set(v.groundPitch, v.heading, v.groundRoll, 'YXZ');
  }
  for (const id of tankModels.keys()) if (!game.vehicles.some(v => v.id === id)) tankModels.delete(id);
}
// 兜底：镜头万一落到江面以下（如演出镜头），显示浑浊的长江水下：黄绿色浓雾、压暗、声音闷住
let underwaterOn = false, airFog = null;
function underwater() {
  const below = camera.position.y < -.05 && groundHeight(camera.position.x, camera.position.z) < 0;
  if (below === underwaterOn || !scene.fog) return;
  underwaterOn = below;
  airFog ??= { color: scene.fog.color.clone(), density: scene.fog.density };
  scene.fog.color.copy(below ? new THREE.Color(0x3f4a33) : airFog.color);
  scene.fog.density = below ? .09 : airFog.density;
  $('jy-underwater')?.classList.toggle('show', below);
  if (master && audio) master.gain.setTargetAtTime(below ? .35 : 1, audio.currentTime, .08);
}
// 镜头晃动强度：读取与其他地图相同的玩家设置（player-preferences.js 的 motionStrength）；读不到时用 1
let preferenceStore = null;
import('../player-preferences.js').then(module => { preferenceStore = module.getPlayerPreferences?.() ?? null; }).catch(() => {});
function motionPreference() {
  const value = preferenceStore?.snapshot?.motionStrength;
  return Number.isFinite(value) ? value : 1;
}
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
    const bob = game.viewBob * .4;   // 与镜头起伏同相、同频（按实际步伐），避免两种晃动频率叠加造成眩晕
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
    input.motionStrength = motionPreference();
    try { game.step(dt, input); }
    catch (error) { console.error('[江阴] 战局更新', error); if (!stepErrorShown) { stepErrorShown = true; toast(`战局更新出错：${error.message}`, true); } }
    input.lookDX = input.lookDY = 0; input.firePressed = false; input.skipIntro = false; input.switchPost = null; input.toggleView = false;
    input.interact = input.cycleMember = input.reload = input.crouch = false; input.equip = null;
    hudClock += dt;
    if (hudClock > .1) { hudClock = 0; renderHud(); }
  } else if (game.state.phase !== 'ended') game.step(0, {});
  if (rifleAudio && audio) { try { listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion); rifleAudio.beginBatch(); rifleAudio.update({ position: camera.position, right: listenerRight, soldierId: 'player', weaponId: 'player-weapon' }); } catch {} }
  clockTime += dt;   // 表现层时钟单调递增（combat-effects 要求粒子时钟单调）
  vehicleRenderer.update(game.vehicles, clockTime);
  tiltTanks();
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
  // 余震：在本帧渲染前叠加镜头抖动（下一帧战局会重新设定镜头，不会漂移），并显示爆炸闪光
  const shake = blastFeedback.update(dt, 1);
  if (shake.strength > 0) {
    camera.translateX(shake.x); camera.translateY(shake.y);
    camera.rotateX(shake.pitch); camera.rotateY(shake.yaw); camera.rotateZ(shake.roll);
  }
  $('jy-flash').style.opacity = String(Math.min(.55, shake.flash));
  underwater();
  renderer.render(scene, camera);
  updateViewWeapon(dt);
});
