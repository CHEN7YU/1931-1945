import test from 'node:test';
import assert from 'node:assert/strict';
import { setQualityPreset } from '../scripts/game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

test('quality setup before game loading preserves saved settings and reloads the launcher without a menu selector', async () => {
  const settings = defaultPreferences(); settings.mouseSensitivity = 2; settings.audio.master.volume = .4;
  const saved = JSON.stringify({ version: 1, settings });
  let step = 0, persisted, reloaded = false;
  const page = {
    async evaluate(_callback, input) {
      switch (step++) {
        case 0: return false;
        case 1: assert.equal(input, PREFERENCES_KEY); return saved;
        case 2: persisted = input; return;
        default: assert.fail('Unexpected browser evaluation');
      }
    },
    async reload(options) { assert.equal(options.waitUntil, 'domcontentloaded'); reloaded = true; },
  };
  await setQualityPreset(page, 'low');
  assert.equal(persisted.key, PREFERENCES_KEY);
  assert.deepEqual(JSON.parse(persisted.value), { version: 1, settings: {
    ...settings, quality: { ...settings.quality, preset: 'low' },
  } });
  assert.equal(reloaded, true);
});

test('loaded-game quality setup uses the retained pause control without navigating or replacing other preferences', async () => {
  let selected;
  const page = {
    async evaluate() { return true; },
    locator(selector) {
      assert.equal(selector, '#qualityToggle');
      return { async selectOption(value, options) { selected = { value, options }; } };
    },
    async reload() { assert.fail('A loaded game must not reload to change quality'); },
  };
  await setQualityPreset(page, 'high');
  assert.deepEqual(selected, { value: 'high', options: { force: true } });
});

test('invalid quality setup fails before changing the page', async () => {
  await assert.rejects(setQualityPreset({}, 'invalid'), RangeError);
});
