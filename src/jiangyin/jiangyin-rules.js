// 江阴要塞阻击战 · 纯规则模块（不依赖 three，可直接被 node --test 与 campaign-layout 引用）
// 坐标约定（按史实方向）：x 轴沿长江，长江自西向东流。+x 为东、下游（吴淞方向，日军来向），-x 为西、上游（南京方向，我军阵地）；
// 江水沿 +x 方向流动，日军舰队逆流而上。z<0 为北岸，z>0 为南岸（江阴城、黄山炮台一侧）。
// 尺度（按 1937 年实况）：堵塞线处江面宽约 1500 米（RIVER_HALF = 750），舰船为实舰主尺度。
// 下游 x>1100 处江道向南弯折，敌军在弯道后方、玩家视线之外出生。单位：米。地形是示意，不是测绘复原。
export const RIVER_HALF = 750;              // 水面半宽：江阴黄山—靖江段 1937 年江面约 1.5 公里
const SHORE_OFFSET = RIVER_HALF - 70;       // 岸线剖面（浅滩—滩头—石崖—台地）整体外移量

export const JIANGYIN_RULES = Object.freeze({
  durationSeconds: 300,          // 第二阶段：死守两岸阵地 5 分钟
  navalReinforceAfter: 120,      // 第一阶段超过该秒数仍未分出胜负时，日军每 30 秒增援一艘驱逐舰
  introSeconds: 12,              // 开场演出，可跳过
  breakthroughX: -1300,          // 敌舰航线的上游终点（南京方向；自沉封江后已无法到达）
  spawnX: 1700,                  // 敌舰在下游弯道后方入场
  leftLabel: '上游·南京', rightLabel: '下游·吴淞（敌来向）',
  flowSpeed: 1.6,                // 江水东流表观速度（米/秒，仅用于画面）
  riverHalfWidth: RIVER_HALF,    // 水面半宽
  playArea: Object.freeze({ minX: -1400, maxX: 1900, minZ: -1150, maxZ: 1500 }),
  radarRevealX: 1350,            // 驶出下游弯道（x<1350）后才出现在战术简图上
});

// 第一阶段（江面决战）：只有水面舰艇，at 为第一阶段开始后的秒数。我军三舰全部沉没后进入自沉封江与第二阶段。
// v13：日军占绝对优势——开场 4 艘（2 炮舰 + 2 驱逐舰）并列冲出弯道，10 秒后装甲巡洋舰“出云”与 1 艘驱逐舰跟进，
// 之后陆续增援；air 为航空小队（第一阶段主攻我军舰艇，俯冲投弹并以机枪扫射甲板）。
export const NAVAL_WAVES = Object.freeze([
  { at: 0, ships: ['gunboat', 'destroyer', 'destroyer', 'gunboat'] },
  { at: 10, ships: ['cruiser', 'destroyer'] },
  { at: 30, ships: [], air: 1 },
  { at: 55, ships: ['gunboat', 'gunboat'] },
  { at: 80, ships: [], air: 1 },
  { at: 110, ships: ['destroyer', 'destroyer'] },
].map(wave => Object.freeze({ ...wave, ships: Object.freeze(wave.ships) })));

// 第二阶段（死守两岸）：at 为第二阶段开始后的秒数，5 分钟内依次投入。
// ships：水面舰艇；landing：登陆艇靠岸方向；infantry：从下游陆路来袭的步兵小队（共 6 个）；
// tanks：坦克小队（共 2 个，每队 3 辆）；air：航空小队（共 3 个，每队 3 架，被击落前反复来袭）。
// 日军的目标是摧毁我军两岸阵地：5 个阵地全部被毁即失败。
// v13：日军蜂拥而上——步兵小队 9 个（每队 12 人，南岸为主攻方向）、坦克小队 3 个（沿公路开上山）、航空小队 3 个
export const JIANGYIN_WAVES = Object.freeze([
  { at: 0, ships: [], landing: ['south', 'north'], infantry: ['south'], tanks: ['south'] },
  { at: 40, ships: ['gunboat'], landing: ['south', 'south'], infantry: ['north', 'south'], air: 1 },
  { at: 80, ships: [], landing: ['north'], infantry: ['south'], tanks: ['south'] },
  { at: 125, ships: ['gunboat'], landing: ['north', 'south', 'south'], infantry: ['north', 'south'], air: 1 },
  { at: 170, ships: [], landing: ['north', 'south'], infantry: ['south'], tanks: ['north'] },
  { at: 215, ships: ['destroyer'], landing: ['south'], infantry: ['north'], air: 1 },
  { at: 255, ships: [], landing: ['north', 'south', 'south'] },
].map(wave => Object.freeze({ ...wave, ships: Object.freeze(wave.ships), landing: Object.freeze(wave.landing),
  infantry: Object.freeze(wave.infantry ?? []), tanks: Object.freeze(wave.tanks ?? []), air: wave.air ?? 0 })));

// 日军陆军先头部队：玩家在自沉演出中登岸时即从下游陆路出发，约在第二阶段开始时抵达（计入 6 个步兵小队）
export const JIANGYIN_ADVANCE_GUARD = Object.freeze({ infantry: Object.freeze(['south', 'south']) });

