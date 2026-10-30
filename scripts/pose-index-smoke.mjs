import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baselineModuleSource } from './benchmark.mjs';

if (!process.env.ARTIFACT_DIR || !process.env.BENCH_BASELINE_ATLAS) throw new Error('Set ARTIFACT_DIR and BENCH_BASELINE_ATLAS');
await mkdir(process.env.ARTIFACT_DIR, { recursive: false });
const baseline = JSON.parse(await readFile(process.env.BENCH_BASELINE_ATLAS, 'utf8'))['src/nra-atlas.js'];
assert.equal(typeof baseline, 'string');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.GAME_URL || 'http://127.0.0.1:5173';
  await page.route('**/__pose-index-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(`${base}/__pose-index-check`);
  const transformed = await (await page.request.get(`${base}/src/nra-atlas.js`)).text();
  await page.route('**/__legacy-pose-atlas.js', route => route.fulfill({
    contentType: 'text/javascript', body: baselineModuleSource(baseline, transformed),
  }));
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createNraAtlas, mergeNraPose } = await import('/src/nra-atlas.js');
    const legacy = await import('/__legacy-pose-atlas.js');
    const { bakeNraGeometry } = await import('/src/nra-force-renderer.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { isNraSkin } = await import('/src/nra-appearance.js');
    await configureRifleMaterials();
    const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(400, 400);
    const results = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(), view = template.createFarView?.() ?? template;
      const actor = { id: 'index-check', team, unitId: 'index-unit', heading: 0, health: 100,
        position: new T.Vector3(), walkPhase: 0, locomotion: { speed: 0 }, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
      view.bind(actor.id); view.update(actor, 0, null);
      for (const attachment of view.optionalAttachments ?? []) attachment.mesh.visible = false;
      const atlas = createNraAtlas(view.root, view.uniformMaterials), parts = [];
      view.root.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        for (let parent = mesh.parent; parent; parent = parent.parent) if (parent.userData.personalWeapon) return;
        parts.push({ geometry: bakeNraGeometry(mesh), material: mesh.material,
          skin: isNraSkin(mesh.name) || mesh.userData.skinRegion === true });
      });
      const before = legacy.mergeNraPose(parts, atlas), after = mergeNraPose(parts, atlas);
      const restored = after.index ? after.toNonIndexed() : after.clone();
      let sameAttributes = true;
      for (const name of Object.keys(before.attributes)) {
        const left = new Uint32Array(before.attributes[name].array.buffer);
        const right = new Uint32Array(restored.attributes[name].array.buffer);
        sameAttributes &&= left.length === right.length && left.every((value, i) => value === right[i]);
      }
      const bytes = geometry => Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0);
      const record = { team, sameAttributes, trianglesBefore: before.attributes.position.count / 3,
        trianglesAfter: (after.index?.count ?? after.attributes.position.count) / 3,
        verticesBefore: before.attributes.position.count, verticesAfter: after.attributes.position.count,
        bytesBefore: bytes(before), bytesAfter: bytes(after), pixels: [] };
      for (const geometry of [before, after]) {
        geometry.setAttribute('nraSkinTint', new T.InstancedBufferAttribute(new Float32Array([1, .9, .8]), 3));
        if (atlas.hasUniformVariants) geometry.setAttribute('nraUniformVariant', new T.InstancedBufferAttribute(new Float32Array([1]), 1));
      }
      const scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 1, .03, 30);
      scene.background = new T.Color(0x69757c); scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
      const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-2, 3, -4); scene.add(light);
      const mesh = new T.InstancedMesh(before, atlas.material, 1); mesh.setMatrixAt(0, new T.Matrix4()); scene.add(mesh);
      for (const angle of [0, Math.PI / 2, Math.PI]) {
        camera.position.set(Math.sin(angle) * 4.4, 1.3, -Math.cos(angle) * 4.4); camera.lookAt(0, .95, 0);
        mesh.geometry = before; renderer.render(scene, camera); const original = renderer.domElement.toDataURL();
        mesh.geometry = after; renderer.render(scene, camera);
        record.pixels.push(original === renderer.domElement.toDataURL());
      }
      record.glError = renderer.getContext().getError();
      results.push(record);
      parts.forEach(part => part.geometry.dispose());
      before.dispose(); after.dispose(); restored.dispose(); mesh.dispose(); atlas.material.dispose(); atlas.material.map?.dispose();
    }
    renderer.dispose();
    return results;
  });
  await writeFile(join(process.env.ARTIFACT_DIR, 'result.json'), JSON.stringify({ results, errors,
    limitation: 'Functional readback with real far-character geometry; these timings are not performance samples.' }, null, 2));
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.ok(result.sameAttributes, `${result.team}: every original triangle attribute must match exactly`);
    assert.equal(result.trianglesBefore, result.trianglesAfter);
    assert.ok(result.verticesAfter < result.verticesBefore);
    assert.ok(result.bytesAfter < result.bytesBefore);
    assert.ok(result.pixels.every(Boolean), `${result.team}: all three real WebGL views must match exactly`);
    assert.equal(result.glError, 0);
  }
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
