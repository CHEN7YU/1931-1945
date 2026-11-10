import test from 'node:test';
import assert from 'node:assert/strict';
import { DADAO, DADAO_GRIP, createDadaoState, drawDadao, stowDadao, startDadaoSwing, advanceDadao, dadaoPhase,
  dadaoStroke, dadaoBodyMotion, dadaoSweepDirection, selectDadaoTarget } from '../src/dadao.js';
import { DADAO_DIMENSIONS, dadaoModel, dadaoViewModel, updateDadaoView } from '../src/dadao-model.js';
import { damageForTarget } from '../src/combat-targets.js';
import { createBattleStats, attackCategory } from '../src/battle-stats.js';
import { createControlInput } from '../src/control-input.js';
import { Texture, Vector3 } from 'three';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DADAO_ART_ROOT, DADAO_ART_MAPS, DADAO_CLOTH_TILE_METERS, loadDadaoSurfaces } from '../src/dadao-surface.js';

const manifest = JSON.parse(await readFile(new URL('../public/assets/materials/ai-dadao/source.json', import.meta.url), 'utf8'));
const loaded = [];
const surfaces = await loadDadaoSurfaces(8, { async loadAsync(url) {
  loaded.push(url);
  const file = manifest.files.find(file => url === DADAO_ART_ROOT + file.file);
  assert.ok(file, `Unrecorded material map: ${url}`);
  return new Texture({ src: url, width: file.width, height: file.height });
} });

const actor = { team: 'friendly', position: { x: 0, y: 0, z: 0 } };
const origin = { x: 0, y: 1.3, z: 0 }, forward = { x: 0, y: 0, z: -1 };
const enemy = (id = 'target', x = 0, z = -1.2) => ({ id, team: 'enemy', health: 100,
  position: { x, y: 0, z }, targetKind: 'person' });
const aimPoint = target => ({ ...target.position, y: target.position.y + 1.1 });
function swinging() {
  const state = createDadaoState();
  drawDadao(state, 0); assert.ok(startDadaoSwing(state, .4, 1));
  return state;
}
const middle = .4 + DADAO.windup + DADAO.active / 2;
test('body anticipation and follow-through share the blade phases and settle continuously', () => {
  const pose = (phase, progress) => dadaoBodyMotion({ phase, progress });
  assert.deepEqual(pose('ready', 0), pose('windup', 0));
  assert.deepEqual(pose('windup', 1), pose('cut', 0));
  assert.deepEqual(pose('cut', 1), pose('recover', 0));
  assert.deepEqual(pose('recover', 1), pose('ready', 0));
  assert.ok(pose('windup', 1).yaw < 0);
  assert.ok(pose('cut', 1).yaw > 0);
});
test('first-person cut crosses the view from raised right to low left and has no phase-boundary jump', () => {
  const view = dadaoViewModel();
  const sample = (phase, progress) => {
    updateDadaoView(view, { phase, progress }, { weaponX: 0, weaponY: 0 });
    return view.userData.dadaoHand.localToWorld(new Vector3(.071, .62, 0));
  };
  const raised = sample('windup', 1), finished = sample('cut', 1);
  assert.ok(raised.x - finished.x > .5, 'the real blade, not an exaggerated wrist target, must cross the screen');
  assert.ok(raised.y - finished.y > .8);
  for (const [a, b] of [[['windup', 1], ['cut', 0]], [['cut', 1], ['recover', 0]],
    [['recover', 1], ['ready', 0]]]) assert.ok(sample(...a).distanceTo(sample(...b)) < 1e-8);
});
const select = (state, targets, now = middle, clear = () => true) =>
  selectDadaoTarget(state, now, actor, origin, forward, targets, aimPoint, clear);

test('drawing, windup, active cut, recovery and cooldown are separate; switching cannot reset cooldown', () => {
  const state = createDadaoState();
  assert.equal(startDadaoSwing(state, 0, 1), false);
  drawDadao(state, 0);
  assert.equal(startDadaoSwing(state, .1, 1), false);
  assert.ok(startDadaoSwing(state, .4, 0), 'even an exhausted soldier can swing');
  assert.equal(dadaoPhase(state, .5).phase, 'windup');
  assert.equal(dadaoPhase(state, middle).phase, 'cut');
  assert.equal(dadaoPhase(state, 1).phase, 'recover');
  assert.equal(startDadaoSwing(state, .5, 1), false);
  stowDadao(state); drawDadao(state, .6);
  assert.equal(startDadaoSwing(state, 1, 1), false);
  assert.ok(startDadaoSwing(state, 1.36, 1));
  assert.equal(advanceDadao(state, 2.4).phase, 'ready');
  assert.equal(state.swings, 2);
});

