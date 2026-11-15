import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.blastBlurReview = {
        setup() {
          const actor = controlledSoldier(entities);
          const enemy = enemies.find(candidate => candidate.health > 0 && !candidate.vehicleId && candidate.rifle);
          if (!actor || !enemy) throw new Error('Missing actors for blast review');
          this.source = captureAttackSource(entities, enemy, enemy.rifle);
          actor.health = 1000;
          simulationClock.setActive(false, performance.now());
        },
        explode(kind) {
          const actor = controlledSoldier(entities);
          actor.blastReaction = null; actor.blastRecoveryUntil = 0;
          const origin = actor.position.clone().add(new THREE.Vector3(.5, .1, 0));
          const source = kind === 'grenade' ? this.source : { ...this.source, weaponClass: 'tank' };
          explode(origin, 70, 7, source, kind === 'grenade' ? kind : 'explosion');
          if (!actor.blastReaction) throw new Error('Blast did not start a reaction');
          for (let i = 0; i < 3; i++) advanceBattleStep(.05, time);
          return { elapsed: actor.blastReaction.elapsed, health: actor.health };
        },
        repeat() {
          const actor = controlledSoldier(entities), before = actor.blastReaction.elapsed;
          const origin = actor.position.clone().add(new THREE.Vector3(.5, .1, 0));
          explode(origin, 70, 7, this.source, 'grenade');
          return { before, after: actor.blastReaction.elapsed };
        },
        finish() {
          for (let i = 0; i < 40; i++) advanceBattleStep(.05, time);
        },
        pause() { setGameState('pause'); },
        resumeFrozen() { setGameState('playing'); simulationClock.setActive(false, performance.now()); }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  await page.goto(url.href);
  const menuToggle = page.locator('#menu [data-blast-blur]');
  await menuToggle.evaluate(element => element.click());
  assert.equal(await menuToggle.isChecked(), false);
  await page.reload();
  assert.equal(await menuToggle.isChecked(), false);
  await menuToggle.evaluate(element => element.click());
  assert.equal(await menuToggle.isChecked(), true);
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('character', 'procedural');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => blastBlurReview.setup());
  const grenade = await page.evaluate(() => blastBlurReview.explode('grenade'));
  await page.waitForFunction(() => document.querySelector('#world').style.filter.startsWith('blur('));
  const enabled = await page.locator('#world').evaluate(element => element.style.filter);
  const repeat = await page.evaluate(() => blastBlurReview.repeat());
  assert.equal(repeat.after, repeat.before);
  await page.evaluate(() => document.querySelector('[data-blast-blur]').click());
  await page.waitForFunction(() => !document.querySelector('#world').style.filter);
  await page.screenshot({ path: join(directory, 'disabled.png') });
  await page.evaluate(() => document.querySelector('[data-blast-blur]').click());
  await page.waitForFunction(() => document.querySelector('#world').style.filter.startsWith('blur('));
  await page.screenshot({ path: join(directory, 'enabled.png') });
  assert.equal(await page.locator('#hud').evaluate(element => getComputedStyle(element).filter), 'none');
  await page.evaluate(() => blastBlurReview.pause());
  assert.equal(await page.locator('#world').evaluate(element => element.style.filter), '');
  await page.evaluate(() => blastBlurReview.resumeFrozen());
  await page.waitForFunction(() => document.querySelector('#world').style.filter.startsWith('blur('));
  await page.evaluate(() => blastBlurReview.finish());
  await page.waitForFunction(() => !document.querySelector('#world').style.filter);
  const tank = await page.evaluate(() => blastBlurReview.explode('tank'));
  await page.waitForFunction(() => document.querySelector('#world').style.filter.startsWith('blur('));
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({
    fixture: 'Nanjing procedural actors; artificial grenade and tank explosions near an elevated-health player; frozen simulation and manually stepped battle updates, not natural gameplay.',
    grenade, tank, enabled, repeat, errors,
  }, null, 2));
  console.log(JSON.stringify({ grenade, tank, enabled, repeat }));
} finally {
  await browser.close();
}
