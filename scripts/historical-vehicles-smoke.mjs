import { deployFromMenu } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.ARTIFACT_DIR;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
async function capture(name) {
  if (!artifacts) return;
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, `${name}.png`) });
}
try {
  await page.route('**/__vehicle-preview', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#b7c1bc}canvas{display:block}p{position:absolute;left:28px;top:12px;color:#17231e;font:20px sans-serif}</style><p id="label">Historical vehicle model inspection (not battle footage)</p><canvas></canvas>' }));
  await page.goto(new URL('/__vehicle-preview', base).href);
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { historicalVehicleModel, vehicleWeaponView } = await import('/src/vehicle-model.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
    renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb7c1bc);
    scene.add(new THREE.HemisphereLight(0xe4eff7, 0x5c5b40, 2.4));
    const sun = new THREE.DirectionalLight(0xffedce, 3.2);
    sun.position.set(-5, 9, -6); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x858d7e, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .05, 250);
    let current;
    window.drawVehicle = (type, view) => {
      if (current) scene.remove(current);
      current = view === 'first-person' ? vehicleWeaponView(type) : historicalVehicleModel(type);
      scene.add(current);
      floor.visible = view !== 'first-person';
      camera.fov = view === 'first-person' ? 72 : 42; camera.updateProjectionMatrix();
      if (view === 'first-person') {
        camera.position.set(0, 0, 0); camera.lookAt(0, 0, -10);
      } else {
        if (type === 'plane') current.position.y = 1.64;
        const eye = type === 'tank' ? [6, 4, -7] : [10, 7.5, -12];
        if (view === 'side') eye.splice(0, 3, type === 'tank' ? 9 : 15, type === 'tank' ? 2.6 : 5, 1);
        if (view === 'rear') eye.splice(0, 3, -9, 6, 12);
        camera.position.set(...eye); camera.lookAt(0, type === 'tank' ? 1 : 1.7, 0);
      }
      document.getElementById('label').textContent = `${current.userData.profile.name} / ${view} - model inspection, not battle footage`;
      renderer.render(scene, camera);
      return { type, view, model: current.userData.profile.model, calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles };
    };
  });
  for (const type of ['tank', 'plane']) for (const view of ['front-quarter', 'side', 'rear', 'first-person']) {
    observations.push(await page.evaluate(({ type, view }) => window.drawVehicle(type, view), { type, view }));
    await capture(`${type}-${view}`);
  }
  await page.goto(new URL('/?character=procedural', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 120000 });
  await page.locator('#menu-quality').selectOption('low');
  for (const type of ['tank', 'plane']) {
    await page.locator(`#squad-choices [data-type="${type}"]`).click();
    assert.match(await page.locator(`#squad-choices [data-type="${type}"] small`).textContent(), type === 'tank' ? /维克斯/ : /伊-15bis/);
    await deployFromMenu(page);
    await page.waitForFunction(type => window.__battle?.state === 'playing' && window.__battle.vehicles.some(v => v.type === type), type);
    assert.match(await page.locator('#weapon-name').textContent(), type === 'tank' ? /47毫米炮/ : /7.62毫米机枪/);
    const before = await page.evaluate(() => window.__battle);
    assert.equal(before.vehicleViews.count, 3);
    const controlledVehicle = before.vehicles.find(vehicle => vehicle.team === 'friendly' && vehicle.type === type);
    assert.equal(controlledVehicle.seats.length, type === 'tank' ? 3 : 1);
    assert.equal(before.vehicles.filter(vehicle => vehicle.variant === 'chi-ha').length, 2);
    await capture(`${type}-battle-view`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__battle.state === 'pause');
    const pausedAt = await page.evaluate(() => window.__battle.time);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__battle.time), pausedAt);
    await page.locator('#back-menu').click();
    await page.waitForFunction(() => window.__battle.state === 'menu');
    assert.equal(await page.evaluate(() => window.__battle.vehicleViews.count), 0);
  }
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(join(artifacts, 'vehicle-observations.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: historical vehicles render from multiple angles and in battle; profiles, menus, pause, seats and cleanup agree.');
} finally {
  await browser.close();
}
