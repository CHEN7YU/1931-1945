import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SCENE_ART_MATERIALS } from '../src/scene-art.js';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
const out = process.env.ARTIFACT_DIR;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const assets = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('response', response => {
  const path = new URL(response.url()).pathname;
  if (response.status() >= 400) errors.push(`${response.status()}: ${path}`);
  if (response.ok() && path.startsWith('/assets/materials/ai-scene/')) assets.add(path);
});
try {
  await page.route('**/scenery-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Dry river and woodland - isolated visual fixture</title><style>body{margin:0}</style>',
  }));
  await page.goto(new URL('/scenery-fixture', origin).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { makeWorld } = await import('/src/battlefield.js');
    const { loadSceneMaterials } = await import('/src/materials.js');
    const { configureSunShadow, createDaylight } = await import('/src/lighting.js');
    const { woodlandLayout, woodlandTreeGeometry } = await import('/src/woodland.js');
    const scene = new THREE.Scene(), renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 900); renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    document.body.append(renderer.domElement);
    scene.fog = new THREE.FogExp2(0xb7b6af, .0035);
    const hemisphere = new THREE.HemisphereLight(0xc3d3e1, 0x766651, .6);
    const sun = new THREE.DirectionalLight(0xffefd5, 2.5);
    sun.position.set(-55, 70, 38); sun.castShadow = true; configureSunShadow(sun);
    scene.add(hemisphere, sun);
    const surface = await loadSceneMaterials(renderer, scene), world = makeWorld(scene, surface);
    createDaylight(scene, sun, hemisphere, scene.fog).setEnabled(true);
    const camera = new THREE.PerspectiveCamera(65, 1440 / 900, .07, 700);
    const render = (eye, target) => {
      camera.position.set(...eye); camera.lookAt(...target);
      renderer.render(scene, camera);
    };
    const trees = woodlandLayout(world.outskirts.buildings).map(tree => ({ ...tree, dead: true }));
    const tree = trees.find(tree => tree.x < 0 && tree.z < -25 && tree.z > -60);
    const treeView = (tree, aspect = 1440 / 900) => {
      camera.aspect = aspect; camera.updateProjectionMatrix();
      const target = new THREE.Vector3(tree.x, tree.height * .5, tree.z);
      const distance = Math.max(8, tree.height * (aspect < 1 ? 2.2 : 1.65));
      for (const offset of [0, .6, -.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
        const angle = (tree.x < 0 ? Math.PI : 0) + offset;
        const eye = new THREE.Vector3(tree.x + Math.cos(angle) * distance, 2.1, tree.z + Math.sin(angle) * distance);
        const direction = target.clone().sub(eye);
        const ray = new THREE.Raycaster(eye, direction.clone().normalize(), 0, direction.length() * .8);
        if (ray.intersectObjects(world.solids, false).length) continue;
        render(eye.toArray(), target.toArray());
        return;
      }
      throw new Error(`No unobstructed scenery camera for ${tree.species}`);
    };
    window.sceneryFixture = {
      river: () => { camera.aspect = 1440 / 900; camera.updateProjectionMatrix(); render([-63, 2.1, -11.8], [-15, -.4, -16]); },
      trees: () => treeView(tree),
      roots: () => {
        const sample = trees.find(tree => tree.species === 'elm' && tree.age === 'adult');
        if (!sample) throw new Error('Missing adult elm for ground-contact close-up');
        treeView(sample);
        const offset = camera.position.clone().sub(new THREE.Vector3(sample.x, 0, sample.z));
        offset.y = 0; offset.normalize().multiplyScalar(3.2);
        render([sample.x + offset.x, .95, sample.z + offset.z], [sample.x, .3, sample.z]);
      },
      varieties: () => {
        const study = new THREE.Scene();
        study.background = new THREE.Color(0xa6afa4); study.environment = scene.environment;
        study.environmentIntensity = scene.environmentIntensity;
        study.add(hemisphere.clone(), sun.clone());
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90),
          new THREE.MeshStandardMaterial({ color: 0x8d8979, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2; floor.position.y = -.035; floor.receiveShadow = true; study.add(floor);
        const species = ['elm', 'poplar', 'willow'], names = ['榆树型：横向展开', '杨树型：高耸窄冠', '柳树型：低冠垂枝'];
        for (const [index, kind] of species.entries()) {
          const sample = trees.find(tree => tree.species === kind && tree.age === 'adult');
          if (!sample) throw new Error(`Missing adult ${kind} in actual woodland`);
          const geometry = woodlandTreeGeometry(sample);
          const bark = surface(`bark-${kind}`);
          bark.vertexColors = true;
          const object = new THREE.Mesh(geometry.bark, bark);
          object.position.x = (index - 1) * 8;
          object.castShadow = object.receiveShadow = true; study.add(object);
          const label = document.createElement('div');
          label.textContent = names[index];
          label.style.cssText = `position:fixed;top:20px;left:${720 + (index - 1) * 1440 * 8 / 28}px;transform:translateX(-50%);padding:8px 12px;background:#20251ee0;color:#e5dfcd;font:18px sans-serif`;
          document.body.append(label);
        }
        const camera = new THREE.OrthographicCamera(-14, 14, 8.75, -8.75, .1, 150);
        camera.position.set(0, 8, 40); camera.lookAt(0, 6.4, 0);
        renderer.setViewport(0, 0, 1440, 900);
        renderer.render(study, camera);
      },
      stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    };
    window.sceneryFixture.river();
    const materials = new Map();
    let contactMask;
    scene.traverse(object => {
      if (!object.isMesh || !object.material?.userData?.source) return;
      const material = object.material, source = material.userData.source;
      if (!source.startsWith('bark-') && !['root-litter', 'dry-silt'].includes(source)) return;
      materials.set(source, { source, colorSpace: material.map.colorSpace,
        normalSpace: material.normalMap.colorSpace, roughnessSpace: material.roughnessMap.colorSpace });
      if (source !== 'root-litter') return;
      if (!object.geometry.attributes.uv1) throw new Error('Root contact mask lost its local UVs during batching');
      const texture = material.alphaMap, image = texture.image;
      const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
      const edges = [];
      for (let i = 0; i < image.width; i++) {
        for (const [x, y] of [[i, 0], [i, image.height - 1], [0, i], [image.width - 1, i]]) {
          edges.push(pixels[(y * image.width + x) * 4 + 1]);
        }
      }
      contactMask = { channel: texture.channel, colorSpace: texture.colorSpace, maxBorder: Math.max(...edges),
        center: pixels[(128 * image.width + 128) * 4 + 1] };
    });
    return { dryRiver: world.sceneArt.dryRiver, woodland: world.sceneArt.woodland,
      materials: [...materials.values()], contactMask, surfaces: world.riverSurfaces };
  });
  assert.ok(result.dryRiver.stones > 450);
  assert.ok(result.dryRiver.siltPatches > 15);
  assert.ok(result.woodland.trees >= 24);
  assert.equal(result.woodland.stands, 4);
  assert.equal(result.woodland.leafStyle, 'bare-branches');
  assert.equal(result.woodland.groundedTrees, result.woodland.trees);
  assert.equal(result.woodland.groundContact, 'root-litter');
  assert.equal(result.dryRiver.material, 'dry-silt');
  assert.ok(result.woodland.barkBatches <= result.woodland.stands * 3);
  for (const kind of ['elm', 'poplar', 'willow']) assert.equal(result.woodland.barkSources[kind], `bark-${kind}`);
  assert.equal(assets.size, Object.keys(SCENE_ART_MATERIALS).length * 3 + 1);
  assert.equal(result.materials.length, 5);
  for (const material of result.materials) {
    assert.equal(material.colorSpace, 'srgb');
    assert.equal(material.normalSpace, '');
    assert.equal(material.roughnessSpace, '');
  }
  assert.equal(result.contactMask.channel, 1);
  assert.equal(result.contactMask.colorSpace, '');
  assert.equal(result.contactMask.maxBorder, 0);
  assert.ok(result.contactMask.center > 160 && result.contactMask.center < 235, 'litter is visible at the root but never fully opaque');
  for (const species of ['elm', 'poplar', 'willow']) assert.ok(result.woodland.species[species] >= 3);
  assert.ok(result.woodland.saplings > 0);
  assert.equal(result.woodland.deadTrees, result.woodland.trees);
  assert.ok(result.woodland.maxHeight / result.woodland.minHeight > 3);
  const views = [];
  for (const view of ['river', 'trees', 'roots']) {
    const stats = await page.evaluate(view => {
      window.sceneryFixture[view]();
      return window.sceneryFixture.stats();
    }, view);
    views.push({ view, ...stats });
    if (out) {
      await mkdir(out, { recursive: true });
      await page.screenshot({ path: join(out, `scenery-${view}.png`) });
    }
    const callBudget = (view === 'roots' ? 110 : 99) + result.woodland.barkBatches - result.woodland.stands;
    assert.ok(stats.calls <= callBudget, `${view}: static scenery stays batched (${stats.calls}/${callBudget} calls)`);
  }
  await page.evaluate(() => window.sceneryFixture.varieties());
  if (out) await page.screenshot({ path: join(out, 'scenery-varieties.png') });
  assert.deepEqual(errors, [], 'no terrain, geometry, material or shader errors');
  if (out) await writeFile(join(out, 'scenery.json'), JSON.stringify({ ...result, views }, null, 2));
  console.log(`PASS: dry river and bare woodland render with local PBR materials; ${JSON.stringify(views)}. Isolated visual fixture, not a combat performance benchmark.`);
} finally {
  await browser.close();
}
