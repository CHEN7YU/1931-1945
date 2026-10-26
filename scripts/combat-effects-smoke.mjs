import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const wait = predicate => page.waitForFunction(predicate, null, { timeout: 10000 });
const capture = async name => {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
};
async function look(yaw, pitch) {
  await page.evaluate(({ yaw, pitch }) => {
    const old = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - old.yaw), Math.cos(yaw - old.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - old.pitch) / .00132 }));
  }, { yaw, pitch });
}
async function luminance() {
  return page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const canvas = document.querySelector('#world'), gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(128 * 128 * 4);
    gl.readPixels(Math.floor(canvas.width / 2) - 64, Math.floor(canvas.height * .33) - 64, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) total += pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
    resolve(total / (128 * 128 * 255));
  })));
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await wait(() => window.__battle?.state === 'menu');
  await page.locator('#deploy').click();
  await wait(() => window.__battle.fov > 71.9);
  assert.equal((await snapshot()).combatEffects.shaderLights, 2, 'high quality keeps two zero-intensity pooled lights in the shader before any shot');
  assert.equal((await snapshot()).combatEffects.visibleLights, 0, 'idle pooled lights do not illuminate the scene');
  await capture('daylight-cool.png');
  await page.keyboard.press('Escape');
  await page.locator('#quality-overcast').uncheck();
  assert.equal((await snapshot()).daylight.sunIntensity, 2.5);
  await page.locator('#resume').click(); await page.waitForTimeout(100);
  await capture('daylight-original.png');
  await page.keyboard.press('Escape'); await page.locator('#quality-overcast').check(); await page.locator('#resume').click();
  await page.mouse.down({ button: 'right' }); await look(0, -.6);
  await page.mouse.down();
  const pulse = await page.waitForFunction(() => {
    const data = window.__battle;
    if (data.combatEffects.muzzleLightIntensity > 0 && data.combatEffects.lastImpact?.kind === 'stone') {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
      return data;
    }
    return false;
  });
  const lit = await pulse.jsonValue(); await pulse.dispose(); await page.mouse.up();
  assert.equal(lit.rifle.ammo, 4);
  assert.ok(lit.combatEffects.visibleLights > 0 && !lit.combatEffects.pointLightShadows);
  assert.equal(lit.combatEffects.shaderLights, 2, 'a shot does not change the shader light-count variant');
  assert.equal(lit.combatEffects.renderedFragments, lit.combatEffects.fragments);
  assert.ok(lit.combatEffects.lastImpact.normal[1] > .95);
  const before = await luminance(), pausedTime = (await snapshot()).time;
  await page.waitForTimeout(200);
  assert.equal((await snapshot()).time, pausedTime);
  assert.equal((await snapshot()).combatEffects.lights, lit.combatEffects.lights, 'paused effects do not age in real wall-clock time');
  await page.locator('#quality-muzzleLight').uncheck();
  const after = await luminance();
  assert.ok(before > after + .0001, `real GPU image receives local muzzle illumination (${before.toFixed(4)} > ${after.toFixed(4)})`);
  await page.locator('#quality-muzzle').uncheck(); await page.locator('#quality-hitParticles').uncheck();
  let data = await snapshot();
  assert.equal(data.combatEffects.fragments + data.combatEffects.clouds + data.combatEffects.lights, 0);
  assert.equal(data.rifle.model.flashVisible, false);
  await page.locator('#quality-muzzle').check(); await page.locator('#quality-muzzleLight').check(); await page.locator('#quality-hitParticles').check();
  await page.locator('#resume').click();
  await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
  await wait(() => window.__battle.rifle.action === 'idle');
  // From the current centred base, clear the 4.5m half-width of the paved street.
  await look(Math.PI / 2, -.22);
  await page.mouse.down(); await wait(() => window.__battle.rifle.shots === 2); await page.mouse.up();
  data = await snapshot();
  assert.equal(data.combatEffects.lastImpact.kind, 'soil', 'real earth-plane hits differ from paving/stone hits');
  assert.ok(data.combatEffects.lastImpact.normal[1] > .95);
  await page.keyboard.press('Escape'); await page.locator('#qualityToggle').selectOption('low'); await page.locator('#resume').click();
  await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
  await wait(() => window.__battle.rifle.action === 'idle');
  await page.mouse.down(); await wait(() => window.__battle.rifle.shots === 3); await page.mouse.up();
  data = await snapshot();
  assert.equal(data.combatEffects.visibleLights, 0, 'low quality emits no muzzle point lights');
  assert.ok(data.combatEffects.fragments <= 32 && data.combatEffects.clouds <= 6);
  await page.waitForFunction(() => window.__battle.combatEffects.fragments + window.__battle.combatEffects.clouds === 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: cold/original light switch, real stone/soil impacts, GPU muzzle illumination ${before.toFixed(4)}→${after.toFixed(4)}, pause, independent disable and low-budget recovery.`);
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ state: data?.state, look: data?.look, rifle: data?.rifle, effects: data?.combatEffects, errors }));
  throw error;
} finally {
  await browser.close();
}