// 陆路/空中出生点：下游两岸台地，位于弯道与山丘之后，玩家阵地看不到
export const LAND_SPAWNS = Object.freeze({
  south: Object.freeze({ x: 930, z: RIVER_HALF + 430 }),    // 巫山西麓背后（离长山炮台约 400 米）
  north: Object.freeze({ x: 960, z: -(RIVER_HALF + 380) }),
});
// 江阴战场语音（Azure AI Speech 生成，与仓库 public/assets/audio/battle-voices 同一流程与 source.json 登记）
// 文件名：friendly-0-<cue>.mp3；音色与其他地图一致 zh-CN-YunjianNeural / angry / +12% / -2%。
// 文件缺失时页面静默跳过，只显示文字提示，不影响战斗。
export const JIANGYIN_VOICE_LINES = Object.freeze([
  { cue: 'jiangyin-naval-start', text: '各舰注意！日舰逆流而上，主炮自由射击！' },
  { cue: 'jiangyin-enemy-ships', text: '下游弯道发现日舰！' },
  { cue: 'jiangyin-air-raid', text: '敌机来袭！对空射击！' },
  { cue: 'jiangyin-bomb', text: '敌机投弹！快找掩护！' },
  { cue: 'jiangyin-enemy-sunk', text: '打中了！敌舰下沉了！' },
  { cue: 'jiangyin-ship-hit', text: '我舰中弹，正在下沉！' },
  { cue: 'jiangyin-scuttle', text: '三舰全部沉没！总指挥部命令：阻塞船自沉封江！' },
  { cue: 'jiangyin-river-sealed', text: '江口堵死了！鬼子的军舰过不去了！' },
  { cue: 'jiangyin-hold', text: '弟兄们，上岸进阵地！死守炮台，绝不让鬼子过江阴！' },
  { cue: 'jiangyin-landing-south', text: '鬼子在南岸登陆了！' },
  { cue: 'jiangyin-landing-north', text: '鬼子在北岸登陆了！' },
  { cue: 'jiangyin-infantry', text: '鬼子步兵从下游摸上来了！' },
  { cue: 'jiangyin-tanks', text: '鬼子坦克沿公路开上来了！准备反坦克！' },
  { cue: 'jiangyin-post-lost', text: '炮台被毁了！转移阵地，继续打！' },
  { cue: 'jiangyin-grenades', text: '鬼子摸到炮位了！小心手榴弹！' },
  { cue: 'jiangyin-squad-rally', text: '新的弟兄上来了！跟我守住炮台！' },
  { cue: 'jiangyin-victory', text: '江阴守住了！鬼子的舰队过不去！' },
  { cue: 'jiangyin-defeat', text: '炮台全部失守……弟兄们，撤！' },
].map(Object.freeze));
export const JIANGYIN_VOICE_FILE = cue => `/assets/audio/battle-voices/friendly-0-${cue}.mp3`;

export const AIR_SPAWN = Object.freeze({ x: 2800, y: 260, z: 0 });

export const ENEMY_TYPES = Object.freeze({
  gunboat: Object.freeze({ name: '日军炮舰', ships: Object.freeze(['安宅', '保津', '势多', '二见', '热海']), health: 1600, speed: 7, gapSpeed: 2.6, length: 69, beam: 9.7, height: 8,
    fireInterval: 6.2, fireRange: 2400, shellDamage: 80, shellRadius: 6, dispersion: 16 }),
  destroyer: Object.freeze({ name: '日军驱逐舰', ships: Object.freeze(['山风', '江风', '海风', '凉风']), health: 2700, speed: 6.5, gapSpeed: 2.2, length: 111, beam: 9.9, height: 10,
    fireInterval: 3.6, fireRange: 2600, shellDamage: 90, shellRadius: 6.5, dispersion: 14 }),
  cruiser: Object.freeze({ name: '日军装甲巡洋舰', ships: Object.freeze(['出云']), health: 3600, speed: 6, gapSpeed: 1.8, length: 122, beam: 20.9, height: 13,
    fireInterval: 3.2, fireRange: 3000, shellDamage: 110, shellRadius: 8, dispersion: 14 }),
  squad: Object.freeze({ name: '日军步兵小队', size: 12 }),
  tank: Object.freeze({ name: '日军九五式轻战车', platoon: 3, roadStart: 620, health: 520, speed: 3.4, fireRange: 170, fireInterval: 4.2,
    shellDamage: 40, shellRadius: 4, dispersion: 4, radius: 2.4 }),
  aircraft: Object.freeze({ name: '日军九六式舰攻', flight: 3, health: 520, radius: 4 }),   // 飞行、机枪与投弹沿用项目共用的 aircraft-ai.js / air-support.js
  landing: Object.freeze({ name: '日军大发登陆艇', health: 260, speed: 13, length: 14.9, beam: 3.35, height: 2.2, troops: 5, unloadSeconds: 1.6 }),
  infantry: Object.freeze({ name: '日军登陆步兵', health: 100, speed: 4.4, attackRange: 5, attackInterval: 2.5, attackDamage: 25,
    shootRange: 140, shootInterval: 2.8, shootDamage: 34 }),   // 遇到我军步兵时就地射击
});

// 第二阶段玩家步兵小队（与其他地图的默认步兵班一致：11 人，中正式步枪，第 2 人为捷克式轻机枪手，每人 2 枚手榴弹）
export const JIANGYIN_SQUAD = Object.freeze({ members: 11, walk: 2.7, run: 5.2, aimWalk: 1.4, eye: 1.62, health: 100,
  reserve: Object.freeze({ rifle: 60, zb26: 200 }), grenades: 2, rifleDamage: 100, rifleRange: 180,
  grenade: Object.freeze({ speed: 17, fuse: 3.4, radius: 7, damage: 160 }), interactRange: 6, respawnSeconds: 6,
  deployAfter: 10, deployAfterSunk: 2, deployLatest: 60 });   // 自沉演出至少 10 秒、且至少 2 艘阻塞船沉没后（最迟 60 秒），玩家以步兵小队直接在炮台附近出现

