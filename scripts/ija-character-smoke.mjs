import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5187';
const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/__ija-inspection', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>' }));
  await page.goto(new URL('/__ija-inspection', origin).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { FIRING_POSES } = await import('/src/combat-posture.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { hasIjaRifleFlag } = await import('/src/ija-rifle-flag.js');
    await configureRifleMaterials();
    const template = await loadIjaCharacter();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#a8aba5');
    scene.add(new THREE.HemisphereLight(0xf7f4e9, 0x49463c, 2));
    const sunlight = new THREE.DirectionalLight(0xfff7e6, 3);
    sunlight.position.set(-4, 7, -5); scene.add(sunlight);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), new THREE.MeshStandardMaterial({ color: '#72746a', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    const camera = new THREE.PerspectiveCamera(36, 2, .05, 100);
    camera.position.set(1.5, 2.8, -8.5); camera.lookAt(0, .8, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1800, 900); renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;overflow:hidden';
    document.body.append(renderer.domElement);
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;top:24px;left:32px;font:18px sans-serif;color:#20251e';
    document.body.append(label);
    const states = [
      { name: 'idle', speed: 0, stance: 'standing' },
      { name: 'walk', speed: 1.75, stance: 'standing' },
      { name: 'run', speed: 3.15, stance: 'standing' },
      { name: 'crouched', speed: 0, stance: 'crouched' },
      { name: 'prone', speed: 0, stance: 'prone' },
    ];
    const measurements = [], sharing = [];
    for (const level of ['near', 'far']) {
      const entries = states.map((state, index) => {
        const view = level === 'near' ? template.createView() : template.createFarView();
        const actor = { id: `${level}-${state.name}`, team: 'enemy', unitId: 'inspection',
          heading: 0, position: new THREE.Vector3((index - 2) * 1.5, 0, 0), walkPhase: 0,
          stance: state.stance, locomotion: { speed: state.speed }, health: 100,
          vehicleId: null, deathTime: 0, rifle: createRifleState() };
        for (let seed = 0; seed < 1000; seed++) {
          actor.id = `${level}-${state.name}-${seed}`;
          if (hasIjaRifleFlag(actor) === (index % 2 === 0)) break;
        }
        actor.nativeMotion = createNraMotion(view.motionProfile, actor);
        actor.nativeMotion.speed = state.speed;
        actor.nativeMotion.weight = state.speed ? 1 : 0;
        actor.nativeMotion.posture = Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, state.stance === pose ? 1 : 0]));
        actor.nativeMotion.bodyLean = state.name === 'run' ? .2 : state.name === 'walk' ? .035 : 0;
        view.bind(actor.id); scene.add(view.root);
        return { actor, view, state };
      });
      for (let phase = 0; phase < 12; phase++) {
        for (const { actor, view, state } of entries) {
          actor.nativeMotion.distance = phase / 12 * (state.name === 'walk' ?
            view.motionProfile.walkStrideMeters : view.motionProfile.strideMeters);
          view.update(actor, phase / 12, null);
          const box = new THREE.Box3(), meshes = [];
          view.root.traverseVisible(mesh => {
            if (!mesh.isSkinnedMesh) return;
            mesh.computeBoundingBox();
            box.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
            meshes.push(mesh);
          });
          measurements.push({ level, state: state.name, phase, issue: view.issue,
            rifleFlag: view.snapshot.rifleFlag, expectedFlag: hasIjaRifleFlag(actor),
            flagParent: view.root.getObjectByName('ija-rifle-flag').parent === view.root.getObjectByName('bolt').parent,
            min: box.min.toArray(), max: box.max.toArray(), actor: actor.position.toArray() });
          if (phase === 0 && state.name === 'idle') {
            const clone = level === 'near' ? template.createView() : template.createFarView(), other = [];
            clone.bind('sharing'); clone.update({ ...actor, id: 'sharing' }, 0, null);
            clone.root.traverseVisible(mesh => { if (mesh.isSkinnedMesh) other.push(mesh); });
            sharing.push({ level, shared: meshes.every((mesh, index) =>
              mesh.geometry === other[index].geometry && mesh.material === other[index].material &&
              mesh.skeleton.bones[0] !== other[index].skeleton.bones[0]) });
          }
        }
      }
      label.textContent = `Production GLB / ${level} LOD / idle, walk, run, crouched, prone / visual inspection, not gameplay`;
      renderer.render(scene, camera);
      if (level === 'near') {
        window.__ijaNearImage = renderer.domElement.toDataURL('image/png');
      } else window.__ijaFarImage = renderer.domElement.toDataURL('image/png');
      for (const { view } of entries) scene.remove(view.root);
    }
    return { measurements, sharing };
  });
  assert.deepEqual(errors, []);
  assert.ok(result.sharing.every(item => item.shared), 'LOD views share geometry/materials but own their bones');
  for (const entry of result.measurements) {
    assert.equal(entry.rifleFlag, entry.expectedFlag, 'both LODs keep the same owned flag selection');
    assert.ok(entry.flagParent, 'flag follows the actual gun, including a future dropped-gun transform');
    assert.equal(entry.issue, null, `${entry.level} ${entry.state} phase ${entry.phase}: reachable rifle pose`);
    assert.ok([...entry.min, ...entry.max].every(Number.isFinite));
    assert.ok(entry.min[1] > -.15, `${entry.level} ${entry.state}: no substantial below-ground deformation`);
    assert.ok(entry.max[1] < 2.15, `${entry.level} ${entry.state}: correct human scale`);
    if (entry.state === 'idle') assert.ok(Math.abs(entry.max[1] - 1.683) < .003,
      `${entry.level}: measured helmet top must reflect the compact production asset`);
    for (const axis of [0, 2]) {
      assert.ok(entry.min[axis] > entry.actor[axis] - 1.8 && entry.max[axis] < entry.actor[axis] + 1.8);
    }
  }
  if (out) {
    for (const level of ['Near', 'Far']) {
      const image = await page.evaluate(name => window[`__ija${name}Image`], level);
      await writeFile(join(out, `ija-${level.toLowerCase()}-pose-inspection.png`), Buffer.from(image.split(',')[1], 'base64'));
    }
    await writeFile(join(out, 'ija-pose-measurements.json'), JSON.stringify(result, null, 2));
  }
  const failure = await browser.newPage();
  await failure.route('**/ija-1938/character.glb', route => route.fulfill({ status: 503, body: 'Asset unavailable' }));
  await failure.goto(new URL('/?benchmark=duel', origin).href);
  await failure.waitForFunction(() => !document.querySelector('#fatal').hidden, null, { timeout: 120000 });
  assert.match(await failure.locator('#fatal-message').innerText(), /503/);
  assert.equal(await failure.locator('#menu').isVisible(), false, 'missing production assets must not silently restore procedural enemies');
  console.log('PASS: actual GLB near/far geometry sharing, independent bones, 120 sampled animation/posture poses and explicit missing-asset failure.');
} finally {
  await browser.close();
}
