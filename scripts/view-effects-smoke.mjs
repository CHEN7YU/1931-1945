import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173';
const directory = process.env.ARTIFACT_DIR;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.route('**/__view-effects-check', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__view-effects-check', base).href);
  const visual = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createCombatEffects } = await import('/src/combat-effects.js');
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(72, 1280 / 720, .07, 650);
    scene.background = new T.Color('#939f9e');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    camera.position.set(0, 1.67, 0);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); document.body.append(renderer.domElement);
    const effects = createCombatEffects(scene, camera, () => 0);
    effects.configure({ preset: 'high', effects: { muzzle: true, muzzleLight: true, hitParticles: true } });
    const before = effects.snapshot.presentationPasses;
    for (let i = 0; i < 10; i++) effects.explosion(new T.Vector3(0, .1, 35), 0);
    const afterEvents = effects.snapshot.presentationPasses;
    const samples = [], images = [];
    for (const [label, yaw, time] of [['hidden', 0, .2], ['returned', Math.PI, .2], ['expired', Math.PI, 5]]) {
      camera.rotation.y = yaw;
      effects.render(time); renderer.render(scene, camera);
      samples.push({ label, drawCalls: renderer.info.render.calls, ...effects.snapshot });
      images.push({ name: `${label}.png`, data: renderer.domElement.toDataURL().split(',')[1] });
    }
    renderer.dispose();
    return { before, afterEvents, samples, images };
  });
  assert.equal(visual.afterEvents, visual.before, 'events must not each project the particle pool');
  const [hidden, returned, expired] = visual.samples;
  assert.equal(hidden.renderedFragments + hidden.renderedClouds + hidden.visibleLights, 0);
  assert.ok(hidden.fragments > 0 && hidden.clouds > 0, 'culling retains live effects for a rapid turn');
  assert.ok(returned.renderedFragments > 0 && returned.renderedClouds > 0);
  assert.ok(returned.drawCalls > hidden.drawCalls, 'real GPU draws are omitted outside the view');
  assert.equal(returned.emitted, hidden.emitted, 'turning does not emit a replacement explosion');
  assert.equal(returned.presentationPasses, hidden.presentationPasses + 1);
  assert.equal(expired.fragments + expired.clouds + expired.lights, 0);

  const url = new URL(base);
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.fov > 71.9, null, { timeout: 30000 });
  const initial = await page.evaluate(() => window.__battle.population);
  assert.equal(initial.friendly.alive, 110);
  assert.equal(initial.enemy.alive, 98);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__battle.position.z <= 42 || window.__battle.state === 'dead',
      null, { timeout: 60000 });
  } finally { await page.keyboard.up('w'); }
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const old = window.__battle.look;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -(1.2 - old.pitch) / .00132 }));
  });
  const before = await page.evaluate(() => ({ time: window.__battle.time, shots: window.__battle.combatStats.aiRifleShots,
    decisions: window.__battle.aiDecisions, look: window.__battle.look, population: window.__battle.population }));
  await page.waitForFunction(before => window.__battle.time >= before.time + 10 &&
    window.__battle.combatStats.aiRifleShots >= before.shots + 5, before, { timeout: 120000 });
  const after = await page.evaluate(() => ({ time: window.__battle.time, shots: window.__battle.combatStats.aiRifleShots,
    look: window.__battle.look, population: window.__battle.population, events: window.__battle.combatEvents,
    effects: window.__battle.combatEffects, decisions: window.__battle.aiDecisions }));
  assert.ok(before.look.pitch > 1.15 && after.look.pitch > 1.15, 'observe the sky instead of the fighting area');
  for (const kind of ['sensor', 'path', 'cover', 'posture']) {
    assert.ok(after.decisions.totalServiced[kind] > before.decisions.totalServiced[kind],
      `offscreen ${kind} decisions must continue, not only pre-existing movement and bullets`);
  }
  const frames = await page.evaluate(() => window.__battleTelemetry.frames.map(frame =>
    ({ steps: frame.simulationSteps, decisions: frame.aiDecisions })));
  for (const frame of frames) for (const [kind, cap] of Object.entries(frame.decisions.frameLimits)) {
    assert.ok(frame.decisions.serviced[kind] <= cap, `${kind} frame budget must survive real catch-up steps`);
  }
  assert.deepEqual(after.events.published, after.events.presented, 'offscreen combat events are still fully consumed');
  assert.deepEqual(errors, []);
  if (directory) {
    await mkdir(directory, { recursive: true });
    for (const image of visual.images) await writeFile(join(directory, image.name), Buffer.from(image.data, 'base64'));
    await page.screenshot({ path: join(directory, 'full-battle-looking-away.png') });
    await writeFile(join(directory, 'view-effects.json'), JSON.stringify({ visual: visual.samples, initial, before, after, frames }, null, 2));
  }
  console.log(`PASS: offscreen GPU draws ${hidden.drawCalls}, immediate return ${returned.drawCalls}; full 110/96 battle continues while looking away (${before.shots} -> ${after.shots} AI shots).`);
} finally {
  await browser.close();
}
