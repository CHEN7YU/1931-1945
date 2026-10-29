import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/__tank-fire-check', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__tank-fire-check', process.env.GAME_URL ?? 'http://127.0.0.1:5208').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createCombatEffects } = await import('/src/combat-effects.js');
    const { createVehicleRenderer } = await import('/src/vehicle-renderer.js');
    const { createEntityRegistry, registerUnit, createVehicleEntity, damageVehicleEntity } = await import('/src/entities.js');
    const scene = new T.Scene(); scene.background = new T.Color('#939f9e');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-4, 7, -5); scene.add(light);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 800); renderer.toneMapping = T.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const floor = new T.Mesh(new T.PlaneGeometry(50, 50), new T.MeshStandardMaterial({ color: '#726b59', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const camera = new T.PerspectiveCamera(48, 1.5, .05, 200);
    const cameras = [[7, 4, 11], [-8, 3, 5], [0, 13, 3], [3, 4, -11]];
    camera.position.set(...cameras[0]); camera.lookAt(0, 2, 0);
    const effects = createCombatEffects(scene, camera, () => 0), models = createVehicleRenderer(scene);
    const settings = { preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } };
    effects.configure(settings);
    const images = [], samples = [];
    for (const variant of [null, 'chi-ha']) {
      effects.clear(); models.clear();
      const registry = createEntityRegistry();
      registerUnit(registry, { id: 'test-unit', type: 'tank', team: 'enemy' });
      const vehicle = createVehicleEntity(registry, { id: `test-${variant ?? 'vickers'}`, unitId: 'test-unit',
        type: 'tank', team: 'enemy', variant, position: new T.Vector3() });
      vehicle.heading = .5; vehicle.turretYaw = -.6;
      damageVehicleEntity(registry, vehicle, vehicle.health); vehicle.destroyedAt = 0;
      models.update(registry.vehicles.values(), 0);
      effects.explosion(new T.Vector3(0, 1.5, 0), 0, 7, 'tank-destruction');
      let previous = 0;
      for (const time of [.4, 2, 6, 15, 19, 22]) {
        effects.update(time - previous, time, registry.vehicles.values()); previous = time;
        renderer.render(scene, camera);
        samples.push({ variant, time, ...effects.snapshot.tankFire });
        images.push({ name: `${variant ?? 'vickers'}-${time}.png`, data: renderer.domElement.toDataURL() });
      }
      effects.clear();
      effects.update(2, 2, registry.vehicles.values());
      for (let angle = 0; angle < cameras.length; angle++) {
        camera.position.set(...cameras[angle]); camera.lookAt(0, 2, 0); renderer.render(scene, camera);
        images.push({ name: `${variant ?? 'vickers'}-angle-${angle}.png`, data: renderer.domElement.toDataURL() });
      }
    }
    camera.position.set(...cameras[0]); camera.lookAt(0, 2, 0);
    const vehicles = Array.from({ length: 20 }, (_, index) => ({ id: `wreck-${index}`, type: 'tank', health: 0,
      destroyedAt: 0, position: { x: index * 2, y: 0, z: 0 }, heading: .5, turretYaw: -.6, variant: 'chi-ha' }));
    effects.clear(); effects.update(1, 1, vehicles); renderer.render(scene, camera);
    const high = effects.snapshot.tankFire;
    const frozenImage = renderer.domElement.toDataURL();
    effects.update(0, 1, vehicles); renderer.render(scene, camera);
    const frozen = frozenImage === renderer.domElement.toDataURL();
    for (let i = 0; i < 80; i++) effects.explosion(new T.Vector3(0, .1, 0), 1);
    const afterBursts = effects.snapshot.tankFire;
    effects.configure({ ...settings, preset: 'low' }); renderer.render(scene, camera);
    const low = effects.snapshot.tankFire;
    effects.configure({ ...settings, effects: { ...settings.effects, hitParticles: false } });
    renderer.render(scene, camera);
    const disabled = effects.snapshot.tankFire;
    effects.configure(settings);
    const restored = effects.snapshot.tankFire;
    effects.update(0, 1, []); renderer.render(scene, camera);
    const retired = effects.snapshot.tankFire;
    effects.clear(); const cleared = effects.snapshot.tankFire;
    effects.update(2, 2, vehicles.slice(0, 1));
    const stream = renderer.domElement.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
    for (let frame = 0; frame < 120; frame++) {
      const time = 2 + frame / 30;
      effects.update(frame ? 1 / 30 : 0, time, vehicles.slice(0, 1)); renderer.render(scene, camera);
      await new Promise(resolve => setTimeout(resolve, 33));
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const recording = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
    });
    return { images, samples, high, low, afterBursts, frozen, disabled, restored, retired, cleared, recording };
  });
  for (const variant of [null, 'chi-ha']) {
    const samples = result.samples.filter(sample => sample.variant === variant);
    assert.ok(samples[0].sources[0].height > 3);
    assert.equal(samples[1].flamePlanes, 6);
    assert.equal(samples[2].flamePlanes, 3);
    assert.ok(samples[2].smoke > 0 && samples[3].smoke > 0, 'smoke is continuously replenished after the original explosion expires');
    assert.equal(samples[4].flamePlanes, 0); assert.ok(samples[4].smoke > 0);
    assert.equal(samples[5].wrecks, 0);
  }
  assert.equal(result.high.wrecks, 4); assert.equal(result.high.flamePlanes, 24);
  assert.equal(result.low.wrecks, 2); assert.equal(result.low.flamePlanes, 8);
  assert.ok(result.low.smoke <= 8);
  assert.deepEqual(result.afterBursts, result.high, 'transient explosions cannot evict sustained flames');
  assert.ok(result.frozen, 'pause freezes the shader animation as well as smoke');
  assert.equal(result.restored.sources[0].age, 1, 'quality changes do not restart the effect');
  for (const value of [result.disabled, result.retired, result.cleared]) assert.equal(value.wrecks + value.flamePlanes + value.smoke, 0);
  assert.deepEqual(errors, []);
  for (const image of result.images) await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  await writeFile(join(directory, 'sustained-tank-fire.webm'), Buffer.from(result.recording.split(',')[1], 'base64'));
  delete result.images; delete result.recording;
  await writeFile(join(directory, 'observations.json'), JSON.stringify(result, null, 2));
  console.log('PASS: both tank models, four camera angles, sustained jet/residual fire/smoke stages, fixed budgets, pause, gunfire independence, quality switches and retirement.');
} finally { await browser.close(); }
