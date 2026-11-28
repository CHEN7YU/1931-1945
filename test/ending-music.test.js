import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEndingMusic } from '../src/ending-music.js';
import { defaultAudioSettings } from '../src/audio-mixer.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const audio = { paused: true, currentTime: 0, readyState: 1, duration: 200,
    volume: 1, calls: 0, listeners: new Map(),
    async play() { this.calls++; this.paused = false; },
    pause() { this.paused = true; },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); },
  };
  const music = createEndingMusic({ audio, settings: defaultAudioSettings(), fadeMs: 0 });
  return { audio, music };
}

test('ending music waits for black history and continues through results without restarting', async () => {
  const { audio, music } = fixture();
  for (const state of ['menu', 'deployment', 'loading', 'playing', 'pause']) {
    music.setState(state); await music.activate(); assert.equal(audio.calls, 0);
  }
  music.setState('history'); await settle();
  assert.equal(audio.currentTime, 0); assert.equal(audio.calls, 1);
  audio.currentTime = 16;
  music.setState('victory'); await settle();
  assert.equal(audio.currentTime, 16); assert.equal(audio.calls, 1);
  music.setState('menu'); assert.equal(audio.paused, true); assert.equal(audio.currentTime, 0);
  music.dispose();
});

test('an ending plays once, stays finished after result clicks, and can start fresh in a new match', async () => {
  const { audio, music } = fixture();
  music.setState('history'); await settle();
  audio.currentTime = 200; audio.paused = true;
  audio.listeners.get('ended')();
  music.setState('defeat'); await music.activate();
  assert.equal(audio.calls, 1);
  music.setMuted(true); music.setMuted(false); await music.activate();
  assert.equal(audio.calls, 1);
  music.setState('playing'); music.setState('history'); await settle();
  assert.equal(audio.calls, 2); assert.equal(audio.currentTime, 0);
  music.dispose();
});

test('ending music mute preserves its playhead and master settings still apply', async () => {
  const { audio, music } = fixture();
  music.setState('history'); await settle(); audio.currentTime = 22;
  music.setMuted(true); assert.equal(audio.paused, true);
  music.setMuted(false); await settle(); assert.equal(audio.currentTime, 22);
  const settings = defaultAudioSettings(); settings.master.muted = true;
  music.configure(settings); assert.equal(audio.volume, 0);
  music.dispose();
});

test('the user ending soundtrack is unmodified, not trimmed, and has explicit unverified redistribution rights', async () => {
  const root = new URL('../public/assets/audio/ending-music/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  const bytes = await readFile(new URL(manifest.activeFile, root));
  assert.equal(bytes.length, 3667962);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '21049d11c496e810ccbc9e9d5f5538b84b74c9d397783d85ce39b22ec04b4b4b');
  assert.equal(manifest.startSeconds, 0); assert.equal(manifest.loop, false);
  assert.equal(manifest.permission.redistributionRightsIndependentlyVerified, false);
});
