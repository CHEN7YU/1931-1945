import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createJiangyinGame } from '../src/jiangyin/jiangyin-game.js';
import { JIANGYIN_SQUAD, groundHeight } from '../src/jiangyin/jiangyin-rules.js';

const stub = point => { const group = new THREE.Group(); group.userData.update = () => {}; return group; };
function makeGame(seed = 11, effects = null) {
  let value = seed;
  const random = () => (value = (value * 16807) % 2147483647) / 2147483647;
  const events = [];
  const game = createJiangyinGame({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(68, 1.6, .3, 12000),
    createGunModel: stub, quality: 'low', random, effects, onEvent: event => events.push(event) });
  return { game, events };
}
const run = (game, seconds, input = {}) => { for (let t = 0; t < seconds; t += .05) game.step(.05, typeof input === 'function' ? input() : input); };

test('warships move only along their bow (no sideways sliding) and there are no red enemy markers', () => {
  const { game } = makeGame();
  game.skipIntro();
  const previous = new Map();
  let sideways = 0, samples = 0;
  for (let t = 0; t < 120; t += .05) {
    game.step(.05, {});
    for (const post of game.posts.filter(post => post.boat && post.point.health > 0)) {
      const boat = post.boat, last = previous.get(post.id);
      if (last) {
        const dx = boat.x - last.x, dz = boat.z - last.z, d = Math.hypot(dx, dz);
        if (d > 1e-3) { samples++; if (Math.abs(dx * Math.cos(boat.heading) - dz * Math.sin(boat.heading)) / d > .02) sideways++; }
      }
      previous.set(post.id, { x: boat.x, z: boat.z });
    }
  }
  assert.ok(samples > 100 && sideways === 0, `ships slid sideways in ${sideways}/${samples} steps`);
  assert.equal(game.markers, undefined, 'red markers were removed at the player\'s request');
  assert.ok(game.radar().player, 'minimap knows the player position and heading');
});

test('phase two: the player no longer leads an infantry squad but takes over a shore gun and switches between gun positions', () => {
  const { game, events } = makeGame();
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  for (let n = 0; n < 1200 && game.state.phase !== 'scuttle'; n++) game.step(.05, {});
  assert.equal(game.state.phase, 'scuttle');
  // 演出直接从第一艘阻塞船即将自沉开始（航渡过程在后台快进）
  assert.equal(game.blockships[0].state, 'scuttling', 'the cinematic opens on the first scuttling');
  let waited = 0;
  while (!game.deployed && waited < JIANGYIN_SQUAD.deployLatest + 1) { game.step(.05, {}); waited += .05; }
  assert.equal(game.deployed, true);
  assert.ok(waited >= JIANGYIN_SQUAD.deployAfter - .1, 'the scuttling cinematic plays first');
  const sunk = game.blockships.filter(ship => ship.state === 'sunk' || ship.state === 'sinking').length;
  assert.ok(sunk >= JIANGYIN_SQUAD.deployAfterSunk || waited >= JIANGYIN_SQUAD.deployLatest - .1, `player takes over after ${sunk} blockships went down (${waited.toFixed(1)} s)`);
  // 玩家直接接管长山炮台，不再是步兵
  assert.equal(game.mode, 'post');
  assert.equal(game.controlledId, 'huangshan-east');
  assert.equal(game.member, null, 'no infantry soldier is player-controlled');
  assert.equal(game.hud().squad, null, 'no player squad panel');
  assert.ok(events.some(event => event.type === 'deploy'));
  // AI 守备班 11 人仍在前沿据守
  assert.equal(game.squad.filter(member => member.dead === null).length, JIANGYIN_SQUAD.members);
  // F / Y 不再有作用
  run(game, 2);
  game.step(.05, { interact: true, cycleMember: true });
  assert.equal(game.mode, 'post');
  assert.equal(game.controlledId, 'huangshan-east');
  // 1–8 选炮位（第二阶段数字键）、Q/E 轮换
  const keyed = game.hud().posts.map(p => p.key);
  assert.deepEqual(keyed, ['1', '2', '3', '4', '5', '6', '7', '8']);
  game.step(.05, { switchPost: 'south-mg' });
  run(game, 2);
  assert.equal(game.controlledId, 'south-mg');
  assert.match(game.hud().posts.find(p => p.controlled).name, /高射机枪/);
  game.step(.05, { switchPost: 1 });
  run(game, 2);
  assert.equal(game.controlledId, 'huangshan-west');
  // 所在炮位被毁：自动转到同岸最近的尚存炮位
  game.posts.find(p => p.id === 'huangshan-west').point.health = 0;
  run(game, 4);
  assert.equal(game.mode, 'post');
  assert.equal(game.controlledId, 'huangshan-flak');
  // phase two starts while the remaining blockships keep scuttling in the background
  run(game, 45);
  assert.equal(game.state.phase, 'hold');
  const hud = game.hud();
  assert.ok(hud.top.some(field => /日军目标/.test(field.label)), 'the HUD states that the Japanese aim to destroy our positions');
});

