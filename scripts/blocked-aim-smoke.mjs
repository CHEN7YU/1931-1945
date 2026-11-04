import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
window.__blockedAimFixture = () => {
  const original = allForces.find(actor => actor.health > 0 && !actor.vehicleId &&
    actor.team === 'enemy' && actor.nativeMotion?.profile.headAim && (actor.rifle.model ?? 'rifle') === 'rifle');
  if (!original) throw new Error('Regression fixture requires a real Japanese rifleman with calibrated head aim');
  const actor = { ...original, weaponBlocked: true, rifleReady: false,
    rifle: { ...original.rifle, action: 'idle' },
    bayonet: { ...original.bayonet, mode: 'idle', extension: 0 },
    grenades: { ...original.grenades, action: null },
    nativeMotion: { ...original.nativeMotion, headGoal: null, cheekWeight: 0, lowReady: 1 } };
  const threat = actor.position.clone().add(new THREE.Vector3(0, 1.1, -20));
  const stances = ['standing', ...Object.keys(FIRING_POSES)];
  const invalidPreview = { ...actor, rifleReady: true,
    nativeMotion: { ...actor.nativeMotion, lowReady: 0, cheekWeight: 1 } };
  syncNativeAimGoal(invalidPreview);
  let reproduced = null;
  try { sampleNraMotion(invalidPreview); }
  catch (error) {
    if (error.message !== 'Aimed head requires its simulation-owned target') throw error;
    reproduced = error.message;
  }
  if (!reproduced) throw new Error('The original invalid-preview state was not reproduced');
  const blocked = stances.map(stance => postureFireLine(actor, actor.position, stance, threat));
  const untouched = actor.nativeMotion.headGoal === null && original.nativeMotion !== actor.nativeMotion;
  actor.weaponBlocked = false;
  const unblocked = stances.map(stance => postureFireLine(actor, actor.position, stance, threat));
  actor.weaponBlocked = true;
  const blockedAgain = stances.map(stance => postureFireLine(actor, actor.position, stance, threat));
  return { reproduced, blocked, unblocked, blockedAgain, untouched };
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  const result = await page.evaluate(() => window.__blockedAimFixture());
  assert.equal(result.reproduced, 'Aimed head requires its simulation-owned target');
  assert.ok(result.blocked.every(value => value === false));
  assert.ok(result.blockedAgain.every(value => value === false));
  assert.ok(result.unblocked.every(value => typeof value === 'boolean'));
  assert.equal(result.untouched, true);
  const started = await page.evaluate(() => window.__battle.time);
  await page.waitForFunction(time => window.__battle.time > time + 15 || !document.getElementById('fatal').hidden,
    started, { timeout: 60000 });
  assert.equal(await page.locator('#fatal').isVisible(), false);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'blocked-aim.json'), JSON.stringify({ passed: true, result, errors,
    fixture: 'A cloned real Japanese rifleman tests blocked/unblocked posture previews without mutating battle soldiers. The following fifteen simulation seconds run normally; this is not complete battle acceptance.' }, null, 2));
  console.log(JSON.stringify({ passed: true, stances: result.blocked.length, simulatedSeconds: 15 }));
} finally { await browser.close(); }
