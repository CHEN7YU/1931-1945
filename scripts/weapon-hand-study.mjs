import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5213/');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  const result = await page.evaluate(async weapon => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createWeaponHands } = await import('/src/weapon-hands.js');
    const { rifleModel, updateRifleModel } = await import('/src/rifle-model.js');
    const { createRifleState, infantryWeaponProfile } = await import('/src/rifle-action.js');
    const factory = await loadNraCharacter(), hands = createWeaponHands(factory.createWeaponHand);
    const scene = new T.Scene(); scene.background = new T.Color('#66716c');
    scene.add(new T.HemisphereLight(0xe4efff, 0x7d715e, 2));
    const key = new T.DirectionalLight(0xffeedb, 3); key.position.set(-2, 4, 3); scene.add(key);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 900); renderer.toneMapping = T.ACESFilmicToneMapping;
    const eye = new T.PerspectiveCamera(48, 1.6, .025, 20); scene.add(eye);
    const state = createRifleState(weapon), gun = rifleModel(state), profile = infantryWeaponProfile(state);
    gun.position.set(...(profile.automatic ? [.18, -.265, -.14] : [0, -.05, -.2])); eye.add(gun);
    const views = [], samples = [];
    const phases = profile.automatic ? [['idle', 0], ['grip', .12], ['remove', .21], ['retrieve', .37],
      ['insert', .59], ['seat', .7], ['press', .82], ['return', .94]] : [['idle', 0], ['bolt', .34]];
    for (const [phase, elapsed] of phases) {
      state.action = phase === 'idle' ? 'idle' : profile.automatic ? 'reload' : 'cycle';
      state.ammo = phase === 'idle' ? profile.magazine : 0;
      state.elapsed = profile.automatic ? elapsed * profile.reloadSeconds : elapsed;
      updateRifleModel(gun, state); hands.update(gun, state);
      samples.push({ phase, hands: hands.snapshot });
      for (const view of ['first-person', 'front', 'side']) {
        let camera = eye;
        if (view !== 'first-person') {
          camera = new T.PerspectiveCamera(42, 1.6, .025, 20);
          camera.position.set(...(view === 'front' ? [0, -.08, -1.65] : [1.35, .02, -.45]));
          camera.lookAt(0, -.20, -.48);
        }
        renderer.render(scene, camera);
        views.push({ name: `${phase}-${view}.png`, image: renderer.domElement.toDataURL('image/png') });
      }
    }
    renderer.dispose();
    return { views, samples };
  }, process.env.WEAPON_MODEL ?? 'rifle');
  for (const view of result.views) await writeFile(join(directory, view.name), Buffer.from(view.image.split(',')[1], 'base64'));
  for (const sample of result.samples) for (const side of ['left', 'right']) assert.ok(sample.hands[side].arm.reachable);
  await writeFile(join(directory, 'study.json'), JSON.stringify(result.samples, null, 2));
  console.log('PASS: first-person/front/side native hand structure study (diagnostic, not combat).');
} finally { await browser.close(); }
