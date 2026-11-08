import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__seated-contacts', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  const url = new URL('/__seated-contacts', process.env.GAME_URL ?? 'http://127.0.0.1:5339/');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  await page.goto(url.href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createCivilianCharacterFactory, updateCivilianAppearance } = await import('/src/civilian-character.js');
    const { advanceCivilianMotion } = await import('/src/civilian-motion.js');
    const factory = createCivilianCharacterFactory(), scene = new T.Scene();
    scene.background = new T.Color('#b6beba');
    scene.add(new T.HemisphereLight(0xfff5e0, 0x484e46, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-3, 7, 5); scene.add(light);
    const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: '#827c6c' }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 760); renderer.toneMapping = T.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(40, 1280 / 760, .05, 100);
    const people = [];
    for (const [index, pose] of [0, 1, 2, 3, 'cower'].entries()) {
      const person = factory.create(30 + index, index === 1 ? 'elderly' : 'adult', index % 2 ? 'woman' : 'man', 'none');
      person.position.set((index - 2) * 1.8, 0, 0); scene.add(person);
      Object.assign(person.userData, { ageGroup: index === 1 ? 'elderly' : 'adult', carrying: 'none',
        civilianId: index, walkPhase: 0, restPose: pose === 'cower' ? 3 : pose,
        restPoseWeight: pose === 'cower' ? 0 : 1, refugeeRestPoint: { x: person.position.x, z: 0 } });
      for (let frame = 0; frame < 100; frame++) advanceCivilianMotion(person,
        { dt: .05, now: frame * .05, moved: 0, mode: pose === 'cower' ? 'cower' : 'waiting' });
      people.push(person);
    }
    camera.position.set(-1, 3, -7); camera.lookAt(0, .6, 0);
    updateCivilianAppearance(people, camera, 'high'); renderer.render(scene, camera);
    window.seatedInspection = { renderer, scene, camera, people };
    return people.map(person => ({ contacts: person.userData.seatedContacts,
      position: person.position.toArray(), head: person.civilianHead.getWorldPosition(new T.Vector3()).toArray(),
      leftKnee: person.civilianSkin.joints.leftKnee.getWorldPosition(new T.Vector3()).toArray(),
      rightKnee: person.civilianSkin.joints.rightKnee.getWorldPosition(new T.Vector3()).toArray(),
      boneCount: person.civilianSkin.skeleton.bones.length }));
  });
  await page.screenshot({ path: join(directory, 'seated-knee-contacts.png') });
  for (const person of result) {
    assert.equal(person.boneCount, 13);
    for (const hand of Object.values(person.contacts.hands)) {
      assert.equal(hand.reachable, true); assert.ok(hand.error < .004, JSON.stringify(hand));
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'seated-contacts.json'), JSON.stringify({ result, errors,
    limitation: 'Real shared civilian geometry and final joint poses; isolated visual/contact verification, not natural battle performance.' }, null, 2));
  console.log(JSON.stringify({ passed: true, civilians: result.length, worstPalmError: Math.max(...result.flatMap(p => Object.values(p.contacts.hands).map(h => h.error))) }));
} finally { await browser.close(); }
