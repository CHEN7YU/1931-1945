import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFERENCES_KEY, createPlayerPreferences, defaultPreferences, lookSensitivity, validatePreferences } from '../src/player-preferences.js';

function fixture(saved = null) {
  let value = saved;
  const writes = [], warnings = [];
  const storage = {
    getItem(key) { assert.equal(key, PREFERENCES_KEY); return value; },
    setItem(key, text) { assert.equal(key, PREFERENCES_KEY); writes.push(text); value = text; },
  };
  return { storage, writes, warnings,
    create: () => createPlayerPreferences({ storage: () => storage, warn: message => warnings.push(message) }) };
}

test('fresh preferences retain original look speed, aim reduction, scope reduction and graphics defaults', () => {
  const f = fixture(), settings = f.create();
  assert.deepEqual(settings.snapshot, defaultPreferences());
  assert.equal(lookSensitivity(settings.snapshot, { aiming: false }), .0022);
  assert.equal(lookSensitivity(settings.snapshot, { aiming: true }), .00132);
  assert.equal(lookSensitivity(settings.snapshot, { aiming: true, scopeSensitivity: .22 }), .0022 * .22);
  assert.equal(settings.status.problem, false);
  assert.equal(f.writes.length, 0, 'loading a page does not overwrite persisted values');
  assert.deepEqual(f.warnings, []);
  assert.equal(settings.snapshot.quality.preset, 'low', 'a new browser does not need to suffer a high-quality startup first');
});
test('automatic reductions round-trip without overwriting manual preferences; old high defaults start conservatively', () => {
  const old = defaultPreferences(); delete old.startupQualityLevel; old.quality.preset = 'high';
  const f = fixture(JSON.stringify({ version: 1, settings: old })), settings = f.create();
  assert.equal(settings.snapshot.quality.preset, 'high');
  assert.equal(settings.snapshot.startupQualityLevel, 1);
  assert.equal(f.writes.length, 0);
  settings.update({ startupQualityLevel: 3 });
  assert.equal(f.create().snapshot.startupQualityLevel, 3);
  assert.equal(f.create().snapshot.quality.preset, 'high');
  settings.update({ startupQualityLevel: 0 });
  assert.equal(f.create().snapshot.startupQualityLevel, 0);
  assert.throws(() => settings.update({ startupQualityLevel: 4 }), RangeError);
});
test('tank crushing defaults on, persists an explicit opt-out, and migrates older v1 settings without overwriting them', () => {
  const defaults = defaultPreferences();
  assert.equal(defaults.tankCrushing, true);
  const old = { ...defaults }; delete old.tankCrushing;
  const f = fixture(JSON.stringify({ version: 1, settings: old })), settings = f.create();
  assert.equal(settings.snapshot.tankCrushing, true);
  assert.equal(settings.status.problem, false);
  assert.equal(f.writes.length, 0);
  settings.update({ tankCrushing: false });
  assert.equal(f.create().snapshot.tankCrushing, false);
  assert.throws(() => settings.update({ tankCrushing: 'false' }), TypeError);
});

test('normal and aimed multipliers are independent, including scope and lower/upper bounds', () => {
  const settings = { mouseSensitivity: 3, aimSensitivity: .25 };
  assert.equal(lookSensitivity(settings, { aiming: false }), .0022 * 3);
  assert.equal(lookSensitivity(settings, { aiming: true }), .00132 * .25);
  assert.equal(lookSensitivity(settings, { aiming: true, scopeSensitivity: .22 }), .0022 * .22 * .25);
  assert.equal(lookSensitivity(settings, { aiming: false, scopeSensitivity: .22 }), .0022 * .22 * .25);
});

test('startup resource choices persist and older saved controls migrate without resetting graphics', () => {
  const old = defaultPreferences(); delete old.resourceMode; old.quality.preset = 'low';
  const f = fixture(JSON.stringify({ version: 1, settings: old })), preferences = f.create();
  assert.equal(preferences.snapshot.resourceMode, 'auto');
  assert.equal(preferences.snapshot.quality.preset, 'low');
  assert.equal(preferences.status.problem, false);
  preferences.update({ resourceMode: 'low-memory' });
  assert.equal(f.create().snapshot.resourceMode, 'low-memory');
  assert.throws(() => preferences.update({ resourceMode: 'ultra' }), RangeError);
});

