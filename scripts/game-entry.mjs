import { createPlayerPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

export async function setQualityPreset(page, preset) {
  if (!['high', 'low'].includes(preset)) throw new RangeError('Invalid smoke-test quality preset');
  if (await page.evaluate(() => Boolean(window.__battle))) {
    await page.locator('#qualityToggle').selectOption(preset, { force: true });
    return;
  }
  let saved = await page.evaluate(key => localStorage.getItem(key), PREFERENCES_KEY);
  const preferences = createPlayerPreferences({
    storage: () => ({ getItem: () => saved, setItem: (_key, value) => { saved = value; } }),
    warn: message => { throw new Error(message); },
  });
  preferences.update({ quality: { ...preferences.snapshot.quality, preset } });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PREFERENCES_KEY, value: saved });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

export async function continueIdentitySelection(page) {
  await page.waitForFunction(() => {
    const overlay = document.getElementById('overlay');
    return overlay?.dataset.deploymentStep === 'identity' || overlay?.dataset.deploymentStep === 'squad' ||
      !document.getElementById('fatal').hidden;
  }, null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  if (await page.locator('#confirm-identity').isVisible()) await page.locator('#confirm-identity').click();
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad' ||
    !document.getElementById('fatal').hidden, null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
}

export async function deployFromMenu(page) {
  if (new URL(page.url()).searchParams.has('benchmark')) {
    await page.locator('#deploy').click();
    return;
  }
  if (await page.locator('#confirm-campaign').isVisible()) await page.locator('#confirm-campaign').click();
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep ||
    !document.getElementById('menu').hidden || !document.getElementById('fatal').hidden,
  null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  const preferred = await page.locator('.squad-choice.selected').getAttribute('data-type');
  if (!await page.locator('#confirm-identity').isVisible() &&
    await page.locator('#overlay').getAttribute('data-deployment-step') !== 'squad') await page.locator('#deploy').click();
  await continueIdentitySelection(page);
  if (preferred && preferred !== 'infantry' && await page.locator(`#redeploy-choices [data-type="${preferred}"]`).count())
    await page.locator(`#redeploy-choices [data-type="${preferred}"]`).click();
  await page.locator('#confirm-deploy').click();
}
