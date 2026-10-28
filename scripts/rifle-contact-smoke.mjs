import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
let result = null;
try {
  await page.route('**/__rifle-contact-inspection', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__rifle-contact-inspection', process.env.GAME_URL ?? 'http://127.0.0.1:5173/').href);
  result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, syncNativeAimGoal } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { groundHeight } = await import('/src/ground.js');
    await configureRifleMaterials();
    const factories = { friendly: await loadNraCharacter(), enemy: await loadIjaCharacter() };
    const scene = new T.Scene(); scene.background = new T.Color('#b5beb6');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-4, 7, 85); scene.add(light);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1000, 1000); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const caption = document.createElement('div'); caption.style.cssText = 'position:fixed;left:20px;top:20px;font:18px sans-serif;color:#142118;background:#ffffffcc;padding:10px';
    document.body.append(caption);
    const camera = new T.PerspectiveCamera(34, 1, .05, 200), samples = [], images = [];
    for (const [team, factory] of Object.entries(factories)) for (const mode of ['shooting', 'running']) {
      const view = factory.createView(), ready = mode === 'shooting';
      const actor = { id: `${team}-${mode}`, team, unitId: 'inspection', health: 100, vehicleId: null,
        position: new T.Vector3(0, groundHeight(0, 90), 90), heading: 0, stance: 'standing',
        walkPhase: 1.2, rifleReady: ready, rifle: createRifleState(), deathTime: 0,
        locomotion: { speed: ready ? 0 : 3.15, mode: ready ? 'idle' : 'jog' } };
      actor.nativeMotion = createNraMotion(factory.motionProfile, actor);
      Object.assign(actor.nativeMotion, { speed: actor.locomotion.speed, weight: ready ? 0 : 1,
        bodyLean: ready ? .03 : .2, distance: .6 * factory.motionProfile.strideMeters });
      syncNativeAimGoal(actor);
      view.bind(actor.id); view.update(actor, 0, null); scene.add(view.root);
      const anatomy = view.anatomy, pose = view.snapshot.riflePose;
      const vector = values => new T.Vector3(...values);
      const stock = vector(pose.stock), rightShoulder = anatomy.RightArm;
      const direction = vector(pose.direction);
      samples.push({ team, mode, issue: view.issue, pose,
        stockError: stock.distanceTo(vector(pose.stockTarget)),
        shoulderDelta: stock.clone().sub(rightShoulder).toArray(),
        leftElbowX: anatomy.LeftForeArm.x, rightElbowX: anatomy.RightForeArm.x,
        leftWristX: anatomy.LeftHand.x, rightWristX: anatomy.RightHand.x,
        handSeparation: anatomy.LeftHand.distanceTo(anatomy.RightHand),
        supportAhead: anatomy.LeftHand.clone().sub(anatomy.RightHand).dot(direction),
        palmAhead: vector(pose.leftPalm).sub(vector(pose.rightPalm)).dot(direction),
        barrelY: direction.y, stockAboveMuzzle: stock.y - pose.muzzle[1] });
      for (const [angle, x, z] of [['front', -.65, 87.6], ['side', 2.2, 89.7]]) {
        camera.position.set(x, 1.55, z); camera.lookAt(.03, 1.28, 89.75);
        caption.textContent = `${team} / ${mode} / ${angle} — contact inspection, not gameplay`;
        renderer.render(scene, camera);
        const image = document.createElement('canvas'); image.width = image.height = 1000;
        const drawing = image.getContext('2d'); drawing.drawImage(renderer.domElement, 0, 0);
        drawing.fillStyle = '#ffffffdf'; drawing.fillRect(12, 12, 720, 42);
        drawing.fillStyle = '#142118'; drawing.font = '17px sans-serif'; drawing.fillText(caption.textContent, 22, 39);
        images.push({ name: `${team}-${mode}-${angle}.png`, data: image.toDataURL('image/png') });
      }
      scene.remove(view.root);
    }
    return { samples, images };
  });
  for (const image of result.images) await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  for (const sample of result.samples) {
    assert.equal(sample.issue, null, JSON.stringify(sample));
    assert.ok(sample.stockError < 1e-6);
    assert.ok(sample.handSeparation > .12 && sample.supportAhead > .075, JSON.stringify(sample));
    assert.ok(sample.leftElbowX < -.05 && sample.rightElbowX > .1, JSON.stringify(sample));
    if (sample.mode === 'shooting') {
      assert.ok(sample.palmAhead > .24, 'support palm must be on the forward fore-end, not next to the trigger hand');
      assert.ok(sample.shoulderDelta[1] > .02 && sample.shoulderDelta[1] < .08, JSON.stringify(sample));
      assert.ok(Math.abs(sample.barrelY) < .1);
    } else {
      assert.ok(sample.leftWristX < sample.rightWristX - .08, JSON.stringify(sample));
      assert.ok(sample.shoulderDelta[1] < -.04 && sample.shoulderDelta[1] > -.13, JSON.stringify(sample));
      assert.ok(sample.barrelY < -.5 && sample.stockAboveMuzzle > .4);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, samples: result.samples.map(sample => ({
    team: sample.team, mode: sample.mode, shoulderDelta: sample.shoulderDelta, handSeparation: sample.handSeparation, barrelY: sample.barrelY })) }));
} finally {
  await writeFile(join(directory, 'measurements.json'), JSON.stringify({ samples: result?.samples, errors }, null, 2));
  await browser.close();
}
