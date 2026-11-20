import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createJiangyinGame } from '../src/jiangyin/jiangyin-game.js';
import { JIANGYIN_SQUAD } from '../src/jiangyin/jiangyin-rules.js';
import { applyTerrainGait, terrainStep } from '../src/terrain-gait.js';

const stub = point => { const group = new THREE.Group(); group.userData.update = () => {}; return group; };
function makeGame(seed = 11, effects = null) {
  let value = seed;
  const random = () => (value = (value * 16807) % 2147483647) / 2147483647;
  const events = [];
  const game = createJiangyinGame({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(68, 1.6, .3, 12000),
    createGunModel: stub, effects, quality: 'low', random, onEvent: event => events.push(event) });
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
  run(game, 25);
  assert.equal(game.state.phase, 'scuttle');
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

test('shells striking land use the shared tank-shell ground aftermath', () => {
  const impacts = [];
  const { game } = makeGame(11, { explosion: (...args) => impacts.push(args), muzzle() {} });
  game.skipIntro();
  for (const post of game.posts) if (post.boat) post.point.health = 0;
  run(game, 180);
  assert.ok(impacts.some(([, , style, surface]) => style === 'tank-shell' && surface?.kind === 'soil'),
    'a simulated shell hitting land must carry the tank-shell style and soil surface');
});

test('terrain gait shortens uphill steps, permits gentle downhill speed-up and rejects cliffs', () => {
  const uphill = terrainStep((x) => x * .6, 0, 0, 1, 0, 4, .1);
  const downhill = terrainStep((x) => -x * .3, 0, 0, 1, 0, 4, .1);
  const cliff = terrainStep((x) => x * 2, 0, 0, 1, 0, 4, .1);
  assert.ok(uphill.ok && uphill.horizontal < .4 && uphill.path > uphill.horizontal);
  assert.ok(downhill.ok && downhill.factor > 1);
  assert.equal(cliff.ok, false);

  const actor = { nativeMotion: { strideScale: 1 } };
  applyTerrainGait(actor, uphill.grade);
  assert.ok(actor.nativeMotion.strideScale < 1, 'uphill gait advances through shorter strides');
  applyTerrainGait(actor, 0);
  assert.ok(actor.nativeMotion.strideScale > .93, 'stride scale recovers on level ground');
});
