import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  let loadingMusic = null;
  // Explicit UI fixture only: do not ship a mutation hook or claim this as natural combat deaths.
  await page.route(/\/src\/main\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const original = await response.text();
    loadingMusic = await page.evaluate(() => {
      const audio = document.getElementById('menu-music');
      return { playing: !audio.paused, time: audio.currentTime, loading: !document.getElementById('loading').hidden };
    });
    await route.fulfill({ response, body: original + `
window.__deploymentFixture = (owned = true) => {
  for (const actor of allies) actor.health = 0;
  const point = objectives.find(point => point.id === 'A');
  point.owner = owned ? 'friendly' : 'enemy';
  if (state !== 'dead') showOverlay('dead'); else refreshDeployment();
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.waitForFunction(() => {
    const audio = document.getElementById('menu-music');
    return !audio.paused && audio.currentTime > .1;
  });
  await page.locator('#overlay [data-menu-music-toggle]').click();
  assert.equal(await page.locator('#menu-music').evaluate(audio => audio.paused), true);
  await page.keyboard.press('Shift');
  assert.equal(await page.locator('#menu-music').evaluate(audio => audio.paused), true);
  await page.locator('#overlay [data-menu-music-toggle]').click();
  await page.waitForFunction(() => !document.getElementById('menu-music').paused);
  const layouts = [];
  async function checkVisibleDeployment(stage) {
    for (const [width, height] of [[1920, 1080], [1740, 1250], [1366, 768], [1280, 720], [960, 540], [640, 600], [360, 640]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#overlay > .dialog').evaluate(dialog => { dialog.scrollTop = 0; });
      const result = await page.evaluate(stage => {
        const dialog = document.querySelector('#overlay > .dialog');
        const button = document.getElementById(stage === 'identity' ? 'confirm-identity' : 'confirm-deploy'), bounds = button.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return { visible: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.right <= innerWidth &&
          (hit === button || button.contains(hit)),
        scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
        nested: [...dialog.querySelectorAll('*')].filter(element => element.getClientRects().length &&
          /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
          .map(element => element.id || element.className) };
      }, stage);
      assert.deepEqual(result.nested, [], `${stage} ${width}x${height}: only the outer dialog may scroll`);
      assert.equal(result.horizontalOverflow, false, `${stage} ${width}x${height}: no horizontal scrolling`);
      if (width >= 1280 && height >= 720) {
        assert.ok(result.scrollHeight <= result.clientHeight + 1,
          `${stage} ${width}x${height}: desktop fits without scrolling (${result.scrollHeight}/${result.clientHeight})`);
        assert.equal(result.visible, true, `${stage} ${width}x${height}: entry button must be directly clickable`);
      }
      for (const selector of stage === 'identity' ? ['#player-unit-cards input', '#confirm-identity'] :
        ['#redeploy-choices button', '#spawn-choices button', '#confirm-deploy']) {
        for (const control of await page.locator(selector).all()) {
          await control.scrollIntoViewIfNeeded();
          assert.equal(await control.evaluate(element => {
            const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return hit === element || element.contains(hit);
          }), true, `${stage} ${width}x${height}: ${selector} remains reachable`);
        }
      }
      layouts.push({ stage, width, height, ...result });
      if (width === 1366)
        await page.screenshot({ path: join(directory, `${stage}-deployment-1366.png`) });
    }
    await page.locator('#deployment-help > summary').click();
    const nestedHelp = await page.locator('#deployment-help').evaluate(help => getComputedStyle(help).overflowY);
    assert.equal(nestedHelp, 'visible', 'expanded instructions use the same outer scroll container');
    await page.locator('#deployment-help > summary').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#overlay > .dialog').evaluate(dialog => { dialog.scrollTop = 0; });
  }
  assert.equal(await page.locator('#redeploy-choices').isVisible(), false);
  assert.equal(await page.locator('#deployment-options').isVisible(), false);
  await checkVisibleDeployment('identity');
  await page.locator('input[name="player-unit"][value="custom"]').check();
  await page.locator('#custom-squad-name').fill('部署界面测试小队');
  assert.equal(await page.locator('#custom-squad-name').isVisible(), true);
  await page.locator('input[name="player-unit"]').first().check();
  await page.locator('#confirm-identity').click();
  await page.waitForFunction(() => window.__battle?.state === 'menu' &&
    document.getElementById('overlay').dataset.deploymentStep === 'squad', null, { timeout: 180000 });
  assert.equal(await page.locator('#player-identity').isVisible(), false);
  assert.equal(await page.locator('#redeploy-choices [data-type="infantry"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false, 'default squad and safe spawn allow direct entry');
  await checkVisibleDeployment('initial');
  await page.locator('#redeploy-choices [data-type="tank"]').click();
  await page.locator('#back-menu').click();
  assert.equal(await page.locator('#player-identity').isVisible(), true);
  await page.locator('#confirm-identity').click();
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad');
  assert.equal(await page.locator('#redeploy-choices [data-type="tank"]').getAttribute('aria-pressed'), 'true',
    'going back to identity must preserve the player-selected squad');
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  assert.ok(loadingMusic?.playing && loadingMusic.loading && loadingMusic.time > 0, 'music continues during actual main-module loading');
  await page.waitForFunction(() => document.getElementById('menu-music').paused && document.getElementById('menu-music').currentTime === 0);
  await page.evaluate(() => window.__deploymentFixture(true));
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await checkVisibleDeployment('redeployment');
  assert.equal(await page.locator('#menu-music').evaluate(audio => audio.paused), true, 'redeployment must not restart lobby music');
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false, 'new squad gets a safe default recommendation');
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false);
  await page.locator('#redeploy-choices [data-type="tank"]').click();
  assert.deepEqual(await page.locator('#spawn-choices button').evaluateAll(buttons => buttons.map(button => button.dataset.spawn)), ['china-garage']);
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false);
  await page.locator('#spawn-choices button').click();
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false);
  await page.locator('#redeploy-choices [data-type="plane"]').click();
  assert.deepEqual(await page.locator('#spawn-choices button').evaluateAll(buttons => buttons.map(button => button.dataset.spawn)), ['china-air']);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#deployment-options').screenshot({ path: join(directory, 'redeploy-map.png') });
  await page.evaluate(() => window.__deploymentFixture(false));
  assert.equal(await page.locator('#spawn-choices [data-spawn^="captured-A"]').count(), 0);
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing' && window.__battle.deployments === 2);
  assert.equal(await page.evaluate(() => window.__battle.type), 'infantry');
  assert.equal(await page.evaluate(() => window.__battle.allies.length), 11);
  await page.locator('#pause-button').click();
  await page.locator('#back-menu').click();
  await page.locator('#deploy').click();
  await page.locator('#confirm-identity').click();
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad');
  await page.locator('#back-menu').click();
  await page.locator('#back-menu').click();
  assert.equal(await page.locator('#menu').isVisible(), true, 'back from both deployment steps must restore the campaign screen');
  assert.equal(await page.locator('#confirm-campaign').isVisible(), true);
  await page.locator('#confirm-campaign').click();
  assert.equal(await page.locator('#player-identity').isVisible(), true, 'the same campaign can be selected again without an extra page reload');
  assert.deepEqual(errors, []);
  const result = { passed: true, limitation: 'Explicit local death/ownership UI fixture; not natural combat evidence',
    sameTypeRedeployment: true, tankInitialOnly: true, planeAirOnly: true, ownershipRefresh: true, layouts,
    music: { loadingMusic, battleStopped: true, redeploymentStayedSilent: true } };
  await writeFile(join(directory, 'deployment-ui.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
