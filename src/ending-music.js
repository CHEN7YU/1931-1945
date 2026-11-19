import { createMenuMusic, getMenuMusic } from './menu-music.js';
import { getPlayerPreferences } from './player-preferences.js';

export function createEndingMusic(options) {
  return createMenuMusic({ ...options, startSeconds: 0, resumeTime: 0,
    playStates: ['history', 'victory', 'defeat', 'draw', 'commemoration'], loopOnEnd: false });
}

let shared = null;
export function getEndingMusic() {
  if (!shared) {
    const audio = document.getElementById('ending-music');
    if (!audio) throw new Error('Ending soundtrack audio element is missing');
    shared = createEndingMusic({
      audio, settings: getPlayerPreferences().snapshot.audio,
      initialMuted: getMenuMusic().snapshot.muted,
      onChange({ failure }) {
        if (!failure) return;
        const warning = document.getElementById('battle-ending-warning');
        if (warning) { warning.textContent = `片尾音乐暂不可用：${failure}`; warning.hidden = false; }
      },
      onError: error => console.error('片尾音乐不可用：', error),
    });
  }
  return shared;
}
