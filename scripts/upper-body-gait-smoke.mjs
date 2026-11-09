import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__upper-gait', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__upper-gait', process.env.GAME_URL ?? 'http://127.0.0.1:5351/').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, nativeTravelLean } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const scene = new T.Scene(); scene.background = new T.Color('#b6bebb');
    scene.add(new T.HemisphereLight(0xfff4e1, 0x424b40, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(3, 8, -4); scene.add(light);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(55, 1280 / 720, .05, 100);
    camera.position.set(2.5, 1.4, -3); camera.lookAt(0, .9, 0);
    const samples = [], images = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0);
      for (const [mode, speed] of [['walk', 1.75], ['jog', 2.7], ['sprint', 4.1]]) {
        const view = template.createView(), actor = { id: `upper-${team}-${mode}`, team, index: 1,
          formation: { memberCount: 11 }, unitId: 'upper-body-inspection', health: 100, groundType: 'infantry',
          position: new T.Vector3(), heading: 0, stance: 'standing', firingPose: null, tactics: {},
          walkPhase: 0, locomotion: { speed, mode }, rifle: createRifleState() };
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        Object.assign(actor.nativeMotion, { weight: 1, speed, lowReady: 1, gaitAim: 0, gaitCharge: mode === 'sprint' ? 1 : 0 });
        actor.nativeMotion.bodyLean = nativeTravelLean(actor.nativeMotion);
        view.bind(actor.id); scene.add(view.root);
        const frames = [];
        for (let frame = 0; frame < 48; frame++) {
          actor.nativeMotion.gaitCycles = frame / 48;
          view.update(actor, frame / 60, null);
          const anatomy = view.anatomy, pose = view.snapshot.riflePose, muzzle = view.snapshot.logicalMuzzle;
          if (view.issue) throw new Error(`${team} ${mode} ${frame}: ${view.issue}`);
          if (Math.hypot(...pose.muzzle.map((v, i) => v - [muzzle.x, muzzle.y, muzzle.z][i])) > 1e-4)
            throw new Error('Locomotion separated the visible muzzle from its authoritative firing point');
          frames.push({ leftShoulder: anatomy.LeftArm.toArray(), rightShoulder: anatomy.RightArm.toArray(),
            leftElbow: anatomy.LeftForeArm.toArray(), rightElbow: anatomy.RightForeArm.toArray(),
            rightPalmError: pose.right.palmError, leftPalmError: pose.left.palmError });
          if ([12, 36].includes(frame)) {
            renderer.render(scene, camera);
            images.push({ name: `${team}-${mode}-${frame}.png`, data: renderer.domElement.toDataURL() });
          }
        }
        samples.push({ team, mode, frames }); scene.remove(view.root);
      }
    }
    renderer.dispose();
    return { samples, images };
  });
  await writeFile(join(directory, 'upper-body-gait.json'), JSON.stringify({ samples: result.samples, errors }, null, 2));
  for (const sample of result.samples) {
    const depth = sample.frames.map(f => f.leftShoulder[2] - f.rightShoulder[2]);
    assert.ok(Math.max(...depth) - Math.min(...depth) > .015, `${sample.team} ${sample.mode} shoulders actually counter-rotate`);
    for (const side of ['leftElbow', 'rightElbow']) {
      const ranges = [0, 1, 2].map(axis => {
        const values = sample.frames.map(f => f[side][axis]);
        return Math.max(...values) - Math.min(...values);
      });
      assert.ok(Math.hypot(...ranges) > .02, 'both arms move in 3D with the held weapon, not just legs');
    }
    assert.ok(sample.frames.every(f => f.rightPalmError < .005 && f.leftPalmError < .005));
  }
  for (const image of result.images)
    await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, nativeGaitCases: result.samples.length, coherentGripAndMuzzle: true }));
} finally {
  await browser.close();
}
