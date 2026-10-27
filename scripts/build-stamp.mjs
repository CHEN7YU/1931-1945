import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function readBuildStamp({ cwd = fileURLToPath(new URL('../', import.meta.url)), run = execFileSync,
  now = new Date(), warn = console.warn } = {}) {
  const builtAt = now.toISOString();
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    const commit = run('git', ['rev-parse', '--verify', 'HEAD'], options).trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid Git build revision');
    const dirty = Boolean(run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], options).trim());
    return { commit, dirty, builtAt };
  } catch (error) {
    if (error.code !== 'ENOENT' && error.status !== 128) throw error;
    warn(`Git build metadata unavailable (${error.code ?? error.status}); the game will display an unknown version.`);
    return { commit: null, dirty: null, builtAt };
  }
}
