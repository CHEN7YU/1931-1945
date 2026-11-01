import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { campaignLayout } from '../src/campaign-layout.js';
import { makeTownLayout } from '../src/town-layout.js';

const directory = new URL('../public/assets/maps/', import.meta.url);
await mkdir(directory, { recursive: true });
const files = [];
for (const id of ['taierzhuang-streets', 'taierzhuang-fort']) {
  const layout = campaignLayout(id), town = layout.town ?? makeTownLayout();
  const bytes = JSON.stringify({
    objectives: layout.objectives, obstacles: town.obstacles.filter(item => item.height >= 2),
  });
  await writeFile(new URL(`${id}.json`, directory), bytes);
  files.push({ file: `${id}.json`, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(new URL('source.json', directory), JSON.stringify({
  provider: 'Project-authored tactical layout', source: 'src/campaign-layout.js and src/town-layout.js',
  provenance: 'Generated from original prototype layout, not extracted historical or third-party map data.',
  license: 'Project source license; not independently relicensed CC0', files,
}, null, 2));
