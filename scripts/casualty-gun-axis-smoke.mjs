import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__casualty-gun-axis', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body></body></html>' }));
  await page.goto(new URL('/__casualty-gun-axis', process.env.GAME_URL ?? 'http://127.0.0.1:5347/').href);
  const { samples, images } = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadIjaCharacter, createIjaForceRendererAsync } = await import('/src/ija-character.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraForceRendererAsync } = await import('/src/nra-force-renderer.js');
    const { createNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createCasualtyState } = await import('/src/casualties.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials(1);
    await loadDadaoSurfaces(1);
    const scene = new T.Scene();
    scene.background = new T.Color('#b5beb6');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-4, 7, -5); scene.add(light);
    const floor = new T.Mesh(new T.PlaneGeometry(12, 12), new T.MeshStandardMaterial({ color: '#818675' }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1000, 625); renderer.toneMapping = T.ACESFilmicToneMapping;
    const camera = new T.PerspectiveCamera(72, 1.6, .05, 100);
    camera.position.set(0, 1.5, -4); camera.lookAt(0, .4, 0); camera.updateMatrixWorld(true);
    const samples = [], images = [];
    for (const team of ['friendly', 'enemy']) {
    const factory = await (team === 'friendly' ? loadNraCharacter : loadIjaCharacter)(() => 0);
    const force = await (team === 'friendly' ? createNraForceRendererAsync : createIjaForceRendererAsync)(
      scene, camera, factory, 1, { lowMemory: true });
    const view = factory.createView();
    await force.prepare({ async compileAsync() {} });
    for (const weapon of ['rifle', 'type11']) for (const stance of ['standing', 'kneeling', 'prone'])
      for (let variant = 0; variant < 4; variant++) for (const retainGun of [false, true]) {
        const actor = { id: `dead-${team}-${weapon}-${stance}-${variant}`, unitId: 'dead-gun-inspection',
          team, index: 0, formation: { memberCount: 11 }, health: 100, vehicleId: null,
          groundType: 'infantry', position: new T.Vector3(), heading: .4, stance: stance === 'kneeling' ? 'crouched' : stance,
          firingPose: stance === 'standing' ? null : stance, walkPhase: 0, locomotion: { speed: 0, mode: 'idle' },
          rifle: createRifleState(weapon), rifleReady: false, tactics: {}, bayonet: { mode: 'idle', extension: 0 } };
        actor.nativeMotion = createNraMotion(factory.motionProfile, actor);
        if (stance !== 'standing') actor.nativeMotion.posture[stance] = 1;
        actor.health = 0; actor.casualty = createCasualtyState(actor, 0, sampleNraMotion(actor),
          { variant, retainGun });
        view.bind(actor.id); view.update(actor, 3, null);
        let gun = null; view.root.traverseVisible(node => {
          if (node.userData.personalWeapon && !node.userData.engineeringTool) gun = node;
        });
        view.root.updateMatrixWorld(true);
        const nearAxis = new T.Vector3(0, 0, -1).transformDirection(gun.matrixWorld);
        for (const distance of [4, 60]) {
          camera.position.z = -distance; camera.updateMatrixWorld(true);
          force.update([actor], 3, null, 'low', { detailLimit: 0 });
          const meshes = force.root.children.filter(node => node.isInstancedMesh && node.count &&
            node.name === `owned-weapon-${weapon}`);
          if (!meshes.length) throw new Error('Missing actual dead weapon instance');
          let minimum = Infinity, farAxis;
          for (const mesh of meshes) {
            const matrix = new T.Matrix4(); mesh.getMatrixAt(0, matrix);
            matrix.premultiply(mesh.matrixWorld);
            farAxis = new T.Vector3(0, 0, -1).transformDirection(matrix);
            const positions = mesh.geometry.attributes.position, point = new T.Vector3();
            for (let vertex = 0; vertex < positions.count; vertex++)
              minimum = Math.min(minimum, point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix).y);
          }
          samples.push({ team, weapon, stance, variant, retainGun, distance, minimum,
            nearAxis: nearAxis.toArray(), farAxis: farAxis.toArray() });
          if (weapon === 'rifle' && stance === 'prone' && variant === 2 && !retainGun && distance === 4) {
            renderer.render(scene, camera);
            images.push({ name: `${team}-settled-rifle.png`, data: renderer.domElement.toDataURL() });
          }
        }
      }
    scene.remove(force.root);
    for (const mesh of force.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
    }
    renderer.dispose();
    return { samples, images };
  });
  await writeFile(join(directory, 'dead-gun-directions.json'), JSON.stringify({ samples, errors }, null, 2));
  for (const image of images)
    await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  for (const sample of samples) {
    assert.ok(Math.abs(sample.nearAxis[1]) < .15, JSON.stringify(sample));
    assert.ok(Math.abs(sample.farAxis[1]) < .15, JSON.stringify(sample));
    if (!sample.retainGun) assert.ok(sample.minimum < .12, JSON.stringify(sample));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, actualDeadGunCases: samples.length }));
} finally { await browser.close(); }
