import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.nightTransitionReview = {
        rememberCamera() {
          this.playerPosition = camera.position.clone(); this.playerQuaternion = camera.quaternion.clone();
        },
        cloudContinuity(previousHash = false) {
          const sky = scene.getObjectByName('sihang-night-sky');
          let shader = sky.material.fragmentShader;
          if (previousHash) shader = shader.replace('vec2(127.0, 311.0)', 'vec2(127.1, 311.7)');
          const material = new THREE.ShaderMaterial({
            vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
            fragmentShader: shader.slice(0, shader.indexOf('void main()')) + \`
              void main() {
                float row = floor(gl_FragCoord.y);
                float x = floor(row / 16.0) + 1.0 + (gl_FragCoord.x < 1.0 ? -0.001 : 0.001);
                float y = 4.0 + (mod(row, 16.0) + 0.5) / 16.0;
                gl_FragColor = vec4(vec3(noise(vec2(x, y))), 1.0);
              }\`,
          });
          const geometry = new THREE.PlaneGeometry(2, 2), fixture = new THREE.Scene();
          fixture.add(new THREE.Mesh(geometry, material));
          const target = new THREE.WebGLRenderTarget(2, 512), pixels = new Uint8Array(2 * 512 * 4);
          const previousTarget = renderer.getRenderTarget();
          renderer.setRenderTarget(target); renderer.render(fixture, new THREE.Camera());
          renderer.readRenderTargetPixels(target, 0, 0, 2, 512, pixels);
          renderer.setRenderTarget(previousTarget);
          target.dispose(); material.dispose(); geometry.dispose();
          let maxDifference = 0;
          for (let row = 0; row < 512; row++) {
            maxDifference = Math.max(maxDifference, Math.abs(pixels[row * 8] - pixels[row * 8 + 4]));
          }
          return maxDifference;
        },
        capture(seconds, flat = false, noClouds = false, angle = 'roof') {
          setGameState('pause'); missionBriefing.hide();
          sihangCampaign.stage = 'sihang-retreat'; sihangCampaign.stageElapsed = seconds;
          sihangNight.update(sihangCampaign); world.setNightLighting(sihangNight.snapshot.transition);
          if (angle === 'player') {
            camera.position.copy(this.playerPosition); camera.quaternion.copy(this.playerQuaternion);
          } else {
            camera.position.set(0, 25, -24);
            if (angle === 'seam') camera.lookAt(-150, 75, -24);
            else camera.lookAt(84, 50, -178);
          }
          camera.updateMatrixWorld(true);
          sihangNight.update(sihangCampaign);
          const sky = scene.getObjectByName('sihang-night-sky'), background = scene.background;
          if (flat) { sky.visible = false; scene.background = new THREE.Color(0x0c1830); }
          const shader = sky.material.fragmentShader;
          if (noClouds) {
            sky.material.fragmentShader = shader.replace(
              'cloud = smoothstep(0.52, 0.72, cloud) * smoothstep(0.02, 0.15, height);', 'cloud = 0.0;');
            sky.material.needsUpdate = true;
          }
          renderer.render(scene, camera);
          const image = renderer.domElement.toDataURL('image/png').split(',')[1];
          if (noClouds) { sky.material.fragmentShader = shader; sky.material.needsUpdate = true; }
          scene.background = background;
          return { snapshot: sihangNight.snapshot,
            background: scene.background?.isTexture ? 'texture' : 'other',
            image };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => nightTransitionReview.rememberCamera());
  const cloudMaxDifference = await page.evaluate(() => nightTransitionReview.cloudContinuity());
  const previousCloudMaxDifference = await page.evaluate(() => nightTransitionReview.cloudContinuity(true));
  assert.ok(cloudMaxDifference <= 4, `Cloud noise has discontinuous cell edges: ${cloudMaxDifference}/255`);
  const records = [];
  for (const seconds of [0, 15, 30, 45, 60]) {
    const { image, ...record } = await page.evaluate(seconds => nightTransitionReview.capture(seconds), seconds);
    await writeFile(join(directory, `night-${seconds}.png`), Buffer.from(image, 'base64'));
    records.push({ seconds, ...record });
  }
  const flat = await page.evaluate(() => nightTransitionReview.capture(60, true));
  await writeFile(join(directory, 'night-60-flat.png'), Buffer.from(flat.image, 'base64'));
  const noClouds = await page.evaluate(() => nightTransitionReview.capture(60, false, true));
  await writeFile(join(directory, 'night-60-no-clouds.png'), Buffer.from(noClouds.image, 'base64'));
  for (const angle of ['seam', 'player']) {
    const { image } = await page.evaluate(angle => nightTransitionReview.capture(60, false, false, angle), angle);
    await writeFile(join(directory, `night-60-${angle}.png`), Buffer.from(image, 'base64'));
  }
  await writeFile(join(directory, 'night-transition.json'), JSON.stringify({
    fixture: 'fixed-camera-artificial-retreat-stage-no-live-gameplay', records,
    cloudMaxDifference, previousCloudMaxDifference, errors,
  }, null, 2));
  assert.deepEqual(records.map(record => record.snapshot.transition), [0, .15625, .5, .84375, 1]);
  assert.ok(records.every(record => record.background === 'texture'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(records));
} finally {
  await browser.close();
}
