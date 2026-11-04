import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Run against the unchanged styles with HUD_BASELINE=1 before collecting the final captures.
const baseline = process.env.HUD_BASELINE === '1';
const artifacts = process.env.ARTIFACT_DIR;
const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations = [], errors = [];
const labels = ['#hud-notice', '#objective-title', '#objective-help', '#timer',
  '#squad-hint', '#section-status', '#weapon-name', '#health-text', '#pace-label',
  '#stamina-label', '#battle-controls', '#minimap span', '#pause-button', '#members .member',
  '#interaction-prompt', '#toast', '#simulation-status', '#aim-label', '.feed-entry',
  '.control-count', '.squad-heading kbd', '.hud-label', '.ammo small', '.objective-chip',
  '#tank-machine-gun', '#tank-orientation span', '#weapon-support', '#tank-reload span'];
if (artifacts) await mkdir(artifacts, { recursive: true });

async function loadMenu(page, address) {
  await page.goto(address);
  // The read-only snapshot exists before the asynchronous character preparation finishes.
  await page.waitForFunction(() => window.__battle?.state === 'menu'
    && !document.querySelector('#menu').hidden, null, { timeout: 90000 });
  if (new URL(address).searchParams.get('benchmark') === 'interior') {
    assert.equal(await page.evaluate(() => window.__battle.benchmark?.scenario), 'interior',
      'HUD geometry checks require the development server; production disables diagnostic query parameters');
  }
}

async function look(page, yaw, pitch = 0) {
  await page.evaluate(({ yaw, pitch }) => {
    const current = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: -delta / .00132, movementY: -(pitch - current.pitch) / .00132,
    }));
  }, { yaw, pitch });
}

async function walkTo(page, x, z) {
  await page.keyboard.down('c');
  for (let i = 0; i < 220; i++) {
    const data = await page.evaluate(() => window.__battle);
    assert.equal(data.state, 'playing');
    const dx = x - data.position.x, dz = z - data.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < .25) break;
    await look(page, Math.atan2(-dx, -dz));
    await page.evaluate(({ x, z, dx, dz, seconds }) => new Promise(resolve => {
      const until = window.__battle.time + seconds;
      const check = () => {
        const data = window.__battle, px = x - data.position.x, pz = z - data.position.z;
        if (data.state !== 'playing' || data.time >= until || Math.hypot(px, pz) < .12 || px * dx + pz * dz <= 0) {
          document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
          resolve();
        } else requestAnimationFrame(check);
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
      requestAnimationFrame(check);
    }), { x, z, dx, dz, seconds: Math.min(.5, distance / 1.5) });
    await page.waitForTimeout(130);
  }
  await page.keyboard.up('w');
  await page.keyboard.up('c');
  await page.waitForTimeout(150);
  const position = await page.evaluate(() => window.__battle.position);
  assert.ok(Math.hypot(position.x - x, position.z - z) < .3,
    `capture location (${x}, ${z}) reached by normal movement; actual (${position.x}, ${position.z})`);
}