// 我方可接管的火力点。profile 复用 src/emplacements.js 中的 EMPLACEMENT_PROFILES。
// bank 为 null 表示江面炮艇；altitude 由地形函数计算。
export const JIANGYIN_POSTS = Object.freeze([
  // 第一阶段：我军三艘水面舰艇（AI 航行，玩家只操作艏主炮塔）。length/beam 为实舰主尺度（米）。
  // 部署（自西向东）：上游锚地的阻塞船 → 江心我军三舰（前出到堵塞线以东）→ 下游日军舰队。舰首朝东迎敌。
  // v11：两军开场接战距离约 0.6–1 公里（原先 1.3–1.9 公里），4 倍放大下能看清敌舰舰形。
  { id: 'pinghai', name: '平海舰', kind: 'ship', profile: 'bofors75', mount: 'shipTurret', x: 120, z: -200, heading: -Math.PI / 2, bank: null,
    health: 1800, key: '1', length: 109, beam: 11.9 },
  { id: 'ninghai', name: '宁海舰', kind: 'ship', profile: 'bofors75', mount: 'shipTurret', x: -60, z: 230, heading: -Math.PI / 2, bank: null,
    health: 1800, key: '2', length: 109, beam: 11.9 },
  { id: 'yixian', name: '逸仙舰', kind: 'ship', profile: 'bofors75', mount: 'shipTurret', x: 260, z: 60, heading: -Math.PI / 2, bank: null,
    health: 1350, key: '3', length: 82, beam: 10.4 },
  // 两岸阵地：岸防炮与机枪堡都设在山顶（南岸黄山、肖山、长山；北岸江边土岗），两个阶段都由炮手据守；第二阶段玩家以步兵小队在附近复生
  { id: 'huangshan-east', name: '长山炮台', kind: 'battery', profile: 'bofors75', mount: 'coastal', x: 560, z: RIVER_HALF + 165, bank: 'south', key: '4', health: 760 },
  { id: 'huangshan-west', name: '黄山炮台', kind: 'battery', profile: 'bofors75', mount: 'coastal', x: -380, z: RIVER_HALF + 165, bank: 'south', key: '5', health: 760 },
  { id: 'north-battery', name: '八圩港炮台', kind: 'battery', profile: 'bofors75', mount: 'coastal', x: -260, z: -(RIVER_HALF + 230), bank: 'north', key: '6', health: 680 },
  // 每座岸防炮台旁配置一门德制 8.8 cm Flak 18/36 高射炮（高平两用，主要对空）
  { id: 'changshan-flak', name: '长山高射炮', kind: 'battery', profile: 'bofors75', mount: 'flak88', x: 582, z: RIVER_HALF + 177, bank: 'south', key: '', health: 520 },
  { id: 'huangshan-flak', name: '黄山高射炮', kind: 'battery', profile: 'bofors75', mount: 'flak88', x: -358, z: RIVER_HALF + 177, bank: 'south', key: '', health: 520 },
  { id: 'bawei-flak', name: '八圩港高射炮', kind: 'battery', profile: 'bofors75', mount: 'flak88', x: -238, z: -(RIVER_HALF + 242), bank: 'north', key: '', health: 480 },
  { id: 'south-mg', name: '肖山机枪堡', kind: 'battery', profile: 'maxim24', mount: 'nest', x: 120, z: RIVER_HALF + 150, bank: 'south', key: '7', health: 480 },
  { id: 'north-mg', name: '北岸土岗机枪堡', kind: 'battery', profile: 'maxim24', mount: 'nest', x: 380, z: -(RIVER_HALF + 200), bank: 'north', key: '8', health: 480 },
].map(Object.freeze));

// 岸防火力在本关允许更大俯角/射程（江面在炮位下方），只覆盖本关点位，不改动全局 EMPLACEMENT_PROFILES。
export const JIANGYIN_PROFILE_OVERRIDES = Object.freeze({
  bofors75: Object.freeze({ minPitch: -.32, range: 3200, reserve: 40 }),
  maxim24: Object.freeze({ minPitch: -.42, maxPitch: .9, range: 900 }),   // 允许抬高对空射击
});

// 本关专用炮位外形与参数（按点位 mount 叠加在上面的覆盖值之上）。
// coastal：钢筋混凝土圆形炮台上的装甲防盾岸防炮；deck：炮艇艇首炮；nest：滩头钢筋混凝土机枪堡。
// 口径/型号为游戏化设定，不对应某一门具体史实火炮。
export const JIANGYIN_MOUNTS = Object.freeze({
  coastal: Object.freeze({ mount: 'coastal', name: '德制150毫米加农炮', muzzleHeight: 2.1, barrel: 7.6, damage: 220, radius: 10, aiInterval: 11,
    reload: 6, reserve: 75, traverse: 1.45, minPitch: -.55, maxPitch: .3, range: 3200, shellSpeed: 520,
    view: Object.freeze({ first: Object.freeze({ back: -1.5, up: 1.55 }), third: Object.freeze({ back: 11, up: 4.2 }) }) }),
  // 据记载，1937 年江阴要塞配有德制 88 毫米炮 8 门、德制 150 毫米加农炮 4 门及各型旧式榴弹炮；具体部署到哪座炮台为游戏改编。
  flak88: Object.freeze({ mount: 'coastal', variant: 'flak88', name: '8.8 cm Flak 18/36 高射炮', muzzleHeight: 2.05, barrel: 4.9, damage: 150, radius: 7, aiInterval: 7,
    reload: 3.2, reserve: 75, traverse: 1.6, minPitch: -.5, maxPitch: 1.25, range: 3200, shellSpeed: 640,   // 高平两用
    view: Object.freeze({ first: Object.freeze({ back: 1.6, up: 1.05 }), third: Object.freeze({ back: 10, up: 4 }) }) }),
  // 平海/宁海舰艏为双联 140 毫米主炮塔（逸仙艏炮口径不同，游戏中统一处理）
  shipTurret: Object.freeze({ mount: 'shipTurret', name: '舰艏双联主炮', muzzleHeight: 1.7, barrel: 7, damage: 210, radius: 9, aiInterval: 6.5,
    reload: 5, reserve: 75, traverse: 2.5, minPitch: -.15, maxPitch: .45, range: 3200, shellSpeed: 600,
    view: Object.freeze({ first: Object.freeze({ back: 1.2, up: 2.45 }), third: Object.freeze({ back: 52, up: 20 }) }) }),   // 第一人称：炮长从炮塔顶指挥舱口探出上半身，越过顶板能看到双联炮管前段与艏甲板
  deck: Object.freeze({ mount: 'deck', name: '76毫米艇首炮', muzzleHeight: 1.25, barrel: 3, reserve: 40, shellSpeed: 300,
    view: Object.freeze({ first: Object.freeze({ back: 1.35, up: .78 }), third: Object.freeze({ back: 24, up: 10.5 }) }) }),
  // 山顶环形机枪堡：可全向射击（日军步兵会沿江岸从侧面迂回）
  nest: Object.freeze({ mount: 'nest', traverse: Math.PI, view: Object.freeze({ third: Object.freeze({ back: 6, up: 2.4 }) }) }),
});

