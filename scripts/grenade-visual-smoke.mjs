import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/__grenade-effects-check', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__grenade-effects-check', process.env.GAME_URL ?? 'http://127.0.0.1:5204/').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createCombatEffects } = await import('/src/combat-effects.js');
    const scene = new T.Scene(); scene.background = new T.Color('#b5beb6');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-4, 7, -5); scene.add(light);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 800); renderer.toneMapping = T.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: '#726b59', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const wall = new T.Mesh(new T.BoxGeometry(10, 3, .2), new T.MeshStandardMaterial({ color: '#8a8070' }));
    wall.position.set(0, 1.5, -2.4); scene.add(wall);
    const camera = new T.PerspectiveCamera(48, 1.5, .05, 100); camera.position.set(3.2, 1.65, 5); camera.lookAt(0, .45, 0);
    const effects = createCombatEffects(scene, camera, () => 0);
    const settings = { preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } };
    effects.configure(settings); const images = [], samples = [];
    effects.explosion(new T.Vector3(0, .08, 0), 0);
    let previous = 0;
    for (const time of [0, .06, .2, .5, 1.2, 2.5]) {
      effects.update(time - previous, time); previous = time; renderer.render(scene, camera);
      samples.push({ time, ...effects.snapshot });
      images.push({ name: `blast-${time}.png`, data: renderer.domElement.toDataURL() });
    }
    const heavy = [];
    camera.position.set(7, 4, 12); camera.lookAt(0, 2, 0);
    for (const style of ['explosive-pack', 'tank-destruction']) {
      for (const preset of ['high', 'low']) {
        effects.clear(); effects.configure({ ...settings, preset });
        effects.explosion(new T.Vector3(0, style === 'tank-destruction' ? 1.5 : .08, 0), 0, 9, style);
        const stages = [];
        let last = 0;
        for (const time of [0, .3, 1.2, 4, 6]) {
          effects.update(time - last, time); last = time; renderer.render(scene, camera);
          stages.push({ time, ...effects.snapshot });
          images.push({ name: `${style}-${preset}-${time}.png`, data: renderer.domElement.toDataURL() });
        }
        heavy.push({ style, preset, stages });
      }
    }
    effects.clear(); effects.configure(settings);
    effects.explosion(new T.Vector3(0, .08, 0), 0, 9, 'explosive-pack'); effects.update(.25, .25);
    renderer.render(scene, camera);
    const before = renderer.domElement.toDataURL();
    effects.update(0, .25); renderer.render(scene, camera);
    const frozen = before === renderer.domElement.toDataURL();
    effects.clear(); effects.configure({ ...settings, preset: 'low' });
    effects.explosion(new T.Vector3(0, .08, 0), 0);
    const low = effects.snapshot;
    effects.clear(); const cleared = effects.snapshot;
    effects.configure(settings); effects.explosion(new T.Vector3(0, .08, 0), 0);
    const stream = renderer.domElement.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.start();
    for (let frame = 0; frame < 90; frame++) {
      effects.update(frame ? 1 / 30 : 0, frame / 30); renderer.render(scene, camera);
      await new Promise(resolve => setTimeout(resolve, 33));
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const recording = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
    });
    return { images, samples, heavy, frozen, low, cleared, recording };
  });
  assert.ok(result.samples[0].visibleLights > 0 && result.samples[0].blastClouds > 0);
  assert.ok(result.samples.find(sample => sample.time === 1.2).blastClouds > 0, 'smoke outlasts the brief detonation flash');
  assert.equal(result.samples.at(-1).blastClouds, 0);
  for (const { style, preset, stages } of result.heavy) {
    assert.equal(stages[0].fireClouds, preset === 'low' ? 1 : 6);
    assert.equal(stages[0].shockwaves, 1);
    assert.ok(stages[1].fireClouds > 0);
    assert.equal(stages[0].renderedClouds, stages[0].clouds);
    if (style === 'tank-destruction') assert.ok(stages[3].sootClouds > 0);
    assert.equal(stages.at(-1).clouds + stages.at(-1).fragments + stages.at(-1).lights, 0);
    assert.ok(stages.every(stage => stage.clouds <= (preset === 'low' ? 6 : 18) &&
      stage.fragments <= (preset === 'low' ? 32 : 96)));
    if (preset === 'low') assert.ok(stages.every(stage => stage.visibleLights === 0));
  }
  assert.ok(result.frozen); assert.equal(result.low.visibleLights, 0);
  assert.ok(result.low.clouds <= 6 && result.low.fragments <= 32);
  assert.equal(result.cleared.clouds + result.cleared.fragments + result.cleared.lights, 0);
  for (const image of result.images) await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  await writeFile(join(directory, 'grenade-blast.webm'), Buffer.from(result.recording.split(',')[1], 'base64'));
  delete result.images; delete result.recording;
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, frozen: result.frozen, lowFragments: result.low.fragments, lowClouds: result.low.clouds }));
} finally { await browser.close(); }
