import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const baseline = Object.fromEntries(['nanjing-battlefield.js', 'nanjing-city-layout.js', 'war-damage.js'].map(name =>
  [name, execFileSync('git', ['show', `HEAD:src/${name}`], { encoding: 'utf8' })]));
const versions = process.env.REVIEW_VERSION ? [process.env.REVIEW_VERSION] : ['before', 'after'];
if (versions.some(version => !['before', 'after'].includes(version))) throw new Error('Invalid REVIEW_VERSION');
const views = [
  { id: 'market', position: [-35, 1.65, -59], target: [-45, 1.7, -63] },
  { id: 'bus-detail', position: [-40, 1.7, -57], target: [-45, 1.3, -63] },
  { id: 'bus-front', position: [-50, 1.7, -58.7], target: [-47.5, 1.2, -63] },
  { id: 'truck-detail', position: [-20, 1.7, -58.5], target: [-15, 1.2, -61] },
  { id: 'case-detail', position: [-35.8, 1.2, -59.3], target: [-38, .2, -62] },
  { id: 'abandoned-cart', position: [-47, 1.65, -58], target: [-52, .6, -57.5] },
  { id: 'abandoned-belongings', position: [-35.5, 1.65, -56.5], target: [-36, .3, -62] },
  { id: 'street-market-detail', position: [-39, 1.65, -59], target: [-44, .7, -55] },
  { id: 'street-well-detail', position: [-24, 1.65, -62], target: [-28, .5, -67] },
  { id: 'street-notice-detail', position: [-55, 1.65, -67], target: [-60, 1.2, -71] },
  { id: 'street-homes-detail', position: [-61, 1.65, -43], target: [-56, 1.4, -35] },
  { id: 'west-gate', position: [-77, 1.65, -60], target: [-87, 2.3, -58] },
  { id: 'dock-approach', position: [-91, 1.65, -67], target: [-102, 3.2, -58] },
  { id: 'dock-river', position: [-110, 1.65, -80], target: [-220, .5, -80] },
  { id: 'dock-south', position: [-110, 1.65, -80], target: [-120, 1.5, 120] },
  { id: 'confluence', position: [-90, 1.65, 35], target: [-120, 0, 100] },
  { id: 'south-gate', position: [0, 1.65, 85], target: [0, 2, 200] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const errors = [];
  for (const version of versions) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(`${version}: ${error.message}`));
    if (version === 'before') for (const [name, source] of Object.entries(baseline)) {
      await page.route(`**/src/${name}*`, async route => {
        const response = await route.fetch(), transformed = await response.text();
        let body = source;
        for (const [original, pattern] of [
          ['three', /from "([^"]*\/three\.js\?[^"]+)"/],
          ['three/addons/utils/BufferGeometryUtils.js', /from "([^"]*BufferGeometryUtils[^"]+)"/],
        ]) {
          if (!body.includes(`'${original}'`)) continue;
          const resolved = transformed.match(pattern)?.[1];
          if (!resolved) throw new Error(`Missing Vite import resolution for ${original}`);
          body = body.replace(`'${original}'`, JSON.stringify(resolved));
        }
        await route.fulfill({ response, body });
      });
    }
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        const infrastructureReviewLight = new THREE.AmbientLight(0xffffff, 0);
        scene.add(infrastructureReviewLight);
        window.retreatInfrastructureView = (position, target, diagnosticFill = false) => {
          setGameState('pause'); missionBriefing.hide();
          $('hud').hidden = true;
          for (const child of camera.children) child.visible = false;
          infrastructureReviewLight.intensity = diagnosticFill ? 2 : 0;
          camera.position.fromArray(position);
          camera.lookAt(...target);
          camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
        };
        window.streetLifeRenderCounts = () => {
          const meshes = scene.children.filter(child => child.userData.streetLifeBatch);
          const read = () => {
            renderer.render(scene, camera);
            return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
          };
          const withDetails = read();
          meshes.forEach(mesh => { mesh.visible = false; });
          const withoutDetails = read();
          meshes.forEach(mesh => { mesh.visible = true; });
          renderer.render(scene, camera);
          return { batches: meshes.length, withDetails, withoutDetails };
        };` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
    url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
    await page.goto(url.href); await setQualityPreset(page, 'low');
    try {
      await deployFromMenu(page);
    } catch (error) {
      const state = await page.evaluate(() => ({
        step: document.getElementById('overlay')?.dataset.deploymentStep,
        fatal: document.getElementById('fatal-message')?.textContent,
        battle: Boolean(window.__battle),
      }));
      await page.screenshot({ path: join(directory, `${version}-entry-error.png`) });
      throw new Error(`${version} game entry failed: ${JSON.stringify({ state, errors })}`, { cause: error });
    }
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    const renderCounts = [];
    for (const view of views) {
      await page.evaluate(({ position, target }) => retreatInfrastructureView(position, target), view);
      await page.screenshot({ path: join(directory, `${view.id}-${version}.png`) });
      if (version === 'after' && view.id.startsWith('street-')) {
        renderCounts.push({ view: view.id, ...await page.evaluate(() => streetLifeRenderCounts()) });
      }
      await page.evaluate(({ position, target }) => retreatInfrastructureView(position, target, true), view);
      await page.screenshot({ path: join(directory, `${view.id}-${version}-fill.png`) });
    }
    if (renderCounts.length) await writeFile(join(directory, 'render-counts.json'), JSON.stringify(renderCounts, null, 2));
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ versions, views, errors,
    limitation: 'Paused actual game, manually placed cameras, low quality. Images ending in -fill use an additional diagnostic ambient light, not normal gameplay lighting. Baseline uses HEAD versions of the three changed environment files; other local changes are shared.' }, null, 2));
  console.log(JSON.stringify({ views, errors }));
} finally {
  await browser.close();
}