// 战术图/开场字幕使用的地名（据江阴海战示意图的相对顺序，按史实方向：上游（西）为江阴城、黄山、肖山，堵塞线在长山一线，下游（东）为巫山；北岸为八圩港、天生港）
export const JIANGYIN_LANDMARKS = Object.freeze([
  { name: '江阴城', x: -1000, z: 1050 }, { name: '黄山', x: -380, z: 1000 }, { name: '肖山', x: 120, z: 980 },
  { name: '长山', x: 540, z: 1010 }, { name: '堵塞线', x: 0, z: 0 }, { name: '巫山', x: 1150, z: 1040 },
  { name: '八圩港', x: -300, z: -880 }, { name: '上天生港', x: -900, z: -880 }, { name: '中天生港', x: 300, z: -880 }, { name: '下天生港', x: 900, z: -880 },
].map(Object.freeze));

export function postFacing(post) {
  // 岸上火力点默认朝向江心偏下游（东，敌舰来向）。返回 emplacements.js 约定的 heading：前向 = (-sin h, -cos h)。
  if (Number.isFinite(post.heading)) return post.heading;
  const target = { x: post.x + 60, z: 0 };
  return Math.atan2(post.x - target.x, post.z - target.z);
}

export function jiangyinObjectives() {
  return JIANGYIN_POSTS.filter(post => post.kind === 'battery')
    .map(post => ({ id: post.id, name: post.name, x: post.x, z: post.z, owner: 'friendly' }));
}

// 地形高度（水面 y=0；江底为负）。纯函数，供渲染、步兵行走与弹着判定共用。
// 两岸：浅滩 → 滩头 → 陡峭石崖（约 18 米）→ 崖顶台地；南岸另有黄山、肖山、长山、巫山等山丘。
const hill = (x, z, cx, cz, rx, rz, h) => { const d = Math.hypot((x - cx) / rx, (z - cz) / rz); return d < 1 ? (Math.cos(d * Math.PI) + 1) / 2 * h : 0; };
export const riverCenter = x => x > 1100 ? Math.min(800, ((x - 1100) / 500) ** 2 * 300) : 0;
// 地表细节：值噪声分形（纯函数），给台地加起伏、给石崖加层理与冲沟，远处加连绵山脊；阵位周围压平成炮位平台
function lattice(ix, iz) { let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (lattice(ix, iz) * (1 - u) + lattice(ix + 1, iz) * u) * (1 - v) + (lattice(ix, iz + 1) * (1 - u) + lattice(ix + 1, iz + 1) * u) * v;
}
export function terrainFbm(x, z, octaves = 4) {
  let sum = 0, amp = .5, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += valueNoise(x, z) * amp; norm += amp; x = x * 2.03 + 17.1; z = z * 2.03 - 9.3; amp *= .5; }
  return sum / norm;
}
const smooth = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
let postPads = null;
function padWeight(x, z) {
  if (Math.abs(Math.abs(z) - RIVER_HALF) > 420) return 1;
  postPads ??= JIANGYIN_POSTS.filter(post => post.kind === 'battery').map(post => [post.x, post.z]);
  let w = 1;
  for (const [px, pz] of postPads) w = Math.min(w, smooth(9, 20, Math.hypot(x - px, z - pz)));
  return w;
}
// 自然地表（不含人工挖掘的战壕），供战壕护壁、沙袋等摆放
export function naturalGroundHeight(x, z) {
  return baseGroundHeight(x, z) + terrainDetail(x, z);
}
export function groundHeight(x, z) {
  const natural = naturalGroundHeight(x, z);
  return natural + trenchOffset(x, z) + roadOffset(x, z, natural);
}

