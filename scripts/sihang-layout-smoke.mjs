import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__sihang-layout', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__sihang-layout', process.env.GAME_URL ?? 'http://127.0.0.1:5345/').href);
  const data = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { makeSihangBattlefield } = await import('/src/sihang-battlefield.js');
    const { loadSceneMaterials } = await import('/src/materials.js');
    const { SIHANG_BRIDGE, SIHANG_EVACUATION, SIHANG_MAP_BOUNDS } = await import('/src/sihang-layout.js');
    const scene = new T.Scene(); scene.background = new T.Color(0xb6beb9);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    const surface = await loadSceneMaterials(renderer, scene, { lowMemory: true });
    const world = makeSihangBattlefield(scene, surface);
    scene.add(new T.HemisphereLight(0xe6e8d5, 0x545342, 2));
    const sun = new T.DirectionalLight(0xffffff, 2); sun.position.set(-45, 70, 30); scene.add(sun);
    renderer.setSize(1280, 900); document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(45, 1280 / 900, .1, 650);
    camera.position.set(-12, 190, 145); camera.lookAt(0, 0, (SIHANG_MAP_BOUNDS.minZ + SIHANG_MAP_BOUNDS.maxZ) / 2);
    renderer.render(scene, camera);
    const overview = renderer.domElement.toDataURL();
    camera.position.set(-12, 1.6, -23); camera.lookAt(-4, .03, -25);
    renderer.render(scene, camera);
    const capture = renderer.domElement.toDataURL(), ring = world.flags[0];
    camera.position.set(24, 4, -7); camera.lookAt(22, 3.5, 14); renderer.render(scene, camera);
    const street = renderer.domElement.toDataURL();
    const house = world.town.buildings.find(building => building.style === 'nanjing-residential-reused' && building.z < -55);
    if (!house) throw new Error('Missing north residential review building');
    camera.position.set(house.x + 14, house.height + 5, house.z - 18);
    camera.lookAt(house.x, house.height * .6, house.z); renderer.render(scene, camera);
    const roofs = renderer.domElement.toDataURL();
    const probe = new T.Mesh(ring.geometry, ring.material);
    const emptyCenter = new T.Raycaster(new T.Vector3(0, 0, 1), new T.Vector3(0, 0, -1)).intersectObject(probe);
    renderer.dispose();
    return { overview, capture, street, roofs, ring: { name: ring.name, type: ring.geometry.type, emptyCenter: emptyCenter.length === 0 },
      bridge: SIHANG_BRIDGE, evacuation: SIHANG_EVACUATION, geometry: world.staticRendering,
      city: world.sceneArt.city, mapBounds: world.mapBounds };
  });
  assert.equal(data.ring.type, 'RingGeometry'); assert.equal(data.ring.emptyCenter, true);
  assert.ok(data.bridge.southX > data.bridge.northX && data.bridge.southZ > data.bridge.northZ);
  assert.ok(data.city.usableGroundFloors >= 50);
  assert.ok(data.geometry.triangles < 40000); assert.deepEqual(errors, []);
  await writeFile(join(directory, 'sihang-overhead-current.png'), Buffer.from(data.overview.split(',')[1], 'base64'));
  await writeFile(join(directory, 'sihang-ground-capture-ring.png'), Buffer.from(data.capture.split(',')[1], 'base64'));
  for (const name of ['street', 'roofs'])
    await writeFile(join(directory, `sihang-${name}.png`), Buffer.from(data[name].split(',')[1], 'base64'));
  delete data.overview; delete data.capture; delete data.street; delete data.roofs;
  await writeFile(join(directory, 'layout-observations.json'), JSON.stringify({ ...data, errors,
    note: 'Actual authored map geometry, original reference layout adaptation; not a historical survey or natural battle performance check' }, null, 2));
  console.log(JSON.stringify({ passed: true, buildings: data.city.usableGroundFloors, triangles: data.geometry.triangles }));
} finally { await browser.close(); }
