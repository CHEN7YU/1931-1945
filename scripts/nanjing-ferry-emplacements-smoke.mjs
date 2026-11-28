import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const gateFireOnly = process.env.GATE_FIRE_ONLY === '1';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const observedFerryShots = [];
      const originalFerryFire = fireFixedWeapon;
      let gateTarget = null;
      fireFixedWeapon = function(point, actor) {
        const shots = point.shots;
        if (${gateFireOnly} && point.id.startsWith('ferry-front-') && point.profile === 'bofors75') {
          if (gateTarget) {
            enemies = enemies.filter(enemy => enemy !== gateTarget);
            clearActors([gateTarget]);
          }
          const x = -69;
          const z = point.z + (x - point.x) * Math.cos(point.yaw) / Math.sin(point.yaw);
          const formation = formations.find(item => item.team === 'enemy' && item.type === 'infantry');
          if (!formation) throw new Error('Missing enemy infantry formation for gate target');
          gateTarget = actorAt(false, x, z, 0, { id: 'gate-target', x, z }, formation);
          if (!gateTarget.spawnClear) throw new Error('Gate target is inside an obstacle');
          scene.add(gateTarget.model);
          enemies.push(gateTarget);
          rebuildForces();
        }
        const result = originalFerryFire(point, actor);
        if (point.profile === 'bofors75' && point.shots > shots) {
          const shell = shells.at(-1);
          observedFerryShots.push({ id: point.id, projectileId: shell.id,
            start: shell.start, target: shell.target });
        }
        return result;
      };
      window.ferryEmplacementReview = {
        setup(id) {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          if (!point) throw new Error('Missing emplacement ' + id);
          if (point.operatorId) {
            const operator = entities.soldiers.get(point.operatorId);
            if (!operator) throw new Error('Missing existing operator for ' + id);
            releaseEmplacement(operator, false);
          }
          point.playerOnly = true;
          if (${gateFireOnly}) {
            point.yaw = point.heading;
            point.pitch = 0;
            point.view.userData.update();
          }
          const floor = point.altitude ?? world.groundHeight(point.x, point.z);
          const pose = emplacementPose(point, floor);
          actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          stopLocomotion(actor.locomotion);
          controlPose.yaw = point.heading; controlPose.pitch = -.15;
          setGameState('playing'); bindControlInput(); updateCamera(0);
          this.id = id;
          return this.sample();
        },
        sample() {
          const actor = controlledSoldier(entities), point = emplacements.get(this.id);
          const shot = observedFerryShots.findLast(item => item.id === this.id);
          const impact = shot && projectileImpacts.find(event => event.projectileId === shot.projectileId);
          return { mounted: actor.emplacementId, operator: point.operatorId, actor: actor.id,
            shots: point.shots, ammo: point.weapon.ammo, health: actor.health,
            position: actor.position.toArray(), shot, impact,
            gateTarget: gateTarget && { health: gateTarget.health, position: gateTarget.position.toArray(),
              lastHit: gateTarget.lastHit } };
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.locator('#world').click();
  const results = [];
  const ids = gateFireOnly ? ['ferry-front-north-gun', 'ferry-front-south-gun']
    : ['ferry-north-mg', 'ferry-south-aa', 'ferry-south-gun',
      'ferry-front-north-gun', 'ferry-front-south-gun', 'ferry-front-north-mg',
      'ferry-front-south-mg', 'ferry-north-aa-west', 'ferry-north-aa-east'];
  for (const id of ids) {
    const before = await page.evaluate(id => ferryEmplacementReview.setup(id), id);
    await page.screenshot({ path: join(directory, `${id}-approach.png`) });
    await page.keyboard.press('KeyF');
    await page.waitForFunction(id => ferryEmplacementReview.sample().mounted === id, id, { timeout: 10000 });
    await page.screenshot({ path: join(directory, `${id}-mounted.png`) });
    await page.mouse.down();
    await page.waitForFunction(shots => ferryEmplacementReview.sample().shots > shots, before.shots, { timeout: 15000 });
    await page.mouse.up();
    if (gateFireOnly)
      await page.waitForFunction(previous => {
        const sample = ferryEmplacementReview.sample();
        return sample.shot && sample.shot.projectileId !== previous &&
          sample.impact?.projectileId === sample.shot.projectileId;
      }, before.shot?.projectileId ?? null, { timeout: 15000 });
    const fired = await page.evaluate(() => ferryEmplacementReview.sample());
    if (id.includes('gun')) await page.screenshot({ path: join(directory, `${id}-fired.png`) });
    assert.equal(fired.operator, fired.actor);
    assert.ok(fired.ammo < before.ammo);
    if (gateFireOnly) {
      assert.ok(fired.shot && fired.impact, `${id}: actual shell and impact are required`);
      assert.ok(fired.impact.position.x > -72,
        `${id}: shell did not pass through the west gate: ${JSON.stringify(fired)}`);
      assert.ok(fired.gateTarget && fired.gateTarget.health < 100,
        `${id}: enemy behind the west gate was not damaged: ${JSON.stringify(fired)}`);
      assert.equal(fired.gateTarget.lastHit?.source?.soldierId, fired.actor, `${id}: damage must come from the player`);
      assert.equal(fired.gateTarget.lastHit?.source?.weaponClass, 'field-gun');
      assert.equal(fired.gateTarget.lastHit?.blast, true);
    }
    await page.keyboard.press('KeyF');
    const after = await page.evaluate(() => ferryEmplacementReview.sample());
    assert.equal(after.mounted, null);
    assert.equal(after.operator, null);
    results.push({ id, before, fired, after });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'emplacements.json'), JSON.stringify({ results, errors,
    limitation: gateFireOnly
      ? 'Player manually placed at the weapons; other enemies disabled, and one enemy artificially placed beyond the gate immediately before each shot. F and mouse use production game handlers.'
      : 'Player manually placed at each actual weapon; enemies disabled and reviewed weapons reserved for player. F and mouse inputs use production game handlers.' }, null, 2));
  console.log(JSON.stringify({ passed: true, positions: results.map(result => result.id) }));
} finally {
  await browser.close();
}
