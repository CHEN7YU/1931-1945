import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'walk-diagnostic');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 650 } });
  await page.route('**/assets/game/nra-88/animations.json', route => route.fulfill({ contentType: 'application/json',
    path: resolve(process.argv[2] ?? resolve('asset-research', 'nra-88', 'walking-candidate2'), 'animations.json') }));
  await page.route('http://127.0.0.1:5173/__walk-analysis', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>',
  }));
  await page.goto('http://127.0.0.1:5173/__walk-analysis');
  const observations = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    await configureRifleMaterials();
    const first = await loadNraCharacter(), scene = new T.Scene(), observations = [];
    scene.background = new T.Color(0x69757c); scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-2, 3, -4); scene.add(light);
    for (let index = 0; index < 5; index++) {
      const view = index === 0 ? first : first.createView(); scene.add(view.root);
      const actor = { id: `walk-${index}`, team: 'friendly', position: new T.Vector3((index - 2) * 1.1, 0, 0), heading: .2,
        health: 100, vehicleId: null, deathTime: 0, walkPhase: 0, locomotion: { speed: 1.75 },
        rifle: { action: 'idle', elapsed: 0, ammo: 5, shots: 0, id: `weapon-${index}` } };
      actor.nativeMotion = createNraMotion(view.motionProfile, actor);
      actor.nativeMotion.weight = 1; actor.nativeMotion.speed = 1.75;
      actor.nativeMotion.distance = index / 5 * view.motionProfile.walkStrideMeters;
      view.bind(actor.id); view.update(actor, 0, null); observations.push(view.snapshot);
    }
    const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1600, 650);
    renderer.toneMapping = T.ACESFilmicToneMapping; document.body.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(35, 1600 / 650, .02, 20);
    camera.position.set(0, 1.4, -5.7); camera.lookAt(0, .9, 0); renderer.render(scene, camera);
    return observations;
  });
  await page.screenshot({ path: join(directory, 'five-walk-phases.png') });
  await writeFile(join(directory, 'observations.json'), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify({ directory, issues: observations.map(item => item.issue) }));
} finally {
  await browser.close();
}
