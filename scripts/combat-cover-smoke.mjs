import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  await page.waitForFunction(() => window.__battle.time >= 30 || !document.getElementById('fatal').hidden,
    null, { timeout: 90000 });
  const result = await page.evaluate(() => {
    const data = window.__battle, friends = data.friendlyPositions;
    return { time: data.time, state: data.state, shots: data.combatStats.aiRifleShots,
      lowerPoses: friends.filter(actor => ['crouched', 'kneeling', 'prone'].includes(actor.firingPose)).length,
      assignedCover: friends.filter(actor => actor.cover).map(actor => ({ kind: actor.cover.kind, mode: actor.mode })),
      unthreatenedGuardsAiming: friends.filter(actor => actor.mode === 'guard' && !actor.observation.point && actor.rifleReady).length,
      fatal: document.getElementById('fatal-message').textContent };
  });
  assert.equal(result.fatal, '');
  assert.ok(result.shots > 0);
  assert.equal(result.unthreatenedGuardsAiming, 0);
  assert.ok(result.lowerPoses > 0 || result.assignedCover.length > 0, 'battle must include lowered or covered firing positions');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(directory, 'combat-cover.png') });
  await writeFile(join(directory, 'combat-cover.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
