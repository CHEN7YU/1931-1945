import test from 'node:test';
import assert from 'node:assert/strict';
import { pushAsChen7yu } from '../scripts/push-as-chen7yu.mjs';

const SHA = 'a'.repeat(40);
const SAVED_TOKEN = 'gho_test_credential_for_unit_tests_only';
function fixture({ identity = 'CHEN7YU', remote = 'https://github.com/CHEN7YU/1931-1945.git',
  permission = true, tokenStatus = 0, pushStatus = 0, changeHead = false } = {}) {
  const calls = [], logs = [], environment = {
    GH_TOKEN: 'different_copilot_account', GITHUB_TOKEN: 'another_account',
    GH_ENTERPRISE_TOKEN: 'other_host_token', GH_HOST: 'wrong-host.example',
    GIT_ASKPASS: 'copilot-askpass', PATH: 'unchanged-path',
  };
  let headReads = 0;
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git') {
      if (args[0] === 'remote') return { status: 0, stdout: remote };
      if (args[0] === 'symbolic-ref') return { status: 0, stdout: 'main' };
      if (args[0] === 'rev-parse') {
        headReads++;
        return { status: 0, stdout: changeHead && headReads > 1 ? 'b'.repeat(40) : SHA };
      }
      if (args[0] === 'status') return { status: 0, stdout: ' M user-notes.txt' };
      if (args.includes('push')) return { status: pushStatus };
      if (args[0] === 'check-ref-format') return { status: 0, stdout: '' };
      assert.fail(`Unexpected Git command: ${args.join(' ')}`);
    }
    assert.equal(command, 'gh');
    if (args[0] === 'auth') return { status: tokenStatus, stdout: SAVED_TOKEN, stderr: SAVED_TOKEN };
    if (args.includes('user')) return { status: 0, stdout: identity };
    return { status: 0, stdout: JSON.stringify({ full_name: 'CHEN7YU/1931-1945', push: permission }) };
  };
  return { calls, logs, environment, options: { run, environment, log: text => logs.push(text), cwd: 'C:\\repo\\1931-1945' } };
}

test('check mode uses the saved account without inherited tokens, changes no environment and never pushes', () => {
  const f = fixture(), before = { ...f.environment };
  const result = pushAsChen7yu(['--check'], f.options);
  assert.equal(result.pushed, false);
  assert.deepEqual(f.environment, before);
  const tokenCall = f.calls.find(call => call.args[0] === 'auth');
  assert.equal(tokenCall.options.env.GH_TOKEN, undefined);
  assert.equal(tokenCall.options.env.GITHUB_TOKEN, undefined);
  assert.equal(tokenCall.options.env.GH_ENTERPRISE_TOKEN, undefined);
  assert.ok(tokenCall.args.includes('CHEN7YU'));
  const apiCalls = f.calls.filter(call => call.args[0] === 'api');
  assert.ok(apiCalls.every(call => call.options.env.GH_TOKEN === SAVED_TOKEN));
  assert.equal(f.calls.some(call => call.args.includes('push')), false);
  assert.ok(f.logs.some(text => text.includes('Uncommitted')));
  assert.ok(f.logs.every(text => !text.includes(SAVED_TOKEN)));
});

test('push is pinned to the checked commit and same-named branch, with a per-command helper instead of global config', () => {
  const f = fixture(), before = { ...f.environment };
  const result = pushAsChen7yu([], f.options);
  const push = f.calls.find(call => call.args.includes('push'));
  assert.equal(result.pushed, true);
  assert.deepEqual(push.args.slice(-3), ['push', 'origin', `${SHA}:refs/heads/main`]);
  assert.ok(push.args.includes('credential.helper='));
  assert.ok(push.args.includes('credential.https://github.com.helper=!gh auth git-credential'));
  assert.equal(push.options.env.GH_TOKEN, SAVED_TOKEN);
  assert.equal(push.options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(push.options.env.GIT_ASKPASS, undefined);
  assert.deepEqual(f.environment, before);
  assert.ok(f.calls.every(call => !['login', 'switch', 'setup-git', '--force', 'commit', '--global', '--local'].some(arg => call.args.includes(arg))));
  assert.ok(f.calls.every(call => call.args.every(arg => !arg.includes(SAVED_TOKEN))));
});

test('wrong identity, missing credentials, read-only access and unexpected remote URLs cannot push or leak tokens', () => {
  for (const facts of [
    { identity: 'chenqiyu_microsoft' }, { tokenStatus: 1 }, { permission: false },
    { remote: 'https://github.com/someone/another.git' },
    { remote: 'https://github.com/CHEN7YU/1931-1945.git\nhttps://github.com/someone/another.git' },
    { remote: 'https://token@github.com/CHEN7YU/1931-1945.git' },
    { remote: 'git@github.com:CHEN7YU/1931-1945.git' },
  ]) {
    const f = fixture(facts);
    assert.throws(() => pushAsChen7yu([], f.options), error => !error.message.includes(SAVED_TOKEN));
    assert.equal(f.calls.some(call => call.args.includes('push')), false);
  }
});

test('concurrent HEAD changes abort and a failed push is never retried or force-pushed', () => {
  const changed = fixture({ changeHead: true });
  assert.throws(() => pushAsChen7yu([], changed.options), /changed during verification/);
  assert.equal(changed.calls.some(call => call.args.includes('push')), false);
  const failed = fixture({ pushStatus: 1 });
  assert.throws(() => pushAsChen7yu([], failed.options), /Git push failed/);
  assert.equal(failed.calls.filter(call => call.args.includes('push')).length, 1);
});

test('unknown flags cannot become arbitrary Git arguments and help reads no credentials', () => {
  const f = fixture();
  assert.throws(() => pushAsChen7yu(['--force'], f.options), /Usage/);
  pushAsChen7yu(['--help'], f.options);
  assert.equal(f.calls.length, 0);
});
