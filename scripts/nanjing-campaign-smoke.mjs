import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { NANJING_CITY_WALLS, NANJING_DOCK } from '../src/nanjing-campaign.js';
import { NANJING_GATE_LENGTH } from '../src/nanjing-layout.js';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const artifacts = process.env.ARTIFACT_DIR;

try {
  await page.goto(new URL('/?campaign=nanjing', origin).href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' && !document.querySelector('#menu').hidden,
    null, { timeout: 90000 });
  assert.equal(await page.locator('#game-title').textContent(), '南京保卫战');
  assert.equal(await page.locator('#nanjing-menu-return').isVisible(), true);
  assert.deepEqual(await page.locator('#squad-choices [data-type]:visible').evaluateAll(buttons => buttons.map(button => button.dataset.type)),
    ['infantry']);
  assert.deepEqual(await page.locator('#redeploy-choices [data-type]').evaluateAll(buttons => buttons.map(button => button.dataset.type)),
    ['infantry']);
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 30000 });

  const data = await page.evaluate(() => window.__battle);
  assert.equal(data.campaign.stage, 'gate-defense');
  const gate = data.objectives.find(point => point.id === 'gate');
  assert.equal(gate.name, '中华门第二道门内西侧');
  assert.ok(gate.x < 0 && Math.abs(gate.z) < .1);
  assert.ok((await page.locator('#objective-help').textContent()).includes('第二道门内左侧'));
  const gateSpawn = data.spawnPoints.find(point => point.id === 'nanjing-gate');
  assert.ok(gateSpawn.z < 0 && gateSpawn.z > -1);
  assert.equal(gateSpawn.name, '中华门北墙内侧');
  assert.equal(data.campaign.airSupport.count, 3);
  assert.ok(data.campaign.airSupport.aircraft.every(plane => plane.team === 'enemy' && plane.model === 'ki-10'));
  for (const [width, height] of [[960, 540], [1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const spacing = await page.evaluate(() => {
      const timer = document.querySelector('.battle-time').getBoundingClientRect();
      const pause = document.querySelector('#pause-button').getBoundingClientRect();
      const banner = document.querySelector('.objective-banner').getBoundingClientRect();
      const digits = document.querySelector('#timer');
      return { gap: pause.left - timer.right, right: pause.right,
        center: (timer.left + timer.right) / 2, timerBottom: timer.bottom, bannerTop: banner.top,
        font: parseFloat(getComputedStyle(digits).fontSize), color: getComputedStyle(digits).color };
    });
    assert.ok(spacing.gap >= 12, `timer and pause must not overlap at ${width}x${height}`);
    assert.ok(spacing.right <= width - 19, 'pause button must stay inside the viewport');
    assert.ok(Math.abs(spacing.center - width / 2) < 1, 'mission timer belongs in the upper center');
    assert.ok(spacing.bannerTop > spacing.timerBottom, 'mission text must not overlap the countdown');
    assert.ok(spacing.font >= 32);
    assert.equal(spacing.color, 'rgb(255, 136, 123)');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.ok(Math.abs(data.look.yaw - Math.PI) < .001, 'gate deployment should face the southern assault, not the inner city');
  assert.ok(data.campaign.stageRemaining <= 180 && data.campaign.stageRemaining > 178,
    `Unexpected initial stage clock: ${data.campaign.stageRemaining}`);
  assert.equal(await page.locator('#timer-label').textContent(), '中华门防守倒计时');
  const displayedClock = await page.locator('#timer').textContent();
  assert.match(displayedClock, /^0[23]:\d{2}$/);
  assert.equal(data.campaign.map.ferries, 5);
  assert.deepEqual(data.campaign.map.cityWalls, NANJING_CITY_WALLS);
  const dock = data.objectives.find(point => point.id === 'dock');
  assert.deepEqual({ x: dock.x, z: dock.z }, { x: NANJING_DOCK.x, z: NANJING_DOCK.z });
  assert.ok(dock.x < -60 && dock.z < -70, 'the dock must be in the northwest corner');
  const dockSpawn = data.spawnPoints.find(point => point.id === 'nanjing-west-dock');
  assert.deepEqual({ x: dockSpawn.x, z: dockSpawn.z }, { x: dock.x, z: dock.z });
  assert.equal(data.campaign.map.bridges.length, 1, 'only the southern gate assault bridge remains');
  assert.equal(data.campaign.map.gateBarbicans, 2);
  assert.equal(data.campaign.map.alignedGateways, 3);
  assert.deepEqual(data.campaign.map.gatehouse.footprint, { width: 47.4, length: NANJING_GATE_LENGTH, height: 8.58 });
  assert.equal(data.campaign.map.courtyards.length, 2);
  assert.ok(data.campaign.map.courtyards.every(court => court.width === 18.88 &&
    court.minX === -9.44 && court.maxX === 9.44));
  assert.equal(data.campaign.map.flankingStructures.length, 4);
  assert.equal(data.campaign.map.wallRamps.length, 2);
  assert.deepEqual(data.campaign.map.rivers.map(river => river.name), ['秦淮河南段', '长江']);
  assert.ok(data.campaign.map.residentialBuildings.length >= 20);
  assert.equal(data.campaign.map.primaryAssaultRoute, 'yuhua-road-bridge-through-jubaomen');
  assert.equal(data.spawnId, 'nanjing-gate-front-0');
  const openingDefenders = data.population.units.filter(unit => unit.team === 'friendly').flatMap(unit => unit.members);
  assert.equal(openingDefenders.length, 33);
  assert.ok(openingDefenders.every(member => member.z > 21.2 && member.z < 34 && member.y === 0));
  assert.equal(data.campaign.map.forwardDefenses.length, 6);
  assert.equal(data.population.units.filter(unit => unit.team === 'friendly').length, 5);
  assert.equal(data.population.units.filter(unit => unit.team === 'enemy').length, 10);
  assert.equal(data.population.units.filter(unit => unit.team === 'enemy' && unit.type === 'infantry').length, 8);
  assert.equal(data.population.units.filter(unit => unit.team === 'enemy' && unit.type === 'tank').length, 1);
  assert.equal(data.population.units.filter(unit => unit.assaultCrossing === 'bridge').length, 8);
  assert.equal('ford' in data.campaign.map, false);
  assert.equal(data.population.units.filter(unit => unit.team === 'friendly' && unit.memberCount > 0).length, 3);
  assert.equal(data.population.units.filter(unit => unit.team === 'friendly' && unit.memberCount === 0).length, 2);
  assert.equal(data.campaign.civilianVisuals.active > 0, true);
  assert.equal(data.campaign.civilianVisuals.arrived, 0);
  const mapPixels = await page.locator('#radar').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    const color = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    return {
      southRiver: color(120, 130),
      westYangtze: color(21, 120),
      fortressWall: color(69, 95),
    };
  });
  assert.deepEqual(mapPixels.southRiver, [36, 80, 93]);
  assert.deepEqual(mapPixels.westYangtze, [36, 80, 93]);
  assert.ok(mapPixels.fortressWall[0] > mapPixels.fortressWall[1], 'minimap should outline the fort walls');
  const flankPixels = await page.locator('#radar').evaluate((canvas, structures) => {
    const ctx = canvas.getContext('2d');
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return [-1, 1].map(side => structures.filter(structure => structure.side === side).reduce((count, structure) => {
      const minX = Math.ceil((structure.minX + 110) / 220 * canvas.width);
      const maxX = Math.floor((structure.maxX + 110) / 220 * canvas.width);
      const minZ = Math.ceil((structure.minZ + 110) / 220 * canvas.height);
      const maxZ = Math.floor((structure.maxZ + 110) / 220 * canvas.height);
      for (let z = minZ; z < maxZ; z++) for (let x = minX; x < maxX; x++) {
        const index = (z * canvas.width + x) * 4;
        if (image.data[index] === 116 && image.data[index + 1] === 107 && image.data[index + 2] === 81) count++;
      }
      return count;
    }, 0));
  }, data.campaign.map.flankingStructures);
  assert.ok(flankPixels.every(count => count > 0), 'minimap should fill both masonry flanks, not just the outer walls');

  const layout = await page.evaluate(() => {
    const hud = document.querySelector('#hud');
    const bounds = hud.getBoundingClientRect();
    return { viewport: { width: innerWidth, height: innerHeight },
      hud: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      scrollWidth: document.documentElement.scrollWidth };
  });
  assert.equal(layout.viewport.width, 1440);
  assert.ok(layout.scrollWidth <= layout.viewport.width, `Unexpected horizontal overflow: ${JSON.stringify(layout)}`);
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, 'nanjing-campaign.png') });
    await writeFile(join(artifacts, 'nanjing-campaign.json'), JSON.stringify({ layout, campaign: data.campaign,
      roster: data.population.units.map(({ id, team, type, memberCount, spawnId }) => ({ id, team, type, memberCount, spawnId })),
      errors }, null, 2));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ layout, campaign: data.campaign, errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ errors, loading: await page.locator('#loading').textContent() }));
  throw error;
} finally {
  await browser.close();
}
