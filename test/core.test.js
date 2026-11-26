import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCapture, makeObjectives, CAPTURE_SECONDS, DOMINATION_SECONDS, createConquest, advanceConquest, circleBlocked, segmentClear, moveGround, createNavigator, setMapBounds, blastDamage, nextAlive, canDeploySquad, shotState, TYPES } from '../src/core.js';
import { INFANTRY_WEAPONS } from '../src/rifle-action.js';

test('asymmetric map bounds support collision and detours in the expanded west without changing default maps', () => {
  const obstacles = [{ minX: -122, maxX: -121, minZ: -2, maxZ: 2 }];
  assert.equal(circleBlocked(-125, 0, .4, obstacles), true);
  try {
    setMapBounds({ minX: -140, maxX: 108, minZ: -108, maxZ: 108 });
    assert.equal(circleBlocked(-125, 0, .4, obstacles), false);
    assert.equal(circleBlocked(-139.8, 0, .4, obstacles), true);
    const navigate = createNavigator(obstacles, 1, .4);
    const start = { x: -125, z: 0 }, goal = { x: -118, z: 0 };
    const path = navigate(start, goal);
    assert.ok(path.length && Math.hypot(path.at(-1).x - goal.x, path.at(-1).z - goal.z) < .01);
    let from = start;
    for (const point of path) {
      assert.equal(segmentClear(from, point, .4, obstacles), true);
      from = point;
    }
    obstacles[0].maxZ = -1;
    navigate.refresh({ minX: -123, maxX: -120, minZ: -3, maxZ: 3 });
    assert.ok(navigate(start, goal).length);
  } finally { setMapBounds(); }
  assert.equal(circleBlocked(-125, 0, .4, obstacles), true);
});

test('batched navigation regions preserve the exact paths of sequential refreshes after obstacle changes', () => {
  const obstacles = [
    { minX: -6, maxX: -4, minZ: -4, maxZ: 4 },
    { minX: 4, maxX: 6, minZ: -4, maxZ: 4 },
  ];
  const sequential = createNavigator(obstacles), batched = createNavigator(obstacles);
  obstacles[0].maxZ = -1; obstacles[1].minZ = 1;
  const regions = [{ minX: -8, maxX: -2, minZ: -6, maxZ: 6 }, { minX: 2, maxX: 8, minZ: -6, maxZ: 6 }];
  for (const region of regions) sequential.refresh(region);
  batched.refreshMany(regions);
  for (const start of [{ x: -10, z: 0 }, { x: 0, z: -6 }, { x: 10, z: 0 }])
    for (const end of [{ x: 10, z: 0 }, { x: -10, z: 0 }, { x: 0, z: 6 }])
      assert.deepEqual(batched(start, end), sequential(start, end));
});

test('player-facing weapon names are concise and deployment uses the same rifle label as combat', () => {
  assert.equal(INFANTRY_WEAPONS.rifle.name, '中正式步枪');
  assert.equal(INFANTRY_WEAPONS.sniper.name, '狙击步枪');
  assert.equal(TYPES.infantry.weapon, INFANTRY_WEAPONS.rifle.name);
  for (const name of [...Object.values(INFANTRY_WEAPONS).map(profile => profile.name),
    ...Object.values(TYPES).map(type => type.weapon)]) {
    assert.doesNotMatch(name, /风格|比例|样枪/);
  }
});

test('objectives require a full uncontested twelve seconds and do not share mutable state', () => {
  const [point] = makeObjectives();
  assert.equal(advanceCapture(point, CAPTURE_SECONDS / 2, true, false), 'capturing');
  assert.equal(point.progress, .5);
  assert.equal(advanceCapture(point, 10, true, true), 'contested');
  assert.equal(point.progress, .5);
  assert.equal(advanceCapture(point, CAPTURE_SECONDS / 2, true, false), 'captured');
  assert.equal(point.captured, true);
  assert.equal(makeObjectives()[0].progress, 0);
});

test('unattended partial capture decays but owned points persist until actually recaptured', () => {
  const [point] = makeObjectives();
  advanceCapture(point, 6, true, false);
  advanceCapture(point, 6, false, false);
  assert.equal(point.progress, .25);
  advanceCapture(point, 100, false, false);
  assert.equal(point.progress, 0);
  advanceCapture(point, 12, true, false);
  advanceCapture(point, 100, false, false);
  assert.equal(point.progress, 1);
  assert.equal(point.owner, 'friendly');
  advanceCapture(point, 12, false, true);
  assert.equal(point.owner, null);
  assert.equal(point.captured, false);
  advanceCapture(point, 12, false, true);
  assert.equal(point.owner, 'enemy');
  assert.equal(point.enemyProgress, 1);
});

