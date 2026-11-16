import { AUDIO_CHANNELS, defaultAudioSettings } from './audio-mixer.js';
import { getPlayerPreferences } from './player-preferences.js';
import { getMenuMusic } from './menu-music.js';
import { getEndingMusic } from './ending-music.js';

let sharedControls = null;

export function getPreferenceControls() {
  if (sharedControls) return sharedControls;
  const preferences = getPlayerPreferences(), listeners = new Set();
  const audioLabels = { master: '总音量', weapons: '枪炮与装填', voices: '战斗语音与喊声', footsteps: '脚步与落地', effects: '交互音效' };
  for (const container of document.querySelectorAll('[data-audio-controls]')) {
    for (const channel of AUDIO_CHANNELS) {
      const row = document.createElement('div'); row.className = 'audio-control-row';
      const label = document.createElement('label'), output = document.createElement('output');
      const input = document.createElement('input'), id = `${container.dataset.audioControls}-audio-volume-${channel}`;
      label.htmlFor = id; label.append(document.createTextNode(audioLabels[channel]), output);
      input.id = id; input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.05';
      input.dataset.audioVolume = channel; output.htmlFor = id; label.append(input);
      const mute = document.createElement('label'), checkbox = document.createElement('input');
      mute.className = 'audio-mute'; checkbox.type = 'checkbox'; checkbox.dataset.audioMute = channel;
      mute.append(checkbox, document.createTextNode(`${audioLabels[channel]}静音`));
      row.append(label, mute); container.append(row);
    }
  }
  function sync() {
    const values = preferences.snapshot;
    getMenuMusic().configure(values.audio);
    getEndingMusic().configure(values.audio);
    for (const input of document.querySelectorAll('[data-sensitivity]')) {
      const value = values[input.dataset.sensitivity];
      input.value = String(value);
      input.parentElement.querySelector('output').value = `${Math.round(value * 100)}%`;
    }
    for (const selector of document.querySelectorAll('[data-motion-strength]')) selector.value = String(values.motionStrength);
    for (const input of document.querySelectorAll('[data-tank-crushing]')) input.checked = values.tankCrushing;
    for (const input of document.querySelectorAll('[data-blast-blur]')) input.checked = values.blastBlur;
    for (const element of document.querySelectorAll('[data-preferences-status]')) {
      element.textContent = preferences.status.problem ? preferences.status.message : '';
      element.hidden = !preferences.status.problem;
      element.classList.toggle('preferences-warning', preferences.status.problem);
    }
    for (const input of document.querySelectorAll('[data-audio-volume]')) {
      input.value = String(values.audio[input.dataset.audioVolume].volume);
      input.parentElement.querySelector('output').value = `${Math.round(Number(input.value) * 100)}%`;
    }
    for (const input of document.querySelectorAll('[data-audio-mute]'))
      input.checked = values.audio[input.dataset.audioMute].muted;
    for (const listener of listeners) listener(values);
  }
  for (const input of document.querySelectorAll('[data-sensitivity]')) input.addEventListener('input', () => {
    preferences.update({ [input.dataset.sensitivity]: Number(input.value) }); sync();
  });
  for (const selector of document.querySelectorAll('[data-motion-strength]')) selector.addEventListener('change', () => {
    preferences.update({ motionStrength: Number(selector.value) }); sync();
  });
  for (const button of document.querySelectorAll('[data-reset-controls]')) button.addEventListener('click', () => {
    preferences.update({ mouseSensitivity: 1, aimSensitivity: 1, motionStrength: 1 }); sync();
  });
  for (const input of document.querySelectorAll('[data-tank-crushing]')) input.addEventListener('change', () => {
    preferences.update({ tankCrushing: input.checked }); sync();
  });
  for (const input of document.querySelectorAll('[data-blast-blur]')) input.addEventListener('change', () => {
    preferences.update({ blastBlur: input.checked }); sync();
  });
  for (const input of document.querySelectorAll('[data-audio-volume], [data-audio-mute]')) {
    const volume = Boolean(input.dataset.audioVolume), channel = input.dataset.audioVolume ?? input.dataset.audioMute;
    if (!AUDIO_CHANNELS.includes(channel)) throw new RangeError('Unknown audio control');
    input.addEventListener(volume ? 'input' : 'change', () => {
      const audio = preferences.snapshot.audio;
      audio[channel][volume ? 'volume' : 'muted'] = volume ? Number(input.value) : input.checked;
      preferences.update({ audio }); sync();
    });
  }
  for (const button of document.querySelectorAll('[data-reset-audio]')) button.addEventListener('click', () => {
    preferences.update({ audio: defaultAudioSettings() }); sync();
  });
  sharedControls = { sync, subscribe(listener) { listeners.add(listener); listener(preferences.snapshot); } };
  sync();
  return sharedControls;
}
