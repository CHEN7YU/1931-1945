import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'atlas-observations');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route('http://127.0.0.1:5173/__atlas-check', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>',
  }));
  await page.goto('http://127.0.0.1:5173/__atlas-check');
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraForceRenderer } = await import('/src/nra-force-renderer.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    await configureRifleMaterials();
    const template = await loadNraCharacter(), scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 1000 / 700, .03, 100);
    scene.background = new T.Color(0x69757c); scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-2, 3, -4); scene.add(light);
    const force = createNraForceRenderer(scene, camera, template);
    const bank = force.root.children.find(node => node.isInstancedMesh), atlas = bank.material.map.image;
    const atlasContext = atlas.getContext('2d'), comparisons = [];
    let offset = 0;
    template.root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
      if (mesh.name === '\u624b\u90e8') {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, image = material.map.image;
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const source = canvas.getContext('2d'); source.drawImage(image, 0, 0);
        for (let index = 0; index < 100; index += 7) {
          const uv = new T.Vector2().fromBufferAttribute(geometry.attributes.uv, index); material.map.transformUv(uv);
          const mapped = new T.Vector2().fromBufferAttribute(bank.geometry.attributes.uv, offset + index);
          const expected = [...source.getImageData(Math.min(image.width - 1, Math.floor(uv.x * image.width)),
            Math.min(image.height - 1, Math.floor(uv.y * image.height)), 1, 1).data];
          const actual = [...atlasContext.getImageData(Math.floor(mapped.x * atlas.width), Math.floor((1 - mapped.y) * atlas.height), 1, 1).data];
          comparisons.push({ expected, actual });
        }
      }
      offset += count;
    });
    const distant = new T.Mesh(bank.geometry, bank.material); distant.position.x = 1; scene.add(distant);
    const view = template.createView(), actor = { id: 'check', team: 'friendly', position: new T.Vector3(-1, 0, 0),
      heading: 0, walkPhase: 0, locomotion: { speed: 0 }, rifle: { action: 'idle', elapsed: 0, ammo: 5 }, health: 100, vehicleId: null };
    actor.nativeMotion = createNraMotion(template.motionProfile, actor); view.bind(actor.id); view.update(actor, 0, null); scene.add(view.root);
    camera.position.set(0, 1.3, -4.4); camera.lookAt(0, .95, 0);
    const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1000, 700);
    renderer.toneMapping = T.ACESFilmicToneMapping; document.body.appendChild(renderer.domElement); renderer.render(scene, camera);
    return { comparisons, atlasSize: atlas.width };
  });
  await page.screenshot({ path: join(directory, 'near-and-atlas.png') });
  const meanError = result.comparisons.reduce((sum, item) => sum + item.expected.slice(0, 3)
    .reduce((sum, value, channel) => sum + Math.abs(value - item.actual[channel]), 0), 0) / result.comparisons.length / 3;
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ ...result, meanError }, null, 2));
  assert.ok(result.comparisons.length >= 10);
  assert.ok(meanError < 18, `Distant hand colors differ from source by ${meanError}; do not accept white atlas borders`);
  console.log(JSON.stringify({ passed: true, directory, meanError }));
} finally {
  await browser.close();
}