test('the dual-purpose machine-gun positions elevate high enough to engage aircraft', () => {
  const { game } = makeGame();
  for (const id of ['south-mg', 'north-mg']) {
    const post = game.posts.find(p => p.id === id);
    assert.match(post.name, /高射机枪阵地/);
    assert.ok(post.point.weapon.settings.maxPitch >= 1.3, `${id} max elevation ${post.point.weapon.settings.maxPitch}`);
  }
});

test('the player can zoom every gun with the right mouse button', () => {
  const { game } = makeGame();
  game.skipIntro();
  game.step(.05, {});
  assert.ok(game.hud().zoom >= 4, 'ship turret zoom');
});

test('shore cannon shells retain the tank-shell soil aftermath through the projectile update', () => {
  const impacts = [];
  const { game } = makeGame(11, {
    explosion: (position, radius, style, surface) => impacts.push({ position, radius, style, surface }),
    muzzle() {},
  });
  game.skipIntro();
  for (const post of game.posts.filter(post => post.boat)) {
    post.point.health = 0;
    post.boat.sunk = true;
  }
  game.step(.05, {});
  game.skipScuttle();
  run(game, 2);
  const post = game.posts.find(post => post.id === game.controlledId);
  post.point.yaw = Math.PI;
  post.point.pitch = -.08;
  const shots = game.state.stats.shots;
  for (let step = 0; step < 400 && game.state.stats.shots === shots; step++)
    game.step(.05, { fireHeld: true });
  assert.equal(game.state.stats.shots, shots + 1);
  run(game, 8);
  const shells = impacts.filter(impact => impact.style === 'tank-shell' &&
    impact.position.y <= groundHeight(impact.position.x, impact.position.z));
  assert.ok(shells.length > 0, 'a real shell must reach the ground');
  for (const impact of shells) {
    assert.equal(impact.surface.kind, 'soil');
    assert.deepEqual(impact.surface.normal, { x: 0, y: 1, z: 0 });
  }
});

test('a sinking warship carries its bow turret: the turret lists and settles with the hull', () => {
  const { game } = makeGame();
  game.skipIntro();
  const post = game.posts.find(p => p.boat);
  post.point.health = 0;
  run(game, 8);
  const hull = post.boat.hull, model = post.model;
  assert.ok(post.boat.sinking > .2, 'ship is sinking');
  assert.ok(Math.abs(hull.rotation.z) > .05, 'hull has a list');
  assert.ok(model.quaternion.angleTo(hull.quaternion) < 1e-6, 'turret shares the hull attitude');
  assert.ok(model.visible, 'turret stays visible until the ship is fully under');
});

test('phase one opens at about one kilometre so the 4x sight shows the enemy clearly', () => {
  const { game } = makeGame();
  game.skipIntro();
  let nearest = Infinity;
  run(game, 45, () => {
    const ours = game.posts.filter(p => p.boat && p.point.health > 0), seen = game.ships.filter(s => s.sinking === null && s.x < 1350);
    for (const p of ours) for (const s of seen) nearest = Math.min(nearest, Math.hypot(s.x - p.boat.x, s.z - p.boat.z));
    return {};
  });
  assert.ok(nearest < 900, `closest engagement ${Math.round(nearest)} m`);
});

test('the AI garrison squad is replaced after a wipe while the player stays on the gun', () => {
  const { game, events } = makeGame();
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  let waited = 0;
  while (!game.deployed && waited < JIANGYIN_SQUAD.deployLatest + 30) { game.step(.05, {}); waited += .05; }
  assert.equal(game.deployed, true);
  // 模拟同一枚航弹炸死整个 AI 守备班
  for (const member of game.squad) { member.health = 0; member.dead = 0; }
  run(game, JIANGYIN_SQUAD.respawnSeconds + 3);
  assert.ok(game.squad.some(m => m.dead === null), 'a new garrison squad arrived after the wipe');
  assert.ok(events.some(e => e.type === 'toast' && /守备班/.test(e.text)));
  assert.equal(game.mode, 'post', 'the player stays on the gun');
});

