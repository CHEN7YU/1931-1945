import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Isolated real-GPU module test: deliberately does not boot or manipulate the live game.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const base = process.env.GAME_URL || 'http://127.0.0.1:5353';
  await page.route('**/blast-module-smoke.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"></body></html>',
  }));
  await page.goto(`${base}/blast-module-smoke.html`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createCombatEffects } = await import('/src/combat-effects.js');
    const { BLAST_PROFILES } = await import('/src/blast-profiles.js');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 640 / 360, .07, 200);
    camera.position.set(0, 3, 0); camera.lookAt(0, 1, -18);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(640, 360); renderer.setClearColor(0x161b23);
    document.body.append(renderer.domElement);
    const effects = createCombatEffects(scene, camera, () => 0);
    const settings = { preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } };
    effects.configure(settings);
    renderer.render(scene, camera);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const gl = renderer.getContext(), pixels = new Uint8Array(640 * 360 * 4);
    const brightness = () => {
      renderer.render(scene, camera);
      gl.readPixels(0, 0, 640, 360, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) total += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return total / (640 * 360 * 3);
    };
    const baseline = brightness(), tiers = [];
    for (const style of ['grenade', 'mortar', 'grenade-discharger', 'explosive-pack']) {
      effects.clear(); effects.configure(settings);
      effects.explosion(new THREE.Vector3(0, .1, -18), 0, BLAST_PROFILES[style].radius, style);
      effects.render(.06);
      tiers.push({ style, brightness: brightness(), snapshot: effects.snapshot });
    }
    effects.clear();
    effects.configure({ preset: 'low', effects: { muzzle: false, muzzleLight: false, hitParticles: false } });
    effects.explosion(new THREE.Vector3(0, .1, -18), 0, 9, 'explosive-pack');
    effects.render(.06);
    const low = { brightness: brightness(), snapshot: effects.snapshot };
    const geometryCount = renderer.info.memory.geometries;
    for (let i = 0; i < 80; i++) effects.explosion(new THREE.Vector3(0, .1, -18), .06, 9, 'explosive-pack');
    effects.render(.06); brightness();
    const bounded = effects.snapshot, finalGeometries = renderer.info.memory.geometries;
    effects.render(8); brightness();
    const expired = effects.snapshot;
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ color: 0x9b805c }));
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);
    camera.position.set(0, 15, 2); camera.lookAt(0, 0, -18);
    effects.clear(); effects.configure(settings);
    const ground = brightness();
    effects.explosion(new THREE.Vector3(0, .22, -18), 0, 17, 'aircraft-bomb',
      { kind: 'soil', normal: { x: 0, y: 1, z: 0 } });
    effects.render(.06);
    const bombFlash = brightness();
    effects.render(8);
    const smokyGround = brightness(), smoke = effects.snapshot.bombAftermath;
    effects.render(18);
    const scorchedGround = brightness();
    effects.render(56);
    const recoveredGround = brightness();
    renderer.dispose();
    return { baseline, tiers, low, bounded, expired, geometryCount, finalGeometries, ground, bombFlash, smokyGround,
      smoke, scorchedGround, recoveredGround, gpu: gl.getParameter(gl.RENDERER) };
  });
  assert.deepEqual(errors, []);
  for (const tier of result.tiers) {
    assert.ok(tier.brightness > result.baseline + 1, `${tier.style} is conspicuous in actual pixels`);
    assert.ok(tier.snapshot.fireClouds > 0 && tier.snapshot.shockwaves > 0);
    assert.ok(tier.snapshot.fragments <= 96 && tier.snapshot.clouds <= 18);
  }
  assert.ok(result.tiers[0].brightness < result.tiers[1].brightness);
  assert.equal(result.tiers[1].brightness, result.tiers[2].brightness);
  assert.ok(result.tiers[2].brightness < result.tiers[3].brightness);
  assert.ok(result.low.brightness > result.baseline + 1);
  assert.equal(result.low.snapshot.fragments, 0);
  assert.equal(result.low.snapshot.visibleLights, 0);
  assert.ok(result.bounded.clouds <= 6);
  assert.equal(result.geometryCount, result.finalGeometries);
  assert.equal(result.expired.clouds + result.expired.fragments + result.expired.lights, 0);
  assert.ok(result.bombFlash > result.ground + 2, 'bomb flash brightens the scene');
  assert.ok(result.smoke.visiblePuffs > 0 && result.smokyGround < result.scorchedGround, 'rising smoke darkens pixels beyond the scorch');
  assert.ok(result.scorchedGround < result.ground - 1, 'scorch is still visible after smoke clears');
  assert.equal(result.recoveredGround, result.ground);
  console.log(JSON.stringify({ gpu: result.gpu, baseline: result.baseline,
    tiers: result.tiers.map(({ style, brightness }) => ({ style, brightness })), low: result.low.brightness,
    ground: result.ground, bombFlash: result.bombFlash, smokyGround: result.smokyGround, scorchedGround: result.scorchedGround }));
} finally {
  await browser.close();
}
