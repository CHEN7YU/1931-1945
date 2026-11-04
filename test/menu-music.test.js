import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMenuMusic, MENU_MUSIC_VOLUME, MENU_MUSIC_START_SECONDS } from '../src/menu-music.js';
import { defaultAudioSettings } from '../src/audio-mixer.js';

function fixture(options = {}) {
  const { audio: audioSettings, ...musicOptions } = options;
  const audio = { paused: true, currentTime: 0, readyState: 1, duration: 240,
    volume: 1, loop: false, calls: 0, listeners: new Map(),
    async play() { this.calls++; this.paused = false; },
    pause() { this.paused = true; },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); },
    ...audioSettings,
  };
  const errors = [], changes = [];
  const music = createMenuMusic({ audio, settings: defaultAudioSettings(), fadeMs: 0,
    onError: error => errors.push(error), onChange: status => changes.push(status), ...musicOptions });
  return { audio, music, errors, changes };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('one looping source continues through menu, deployment and loading, then never restarts in combat overlays', async () => {
  const { audio, music } = fixture();
  await music.activate(); audio.currentTime = 45;
  music.setState('deployment'); music.setState('loading');
  assert.equal(audio.calls, 1); assert.equal(audio.currentTime, 45); assert.equal(audio.loop, false);
  music.setState('playing');
  assert.equal(audio.paused, true); assert.equal(audio.currentTime, MENU_MUSIC_START_SECONDS);
  for (const state of ['pause', 'dead', 'transferring', 'victory', 'defeat', 'draw']) {
    music.setState(state); await music.activate(); assert.equal(audio.calls, 1);
  }
  music.setState('menu'); await settle();
  assert.equal(audio.calls, 2); assert.equal(audio.paused, false);
  music.dispose(); assert.equal(audio.listeners.size, 0);
});

test('autoplay rejection waits for a real subsequent activation without reporting a broken asset', async () => {
  const { audio, music, errors } = fixture();
  audio.play = async function () {
    this.calls++;
    if (this.calls === 1) throw Object.assign(new Error('User activation required'), { name: 'NotAllowedError' });
    this.paused = false;
  };
  await music.activate(); assert.equal(music.snapshot.waiting, true); assert.deepEqual(errors, []);
  music.toggle(); await settle();
  assert.equal(music.snapshot.playing, true); assert.equal(music.snapshot.waiting, false);
  music.dispose();
});

test('master gain and mute apply live while the separate music mute leaves other audio settings untouched', async () => {
  const { audio, music } = fixture();
  const settings = defaultAudioSettings(); settings.master.volume = .5;
  music.configure(settings); await music.activate();
  assert.equal(audio.volume, MENU_MUSIC_VOLUME * .5);
  settings.master.muted = true; music.configure(settings); assert.equal(audio.volume, 0);
  settings.master.muted = false; music.configure(settings);
  const before = structuredClone(settings);
  music.toggle(); assert.equal(audio.paused, true);
  await music.activate(); assert.equal(audio.paused, true);
  music.toggle(); await settle(); assert.equal(audio.paused, false);
  assert.deepEqual(settings, before);
  music.dispose();
});

test('actual battle entry fades then pauses and rewinds the source', async () => {
  const { audio, music } = fixture({ fadeMs: 80 });
  await music.activate(); audio.currentTime = 20; music.setState('playing');
  assert.equal(audio.paused, false);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.ok(audio.volume < MENU_MUSIC_VOLUME && audio.volume > 0);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(audio.paused, true); assert.equal(audio.currentTime, MENU_MUSIC_START_SECONDS); assert.equal(audio.volume, 0);
  music.dispose();
});

test('a late successful play cannot leak music into battle, and real decoding failures are explicit', async () => {
  const { audio, music, errors } = fixture();
  let resolve;
  audio.play = () => new Promise(done => { resolve = () => { audio.paused = false; done(); }; });
  const pending = music.activate(); music.setState('playing'); resolve(); await pending;
  assert.equal(audio.paused, true);
  music.setState('menu'); resolve(); await settle();
  audio.error = { code: 4, message: 'Unsupported source' }; audio.listeners.get('error')();
  assert.match(music.snapshot.failure, /Unsupported source/); assert.equal(errors.length, 1);
  assert.equal(audio.paused, true); music.dispose();
});

test('the physically trimmed resource starts and loops at zero, while mute preserves the playhead', async () => {
  const { audio, music } = fixture();
  await music.activate();
  assert.equal(audio.currentTime, 0);
  audio.currentTime = 87;
  music.toggle(); music.toggle(); await settle();
  assert.equal(audio.currentTime, 87);
  audio.currentTime = audio.duration; audio.paused = true;
  audio.listeners.get('ended')(); await settle();
  assert.equal(audio.currentTime, 0); assert.equal(audio.paused, false);
  music.dispose();
});

test('campaign navigation resumes the same playhead and does not lose a separate music mute', async () => {
  let saved;
  const first = fixture({ onNavigate: value => { saved = value; } });
  await first.music.activate(); first.audio.currentTime = 76;
  first.music.toggle(); first.music.prepareNavigation();
  assert.deepEqual(saved, { time: 76, muted: true });
  const next = fixture({ resumeTime: saved.time, initialMuted: saved.muted });
  await next.music.activate();
  assert.equal(next.audio.calls, 0);
  next.music.toggle(); await settle();
  assert.equal(next.audio.currentTime, 76); assert.equal(next.audio.paused, false);
  first.music.dispose(); next.music.dispose();
  const pendingMetadata = fixture({ resumeTime: 76, audio: { readyState: 0, duration: NaN },
    onNavigate: value => { saved = value; } });
  pendingMetadata.music.prepareNavigation();
  assert.equal(saved.time, 76, 'a second fast campaign change must retain the pending resume offset before metadata arrives');
  pendingMetadata.music.dispose();
});

test('metadata arriving after activation applies the initial seek once, while an unusable short recording is explicit', async () => {
  const { audio, music, errors } = fixture({ audio: { readyState: 0, duration: NaN } });
  await music.activate();
  audio.duration = 240;
  audio.readyState = 1; audio.currentTime = 0; audio.listeners.get('loadedmetadata')();
  assert.equal(audio.currentTime, 0);
  audio.currentTime = 44; audio.listeners.get('loadedmetadata')();
  assert.equal(audio.currentTime, 44);
  assert.deepEqual(errors, []); music.dispose();
  const short = fixture({ audio: { readyState: 0, duration: 0 } });
  short.audio.readyState = 1; short.audio.listeners.get('loadedmetadata')();
  assert.equal(short.errors.length, 1);
  assert.equal(short.audio.paused, true); short.music.dispose();
});

test('both original MP3s and the independently clipped playback file retain exact hashes and provenance', async () => {
  const root = new URL('../public/assets/audio/menu-music/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  assert.equal(source.activeFile, 'youjing-long-march-from-29s.mp3'); assert.equal(source.startSeconds, 0);
  assert.equal(source.trimStartSeconds, 29); assert.equal(source.files[2].removedDecodedSamples, 29 * 44100);
  assert.equal(source.files.length, 3);
  for (const file of source.files) {
    const bytes = await readFile(new URL(file.file, root));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.equal(source.permission.isCC0, false);
  assert.equal(source.permission.redistributionRightsIndependentlyVerified, false);
});
