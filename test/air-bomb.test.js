import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEnemyAirFlight, takeAirBombDrop } from '../src/air-support.js';
import { createJiangyinGame } from '../src/jiangyin/jiangyin-game.js';
import { emitExplosionParticles, createParticleState } from '../src/combat-particles.js';
import { BLAST_PROFILES } from '../src/blast-profiles.js';

test('one bomb per airframe, withheld at the opening and against dispersed or protected troops', () => {
  const flight = createEnemyAirFlight(0, 0);
  const plane = { x: 0, y: 40, z: 0 };
  const squad = Array.from({ length: 5 }, (_, i) => ({ health: 100, position: { x: i, y: 0, z: 0 } }));
  const drop = (time, actors, extra) => takeAirBombDrop(flight, time, plane, actors,
    { allowed: () => true, visible: () => true, ...extra });
  assert.equal(drop(10, squad), null);
  assert.equal(drop(25, squad.slice(1)), null);
  assert.equal(drop(26, squad, { visible: point => point.x !== 4 }), null);
  assert.equal(drop(27, squad, { allowed: () => false }), null);
  assert.equal(drop(27.5, [...squad.slice(1), { ...squad[0], civilian: {} }]), null);
  assert.deepEqual(drop(28, squad), squad[0].position);
  assert.equal(drop(60, squad), null);
});

test('Jiangyin air wave uses one-time inventory and can fire its gun with no viable bomb target', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const events = [];
  const game = createJiangyinGame({ scene, camera, quality: 'low', random: () => .5,
    createGunModel: () => new THREE.Group(), onEvent: event => events.push(event) });
  game.state.phase = 'hold';
  game.state.elapsed = 40;
  game.state.waveIndex = 1;
  game.step(.05);
  const planes = game.vehicles.filter(vehicle => vehicle.type === 'plane');
  assert.equal(planes.length, 3);
  assert.ok(planes.every(plane => plane.aiFlight.bombAvailable && plane.aiFlight.bombReadyAt > 25));

  const plane = planes[0];
  const post = game.posts.find(post => post.id === plane.patrolPostId);
  const health = post.point.health;
  // Isolate an attack pass over one occupied position, not a full campaign simulation.
  plane.aiFlight.bombReadyAt = 0;
  plane.position.set(post.point.x + 65, post.floor + 25, post.point.z);
  plane.heading = Math.PI / 2;
  plane.pitch = Math.atan2(1.2 - 25, 65);
  plane.aiFlight.targetId = post.id;
  plane.aiFlight.phase = 'approach';
  plane.aiFlight.returningToArea = false;
  game.step(.05);
  assert.ok(events.some(event => event.type === 'sound' && event.name === 'mg'));
  assert.ok(post.point.health < health);
  assert.equal(plane.aiFlight.bombAvailable, true);
  assert.ok(!events.some(event => event.type === 'toast' && event.text === '敌机投弹！寻找掩护'));
});

test('aircraft bombing renders a visibly larger flash and longer smoke than a demolition pack', () => {
  const emit = style => {
    const state = createParticleState();
    emitExplosionParticles(state, { x: 0, y: 0, z: 0 }, 1, { style, radius: BLAST_PROFILES[style].radius });
    return state.clouds;
  };
  const bomb = emit('aircraft-bomb'), pack = emit('explosive-pack');
  const flash = clouds => clouds.find(cloud => cloud.kind === 'blast-flash').size;
  const smoke = clouds => Math.max(...clouds.filter(cloud => cloud.kind === 'blast-smoke').map(cloud => cloud.life));
  assert.ok(flash(bomb) > flash(pack) * 2);
  assert.ok(smoke(bomb) > smoke(pack) * 1.5);
});
