import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const label = process.env.REVIEW_LABEL ?? 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid REVIEW_LABEL');
const views = [
  { id: 'south-from-wall', position: [0, 10.2, 25], target: [0, 3.5, 170], up: [0, 1, 0], fov: 72 },
  { id: 'battlefield-overhead', position: [-16, 140, 0], target: [-16, 0, 0],
    up: [0, 0, -1], fov: 82, resolution: [1600, 1200] },
  { id: 'gate-and-city-overhead', position: [-10, 90, 0], target: [-10, 0, 0],
    up: [0, 0, -1], fov: 78, resolution: [1600, 1200] },
  { id: 'city-oblique', position: [100, 145, 180], target: [-20, 0, -20], up: [0, 1, 0], fov: 65 },
  { id: 'south-farms-overhead', position: [-45, 145, 245], target: [-45, 0, 245], up: [0, 0, -1], fov: 78 },
  { id: 'west-dock-overhead', position: [-95, 85, -76], target: [-95, 0, -76], up: [0, 0, -1], fov: 68 },
  { id: 'riverside-overhead', position: [-95, 85, -5], target: [-95, 0, -5],
  up: [0, 0, -1], fov: 62, resolution: [1200, 1600] },
  { id: 'riverside-from-south', position: [-95, 1.7, 34], target: [-95, 1.7, -25],
  up: [0, 1, 0], fov: 72 },
];
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.nanjingGroundReview = {
        prepare() {
          setGameState('pause'); missionBriefing.hide();
          graphics.setAutomaticLevel(0);
          for (const child of camera.children) child.visible = false;
          if (supportViewHands) supportViewHands.root.visible = false;
        },
        capture(view) {
          const [width, height] = view.resolution ?? [1600, 900];
          renderer.setSize(width, height, false);
          camera.position.fromArray(view.position);
          camera.up.fromArray(view.up);
          camera.fov = view.fov; camera.aspect = width / height;
          camera.updateProjectionMatrix();
          camera.lookAt(...view.target);
          camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          const error = renderer.getContext().getError();
          if (error !== 0) throw new Error('WebGL error while capturing ' + view.id + ': ' + error);
          return {
            image: renderer.domElement.toDataURL('image/png').split(',')[1],
            quality: graphics.snapshot, time,
            fogDensity: scene.fog?.density ?? null,
            houses: world.landmarks.southBackdrop.houses.length,
            fields: world.landmarks.southBackdrop.fields.length,
          };
        },
        probeSoil() {
          const ground = scene.children.find(object => object.userData.nanjingFeature === 'south-distant-ground');
          const backdrop = world.landmarks.southBackdrop.root;
          const field = world.landmarks.southBackdrop.fields.find(item => item.x === 39 && item.z === 163);
          if (!ground || !field) throw new Error('Missing actual southern terrain or field');
          const ray = new THREE.Raycaster(), samples = [];
          for (const point of [{ name: 'ground', x: 165, z: 245 },
            { name: 'field', x: field.x - 5, z: field.z + 1.2 }]) {
            ray.set(new THREE.Vector3(point.x, 100, point.z), new THREE.Vector3(0, -1, 0));
            const hit = ray.intersectObjects([ground, backdrop], true)
              .find(item => item.object.material?.userData.source === 'earth');
            if (!hit || (point.name === 'ground') !== (hit.object === ground))
              throw new Error('Soil probe missed actual ' + point.name);
            renderer.setSize(320, 320, false);
            camera.position.set(point.x, hit.point.y + 8, point.z);
            camera.up.set(0, 0, -1); camera.fov = 40; camera.aspect = 1;
            camera.updateProjectionMatrix(); camera.lookAt(hit.point); camera.updateMatrixWorld(true);
            const material = hit.object.material, compile = material.onBeforeCompile, key = material.customProgramCacheKey;
            const read = () => {
              renderer.render(scene, camera);
              const pixels = new Uint8Array(16 * 16 * 4);
              const gl = renderer.getContext();
              gl.readPixels(Math.floor(gl.drawingBufferWidth / 2) - 8,
                Math.floor(gl.drawingBufferHeight / 2) - 8, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              const error = gl.getError();
              if (error !== 0) throw new Error('Soil probe WebGL error: ' + error);
              return [0, 1, 2].map(channel => {
                let sum = 0;
                for (let index = channel; index < pixels.length; index += 4) sum += pixels[index];
                return sum / 256;
              });
            };
            const corrected = read();
            let original;
            try {
              material.onBeforeCompile = () => {};
              material.customProgramCacheKey = () => 'nanjing-ground-review-original';
              material.needsUpdate = true;
              original = read();
            } finally {
              material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true;
            }
            samples.push({ name: point.name, corrected, original });
          }
          return samples;
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5392/');
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('seed', '1937');
  await page.goto(url.href);
  await setQualityPreset(page, 'high');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => nanjingGroundReview.prepare());
  const results = [];
  for (const view of views) {
    const result = await page.evaluate(view => nanjingGroundReview.capture(view), view);
    assert.equal(result.quality.preset, 'high');
    assert.equal(result.quality.automaticLevel, 0);
    assert.equal(result.quality.lowMemory, false);
    assert.ok(result.fogDensity > 0);
    await writeFile(join(directory, `${view.id}-${label}.png`), Buffer.from(result.image, 'base64'));
    delete result.image;
    results.push({ ...view, ...result });
  }
  const soilSamples = await page.evaluate(() => nanjingGroundReview.probeSoil());
  for (const sample of soilSamples) {
    const excessRed = rgb => rgb[0] - rgb[1];
    assert.ok(excessRed(sample.original) - excessRed(sample.corrected) > 5,
      `${sample.name} must reduce the real soil map's red cast: ${JSON.stringify(sample)}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, `review-${label}.json`), JSON.stringify({
    conditions: 'Actual Nanjing battlefield, standard resources, high quality with automatic degradation set to 0; paused and manually positioned diagnostic cameras. First-person weapon and HUD are not shown. Normal scene lighting and fog are retained. The aerial cameras are not natural player viewpoints.',
    results, soilSamples, errors,
  }, null, 2));
  console.log(JSON.stringify({ label, views: results.map(({ id }) => id), errors }));
} finally {
  await browser.close();
}
