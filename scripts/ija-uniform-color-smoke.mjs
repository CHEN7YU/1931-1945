import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5187';
const out = process.env.ARTIFACT_DIR;
const expected = process.env.EXPECTED_CLOTH || '927c42';
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__ija-color-inspection', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>' }));
  await page.goto(new URL('/__ija-color-inspection', origin).href);
  const result = await page.evaluate(async expectedColor => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { HDRLoader } = await import('/node_modules/three/examples/jsm/loaders/HDRLoader.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createDaylight } = await import('/src/lighting.js');
    await configureRifleMaterials();
    const template = await loadIjaCharacter(), scene = new THREE.Scene();
    scene.background = new THREE.Color('#a8aba5');
    const camera = new THREE.PerspectiveCamera(32, 4 / 3, .05, 100);
    camera.position.set(0, 1.15, -4.7); camera.lookAt(0, 1.0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 900); renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const environment = await new HDRLoader().loadAsync('/assets/sky.hdr');
    const generator = new THREE.PMREMGenerator(renderer), pmrem = generator.fromEquirectangular(environment);
    scene.environment = pmrem.texture;
    const sun = new THREE.DirectionalLight();
    sun.position.set(-55, 70, 38); scene.add(sun);
    const hemisphere = new THREE.HemisphereLight(); scene.add(hemisphere);
    const fog = new THREE.FogExp2(0xb7b6af, .0035); scene.fog = fog;
    const daylight = createDaylight(scene, sun, hemisphere, fog);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: '#72746a', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;overflow:hidden';
    document.body.append(renderer.domElement);
    const levels = [];
    for (const [index, level] of ['near', 'far'].entries()) {
      const view = level === 'near' ? template.createView() : template.createFarView();
      const actor = { id: `color-${level}`, team: 'enemy', unitId: 'color-inspection',
        heading: 0, position: new THREE.Vector3(index ? -.62 : .62, 0, 0), walkPhase: 0,
        stance: 'standing', locomotion: { speed: 0 }, health: 100,
        vehicleId: null, deathTime: 0, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(view.motionProfile, actor);
      view.bind(actor.id); view.update(actor, 0, null); scene.add(view.root);
      const colors = new Set(), cloth = new Set();
      view.root.traverseVisible(mesh => {
        if (!mesh.isSkinnedMesh) return;
        const color = mesh.material.color.getHexString();
        colors.add(color);
        if (color === expectedColor) cloth.add(mesh.material);
      });
      levels.push({ level, clothMaterials: cloth.size, colors: [...colors] });
    }
    const images = {};
    for (const cool of [false, true]) {
      daylight.setEnabled(cool); renderer.render(scene, camera);
      images[cool ? 'cool' : 'original'] = renderer.domElement.toDataURL('image/png');
    }
    generator.dispose(); environment.dispose();
    return { levels, images };
  }, expected);
  assert.deepEqual(errors, []);
  for (const level of result.levels) {
    assert.equal(level.clothMaterials, 1, `${level.level}: tunic and trousers share the intended cloth color`);
    for (const color of ['4e533e', '716b52', '696b50', '3c3025']) {
      assert.ok(level.colors.includes(color), `${level.level}: helmet, puttees, canvas and leather retain distinct colors`);
    }
  }
  if (out) {
    for (const [profile, image] of Object.entries(result.images)) {
      await writeFile(join(out, `ija-cloth-${profile}.png`), Buffer.from(image.split(',')[1], 'base64'));
    }
    await writeFile(join(out, 'ija-cloth-colors.json'), JSON.stringify(result.levels, null, 2));
  }
  console.log(`PASS: both production LODs use #${expected}; equipment colors unchanged; captured original/cool game daylight, exposure and sky environment.`);
} finally {
  await browser.close();
}
