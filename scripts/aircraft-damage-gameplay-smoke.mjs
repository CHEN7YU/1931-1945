import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    recordVideo: { dir: directory, size: { width: 1280, height: 720 } } });
  const started = Date.now(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(180000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch(), original = await response.text();
    const marker = "  performanceDiagnostics.measure('effects', () => combatEffects.render(time, entities.vehicles.values()));";
    assert.ok(original.includes(marker), 'Production presentation seam changed');
    const fixture = `
      let damageTestPlane = null;
      window.__airDamageTest = {
        observe() {
          if (!damageTestPlane) return;
          const approach = THREE.MathUtils.smoothstep(damageTestPlane.position.y, 0, 35);
          camera.position.copy(damageTestPlane.position).add(new THREE.Vector3(14,30,22)
            .lerp(new THREE.Vector3(28,12,43),approach));
          camera.lookAt(damageTestPlane.position.clone().add(new THREE.Vector3(0,3,7)));
          camera.updateMatrixWorld(true);
          if (weapon) weapon.visible = false;
        },
        start() {
          registerUnit(entities, {id:'damage-review-air', type:'plane', team:'enemy'});
          damageTestPlane = createVehicleEntity(entities, {id:'damage-review-plane',
            unitId:'damage-review-air', type:'plane', team:'enemy', position:new THREE.Vector3(0,55,-40)});
          damageTestPlane.speed = 34; damageTestPlane.heading = -.7;
          damageTestPlane.aiFlight = {phase:'approach',until:0,targetId:null,nextSense:0,returningToArea:false};
          damageVehicle(damageTestPlane,40,captureAttackSource(entities,controlledSoldier(entities)),'anti-aircraft-gun');
          return this.snapshot();
        },
        destroy() {
          const source=captureAttackSource(entities,controlledSoldier(entities));
          const rounds=Math.ceil(damageTestPlane.health/damageForTarget('anti-aircraft-gun','aircraft',40));
          for(let round=0;round<rounds;round++)damageVehicle(damageTestPlane,40,source,'anti-aircraft-gun');
          return this.snapshot();
        },
        snapshot() {return {time,state,health:damageTestPlane?.health,
          position:damageTestPlane?.position.toArray(), fall:damageTestPlane?.fall,
          camera:camera.position.toArray(),effects:combatEffects.snapshot};}
      };`;
    const observer = 'window.__airDamageTest?.observe();\n';
    await route.fulfill({ response, body: original.replace(marker, observer + marker) + fixture });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu' ||
    document.getElementById('fatal') && !document.getElementById('fatal').hidden);
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  assert.deepEqual(errors, []); console.log('Aircraft fixture loaded');
  await page.locator('#qualityToggle').selectOption('low', { force: true });
  await deployFromMenu(page); await page.waitForFunction(() => window.__battle.state === 'playing');
  const videoStartSeconds = (Date.now() - started) / 1000;
  const firstHit = await page.evaluate(() => window.__airDamageTest.start());
  console.log(`Aircraft hit: health=${firstHit.health}`);
  assert.ok(firstHit.health > 0 && firstHit.health < 180, 'Use the actual accepted anti-aircraft damage, not raw input damage');
  await page.waitForFunction(() => window.__airDamageTest.snapshot().effects.lastExplosion?.style === 'aircraft-hit' &&
    window.__airDamageTest.snapshot().effects.fireClouds > 0);
  const burst = await page.evaluate(() => window.__airDamageTest.snapshot());
  await page.screenshot({ path: join(directory, 'first-hit-fireball.png') });
  await page.waitForFunction(born => window.__airDamageTest.snapshot().time > born + .5, burst.time);
  const wounded = await page.evaluate(() => window.__airDamageTest.snapshot());
  assert.equal(wounded.health, firstHit.health); assert.ok(!wounded.fall);
  assert.ok(!wounded.effects.aircraftSmoke.sources.includes('damage-review-plane'),
    'nonfatal hits must not start a black smoke trail');
  await page.screenshot({ path: join(directory, 'wounded-no-black-smoke.png') });
  const fatalHit = await page.evaluate(() => window.__airDamageTest.destroy());
  console.log('Fatal damage checkpoint: ' + JSON.stringify({ health: fatalHit.health, fall: fatalHit.fall, state: fatalHit.state }));
  assert.equal(fatalHit.health, 0);
  assert.ok(fatalHit.fall, 'Production lethal damage must initialize the falling aircraft');
  await page.waitForFunction(() => window.__airDamageTest.snapshot().health === 0 &&
    window.__airDamageTest.snapshot().fall && window.__airDamageTest.snapshot().effects.fireClouds > 0);
  const destroyed = await page.evaluate(() => window.__airDamageTest.snapshot());
  await page.screenshot({ path: join(directory, 'fatal-hit-fireball.png') });
  await page.waitForFunction(born => window.__airDamageTest.snapshot().time > born + 1.4, destroyed.time);
  const falling = await page.evaluate(() => window.__airDamageTest.snapshot());
  assert.ok(falling.position[1] < destroyed.position[1] - 4);
  assert.ok(falling.effects.aircraftSmoke.visible && falling.effects.aircraftSmoke.puffs >= 15);
  assert.ok(falling.effects.aircraftSmoke.sources.includes('damage-review-plane'));
  assert.ok(!falling.fall.grounded);
  await page.screenshot({ path: join(directory, 'falling-black-smoke.png') });
  await page.waitForFunction(() => {
    const snapshot = window.__airDamageTest.snapshot();
    return snapshot.fall.grounded && snapshot.effects.lastExplosion?.style === 'tank-destruction' &&
      snapshot.effects.lastExplosion.rendered && snapshot.effects.fireClouds > 0;
  });
  const crashed = await page.evaluate(() => window.__airDamageTest.snapshot());
  assert.ok(crashed.effects.lastExplosion.time > destroyed.effects.lastExplosion.time,
    'Ground impact must produce a separate explosion after the airborne lethal-hit fireball');
  assert.ok(Math.hypot(...crashed.effects.lastExplosion.position.map((value, index) =>
    value - crashed.position[index])) < 2, 'The second explosion belongs to the actual crash location');
  await page.screenshot({ path: join(directory, 'ground-impact-fireball.png') });
  await page.waitForTimeout(1000);
  assert.deepEqual(errors, []);
  const video = page.video(); await context.close();
  await video.saveAs(join(directory, 'aircraft-damage-gameplay.webm'));
  await writeFile(join(directory, 'observations.json'), JSON.stringify({
    videoStartSeconds, fixture: 'Test-only aircraft and observer; production damage, death, fall and effect pipeline.',
    firstHit, burst, wounded, destroyed, falling, crashed, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, firstHitFireball: burst.effects.lastExplosion.rendered,
    woundedPlaneSmoking: wounded.effects.aircraftSmoke.sources.includes('damage-review-plane'),
    fallingSmokePuffs: falling.effects.aircraftSmoke.puffs }));
} finally { await browser.close(); }