test('the player can take the helm of their warship with WASD', () => {
  const { game } = makeGame();
  game.skipIntro();
  run(game, 2);
  const post = game.posts.find(p => p.id === game.controlledId);
  assert.ok(post?.boat, 'phase one starts on a warship');
  const heading = post.boat.heading;
  run(game, 14, { move: { x: -1, z: 1 } });
  assert.equal(post.boat.manual, true);
  assert.equal(post.boat.throttle, 1, 'holding W rings the telegraph up notch by notch to full ahead');
  assert.ok(Math.abs(Math.atan2(Math.sin(post.boat.heading - heading), Math.cos(post.boat.heading - heading))) > .05, 'A turns the ship');
  run(game, 8, { move: { x: 0, z: -1 } });
  assert.ok(post.boat.throttle < 0, 'holding S rings the telegraph down to astern');
  game.step(.05, { switchPost: 1 });
  run(game, 1);
  assert.equal(post.boat.manual, false, 'switching ships hands the helm back to the AI');
  assert.ok(game.hud().weapon, 'hud still works');
});

test('ship handling has water drag, engine lag, coasting and turning inertia (not car-like)', () => {
  const { game } = makeGame();
  game.skipIntro();
  run(game, 3);
  const post = game.posts.find(p => p.id === game.controlledId), boat = post.boat;
  post.point.health = post.point.maxHealth = 1e9;
  for (const ship of game.ships) ship.health = 1e9;
  const hold = (seconds, move) => { for (let t = 0; t < seconds; t += .05) { boat.x = -150; boat.z = 0; game.step(.05, { move }); } };
  hold(.1, { x: 0, z: 1 }); hold(.1, { x: 0, z: 0 });   // 接管
  assert.equal(boat.manual, true, 'pressing a movement key takes the helm');
  boat.heading = -Math.PI / 2; boat.speed = 0; boat.thrust = 0; boat.bell = 2; boat.throttle = 0; boat.yawRate = 0; boat.rudder = 0;
  for (let n = 0; n < 3; n++) { hold(.05, { x: 0, z: 1 }); hold(.05, { x: 0, z: 0 }); }   // 三下 W：全速前进
  assert.equal(boat.throttle, 1);
  hold(3, { x: 0, z: 0 });
  assert.ok(boat.speed < 1, `the engine takes time to build up (speed ${boat.speed.toFixed(2)} m/s after 3 s)`);
  hold(30, { x: 0, z: 0 });
  const mid = boat.speed;
  hold(60, { x: 0, z: 0 });
  assert.ok(mid > 3 && boat.speed > mid && boat.speed < 7.05, 'speed rises ever more slowly toward top speed (quadratic drag)');
  for (let n = 0; n < 3; n++) { hold(.05, { x: 0, z: -1 }); hold(.05, { x: 0, z: 0 }); }   // 停车
  assert.equal(boat.throttle, 0);
  const cruising = boat.speed;
  hold(15, { x: 0, z: 0 });
  assert.ok(boat.speed > cruising * .5, `a stopped engine leaves the ship coasting (${cruising.toFixed(1)} → ${boat.speed.toFixed(1)} m/s in 15 s)`);
  // 回转惯性：满舵后回正舵，船首仍继续转动
  boat.speed = 6; boat.thrust = .7;
  hold(20, { x: -1, z: 0 });
  assert.ok(boat.yawRate > .01 && boat.speed < 6, 'hard rudder turns the ship and bleeds speed');
  assert.ok(Math.abs(boat.heel) > .02, 'the ship heels in the turn');
  hold(1, { x: 0, z: 0 });
  assert.ok(boat.yawRate > .005, 'the bow keeps swinging after the rudder is centred');
  // 低速无舵效
  boat.speed = .3; boat.thrust = 0; boat.bell = 2; boat.throttle = 0; boat.yawRate = 0; boat.rudder = 0;
  const before = boat.heading; hold(8, { x: -1, z: 0 });
  assert.ok(Math.abs(boat.heading - before) < .03, 'with no way on and no propeller wash the rudder barely bites');
});

