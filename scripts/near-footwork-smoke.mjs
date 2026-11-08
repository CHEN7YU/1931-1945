import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__near-footwork', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__near-footwork', process.env.GAME_URL ?? 'http://127.0.0.1:5341/').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const scene = new T.Scene(); scene.background = new T.Color('#b6bebb');
    scene.add(new T.HemisphereLight(0xfff4e1, 0x424b40, 2));
    const sun = new T.DirectionalLight(0xffffff, 2); sun.position.set(3, 8, -4); scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: 0x80786b }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(55, 1280 / 720, .05, 100);
    camera.position.set(3, 1.5, -3); camera.lookAt(0, .9, 0);
    const samples = [], images = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0);
      for (const stance of ['standing', 'crouched', 'kneeling', 'wallLeft']) {
        const view = template.createView(), actor = { id: `near-${team}-${stance}`, team, index: 2,
          formation: { memberCount: 11 }, unitId: 'footwork-inspection', health: 100, groundType: 'infantry',
          position: new T.Vector3(), heading: 0, stance: ['kneeling', 'crouched'].includes(stance) ? 'crouched' : 'standing',
          firingPose: stance === 'standing' || stance === 'crouched' ? null : stance, tactics: {},
          walkPhase: 0, locomotion: { speed: 0, mode: 'turn' }, rifle: createRifleState() };
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        if (stance !== 'standing') actor.nativeMotion.posture[stance] = 1;
        view.bind(actor.id); scene.add(view.root);
        let totalTravel = 0, maximumJump = 0, jumpFrame = null, last = null, maximumLift = 0;
        const stages = new Set(), lengths = new Map();
        for (let frame = 0; frame < 240; frame++) {
          actor.heading += (frame < 120 ? 1 : -1) * 1.5 / 60;
          advanceNraMotion(actor, 1 / 60); view.update(actor, frame / 60, null);
          const anatomy = view.anatomy, point = anatomy.LeftFoot;
          if (last) {
            const delta = point.distanceTo(last); totalTravel += delta;
            if (delta > maximumJump) { maximumJump = delta; jumpFrame = frame; }
          }
          last = point.clone();
          const gait = view.snapshot.gait.legPose;
          for (const side of ['left', 'right']) if (gait[side]) {
            stages.add(gait[side].phase);
            maximumLift = Math.max(maximumLift, gait[side].requestedLift);
          }
          for (const side of ['Left', 'Right']) for (const [a, b] of [['UpLeg', 'Leg'], ['Leg', 'Foot']]) {
            const key = side + a, length = anatomy[side + a].distanceTo(anatomy[side + b]);
            if (!lengths.has(key)) lengths.set(key, length);
            if (Math.abs(lengths.get(key) - length) > 1e-5) throw new Error('Nearby footwork changed original bone length');
          }
          if (frame === 90) {
            renderer.render(scene, camera);
            images.push({ name: `${team}-${stance}-near-turn.png`, data: renderer.domElement.toDataURL() });
          }
        }
        samples.push({ team, stance, totalTravel, maximumJump, jumpFrame, maximumLift, stages: [...stages],
          headY: view.anatomy.Head.y, actorDisplacement: actor.position.length() });
        scene.remove(view.root);
      }
    }
    renderer.dispose();
    return { samples, images };
  });
  for (const sample of result.samples) {
    assert.ok(sample.totalTravel > .1, JSON.stringify(sample));
    assert.ok(sample.maximumJump < .1, JSON.stringify(sample));
    assert.ok(sample.maximumLift > .02, JSON.stringify(sample));
    assert.ok(sample.stages.includes('turn-swing') && sample.stages.includes('turn-support'), JSON.stringify(sample));
    assert.equal(sample.actorDisplacement, 0);
    if (['kneeling', 'crouched'].includes(sample.stance)) assert.ok(sample.headY < 1.5, JSON.stringify(sample));
  }
  for (const image of result.images) await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  observations.push(...result.samples);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, nearbyNativeTurnCases: observations.length,
    note: 'Actual native skeletons at approximately four metres; pose inspection, not a natural battle FPS claim' }));
} finally {
  await writeFile(join(directory, 'near-footwork.json'), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
