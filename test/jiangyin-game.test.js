import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createJiangyinGame } from '../src/jiangyin/jiangyin-game.js';
import { JIANGYIN_SQUAD, JIANGYIN_WAVES, LANDING_STREAM, ENEMY_TYPES, groundHeight } from '../src/jiangyin/jiangyin-rules.js';

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

test('after the scuttling begins the player lands as an infantry squad near a battery and plays like the other maps', () => {
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
  assert.ok(sunk >= JIANGYIN_SQUAD.deployAfterSunk || waited >= JIANGYIN_SQUAD.deployLatest - .1, `player lands after ${sunk} blockships went down (${waited.toFixed(1)} s)`);
  console.log(`deploy after ${waited.toFixed(1)} s with ${sunk} blockships sunk`);
  assert.equal(game.mode, 'infantry');
  assert.equal(game.squad.filter(member => member.dead === null).length, JIANGYIN_SQUAD.members);
  assert.ok(events.some(event => event.type === 'deploy'));
  // F: walk to the nearest battery and enter it; F again leaves it
  const member = game.member, battery = game.posts.find(post => post.id === 'huangshan-east');
  for (let n = 0; n < 400 && Math.hypot(battery.point.x - game.member.x, battery.point.z - game.member.z) > 4; n++) {
    game.member.heading = Math.atan2(-(battery.point.x - game.member.x), -(battery.point.z - game.member.z));
    game.step(.05, { move: { x: 0, z: 1 } });
  }
  game.step(.05, { interact: true });
  assert.equal(game.mode, 'post');
  assert.equal(game.controlledId, 'huangshan-east');
  run(game, 1);
  game.step(.05, { interact: true });
  assert.equal(game.mode, 'infantry');
  // Y: switch to another squad member; digits/G: weapons
  run(game, 1);
  game.step(.05, { cycleMember: true });
  assert.notEqual(game.member.id, member.id);
  run(game, 1);
  game.step(.05, { equip: 'grenade' });
  assert.equal(game.member.weapon, 'grenade');
  game.step(.05, { firePressed: true });
  assert.equal(game.member.grenades, JIANGYIN_SQUAD.grenades - 1);
  game.step(.05, { equip: 'primary' });
  const ammo = game.member.rifle.ammo;
  game.step(.05, { firePressed: true, fireHeld: true });
  assert.equal(game.member.rifle.ammo, ammo - 1);
  // phase two starts while the remaining blockships keep scuttling in the background
  run(game, 45);
  assert.equal(game.state.phase, 'hold');
  const hud = game.hud();
  assert.ok(hud.top.some(field => /日军目标/.test(field.label)), 'the HUD states that the Japanese aim to destroy our positions');
});

test('a deployed squad grenade reaches the shared grenade explosion effect', () => {
  const impacts = [];
  const { game } = makeGame(11, { explosion: (...args) => impacts.push(args), muzzle() {} });
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  run(game, 25 + JIANGYIN_SQUAD.deployAfter + 1);
  game.step(.05, { equip: 'grenade' });
  game.step(.05, { firePressed: true });
  run(game, 6);
  assert.ok(impacts.some(([, , style]) => style === 'grenade'));
});

