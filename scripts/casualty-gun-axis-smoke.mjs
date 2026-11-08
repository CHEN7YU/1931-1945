import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__casualty-gun-axis', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body></body></html>' }));
  await page.goto(new URL('/__casualty-gun-axis', process.env.GAME_URL ?? 'http://127.0.0.1:5347/').href);
  const samples = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadIjaCharacter, createIjaForceRendererAsync } = await import('/src/ija-character.js');
    const { createNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createCasualtyState } = await import('/src/casualties.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const factory = await loadIjaCharacter(() => 0), scene = new T.Scene();
    const camera = new T.PerspectiveCamera(72, 1.6, .05, 100);
    camera.position.set(0, 1.5, -4); camera.lookAt(0, .4, 0); camera.updateMatrixWorld(true);
    const force = await createIjaForceRendererAsync(scene, camera, factory, 1, { lowMemory: true });
    const view = factory.createView(), samples = [];
    for (const weapon of ['rifle', 'type11']) for (const stance of ['standing', 'kneeling', 'prone'])
      for (let variant = 0; variant < 4; variant++) {
        const actor = { id: `dead-${weapon}-${stance}-${variant}`, unitId: 'dead-gun-inspection',
          team: 'enemy', index: 0, formation: { memberCount: 11 }, health: 100, vehicleId: null,
          groundType: 'infantry', position: new T.Vector3(), heading: .4, stance: stance === 'kneeling' ? 'crouched' : stance,
          firingPose: stance === 'standing' ? null : stance, walkPhase: 0, locomotion: { speed: 0, mode: 'idle' },
          rifle: createRifleState(weapon), rifleReady: false, tactics: {}, bayonet: { mode: 'idle', extension: 0 } };
        actor.nativeMotion = createNraMotion(factory.motionProfile, actor);
        if (stance !== 'standing') actor.nativeMotion.posture[stance] = 1;
        actor.health = 0; actor.casualty = createCasualtyState(actor, 0, sampleNraMotion(actor),
          { variant, retainGun: false });
        view.bind(actor.id); view.update(actor, 3, null);
        let gun = null; view.root.traverseVisible(node => {
          if (node.userData.personalWeapon && !node.userData.engineeringTool) gun = node;
        });
        view.root.updateMatrixWorld(true);
        const nearAxis = new T.Vector3(0, 0, -1).transformDirection(gun.matrixWorld);
        force.update([actor], 3, null, 'low', { detailLimit: 0 });
        const mesh = force.root.children.find(node => node.isInstancedMesh && node.count &&
          node.name === `owned-weapon-${weapon}`);
        if (!mesh) throw new Error('Missing actual dead weapon instance');
        const matrix = new T.Matrix4(); mesh.getMatrixAt(0, matrix);
        matrix.premultiply(mesh.matrixWorld);
        const farAxis = new T.Vector3(0, 0, -1).transformDirection(matrix);
        samples.push({ weapon, stance, variant, nearAxis: nearAxis.toArray(), farAxis: farAxis.toArray() });
      }
    return samples;
  });
  await writeFile(join(directory, 'dead-gun-directions.json'), JSON.stringify({ samples, errors }, null, 2));
  for (const sample of samples) {
    assert.ok(Math.abs(sample.nearAxis[1]) < .15, JSON.stringify(sample));
    assert.ok(Math.abs(sample.farAxis[1]) < .15, JSON.stringify(sample));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, actualDeadGunCases: samples.length }));
} finally { await browser.close(); }
