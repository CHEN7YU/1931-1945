import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.ARTIFACT_DIR) throw new Error('Set a new ARTIFACT_DIR');
await mkdir(process.env.ARTIFACT_DIR, { recursive: false });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__distant-pose-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5191'}/__distant-pose-check`);
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createNraAtlas, mergeNraPose } = await import('/src/nra-atlas.js');
    const { bakeNraGeometry } = await import('/src/nra-force-renderer.js');
    const { createDistantPoseGeometry } = await import('/src/distant-pose-lod.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { isNraSkin } = await import('/src/nra-appearance.js');
    await configureRifleMaterials();
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(400, 400); renderer.setClearColor(0, 0);
    const results = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(), view = template.createFarView?.() ?? template;
      const actor = { id: 'lod-check', team, unitId: 'lod-unit', heading: 0, health: 100,
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
      const original = mergeNraPose(parts, atlas), started = performance.now(), coarse = await createDistantPoseGeometry(original);
      const record = { team, ...coarse.userData.distantPoseLod, preparationMs: performance.now() - started, views: [] };
      for (const geometry of [original, coarse]) {
        geometry.setAttribute('nraSkinTint', new T.InstancedBufferAttribute(new Float32Array([1, .9, .8]), 3));
        if (atlas.hasUniformVariants) geometry.setAttribute('nraUniformVariant', new T.InstancedBufferAttribute(new Float32Array([1]), 1));
      }
      const scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 1, .03, 100);
      scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
      const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-2, 3, -4); scene.add(light);
      const mesh = new T.InstancedMesh(original, atlas.material, 1);
      mesh.frustumCulled = false; mesh.setMatrixAt(0, new T.Matrix4()); scene.add(mesh);
      const gl = renderer.getContext();
      for (const [direction, angle] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
        camera.position.set(Math.sin(angle) * 31, 1.3, -Math.cos(angle) * 31); camera.lookAt(0, .95, 0);
        const pixels = [], images = [];
        for (const geometry of [original, coarse]) {
          mesh.geometry = geometry; renderer.render(scene, camera);
          const bytes = new Uint8Array(400 * 400 * 4);
          gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          pixels.push(bytes); images.push(renderer.domElement.toDataURL());
        }
        let union = 0, intersection = 0, difference = 0;
        for (let i = 0; i < pixels[0].length; i += 4) {
          const a = pixels[0][i + 3] > 127, b = pixels[1][i + 3] > 127;
          if (a || b) {
            union++; if (a && b) intersection++;
            for (let channel = 0; channel < 3; channel++) difference += Math.abs(pixels[0][i + channel] - pixels[1][i + channel]);
          }
        }
        record.views.push({ direction, foregroundPixels: union, silhouetteIou: intersection / union,
          normalizedColorDifference: difference / (union * 3 * 255), images });
      }
      record.glError = gl.getError(); results.push(record);
      parts.forEach(part => part.geometry.dispose());
      original.dispose(); coarse.dispose(); mesh.dispose(); atlas.material.dispose(); atlas.material.map?.dispose();
    }
    renderer.dispose(); return results;
  });
  for (const result of results) for (const view of result.views) {
    for (const [index, image] of view.images.entries()) {
      await writeFile(join(process.env.ARTIFACT_DIR, `${result.team}-${view.direction}-${index ? 'coarse' : 'original'}.png`),
        Buffer.from(image.split(',')[1], 'base64'));
    }
    delete view.images;
  }
  await writeFile(join(process.env.ARTIFACT_DIR, 'result.json'), JSON.stringify({ results, errors,
    limitation: 'Functional pixels of real idle poses at distance 31m, 400px/35deg; not bit-identical, not all poses, not performance or human visual approval.' }, null, 2));
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.ok(result.triangles < result.sourceTriangles * .6);
    assert.ok(result.error <= .003001); assert.equal(result.glError, 0);
    for (const view of result.views) {
      assert.ok(view.foregroundPixels > 20);
      assert.ok(view.silhouetteIou >= .9, `${result.team} ${view.direction}: silhouette ${view.silhouetteIou}`);
      assert.ok(view.normalizedColorDifference < .1, `${result.team} ${view.direction}: color ${view.normalizedColorDifference}`);
    }
  }
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
