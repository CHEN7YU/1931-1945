import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const output = resolve('public\\assets\\campaign-previews');
const scratch = process.env.ARTIFACT_DIR;
if (!scratch) throw new Error('ARTIFACT_DIR is required for the original scene captures');
await mkdir(output, { recursive: true }); await mkdir(scratch, { recursive: true });
const shots = [
  { campaign: 'taierzhuang-fort', name: '台儿庄东门', position: [44, 4.2, -4], target: [58, 3.6, 3] },
  { campaign: 'nanjing', name: '中华门防线', position: [-35, 6, 45], target: [0, 7.5, 17] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const files = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.captureCampaignPreview=(position,target)=>{
        setGameState('pause');
        for(const id of ['menu','hud','overlay','loading'])$(id).hidden=true;
        document.querySelector('.grain').hidden=true;
        for(const child of camera.children)child.visible=false;
        for(const civilian of world.civilians??[])civilian.visible=false;
        if(nraCharacter)nraCharacter.root.visible=false;
        if(ijaCharacter)ijaCharacter.root.visible=false;
        camera.fov=65;camera.aspect=1280/720;camera.updateProjectionMatrix();
        camera.position.set(...position);camera.lookAt(...target);
        renderer.render(scene,camera);
      };` });
  });
  for (const shot of shots) {
    await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/?campaign=' + shot.campaign);
    if (shot.campaign !== 'nanjing') await page.evaluate(() => import('/src/main.js'));
    await page.waitForFunction(() => window.captureCampaignPreview, null, { timeout: 180000 });
    await page.evaluate(({ position, target }) => captureCampaignPreview(position, target), shot);
    const png = join(scratch, `${shot.campaign}.png`), file = `${shot.campaign}.webp`;
    await page.screenshot({ path: png });
    execFileSync('python', ['-c',
      'from PIL import Image; import sys; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", quality=86, method=6)',
      png, join(output, file)], { stdio: 'pipe', windowsHide: true });
    const bytes = await readFile(join(output, file));
    files.push({ campaign: shot.campaign, file, alt: `${shot.name} · 游戏战场预览`, width: 1280, height: 720,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      camera: { position: shot.position, target: shot.target, fov: 65 } });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(join(output, 'source.json'), JSON.stringify({
    sourceKind: 'original-in-game-scene-captures',
    provider: 'Project-authored campaign scenes',
    source: 'src/main.js and src/campaign-layout.js',
    license: 'Project source license; not independently relicensed CC0',
    generator: 'scripts/prepare-campaign-previews.mjs',
    description: 'Original captures of the actual campaign geometry, without HUD or combat actors. Not historical photographs.',
    materialRights: 'Underlying game material provenance remains in its existing source records; these captures do not reclassify those materials as CC0.',
    files,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ files: files.map(({ campaign, bytes }) => ({ campaign, bytes })), errors }));
} finally { await browser.close(); }
