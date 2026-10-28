import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
let result = null;
try {
  await page.route('**/__head-aim-check', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__head-aim-check', process.env.GAME_URL ?? 'http://127.0.0.1:5196/').href);
  result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, syncNativeAimGoal } = await import('/src/nra-motion.js');
    const { FIRING_POSES } = await import('/src/combat-posture.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials();
    const factories = { friendly: await loadNraCharacter(), enemy: await loadIjaCharacter() };
    const scene = new T.Scene(); scene.background = new T.Color('#b5beb6');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-4, 7, -5); scene.add(light);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1100, 900); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(32, 1100 / 900, .05, 200);
    const samples = [], images = [];
    for (const [team, factory] of Object.entries(factories)) for (const pose of ['standing', ...Object.keys(FIRING_POSES)]) {
      for (const ready of [false, true]) {
        const view = factory.createView(), actor = { id: `${team}-${pose}-${ready}`, team, unitId: 'inspection',
          health: 100, vehicleId: null, position: new T.Vector3(), heading: 0, stance: FIRING_POSES[pose]?.stance ?? 'standing',
          firingPose: pose === 'standing' ? null : pose, walkPhase: 1.2, rifleReady: ready,
          rifle: createRifleState(), deathTime: 0, locomotion: { speed: 0, mode: 'idle' } };
        actor.nativeMotion = createNraMotion(factory.motionProfile, actor);
        actor.nativeMotion.posture = Object.fromEntries(Object.keys(FIRING_POSES).map(name => [name, name === pose ? 1 : 0]));
        actor.nativeMotion.bodyLean = ready ? .03 : 0;
        syncNativeAimGoal(actor);
        const before = JSON.stringify(actor.nativeMotion);
        view.bind(actor.id); view.update(actor, 0, null);
        const data = view.snapshot;
        samples.push({ team, pose, ready, head: data.headAim, issue: view.issue,
          stock: data.riflePose.stock, stockTarget: data.riflePose.stockTarget,
          preserved: JSON.stringify(actor.nativeMotion) === before });
        if (pose === 'standing' || pose === 'kneeling') {
          scene.add(view.root);
          camera.position.set(1.7, pose === 'standing' ? 1.6 : 1, -.45);
          camera.lookAt(.02, pose === 'standing' ? 1.5 : .9, -.15);
          renderer.render(scene, camera);
          const image = document.createElement('canvas'); image.width = 1100; image.height = 900;
          const drawing = image.getContext('2d'); drawing.drawImage(renderer.domElement, 0, 0);
          drawing.fillStyle = '#ffffffdf'; drawing.fillRect(12, 12, 900, 42);
          drawing.fillStyle = '#142118'; drawing.font = '17px sans-serif';
          drawing.fillText(`${team} / ${pose} / ${ready ? 'aim' : 'carry'} — pose inspection, not gameplay`, 22, 39);
          images.push({ name: `${team}-${pose}-${ready ? 'aim' : 'carry'}.png`, data: image.toDataURL('image/png') });
          scene.remove(view.root);
        }
      }
    }
    return { samples, images };
  });
  for (const image of result.images) await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  for (const sample of result.samples) {
    assert.ok(sample.preserved);
    assert.equal(sample.issue, null, JSON.stringify(sample));
    assert.ok(sample.head.projectionError < .001, JSON.stringify(sample));
    if (sample.ready) {
      assert.ok(sample.head.sightError < .004, JSON.stringify(sample));
      assert.ok(sample.head.cheekError < .012 && sample.head.cheekProjectionError < .012, JSON.stringify(sample));
      assert.ok(sample.head.gazeError < .05 && sample.head.eyeRelief > .04, JSON.stringify(sample));
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, samples: result.samples.length,
    maxEyeProjection: Math.max(...result.samples.map(sample => sample.head.projectionError)) }));
} finally {
  await writeFile(join(directory, 'measurements.json'), JSON.stringify({ samples: result?.samples, errors }, null, 2));
  await browser.close();
}
