import { getPlayerPreferences } from './player-preferences.js';
import { validateAudioSettings } from './audio-mixer.js';

export const MENU_MUSIC_VOLUME = .28;
let sharedMusic = null;

export function createMenuMusic({ audio, settings, onChange = () => {}, onError = console.error, fadeMs = 450 }) {
  settings = validateAudioSettings(settings);
  let state = 'menu', muted = false, waiting = false, failure = null, pending = null, timer = null, envelope = 1;
  let generation = 0;
  const wanted = () => ['menu', 'deployment', 'loading'].includes(state) && !muted && !failure;
  const volume = () => { audio.volume = MENU_MUSIC_VOLUME * (settings.master.muted ? 0 : settings.master.volume) * envelope; };
  const cancelFade = () => { clearInterval(timer); timer = null; };
  const pause = () => { generation++; audio.pause(); audio.currentTime = 0; };
  const notify = () => onChange({ state, muted, waiting, failure });
  const fail = error => {
    failure = error.message; waiting = false; cancelFade(); pause(); notify(); onError(error);
  };
  function fadeOut() {
    cancelFade();
    if (audio.paused || fadeMs === 0) { pause(); return; }
    const started = performance.now(), initial = envelope;
    timer = setInterval(() => {
      envelope = initial * Math.max(0, 1 - (performance.now() - started) / fadeMs); volume();
      if (envelope === 0) { cancelFade(); pause(); }
    }, 20);
  }
  function play() {
    if (!wanted()) return Promise.resolve();
    cancelFade(); envelope = 1; volume();
    if (pending) return pending;
    if (!audio.paused) return Promise.resolve();
    const attempt = generation;
    pending = (async () => {
      try {
        await audio.play();
        if (!wanted()) { pause(); return; }
        waiting = false; notify();
      } catch (error) {
        if (error.name === 'NotAllowedError') { waiting = wanted(); notify(); }
        else if (error.name !== 'AbortError' || attempt === generation) fail(error);
      } finally {
        pending = null;
        if (attempt !== generation && wanted() && audio.paused) void play();
      }
    })();
    return pending;
  }
  audio.loop = true; volume();
  const errorHandler = () => fail(new Error(`背景音乐加载失败：${audio.error?.message || `媒体错误 ${audio.error?.code ?? 'unknown'}`}`));
  audio.addEventListener('error', errorHandler);
  return {
    activate: play,
    setState(next) {
      state = next; waiting = false;
      if (wanted()) void play();
      else if (next === 'playing') fadeOut();
      else { cancelFade(); pause(); }
      notify();
    },
    configure(value) { settings = validateAudioSettings(value); volume(); },
    toggle() {
      if (waiting && !muted) { void play(); return; }
      muted = !muted; waiting = false;
      if (muted) { cancelFade(); pause(); } else void play();
      notify();
    },
    dispose() { state = 'disposed'; cancelFade(); pause(); audio.removeEventListener('error', errorHandler); },
    get snapshot() { return { state, muted, waiting, failure, playing: !audio.paused, volume: audio.volume, time: audio.currentTime }; },
  };
}

export function getMenuMusic() {
  if (!sharedMusic) sharedMusic = createMenuMusic({
    audio: document.getElementById('menu-music'),
    settings: getPlayerPreferences().snapshot.audio,
    onChange({ muted, waiting, failure }) {
      for (const button of document.querySelectorAll('[data-menu-music-toggle]')) {
        button.textContent = `背景音乐：${failure ? '加载失败' : muted ? '静音' : waiting ? '点击开启' : '开启'}`;
        button.setAttribute('aria-pressed', String(!muted));
        button.title = failure ?? '《琅琊榜》原声 · 最后的审判；受总音量控制，进入战斗后停止';
      }
    },
    onError: error => console.error('大厅背景音乐不可用：', error),
  });
  return sharedMusic;
}
