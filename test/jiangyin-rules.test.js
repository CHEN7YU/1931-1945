import test from 'node:test';
import assert from 'node:assert/strict';
import { RIVER_HALF, JIANGYIN_RULES, JIANGYIN_WAVES, JIANGYIN_POSTS, NAVAL_WAVES, BLOCKSHIPS, blockshipZone, groundHeight, insideWreck, shipRoute, landingPoint,
  createJiangyinState, dueWaves, dueNavalWaves, evaluateOutcome, navalPhaseOver, nextPostId, postFacing, jiangyinObjectives } from '../src/jiangyin/jiangyin-rules.js';

test('historical direction: the Yangtze flows east (+x) and the Japanese advance upstream from +x; before the scuttling the river is open', () => {
  assert.ok(JIANGYIN_RULES.flowSpeed > 0 && /下游/.test(JIANGYIN_RULES.rightLabel) && /上游/.test(JIANGYIN_RULES.leftLabel));
  assert.ok(JIANGYIN_RULES.spawnX > 0 && JIANGYIN_RULES.breakthroughX < 0);
  const route = shipRoute(30);
  assert.equal(route[0].x, JIANGYIN_RULES.spawnX);
  for (const point of route) assert.equal(insideWreck(point.x, point.z), false, 'no barrier exists during the naval phase');
});

test('the scuttled blockships close the whole river at its narrowest point; the flagship sinks last and deepest', () => {
  // 1937 年江阴堵塞线处江面约 1.5 公里
  assert.ok(RIVER_HALF * 2 >= 1400 && RIVER_HALF * 2 <= 1600);
  assert.ok(groundHeight(100, 0) < -10 && groundHeight(100, RIVER_HALF + 40) > 8 && groundHeight(100, -RIVER_HALF - 40) > 8);
  const zones = BLOCKSHIPS.map(ship => blockshipZone(ship));
  assert.equal(BLOCKSHIPS.length, 28, '8 old warships and 20 requisitioned merchant ships');
  for (let z = -RIVER_HALF + 6; z <= RIVER_HALF - 6; z += 3) assert.ok([-6, 0, 6].some(x => insideWreck(x, z, 0, zones)), `barrier closes z=${z}`);
  for (const ship of BLOCKSHIPS) {
    assert.ok(groundHeight(...ship.slot.slice(0, 2)) < 0, `${ship.id} sinks in the river`);
    assert.ok(ship.start[0] < ship.slot[0] - 40 && ship.hold[0] < ship.slot[0], `${ship.id} waits upstream (west) and sails down to the narrows`);
    assert.ok(groundHeight(...ship.start) < -3 && groundHeight(...ship.hold) < -3, `${ship.id} anchors in navigable water`);
  }
  const flagship = BLOCKSHIPS.at(-1);
  assert.ok(flagship.flagship && BLOCKSHIPS.filter(ship => ship.flagship).length === 1);
  assert.ok(BLOCKSHIPS.slice(0, -1).every(ship => ship.depth < flagship.depth));
  for (const bank of ['north', 'south']) {
    const point = landingPoint(bank, () => .5);
    assert.ok(groundHeight(point.x, point.z) < 0 && groundHeight(point.x, point.z) > -2, 'landing craft beach in shallow water');
  }
  assert.throws(() => landingPoint('east'), RangeError);
});

test('shore posts sit on land and face the river', () => {
  for (const post of JIANGYIN_POSTS) {
    if (post.kind === 'ship') { assert.ok(groundHeight(post.x, post.z) < -2); continue; }
    assert.ok(groundHeight(post.x, post.z) > 1);
    const heading = postFacing(post), towardRiver = -Math.cos(heading) * Math.sign(post.z);
    assert.ok(towardRiver < 0, `${post.id} faces the river`);
  }
  assert.equal(jiangyinObjectives().length, JIANGYIN_POSTS.filter(post => post.kind === 'battery').length);
  for (const post of JIANGYIN_POSTS.filter(post => post.kind === 'battery'))
    assert.ok(groundHeight(post.x, post.z) > 40, `${post.id} sits on a hilltop, not at the foot of the slope`);
});

test('three friendly warships fight phase one; the phase ends only when all are fully sunk', () => {
  assert.deepEqual(JIANGYIN_POSTS.filter(post => post.kind === 'ship').map(post => post.id), ['pinghai', 'ninghai', 'yixian']);
  assert.equal(navalPhaseOver(1), false);
  assert.equal(navalPhaseOver(0), true);
  assert.ok(NAVAL_WAVES.every(wave => wave.ships.length && !wave.landing && !wave.infantry), 'phase one is a purely naval battle');
  const state = createJiangyinState();
  state.navalTime = 30;
  assert.equal(dueNavalWaves(state).length, 2);
  assert.equal(dueNavalWaves(state).length, 0);
  assert.equal(JIANGYIN_RULES.durationSeconds, 300, 'phase two lasts five minutes');
});

