import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
const campaign = process.env.CAMPAIGN;
if (!directory || !['sihang', 'nanjing'].includes(campaign)) throw new Error('ARTIFACT_DIR and CAMPAIGN are required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => {
    if (message.type() === 'error' && /WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text()))
      errors.push(message.text());
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.waterWaveReview = {
        startMovingFerry() {
          setGameState('pause'); missionBriefing.hide();
          const ferry = world.ferries[0], boat = nanjingCampaign.boats[ferry.userData.ferryId];
          ferry.userData.state = 'outbound'; ferry.userData.gangplank.visible = false;
          boat.returning = true;
          updateNanjingFerryRower(ferry, time);
          this.movingFerry = ferry;
          return this.captureMovingFerry();
        },
        captureMovingFerry(seconds = 0, angle = 0) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            time += .05;
            updateNanjingCivilians(.05);
          }
          world.updateWater(time);
          const ferry = this.movingFerry;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          camera.position.set(ferry.position.x + 3 * cos + 7 * sin, 3.2,
            ferry.position.z + 7 * cos - 3 * sin);
          camera.lookAt(ferry.position.x, .2, ferry.position.z);
          camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          return { image: renderer.domElement.toDataURL('image/png'), error: renderer.getContext().getError(),
            time, position: ferry.position.toArray(), state: ferry.userData.state,
            rowerVisible: ferry.userData.rower.visible, oarVisible: ferry.userData.oar.visible };
        },
        capture(at, close = false, dock = false) {
          setGameState('pause'); missionBriefing.hide();
          ${campaign === 'sihang'
    ? `if (close) { camera.position.set(10, .3, 10); camera.lookAt(10, -1, 15); }
      else { camera.position.set(12, 5, -4); camera.lookAt(12, -1, 15); }`
    : `if (dock) { camera.position.set(-86, 4, -74); camera.lookAt(-76, .2, -80); }
      else if (close) { camera.position.set(2, -.4, 46); camera.lookAt(2, -1.9, 51); }
      else { camera.position.set(0, 5, 38); camera.lookAt(0, -.3, 52); }`}
          camera.updateMatrixWorld(true);
          world.updateWater(at);
          renderer.render(scene, camera);
          const error = renderer.getContext().getError();
          const bodies = scene.children.filter(item => item.name === 'floating-civilian-remains');
          return { image: renderer.domElement.toDataURL('image/png'), error,
            bodies: bodies.map(body => body.position.y),
            ferries: (world.ferries ?? []).map(ferry => ferry.position.toArray()) };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', campaign); url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const frames = [], heights = [];
  for (const at of [0, 2.5, 5]) {
    const result = await page.evaluate(at => window.waterWaveReview.capture(at), at);
    frames.push(result.image);
    heights.push(result.bodies);
    await writeFile(join(directory, `${campaign}-${at}.png`), Buffer.from(result.image.split(',')[1], 'base64'));
    assert.equal(result.error, 0, `WebGL error for ${campaign} at ${at}`);
  }
  assert.notEqual(frames[0], frames[1]);
  assert.notEqual(frames[1], frames[2]);
  assert.equal(heights[0].length, 0);
  const close = await page.evaluate(() => window.waterWaveReview.capture(2.5, true));
  assert.equal(close.error, 0);
  await writeFile(join(directory, `${campaign}-floating-close.png`), Buffer.from(close.image.split(',')[1], 'base64'));
  if (campaign === 'nanjing') {
    const first = await page.evaluate(() => window.waterWaveReview.capture(0, false, true));
    const later = await page.evaluate(() => window.waterWaveReview.capture(5, false, true));
    assert.equal(first.error, 0); assert.equal(later.error, 0);
    assert.ok(first.ferries.length > 0);
    assert.deepEqual(first.ferries, later.ferries);
    await writeFile(join(directory, 'nanjing-dock-0.png'), Buffer.from(first.image.split(',')[1], 'base64'));
    await writeFile(join(directory, 'nanjing-dock-5.png'), Buffer.from(later.image.split(',')[1], 'base64'));
    if (process.env.MOVING_FERRY_REVIEW === '1') {
      const moving = [await page.evaluate(() => waterWaveReview.startMovingFerry())];
      const detailed = process.env.MOVING_FERRY_DETAILED === '1';
      for (let i = 0; i < (detailed ? 15 : 2); i++)
        moving.push(await page.evaluate(seconds => waterWaveReview.captureMovingFerry(seconds), detailed ? .2 : 1.5));
      await writeFile(join(directory, 'nanjing-ferry-moving.json'), JSON.stringify({
        fixture: 'Manually launched an empty ferry; production ferry update and water animation advanced together.',
        frames: moving.map(({ image, ...frame }) => frame),
      }, null, 2));
      for (const [index, frame] of moving.entries()) {
        assert.equal(frame.error, 0);
        assert.equal(frame.state, 'outbound');
        assert.equal(frame.rowerVisible, true);
        assert.equal(frame.oarVisible, true);
        await writeFile(join(directory, `nanjing-ferry-moving-${index}.png`),
          Buffer.from(frame.image.split(',')[1], 'base64'));
      }
      assert.ok(moving.at(-1).position[0] < moving[0].position[0] - 8);
      assert.equal(moving[0].position[1], moving.at(-1).position[1]);
      if (process.env.MOVING_FERRY_VIEWS === '1') {
        for (const [index, angle] of [Math.PI / 2, Math.PI, Math.PI * 1.5].entries()) {
          const view = await page.evaluate(angle => waterWaveReview.captureMovingFerry(0, angle), angle);
          assert.equal(view.error, 0);
          await writeFile(join(directory, `nanjing-ferry-view-${index}.png`),
            Buffer.from(view.image.split(',')[1], 'base64'));
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, `${campaign}-review.json`), JSON.stringify({
    fixture: 'Paused production battlefield with a manually positioned diagnostic camera and manually advanced water time.',
    times: [0, 2.5, 5], heights, errors,
  }, null, 2));
  console.log(`${campaign} water frames captured without WebGL errors.`);
} finally {
  await browser.close();
}
