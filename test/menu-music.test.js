import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMenuMusic, MENU_MUSIC_VOLUME } from '../src/menu-music.js';
import { defaultAudioSettings } from '../src/audio-mixer.js';

function fixture(options = {}) {
  const audio = { paused: true, currentTime: 0, volume: 1, loop: false, calls: 0, listeners: new Map(),
    async play() { this.calls++; this.paused = false; },
    pause() { this.paused = true; },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); },
  };
  const errors = [], changes = [];
  const music = createMenuMusic({ audio, settings: defaultAudioSettings(), fadeMs: 0,
    onError: error => errors.push(error), onChange: status => changes.push(status), ...options });
  return { audio, music, errors, changes };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('one looping source continues through menu, deployment and loading, then never restarts in combat overlays', async () => {
  const { audio, music } = fixture();
  await music.activate(); audio.currentTime = 45;
  music.setState('deployment'); music.setState('loading');
  assert.equal(audio.calls, 1); assert.equal(audio.currentTime, 45); assert.equal(audio.loop, true);
  music.setState('playing');
  assert.equal(audio.paused, true); assert.equal(audio.currentTime, 0);
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
  assert.equal(audio.paused, true); assert.equal(audio.currentTime, 0); assert.equal(audio.volume, 0);
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

test('the copied user MP3 retains its exact hash and unverified redistribution notice', async () => {
  const root = new URL('../public/assets/audio/menu-music/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  const bytes = await readFile(new URL(source.files[0].file, root));
  assert.equal(bytes.length, source.files[0].bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.files[0].sha256);
  assert.equal(source.permission.isCC0, false);
  assert.equal(source.permission.redistributionRightsIndependentlyVerified, false);
});
