import { deployFromMenu, continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], observations = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
page.setDefaultTimeout(180000);
try {
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.hudReview = {
        present() {
          setGameState('pause');
          if (document.pointerLockElement) document.exitPointerLock();
          combatFeedback.clear();
          for (const [index, weaponClass] of ['rifle','tank','melee','plane'].entries()) {
            combatFeedback.consume({
              type:'casualty', time,
              source:{credit:index%2?'enemy':'ally',team:index%2?'enemy':'friendly',
                soldierId:'hud-attacker-'+index,weaponClass},
              target:{id:'hud-target-'+index,team:index%2?'friendly':'enemy'}
            },null,time);
          }
          updateHUD();
          return {
            title:$('objective-title').textContent,help:$('objective-help').textContent,
            helpHidden:$('objective-help').hidden,captureHidden:document.querySelector('.capture-track').hidden,
            stage:nanjingCampaignMode?nanjingCampaign.stage:encirclement.phase
          };
        },
        resume() { setGameState('playing'); }
      };
    ` });
  });
  for (const campaign of ['taierzhuang', 'nanjing']) {
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
    if (campaign === 'nanjing') url.searchParams.set('campaign', 'nanjing');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    if (campaign === 'taierzhuang') {
      await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
      await page.locator('#redeploy-choices [data-type="infantry"]').click();
      await page.locator('#confirm-deploy').click();
    } else {
      await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
      await deployFromMenu(page);
    }
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    const mission = await page.evaluate(() => hudReview.present());
    if (campaign === 'taierzhuang') {
      assert.equal(mission.stage, 1);
      assert.equal(mission.help, '');
      assert.ok(mission.helpHidden && mission.captureHidden);
      assert.doesNotMatch(mission.title, /补给|补充|增援/);
    } else {
      assert.equal(mission.stage, 'gate-defense');
      assert.doesNotMatch(mission.help, /已到渡口|已撤离|AI小队/);
    }
    for (const viewport of [
      { width: 1920, height: 1080 }, { width: 1280, height: 720 },
      { width: 1024, height: 768 }, { width: 800, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const rect = selector => {
          const value = document.querySelector(selector).getBoundingClientRect();
          return { left:value.left,right:value.right,top:value.top,bottom:value.bottom,
            width:value.width,height:value.height };
        };
        const overlaps = (a,b) => a.width>0&&a.height>0&&b.width>0&&b.height>0&&
          a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
        const timer=rect('.battle-time'),pause=rect('#pause-button'),feed=rect('#kill-feed');
        const objective=rect('.objective-banner'),points=rect('#objectives');
        return { timer,pause,feed,objective,
          overlap:overlaps(timer,pause)||overlaps(timer,feed)||overlaps(pause,feed)||
            overlaps(objective,feed)||overlaps(objective,pause)||overlaps(timer,points),
          rows:[...document.querySelectorAll('#kill-feed .feed-entry')].map(row=>({
            text:row.textContent,label:row.getAttribute('aria-label'),title:row.title,
            icons:row.querySelectorAll('svg.score-icon').length,path:row.querySelector('path')?.getAttribute('d')
          }))
        };
      });
      assert.equal(layout.overlap, false, `${campaign} ${viewport.width}: HUD elements overlap`);
      assert.equal(layout.rows.length, 4);
      assert.ok(layout.rows.every(row => row.icons === 1 && row.path && row.title));
      assert.ok(layout.rows.every(row => !/阵亡|守兵|›|步枪|坦克|近战|航空/.test(row.text)));
      assert.equal(new Set(layout.rows.map(row => row.path)).size, 4);
      assert.ok(layout.rows.every(row => row.label.includes(row.title)));
      observations.push({ campaign, viewport, mission, layout });
      if (process.env.ARTIFACT_DIR && viewport.width === 1280) {
        await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `${campaign}-hud.png`) });
      }
    }
    await page.evaluate(() => hudReview.resume());
    assert.equal(await page.evaluate(() => document.pointerLockElement === null), true);
    await page.locator('#pause-button').click({ timeout: 15000 });
    await page.waitForFunction(() => window.__battle?.state === 'pause');
    await page.locator('#resume').click();
    await page.waitForFunction(() => window.__battle?.state === 'playing');
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify({ observations, errors }));
} finally {
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'hud-readability.json'),
      JSON.stringify({ observations, errors }, null, 2));
  }
  await browser.close();
}