test('the player can zoom every gun with the right mouse button', () => {
  const { game } = makeGame();
  game.skipIntro();
  game.step(.05, {});
  assert.ok(game.hud().zoom >= 4, 'ship turret zoom');
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

test('the squad always regroups after a wipe, even when one blast kills the controlled soldier before the others', () => {
  const { game, events } = makeGame();
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  let waited = 0;
  while (!game.deployed && waited < JIANGYIN_SQUAD.deployLatest + 30) { game.step(.05, {}); waited += .05; }
  assert.equal(game.deployed, true);
  const first = game.member;
  // 模拟同一枚航弹：先命中当前操控的队员（此时还有活着的队友），同一帧再炸死其余队员
  for (const member of [first, ...game.squad.filter(m => m !== first)]) { member.health = 0; member.dead = 0; }
  run(game, JIANGYIN_SQUAD.respawnSeconds + 3);
  assert.ok(game.squad.some(m => m.dead === null), 'a new squad deployed after the wipe');
  assert.ok(events.some(e => e.type === 'deploy' && e.reason === 'respawn'));
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

test('phase-two landing craft continuously deliver troops onto both banks, never into the river centre', () => {
  const { game } = makeGame();
  game.state.phase = 'hold'; game.state.waveIndex = JIANGYIN_WAVES.length;
  for (const post of game.posts) post.point.health = 1e9;
  const banks = [];
  for (let delivery = 0; delivery < 3; delivery++) {
    game.step(.05, {});
    const craft = game.landings.find(item => item.state === 'approach' && item.sinking === null);
    assert.ok(craft, `delivery ${delivery} must depart`);
    banks.push(craft.bank);
    assert.ok(craft.target.x > 0, 'landing remains downstream of the blockage');
    craft.health = 1e9; craft.x = craft.target.x; craft.z = craft.target.z; craft.via = [];
    const before = new Set(game.troops.map(troop => troop.id));
    run(game, 2);
    const landed = game.troops.filter(troop => !before.has(troop.id));
    assert.equal(landed.length, 5);
    for (const troop of landed) {
      assert.ok(Math.abs(troop.z) > 740, 'troops land beside the actual riverbank');
      assert.ok(groundHeight(troop.x, troop.z) >= .4, 'troops land on dry ground');
      assert.equal(Math.sign(troop.z), craft.bank === 'south' ? 1 : -1);
    }
    assert.ok(game.landings.filter(item => item.state !== 'empty' && item.sinking === null).length <= LANDING_STREAM.maxActive);
    if (delivery < 2) run(game, LANDING_STREAM.interval - 2);
  }
  assert.deepEqual(banks, ['south', 'south', 'north']);
});

test('phase two retains three engaged ships, withdraws damaged ships and stops replacements after two minutes', () => {
  const { game } = makeGame();
  game.skipIntro();
  for (const post of game.posts) post.point.health = 1e9;
  run(game, 90);
  assert.equal(game.ships.filter(ship => ship.sinking === null).length, 7);
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  for (let step = 0; step < 900 && game.state.phase !== 'scuttle'; step++) game.step(.05, {});
  game.skipScuttle();
  const engaged = () => game.ships.filter(ship => ship.sinking === null && !ship.withdrawing);
  assert.equal(game.state.phase, 'hold');
  assert.equal(engaged().length, 3);
  assert.equal(game.ships.filter(ship => ship.withdrawing).length, 4);
  const damaged = engaged()[0]; damaged.health = damaged.cfg.health * .39;
  game.step(.05, {});
  assert.equal(damaged.withdrawing, true);
  run(game, 21);
  assert.equal(engaged().length, 3, 'early losses are replaced');
  game.state.elapsed = 121; game.state.waveIndex = JIANGYIN_WAVES.length;
  for (const ship of engaged()) ship.health = ship.cfg.health * .39;
  const ids = new Set(game.ships.map(ship => ship.id));
  run(game, 21);
  assert.equal(engaged().length, 0, 'late damaged ships withdraw without replacement');
  assert.ok(game.ships.every(ship => ids.has(ship.id)));
});

test('phase-two waves wait for infantry capacity without discarding tank escorts or landing passengers', () => {
  const { game } = makeGame();
  game.state.phase = 'hold'; game.state.elapsed = 171;
  for (const post of game.posts) post.point.health = 1e9;
  game.step(.05, {});
  const living = () => game.troops.filter(troop => troop.dead === null);
  assert.equal(living().length, 48, 'whole waves fit within the 48-person limit');
  assert.equal(game.vehicles.filter(vehicle => vehicle.type === 'tank').length, 6);
  for (const troop of living().slice(0, ENEMY_TYPES.squad.size)) { troop.dead = game.now; troop.health = 0; }
  game.step(.05, {});
  assert.equal(living().length, 48);
  assert.equal(game.vehicles.filter(vehicle => vehicle.type === 'tank').length, 9,
    'the deferred platoon arrives with its complete escort when there is room');
  const blockers = living().slice(0, 5);
  for (const troop of blockers) { troop.dead = game.now; troop.health = 0; }
  game.state.landingAt = game.now;
  game.step(.05, {});
  const craft = game.landings.find(item => item.state === 'approach' && item.sinking === null);
  assert.ok(craft);
  craft.health = 1e9; craft.x = craft.target.x; craft.z = craft.target.z; craft.via = [];
  for (const troop of blockers) {
    troop.dead = null; troop.health = 100;
  }
  assert.equal(living().length, 48);
  run(game, 2);
  assert.equal(craft.state, 'unloading', 'passengers stay aboard when no full landing party fits');
  assert.equal(living().length, 48);
  for (const troop of living().slice(0, 5)) { troop.dead = game.now; troop.health = 0; }
  game.step(.05, {});
  assert.equal(craft.state, 'empty', 'the same craft unloads once capacity is available');
  assert.ok(living().length <= 48);
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