async function capture(page, name) {
  const measurement = await page.evaluate(selectors => {
    const rgba = text => text.match(/[\d.]+/g).map(Number);
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const luminance = rgb => rgb.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const visible = element => element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden' && Number(getComputedStyle(element).opacity) > 0;
    const text = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(visible).map(element => {
      const style = getComputedStyle(element), ancestors = [];
      for (let node = element; node && node.id !== 'hud'; node = node.parentElement) ancestors.unshift(node);
      // Ignore the HUD gradient: a white scene is a conservative test of each local text backing.
      const background = ancestors.reduce((color, node) => over(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255]);
      const foreground = over(rgba(style.color), background);
      const a = luminance(foreground), b = luminance(background);
      const textRects = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) textRects.push({ x: box.x, width: box.width });
      }
      return { selector, text: element.textContent, fontSize: parseFloat(style.fontSize),
        contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), rect: rect(element),
        textRects };
    }));
    const panels = ['.battle-time', '#objectives', '.objective-banner',
      '.squad-status', '.weapon-status', '#tank-orientation', '#minimap', '#pause-button', '.hud-notices', '#kill-feed',
      '#weapon-support', '#tank-reload', '#interaction-prompt']
      .flatMap(selector => [...document.querySelectorAll(selector)].filter(visible)
        .map(element => ({ selector, rect: rect(element) })))
      .filter(panel => panel.rect.width > 0 && panel.rect.height > 0);
    const persistent = panels.filter(panel => !['.hud-notices', '#kill-feed', '.objective-banner',
      '#weapon-support', '#tank-reload', '#interaction-prompt'].includes(panel.selector));
    const persistentCoverage = persistent.reduce((area, panel) => area + panel.rect.width * panel.rect.height, 0) / (innerWidth * innerHeight);
    const battle = window.__battle;
    return { text, panels, persistentCoverage, position: battle.position, look: battle.look, inside: battle.town.inside,
      population: { friendly: battle.population.friendly.alive, enemy: battle.population.enemy.alive },
      viewport: { width: innerWidth, height: innerHeight } };
  }, labels);
  observations.push({ name, ...measurement });
  if (artifacts) await page.screenshot({ path: join(artifacts, `${name}.png`) });
  if (baseline) return;
  assert.ok(measurement.persistentCoverage <= .12, `${name}: persistent HUD <=12% of viewport (${(measurement.persistentCoverage * 100).toFixed(2)}%)`);
  assert.ok(measurement.panels.find(panel => panel.selector === '#objectives').rect.height <= 32, `${name}: compact objective row`);
  assert.equal(await page.locator('#battle-controls').isVisible(), false, `${name}: long controls are not permanent HUD`);
  for (const label of measurement.text) {
    const active = !label.selector.includes('.member') || !label.text.includes('×');
    if (active) {
      assert.ok(label.fontSize >= 12, `${name} ${label.selector}: readable minimum 12px (${label.fontSize})`);
      assert.ok(label.contrast >= 4.5, `${name} ${label.selector}: local contrast at least 4.5:1 (${label.contrast.toFixed(2)})`);
    }
    assert.ok(label.rect.x >= 0 && label.rect.y >= 0
      && label.rect.x + label.rect.width <= measurement.viewport.width + 1
      && label.rect.y + label.rect.height <= measurement.viewport.height + 1, `${name} ${label.selector}: within viewport`);
    assert.ok(label.textRects.every(box => box.x >= label.rect.x - 1
      && box.x + box.width <= label.rect.x + label.rect.width + 1),
    `${name} ${label.selector}: no horizontal text clipping`);
  }
  for (let i = 0; i < measurement.panels.length; i++) {
    const a = measurement.panels[i];
    for (const b of measurement.panels.slice(i + 1)) {
      const width = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);
      const height = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);
      assert.ok(width <= 0 || height <= 0, `${name}: ${a.selector} does not overlap ${b.selector}`);
    }
    const { width, height } = measurement.viewport;
    // Interaction/loading cues sit near the reticle; permanent panels retain the larger clear area.
    const clearance = ['#tank-reload', '#interaction-prompt'].includes(a.selector) ? 32 : 80;
    assert.ok(a.rect.x + a.rect.width <= width / 2 - clearance || a.rect.x >= width / 2 + clearance
      || a.rect.y + a.rect.height <= height / 2 - clearance || a.rect.y >= height / 2 + clearance,
    `${name}: ${a.selector} leaves the central aiming area clear`);
  }
}

