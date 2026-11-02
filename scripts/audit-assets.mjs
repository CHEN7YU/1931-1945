import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const groups = [
  { manifest: 'sources.json', directory: '', use: 'runtime', evidence: [] },
  { manifest: 'maps/source.json', directory: 'maps', use: 'runtime', evidence: [] },
  { manifest: 'loading/source.json', directory: 'loading', use: 'runtime', evidence: [] },
  { manifest: 'loading/colorized/source.json', directory: 'loading/colorized', use: 'runtime', evidence: [] },
  { manifest: 'audio/kenney-impact/source.json', directory: 'audio/kenney-impact', use: 'runtime', evidence: ['License.txt'] },
  { manifest: 'audio/recorded-rifle/source.json', directory: 'audio/recorded-rifle', use: 'runtime', evidence: ['LICENSE.txt'] },
  { manifest: 'audio/enemy-rifle/source.json', directory: 'audio/enemy-rifle', use: 'runtime', evidence: [] },
  { manifest: 'audio/battle-reactions/source.json', directory: 'audio/battle-reactions', use: 'runtime', evidence: [] },
  { manifest: 'audio/machine-gun/source.json', directory: 'audio/machine-gun', use: 'runtime', evidence: [] },
  { manifest: 'audio/rifle-mechanical/source.json', directory: 'audio/rifle-mechanical', use: 'runtime', evidence: ['LICENSE.txt'] },
  { manifest: 'audio/friendly-rifle-generated/source.json', directory: 'audio/friendly-rifle-generated', use: 'runtime',
    evidence: ['PERMISSION.txt'] },
  { manifest: 'audio/battle-voices/source.json', directory: 'audio/battle-voices', use: 'runtime', evidence: [] },
  { manifest: 'audio/mortar/source.json', directory: 'audio/mortar', use: 'runtime', evidence: [] },
  { manifest: 'characters/kenney-survivor/source.json', directory: 'characters/kenney-survivor', use: 'diagnostic', evidence: ['License.txt'] },
  { manifest: 'game/nra-88/source.json', directory: 'game/nra-88', use: 'runtime',
    evidence: ['PERMISSION.txt', 'Kenney-CC0.txt', 'KayKit-CC0.txt'] },
  { manifest: 'game/ija-1938/source.json', directory: 'game/ija-1938', use: 'runtime', evidence: [] },
  { manifest: 'materials/ai-scene/source.json', directory: 'materials/ai-scene', use: 'runtime', evidence: [] },
  { manifest: 'materials/ai-dadao/source.json', directory: 'materials/ai-dadao', use: 'runtime', evidence: [] },
  { manifest: 'dependencies/three-mesh-bvh/source.json', directory: 'dependencies/three-mesh-bvh', use: 'runtime', evidence: [] },
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
    if (group.directory === 'audio/friendly-rifle-generated') {
      const request = '这两个声音 作为我军步枪和狙击枪的声音';
      const permission = metadata.permission;
      const record = await readFile(assetPath(root, `${group.directory}/PERMISSION.txt`), 'utf8');
      if (metadata.sourceKind !== 'user-supplied-generated-audio' || metadata.provider !== 'ElevenLabs' ||
        metadata.license !== 'User project-use request; provider and redistribution rights unverified' ||
        permission?.basis !== 'user-supplied-generated-audio-project-use' || permission.record !== 'PERMISSION.txt' ||
        permission.request !== request || permission.isCC0 !== false ||
        permission.providerTermsIndependentlyVerified !== false || permission.redistributionRightsIndependentlyVerified !== false ||
        !record.includes(request) || !record.includes('Provider terms and redistribution rights have not been independently verified.') ||
        !metadata.files.some(file => file.file === 'PERMISSION.txt' && file.sha256) ||
        metadata.files.map(file => file.file).sort().join(',') !== 'PERMISSION.txt,rifle-report.wav,sniper-report.wav') {
        throw new Error('User-supplied generated rifle audio permission requires explicit review');
      }
      permissions.push({ directory: group.directory, basis: permission.basis,
        limitation: 'User-requested project use; not CC0. Provider terms and redistribution rights have not been independently verified.' });
    } else if (group.directory === 'game/nra-88') {
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
    } else if (group.directory === 'audio/machine-gun') {
      if (metadata.license !== 'Pixabay-Content-License' || metadata.author !== 'Foisal72' ||
        metadata.source !== 'https://pixabay.com/sound-effects/film-special-effects-gun-fire-346766/' ||
        metadata.licenseUrl !== 'https://pixabay.com/service/license-summary/' ||
        metadata.original?.sha256 !== '6d744d3c82244de278f9dac2c6f4792bdfcf4ae15869befef590f6b7844be46b') {
        throw new Error('User-supplied machine-gun recording provenance requires review');
      }
      permissions.push({ directory: group.directory, basis: metadata.license,
        limitation: 'User-supplied recording; not CC0. Source/license pages returned HTTP 403; verify redistribution terms before public release.' });
    } else if (group.directory === 'materials/ai-scene' || group.directory === 'materials/ai-dadao') {
      if (metadata.provider !== 'Azure OpenAI' || metadata.license !== 'Azure-generated-images' ||
        metadata.isCC0 !== false || metadata.model !== 'gpt-image-2.5-flare' ||
        metadata.source !== 'https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e' ||
        metadata.licenseUrl !== 'https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA') {
        throw new Error(`Generated ${group.directory === 'materials/ai-scene' ? 'scene' : 'dadao'} image provenance requires review`);
      }
      permissions.push({ directory: group.directory, basis: metadata.license,
        limitation: 'Original AI-generated material candidates; subject to the Azure agreement, not CC0. Normal and roughness maps are image-derived estimates, not measured PBR or historical evidence.' });
    } else if (group.directory === 'dependencies/three-mesh-bvh') {
      if (metadata.license !== 'MIT' || metadata.author !== 'Garrett Johnson' || metadata.version !== '0.9.16' ||
        metadata.source !== 'https://github.com/gkjohnson/three-mesh-bvh' ||
        metadata.files.length !== 1 || metadata.files[0].file !== 'LICENSE.txt') {
        throw new Error('Collision dependency license provenance requires review');
      }
      permissions.push({ directory: group.directory, basis: 'MIT',
        limitation: 'Third-party library; copyright and MIT license notice are included with the build.' });
    } else if (group.directory === 'loading/colorized') {
      const originals = JSON.parse(await readFile(assetPath(root, 'loading/source.json'), 'utf8'));
      const allowed = [1, 2, 3, 5, 6, 7, 8, 12, 13, 14, 16, 18, 19, 20, 21, 23]
        .map(number => `photo-${String(number).padStart(2, '0')}.png`);
      if (metadata.sourceKind !== 'azure-restored-user-supplied-photographs' || metadata.provider !== 'Azure OpenAI' ||
        metadata.model !== 'gpt-image-2.5-flare' || metadata.version !== '2026-09-08' ||
        metadata.license !== 'Azure image edits of user-supplied originals; underlying redistribution rights unverified' ||
        metadata.source !== 'https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/dall-e' ||
        metadata.licenseUrl !== 'https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA' ||
        metadata.permission?.basis !== 'user-approved-ai-photo-restoration' ||
        metadata.permission.isCC0 !== false || metadata.permission.redistributionRightsIndependentlyVerified !== false ||
        metadata.historicalColorsVerified !== false || metadata.permission.request !== '看着不错 批量处理' ||
        metadata.excluded?.['photo-15'] !== 'Azure rejected the source image at input moderation; retained original without retry or bypass.' ||
        metadata.excluded?.['photo-17'] !== 'Azure response was interrupted before the image was received; retained original without repeating the potentially charged request.' ||
        metadata.excluded?.['photo-22'] !== 'Azure rejected the image at output moderation; retained original without retry or bypass.' ||
        originals.files.some(file => !allowed.includes(file.file) && file.restored) ||
        metadata.budgetUsd !== 50 || !Number.isFinite(metadata.conservativeEstimatedTotalUsd) ||
        metadata.conservativeEstimatedTotalUsd < 0 || metadata.conservativeEstimatedTotalUsd > metadata.budgetUsd ||
        !Number.isFinite(metadata.reservedTotalUsd) || metadata.reservedTotalUsd > metadata.budgetUsd ||
        metadata.reservedTotalUsd < metadata.conservativeEstimatedTotalUsd ||
        metadata.failedOrUncertainReservationUsd !== 6 ||
        metadata.files.length !== allowed.length || metadata.files.some((file, index) => {
          const original = originals.files.find(item => item.file === file.originalFile), restored = original?.restored;
          return file.originalFile !== allowed[index] || !original || original.sha256 !== file.originalSha256 ||
            file.file !== original.file.replace('.png', '.webp') ||
            !Number.isInteger(file.width) || file.width <= 0 || file.width > 1280 ||
            !Number.isInteger(file.height) || file.height <= 0 || file.height > 840 ||
            Math.abs(file.width / file.height - original.width / original.height) >= .003 ||
            restored?.file !== `colorized/${file.file}` || restored.sha256 !== file.sha256 ||
            restored.bytes !== file.bytes || restored.width !== file.width || restored.height !== file.height;
        })) {
        throw new Error('AI photo restoration provenance requires review');
      }
      permissions.push({ directory: group.directory, basis: metadata.permission.basis,
        limitation: 'Azure AI edits of user-supplied photos; not CC0. Inferred colors and details are not historical evidence. Underlying redistribution rights remain unverified.' });
    } else if (group.directory === 'loading') {
      if (metadata.sourceKind !== 'user-supplied-loading-images' ||
        metadata.license !== 'User-requested project use; original rights unverified' ||
        metadata.permission?.basis !== 'user-supplied-images-project-use' ||
        metadata.permission.isCC0 !== false || metadata.permission.redistributionRightsIndependentlyVerified !== false ||
        metadata.files.length !== 23 || metadata.files.some((file, index) =>
          file.attachment !== index + 1 || file.file !== `photo-${String(index + 1).padStart(2, '0')}.png` ||
          !file.alt || !(file.width > 0) || !(file.height > 0))) {
        throw new Error('User-supplied loading image provenance requires review');
      }
      permissions.push({ directory: group.directory, basis: metadata.permission.basis,
        limitation: metadata.permission.limitation });
    } else if (group.directory === 'maps') {
      if (metadata.provider !== 'Project-authored tactical layout' ||
        metadata.source !== 'src/campaign-layout.js and src/town-layout.js' ||
        metadata.license !== 'Project source license; not independently relicensed CC0' ||
        metadata.files.map(file => file.file).sort().join(',') !== 'taierzhuang-fort.json,taierzhuang-streets.json') {
        throw new Error('Generated tactical map provenance requires review');
      }
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
      if (['index.html', 'town-preview.html'].includes(file) || inventory.has(file.replace(/^assets\//, '')) && file.startsWith('assets/')) continue;
      if (/^assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(file)) continue;
      throw new Error(`Unreviewed build payload: ${file}`);
    }
    warnings.push(`Build includes ${diagnostic.length} diagnostic-only files (${diagnostic.reduce((sum, item) => sum + item.bytes, 0)} bytes). They are not main-game downloads; this read-only audit does not remove them.`);
  }
  for (const permission of permissions) if (['audio/machine-gun', 'loading', 'loading/colorized'].includes(permission.directory)) warnings.push(permission.limitation);
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
