import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'individual-appearance');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], observations = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5173/?benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.historicalForce?.assigned === 110);
  const initial = await page.evaluate(() => window.__battle.historicalForce);
  const keys = new Map(initial.members.map(member => [member.id, member.appearance.key]));
  assert.ok(new Set(keys.values()).size >= 40);
  assert.equal(new Set(initial.members.map(member => member.appearance.face)).size, 8);
  assert.ok(initial.views.every(view => view.appearance?.key === keys.get(view.actorId)));
  observations.push({ stage: 'actual-110-appearances', force: initial });
  await page.screenshot({ path: join(directory, 'individual-squad.png') });
  await page.keyboard.press('y');
  await page.keyboard.down('s');
  const time = await page.evaluate(() => window.__battle.time);
  await page.waitForFunction(time => window.__battle.time >= time + 3, time);
  await page.keyboard.up('s');
  const after = await page.evaluate(() => ({ force: window.__battle.historicalForce, renderer: window.__battle.performance }));
  for (const member of after.force.members) assert.equal(member.appearance.key, keys.get(member.id));
  for (const view of after.force.views.filter(view => view.soldier.health > 0)) {
    assert.equal(view.appearance.key, keys.get(view.actorId)); assert.equal(view.issue, null);
    const actual = view.riflePose.muzzle, logical = view.logicalMuzzle;
    assert.ok(Math.hypot(actual[0] - logical.x, actual[1] - logical.y, actual[2] - logical.z) < 1e-4);
  }
  observations.push({ stage: 'identity-survives-control-and-distance', ...after });
  await page.screenshot({ path: join(directory, 'individuals-after-moving.png') });
  await page.close();

  const gallery = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  gallery.on('pageerror', error => errors.push(error.message));
  await gallery.route('http://127.0.0.1:5173/__appearance-gallery', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>',
  }));
  await gallery.goto('http://127.0.0.1:5173/__appearance-gallery');
  const portraits = await gallery.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraAppearance } = await import('/src/nra-appearance.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    await configureRifleMaterials();
    const template = await loadNraCharacter(), scene = new T.Scene(), observations = [];
    scene.background = new T.Color(0x69757c); scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-2, 3, -4); scene.add(light);
    for (let family = 0; family < 8; family++) {
      let actor;
      for (let seed = 0; seed < 1000; seed++) {
        const candidate = { id: `soldier-${seed}`, unitId: 'friendly-0' };
        const appearance = createNraAppearance(candidate);
        if (appearance.face === family) { actor = { ...candidate, avatarAppearance: appearance }; break; }
      }
      if (!actor) throw new Error('Missing deterministic face family');
      Object.assign(actor, { team: 'friendly', position: new T.Vector3((family % 4 - 1.5) * .55, family >= 4 ? -.55 : 0, 0),
        heading: 0, walkPhase: 0, health: 100, vehicleId: null, locomotion: { speed: 0 },
        rifle: { id: `rifle-${family}`, action: 'idle', elapsed: 0, ammo: 5 } });
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
      const view = template.createView(); view.bind(actor.id); view.update(actor, 0, null);
      view.root.traverse(node => {
        if (node.isMesh) node.visible = ['\u81c9\u90e8', '\u773c\u775b', '\u570b\u6c11\u9769\u547d\u8ecdM35\u92fc\u76d4'].includes(node.name);
      });
      scene.add(view.root); observations.push(view.snapshot.appearance);
    }
    const camera = new T.OrthographicCamera(-1.15, 1.15, .6982, -.6982, .03, 10);
    camera.position.set(0, 1.45, -4); camera.lookAt(0, 1.45, 0);
    const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1400, 850);
    renderer.toneMapping = T.ACESFilmicToneMapping; document.body.appendChild(renderer.domElement); renderer.render(scene, camera);
    return observations;
  });
  await gallery.screenshot({ path: join(directory, 'eight-face-families-diagnostic.png') });
  observations.push({ stage: 'internal-portrait-comparison-not-battle', portraits });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, directory, uniqueAppearances: new Set(keys.values()).size }));
} finally {
  await browser.close();
}