try {
  for (const viewport of [{ width: 960, height: 540 }, { width: 1280, height: 720 },
    { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    const fixture = new URL(url);
    fixture.searchParams.set('benchmark', 'interior');
    fixture.searchParams.set('seed', '1938');
    await loadMenu(page, fixture.href);
    await page.locator('#deploy').click();
    await page.mouse.down({ button: 'right' });
    await look(page, 0, .85);
    await capture(page, `${viewport.width}-sky`);
    await look(page, 0);
    await walkTo(page, 0, 64);
    await walkTo(page, -2.4, 64);
    await look(page, Math.PI / 2);
    await page.locator('#interaction-prompt').waitFor({ state: 'visible' });
    await capture(page, `${viewport.width}-wall`);
    if (await page.evaluate(() => Math.abs(window.__battle.doors.find(door => door.id === 'west-0-east-door').targetAngle) < .01)) {
      await page.keyboard.press('f');
    }
    await page.waitForFunction(() => window.__battle.doors.find(door => door.id === 'west-0-east-door').state === 'open');
    await walkTo(page, -8.5, 64);
    assert.equal(await page.evaluate(() => window.__battle.town.inside), 'west-0');
    await look(page, Math.PI / 2, -.15);
    await capture(page, `${viewport.width}-interior`);
    if (viewport.width === 960) {
      await walkTo(page, 0, 64);
      await walkTo(page, 0, 34);
      await page.locator('.objective-banner').waitFor({ state: 'visible' });
      assert.match(await page.locator('#objective-title').textContent(), /^A ·/);
      await capture(page, '960-capture-area');
      await page.mouse.up({ button: 'right' });
      await page.keyboard.down('Shift');
      await page.keyboard.down('w');
      await page.waitForFunction(() => window.__battle.locomotion.stamina < .99);
      await page.keyboard.up('w');
      await page.keyboard.up('Shift');
      await page.locator('#movement-status').waitFor({ state: 'visible' });
      await capture(page, '960-stamina');
    }
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('Escape');
    await page.locator('#resume').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#battle-controls').isVisible(), 'full controls available in pause');
    assert.match(await page.locator('#battle-controls').textContent(), /WASD/);
    await page.locator('#resume').click();
    await page.waitForFunction(() => window.__battle.state === 'playing');
    await page.close();

    const full = await browser.newPage({ viewport });
    full.on('pageerror', error => errors.push(error.message));
    await loadMenu(full, url.href);
    await full.locator('#deploy').click();
    await full.waitForFunction(() => document.querySelectorAll('#members .member').length === 11);
    await capture(full, `${viewport.width}-full-roster`);
    assert.equal(await full.locator('.objective-banner').isVisible(), false, 'capture details hidden away from objectives');
    await full.keyboard.down('Tab');
    await full.locator('#scoreboard').waitFor({ state: 'visible' });
    const scoreboard = await full.locator('#scoreboard').boundingBox();
    assert.ok(scoreboard.x >= 0 && scoreboard.y >= 0 &&
      scoreboard.x + scoreboard.width <= viewport.width + 1 &&
      scoreboard.y + scoreboard.height <= viewport.height + 1, 'expanded squad scoreboard stays inside the viewport');
    assert.ok(await full.locator('#scoreboard-stats').isVisible(), 'compact battle summary available on Tab');
    assert.equal(await full.locator('#force-status').count(), 0, 'technical prose is not part of the icon scoreboard');
    assert.equal(await full.locator('.score-team').count(), 2);
    assert.equal(await full.locator('#squad-score-table thead th[aria-label="总击杀"] svg').count(), 2);
    await full.keyboard.up('Tab');
    if (viewport.width === 960) {
      await full.waitForFunction(() => getComputedStyle(document.querySelector('#toast')).opacity === '0');
      await capture(full, '960-compact-battle');
    }
    const originalMember = await full.evaluate(() => window.__battle.current);
    await full.keyboard.press('y');
    await full.waitForFunction(previous => window.__battle.current !== previous, originalMember);
    assert.equal(await full.locator('#members .active').count(), 1, 'Y retains exactly one active member');
    await full.keyboard.press('m');
    const map = await full.locator('#minimap').boundingBox();
    assert.equal(await full.locator('#minimap').evaluate(element => element.classList.contains('expanded')), true);
    assert.ok(Math.abs(map.x + map.width / 2 - viewport.width / 2) < 1
      && Math.abs(map.y + map.height / 2 - viewport.height / 2) < 1, 'expanded map remains centered');
    await full.keyboard.press('m');
    assert.equal(await full.locator('#minimap').evaluate(element => element.classList.contains('expanded')), false);
    for (const type of ['tank', 'mortar', 'plane']) {
      await full.keyboard.press('Escape');
      await full.locator('#back-menu').click();
      await full.locator(`.squad-choice[data-type="${type}"]`).click();
      await full.locator('#deploy').click();
      await full.waitForFunction(() => window.__battle.state === 'playing');
      await capture(full, `${viewport.width}-${type}`);
    }
    await full.close();
  }
  const failed = await browser.newPage({ viewport: { width: 960, height: 540 } });
  failed.on('pageerror', error => errors.push(error.message));
  await failed.route('**/assets/audio/recorded-rifle/report.wav', route => route.abort());
  const failureUrl = new URL(url);
  failureUrl.searchParams.set('benchmark', 'interior');
  await loadMenu(failed, failureUrl.href);
  assert.equal(await failed.evaluate(() => window.__battle.rifleAudio.status), 'fallback');
  await failed.locator('#deploy').click();
  await failed.locator('#hud-notice').waitFor({ state: 'visible' });
  assert.match(await failed.locator('#hud-notice').textContent(), /步枪录音未加载/);
  await capture(failed, '960-audio-fallback');
  await failed.close();
  assert.deepEqual(errors, [], 'no runtime errors or missing game assets');
  console.log(baseline ? 'HUD baseline captured; readability assertions intentionally deferred.'
    : 'PASS: 960/1280/1440/1920, persistent HUD <=12%, sky/wall/interior, four unit HUDs, 12px text, 4.5:1 local contrast, no overlap/clipping, clear aiming area, Tab details, pause controls, door interaction, Y and expanded map.');
} finally {
  if (artifacts) await writeFile(join(artifacts, 'measurements.json'), JSON.stringify({ baseline, observations, errors }, null, 2));
  await browser.close();
}
