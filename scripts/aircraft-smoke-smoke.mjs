import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

if (!process.env.ARTIFACT_DIR) throw new Error('ARTIFACT_DIR is required');
await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__aircraft-smoke', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto(new URL('/__aircraft-smoke', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createCombatEffects } = await import('/src/combat-effects.js');
    const { createVehicleRenderer } = await import('/src/vehicle-renderer.js');
    const { createEntityRegistry, registerUnit, createVehicleEntity } = await import('/src/entities.js');
    const scene = new T.Scene(); scene.background = new T.Color(0x9ab8ce);
    scene.add(new T.HemisphereLight(0xffffff, 0x72685a, 2));
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(12, 35, 18); scene.add(sun);
    const camera = new T.PerspectiveCamera(52, 16 / 9, .1, 200);
    camera.position.set(26, 24, 30); camera.lookAt(0, 17, 0); camera.updateMatrixWorld(true);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); document.body.append(renderer.domElement);
    const registry = createEntityRegistry(); registerUnit(registry, { id: 'air', type: 'plane', team: 'enemy' });
    const aircraft = createVehicleEntity(registry, { id: 'falling-plane', unitId: 'air', type: 'plane',
      team: 'enemy', position: new T.Vector3(0, 20, 18) });
    const views = createVehicleRenderer(scene), effects = createCombatEffects(scene, camera, () => 0);
    effects.configure({ preset: 'high', effects: { hitParticles: true, muzzleLight: false, muzzle: true } });
    aircraft.health = 0; aircraft.fall = { grounded: false };
    for (let frame = 0; frame <= 72; frame++) {
      aircraft.position.set(0, 20 - frame / 9, 18 - frame / 2);
      aircraft.pitch = -.18; aircraft.roll = .18;
      views.update(registry.vehicles.values(), frame * .04);
      effects.update(frame ? .04 : 0, frame * .04, [aircraft]);
    }
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL(), snapshot = effects.snapshot.aircraftSmoke;
    const read = () => {
      const pixels = new Uint8Array(1280 * 720 * 4);
      renderer.getContext().readPixels(0, 0, 1280, 720, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const smokePixels = read();
    scene.getObjectByName('aircraft-damage-black-smoke').visible = false;
    renderer.render(scene, camera); const bare = read();
    let newlyDarkPixels = 0;
    for (let i = 0; i < smokePixels.length; i += 4)
      if (smokePixels[i] < 105 && smokePixels[i + 1] < 105 && smokePixels[i + 2] < 105 &&
        bare[i] - smokePixels[i] > 45 && bare[i + 1] - smokePixels[i + 1] > 45) newlyDarkPixels++;
    const calls = renderer.info.render.calls;
    effects.clear();
    renderer.dispose();
    return { image, snapshot, newlyDarkPixels, calls };
  });
  await writeFile(join(process.env.ARTIFACT_DIR, 'aircraft-falling-black-smoke.png'), Buffer.from(result.image.split(',')[1], 'base64'));
  delete result.image;
  assert.ok(result.snapshot.puffs > 20 && result.snapshot.visible, JSON.stringify(result));
  assert.ok(result.newlyDarkPixels > 1500, 'black smoke must visibly darken the actual rendered image, not just exist in a counter');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