test('a swing hits the nearest exposed enemy only, during the actual sweep, never through a wall or another floor', () => {
  const state = swinging(), victim = enemy();
  assert.equal(select(state, [victim], .5), null);
  assert.equal(select(state, [victim], 1), null);
  assert.equal(select(state, [victim], middle, () => false), null);
  assert.equal(select(state, [enemy('far', 0, -2)]), null);
  assert.equal(select(state, [enemy('behind', 0, 1)]), null);
  assert.equal(select(state, [{ ...victim, team: 'friendly' }]), null);
  assert.equal(select(state, [{ ...victim, health: 0 }]), null);
  assert.equal(select(state, [{ ...victim, vehicleId: 'tank' }]), null);
  assert.equal(select(state, [{ ...victim, targetKind: 'closed-armor' }]), null);
  assert.equal(select(state, [{ ...victim, targetKind: 'aircraft' }]), null);
  assert.equal(select(state, [{ ...victim, position: { x: 0, y: 3, z: -1 } }]), null);
  assert.equal(select(state, [enemy('further', 0, -1.7), victim]), victim);
  state.connected = true;
  assert.equal(select(state, [victim]), null);
  stowDadao(state);
  assert.equal(select(state, [victim]), null);
});

test('blade sweep travels from high right to low left, not across a horizontal instant-hit cone', () => {
  for (const [x, progress] of [[.5, .15], [-.5, .85]]) {
    const state = swinging(), target = enemy('side', x);
    const now = .4 + DADAO.windup + DADAO.active * progress;
    const point = candidate => ({ ...aimPoint(candidate), y: origin.y + x });
    const hit = (at, aim = point) => selectDadaoTarget(state, at, actor, origin, forward, [target], aim, () => true);
    assert.equal(hit(now), target);
    assert.equal(hit(.4 + DADAO.windup + DADAO.active * (1 - progress)), null);
    assert.equal(hit(now, candidate => ({ ...point(candidate), y: origin.y - x })), null, 'opposite diagonal is outside the blade');
  }
});

test('strike direction follows the same eased 45-degree stroke under yaw and pitch', () => {
  for (const yaw of [0, .8, -2]) for (const pitch of [-.65, 0, .65]) {
    const facing = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    const up = { x: Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: Math.cos(yaw) * Math.sin(pitch) };
    let previousSide = Infinity, previousHeight = Infinity;
    for (let frame = 0; frame <= 100; frame++) {
      const direction = dadaoSweepDirection(frame / 100, facing);
      const side = direction.x * right.x + direction.z * right.z;
      const height = direction.x * up.x + direction.y * up.y + direction.z * up.z;
      assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
      assert.ok(Math.abs(side - height) < 1e-12, 'stroke lies in the diagonal plane of the current view');
      assert.ok(side <= previousSide && height <= previousHeight);
      previousSide = side; previousHeight = height;
      if (frame === 50) for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(direction[axis] - facing[axis]) < 1e-12);
    }
  }
  assert.equal(dadaoSweepDirection(.5, { x: 0, y: 1, z: 0 }), null);
  assert.deepEqual(dadaoStroke({ phase: 'windup', progress: 1 }), dadaoStroke({ phase: 'cut', progress: 0 }));
  assert.deepEqual(dadaoStroke({ phase: 'recover', progress: 1 }), dadaoStroke({ phase: 'ready', progress: 0 }));
});

test('pitched and rotated strikes hit their current diagonal sample, not the opposite height', () => {
  for (const yaw of [0, .8, -2]) for (const pitch of [-.65, 0, .65]) for (const progress of [.15, .85]) {
    const facing = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const direction = dadaoSweepDirection(progress, facing);
    const point = { x: origin.x + direction.x * 1.3, y: origin.y + direction.y * 1.3, z: origin.z + direction.z * 1.3 };
    const target = enemy('diagonal', point.x, point.z), state = swinging();
    const now = .4 + DADAO.windup + DADAO.active * progress;
    const hit = aim => selectDadaoTarget(state, now, actor, origin, facing, [target], aim, () => true);
    assert.equal(hit(() => point), target);
    assert.equal(hit(() => ({ ...point, y: point.y + (progress < .5 ? -1.4 : 1.4) })), null);
  }
});

