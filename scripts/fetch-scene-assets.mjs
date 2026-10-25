import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../public/assets/', import.meta.url));
const license = 'https://polyhaven.com/license';
const surfaces = {
  brick: 'brick_wall_001',
  plaster: 'plaster_grey_04',
  tiles: 'grey_roof_tiles',
  paving: 'cobblestone_floor_02',
  earth: 'muddy_tracks',
  timber: 'wood_planks_grey',
};
const sky = 'kloofendal_48d_partly_cloudy_puresky';
const records = [];

async function download(entry, relativePath, asset) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`Asset download failed (${response.status}): ${entry.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const md5 = createHash('md5').update(bytes).digest('hex');
  if (md5 !== entry.md5) throw new Error(`Asset checksum mismatch: ${relativePath}`);
  const destination = join(root, relativePath);
  await mkdir(join(destination, '..'), { recursive: true });
  await writeFile(destination, bytes);
  records.push({ file: relativePath.replaceAll('\\', '/'), asset, source: entry.url, md5, bytes: bytes.length });
}

await Promise.all(Object.entries(surfaces).map(async ([name, id]) => {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`Asset metadata failed: ${id} (${response.status})`);
  const files = await response.json();
  const color = files.Diffuse;
  await Promise.all([
    download(color['1k'].jpg, join('materials', name, 'color.jpg'), id),
    download(files.nor_gl['1k'].jpg, join('materials', name, 'normal.jpg'), id),
    download(files.arm['1k'].jpg, join('materials', name, 'arm.jpg'), id),
  ]);
}));
const skyResponse = await fetch(`https://api.polyhaven.com/files/${sky}`);
if (!skyResponse.ok) throw new Error(`Sky metadata failed (${skyResponse.status})`);
await download((await skyResponse.json()).hdri['1k'].hdr, 'sky.hdr', sky);
records.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(join(root, 'sources.json'), `${JSON.stringify({ license: 'CC0-1.0', licenseUrl: license, resolution: '1k', files: records }, null, 2)}\n`);
console.log(`Downloaded and checksum-verified ${records.length} CC0 assets (${(records.reduce((sum, record) => sum + record.bytes, 0) / 1048576).toFixed(1)} MiB).`);
