import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createJiangyinGame } from '../src/jiangyin/jiangyin-game.js';
import { JIANGYIN_SQUAD } from '../src/jiangyin/jiangyin-rules.js';

const stub = point => { const group = new THREE.Group(); group.userData.update = () => {}; return group; };
function makeGame(seed = 11) {
  let value = seed;
  const random = () => (value = (value * 16807) % 2147483647) / 2147483647;
  const events = [];
  const game = createJiangyinGame({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(68, 1.6, .3, 12000),
    createGunModel: stub, quality: 'low', random, onEvent: event => events.push(event) });
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
  run(game, JIANGYIN_SQUAD.deployAfter + 1);
  assert.equal(game.deployed, true);
  assert.equal(game.mode, 'infantry');
  assert.equal(game.squad.filter(member => member.dead === null).length, JIANGYIN_SQUAD.members);
  assert.ok(events.some(event => event.type === 'deploy'));
  // F: walk to the nearest battery and enter it; F again leaves it
  const member = game.member, battery = game.posts.find(post => post.id === 'huangshan-west');
  for (let n = 0; n < 400 && Math.hypot(battery.point.x - game.member.x, battery.point.z - game.member.z) > 4; n++) {
    game.member.heading = Math.atan2(-(battery.point.x - game.member.x), -(battery.point.z - game.member.z));
    game.step(.05, { move: { x: 0, z: 1 } });
  }
  game.step(.05, { interact: true });
  assert.equal(game.mode, 'post');
  assert.equal(game.controlledId, 'huangshan-west');
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