test('dadao is an owned melee kill, not a rifle shot; armor and aircraft reject its damage', () => {
  assert.equal(damageForTarget('dadao', 'person', DADAO.damage), 100);
  assert.equal(damageForTarget('dadao', 'closed-armor', DADAO.damage), 0);
  assert.equal(damageForTarget('dadao', 'aircraft', DADAO.damage), 0);
  assert.equal(attackCategory({ type: 'melee' }), 'melee');
  const stats = createBattleStats();
  stats.consume({ type: 'casualty', health: 0, source: { team: 'friendly', unitId: 'squad',
    soldierId: 'original', weaponClass: 'melee', weaponId: 'original:dadao' },
  target: { kind: 'soldier', id: 'enemy', team: 'enemy' } });
  assert.equal(stats.snapshot[0].kills.melee, 1);
  assert.equal(stats.snapshot[0].kills.rifle, 0);
});

test('melee input is invalidated on soldier changes like other owned equipment commands', () => {
  const input = createControlInput(), owner = { unitId: 'unit', soldierId: 'one', weaponId: 'rifle' };
  input.bind(owner);
  const command = input.capture('equipMelee');
  input.bind({ ...owner, soldierId: 'two' });
  assert.equal(input.execute(command, owner, true, () => assert.fail('stale input')).status, 'rejected');
});

test('original broad blade, guard, wrapped grip and pommel ring stay finite throughout the first-person swing', () => {
  const model = dadaoModel();
  for (const name of ['wide-blade', 'guard', 'wrapped-grip', 'pommel-ring']) assert.ok(model.getObjectByName(name));
  const view = dadaoViewModel();
  for (const phase of ['draw', 'ready', 'windup', 'cut', 'recover']) for (const progress of [0, .5, 1]) {
    updateDadaoView(view, { phase, progress }, { weaponX: 0, weaponY: 0 });
    view.updateMatrixWorld(true);
    view.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
  }
});

test('blade has a tapered solid cross section and a narrow ground edge, not colored overlay planes', () => {
  const model = dadaoModel(), blade = model.getObjectByName('wide-blade'), geometry = blade.geometry;
  const p = geometry.attributes.position, half = p.count / 2, rows = half / 5;
  assert.ok(Math.abs(geometry.boundingBox.max.y - geometry.boundingBox.min.y - DADAO_DIMENSIONS.bladeLength) < 1e-6);
  let maxWidth = 0;
  for (let row = 0; row < rows; row++) {
    const spine = row * 5, edge = spine + 4, bevel = spine + 2;
    maxWidth = Math.max(maxWidth, p.getX(edge) - p.getX(spine));
    assert.ok(p.getZ(spine) > p.getZ(bevel) && p.getZ(bevel) > p.getZ(edge));
    assert.ok(p.getZ(spine) - p.getZ(spine + half) <= DADAO_DIMENSIONS.spineThickness + 1e-8);
    assert.ok(p.getZ(edge) - p.getZ(edge + half) < .00026);
  }
  assert.ok(Math.abs(maxWidth - DADAO_DIMENSIONS.maxWidth) < .001);
  assert.ok(p.getZ(0) > p.getZ((rows - 1) * 5), 'tip is thinner than the base');
  assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  assert.equal(model.children.filter(mesh => mesh.name.includes('edge')).length, 0);
  assert.ok(model.getObjectByName('grip-binding').geometry.index.count > 1000, 'cloth is an actual helical binding');
  const material = blade.material;
  assert.ok(!material.map.isDataTexture, 'base color is an image usable by canvas consumers, not raw pixel data');
  assert.equal(material.map.image.src, `${DADAO_ART_ROOT}steel/color.webp`);
  assert.equal(material.map.colorSpace, 'srgb');
  for (const map of [material.normalMap, material.roughnessMap, material.metalnessMap]) {
    assert.equal(map.colorSpace, '');
    assert.ok(map.image.src.startsWith(`${DADAO_ART_ROOT}steel/`));
    assert.equal(map.anisotropy, 8);
  }
  assert.equal(dadaoModel().getObjectByName('wide-blade').material, material, 'switching reuses GPU resources');
});

