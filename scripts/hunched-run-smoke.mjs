import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const url = new URL('/__hunched-run', process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.route(url.href, route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><body style="margin:0;background:#202520"></body>' }));
  await page.goto(url.href);
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials(1);
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
    const camera = new T.PerspectiveCamera(50, 1100 / 800, .05, 30);
    camera.position.set(3.2, 1.6, -.2); camera.lookAt(0, .9, 0);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1100, 800); renderer.setClearColor(0x202520); document.body.append(renderer.domElement);
    const results = [], subjects = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const view = await load(), actor = { id: `run-${team}`, team, unitId: 'running-fixture', health: 100,
        heading: 0, walkPhase: .4, position: new T.Vector3(), stance: 'standing', groundType: 'infantry',
        locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(view.motionProfile, actor); view.bind(actor.id);
      scene.add(view.root); subjects.push({ team, view, actor });
      for (const speed of [1.75, 3.15, 4.8]) {
        actor.locomotion = { speed, mode: speed > 4 ? 'sprint' : speed > 2 ? 'jog' : 'walk' };
        for (let frame = 0; frame < 120; frame++) {
          actor.position.z -= speed / 60;
          advanceNraMotion(actor, 1 / 60);
        }
        actor.position.set(0, 0, 0); actor.nativeMotion.position = { x: 0, z: 0 };
        for (let phase = 0; phase < 12; phase++) {
          actor.nativeMotion.gaitCycles = phase / 12;
          view.update(actor, 0, null);
          const pose = sampleNraMotion(actor), snapshot = view.snapshot;
          results.push({ team, speed, phase, issue: view.issue, bodyLean: pose.bodyLean, hipDrop: pose.hipDrop,
            muzzleError: Math.hypot(...snapshot.riflePose.muzzle.map((value, index) =>
              value - [snapshot.logicalMuzzle.x, snapshot.logicalMuzzle.y, snapshot.logicalMuzzle.z][index])),
            rightPalmError: snapshot.riflePose.right.palmError, leftPalmError: snapshot.riflePose.left.palmError });
        }
      }
      view.root.visible = false;
    }
    window.renderHunchedRun = team => {
      for (const subject of subjects) {
        const { actor, view } = subject;
        if (subject.team !== team) { view.root.visible = false; continue; }
        actor.nativeMotion.gaitCycles = .22; view.update(actor, 0, null);
      }
      renderer.render(scene, camera);
    };
    return results;
  });
  for (const result of results) {
    assert.equal(result.issue, null, JSON.stringify(result));
    assert.ok(result.muzzleError < 1e-4);
    assert.ok(result.rightPalmError < .015 && result.leftPalmError < .015, JSON.stringify(result));
    if (result.speed === 3.15) assert.ok(result.bodyLean > .54 && result.hipDrop > .15);
    if (result.speed === 4.8) assert.ok(result.bodyLean > .70 && result.bodyLean < .73 && result.hipDrop > .18);
  }
  for (const team of ['friendly', 'enemy']) {
    await page.evaluate(team => window.renderHunchedRun(team), team);
    await page.screenshot({ path: join(directory, `${team}-run.png`) });
  }
  await writeFile(join(directory, 'poses.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, actualPoses: results.length, teams: 2 }));
} finally { await browser.close(); }
