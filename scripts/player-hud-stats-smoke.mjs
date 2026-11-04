import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.playerHudStatsReview=()=>{
        const player=controlledSoldier(entities),tank=occupiedVehicle(entities,player);
        if(!tank)throw Error('The score regression must really begin in the selected tank squad');
        const tankOperator=entities.soldiers.get(tank.seats.find(seat=>seat.canFire).occupantId);
        const tankSource=captureAttackSource(entities,tankOperator,tank.weapon);
        for(const actor of enemies.filter(actor=>actor.health>0&&!actor.vehicleId).slice(0,10))
          hurt(actor,10000,tankSource,'explosion');
        const hostileTank=[...entities.vehicles.values()].find(vehicle=>vehicle.team==='enemy'&&vehicle.type==='tank');
        const hostileGunner=entities.soldiers.get(hostileTank.seats.find(seat=>seat.canFire).occupantId);
        damageVehicle(tank,10000,captureAttackSource(entities,hostileGunner,hostileTank.weapon),'explosion');
        showOverlay('dead');deploy('infantry','china-base');
        if(state!=='playing')throw Error('The wiped tank crew could not redeploy as infantry');
        const rifleman=controlledSoldier(entities),rifleSource=captureAttackSource(entities,rifleman,rifleman.rifle);
        for(const actor of enemies.filter(actor=>actor.health>0&&!actor.vehicleId).slice(0,20))
          hurt(actor,10000,rifleSource,'rifle','torso');
        setGameState('pause');$('scoreboard').hidden=false;updateHUD();renderSquadScores();
        const scores=battleStats.snapshot,casualties=battleStats.casualtySummary;
        const scoreText=$('squad-score-table').textContent;
        showOverlay('victory');
        return{scores,casualties,scoreText,resultText:$('battle-results').textContent,
          resultVisible:!$('battle-results').hidden,rows:$('result-casualties').querySelectorAll('tbody tr').length,
          roles:[...$('members').querySelectorAll('[data-role-icon]')].map(icon=>icon.dataset.roleIcon),
          mission:$('minimap-mission').textContent};
      };` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#player-nickname').fill('战况测试员');
  await page.locator('input[name="player-unit"][value="31"]').check();
  await page.locator('#redeploy-choices [data-type="tank"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' && window.playerHudStatsReview,
    null, { timeout: 180000 });
  const result = await page.evaluate(() => playerHudStatsReview());
  const players = result.scores.filter(row => row.player);
  assert.equal(players.length, 1); assert.equal(players[0].name, '战况测试员'); assert.equal(players[0].total, 30);
  assert.equal(players[0].kills.tank, 10); assert.equal(players[0].kills.rifle, 20);
  assert.ok(result.casualties.find(row => row.team === 'friendly').killed >= 3);
  assert.ok(result.casualties.find(row => row.team === 'enemy').killed >= 30);
  assert.ok(result.resultVisible); assert.equal(result.rows, 2);
  assert.match(result.resultText, /累计参战.*阵亡.*负伤存活.*未伤存活/);
  assert.match(result.resultText, /战况测试员 · 累计击杀 30/);
  assert.ok(['sniper', 'mortarman', 'machine-gunner'].every(role => result.roles.includes(role)));
  assert.match(result.mission, /夺取 A/);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'battle-results.png') });
    await writeFile(join(process.env.ARTIFACT_DIR, 'player-statistics.json'), JSON.stringify({ result, errors,
      note: 'Controlled registered-actor damage fixture: 10 tank kills, crew wipe, real infantry redeployment, then 20 rifle kills. The result panel is opened explicitly to inspect presentation, not claimed as a natural victory.' }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, player: players[0].name, kills: players[0].total, casualties: result.casualties, errors }));
} finally { await browser.close(); }
