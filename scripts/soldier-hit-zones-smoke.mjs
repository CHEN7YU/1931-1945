import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
let result = null;
try {
  await page.route('**/__hit-zone-inspection', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__hit-zone-inspection', process.env.GAME_URL ?? 'http://127.0.0.1:5173/').href);
  result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, syncNativeAimGoal } = await import('/src/nra-motion.js');
    const { FIRING_POSES } = await import('/src/combat-posture.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createSoldierHitSystem } = await import('/src/soldier-hit-zones.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { groundHeight } = await import('/src/ground.js');
    await configureRifleMaterials();
    const factories = { friendly: await loadNraCharacter(), enemy: await loadIjaCharacter() };
    const system = createSoldierHitSystem((actor, now) => factories[actor.team].sampleAnatomy(actor, now));
    const samples = [], scene = new T.Scene();
    scene.background = new T.Color('#626b66');
    scene.add(new T.HemisphereLight(0xfff5df, 0x38483a, 2.5));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-5, 9, -5); scene.add(light);
    const sphere = new T.SphereGeometry(1, 16, 12);
    const colors = { head: 0xff5555, torso: 0xffcc44, limb: 0x55ccff };
    for (const [team, factory] of Object.entries(factories)) {
      const view = factory.createView();
      for (const pose of ['standing', ...Object.keys(FIRING_POSES), 'transition', 'walk', 'run', 'sprint']) {
        for (const phase of [0, .3, .7]) for (const heading of [0, 1.1]) for (const ready of [false, true]) {
          const actor = { id: `${team}-${pose}-${phase}-${heading}`, team, friendly: team === 'friendly',
            unitId: 'inspection', health: 100, vehicleId: null, stance: FIRING_POSES[pose]?.stance ?? 'standing',
            firingPose: FIRING_POSES[pose] ? pose : null, position: new T.Vector3(0, groundHeight(0, 90), 90),
            heading, rifleReady: ready, walkPhase: .7, walkPoseReady: true, rifle: createRifleState(), deathTime: 0,
            locomotion: { speed: pose === 'sprint' ? 4.8 : pose === 'run' ? 3.15 : pose === 'walk' ? 1.75 : 0,
              mode: pose === 'sprint' ? 'sprint' : pose === 'run' ? 'jog' : pose === 'walk' ? 'walk' : 'idle' } };
          actor.nativeMotion = createNraMotion(factory.motionProfile, actor);
          Object.assign(actor.nativeMotion, { speed: actor.locomotion.speed, weight: actor.locomotion.speed ? 1 : 0,
            distance: phase * (pose === 'walk' ? 1.25 : 2.4), bodyLean: pose === 'sprint' ? .26 : pose === 'run' ? .2 : 0 });
          for (const key of Object.keys(FIRING_POSES)) actor.nativeMotion.posture[key] = key === pose ? 1 :
            pose === 'transition' && key === 'prone' ? .5 : 0;
          syncNativeAimGoal(actor);
          view.bind(actor.id); view.update(actor, 0, null);
          const rendered = view.anatomy, before = JSON.stringify(actor.nativeMotion);
          const sampled = factory.sampleAnatomy(actor, 0);
          const error = Math.max(...Object.keys(rendered).map(name => rendered[name].distanceTo(sampled[name])));
          const proxy = system.sync(actor, 0), centers = proxy.children.map(part => part.position.clone());
          system.sync(actor, 0);
          const drift = Math.max(...proxy.children.map((part, i) => part.position.distanceTo(centers[i])));
          const classify = (part, offset) => {
            const center = proxy.children.find(volume => volume.userData.bodyPart === part).position.clone();
            const origin = center.clone().add(offset);
            return system.raycast(actor, 0, origin, center.sub(origin).normalize(), new T.Raycaster())?.object.userData.hitZone ?? null;
          };
          const forward = new T.Vector3(0, 0, -1.5).applyAxisAngle(new T.Vector3(0, 1, 0), heading);
          const lateral = new T.Vector3(-1.5, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), heading);
          samples.push({ team, pose, phase, heading, ready, error, drift, issue: view.issue,
            fingerError: view.snapshot.riflePose.fingerError,
            barrelY: view.snapshot.riflePose.direction[1],
            head: classify('head', forward), torso: classify('torso', forward.clone().negate()),
            limb: classify('Left-shin', lateral), preserved: JSON.stringify(actor.nativeMotion) === before,
            renderedPreserved: Object.keys(rendered).every(name => rendered[name].distanceTo(view.anatomy[name]) < 1e-8) });
          if (!ready && heading === 0 && phase === 0 && ['standing', 'crouched', 'prone'].includes(pose)) {
            const row = team === 'friendly' ? 0 : 1, column = ['standing', 'crouched', 'prone'].indexOf(pose);
            const display = factory.createView();
            const shown = { ...actor, id: actor.id + '-display', position: new T.Vector3((column - 1) * 2.3, 0, row * 2.7) };
            shown.nativeMotion = { ...actor.nativeMotion, position: { x: shown.position.x, z: shown.position.z } };
            display.bind(shown.id); display.update(shown, 0, null); scene.add(display.root);
            const geometry = system.sync(shown, 0);
            for (const volume of geometry.children) {
              const mesh = new T.Mesh(sphere, new T.MeshBasicMaterial({ color: colors[volume.userData.hitZone],
                wireframe: true, transparent: true, opacity: .7, depthTest: false }));
              mesh.position.copy(volume.position); mesh.quaternion.copy(volume.quaternion); mesh.scale.copy(volume.scale);
              scene.add(mesh);
            }
          }
        }
      }
    }
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1600, 1000); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(42, 1.6, .05, 200);
    camera.position.set(6, 4, -9); camera.lookAt(0, .7, 1.4);
    renderer.render(scene, camera);
    return { samples, image: renderer.domElement.toDataURL('image/png') };
  });
  await writeFile(join(directory, 'anatomy-overlay.png'), Buffer.from(result.image.split(',')[1], 'base64'));
  for (const sample of result.samples) {
    assert.ok(sample.error < 1e-6 && sample.drift < 1e-6, JSON.stringify(sample));
    assert.ok(sample.preserved && sample.renderedPreserved, 'collision sampling cannot mutate simulation or the actual rendered pose');
    assert.equal(sample.issue, null, JSON.stringify(sample));
    if (['walk', 'run', 'sprint', 'standing'].includes(sample.pose)) {
      if (sample.ready) assert.ok(Math.abs(sample.barrelY) < .15, JSON.stringify(sample));
      else assert.ok(sample.barrelY < -.4, JSON.stringify(sample));
    }
    assert.equal(sample.head, 'head', JSON.stringify(sample));
    assert.equal(sample.torso, 'torso', JSON.stringify(sample));
    assert.equal(sample.limb, 'limb', JSON.stringify(sample));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, samples: result.samples.length, worstJointError: Math.max(...result.samples.map(sample => sample.error)) }));
} finally {
  await writeFile(join(directory, 'measurements.json'), JSON.stringify({ samples: result?.samples, errors }, null, 2));
  await browser.close();
}
