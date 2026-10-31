import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { baselineModuleSource } from './benchmark.mjs';

if (!process.env.BENCH_BASELINE_WORLD || !process.env.ARTIFACT_DIR) {
  throw new Error('Set BENCH_BASELINE_WORLD and ARTIFACT_DIR to preserve the reference and raw visual results');
}
const baseline = JSON.parse(await readFile(resolve(process.env.BENCH_BASELINE_WORLD), 'utf8'));
assert.equal(typeof baseline['src/battlefield.js'], 'string');
const directory = resolve(process.env.ARTIFACT_DIR, 'static-batches');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  await page.route(new URL('/__static-batch-check', base).href,
    route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.route(/\/src\/battlefield\.js\?reference(?:&|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: baselineModuleSource(baseline['src/battlefield.js'], await response.text()) });
  });
  await page.goto(new URL('/__static-batch-check', base).href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { makeWorld } = await import('/src/battlefield.js');
    const { makeWorld: reference } = await import('/src/battlefield.js?reference');
    const { loadSceneMaterials } = await import('/src/materials.js');
    const { configureSunShadow } = await import('/src/lighting.js');
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.toneMapping = T.ACESFilmicToneMapping;
    const materialScene = new T.Scene(), surface = await loadSceneMaterials(renderer, materialScene);
    const create = factory => {
      const scene = new T.Scene();
      scene.background = new T.Color(0xb7b6af); scene.fog = new T.FogExp2(0xb7b6af, .0035);
      scene.add(new T.HemisphereLight(0xc3d3e1, 0x766651, .6));
      const sun = new T.DirectionalLight(0xffefd5, 2.5);
      sun.position.set(-55, 70, 38); sun.castShadow = true; configureSunShadow(sun); scene.add(sun);
      const started = performance.now(), world = factory(scene, surface), preparationMs = performance.now() - started;
      return { scene, world, preparationMs };
    };
    const original = create(reference), current = create(makeWorld);
    const counts = fixture => {
      let meshes = 0, triangles = 0, bytes = 0;
      const groups = [];
      fixture.scene.traverse(object => {
        if (!object.isMesh) return;
        const geometry = object.geometry, count = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        meshes++; triangles += count;
        bytes += (geometry.index?.array.byteLength ?? 0)
          + Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
        if (count > 10000) groups.push({ source: object.material.userData.source ?? null,
          cell: object.userData.staticCell ?? null, triangles: count });
      });
      return { meshes, triangles, bytes, preparationMs: fixture.preparationMs, largeGroups: groups };
    };
    const authority = ({ world }) => ({ obstacles: world.obstacles, visibility: world.visibility,
      bridge: world.bridgeSurfaces, river: world.riverSurfaces,
      solids: world.solids.map(mesh => ({ position: [...mesh.geometry.attributes.position.array],
        index: mesh.geometry.index ? [...mesh.geometry.index.array] : null, matrix: [...mesh.matrixWorld.elements] })),
      doors: world.doorSystem.doors.map(door => ({ id: door.id, state: door.state })) });
    const camera = new T.PerspectiveCamera(72, 1280 / 720, .07, 700), views = [], images = [];
    const pixels = fixture => {
      renderer.render(fixture.scene, camera);
      const data = new Uint8Array(1280 * 720 * 4), gl = renderer.getContext();
      gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return { data, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        image: renderer.domElement.toDataURL('image/png').split(',')[1] };
    };
    for (const [name, eye, target] of [
      ['street-north', [0, 1.7, 42], [0, 1.7, -50]],
      ['street-south', [0, 1.7, 42], [0, 1.7, 100]],
      ['bridge', [8, 2, -7], [8, 2, -80]],
      ['west-forest', [-65, 2, -20], [-110, 5, -65]],
      ['east-forest', [65, 2, 15], [110, 5, -45]],
      ['overhead', [0, 100, 40], [0, 0, -30]],
    ]) {
      camera.position.set(...eye); camera.lookAt(...target);
      const a = pixels(original), b = pixels(current);
      let changedPixels = 0, changedOverOne = 0, maxChannelDifference = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        let difference = 0;
        for (let channel = 0; channel < 4; channel++) difference = Math.max(difference, Math.abs(a.data[i + channel] - b.data[i + channel]));
        if (difference) changedPixels++;
        if (difference > 1) changedOverOne++;
        maxChannelDifference = Math.max(maxChannelDifference, difference);
      }
      views.push({ name, changedPixels, changedOverOne, maxChannelDifference,
        original: { calls: a.calls, triangles: a.triangles }, current: { calls: b.calls, triangles: b.triangles } });
      images.push({ name: `${name}-original`, data: a.image }, { name: `${name}-current`, data: b.image });
    }
    return { original: counts(original), current: counts(current), views, images,
      authorityMatches: JSON.stringify(authority(original)) === JSON.stringify(authority(current)),
      glError: renderer.getContext().getError(),
      measurement: 'Functional pixel readback, not a timing benchmark. Unchanged geometry/materials, actual light shadow camera and six main-camera views.' };
  });
  const { images, ...metrics } = result;
  for (const image of images) await writeFile(join(directory, `${image.name}.png`), Buffer.from(image.data, 'base64'));
  await writeFile(join(directory, 'results.json'), JSON.stringify({ ...metrics, errors }, null, 2));
  assert.deepEqual(errors, []); assert.equal(result.glError, 0); assert.equal(result.authorityMatches, true);
  assert.equal(result.current.triangles, result.original.triangles);
  assert.equal(result.current.bytes, result.original.bytes);
  for (const view of result.views) assert.equal(view.changedOverOne, 0, `${view.name}: chunking changed visible geometry or shadows`);
  assert.ok(result.views.some(view => view.current.triangles < view.original.triangles * .8), 'chunking must actually eliminate submitted geometry');
  console.log(JSON.stringify({ passed: true, directory, original: result.original, current: result.current, views: result.views }));
} finally {
  await browser.close();
}
