import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__sky-review', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body></body></html>' }));
  await page.goto(new URL('/__sky-review', process.env.GAME_URL ?? 'http://127.0.0.1:5353/').href);
  const samples = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadSceneMaterials } = await import('/src/materials.js');
    const { createDaylight } = await import('/src/lighting.js');
    const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(1000, 625); renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const camera = new T.PerspectiveCamera(72, 1.6, .05, 100);
    camera.lookAt(0, .7, 1); camera.updateMatrixWorld(true);
    const samples = [];
    for (const lowMemory of [true, false]) {
      const scene = new T.Scene(), sun = new T.DirectionalLight(), fill = new T.HemisphereLight();
      const fog = new T.FogExp2(); scene.add(sun, fill);
      await loadSceneMaterials(renderer, scene, { lowMemory });
      const sky = scene.background, light = createDaylight(scene, sun, fill, fog);
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL();
      const settings = [];
      for (const enabled of [true, false, true]) {
        light.setEnabled(enabled); renderer.render(scene, camera);
        settings.push({ enabled, sameSky: scene.background === sky, intensity: scene.backgroundIntensity,
          rotation: scene.backgroundRotation.y, samePixels: renderer.domElement.toDataURL() === image });
      }
      samples.push({ lowMemory, texture: sky.isTexture === true, width: sky.image?.width,
        height: sky.image?.height, environment: Boolean(scene.environment), settings, image });
    }
    renderer.dispose();
    return samples;
  });
  for (const sample of samples) {
    assert.equal(sample.texture, true);
    assert.equal(sample.width, 1024); assert.equal(sample.height, 512);
    assert.equal(sample.environment, !sample.lowMemory);
    assert.ok(sample.settings.every(s => s.sameSky && s.samePixels && s.intensity === .65 && s.rotation === 1.1));
    await writeFile(join(directory, sample.lowMemory ? 'low-memory-clouds.png' : 'standard-clouds.png'),
      Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'sky-review.json'), JSON.stringify({ samples, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, samples, errors }));
} finally { await browser.close(); }
