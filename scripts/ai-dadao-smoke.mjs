import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = process.env.ARTIFACT_DIR;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  if (directory) await mkdir(directory, { recursive: true });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5187');
  url.searchParams.set('benchmark', 'duel'); url.searchParams.set('seed', '1938');
  url.searchParams.set('resources', 'low-memory');
  await page.route('**/__ai-dadao-model-check', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body></body></html>' }));
  await page.goto(new URL('/__ai-dadao-model-check', url).href);
  const poses = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { createDadaoState } = await import('/src/dadao.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createNraForceRenderer } = await import('/src/nra-force-renderer.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    await loadDadaoSurfaces(1);
    const view = (await loadNraCharacter()).createView(), results = [];
    const actor = { id: 'dadao-model-check', team: 'friendly', unitId: 'model-check',
      position: new THREE.Vector3(), heading: .7, walkPhase: 0, health: 100, stance: 'standing',
      locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), dadao: createDadaoState() };
    actor.nativeMotion = createNraMotion(view.motionProfile, actor); view.bind(actor.id);
    for (const style of [0, 1]) for (const phase of ['ready', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 20; frame++) {
      Object.assign(actor.dadao, { equipped: true, style, mode: phase, pose: { phase, progress: frame / 20 } });
      view.update(actor, 0, null);
      results.push({ phase, frame, style, issue: view.snapshot.issue, ...view.snapshot.dadao });
    }
    const camera = new THREE.PerspectiveCamera(72, 1, .07, 650), scene = new THREE.Scene();
    camera.position.set(0, 1.5, 65); camera.lookAt(0, 1, 0);
    const force = createNraForceRenderer(scene, camera, view);
    force.update([actor], 0, null, 'high');
    const far = { ...force.snapshot,
      swords: force.root.children.filter(mesh => mesh.name === 'owned-weapon-dadao').reduce((n, mesh) => n + mesh.count, 0),
      rifles: force.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle').reduce((n, mesh) => n + mesh.count, 0) };
    actor.dadao.equipped = false;
    force.update([actor], 0, null, 'high');
    const stowed = {
      swords: force.root.children.filter(mesh => mesh.name === 'owned-weapon-dadao').reduce((n, mesh) => n + mesh.count, 0),
      rifles: force.root.children.filter(mesh => mesh.name === 'owned-weapon-rifle').reduce((n, mesh) => n + mesh.count, 0) };
    view.update(actor, 0, null);
    const restored = view.snapshot.dadao;
    const preview = new THREE.Scene(); preview.background = new THREE.Color('#738078');
    preview.add(new THREE.HemisphereLight(0xe5edff, 0x64584a, 2));
    const light = new THREE.DirectionalLight(0xffefd7, 3); light.position.set(-2, 4, -3); preview.add(light, view.root);
    const portrait = new THREE.PerspectiveCamera(42, 1, .07, 30);
    portrait.position.set(2, 1.7, -3.4); portrait.lookAt(.05, 1, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(900, 900);
    const images = {};
    for (const [phase, progress] of [['ready', 0], ['windup', 1], ['cut', .5], ['recover', .7]]) {
      actor.dadao.equipped = true; actor.dadao.pose = { phase, progress };
      view.update(actor, 0, null); renderer.render(preview, portrait);
      images[phase] = renderer.domElement.toDataURL('image/png').split(',')[1];
    }
    renderer.dispose();
    return { results, far, stowed, restored, images };
  });
  for (const pose of poses.results) {
    assert.equal(pose.issue, null, JSON.stringify(pose));
    assert.equal(pose.visible, true);
    assert.equal(pose.reachable, true);
    assert.ok(pose.error < .001);
    assert.equal(pose.leftReachable, true); assert.ok(pose.leftError < .001);
    assert.ok(pose.wristAlignment > .65, JSON.stringify(pose));
    assert.ok(pose.leftWristAlignment > .65, JSON.stringify(pose));
  }
  assert.equal(poses.far.far, 1); assert.ok(poses.far.swords > 0); assert.equal(poses.far.rifles, 0);
  assert.equal(poses.stowed.swords, 0); assert.ok(poses.stowed.rifles > 0); assert.equal(poses.restored.visible, false);
  console.log('PASS: native two-style blade grips and distant owned-weapon switching');
  if (directory) {
    for (const [phase, image] of Object.entries(poses.images)) await writeFile(join(directory, `third-person-${phase}.png`), Buffer.from(image, 'base64'));
    delete poses.images;
    await writeFile(join(directory, 'model-checks.json'), JSON.stringify(poses, null, 2));
  }
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' ||
    document.getElementById('fatal') && !document.getElementById('fatal').hidden, null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').innerText());
  console.log('Real AI battle loaded');
  await page.locator('#deploy').click();
  await page.keyboard.down('w'); await page.keyboard.down('Shift');
  let charged = false, hit = false, swapped = false, round = 1;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(80);
    const sample = await page.evaluate(() => {
      const b = window.__battle;
      return { time: b.time, state: b.state, position: b.position, friendly: b.friendlyPositions,
        enemies: b.enemyPositions, views: b.historicalForce?.views ?? [], stats: b.combatStats,
        controlledId: b.control.soldierId, events: b.combatEvents, scores: b.squadScores,
        input: b.controlInput, locomotion: b.locomotion, renderer: b.population.renderer };
    });
    sample.round = round;
    samples.push(sample);
    if (swapped || sample.position?.z < 20 || sample.state !== 'playing') {
      await page.keyboard.up('w'); await page.keyboard.up('Shift');
    } else {
      await page.keyboard.down('w'); await page.keyboard.down('Shift');
    }
    if (!swapped && sample.state === 'playing' && sample.enemies.some(enemy =>
      Math.hypot(enemy.x - sample.position.x, enemy.z - sample.position.z) < 7)) {
      await page.keyboard.up('w'); await page.keyboard.up('Shift');
      await page.keyboard.press('y');
      swapped = true;
    }
    const active = sample.friendly.filter(actor => actor.dadao?.equipped);
    for (const actor of active) assert.equal(actor.aiRifle.blocked, 'dadao');
    for (const actor of active) {
      const previous = samples.at(-2);
      const before = previous?.round === round && previous.friendly.find(other => other.soldierId === actor.soldierId && other.dadao?.equipped);
      if (before && actor.dadao.targetId === before.dadao.targetId) assert.equal(actor.rifle.shots, before.rifle.shots);
    }
    if (active.some(actor => actor.dadao.mode === 'charge' && actor.movement.speed > 0)) {
      if (!charged && directory) await page.screenshot({ path: join(directory, 'allied-dadao-charge.png') });
      charged = true;
    }
    const damage = sample.events.history.find(event => event.type === 'damage' &&
      event.source.credit === 'ally' && event.source.weaponId === `${event.source.soldierId}:dadao`);
    if (damage) {
      hit = true;
      assert.equal(damage.source.weaponClass, 'melee');
      assert.equal(damage.target.team, 'enemy'); assert.equal(damage.health, 0);
      assert.ok(damage.amount > 0 && damage.amount <= 100);
      assert.ok(sample.events.history.some(event => event.type === 'casualty' &&
        event.target.id === damage.target.id && event.source.weaponId === damage.source.weaponId));
      if (directory) await page.screenshot({ path: join(directory, 'allied-dadao-hit.png') });
      if (charged) break;
    }
    if (sample.time > 25 || sample.state === 'dead') {
      if (round === 3) break;
      // Real opponents may shoot a charging soldier first; retry a whole battle, never its health or AI.
      await page.keyboard.up('w'); await page.keyboard.up('Shift');
      if (sample.state !== 'dead') await page.keyboard.press('Escape');
      await page.locator('#back-menu').click(); await page.locator('#deploy').click();
      await page.keyboard.down('w'); await page.keyboard.down('Shift');
      round++; swapped = false;
    }
  }
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  assert.ok(charged, 'friendly AI must really move toward its close combat target');
  assert.ok(hit, 'friendly AI must land a real timed dadao cut');
  if (url.searchParams.get('character') === 'procedural') {
    assert.ok(samples.some(sample => sample.renderer.procedural.melee > 0), 'procedural combat must actually render its sword batches');
  }
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => ({ time: window.__battle.time,
    swords: window.__battle.friendlyPositions.map(actor => actor.dadao) }));
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => ({ time: window.__battle.time,
    swords: window.__battle.friendlyPositions.map(actor => actor.dadao) })), paused);
  await page.locator('#back-menu').click(); await page.locator('#deploy').click();
  assert.ok((await page.evaluate(() => window.__battle.friendlyPositions)).every(actor => !actor.dadao?.equipped && actor.dadao?.swings === 0));
  assert.deepEqual(errors, []);
  console.log('PASS: native third-person stroke, far instanced sword/rifle switch, real allied AI charge/cut, no melee gunfire, pause and clean restart.');
} finally {
  if (directory) await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, errors }, null, 2));
  await browser.close();
}
