import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const output = process.env.ARTIFACT_DIR;
if (!output) throw new Error('ARTIFACT_DIR is required');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/__ija-flag-check', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__ija-flag-check', process.env.GAME_URL || 'http://127.0.0.1:5197').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { configureRifleMaterials, rifleWorldModel } = await import('/src/rifle-model.js');
    const { createIjaRifleFlag, bakeIjaRifleFlag, updateIjaRifleFlagTime } = await import('/src/ija-rifle-flag.js');
    const { bakeNraGeometry } = await import('/src/nra-force-renderer.js');
    await configureRifleMaterials();
    const scene = new T.Scene(); scene.background = new T.Color('#a5b1b2');
    scene.add(new T.HemisphereLight(0xfff8e9, 0x57616a, 2));
    const light = new T.DirectionalLight(0xfff8e9, 3);
    light.position.set(-2, 5, 3); light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(light);
    const floor = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshStandardMaterial({ color: '#666c62' }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1500, 900); renderer.shadowMap.enabled = true;
    renderer.toneMapping = T.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(36, 1500 / 900, .05, 100);
    camera.position.set(1.4, 2.4, 5.2); camera.lookAt(0, 1.45, -.25);
    const pins = [], rotations = [[0, 0, 0], [.8, .2, 0], [-.3, .2, .8], [1.5, 0, 1.5]];
    for (const [row, y] of [[0, 2.1], [1, .95]]) for (let column = 0; column < rotations.length; column++) {
      const gun = rifleWorldModel(), flag = createIjaRifleFlag();
      gun.position.set((column - 1.5) * 1.15, y, 0); gun.rotation.set(...rotations[column]); gun.add(flag);
      scene.add(gun); gun.updateMatrixWorld(true);
      const pin = flag.getWorldPosition(new T.Vector3());
      pins.push({ row, column, pin: pin.toArray() });
      if (row === 1) {
        const geometry = bakeIjaRifleFlag(bakeNraGeometry(flag), flag);
        const instance = new T.InstancedMesh(geometry, flag.material, 1);
        instance.customDepthMaterial = flag.customDepthMaterial; instance.customDistanceMaterial = flag.customDistanceMaterial;
        instance.setMatrixAt(0, new T.Matrix4()); instance.count = 1; instance.castShadow = true;
        scene.add(instance); flag.visible = false;
      }
    }
    const context = renderer.getContext();
    const draw = time => {
      updateIjaRifleFlagTime(time); renderer.render(scene, camera);
      const pixels = new Uint8Array(1500 * 900 * 4);
      context.readPixels(0, 0, 1500, 900, context.RGBA, context.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const first = draw(0), before = renderer.domElement.toDataURL('image/png');
    const second = draw(.65), after = renderer.domElement.toDataURL('image/png');
    const paused = draw(.65), reset = draw(0);
    let changed = 0, pausedChanged = 0, resetChanged = 0;
    for (let index = 0; index < first.length; index += 4) {
      if ([0, 1, 2].some(channel => Math.abs(first[index + channel] - second[index + channel]) > 4)) changed++;
      if ([0, 1, 2].some(channel => paused[index + channel] !== second[index + channel])) pausedChanged++;
      if ([0, 1, 2].some(channel => reset[index + channel] !== first[index + channel])) resetChanged++;
    }
    const stream = renderer.domElement.captureStream(30), chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3000000 });
    const video = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = event => reject(new Error(event.error?.message || 'Cloth preview recording failed'));
      recorder.onstop = async () => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Cloth preview recording could not be read'));
        reader.readAsDataURL(new Blob(chunks, { type: mimeType }));
      };
    });
    recorder.start();
    await new Promise(resolve => {
      let start = null;
      const animate = timestamp => {
        start ??= timestamp;
        const elapsed = (timestamp - start) / 1000;
        updateIjaRifleFlagTime(elapsed); renderer.render(scene, camera);
        if (elapsed < 3) requestAnimationFrame(animate);
        else resolve();
      };
      requestAnimationFrame(animate);
    });
    recorder.stop();
    const recording = await video;
    for (const track of stream.getTracks()) track.stop();
    return { before, after, recording, changed, pausedChanged, resetChanged, pins };
  });
  assert.deepEqual(errors, [], 'near, instanced and shadow cloth shaders must all compile');
  assert.ok(result.changed > 200, 'stationary rifles must show visible cloth movement');
  assert.equal(result.pausedChanged, 0, 'cloth freezes with simulation time');
  assert.equal(result.resetChanged, 0, 'cloth returns deterministically to the same simulated instant');
  for (const stage of ['before', 'after']) await writeFile(join(output, `soft-rifle-flags-${stage}.png`),
    Buffer.from(result[stage].split(',')[1], 'base64'));
  const recording = Buffer.from(result.recording.split(',')[1], 'base64');
  assert.ok(recording.length > 10000, 'soft-flag preview must contain a real rendered recording');
  await writeFile(join(output, 'soft-rifle-flags.webm'), recording);
  delete result.before; delete result.after; delete result.recording;
  await writeFile(join(output, 'soft-rifle-flags.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
