import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildStamp } from '../scripts/build-stamp.mjs';

const commit = 'a4f0530dbf158606ae55efa4c015b17aa4469a72';
const now = new Date('2026-10-27T15:00:00Z');

test('build metadata keeps only revision, dirty state and UTC time, not local paths', () => {
  const calls = [];
  const stamp = readBuildStamp({ now, run(command, args) {
    calls.push({ command, args });
    return args[0] === 'rev-parse' ? `${commit}\n` : ' M private-notes.txt\n';
  } });
  assert.deepEqual(stamp, { commit, dirty: true, builtAt: now.toISOString() });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.command === 'git'));
  assert.ok(!JSON.stringify(stamp).includes('private-notes'));
  assert.equal(readBuildStamp({ now, run: (_, args) => args[0] === 'rev-parse' ? commit : '' }).dirty, false);
});

test('optional Git absence is explicit rather than pretending a known clean release', () => {
  for (const reason of [{ code: 'ENOENT' }, { status: 128 }]) {
    const warnings = [];
    const stamp = readBuildStamp({ now, warn: message => warnings.push(message),
      run() { throw Object.assign(new Error('Git unavailable'), reason); } });
    assert.deepEqual(stamp, { commit: null, dirty: null, builtAt: now.toISOString() });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown version/);
  }
});

test('corrupt revisions and unexpected command failures are not hidden', () => {
  assert.throws(() => readBuildStamp({ now, run: () => 'not-a-revision' }), /Invalid Git/);
  assert.throws(() => readBuildStamp({ now, run() { throw Object.assign(new Error('unexpected'), { status: 2 }); } }), /unexpected/);
});