// ---------- 军用公路：从下游岸边（登陆滩头）蜿蜒上山通往各阵地，坦克与日军步兵沿路推进 ----------
// 路线用 A* 在 8 米网格上自动选线：限制坡度（约 11%），绕开陡崖与江水，自然形成之字形盘山路；
// 路面压平（宽约 7 米，两侧 7 米过渡为路堑/路堤），并对纵坡再做平滑，保证战车可以开上去。
export const ROAD = Object.freeze({ half: 3.6, shoulder: 7, maxGrade: .11, cell: 8, sample: 4 });
let roads = null, roadHash = null;
const HASH = 24, hashKey = (cx, cz) => cx * 73856093 ^ cz * 19349663;
function roadStart(sign, x) {
  // 沿 z 方向寻找该 x 处的滩头（地面约 1.5–2.5 米）
  for (let a = 60; a < 200; a += 1) { const z = sign * (RIVER_HALF + a - 70) + riverCenter(x); const h = naturalGroundHeight(x, z); if (h > 1.6) return [x, z]; }
  return [x, sign * (RIVER_HALF + 12) + riverCenter(x)];
}
function postRear(id, back = 17) {
  const post = JIANGYIN_POSTS.find(p => p.id === id), h = postFacing(post);
  return [post.x + Math.sin(h) * back, post.z + Math.cos(h) * back];
}
function aStar(from, to, bounds) {
  const C = ROAD.cell, nx = Math.ceil((bounds.maxX - bounds.minX) / C) + 1, nz = Math.ceil((bounds.maxZ - bounds.minZ) / C) + 1;
  const hx = i => bounds.minX + i * C, hz = k => bounds.minZ + k * C;
  const heights = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) heights[k * nx + i] = naturalGroundHeight(hx(i), hz(k));
  const cellOf = ([x, z]) => [Math.max(0, Math.min(nx - 1, Math.round((x - bounds.minX) / C))), Math.max(0, Math.min(nz - 1, Math.round((z - bounds.minZ) / C)))];
  const [si, sk] = cellOf(from), [gi, gk] = cellOf(to), goal = gk * nx + gi;
  const cost = new Float32Array(nx * nz).fill(Infinity), came = new Int32Array(nx * nz).fill(-1);
  const heap = [], push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  const start = sk * nx + si; cost[start] = 0; push(start, 0);
  while (heap.length) {
    const [, n] = pop(); if (n === goal) break;
    const i = n % nx, k = (n - i) / nx, h = heights[n];
    for (const [di, dk] of steps) {
      const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const m = kk * nx + ii, h2 = heights[m], len = Math.hypot(di, dk) * C, grade = Math.abs(h2 - h) / len;
      if (h2 < 1.2 && m !== goal || grade > .2) continue;                              // 不下水、不走陡崖
      const c = cost[n] + len * (1 + (grade > ROAD.maxGrade ? 60 : 0) + 12 * grade * grade);
      if (c < cost[m]) { cost[m] = c; came[m] = n; push(m, c + Math.hypot(gi - ii, gk - kk) * C); }
    }
  }
  const path = [];
  for (let n = goal; n >= 0; n = came[n]) { const i = n % nx; path.push([hx(i), hz((n - i) / nx)]); if (n === start) break; }
  path.reverse(); path[0] = from; path[path.length - 1] = to;
  return path;
}
function smoothPath(points, iterations = 3) {
  let p = points;
  for (let n = 0; n < iterations; n++) {   // Chaikin 平滑：去掉网格折角
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const [ax, az] = p[i], [bx, bz] = p[i + 1]; q.push([ax * .75 + bx * .25, az * .75 + bz * .25], [ax * .25 + bx * .75, az * .25 + bz * .75]); }
    q.push(p.at(-1)); p = q;
  }
  const out = [p[0]];   // 等距重采样
  let carry = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1], len = Math.hypot(bx - ax, bz - az);
    let t = ROAD.sample - carry;
    while (t <= len) { out.push([ax + (bx - ax) * t / len, az + (bz - az) * t / len]); t += ROAD.sample; }
    carry = len - (t - ROAD.sample);
  }
  out.push(p.at(-1));
  return out;
}
// rampLegs：前几段为沿崖壁斜切的上崖坡道（路堑），直接连线不走 A*
function buildRoad(id, bank, waypoints, bounds, rampLegs = 0) {
  let points = [];
  for (let i = 0; i < waypoints.length - 1; i++) { const leg = i < rampLegs ? [waypoints[i], waypoints[i + 1]] : aStar(waypoints[i], waypoints[i + 1], bounds); points.push(...(i ? leg.slice(1) : leg)); }
  points = smoothPath(points);
  // 纵断面：沿线地面高度滑动平均后，正反两遍限制纵坡
  const raw = points.map(([x, z]) => naturalGroundHeight(x, z)), n = raw.length;
  let h = raw.map((_, i) => { let sum = 0, c = 0; for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6); k++) { sum += raw[k]; c++; } return sum / c; });
  h[0] = raw[0]; h[n - 1] = raw[n - 1];
  const step = ROAD.sample * .13;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) h[i] = Math.max(h[i - 1] - step, Math.min(h[i - 1] + step, h[i]));
    for (let i = n - 2; i >= 0; i--) h[i] = Math.max(h[i + 1] - step, Math.min(h[i + 1] + step, h[i]));
  }
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return Object.freeze({ id, bank, points: Object.freeze(points.map(p => Object.freeze(p))), heights: Float32Array.from(h), lengths: Object.freeze(lengths) });
}
function buildRoads() {
  const R = RIVER_HALF;
  // 南岸：滩头 → 沿崖壁斜切上崖（约 200 米坡道）→ 崖顶台地 → 盘山至长山炮台后方 → 肖山 → 黄山
  const beach = roadStart(1, 1330), cliffTop = roadStart(1, 1130);
  const south = buildRoad('south-road', 'south', [beach, [cliffTop[0], cliffTop[1] + 42], postRear('huangshan-east'), postRear('south-mg'), postRear('huangshan-west')],
    { minX: -560, maxX: 1460, minZ: R + 4, maxZ: R + 460 }, 1);
  const north = buildRoad('north-road', 'north', [roadStart(-1, 1180), postRear('north-mg'), postRear('north-battery')],
    { minX: -460, maxX: 1360, minZ: -(R + 400), maxZ: -(R + 4) });
  return [south, north];
}
export function jiangyinRoads() {
  if (!roads) {
    roads = buildRoads(); roadHash = new Map();
    const reach = ROAD.half + ROAD.shoulder;
    roads.forEach((road, r) => road.points.forEach((p, i) => {
      if (i === road.points.length - 1) return;
      const q = road.points[i + 1];
      for (let cx = Math.floor((Math.min(p[0], q[0]) - reach) / HASH); cx <= Math.floor((Math.max(p[0], q[0]) + reach) / HASH); cx++)
        for (let cz = Math.floor((Math.min(p[1], q[1]) - reach) / HASH); cz <= Math.floor((Math.max(p[1], q[1]) + reach) / HASH); cz++) {
          const key = hashKey(cx, cz); if (!roadHash.has(key)) roadHash.set(key, []); roadHash.get(key).push(r, i);
        }
    }));
  }
  return roads;
}
// 最近路段：返回到路中心线的距离、路面高度、所属道路与沿线位置
export function roadProbe(x, z) {
  if (!roads) jiangyinRoads();
  const list = roadHash.get(hashKey(Math.floor(x / HASH), Math.floor(z / HASH)));
  if (!list) return null;
  let best = null;
  for (let k = 0; k < list.length; k += 2) {
    const road = roads[list[k]], i = list[k + 1], [ax, az] = road.points[i], [bx, bz] = road.points[i + 1];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (!best || d < best.d) best = { d, road, index: i, t, height: road.heights[i] + (road.heights[i + 1] - road.heights[i]) * t, s: road.lengths[i] + Math.sqrt(len2) * t };
  }
  return best;
}
function roadOffset(x, z, natural) {
  if (roads === null && building) return 0;
  if (Math.abs(Math.abs(z) - RIVER_HALF) > 460 && Math.abs(z) < 2000) return 0;
  if (roads === null) { building = true; try { jiangyinRoads(); } finally { building = false; } }
  const probe = roadProbe(x, z);
  if (!probe || probe.d > ROAD.half + ROAD.shoulder) return 0;
  const w = probe.d <= ROAD.half ? 1 : 1 - smooth(ROAD.half, ROAD.half + ROAD.shoulder, probe.d);
  return (probe.height - natural) * w;
}
let building = false;
// 沿路线行进：从任意点出发，先就近上路，再沿公路走到离目标阵位最近的路段（返回航点列表，间隔约 12 米）
export function roadRoute(bank, from, to) {
  const road = jiangyinRoads().find(r => r.bank === bank);
  if (!road) return [];
  const nearest = (x, z) => { let best = 0, bd = Infinity; road.points.forEach(([px, pz], i) => { const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = i; } }); return best; };
  const a = nearest(from.x, from.z), b = nearest(to.x, to.z), dir = b >= a ? 1 : -1, route = [];
  for (let i = a; dir > 0 ? i <= b : i >= b; i += dir * 3) route.push({ x: road.points[i][0], z: road.points[i][1] });
  route.push({ x: road.points[b][0], z: road.points[b][1] });
  return route;
}

