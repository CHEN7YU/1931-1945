import { setQualityPreset } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
const watchdog = setTimeout(() => { console.error('Audio controls exceeded 180s'); void browser.close(); }, 180000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
// Inspect the real Web Audio connections; this short test deliberately retains nodes, not a memory benchmark.
await page.addInitScript(() => {
  const Audio = window.AudioContext || window.webkitAudioContext;
  const names = ['master', 'weapons', 'voices', 'footsteps', 'effects'], nodes = [], routes = [];
  const ids = new WeakMap();
  let context = null, gains = 0, active = 0;
  function attach(node, type) {
    const data = { id: nodes.length, type, group: type === 'gain' && gains < 5 ? names[gains] : null, edges: new Set(), node };
    if (type === 'gain') gains++;
    nodes.push(data); ids.set(node, data.id);
    const connect = node.connect, disconnect = node.disconnect;
    node.connect = function (target, ...args) {
      data.edges.add(ids.has(target) ? ids.get(target) : -1);
      return connect.call(this, target, ...args);
    };
    node.disconnect = function (...args) { data.edges.clear(); return disconnect.apply(this, args); };
    if (type === 'source') {
      const start = node.start;
      node.start = function (...args) {
        const groups = new Set(), visited = new Set();
        function visit(id) {
          if (id < 0 || visited.has(id)) return;
          visited.add(id); const item = nodes[id];
          if (item.group) groups.add(item.group);
          for (const edge of item.edges) visit(edge);
        }
        visit(data.id);
        routes.push([...groups]); active++;
        return start.apply(this, args);
      };
      node.addEventListener('ended', () => { active--; });
    }
    return node;
  }
  for (const [method, kind] of [['createGain', 'gain'], ['createBufferSource', 'source'], ['createOscillator', 'source'],
    ['createBiquadFilter', 'filter'], ['createStereoPanner', 'panner'], ['createWaveShaper', 'safety']]) {
    const original = Audio.prototype[method];
    Audio.prototype[method] = function (...args) {
      context ??= this;
      return this === context ? attach(original.apply(this, args), kind) : original.apply(this, args);
    };
  }
  window.__startAudioGainProbes = () => {
    // Keep every real bus rendering while paused voices are stopped; AudioParams on idle subgraphs are lazy.
    for (const name of names.slice(1)) {
      const source = context.createOscillator(), quiet = context.createGain();
      quiet.gain.value = .001;
      source.connect(quiet).connect(nodes.find(node => node.group === name).node);
      source.start(); source.stop(context.currentTime + 60);
    }
  };
  Object.defineProperty(window, '__audioGraphProbe', { get: () => ({
    routes: routes.map(route => [...route]), active,
    gains: Object.fromEntries(nodes.filter(node => node.group).map(node => [node.group, node.node.gain.value])),
  }) });
});
const wait = (fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 20000 });
async function volume(channel, value) {
  await page.locator(`#pause-audio-volume-${channel}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  if (process.env.GAME_PRODUCTION !== '1') url.searchParams.set('benchmark', 'interior');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
  await setQualityPreset(page, 'low');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.audioMix.contextState === 'running');
  await wait(() => window.__audioGraphProbe.routes.some(route => route.includes('voices')));
  await page.mouse.down({ button: 'right' });
  const initialAmmo = await page.evaluate(() => window.__battle.ammo);
  await page.mouse.down(); await wait(ammo => window.__battle.ammo < ammo, initialAmmo); await page.mouse.up();
  await wait(() => window.__battle.rifle.action === 'idle');
  await page.keyboard.press('r');
  await wait(() => window.__battle.rifle.action === 'reload');
  await wait(() => window.__battle.rifle.action === 'idle');
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('w');
  await wait(() => window.__battle.footstepAudio.counts.played >= 1);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__startAudioGainProbes());
  const before = await page.evaluate(() => ({ time: window.__battle.time, ammo: window.__battle.ammo, control: window.__battle.control }));
  await volume('master', .5); await volume('weapons', .4); await volume('footsteps', .25);
  await page.locator('#audio-settings [data-audio-mute="voices"]').check();
  await wait(() => Math.abs(window.__audioGraphProbe.gains.master - .5) < .001 &&
    Math.abs(window.__audioGraphProbe.gains.weapons - .4) < .001 &&
    Math.abs(window.__audioGraphProbe.gains.footsteps - .25) < .001 &&
    window.__audioGraphProbe.gains.voices < .001);
  let graph = await page.evaluate(() => window.__audioGraphProbe);
  assert.ok(Math.abs(graph.gains.master - .5) < .001);
  assert.ok(Math.abs(graph.gains.weapons - .4) < .001);
  assert.ok(Math.abs(graph.gains.footsteps - .25) < .001);
  assert.ok(graph.gains.voices < .001);
  for (const route of graph.routes) {
    assert.ok(route.includes('master'), 'every started recorded/synthetic sound passes through the actual master node');
    assert.equal(route.filter(channel => channel !== 'master').length, 1, 'each source belongs to exactly one category');
  }
  assert.ok(graph.routes.some(route => route.includes('weapons')), 'real rifle/reload audio enters the weapons bus');
  assert.ok(graph.routes.some(route => route.includes('footsteps')), 'real contact recordings enter the footsteps bus');
  await page.locator('#audio-settings [data-audio-mute="master"]').check();
  await page.waitForTimeout(150);
  graph = await page.evaluate(() => window.__audioGraphProbe);
  assert.ok(graph.gains.master < .001, 'master mute affects existing graph, not just future events');
  assert.equal(await page.evaluate(() => window.__battle.audioMix.channels.weapons.effectiveGain), 0);
  await page.locator('#audio-settings [data-audio-mute="master"]').uncheck();
  await page.locator('#audio-settings [data-audio-mute="voices"]').uncheck();
  await page.waitForTimeout(150);
  graph = await page.evaluate(() => window.__audioGraphProbe);
  assert.ok(Math.abs(graph.gains.master - .5) < .001);
  assert.ok(Math.abs(graph.gains.weapons - .4) < .001);
  assert.ok(Math.abs(graph.gains.voices - 1) < .001);
  assert.deepEqual(await page.evaluate(() => ({ time: window.__battle.time, ammo: window.__battle.ammo, control: window.__battle.control })), before);
  const saved = await page.evaluate(() => window.__battle.preferences.audio);
  observations.push({ saved, graph });
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.locator('#audio-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'audio-controls.png') });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 90000 });
  assert.deepEqual(await page.evaluate(() => window.__battle.preferences.audio), saved);
  assert.equal(await page.locator('#menu-audio-volume-master').inputValue(), '0.5');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.audioMix.contextState === 'running');
  assert.equal(await page.evaluate(() => window.__battle.audioMix.channels.weapons.effectiveGain), .2);
  await page.keyboard.press('Escape');
  await page.locator('#audio-settings [data-reset-audio]').click();
  assert.equal(await page.evaluate(() => window.__battle.preferences.audio.master.volume), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: real recorded audio routes through master/categories, live gains and mute restore, match isolation, reload persistence and sound defaults.');
} catch (error) {
  console.error(JSON.stringify(await page.evaluate(() => ({
    graph: window.__audioGraphProbe, mixer: window.__battle?.audioMix,
    fatal: document.querySelector('#fatal-message').textContent,
  }))));
  throw error;
} finally {
  clearTimeout(watchdog);
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'audio-controls.json'), JSON.stringify({ observations, errors }, null, 2));
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'audio-controls-final.png') });
    }
  } finally { await browser.close(); }
}