test('waves release in time order exactly once', () => {
  const state = createJiangyinState();
  state.elapsed = 45;
  assert.equal(dueWaves(state).length, 2);
  assert.equal(dueWaves(state).length, 0);
  state.elapsed = 999;
  assert.equal(dueWaves(state).length, JIANGYIN_WAVES.length - 2);
});

test('outcome: losing every shore battery is defeat; holding five minutes or clearing all waves is victory', () => {
  const base = { elapsed: 10, shoreAlive: 3, wavesRemaining: 4, enemiesAlive: 5 };
  assert.equal(evaluateOutcome(base), null);
  assert.deepEqual(evaluateOutcome({ ...base, shoreAlive: 0 }), { result: 'defeat', reason: 'batteries' });
  assert.deepEqual(evaluateOutcome({ ...base, wavesRemaining: 0, enemiesAlive: 0 }), { result: 'victory', reason: 'repelled' });
  assert.deepEqual(evaluateOutcome({ ...base, elapsed: JIANGYIN_RULES.durationSeconds }), { result: 'victory', reason: 'held' });
});

test('possession switching skips destroyed posts in both directions and reports total loss', () => {
  const posts = [{ id: 'a', health: 10 }, { id: 'b', health: 0 }, { id: 'c', health: 5 }];
  assert.equal(nextPostId(posts, 'a', 1), 'c');
  assert.equal(nextPostId(posts, 'c', 1), 'a');
  assert.equal(nextPostId(posts, 'a', -1), 'c');
  assert.equal(nextPostId(posts, 'missing', 1), 'a');
  assert.equal(nextPostId(posts.map(post => ({ ...post, health: 0 })), 'a', 1), null);
  assert.throws(() => nextPostId(posts, 'a', 2), RangeError);
});

test('enemy attacks by water, land and air: 6 infantry squads, 2 tank platoons, 3 air sections, spawned downstream out of sight', async () => {
  const { LAND_SPAWNS, AIR_SPAWN, riverCenter, JIANGYIN_ADVANCE_GUARD } = await import('../src/jiangyin/jiangyin-rules.js');
  const total = key => JIANGYIN_WAVES.reduce((sum, wave) => sum + (Array.isArray(wave[key]) ? wave[key].length : wave[key]), 0);
  assert.equal(total('infantry') + JIANGYIN_ADVANCE_GUARD.infantry.length, 6);
  assert.equal(total('tanks'), 2);
  assert.equal(total('air'), 3);
  for (const spawn of Object.values(LAND_SPAWNS)) {
    assert.ok(groundHeight(spawn.x, spawn.z) > 15, 'land units start on the bank plateau');
    for (const post of JIANGYIN_POSTS) assert.ok(spawn.x - post.x > 250, 'land spawns are far upstream of every player post');
  }
  assert.ok(AIR_SPAWN.x > JIANGYIN_RULES.spawnX && AIR_SPAWN.y > 100);
  assert.ok(riverCenter(JIANGYIN_RULES.spawnX) > 100, 'the river bends so ships appear behind the bend');
  for (const post of JIANGYIN_POSTS) assert.ok(post.x < JIANGYIN_RULES.spawnX - 250, 'player posts are downstream of the enemy');
});

test('phase one deployment runs west to east: blockships, then our three ships, then the Japanese fleet', async () => {
  const { JIANGYIN_MOUNTS, JIANGYIN_SQUAD } = await import('../src/jiangyin/jiangyin-rules.js');
  const ours = JIANGYIN_POSTS.filter(post => post.kind === 'ship');
  const westmostShip = Math.min(...ours.map(post => post.x)), eastmostShip = Math.max(...ours.map(post => post.x));
  for (const ship of BLOCKSHIPS) assert.ok(ship.start[0] < westmostShip, `${ship.id} anchors west of our warships`);
  assert.ok(shipRoute(0)[0].x > eastmostShip + 1000, 'the Japanese fleet enters from the east');
  for (const post of ours) assert.ok(Math.abs(post.heading + Math.PI / 2) < 1e-9, `${post.id} starts bow-east toward the enemy`);
  for (const mount of ['shipTurret', 'coastal', 'flak88']) assert.equal(JIANGYIN_MOUNTS[mount].reserve, 75, `${mount} carries 75 shells`);
  assert.equal(JIANGYIN_SQUAD.members, 11, 'phase two uses the default 11-man infantry squad');
  assert.equal(JIANGYIN_SQUAD.deployAfter, 10, 'the player watches the scuttling for 10 seconds before landing');
});

test('trenches in front of the batteries and MG nests are dug a full man deep into the hill', async () => {
  const rules = await import('../src/jiangyin/jiangyin-rules.js');
  const trenches = rules.jiangyinTrenches();
  assert.ok(trenches.length >= 5, 'one trench per coastal battery and MG nest');
  for (const trench of trenches) {
    let deepest = 0;
    for (const [x, z] of trench.points) {
      deepest = Math.max(deepest, rules.naturalGroundHeight(x, z) - rules.groundHeight(x, z));
    }
    assert.ok(deepest >= 1.6, `trench at ${trench.postId} only ${deepest.toFixed(2)} m deep`);
  }
});