// ---------- 阵地前沿战壕（已挖好，约一人深） ----------
// 每座岸防炮与机枪堡前方（面向江面）一道折线主壕，两端各接一条折向后方的交通壕，交通壕末端缓坡出地面。
// 壕深 1.8 米、壕底宽约 1 米、上口宽约 1.6 米（木板护壁，近乎竖直）；江面一侧堆起约 0.5 米的胸墙。
export const TRENCH = Object.freeze({ depth: 1.8, floorHalf: .5, topHalf: .8, parapet: .55, ramp: 7 });
function buildTrenches() {
  return JIANGYIN_POSTS.filter(post => post.kind === 'battery' && post.mount !== 'flak88').map(post => {
    const h = postFacing(post), fx = -Math.sin(h), fz = -Math.cos(h), rx = -fz, rz = fx;
    const nest = post.mount === 'nest', reach = nest ? 14 : 20, half = nest ? 12 : 20;
    const front = [];
    for (let u = -half; u <= half + 1e-6; u += 4) {
      const zig = Math.round(u / 4) % 2 ? 1.6 : -1.6;   // 折线：避免敌弹沿壕纵射
      front.push([post.x + fx * (reach + zig) + rx * u, post.z + fz * (reach + zig) + rz * u]);
    }
    const tail = sign => { const [x, z] = front[sign < 0 ? 0 : front.length - 1];
      return [[x - fx * 6 + rx * sign * 2, z - fz * 6 + rz * sign * 2], [x - fx * 13 + rx * sign * 3, z - fz * 13 + rz * sign * 3]]; };
    const points = [...tail(-1).reverse(), ...front, ...tail(1)];
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const xs = points.map(p => p[0]), zs = points.map(p => p[1]), pad = 4;
    return Object.freeze({ postId: post.id, fx, fz, points: Object.freeze(points.map(p => Object.freeze(p))), lengths: Object.freeze(lengths),
      total: lengths.at(-1), bounds: Object.freeze({ minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad }) });
  });
}
let trenches = null;
export function jiangyinTrenches() { return trenches ??= buildTrenches(); }
// 到战壕中线的最近距离、沿线位置与该处是否在江面一侧
export function trenchProbe(x, z) {
  let best = null;
  for (const trench of jiangyinTrenches()) {
    const b = trench.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    const p = trench.points;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az, len2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, s: trench.lengths[i] + t * Math.sqrt(len2), trench, front: (x - px) * trench.fx + (z - pz) * trench.fz > 0 };
    }
  }
  return best;
}
function trenchOffset(x, z) {
  if (!trenches && !JIANGYIN_POSTS.length) return 0;
  const probe = trenchProbe(x, z);
  if (!probe || probe.d > 3.2) return 0;
  const { d, s, trench, front } = probe;
  const ramp = Math.min(1, s / TRENCH.ramp, (trench.total - s) / TRENCH.ramp);   // 交通壕末端缓坡出地面
  const cut = TRENCH.depth * ramp * smooth(TRENCH.topHalf, TRENCH.floorHalf, d);
  const bank = (front ? TRENCH.parapet : TRENCH.parapet * .45) * ramp * Math.sin(Math.PI * Math.max(0, Math.min(1, (d - TRENCH.topHalf) / 2.2)));
  return -cut + bank;
}
function terrainDetail(x, z) {
  const a = Math.abs(z - riverCenter(x)) - SHORE_OFFSET;
  if (a < 80) return 0;
  const land = smooth(80, 88, a), cliff = smooth(84, 88, a) * (1 - smooth(97, 103, a));
  const broad = (terrainFbm(x * .022, z * .022) - .5) * 4.2, fine = (terrainFbm(x * .09 + 40, z * .09) - .5) * 1.2;
  const strata = cliff * (Math.abs(Math.sin(terrainFbm(x * .05, z * .05) * 9 + (z > 0 ? z : -z) * .6)) - .5) * 1.6;
  const far = smooth(215, 330, a) * terrainFbm(x * .008 + 3, z * .008) ** 1.6 * 70;
  return (land * (broad + fine) * (1 - cliff * .6) + strata) * padWeight(x, z) + far;
}
function baseGroundHeight(x, z) {
  const center = riverCenter(x);
  z -= center;
  const a = Math.abs(z) - SHORE_OFFSET, north = z < 0;
  const wobble = Math.sin(x * .031) * 2.6 + Math.sin(x * .011 + 1.3) * 3.4;          // 崖线前后错落
  const ripple = Math.sin(x * .045) * .5 + Math.sin(x * .013 + z * .02) * .9;
  let h;
  if (a <= 62) h = -3 - 11 * Math.min(1, (62 - a) / 220);                            // 主航道深约 14 米
  else if (a <= 72) h = -3 + (a - 62) / 10 * 3.6;
  else if (a <= 79) h = .6 + (a - 72) / 7 * .8;
  else {
    const b = a - wobble * (a > 82 ? 1 : (a - 79) / 3);
    if (b <= 82) h = 1.4 + (b - 79) / 3 * 1.2;
    else if (b <= 86) h = 2.6 + (b - 82) / 4 * 2.4;                                  // 崖脚碎石坡
    else if (b <= 97) h = 5 + (b - 86) / 11 * 15;                                     // 石崖
    else if (b <= 103) h = 20 + Math.sin((b - 97) / 6 * Math.PI / 2) * 3;            // 崖顶圆转
    else h = 23 + (b - 103) * .04 + ripple;
    if (north) h = 1.4 + (h - 1.4) * .5;                                                // 北岸（靖江）地势低平
  }
  const zw = z + center;   // 山丘按世界坐标放置
  // 南岸：黄山（高约 92 米）、肖山、长山、巫山；东侧弯道内侧山嘴遮挡下游出生点。北岸低平，仅有零星土丘。
  const R = RIVER_HALF, onLand = smooth(75, 120, a);   // 山丘只叠加在岸上，不进入江面
  let hills = 0;
  if (z > 0) hills += hill(x, zw, -380, R + 165, 430, 175, 68) + hill(x, zw, 120, R + 150, 200, 130, 36) + hill(x, zw, 560, R + 165, 260, 155, 52)
    + hill(x, zw, 1180, R + 280, 300, 170, 48) + hill(x, zw, -1050, R + 300, 260, 160, 30) + hill(x, zw, 1560, 1220, 280, 200, 58);
  else hills += hill(x, zw, -700, -(R + 300), 220, 120, 10) + hill(x, zw, 1600, -600, 300, 180, 45)   // 北岸弯道处土岗：遮挡下游出生点
    + hill(x, zw, -260, -(R + 230), 200, 130, 30) + hill(x, zw, 380, -(R + 200), 140, 100, 20);        // 八圩港炮台、北岸机枪堡所在土岗
  h += hills * onLand;
  return h;
}

