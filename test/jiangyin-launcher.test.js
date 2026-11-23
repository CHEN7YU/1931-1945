import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JIANGYIN_CAMPAIGN, jiangyinUrl, lobbyUrl, isJiangyinRequest } from '../src/jiangyin/jiangyin-campaign.js';
import { JIANGYIN_MARKUP } from '../src/jiangyin/jiangyin-page.js';
import { LAUNCHER_IMPORT, addLauncherImport, installJiangyin } from '../scripts/install-jiangyin.mjs';

test('Jiangyin enters through the existing lobby page without a new HTML entry or campaign-list change', () => {
  assert.equal(jiangyinUrl('https://game.example/?campaign=nanjing&resources=low-memory#x'),
    'https://game.example/?resources=low-memory&map=jiangyin');
  assert.equal(jiangyinUrl('https://game.example/sub/index.html'), 'https://game.example/sub/index.html?map=jiangyin');
  assert.equal(lobbyUrl('https://game.example/?map=jiangyin&quality=low'), 'https://game.example/?quality=low');
  assert.equal(isJiangyinRequest('?map=jiangyin'), true);
  assert.equal(isJiangyinRequest('?campaign=jiangyin'), false);
  assert.ok(JIANGYIN_CAMPAIGN.history && JIANGYIN_CAMPAIGN.description && JIANGYIN_CAMPAIGN.goals.length === 3);
});

test('the mounted page provides every element the Jiangyin battle reads', () => {
  const main = readFileSync(new URL('../src/jiangyin/jiangyin-main.js', import.meta.url), 'utf8');
  const ids = new Set([...main.matchAll(/\$\('([\w-]+)'\)/g)].map(match => match[1]));
  for (const id of ids) assert.ok(JIANGYIN_MARKUP.includes(`id="${id}"`), `missing #${id}`);
  for (const index of [0, 1, 2]) for (const id of [`jy-top-${index}`, `jy-top-${index}-label`]) assert.ok(JIANGYIN_MARKUP.includes(`id="${id}"`));
  assert.ok(/class="[^"]*\bjy-weapon\b/.test(JIANGYIN_MARKUP));
  for (const id of ['jy-members', 'jy-squad-status', 'jy-minimap', 'jy-flash', 'jy-fade', 'jy-equipment']) assert.ok(JIANGYIN_MARKUP.includes(`id="${id}"`), `missing #${id}`);
});

test('lazy voice decoding cannot shorten the 25-second playback cooldown or overlap clips', async () => {
  const { runInNewContext } = await import('node:vm');
  const main = readFileSync(new URL('../src/jiangyin/jiangyin-main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function playVoice(');
  const end = main.indexOf('\nfunction hitConfirm(', start);
  assert.ok(start >= 0 && end > start);
  const starts = [];
  const node = () => ({ connect() { return this; }, gain: {}, frequency: {},
    start(at) { starts.push({ at, duration: this.buffer.duration }); } });
  const audio = { currentTime: 0, createBufferSource: node, createGain: node, createBiquadFilter: node,
    async decodeAudioData() { audio.currentTime = Math.max(audio.currentTime, 20); return { duration: 2 }; } };
  const context = {
    audio, master: {}, voiceBusyUntil: 0,
    voiceCache: new Map(), voiceHeard: new Map(), voiceStarted: new Map(),
    JIANGYIN_VOICE_LINES: [{ cue: 'jiangyin-naval-start' }, { cue: 'jiangyin-air-raid' }],
    JIANGYIN_VOICE_FILE: cue => `${cue}.mp3`,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
  };
  const playVoice = runInNewContext(`${main.slice(start, end)}\nplayVoice;`, context);
  playVoice('jiangyin-naval-start');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts[0].at, 20, 'the first file decoded long after it was requested');
  audio.currentTime = 26;
  playVoice('jiangyin-naval-start');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(starts[1].at - starts[0].at >= 25, 'cooldown is measured between playback starts, not requests');
  playVoice('jiangyin-air-raid', true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts.length, 3);
  for (let index = 1; index < starts.length; index++)
    assert.ok(starts[index].at >= starts[index - 1].at + starts[index - 1].duration);
});

test('the installer adds exactly one launcher import and is idempotent', async () => {
  const first = addLauncherImport("import './style.css';\r\nconst a = 1;\r\n");
  assert.equal(first.changed, true);
  assert.ok(first.source.startsWith(`${LAUNCHER_IMPORT}\r\nimport './style.css';`));
  assert.equal(addLauncherImport(first.source).changed, false);
  const root = await mkdtemp(join(tmpdir(), 'jiangyin-install-'));
  try {
    await mkdir(join(root, 'src/jiangyin'), { recursive: true });
    for (const file of ['jiangyin-launcher.js', 'jiangyin-campaign.js', 'jiangyin-page.js', 'jiangyin-main.js', 'jiangyin-game.js',
      'jiangyin-rules.js', 'jiangyin-world.js', 'jiangyin-models.js', 'jiangyin-soldiers.js', 'jiangyin-surfaces.js',
      'jiangyin-vegetation.js', 'jiangyin-sights.js', 'jiangyin-voice.js', 'jiangyin.css']) await writeFile(join(root, 'src/jiangyin', file), '');
    for (const file of ['emplacements.js', 'emplacement-model.js', 'chi-ha.js', 'world.js', 'vehicle-renderer.js', 'combat-effects.js',
      'materials.js', 'woodland.js', 'nra-motion.js', 'rifle-action.js', 'casualties.js', 'nra-character.js', 'nra-force-renderer.js',
      'ija-character.js', 'blast-feedback.js', 'player-preferences.js', 'soldier-role-icons.js', 'blast-tinnitus.js', 'blast-profiles.js', 'rifle-audio.js', 'air-support.js', 'aircraft-ai.js',
      'terrain-gait.js', 'adaptive-quality.js', 'frame-work.js', 'water-waves.js', 'battle-voice-lines.js']) await writeFile(join(root, 'src', file), '');
    await writeFile(join(root, 'src/menu-music.js'), 'setState(next) {} prepareNavigation() {}');
    await writeFile(join(root, 'src/entry.js'), "import './style.css';\n");
    await writeFile(join(root, 'index.html'), ['campaign-choice', 'confirm-campaign', 'campaign-description', 'campaign-history',
      'campaign-goals', 'menu', 'loading'].map(id => `<div id="${id}"></div>`).join(''));
    assert.deepEqual((await installJiangyin(root, { check: true })).problems, []);
    assert.equal(await readFile(join(root, 'src/entry.js'), 'utf8'), "import './style.css';\n");
    for (const file of ['jiangyin/jiangyin-sights.js', 'jiangyin/jiangyin-voice.js', 'adaptive-quality.js',
      'frame-work.js', 'water-waves.js', 'battle-voice-lines.js']) {
      await unlink(join(root, 'src', file));
      const missing = await installJiangyin(root);
      assert.equal(missing.installed, false);
      assert.ok(missing.problems.some(problem => problem.includes(`src/${file}`)), `missing dependency ${file}`);
      assert.equal(await readFile(join(root, 'src/entry.js'), 'utf8'), "import './style.css';\n");
      await writeFile(join(root, 'src', file), '');
    }
    assert.equal((await installJiangyin(root)).changed, true);
    assert.equal((await installJiangyin(root)).changed, false);
    assert.equal(await readFile(join(root, 'src/entry.js'), 'utf8'), `${LAUNCHER_IMPORT}\nimport './style.css';\n`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
