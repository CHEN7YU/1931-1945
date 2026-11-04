import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SELECTABLE_CAMPAIGNS } from '../src/campaigns.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR for gameplay integration evidence');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations = [];
try {
  for (const campaign of SELECTABLE_CAMPAIGNS.filter(item => !item.locked).map(item => item.id)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
    url.searchParams.set('campaign', campaign);
    await page.goto(url.href);
    await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
    await page.locator('#redeploy-choices [data-type="infantry"]').click();
    await page.locator('#spawn-choices [data-spawn="china-base"]').click();
    await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
    assert.ok(!requests.some(value => value.includes('/src/main.js') || value.includes('/assets/game/')));
    await page.locator('#deployment-options').screenshot({ path: join(directory, `${campaign}-deployment.png`) });
    await page.locator('#confirm-deploy').click();
    await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
      null, { timeout: 120000 });
    const initial = await page.evaluate(() => window.__battle);
    assert.equal(initial.state, 'playing', JSON.stringify(errors));
    assert.equal(initial.population.friendly.alive, 110);
    assert.equal(initial.population.enemy.alive, 96);
    assert.equal(initial.allies[0].role, 'mortarman');
    assert.ok(initial.population.units.some(unit => unit.team === 'enemy' && unit.type === 'plane' && unit.alive === 1));
    assert.ok(!initial.spawnPoints.some(point => point.kind === 'rally'));
    await page.waitForTimeout(500);
    await page.keyboard.press('2');
    await page.waitForFunction(() => window.__battle.mortar?.equipped === true);
    await page.mouse.click(720, 500);
    try {
      await page.waitForFunction(() => window.__battle.mortar?.phase === 'ready', null, { timeout: 10000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ state: window.__battle.state, mortar: window.__battle.mortar,
        toast: document.getElementById('toast').textContent, input: window.__battle.controlInput, fatal: document.getElementById('fatal-message').textContent }));
      throw new Error(`${error.message}: ${JSON.stringify({ campaign, state, errors })}`);
    }
    assert.equal(await page.evaluate(() => window.__battle.mortar.ammo), 12, 'setup input never fires');
    await page.mouse.down({ button: 'right' });
    assert.equal(await page.evaluate(() => window.__battle.mortar.phase), 'carrying');
    await page.mouse.up({ button: 'right' });
    await page.mouse.click(720, 500);
    await page.waitForFunction(() => window.__battle.mortar.phase === 'ready', null, { timeout: 10000 });
    await page.evaluate(() => {
      const data = window.__battle, objective = data.objectives.find(point => point.id === 'B');
      const heading = Math.atan2(data.position.x - objective.x, data.position.z - objective.z);
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: -(heading - data.look.yaw) / .0022, movementY: 0 }));
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(directory, `${campaign}-mortar.png`) });
    assert.ok((await page.locator('#mortar-target-distance').textContent()).startsWith('B'));
    await page.mouse.click(720, 500);
    try {
      await page.waitForFunction(() => window.__battle.mortar.ammo === 11, null, { timeout: 10000 });
    } catch (error) {
      throw new Error(JSON.stringify(await page.evaluate(() => ({ state: window.__battle.state, mortar: window.__battle.mortar,
        input: window.__battle.controlInput, toast: document.getElementById('toast').textContent, fatal: document.getElementById('fatal-message').textContent }))));
    }
    await page.keyboard.press('1');
    await page.waitForFunction(() => window.__battle.time >= 20, null, { timeout: 60000 });
    await page.waitForFunction(() => window.__battle.combatStats.aiRifleShots > 0, null, { timeout: 90000 });
    const later = await page.evaluate(() => window.__battle);
    assert.ok(later.combatStats.aiRifleShots > 0);
    assert.equal(later.population.enemy.rosterUnits, 10);
    assert.equal(later.population.friendly.rosterUnits, 10);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__battle.state === 'pause');
    await page.locator('#overlay [data-feedback-open]').click();
    await page.locator('#feedback-content').fill('Testing the gameplay feedback draft');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#feedback-submit').isDisabled(), true, 'plain Vite must not pretend feedback storage exists');
    await page.locator('#feedback-close').click();
    assert.deepEqual(errors, []);
    observations.push({ campaign, initialPopulation: { friendly: initial.population.friendly.alive, enemy: initial.population.enemy.alive },
      laterTime: later.time, aiShots: later.combatStats.aiRifleShots, feedbackDraftPreserved: true });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, observations }));
} finally {
  await writeFile(join(directory, 'gameplay-observations.json'), JSON.stringify(observations, null, 2));
  await browser.close();
}
