import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditAssets } from '../scripts/audit-assets.mjs';

const source = new URL('../public/assets/', import.meta.url);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'battle-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'assets');
  await cp(source, root, { recursive: true });
  return { directory, root };
}

test('all public resources have exact size/hash evidence and permission is not relabelled CC0', async () => {
  const report = await auditAssets();
  assert.ok(report.bytes > 15000000);
  assert.ok(report.files.some(file => file.use === 'diagnostic'));
  const mechanical = report.files.filter(file => file.file.startsWith('audio/rifle-mechanical/'));
  assert.equal(mechanical.length, 6);
  assert.ok(mechanical.every(file => file.use === 'runtime'), 'main-game mechanical recordings must not remain diagnostic-only');
  assert.match(report.permissions[0].limitation, /not CC0/);
  assert.ok(report.warnings.some(warning => /verify redistribution terms before public release/.test(warning)));
  const generated = report.files.filter(file => file.file.startsWith('materials/ai-scene/'));
  assert.equal(generated.length, 14);
  assert.ok(generated.every(file => file.use === 'runtime'));
  assert.ok(report.permissions.some(permission => permission.basis === 'Azure-generated-images' && /not CC0/.test(permission.limitation)));
});

test('generated scene art cannot be relabelled as CC0', async t => {
  const { root } = await fixture(t);
  const path = join(root, 'materials', 'ai-scene', 'source.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  metadata.license = 'CC0-1.0';
  await writeFile(path, JSON.stringify(metadata));
  await assert.rejects(auditAssets({ root }), /Generated scene image provenance requires review/);
});

test('an unlisted archive or a corrupted existing file blocks the audit', async t => {
  const { root } = await fixture(t);
  const extra = join(root, 'candidate.zip');
  await writeFile(extra, 'unapproved');
  await assert.rejects(auditAssets({ root }), /Unlisted public asset/);
  await rm(extra);
  const target = join(root, 'audio', 'kenney-impact', 'wood.ogg');
  const data = await readFile(target);
  data[100] ^= 1;
  await writeFile(target, data);
  await assert.rejects(auditAssets({ root }), /checksum mismatch/);
});

test('missing files and manifest traversal cannot produce a clean report', async t => {
  const { root } = await fixture(t);
  const manifest = join(root, 'audio', 'kenney-impact', 'source.json');
  const original = JSON.parse(await readFile(manifest, 'utf8'));
  const changed = structuredClone(original);
  changed.files[0].file = '../outside.ogg';
  await writeFile(manifest, JSON.stringify(changed));
  await assert.rejects(auditAssets({ root }), /Unsafe asset path/);
  await writeFile(manifest, JSON.stringify(original));
  await rm(join(root, 'audio', 'kenney-impact', 'wood.ogg'));
  await assert.rejects(auditAssets({ root }), /ENOENT/);
});

test('build audit flags diagnostic payload and rejects missing, stale and unreviewed output', async t => {
  const { directory, root } = await fixture(t), buildRoot = join(directory, 'dist');
  await mkdir(buildRoot);
  await cp(root, join(buildRoot, 'assets'), { recursive: true });
  await writeFile(join(buildRoot, 'index.html'), '<html></html>');
  await writeFile(join(buildRoot, 'assets', 'index-Abcdef12.js'), '// built code');
  const report = await auditAssets({ root, buildRoot });
  assert.match(report.warnings[0], /diagnostic-only/);
  await writeFile(join(buildRoot, 'original.zip'), 'archive');
  await assert.rejects(auditAssets({ root, buildRoot }), /Unreviewed build payload/);
  await rm(join(buildRoot, 'original.zip'));
  const target = join(buildRoot, 'assets', 'audio', 'kenney-impact', 'wood.ogg');
  await writeFile(target, 'stale');
  await assert.rejects(auditAssets({ root, buildRoot }), /Published asset differs/);
  await rm(target);
  await assert.rejects(auditAssets({ root, buildRoot }), /ENOENT/);
});
