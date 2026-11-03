import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ACCOUNT = 'CHEN7YU';
const REPOSITORY = 'CHEN7YU/1931-1945';
const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function pushAsChen7yu(args, {
  run = spawnSync, environment = process.env, log = console.log, cwd = ROOT,
} = {}) {
  if (args.some(arg => !['--check', '--help'].includes(arg)) || new Set(args).size !== args.length)
    throw new Error('Usage: node scripts\\push-as-chen7yu.mjs [--check | --help]');
  if (args.includes('--help')) {
    log('Push the current committed branch of CHEN7YU/1931-1945 using the saved CHEN7YU account.');
    log('--check verifies identity, repository and write permission without pushing.');
    log('No automatic commit, force push, account switching or global Git configuration changes.');
    return;
  }
  const cleanEnvironment = { ...environment };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'])
    delete cleanEnvironment[key];
  cleanEnvironment.GH_HOST = 'github.com';
  cleanEnvironment.GH_PROMPT_DISABLED = '1';

  const invoke = (command, commandArgs, env, failure, inherit = false) => {
    const result = run(command, commandArgs, {
      cwd, env, encoding: 'utf8', windowsHide: true,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw new Error(`${failure} Could not start ${command}: ${result.error.code ?? 'unknown error'}.`);
    if (result.status !== 0) throw new Error(`${failure} Exit: ${result.status ?? result.signal ?? 'unknown'}.`);
    return result.stdout?.trim() ?? '';
  };
  const gitRead = commandArgs => invoke('git', commandArgs, cleanEnvironment, 'Cannot inspect the local Git checkout.');
  const inspectRemote = () => {
    const urls = gitRead(['remote', 'get-url', '--push', '--all', 'origin']).split(/\r?\n/);
    if (urls.length !== 1 || !/^https:\/\/github\.com\/CHEN7YU\/1931-1945(?:\.git)?\/?$/i.test(urls[0]))
      throw new Error('Refusing to push: origin must have exactly one HTTPS push URL for CHEN7YU/1931-1945.');
    return urls[0];
  };
  const remote = inspectRemote();
  const branch = invoke('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], cleanEnvironment,
    'No current branch. Check out the intended branch before pushing; detached HEAD is not supported.');
  gitRead(['check-ref-format', '--branch', branch]);
  const sha = gitRead(['rev-parse', '--verify', 'HEAD']);
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid local commit identity.');

  const token = invoke('gh', ['auth', 'token', '--hostname', 'github.com', '--user', ACCOUNT], cleanEnvironment,
    'Cannot read the saved CHEN7YU credential. Sign in once using "gh auth login --hostname github.com --web --git-protocol https" and choose CHEN7YU. Keep Copilot App signed in to its current account.');
  if (token.length < 20 || /\s/.test(token)) throw new Error('The saved CHEN7YU credential is invalid; no push attempted.');
  const authenticatedEnvironment = {
    ...cleanEnvironment, GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
  };
  delete authenticatedEnvironment.GIT_ASKPASS;
  delete authenticatedEnvironment.SSH_ASKPASS;

  const identity = invoke('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login'],
    authenticatedEnvironment, 'GitHub identity verification failed. Check connectivity and the saved credential; no push attempted.');
  if (identity.toLowerCase() !== ACCOUNT.toLowerCase())
    throw new Error('The saved credential does not belong to CHEN7YU; no push attempted.');
  const permissionsJson = invoke('gh', ['api', '--hostname', 'github.com', `repos/${REPOSITORY}`,
    '--jq', '{full_name: .full_name, push: .permissions.push}'], authenticatedEnvironment,
  'Cannot verify write access to CHEN7YU/1931-1945; check network, repository access and credential authorization.');
  let permissions;
  try { permissions = JSON.parse(permissionsJson); }
  catch { throw new Error('GitHub returned an invalid repository-permission response; no push attempted.'); }
  if (permissions.full_name?.toLowerCase() !== REPOSITORY.toLowerCase() || permissions.push !== true)
    throw new Error('CHEN7YU does not have confirmed write access to the expected repository; no push attempted.');

  log(`Verified account: ${identity}`);
  log(`Target: ${remote}  branch: ${branch}  commit: ${sha.slice(0, 7)}`);
  if (gitRead(['status', '--porcelain']))
    log('Uncommitted changes exist. They will NOT be committed or included in this push.');
  if (args.includes('--check')) {
    log('Check passed. No push performed; Copilot App and global Git/gh account settings were not changed.');
    return { account: identity, branch, sha, pushed: false };
  }
  if (inspectRemote() !== remote || gitRead(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch ||
    gitRead(['rev-parse', '--verify', 'HEAD']) !== sha)
    throw new Error('The branch, commit or push URL changed during verification. Run the script again.');

  invoke('git', [
    '-c', 'credential.helper=',
    '-c', 'credential.https://github.com.helper=',
    '-c', 'credential.https://github.com.helper=!gh auth git-credential',
    '-c', 'http.extraHeader=',
    '-c', 'http.https://github.com/.extraHeader=',
    'push', 'origin', `${sha}:refs/heads/${branch}`,
  ], authenticatedEnvironment, 'Git push failed. No force push or recovery Git mutations were attempted.', true);
  log(`Pushed ${sha.slice(0, 7)} to origin/${branch} as CHEN7YU.`);
  return { account: identity, branch, sha, pushed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { pushAsChen7yu(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
