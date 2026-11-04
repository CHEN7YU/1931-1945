import test from 'node:test';
import assert from 'node:assert/strict';

test('launcher and battle share session preferences even when browser storage is unavailable', async t => {
  const { getPlayerPreferences } = await import('../src/player-preferences.js?launcher-session-test');
  const previous = globalThis.window;
  t.mock.method(console, 'warn', () => {});
  globalThis.window = { get localStorage() { throw new Error('Storage disabled'); } };
  try {
    const launcher = getPlayerPreferences();
    launcher.update({ quality: { ...launcher.snapshot.quality, preset: 'low' } });
    const battle = getPlayerPreferences();
    assert.equal(battle, launcher);
    assert.equal(battle.snapshot.quality.preset, 'low');
    assert.equal(battle.status.problem, true);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