test('all supported controls and effects round-trip without serializing match state', () => {
  const f = fixture(), first = f.create();
  const expected = defaultPreferences();
  expected.mouseSensitivity = 2;
  expected.aimSensitivity = .5;
  expected.motionStrength = .35;
  expected.quality.preset = 'low';
  expected.quality.effects.fog = false;
  expected.quality.effects.shadows = false;
  first.update(expected);
  const record = JSON.parse(f.writes.at(-1));
  assert.deepEqual(record, { version: 1, settings: expected });
  const second = f.create();
  assert.deepEqual(second.snapshot, expected);
  assert.equal(second.status.problem, false);
  assert.match(second.status.message, /已恢复/);
  const copy = second.snapshot;
  copy.quality.effects.fog = true;
  assert.equal(second.snapshot.quality.effects.fog, false, 'snapshots do not expose mutable state');
  assert.deepEqual(f.warnings, []);
});

test('invalid saved records warn visibly and use intact defaults, without silently replacing data', () => {
  const invalidRecords = ['not json', 'null', JSON.stringify({ version: 2, settings: defaultPreferences() }),
    ...[
      { mouseSensitivity: NaN }, { aimSensitivity: '1' }, { motionStrength: .5 },
      { quality: { preset: 'ultra', effects: {} } }, { quality: { preset: 'high', effects: {} } },
    ].map(patch => JSON.stringify({ version: 1, settings: { ...defaultPreferences(), ...patch } }))];
  for (const saved of invalidRecords) {
    const f = fixture(saved), settings = f.create();
    assert.deepEqual(settings.snapshot, defaultPreferences());
    assert.equal(settings.status.problem, true);
    assert.match(settings.status.message, /无法读取.*默认值/);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.writes.length, 0);
    settings.update({ mouseSensitivity: 1.5 });
    assert.equal(settings.snapshot.mouseSensitivity, 1.5);
    assert.equal(settings.status.problem, false);
    assert.equal(f.writes.length, 1, 'a deliberate edit can replace an invalid record');
  }
});

test('unavailable storage and quota failures keep session controls working and report that saving failed', () => {
  const warnings = [];
  const blocked = createPlayerPreferences({ storage: () => { throw new Error('SecurityError'); },
    warn: message => warnings.push(message) });
  assert.equal(blocked.status.problem, true);
  blocked.update({ aimSensitivity: .5 });
  assert.equal(blocked.snapshot.aimSensitivity, .5);
  assert.match(blocked.status.message, /本页生效.*无法保存/);
  assert.equal(warnings.length, 2);
  const f = fixture(), settings = f.create();
  f.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  settings.update({ motionStrength: 0 });
  assert.equal(settings.snapshot.motionStrength, 0);
  assert.equal(settings.status.problem, true);
  assert.match(settings.status.message, /QuotaExceededError/);
  assert.equal(f.warnings.length, 1);
});

test('invalid edits fail explicitly before mutating session or storage; unknown fields are never saved', () => {
  const f = fixture(), settings = f.create();
  for (const patch of [{ mouseSensitivity: 0 }, { mouseSensitivity: Infinity }, { aimSensitivity: 3.01 },
    { motionStrength: false }, { quality: { preset: 'low', effects: { fog: true } } }]) {
    assert.throws(() => settings.update(patch));
    assert.deepEqual(settings.snapshot, defaultPreferences());
    assert.equal(f.writes.length, 0);
  }
  assert.throws(() => validatePreferences(null), TypeError);
  settings.update({ health: 1, ammo: 99, mouseSensitivity: 1.25 });
  assert.equal(Object.hasOwn(JSON.parse(f.writes[0]).settings, 'ammo'), false);
  assert.equal(Object.hasOwn(settings.snapshot, 'health'), false);
});

test('pre-audio preferences retain their original controls and gain default sound groups without a silent write', () => {
  const old = defaultPreferences();
  delete old.audio; old.mouseSensitivity = 1.75; old.quality.preset = 'low';
  const f = fixture(JSON.stringify({ version: 1, settings: old })), settings = f.create();
  assert.equal(settings.snapshot.mouseSensitivity, 1.75);
  assert.equal(settings.snapshot.quality.preset, 'low');
  assert.deepEqual(settings.snapshot.audio, defaultPreferences().audio);
  assert.equal(f.writes.length, 0);
  const audio = settings.snapshot.audio;
  audio.master.volume = .5; audio.voices.muted = true; audio.footsteps.volume = .3;
  settings.update({ audio });
  assert.deepEqual(f.create().snapshot.audio, audio);
  const invalid = settings.snapshot.audio; invalid.voices.muted = 1;
  assert.throws(() => settings.update({ audio: invalid }), RangeError);
});
