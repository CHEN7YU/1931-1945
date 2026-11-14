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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.regroupReview = {
        start() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const actor of allForces) actor.nextFire = time + 100000;
          sihangCombat.update(0, time, { campaign: sihangCampaign, actors: allForces,
            player: allies[current], keys });
          const sappers = enemies.filter(actor => actor.health > 0 && actor.formation.sihangDemolition);
          if (sappers.length !== 20) throw new Error('Expected twenty living sappers');
          const casualty = sappers.find(actor => actor.sihangShield?.role === 'front');
          if (!casualty) throw new Error('Expected a front shield carrier');
          casualty.health = 0;
          return this.snapshot();
        },
        step(seconds) {
          setGameState('playing');
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.snapshot();
        },
        secondCasualty() {
          const casualty = enemies.find(actor => actor.health > 0 && actor.formation.sihangDemolition &&
            actor.sihangShield?.role === 'front');
          if (!casualty) throw new Error('Expected another front shield carrier');
          casualty.health = 0;
          return this.snapshot();
        },
        snapshot() {
          return { time, formation: sihangCombat.snapshot, formed: sihangCombat.formed,
            sappers: enemies.filter(actor => actor.health > 0 && actor.formation.sihangDemolition).map(actor => ({
              id: actor.id, position: actor.position.toArray(), role: actor.sihangShield?.role,
              goal: sihangCombat.goalFor(actor, sihangCampaign), mode: actor.tactics.mode,
            })) };
        },
        capture() {
          const anchor = sihangCombat.snapshot.anchor;
          camera.position.set(anchor.x - 8, 6, anchor.z + 8);
          camera.lookAt(anchor.x, 1, anchor.z); camera.updateMatrixWorld(true);
          const displayed = allForces.filter(actor => actor.health > 0);
          nraCharacter?.update(displayed.filter(actor => actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          ijaCharacter?.update(displayed.filter(actor => !actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          const uniformExcludedIds = new Set();
          for (const force of [nraCharacter, ijaCharacter])
            for (const id of force?.excludedIds ?? []) uniformExcludedIds.add(id);
          soldierRenderer.update(displayed, graphics.snapshot.preset, time,
            entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/png').split(',')[1];
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const records = [await page.evaluate(() => regroupReview.start())];
  records.push(await page.evaluate(() => regroupReview.step(.5)));
  records.push(await page.evaluate(() => regroupReview.secondCasualty()));
  for (let i = 0; i < 12; i++) {
    records.push(await page.evaluate(() => regroupReview.step(2)));
    if (records.at(-1).formed) break;
  }
  const image = await page.evaluate(() => regroupReview.capture());
  await writeFile(join(directory, 'regroup.png'), Buffer.from(image, 'base64'));
  await writeFile(join(directory, 'regroup.json'), JSON.stringify({
    fixture: 'initial-formation-two-front-casualties-injected-0.5-s-apart-fire-disabled-actual-ai-steps', records, errors,
  }, null, 2));
  assert.equal(records.at(-1).sappers.length, 18);
  assert.equal(records.at(-1).sappers.filter(actor => actor.role === 'front').length, 2);
  assert.equal(records.at(-1).formed, true, 'survivors must reach their new formation');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ seconds: records.at(-1).time - records[0].time, formed: records.at(-1).formed }));
} finally {
  await browser.close();
}
