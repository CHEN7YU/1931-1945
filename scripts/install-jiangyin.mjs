// 江阴要塞阻击战 · 一键接入：在 src/entry.js 第一行加入 import './jiangyin/jiangyin-launcher.js';
// 用法（项目根目录）：node scripts/install-jiangyin.mjs          写入（可重复执行，已接入则不改动）
//                     node scripts/install-jiangyin.mjs --check  只检查，不写文件
// 只改这一行；不改 campaigns.js / campaign-layout.js / vite.config.js / index.html / public/assets，
// 因此现有测试与 scripts/audit-assets.mjs 的资源审计、构建审计不受影响。
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const LAUNCHER_IMPORT = "import './jiangyin/jiangyin-launcher.js';";
const REQUIRED_FILES = ['jiangyin-launcher.js', 'jiangyin-campaign.js', 'jiangyin-page.js', 'jiangyin-main.js', 'jiangyin-game.js',
  'jiangyin-rules.js', 'jiangyin-world.js', 'jiangyin-models.js', 'jiangyin-soldiers.js', 'jiangyin-surfaces.js',
  'jiangyin-vegetation.js', 'jiangyin.css'];
// 本关复用的项目模块与大厅元素；缺失说明仓库结构已变化，需要人工核对。
const REUSED_MODULES = ['player-preferences.js', 'blast-feedback.js', 'blast-tinnitus.js', 'blast-profiles.js', 'rifle-audio.js', 'air-support.js', 'aircraft-ai.js', 'emplacements.js', 'emplacement-model.js', 'chi-ha.js', 'world.js', 'vehicle-renderer.js', 'combat-effects.js',
  'materials.js', 'woodland.js', 'nra-motion.js', 'rifle-action.js', 'casualties.js', 'nra-character.js', 'nra-force-renderer.js',
  'ija-character.js', 'menu-music.js', 'entry.js'];
const LOBBY_IDS = ['campaign-choice', 'confirm-campaign', 'campaign-description', 'campaign-history', 'campaign-goals', 'menu', 'loading'];

export function addLauncherImport(source) {
  if (source.includes(LAUNCHER_IMPORT)) return { changed: false, source };
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return { changed: true, source: `${LAUNCHER_IMPORT}${newline}${source}` };
}

export async function installJiangyin(root, { check = false } = {}) {
  const problems = [];
  const exists = async path => access(path).then(() => true, () => false);
  for (const file of REQUIRED_FILES) if (!await exists(resolve(root, 'src/jiangyin', file))) problems.push(`缺少 src/jiangyin/${file}（请先复制本关文件夹）`);
  if (!await exists(resolve(root, 'src/terrain-gait.js'))) problems.push('缺少 src/terrain-gait.js（本包新增的通用坡地步态模块，请一并复制）');
  for (const file of REUSED_MODULES) if (!await exists(resolve(root, 'src', file))) problems.push(`仓库缺少 src/${file}`);
  const index = await readFile(resolve(root, 'index.html'), 'utf8').catch(() => '');
  for (const id of LOBBY_IDS) if (!new RegExp(`id\\s*=\\s*["']${id}["']`).test(index)) problems.push(`index.html 未找到 id="${id}"`);
  const music = await readFile(resolve(root, 'src/menu-music.js'), 'utf8').catch(() => '');
  for (const name of ['prepareNavigation', 'setState']) if (!music.includes(name)) problems.push(`src/menu-music.js 未找到 ${name}`);
  const entryPath = resolve(root, 'src/entry.js');
  const entry = await readFile(entryPath, 'utf8').catch(() => null);
  let changed = false;
  if (entry !== null) {
    const result = addLauncherImport(entry);
    changed = result.changed;
    if (changed && !check && !problems.length) await writeFile(entryPath, result.source);
  }
  return { problems, changed, installed: entry?.includes(LAUNCHER_IMPORT) || (changed && !check && !problems.length) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { problems, changed, installed } = await installJiangyin(root, { check });
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) { console.error('未写入任何文件。'); process.exit(1); }
  console.log(check ? (installed ? '✓ 已接入江阴关。' : '△ 检查通过；尚未在 src/entry.js 加入启动行，去掉 --check 运行即可。')
    : changed ? '✓ 已在 src/entry.js 第一行加入江阴关启动行。' : '✓ 已接入，无需改动。');
}