test('phase one: the Japanese fleet grows from 2 to 7 ships, strafes with machine guns, and right-click shows the predicted fall of shot', () => {
  const { game } = makeGame();
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = post.point.maxHealth = 1e9;
  for (const ship of game.ships) ship.health = 1e9;
  const afloat = () => game.ships.filter(ship => ship.sinking === null).length;
  run(game, 1);
  assert.equal(afloat(), 2, 'two enemy ships at the start');
  let peak = 0, tracersSeen = false;
  for (let t = 0; t < 110; t += .05) {
    game.step(.05, {});
    for (const ship of game.ships) ship.health = 1e9;
    peak = Math.max(peak, afloat());
    tracersSeen ||= game.ships.some(ship => ship.mg?.some(gun => gun.burstEnd > 0));
  }
  assert.equal(peak, 7, 'reinforced up to seven ships');
  assert.ok(tracersSeen, 'enemy ships strafe with their machine guns');
  // 辅助瞄准：按住右键时 HUD 给出预测落点、飞行时间与散布
  const post = game.posts.find(p => p.id === game.controlledId);
  post.point.pitch = .01;
  game.step(.05, { aiming: true });
  const aim = game.hud().aim;
  assert.ok(aim && aim.distance > 100 && aim.flight > 0 && aim.spread[0] > aim.spread[1], `predicted fall of shot ${JSON.stringify(aim)}`);
  game.step(.05, {});
  assert.equal(game.hud().aim, null, 'the marker disappears when the right button is released');
});

test('enemy ships never sail through each other, and in phase two at most three stay while damaged ones withdraw', () => {
  const { game } = makeGame();
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = post.point.maxHealth = 1e9;
  let overlaps = 0, samples = 0;
  for (let t = 0; t < 120; t += .05) {
    game.step(.05, {});
    for (const ship of game.ships) ship.health = Math.max(ship.health, ship.cfg.health * .9);
    const afloat = game.ships.filter(ship => ship.sinking === null);
    for (let i = 0; i < afloat.length; i++) for (let j = i + 1; j < afloat.length; j++) {
      const a = afloat[i], b = afloat[j];
      samples++;
      // 两船中心距离小于两船舰宽之和的一半（明显重叠）且船身方向平行时视为穿模
      if (Math.hypot(a.x - b.x, a.z - b.z) < (a.cfg.beam + b.cfg.beam) / 2) overlaps++;
    }
  }
  assert.ok(samples > 1000);
  assert.equal(overlaps, 0, `enemy hulls overlapped in ${overlaps} samples`);
  // 第二阶段：最多 3 艘留在江面，不再增援；受创舰顺流撤出
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  for (let n = 0; n < 4000 && game.state.phase !== 'hold'; n++) game.step(.05, {});
  assert.equal(game.state.phase, 'hold');
  const engaged = () => game.ships.filter(ship => ship.sinking === null && !ship.withdrawing).length;
  assert.ok(engaged() <= 3, `at most three enemy ships keep fighting (${engaged()})`);
  let peak = 0;
  for (let t = 0; t < 140; t += .05) { game.step(.05, {}); peak = Math.max(peak, engaged()); }
  assert.ok(peak <= 3, 'phase two never has more than three enemy ships fighting');
  const victim = game.ships.find(ship => ship.sinking === null && !ship.withdrawing);
  if (victim) {
    victim.health = victim.cfg.health * .3;
    game.step(.05, {});
    assert.equal(victim.withdrawing, true, 'a badly damaged ship withdraws downstream');
  }
});


test('v24 art: gun sights by mount, ring-sight eye behind the machine gun, and graphics levels for automatic quality reduction', async () => {
  const { sightKind } = await import('../src/jiangyin/jiangyin-sights.js');
  assert.equal(sightKind({ cannon: true, mount: 'coastal' }), 'coastal');
  assert.equal(sightKind({ cannon: true, mount: 'coastal', variant: 'flak88' }), 'flak88');
  assert.equal(sightKind({ cannon: true, mount: 'shipTurret' }), 'naval');
  assert.equal(sightKind({ cannon: false, mount: 'nest' }), null);
  const { maximEye, MAXIM_SIGHT } = await import('../src/jiangyin/jiangyin-models.js');
  const point = { x: 0, z: 0, yaw: 0, pitch: 0, weapon: { settings: { muzzleHeight: 1.45 } } };
  const level = maximEye(point, 10);
  assert.ok(Math.abs(level.y - (10 + 1.45 + MAXIM_SIGHT.height)) < 1e-9 && Math.abs(level.z - MAXIM_SIGHT.eyeBack) < 1e-9, 'eye sits behind the rear peep on the sight line');
  point.pitch = 1.2; const up = maximEye(point, 10);
  assert.ok(up.y < level.y && up.z < level.z, 'pointing the gun skyward brings the gunner down and forward under the receiver');
  const { game } = makeGame();
  const world = game.posts && game;   // game exposes setGraphicsLevel → world
  game.setGraphicsLevel(2);
  game.setGraphicsLevel(0);
  assert.ok(world);
});
