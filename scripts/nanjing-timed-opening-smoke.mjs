import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const onOpeningBridge = position => Math.abs(position.x + 24) < 5 && position.z > 39 && position.z < 65;
      const originalUpdateOpeningCivilians = updateNanjingCivilians;
      let firstOpeningBridgeOverlap = null;
      updateNanjingCivilians = function(dt) {
        originalUpdateOpeningCivilians(dt);
        if (firstOpeningBridgeOverlap || !nanjingCampaign.openingAssaultReleased) return;
        const civilians=world.civilians.filter(c=>c.userData.openingWave&&c.visible&&!c.userData.dead&&onOpeningBridge(c.position)).length;
        const enemies=formations.filter(f=>f.team==='enemy'&&f.type==='infantry')
          .flatMap(f=>f.members).filter(a=>a.health>0&&onOpeningBridge(a.position)).length;
        if(civilians&&enemies) firstOpeningBridgeOverlap={time,civilians,enemies};
      };
      window.timedOpeningSample = () => {
        return { time, elapsed:nanjingCampaign.stageElapsed, released:nanjingCampaign.openingAssaultReleased,
          crossed:nanjingCampaign.civiliansCrossedRiver,
          civilians:world.civilians.filter(c=>c.userData.openingWave&&c.visible&&!c.userData.dead&&onOpeningBridge(c.position)).length,
          enemies:formations.filter(f=>f.team==='enemy'&&f.type==='infantry')
            .flatMap(f=>f.members).filter(a=>a.health>0&&onOpeningBridge(a.position)).length,
          squads:formations.filter(f=>f.team==='enemy'&&f.type==='infantry'&&f.members.length).length,
          firstOverlap:firstOpeningBridgeOverlap,hud:$('objective-help').textContent };
      };` });
  });
  const url = new URL('/?campaign=nanjing&character=procedural', process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  await page.goto(url.href); await setQualityPreset(page, 'low'); await deployFromMenu(page);
  for (const second of [15, 21, 30, 40, 50, 60, 70, 80, 90]) {
    await page.waitForFunction(second => window.__battle?.campaign?.stageElapsed >= second,
      second, { timeout: 180000 });
    const sample = await page.evaluate(() => timedOpeningSample());
    samples.push(sample); console.log(JSON.stringify(sample));
    if (sample.firstOverlap) break;
  }
  assert.equal(samples[0].released, false);
  assert.equal(samples[0].squads, 0);
  assert.match(samples[0].hud, /日军进攻倒计时/);
  assert.equal(samples[1].released, true);
  assert.equal(samples[1].squads, 8);
  assert.match(samples[1].hud, /日军已开始进攻/);
  assert.ok(samples.some(sample => sample.firstOverlap),
    'living civilians and Japanese infantry must overlap on the bridge during normal simulation');
  assert.deepEqual(errors, []);
} finally {
  console.log(JSON.stringify({ samples, errors }));
  await browser.close();
}
