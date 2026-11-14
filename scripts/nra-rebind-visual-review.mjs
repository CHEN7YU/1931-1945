import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const baseline = process.env.REBIND_BASELINE === '1';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (baseline) await page.route('**/src/nra-character.js*', async route => {
    const response = await route.fetch();
    const current = 'for (const leg of animatedLegs) { leg.bone.quaternion.copy(leg.rotation); leg.bone.position.copy(leg.position); }';
    const previous = 'for (const leg of animatedLegs) { leg.rotation.copy(leg.bone.quaternion); leg.position.copy(leg.bone.position); }';
    const source = await response.text();
    if (!source.includes(current)) throw new Error('Cannot reconstruct the pre-fix bind');
    await route.fulfill({ response, body: source.replace(current, previous) });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5353', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const template = await loadNraCharacter(() => 0), scene = new THREE.Scene();
    scene.background = new THREE.Color(0x92958f);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(-2, 4, 5); scene.add(light);
    const camera = new THREE.PerspectiveCamera(35, 900 / 720, .1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(900, 720); document.body.replaceChildren(renderer.domElement);
    const actors = [0, 1].map(index => {
      const actor = { id: 'review-' + index, team: 'friendly', friendly: true, health: 100,
        formation: { memberCount: 11 }, index, position: new THREE.Vector3(index * 2, 0, 0),
        heading: index, walkPhase: 0, stance: 'standing', rifle: createRifleState(),
        locomotion: { speed: 4.1, mode: 'sprint' } };
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
      for (let i = 0; i < 80; i++) {
        actor.position.z -= 4.1 / 60; advanceNraMotion(actor, 1 / 60);
      }
      return actor;
    });
    const view = template.createView(); scene.add(view.root);
    const sample = actor => {
      camera.position.set(actor.position.x, 1.25, actor.position.z + 3.2);
      camera.lookAt(actor.position.x, .95, actor.position.z);
      view.bind(actor.id); view.update(actor, 2, null);
      renderer.render(scene, camera);
      let mesh;
      view.root.traverse(node => { if (!mesh && node.isSkinnedMesh) mesh = node; });
      return { spine: mesh.skeleton.bones.find(bone => bone.name === 'Spine').position.toArray(),
        issue: view.issue, leftError: view.snapshot.riflePose.left.error,
        image: renderer.domElement.toDataURL('image/png').split(',')[1] };
    };
    const initial = sample(actors[1]);
    let final;
    for (let i = 0; i < 30; i++) final = sample(actors[i % 2]);
    return { initial, final };
  });
  for (const phase of ['initial', 'final']) {
    await writeFile(join(directory, `${phase}.png`), Buffer.from(result[phase].image, 'base64'));
    delete result[phase].image;
  }
  await writeFile(join(directory, 'results.json'), JSON.stringify({ baseline, result, errors,
    fixture: 'isolated production character renderer; synthetic stationary simulation state after running; repeated view rebinds; not a natural battle' }, null, 2));
  assert.deepEqual(errors, []);
  if (baseline) assert.ok(result.final.leftError > .05);
  else assert.ok(result.final.leftError < .001 && result.final.issue === null);
  console.log(JSON.stringify({ baseline, initial: result.initial, final: result.final }));
} finally {
  await browser.close();
}
