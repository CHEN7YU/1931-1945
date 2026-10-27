import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const directory = new URL('../public/assets/game/ija-1938/', import.meta.url);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route('**/__ija-asset-build', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>' }));
  await page.goto(new URL('/__ija-asset-build', process.env.GAME_URL || 'http://127.0.0.1:5187').href);
  const asset = await page.evaluate(async () => {
    const { buildIjaAsset } = await import('/uniform-study/game-asset.js');
    const { binary, levels, motion } = await buildIjaAsset();
    const bytes = new Uint8Array(binary); let encoded = '';
    for (let index = 0; index < bytes.length; index += 32768) encoded += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return { base64: btoa(encoded), levels, motion };
  });
  const bytes = Buffer.from(asset.base64, 'base64');
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('character.glb', directory), bytes);
  const permission = JSON.parse(await readFile(new URL('../public/assets/game/nra-88/source.json', import.meta.url), 'utf8'));
  await writeFile(new URL('source.json', directory), JSON.stringify({
    asset: 'Japanese infantry 1938 visual study adaptation', version: 1, sourceStudy: '/uniform-study/',
    source: permission.source, author: permission.author, permission: permission.permission,
    sourcePermissionRecord: '/assets/game/nra-88/PERMISSION.txt', sourceModelSha256: permission.modelOriginalSha256,
    modelSha256: createHash('sha256').update(bytes).digest('hex'),
    historicalAcceptance: false, geometry: 'Adapted licensed head/hands/sleeves and measured torso; original reconstructed tunic, trousers, helmet and equipment. Spatial skin-weight transfer and authored attachment weights on a refitted source skeleton.',
    sourceClothingTexturesIncluded: false, sourceInsigniaIncluded: false,
    motionSource: permission.motionSource, levels: asset.levels, motion: asset.motion,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ bytes: bytes.length, levels: asset.levels }, null, 2));
} finally { await browser.close(); }