export const isWater = (x, z) => groundHeight(x, z) < 0;

// 开战前江面无沉船；自沉阻塞船在第二阶段前由游戏逐艘加入（blockshipZone）
export const JIANGYIN_WRECK_ZONES = Object.freeze([]);

export function insideWreck(x, z, margin = 0, extra = []) {
  return [...JIANGYIN_WRECK_ZONES, ...extra].some(r => x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin);
}

// 自沉封江：我军阻塞船先停泊在堵塞点上游（西侧）两岸锚地，开始后四散开来，再一艘接一艘顺流驶向最窄处（x≈0）就位、引爆自沉，
// 堵住日舰逆流而上的航道。
// 史载 1937 年 8 月中国海军在江阴自沉“通济”“大同”“自强”“德胜”“威胜”“武胜”等旧舰及征用商轮构筑阻塞线；
// 本关将其改编为第一、二阶段之间的演出，顺序与站位为游戏设定。旗舰“通济”最后自沉，只露出桅顶与烟囱顶。
// heading：舰首朝向（前向 = (-sin h, -cos h)），0 表示沿 -z 横卧江面。
// 史载 8 月 12 日首批自沉 8 艘旧军舰与 20 艘征用商轮，"舰头舰尾呈南北向一字布局"横贯江面。
// 本关按此构筑：28 艘船首尾相接、南北向排成一线（相邻两船前后错开几米以互相搭接），旗舰"通济"居中、最后自沉。
// 军舰名据史料；20 艘商轮的具体船名未逐一核实，统一称"征用商轮"。主尺度为示意值（米）。
const BLOCK_WARSHIPS = [
  ['tongji', '通济（旗舰）', 'flagship', 77, 11], ['datong', '大同', 'gunboat', 64, 9.5], ['ziqiang', '自强', 'gunboat', 64, 9.5],
  ['desheng', '德胜', 'gunboat', 56, 8.5], ['weisheng', '威胜', 'gunboat', 56, 8.5], ['wusheng', '武胜', 'gunboat', 40, 6.5],
  ['chenzi', '辰字', 'gunboat', 44, 5.2], ['suzi', '宿字', 'gunboat', 44, 5.2],
];
function buildBlockships() {
  const rnd = (() => { let v = 1937; return () => (v = (v * 16807) % 2147483647) / 2147483647; })();
  // 征用船只：远洋货轮、尾机近海货船、白色多层江轮、双烟囱旧客轮、木质盐船/帆船，大小与外形各不相同
  const VARIANTS = [
    ['steamer', '货轮', 62, 34, 8.6, 3.4], ['coaster', '近海货船', 40, 18, 7.2, 2], ['river', '江轮', 52, 26, 10.5, 3],
    ['liner', '旧客轮', 78, 18, 11, 2.5], ['junk', '盐船', 22, 12, 5.6, 1.6]];
  const plan = ['steamer', 'river', 'junk', 'coaster', 'steamer', 'liner', 'junk', 'river', 'coaster', 'steamer',
    'junk', 'river', 'steamer', 'coaster', 'liner', 'junk', 'steamer', 'river', 'coaster', 'junk'];
  const tally = {};
  const merchants = plan.map((variant, i) => {
    const [, label, base, spread, beamBase, beamSpread] = VARIANTS.find(v => v[0] === variant);
    tally[variant] = (tally[variant] ?? 0) + 1;
    return [`merchant-${i + 1}`, `征用${label}${tally[variant]}号`, 'merchant', Math.round(base + rnd() * spread),
      Math.round((beamBase + rnd() * beamSpread) * 10) / 10, variant];
  });
  // 沿 z 由北向南排布：通济在中央，其余军舰与商轮交错分布
  const others = [...BLOCK_WARSHIPS.slice(1), ...merchants];
  const ordered = [];
  others.forEach((ship, i) => (i % 2 ? ordered.push(ship) : ordered.unshift(ship)));
  ordered.splice(Math.floor(ordered.length / 2), 0, BLOCK_WARSHIPS[0]);
  const total = ordered.reduce((sum, ship) => sum + ship[3], 0), span = 2 * RIVER_HALF + 10;
  const overlap = (total - span) / (ordered.length - 1);           // 相邻船首尾搭接长度
  let cursor = -RIVER_HALF - 5;
  const placed = ordered.map(([id, name, kind, length, beam, variant], index) => {
    const z = cursor + length / 2; cursor += length - overlap;
    const x = (index % 2 ? 7 : -7) + (rnd() - .5) * 3;
    // 船首指向较近的一岸：每艘船都从江心一侧转入就位点，按船首方向航行，不横移
    const heading = (z < 0 ? 0 : Math.PI) + (rnd() - .5) * .08;
    const depth = kind === 'flagship' ? 11.5 : variant === 'junk' ? 3 + rnd() : 5 + rnd() * 1.5;
    return { id, name, kind, variant: variant ?? kind, length, beam, slot: [Math.round(x * 10) / 10, Math.round(z * 10) / 10, heading], depth, flagship: kind === 'flagship' || undefined };
  });
  // 自沉顺序：由两岸向江心交替，旗舰最后
  const order = [];
  const rest = placed.filter(ship => !ship.flagship).sort((p, q) => Math.abs(q.slot[1]) - Math.abs(p.slot[1]));
  const northSide = rest.filter(ship => ship.slot[1] < 0), southSide = rest.filter(ship => ship.slot[1] >= 0);
  while (northSide.length || southSide.length) { if (northSide.length) order.push(northSide.shift()); if (southSide.length) order.push(southSide.shift()); }
  order.push(placed.find(ship => ship.flagship));
  // 锚地：堵塞点上游（西侧，君山方向）两岸浅水区，每岸两列；开始后四散到锚地与堵塞线之间的江面等待，再依次顺流驶向最窄处
  const count = { north: 0, south: 0 };
  return order.map(ship => {
    const side = ship.slot[1] < 0 ? -1 : 1, key = side < 0 ? 'north' : 'south', k = ship.flagship ? 0 : count[key]++;
    const start = ship.flagship ? [-900, 0] : k < 1 ? [-210, side * (RIVER_HALF - 240)] : [-1060 + (k % 7) * 45, side * (RIVER_HALF - 170 - Math.floor(k / 7) * 110)];   // 每岸第一艘已在堵塞线附近待命
    const hold = ship.flagship ? [-420, 0] : [(k < 2 ? -260 : -520) + ((k * 53) % 160), side * (90 + ((k * 97) % 430))];   // 头两艘先行等在近处，演出中能看到它们就位自沉
    return { ...ship, start, hold };
  });
}
export const BLOCKSHIPS = Object.freeze(buildBlockships().map(ship => Object.freeze({ ...ship, start: Object.freeze(ship.start), hold: Object.freeze(ship.hold), slot: Object.freeze(ship.slot) })));
export function blockshipZone(ship, margin = 2) {
  const [x, z, heading] = ship.slot, c = Math.abs(Math.cos(heading)), s = Math.abs(Math.sin(heading));
  const halfX = (ship.beam * c + ship.length * s) / 2 + margin, halfZ = (ship.length * c + ship.beam * s) / 2 + margin;
  return Object.freeze({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ });
}

