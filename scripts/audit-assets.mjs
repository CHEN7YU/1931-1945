import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const groups = [
  { manifest: 'sources.json', directory: '', use: 'runtime', evidence: [] },
  { manifest: 'audio/kenney-impact/source.json', directory: 'audio/kenney-impact', use: 'runtime', evidence: ['License.txt'] },
  { manifest: 'audio/recorded-rifle/source.json', directory: 'audio/recorded-rifle', use: 'runtime', evidence: ['LICENSE.txt'] },
  { manifest: 'audio/rifle-mechanical/source.json', directory: 'audio/rifle-mechanical', use: 'runtime', evidence: ['LICENSE.txt'] },
  { manifest: 'audio/battle-voices/source.json', directory: 'audio/battle-voices', use: 'runtime', evidence: [] },
  { manifest: 'characters/kenney-survivor/source.json', directory: 'characters/kenney-survivor', use: 'diagnostic', evidence: ['License.txt'] },
  { manifest: 'game/nra-88/source.json', directory: 'game/nra-88', use: 'runtime',
    evidence: ['PERMISSION.txt', 'Kenney-CC0.txt', 'KayKit-CC0.txt'] },
  { manifest: 'game/ija-1938/source.json', directory: 'game/ija-1938', use: 'runtime', evidence: [] },
];

function assetPath(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') ||
    name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe asset path: ${name}`);
  }
  const path = resolve(root, ...name.split('/'));
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error(`Asset escapes root: ${name}`);
  return path;
}

async function filesUnder(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Asset symlinks are not allowed: ${path}`);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
    else throw new Error(`Unsupported asset entry: ${path}`);
  }
  return files.sort();
}

export async function auditAssets({ root, buildRoot } = {}) {
  root = resolve(root ?? fileURLToPath(new URL('../public/assets/', import.meta.url)));
  const inventory = new Map(), permissions = [];
  async function include(name, use, record) {
    const path = assetPath(root, name);
    if (!(await lstat(path)).isFile()) throw new Error(`Asset must be a regular file: ${name}`);
    const bytes = await readFile(path);
    if (!bytes.length) throw new Error(`Empty asset: ${name}`);
    if (record) {
      if (!Number.isInteger(record.bytes) || record.bytes !== bytes.length) throw new Error(`Asset size mismatch: ${name}`);
      const algorithm = record.sha256 ? 'sha256' : 'md5', hash = record[algorithm];
      if (typeof hash !== 'string' || !new RegExp(`^[a-f0-9]{${algorithm === 'sha256' ? 64 : 32}}$`).test(hash)) {
        throw new Error(`Missing or invalid checksum: ${name}`);
      }
      if (createHash(algorithm).update(bytes).digest('hex') !== hash) throw new Error(`Asset checksum mismatch: ${name}`);
    }
    inventory.set(name, { file: name, use, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  for (const group of groups) {
    await include(group.manifest, group.use);
    const metadata = JSON.parse(await readFile(assetPath(root, group.manifest), 'utf8'));
    if (!Array.isArray(metadata.files) || !metadata.files.length) throw new Error(`No files in ${group.manifest}`);
    if (group.directory === 'game/nra-88') {
      if (metadata.permission?.basis !== 'user-reported-author-phone-consent' || metadata.permission.isCC0 !== false ||
        metadata.permission.record !== 'PERMISSION.txt') throw new Error('NRA permission record requires explicit review');
      permissions.push({ directory: group.directory, basis: metadata.permission.basis,
        limitation: 'User-reported consent; not CC0 or independently verified written permission.' });
    } else if (group.directory === 'game/ija-1938') {
      const original = JSON.parse(await readFile(assetPath(root, 'game/nra-88/source.json'), 'utf8'));
      if (metadata.permission?.basis !== 'user-reported-author-phone-consent' || metadata.permission.isCC0 !== false ||
        metadata.sourcePermissionRecord !== '/assets/game/nra-88/PERMISSION.txt' ||
        metadata.sourceModelSha256 !== original.modelOriginalSha256 || metadata.historicalAcceptance !== false ||
        metadata.sourceClothingTexturesIncluded !== false || metadata.sourceInsigniaIncluded !== false) {
        throw new Error('Japanese adaptation provenance requires explicit review');
      }
      permissions.push({ directory: group.directory, basis: metadata.permission.basis,
        limitation: 'Adapted from the user-authorized original; not CC0 or an independently accepted historical reconstruction.' });
    } else if (group.directory === 'audio/battle-voices') {
      if (metadata.provider !== 'Azure AI Speech' || metadata.license !== 'Azure-generated-speech' ||
        metadata.source !== 'https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech' ||
        metadata.licenseUrl !== 'https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA' ||
        metadata.files.some(file => file.gender !== 'Male')) throw new Error('Generated battle voice provenance requires review');
      permissions.push({ directory: group.directory, basis: metadata.license,
        limitation: 'Original dialogue synthesized with Azure stock voices; subject to the Azure agreement, not CC0 or historical recordings.' });
    } else if (metadata.license !== 'CC0-1.0' || !/^https:\/\//.test(metadata.source ?? metadata.licenseUrl)) {
      throw new Error(`Source/license evidence requires review: ${group.manifest}`);
    }
    for (const record of metadata.files) {
      assetPath(root, record.file);
      await include([group.directory, record.file].filter(Boolean).join('/'), group.use, record);
    }
    for (const evidence of group.evidence) {
      const name = `${group.directory}/${evidence}`;
      if (!inventory.has(name)) await include(name, group.use);
    }
  }
  for (const file of await filesUnder(root)) {
    if (!inventory.has(file)) throw new Error(`Unlisted public asset; classify and record its source before publishing: ${file}`);
  }
  const warnings = [];
  const diagnostic = [...inventory.values()].filter(item => item.use === 'diagnostic');
  if (buildRoot) {
    const published = resolve(buildRoot, 'assets');
    for (const item of inventory.values()) {
      const path = assetPath(published, item.file);
      if (!(await lstat(path)).isFile()) throw new Error(`Published asset must be a regular file: ${item.file}`);
      const data = await readFile(path);
      if (createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error(`Published asset differs: ${item.file}`);
    }
    for (const file of await filesUnder(resolve(buildRoot))) {
      if (file === 'index.html' || inventory.has(file.replace(/^assets\//, '')) && file.startsWith('assets/')) continue;
      if (/^assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(file)) continue;
      throw new Error(`Unreviewed build payload: ${file}`);
    }
    warnings.push(`Build includes ${diagnostic.length} diagnostic-only files (${diagnostic.reduce((sum, item) => sum + item.bytes, 0)} bytes). They are not main-game downloads; this read-only audit does not remove them.`);
  }
  return { files: [...inventory.values()].sort((a, b) => a.file.localeCompare(b.file)),
    bytes: [...inventory.values()].reduce((sum, item) => sum + item.bytes, 0), permissions, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== '--build') throw new Error('Usage: node scripts\\audit-assets.mjs [--build]');
  const result = await auditAssets({ buildRoot: args.includes('--build') ? fileURLToPath(new URL('../dist/', import.meta.url)) : undefined });
  console.log(JSON.stringify(result, null, 2));
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
}