test('both teams use identical neutral capture, contested freeze and counterattack rules on all three points', () => {
  for (const team of ['friendly', 'enemy']) for (const point of makeObjectives()) {
    const friendly = team === 'friendly', sign = friendly ? 1 : -1;
    advanceCapture(point, 6, friendly, !friendly);
    assert.equal(point.control, sign * .5);
    assert.equal(point.owner, null);
    assert.equal(advanceCapture(point, 100, true, true), 'contested');
    assert.equal(point.control, sign * .5);
    advanceCapture(point, 6, friendly, !friendly);
    assert.equal(point.owner, team);
    advanceCapture(point, 6, !friendly, friendly);
    assert.equal(point.owner, team, 'partial neutralization does not immediately transfer ownership');
    advanceCapture(point, 6, false, false);
    assert.equal(point.control, sign * .75, 'abandoned neutralization returns towards its current owner');
    advanceCapture(point, 9, !friendly, friendly);
    assert.equal(point.owner, null);
    advanceCapture(point, 12, !friendly, friendly);
    assert.equal(point.owner, friendly ? 'enemy' : 'friendly');
  }
});

test('all-control victory requires twenty uninterrupted seconds and can be won by either team', () => {
  for (const team of ['friendly', 'enemy']) {
    const points = makeObjectives(), match = createConquest(), friendly = team === 'friendly';
    for (const point of points) advanceCapture(point, 12, friendly, !friendly);
    assert.equal(advanceConquest(match, points, 19, 500), null);
    advanceCapture(points[1], 1, true, true);
    assert.equal(advanceConquest(match, points, 1, 499), null);
    assert.equal(match.dominationTime, 0);
    advanceCapture(points[1], 0, friendly, !friendly);
    assert.equal(advanceConquest(match, points, DOMINATION_SECONDS, 479), team);
    assert.equal(advanceConquest(match, points, 10, 469), team, 'results do not change after match end');
  }
});

test('a lone counterattacker interrupts all-control timing before the point is neutralized', () => {
  const points = makeObjectives(), match = createConquest();
  for (const point of points) advanceCapture(point, 12, true, false);
  advanceConquest(match, points, 19.9, 500);
  advanceCapture(points[0], .2, false, true);
  assert.equal(points[0].owner, 'friendly');
  assert.equal(advanceConquest(match, points, .2, 499.8), null);
  assert.equal(match.dominationTime, 0);
});

test('30/60/144Hz preserve twelve-second capture and twenty-four-second countercapture thresholds', () => {
  for (const fps of [30, 60, 144]) {
    const [point] = makeObjectives(), dt = 1 / fps;
    for (let frame = 0; frame < 12 * fps - 1; frame++) advanceCapture(point, dt, true, false);
    assert.equal(point.owner, null);
    for (let frame = 0; frame < 2; frame++) advanceCapture(point, dt, true, false);
    assert.equal(point.owner, 'friendly');
    for (let frame = 0; frame < 24 * fps - 1; frame++) advanceCapture(point, dt, false, true);
    assert.notEqual(point.owner, 'enemy');
    for (let frame = 0; frame < 2; frame++) advanceCapture(point, dt, false, true);
    assert.equal(point.owner, 'enemy');
  }
});

test('timeout compares current ownership then point-seconds with an explicit draw', () => {
  const points = makeObjectives(), match = createConquest();
  advanceCapture(points[0], 12, true, false);
  advanceConquest(match, points, 10, 1);
  advanceCapture(points[1], 12, false, true);
  assert.equal(advanceConquest(match, points, 1, 0), 'friendly');
  const tied = createConquest();
  assert.equal(advanceConquest(tied, points, 0, 0), 'draw');
  advanceCapture(points[2], 12, false, true);
  assert.equal(advanceConquest(createConquest(), points, 0, 0), 'enemy');
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => advanceCapture(points[0], dt, true, false), RangeError);
});

test('collision permits wall sliding but never tunnels through buildings', () => {
  const walls = [{ minX: 2, maxX: 5, minZ: -5, maxZ: 5 }];
  assert.equal(circleBlocked(1.7, 0, .5, walls), true);
  const position = { x: 0, z: 0 };
  moveGround(position, 20, 0, .5, walls);
  assert.ok(position.x < 1.6);
  moveGround(position, 0, 10, .5, walls);
  assert.ok(position.z > 9);
  moveGround(position, 20, 0, .5, walls);
  assert.ok(position.x > 15);
  assert.equal(circleBlocked(108, 0, .5, []), true);
});

test('explosion damage falls off and has no effect outside radius', () => {
  assert.equal(blastDamage(0, 10, 160), 160);
  assert.equal(blastDamage(5, 10, 160), 80);
  assert.equal(blastDamage(10, 10, 160), 0);
  assert.equal(blastDamage(20, 10, 160), 0);
});