export function shipRoute(laneZ) {
  if (!Number.isFinite(laneZ)) throw new RangeError('Ship lane must be finite');
  const c = riverCenter;
  return [
    { x: JIANGYIN_RULES.spawnX, z: c(JIANGYIN_RULES.spawnX) + laneZ * .5 },
    { x: 1450, z: c(1450) + laneZ * .6 },
    { x: 1250, z: c(1250) + laneZ * .8 },
    { x: 950, z: laneZ },
    { x: 600, z: laneZ * .6 },
    { x: 200, z: laneZ * .3 },
    { x: -200, z: laneZ * .3 },
    { x: -600, z: laneZ * .3 },
    { x: JIANGYIN_RULES.breakthroughX - 40, z: laneZ * .3 },
  ];
}

export function landingPoint(bank, random = Math.random) {
  if (!['north', 'south'].includes(bank)) throw new RangeError(`Unknown bank: ${bank}`);
  const sign = bank === 'south' ? 1 : -1;
  return { x: 220 + random() * 520, z: sign * (RIVER_HALF - 3) };
}

export function createJiangyinState() {
  // phase：intro → naval（江面决战）→ scuttle（自沉封江）→ hold（死守两岸 5 分钟）→ ended
  return { phase: 'intro', introTime: 0, navalTime: 0, scuttleTime: 0, elapsed: 0, navalIndex: 0, waveIndex: 0, outcome: null,
    stats: { shipsSunk: 0, landingSunk: 0, infantryKilled: 0, tanksDestroyed: 0, planesDowned: 0, shots: 0, transfers: 0 } };
}

export function dueWaves(state) {
  const due = [];
  while (state.waveIndex < JIANGYIN_WAVES.length && JIANGYIN_WAVES[state.waveIndex].at <= state.elapsed)
    due.push(JIANGYIN_WAVES[state.waveIndex++]);
  return due;
}

export function dueNavalWaves(state) {
  const due = [];
  while (state.navalIndex < NAVAL_WAVES.length && NAVAL_WAVES[state.navalIndex].at <= state.navalTime)
    due.push(NAVAL_WAVES[state.navalIndex++]);
  return due;
}

// 第一阶段：三舰全部沉没 → 'scuttle'；两岸阵地全毁 → 失败。第二阶段（hold）：坚守 5 分钟或击退全部波次 → 胜利。
export function navalPhaseOver(shipsAfloat) { return shipsAfloat <= 0; }
export function evaluateOutcome({ elapsed, shoreAlive, wavesRemaining, enemiesAlive }) {
  if (shoreAlive <= 0) return { result: 'defeat', reason: 'batteries' };
  if (wavesRemaining === 0 && enemiesAlive === 0) return { result: 'victory', reason: 'repelled' };
  if (elapsed >= JIANGYIN_RULES.durationSeconds) return { result: 'victory', reason: 'held' };
  return null;
}

// “附身”切换：按顺序寻找下一个存活火力点；全部失守时返回 null。
export function nextPostId(posts, currentId, step = 1) {
  if (![1, -1].includes(step)) throw new RangeError('Post step must be 1 or -1');
  const count = posts.length;
  if (!count) return null;
  const index = posts.findIndex(post => post.id === currentId);
  const start = index >= 0 ? index : step === 1 ? -1 : 0;
  for (let n = 1; n <= count; n++) {
    const candidate = posts[((start + step * n) % count + count) % count];
    if (candidate.health > 0) return candidate.id;
  }
  return null;
}
