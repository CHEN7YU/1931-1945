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
    const source = await response.text();
    const routeCall = /const path = rejoinCivilianRoute\(civilian\.position, shore, world\.civilianNavigate,\s*world\.civilianNavigationObstacles, civilianNavigationLookup\);/g;
    assert.equal([...source.matchAll(routeCall)].length, 1, 'Production civilian boarding route seam changed');
    const instrumented = source.replace(routeCall, `const path = window.civilianBoardingReview.failNextRoute
          ? (window.civilianBoardingReview.failNextRoute = false,
            window.civilianBoardingReview.failedRoute = { civilianId: civilian.userData.civilianId,
              ferryId: ferry.userData.ferryId }, null)
          : rejoinCivilianRoute(civilian.position, shore, world.civilianNavigate,
            world.civilianNavigationObstacles, civilianNavigationLookup);`);
    await route.fulfill({ response, body: instrumented + `
      window.civilianBoardingReview = {
        start(count = 15) {
          setGameState('pause'); missionBriefing.hide(); enemies = []; rebuildForces();
          this.failNextRoute = true; this.failedRoute = null;
          combatSounds.length = 0; world.resetCampaign(); time = 0;
          nanjingCampaign = createNanjingCampaign();
          nanjingCampaign.stage = 'dock-defense'; nanjingCampaign.dockActivated = true;
          const people = world.civilians.slice(0, count);
          for (const person of world.civilians) {
            person.userData.dead = !people.includes(person); person.visible = people.includes(person);
          }
          world.civilianQueue.length = 0;
          for (const person of people) {
            const data = person.userData, point = data.waitingSlot;
            person.position.set(point.x, world.groundHeight(point.x, point.z), point.z);
            Object.assign(data, { active: true, arrived: true, dead: false, boarding: false,
              unrescued: false, evacuated: false, route: [point], waypoint: 1 });
            world.civilianQueue.push(person);
          }
          nanjingCampaign.civiliansArrived = nanjingCampaign.civiliansWaiting = people.length;
          return this.snapshot();
        },
        step(seconds) {
          for (let frame = 0; frame < Math.round(seconds / .05); frame++) {
            time += .05; updateNanjingCivilians(.05); controlEvents.drain(() => {});
          }
          return this.snapshot();
        },
        snapshot() {
          return { time, failedRoute: this.failedRoute, waiting: nanjingCampaign.civiliansWaiting, aboard: nanjingCampaign.civiliansAboard,
            evacuated: nanjingCampaign.civiliansEvacuated,
            boats: world.ferries.map(ferry => ({ id: ferry.userData.ferryId,
              state: ferry.userData.state, boarding: ferry.userData.boarding?.civilian.userData.civilianId ?? null,
              passengers: ferry.userData.passengers.length,
              departures: nanjingCampaign.boats[ferry.userData.ferryId].departures })) };
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const count = Number(process.env.CIVILIAN_COUNT ?? 15);
  if (!Number.isInteger(count) || count < 15 || count > 180) throw new RangeError('CIVILIAN_COUNT must be between 15 and 180');
  const records = [await page.evaluate(count => civilianBoardingReview.start(count), count)];
  for (let step = 0; step < 400 && records.at(-1).evacuated < count; step++)
    records.push(await page.evaluate(() => civilianBoardingReview.step(5)));
  await writeFile(join(directory, 'civilian-boarding.json'), JSON.stringify({
    fixture: `${count} manually positioned real civilians at their real dock waiting slots; enemies disabled; first boarding route forced to fail; production civilian and ferry update`,
    records, errors }, null, 2));
  assert.ok(records.some(record => record.failedRoute), 'the production boarding path must encounter the injected route failure');
  assert.ok(records.some(record => record.boats.filter(boat => boat.boarding !== null).length >= 2),
    'more than one ferry must physically board civilians concurrently');
  assert.ok(new Set(records.flatMap(record => record.boats.filter(boat => boat.departures > 0).map(boat => boat.id))).size >= 2,
    'multiple ferries must depart');
  assert.equal(records.at(-1).evacuated, count, 'all civilians must physically cross');
  assert.deepEqual(errors, []);
  console.log('Civilian multi-ferry boarding passed.');
} finally { await browser.close(); }
