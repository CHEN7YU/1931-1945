import { getPlayerPreferences } from './player-preferences.js';
import { validateAudioSettings } from './audio-mixer.js';

export const MENU_MUSIC_VOLUME = .28;
export const MENU_MUSIC_START_SECONDS = 29;
const NAVIGATION_KEY = 'shanhe.menu-music.youjing.navigation.v1';
let sharedMusic = null;

export function createMenuMusic({ audio, settings, onChange = () => {}, onError = console.error, fadeMs = 450,
  startSeconds = MENU_MUSIC_START_SECONDS, resumeTime = startSeconds, initialMuted = false, onNavigate = () => {} }) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(resumeTime) || resumeTime < startSeconds)
    throw new RangeError('Music playback offsets must be finite and at or after the loop start');
  settings = validateAudioSettings(settings);
  let state = 'menu', muted = initialMuted, waiting = false, failure = null, pending = null, timer = null, envelope = 1;
  let initialSeek = false;
  let generation = 0;
  const wanted = () => ['menu', 'deployment', 'loading'].includes(state) && !muted && !failure;
  const volume = () => { audio.volume = MENU_MUSIC_VOLUME * (settings.master.muted ? 0 : settings.master.volume) * envelope; };
  const cancelFade = () => { clearInterval(timer); timer = null; };
  const pause = (rewind = true) => {
    generation++; audio.pause();
    if (rewind) {
      resumeTime = startSeconds;
      if (audio.readyState > 0) audio.currentTime = startSeconds;
      else initialSeek = false;
    }
  };
  const notify = () => onChange({ state, muted, waiting, failure });
  const fail = error => {
    failure = error.message; waiting = false; cancelFade(); pause(); notify(); onError(error);
  };
  function seekInitial() {
    if (initialSeek || audio.readyState === 0) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= startSeconds) {
      fail(new Error('背景音乐长度不足，无法从指定秒数开始循环')); return;
    }
    audio.currentTime = resumeTime < audio.duration ? resumeTime : startSeconds;
    initialSeek = true;
  }
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
    seekInitial();
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
  audio.loop = false; volume();
  const errorHandler = () => fail(new Error(`背景音乐加载失败：${audio.error?.message || `媒体错误 ${audio.error?.code ?? 'unknown'}`}`));
  const endedHandler = () => {
    if (!wanted()) return;
    audio.currentTime = startSeconds;
    void play();
  };
  audio.addEventListener('error', errorHandler);
  audio.addEventListener('loadedmetadata', seekInitial);
  audio.addEventListener('ended', endedHandler);
  seekInitial();
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
      if (muted) { cancelFade(); pause(false); } else void play();
      notify();
    },
    prepareNavigation() {
      if (['menu', 'deployment', 'loading'].includes(state))
        onNavigate({ time: Math.max(startSeconds, initialSeek ? audio.currentTime : resumeTime), muted });
    },
    dispose() {
      state = 'disposed'; cancelFade(); pause();
      audio.removeEventListener('error', errorHandler); audio.removeEventListener('loadedmetadata', seekInitial);
      audio.removeEventListener('ended', endedHandler);
    },
    get snapshot() { return { state, muted, waiting, failure, playing: !audio.paused, volume: audio.volume, time: audio.currentTime }; },
  };
}

export function getMenuMusic() {
  if (!sharedMusic) {
    let resume = null;
    try {
      const saved = sessionStorage.getItem(NAVIGATION_KEY);
      sessionStorage.removeItem(NAVIGATION_KEY);
      if (saved) {
        const value = JSON.parse(saved);
        if (!Number.isFinite(value.time) || value.time < MENU_MUSIC_START_SECONDS ||
          typeof value.muted !== 'boolean' || !Number.isFinite(value.savedAt))
          throw new Error('Invalid music navigation state');
        if (Date.now() - value.savedAt >= 0 && Date.now() - value.savedAt < 120000) resume = value;
      }
    } catch (error) { console.warn('背景音乐切图进度无法恢复：', error); }
    sharedMusic = createMenuMusic({
      audio: document.getElementById('menu-music'),
      settings: getPlayerPreferences().snapshot.audio,
      resumeTime: resume?.time ?? MENU_MUSIC_START_SECONDS,
      initialMuted: resume?.muted ?? false,
      onNavigate(value) {
        try { sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify({ ...value, savedAt: Date.now() })); }
        catch (error) { console.warn('背景音乐切图进度无法保存：', error); }
      },
      onChange({ muted, waiting, failure }) {
        for (const button of document.querySelectorAll('[data-menu-music-toggle]')) {
          button.textContent = `背景音乐：${failure ? '加载失败' : muted ? '静音' : waiting ? '点击开启' : '开启'}`;
          button.setAttribute('aria-pressed', String(!muted));
          button.title = failure ?? '谭晶《游京（长征版）》；从29秒循环，受总音量控制，进入战斗后停止';
        }
      },
      onError: error => console.error('大厅背景音乐不可用：', error),
    });
  }
  return sharedMusic;
}
