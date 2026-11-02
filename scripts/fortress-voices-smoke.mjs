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
window.__fortressVoiceFixture = {
  pauseOverlay() { showOverlay('pause'); },
  stop() { setGameState('pause'); },
  flush() { battleVoices.sync(true); presentRifleReports(); },
  supply(owner) {
    const point = objectives.find(point => point.id === 'A');
    point.owner = owner; point.control = owner === 'friendly' ? 1 : -1;
    updateObjectives(0);
  },
  clock(value) { time = value; updateObjectives(0); },
  encircle() {
    for (const point of objectives) { point.owner = 'friendly'; point.control = 1; }
    updateObjectives(0); updateHUD();
  },
  planeOnly() {
    for (const formation of formations.filter(unit => unit.team === 'enemy' && unit.type !== 'plane')) {
      for (const actor of formation.members) actor.health = 0;
    }
    updateObjectives(0); updateHUD();
    return { state, alivePlanes: formations.filter(unit => unit.team === 'enemy' && unit.type === 'plane')
      .flatMap(unit => unit.members).filter(actor => actor.health > 0 && actor.vehicleId).length };
  }
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  await page.evaluate(() => window.__fortressVoiceFixture.stop());
  const awaitCue = async cue => {
    await page.waitForFunction(cue => {
      window.__fortressVoiceFixture.flush();
      return window.__battle.battleVoices.history.some(event => event.cue === cue);
    }, cue, { timeout: 45000 });
  };
  await awaitCue('supply-brief');
  await page.evaluate(() => window.__fortressVoiceFixture.supply('friendly'));
  await awaitCue('supply-cut');
  await page.evaluate(() => window.__fortressVoiceFixture.clock(45));
  await awaitCue('supply-reinforced');
  await page.evaluate(() => window.__fortressVoiceFixture.supply('enemy'));
  await awaitCue('supply-restored');
  await page.evaluate(() => window.__fortressVoiceFixture.clock(90));
  await awaitCue('reinforcements');
  await page.evaluate(() => window.__fortressVoiceFixture.encircle());
  await awaitCue('encircled');
  await awaitCue('reinforcements-blocked');
  await awaitCue('cleanup-orders');
  const history = await page.evaluate(() => window.__battle.battleVoices.history);
  for (const cue of ['supply-brief', 'supply-cut', 'supply-reinforced', 'supply-restored', 'reinforcements', 'encircled', 'reinforcements-blocked', 'cleanup-orders']) {
    const events = history.filter(item => item.cue === cue);
    assert.ok(events.length > 0, `${cue} must play`);
    assert.equal(new Set(events.map(item => `${item.eventKey}:${item.time}`)).size, 1,
      `${cue} should originate once; replaying an interrupted announcement on resume is allowed`);
  }
  const result = await page.evaluate(() => window.__fortressVoiceFixture.planeOnly());
  assert.equal(result.alivePlanes, 1, 'leave the actual enemy aircraft and pilot alive');
  assert.equal(result.state, 'victory');
  assert.equal(await page.locator('#overlay-description').isVisible(), false);
  assert.equal(await page.locator('#deployment-help').isVisible(), false);
  assert.equal(await page.locator('#overlay [data-build-version]').isVisible(), false);
  assert.equal(await page.locator('#battle-summary').isVisible(), true);
  assert.equal(await page.locator('#back-menu').isVisible(), true);
  await page.screenshot({ path: join(directory, 'aircraft-only-victory.png') });
  await page.evaluate(() => window.__fortressVoiceFixture.pauseOverlay());
  assert.equal(await page.locator('#deployment-help').isVisible(), true);
  assert.equal(await page.locator('#overlay-description').isVisible(), true);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'fortress-voices.json'), JSON.stringify({ passed: true, history, result, errors,
    fixture: 'Browser-only objective ownership, support clock and ground health fixture. Actual new reinforcements spawn and actual Azure clips decode and play. Not natural battle completion or human listening acceptance.' }, null, 2));
  console.log(JSON.stringify({ passed: true, newCues: 8, aircraftOnlyVictory: true }));
} finally { await browser.close(); }
