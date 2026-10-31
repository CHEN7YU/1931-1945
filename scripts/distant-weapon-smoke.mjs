import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'distant-weapons');
await mkdir(directory, { recursive: true });
const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const url = new URL('/__distant-weapon-check', base).href;
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { mergeGeometries } = await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
    const { configureRifleMaterials, rifleWorldModel } = await import('/src/rifle-model.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { dadaoModel } = await import('/src/dadao-model.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    const { createDistantPoseGeometry, createDistantWeaponGeometry, DISTANT_WEAPON_TRIANGLE_BUDGET } = await import('/src/distant-pose-lod.js');
    await configureRifleMaterials(1); await loadDadaoSurfaces(1);
    const warm = new T.SphereGeometry(1, 8, 4);
    (await createDistantPoseGeometry(warm)).dispose(); warm.dispose();
    const renderer = new T.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); renderer.setClearColor(0, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x555566, 2));
    const sun = new T.DirectionalLight(0xffffff, 2); sun.position.set(-2, 4, 3); scene.add(sun);
    const camera = new T.PerspectiveCamera(72, 1280 / 720, .03, 200);
    const flat = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide });
    const pixels = new Uint8Array(1280 * 720 * 4), results = [], images = [];
    const mask = root => {
      for (const mesh of root.children) mesh.material = flat;
      renderer.render(scene, camera);
      renderer.getContext().readPixels(0, 0, 1280, 720, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
      const points = [];
      for (let pixel = 0; pixel < 1280 * 720; pixel++) if (pixels[pixel * 4 + 3]) points.push(pixel);
      return points;
    };
    const coverage = (a, b) => {
      const target = new Set(b);
      return a.filter(pixel => {
        const x = pixel % 1280, y = Math.floor(pixel / 1280);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx >= 0 && x + dx < 1280 && y + dy >= 0 && y + dy < 720 &&
            target.has((y + dy) * 1280 + x + dx)) return true;
        }
        return false;
      }).length / Math.max(1, a.length);
    };
    for (const key of ['rifle', 'rifle-bayonet', 'sniper', 'zb26', 'type11', 'dadao']) {
      const model = key === 'dadao' ? dadaoModel()
        : rifleWorldModel('far', createRifleState(key === 'rifle-bayonet' ? 'rifle' : key), { bayonet: key === 'rifle-bayonet' });
      model.updateMatrixWorld(true);
      const batches = new Map(), original = new T.Group(), coarse = new T.Group();
      model.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
        if (transformed.index) transformed.dispose();
        if (!batches.has(mesh.material)) batches.set(mesh.material, []);
        batches.get(mesh.material).push(geometry);
      });
      const sourceTriangles = [...batches.values()].flat()
        .reduce((sum, geometry) => sum + geometry.attributes.position.count / 3, 0);
      const retainedOriginal = sourceTriangles <= DISTANT_WEAPON_TRIANGLE_BUDGET;
      let triangles = 0, reducedTriangles = 0, bytes = 0, reducedBytes = 0;
      for (const [material, parts] of batches) {
        const geometry = mergeGeometries(parts), reduced = retainedOriginal ? geometry.clone() : createDistantWeaponGeometry(geometry);
        parts.forEach(part => part.dispose());
        original.add(new T.Mesh(geometry, material)); coarse.add(new T.Mesh(reduced, material));
        triangles += geometry.attributes.position.count / 3;
        reducedTriangles += (reduced.index?.count ?? reduced.attributes.position.count) / 3;
        bytes += Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
        reducedBytes += (reduced.index?.array.byteLength ?? 0) + Object.values(reduced.attributes)
          .reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
      }
      const center = new T.Box3().setFromObject(original).getCenter(new T.Vector3()), views = [];
      const materials = original.children.map(mesh => mesh.material);
      for (const distance of [32, 60]) for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        camera.position.copy(center).add(new T.Vector3(Math.sin(angle) * distance, .1, Math.cos(angle) * distance));
        camera.lookAt(center); scene.add(original); const a = mask(original); scene.remove(original);
        scene.add(coarse); const b = mask(coarse); scene.remove(coarse);
        views.push({ distance, angle, originalPixels: a.length, coarsePixels: b.length,
          originalCoveredWithinOnePixel: coverage(a, b), coarseCoveredWithinOnePixel: coverage(b, a) });
      }
      camera.position.copy(center).add(new T.Vector3(1.2, .5, 1.2)); camera.lookAt(center);
      for (const [index, root] of [original, coarse].entries()) {
        root.children.forEach((mesh, part) => { mesh.material = materials[part]; });
        scene.add(root); renderer.render(scene, camera);
        images.push({ key, version: index ? 'coarse' : 'original',
          png: renderer.domElement.toDataURL('image/png').split(',')[1] });
        scene.remove(root);
      }
      results.push({ key, triangles, reducedTriangles, ratio: reducedTriangles / triangles,
        bytes, reducedBytes, retainedOriginal, materialBatches: batches.size, views });
      for (const mesh of [...original.children, ...coarse.children]) mesh.geometry.dispose();
    }
    const glError = renderer.getContext().getError();
    flat.dispose(); renderer.dispose();
    return { results, images, glError, measurement: 'Functional silhouettes at 1280x720, 72-degree FOV, 32/60m, four angles. One-pixel coverage is not pixel equality. Saved material images are deliberately magnified inspection views, not LOD-distance acceptance. Synchronous readback is used only here, never in performance sampling.' };
  });
  for (const image of result.images) await writeFile(join(directory, `${image.key}-${image.version}.png`), Buffer.from(image.png, 'base64'));
  delete result.images;
  await writeFile(join(directory, 'results.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []); assert.equal(result.glError, 0);
  for (const model of result.results) {
    if (model.retainedOriginal) assert.equal(model.ratio, 1);
    else assert.ok(model.ratio < .55, `${model.key}: insufficient triangle reduction (${model.ratio})`);
    for (const view of model.views) {
      if (view.originalPixels === 0) {
        assert.equal(view.coarsePixels, 0, `${model.key}: an edge-on invisible source must stay invisible`);
        continue;
      }
      assert.ok(view.coarsePixels > 0, `${model.key}: weapon disappeared`);
      assert.ok(view.originalCoveredWithinOnePixel >= .98 && view.coarseCoveredWithinOnePixel >= .98,
        `${model.key}: silhouette changed beyond one pixel (${JSON.stringify(view)})`);
    }
  }
  console.log(JSON.stringify({ passed: true, directory, models: result.results.map(({ key, triangles, reducedTriangles }) => ({ key, triangles, reducedTriangles })) }));
} finally {
  await browser.close();
}