test('navigation finds the bridge corridor and never crosses solid cells', () => {
  const obstacles = [
    { minX: -108, maxX: 0, minZ: -21, maxZ: -11 },
    { minX: 16, maxX: 108, minZ: -21, maxZ: -11 },
    { minX: -1, maxX: 1, minZ: -22, maxZ: -10 },
    { minX: 15, maxX: 17, minZ: -22, maxZ: -10 },
  ];
  const findPath = createNavigator(obstacles);
  const path = findPath({ x: -10, z: 0 }, { x: -10, z: -40 });
  assert.ok(path.length > 0);
  const samples = [];
  let start = { x: -10, z: 0 };
  for (const end of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / .2));
    for (let i = 0; i <= steps; i++) samples.push({ x: start.x + (end.x - start.x) * i / steps, z: start.z + (end.z - start.z) * i / steps });
    start = end;
  }
  assert.ok(samples.some(p => p.z <= -12 && p.z >= -20 && p.x >= 1.46 && p.x <= 14.54));
  for (const p of samples) assert.equal(circleBlocked(p.x, p.z, .46, obstacles), false);
  const last = path.at(-1);
  assert.ok(Math.hypot(last.x + 10, last.z + 40) <= 3);
});

test('squad switching skips casualties and reports a wiped squad', () => {
  assert.equal(nextAlive([{ health: 100 }, { health: 0 }, { health: 70 }], 0), 2);
  assert.equal(nextAlive([{ health: 0 }, { health: 0 }], 0), -1);
});

test('cached navigation edges still detect thin walls between clear grid endpoints', () => {
  const walls = [{ minX: .36, maxX: .39, minZ: -1.2, maxZ: 1.2 }];
  const navigate = createNavigator(walls, .75, .1);
  const start = { x: 0, z: 0 }, goal = { x: .75, z: 0 };
  assert.equal(circleBlocked(start.x, start.z, .1, walls), false);
  assert.equal(circleBlocked(goal.x, goal.z, .1, walls), false);
  const path = navigate(start, goal);
  assert.ok(path.length > 1);
  let previous = start;
  for (const point of path) { assert.equal(segmentClear(previous, point, .1, walls), true); previous = point; }
  walls[0].minZ = 4; walls[0].maxZ = 5;
  navigate.refresh({ minX: -1, maxX: 2, minZ: -2, maxZ: 6 });
  assert.deepEqual(navigate(start, goal), [goal], 'local edge cache invalidates when an obstacle moves');
});

test('a new squad is available only at match start or after every member has died', () => {
  const survivors = [{ health: 0 }, { health: 1 }, { health: 0 }, { health: 0 }];
  const wiped = survivors.map(() => ({ health: 0 }));
  assert.equal(canDeploySquad('menu', []), true);
  for (const state of ['playing', 'pause', 'victory', 'defeat']) {
    assert.equal(canDeploySquad(state, survivors), false);
    assert.equal(canDeploySquad(state, wiped), false);
  }
  assert.equal(canDeploySquad('dead', survivors), false);
  assert.equal(canDeploySquad('dead', wiped), true);
  assert.equal(canDeploySquad('dead', []), false);
  assert.equal(nextAlive(survivors, 0), 1);
});

test('all weapon types respect cadence, magazine and automatic reload', () => {
  for (const [type, settings] of Object.entries(TYPES)) {
    const unit = { type, ammo: settings.magazine, nextShot: 0, reloadUntil: 0 };
    assert.equal(shotState(unit, 0, true), true);
    assert.equal(unit.ammo, settings.magazine - 1);
    assert.equal(shotState(unit, .01, true), false);
    if (type === 'tank') {
      assert.equal(unit.reloadUntil, settings.reload, 'the cannon reload starts on the shot, not on the next trigger');
      assert.equal(shotState(unit, settings.reload - .001, false), false);
      assert.equal(unit.ammo, 0);
      assert.equal(shotState(unit, settings.reload, false), false);
      assert.equal(unit.ammo, 1);
      assert.equal(unit.reloadUntil, 0);
      assert.equal(shotState(unit, settings.reload, true), true);
      assert.equal(unit.reloadUntil, settings.reload * 2);
      continue;
    }
    unit.ammo = 0;
    assert.equal(shotState(unit, 1, true), false);
    assert.equal(unit.reloadUntil, 1 + settings.reload);
    assert.equal(shotState(unit, 1.1, true), false);
    assert.equal(shotState(unit, unit.reloadUntil, false), false);
    assert.equal(unit.ammo, settings.magazine);
    assert.equal(unit.reloadUntil, 0);
  }
});