test('grip geometry and hand contacts share an adult-sized handle rather than an oversized pole', () => {
  const model = dadaoModel(), handle = model.getObjectByName('wrapped-grip');
  handle.geometry.computeBoundingBox();
  const bounds = handle.geometry.boundingBox;
  assert.ok(Math.abs(bounds.max.y - bounds.min.y - DADAO_GRIP.length) < 1e-6);
  assert.equal(DADAO_DIMENSIONS.gripLength, .19);
  const wrap = model.getObjectByName('grip-binding').geometry;
  wrap.computeBoundingBox();
  const width = wrap.boundingBox.max.x - wrap.boundingBox.min.x;
  const depth = wrap.boundingBox.max.z - wrap.boundingBox.min.z;
  assert.ok(width > .027 && width < .033);
  assert.ok(depth > .031 && depth < .037);
  assert.ok(DADAO_DIMENSIONS.bladeLength / DADAO_DIMENSIONS.gripLength > 3);
  assert.ok(Math.abs(wrap.attributes.uv.getX(1) - .0104 / DADAO_CLOTH_TILE_METERS) < 1e-6);
  assert.ok(wrap.attributes.uv.getY(wrap.attributes.uv.count - 1) > 18, 'weave scale follows the actual strip length');
});

test('offline steel and cotton maps have exact provenance and hashes, not CC0 or measured PBR claims', async () => {
  assert.equal(manifest.provider, 'Azure OpenAI');
  assert.equal(manifest.license, 'Azure-generated-images');
  assert.equal(manifest.isCC0, false);
  assert.equal(manifest.files.length, 7);
  assert.deepEqual(manifest.textures.map(source => source.id), ['steel', 'cotton']);
  assert.equal(manifest.cottonMetersPerTile, DADAO_CLOTH_TILE_METERS);
  assert.match(manifest.processing, /Not measured\/scanned PBR/);
  assert.ok(manifest.conservativeEstimatedTotalUsd > 0 && manifest.conservativeEstimatedTotalUsd <= 50);
  assert.equal(manifest.conservativeEstimatedTotalUsd, manifest.textures.reduce((sum, item) => sum + item.conservativeEstimatedUsd, 0));
  assert.ok(manifest.files.reduce((sum, file) => sum + file.bytes, 0) < 1024 * 1024);
  for (const source of manifest.textures) {
    assert.match(source.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(source.usage.output_tokens > 0);
    assert.equal(source.request.n, 1);
    assert.ok(Object.values(source.decodedColorEdgeMeanAbsoluteDifference).every(error => error <= 8));
  }
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(`../public/assets/materials/ai-dadao/${file.file}`, import.meta.url));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
});

test('steel stays metallic, cotton stays matte, and cached textures are not reloaded on switching', async () => {
  const again = await loadDadaoSurfaces(8, { loadAsync() { assert.fail('cached textures were requested twice'); } });
  assert.equal(again, surfaces);
  assert.equal(loaded.length, Object.values(DADAO_ART_MAPS).flat().length);
  const model = dadaoModel(), steel = model.getObjectByName('wide-blade').material;
  const cloth = model.getObjectByName('grip-binding').material, iron = model.getObjectByName('guard').material;
  assert.equal(steel.metalness, 1);
  assert.equal(cloth.metalness, 0);
  assert.equal(cloth.map.image.src, `${DADAO_ART_ROOT}cotton/color.webp`);
  assert.equal(cloth.map.wrapS, 1000);
  assert.equal(cloth.map.wrapT, 1000);
  assert.equal(cloth.map.colorSpace, 'srgb');
  assert.equal(cloth.roughnessMap.colorSpace, '');
  assert.notEqual(iron.map, steel.map, 'the guard must not inherit the blade bevel UV or painted grain');
});

test('unloaded or failed dadao art is explicit, never a successful procedural fallback', async () => {
  const module = await import('../src/dadao-surface.js?missing-material-test');
  assert.throws(() => module.dadaoSurfaces(), /must finish loading/);
  let requests = 0;
  const loader = { async loadAsync(url) {
    requests++;
    if (url.endsWith('steel/color.webp')) throw new Error('Missing image');
    return new Texture();
  } };
  await assert.rejects(module.loadDadaoSurfaces(1, loader), /failed to load:.*steel\/color\.webp/);
  assert.throws(() => module.dadaoSurfaces(), /must finish loading/);
  await assert.rejects(module.loadDadaoSurfaces(1, loader), /failed to load/);
  assert.equal(requests, 7, 'a failed batch must not trigger hidden retries');
  await assert.rejects(module.loadDadaoSurfaces(NaN, loader), /anisotropy/);
});
