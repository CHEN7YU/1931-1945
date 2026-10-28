import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = new URL('/__uniform-variant-check', process.env.GAME_URL || 'http://127.0.0.1:5189');
const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } }), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/assets/game/nra-88/')) requests.push(request.url()); });
  await page.route(url.href, route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(url.href);
  const near = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraForceRenderer } = await import('/src/nra-force-renderer.js');
    const { createNraAppearance } = await import('/src/nra-appearance.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials();
    const template = await loadNraCharacter(), scene = new T.Scene();
    scene.background = new T.Color('#c6c7b9');
    scene.add(new T.HemisphereLight(0xffffff, 0x686a58, 1));
    const sun = new T.DirectionalLight(0xfff3df, 2.2); sun.position.set(-2, 4, -3); scene.add(sun);
    const camera = new T.PerspectiveCamera(32, 1300 / 900, .03, 200);
    camera.position.set(0, 1.10, -4.6); camera.lookAt(0, .9, 0);
    const lodCamera = camera.clone(), renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setSize(1300, 900); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const force = createNraForceRenderer(scene, lodCamera, template);
    const actor = (index, id, x) => {
      const person = { id, unitId: `friendly-${index}`, formation: { index }, team: 'friendly',
        position: new T.Vector3(x, 0, 0), heading: 0, health: 100, walkPhase: 0, vehicleId: null,
        locomotion: { speed: 0 }, rifle: { ...createRifleState(), id: `${id}:rifle` } };
      person.avatarAppearance = createNraAppearance(person);
      person.nativeMotion = createNraMotion(template.motionProfile, person);
      return person;
    };
    const people = [actor(0, 'gallery-A', .56), actor(5, 'gallery-B', -.56)];
    await force.prepare(renderer);
    force.update(people, 0, null, 'high'); renderer.render(scene, camera);
    window.__variantCheck = { T, force, people, actor, scene, camera, lodCamera, renderer };
    return force.snapshot;
  });
  assert.equal(near.near, 2);
  const a = near.views.find(view => view.appearance.uniform === 'A'), b = near.views.find(view => view.appearance.uniform === 'B');
  assert.equal(a.uniformParts.length, 0); assert.equal(b.uniformParts.length, 7);
  assert.ok(near.views.every(view => view.issue === null));
  if (out) await page.screenshot({ path: join(out, 'production-A-B-near.png') });
  const far = await page.evaluate(() => {
    const { force, people, scene, camera, lodCamera, renderer } = window.__variantCheck;
    lodCamera.position.set(0, 1.1, -50); lodCamera.lookAt(0, .9, 0);
    force.update(people, 0, null, 'low'); renderer.render(scene, camera);
    const banks = force.root.children.filter(node => node.isInstancedMesh);
    const active = banks.filter(bank => bank.count);
    const bank = active[0], skin = bank.geometry.attributes.nraSkinRegion;
    let unchangedSkinUv = true, changedClothUv = 0;
    const uv = bank.geometry.attributes.uv, alternate = bank.geometry.attributes.nraUniformUv;
    for (let index = 0; index < uv.count; index++) {
      const difference = Math.abs(uv.getX(index) - alternate.getX(index)) + Math.abs(uv.getY(index) - alternate.getY(index));
      if (skin.getX(index) > .5 && difference > 1e-7) unchangedSkinUv = false;
      if (skin.getX(index) === 0 && difference > 1e-5) changedClothUv++;
    }
    return { ...force.snapshot, bankCount: banks.length, unchangedSkinUv, changedClothUv,
      variants: active.flatMap(bank => [...bank.geometry.attributes.nraUniformVariant.array.slice(0, bank.count)]),
      atlasWidth: bank.material.map.image.width };
  });
  assert.equal(far.far, 2); assert.equal(far.bankCount, 30);
  assert.deepEqual(far.variants.slice().sort(), [0, 1]);
  assert.equal(far.unchangedSkinUv, true); assert.ok(far.changedClothUv > 10000);
  assert.ok(far.atlasWidth <= 4096);
  if (out) await page.screenshot({ path: join(out, 'production-A-B-far-magnified-diagnostic.png') });
  const replacement = await page.evaluate(() => {
    const { force, people, actor, scene, camera, lodCamera, renderer } = window.__variantCheck;
    force.remove([people[1]]);
    people[1] = actor(5, 'gallery-B-replacement', -.56);
    lodCamera.position.copy(camera.position); lodCamera.quaternion.copy(camera.quaternion);
    force.update(people, 1, null, 'high'); renderer.render(scene, camera);
    return force.snapshot;
  });
  assert.equal(replacement.views.find(view => view.actorId === 'gallery-B-replacement').appearance.uniform, 'B');
  assert.equal(replacement.views.find(view => view.actorId === 'gallery-B-replacement').uniformParts.length, 7);
  assert.equal(replacement.poolSize, 6);
  assert.equal(requests.filter(request => request.endsWith('/character.fbx')).length, 1);
  assert.deepEqual(errors, []);
  if (out) await writeFile(join(out, 'production-uniform-observations.json'), JSON.stringify({ near, far, replacement, errors, requests }, null, 2));
  console.log('PASS: real A/B skinned geometry, rendered per-instance atlas variants, unchanged skin, shared 30 banks and B replacement rebind.');
} finally { await browser.close(); }
