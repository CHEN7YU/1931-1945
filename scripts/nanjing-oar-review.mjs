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
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.oarReview = {
        sample(state, phase, view) {
          setGameState('pause'); missionBriefing.hide();
          for (const id of ['menu','hud','overlay','loading']) $(id).hidden=true;
          const ferry=world.ferries[0], rower=ferry.userData.rower;
          ferry.userData.state=state;
          updateNanjingFerryRower(ferry,phase);
          ferry.updateMatrixWorld(true);
          const oar=ferry.userData.oar;
          const tip=oar.localToWorld(new THREE.Vector3(...oar.userData.bladeTip));
          camera.position.copy(ferry.localToWorld(new THREE.Vector3(...(view==='aboard' ? [-1.4,1.65,0] : [1,3.2,5]))));
          camera.lookAt(ferry.localToWorld(new THREE.Vector3(2.35,1.15,0)));
          camera.fov=65;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
          for(const child of camera.children)child.visible=false;
          renderer.render(scene,camera);
          return {state,phase,tip:tip.toArray(),water:world.impactHeight(tip.x,tip.z),
            deep:world.isDeepWater(tip.x,tip.z),visible:oar.visible};
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const samples = [];
  for (const state of ['outbound', 'inbound']) for (const phase of [0, .56, 1.12, 1.68]) {
    const result = await page.evaluate(({state,phase}) => oarReview.sample(state,phase,'aboard'), {state,phase});
    samples.push(result);
    if (phase === .56) {
      await page.screenshot({path:join(directory,`${state}-aboard.png`)});
      await page.evaluate(({state,phase}) => oarReview.sample(state,phase,'side'), {state,phase});
      await page.screenshot({path:join(directory,`${state}-side.png`)});
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory,'samples.json'), JSON.stringify({ fixture: 'Paused game, ferry state and camera assigned for visual inspection.', samples, errors },null,2));
  console.log(JSON.stringify({ samples, errors }));
} finally { await browser.close(); }
