import { QUALITY_EFFECTS } from './quality.js';
import { defaultAudioSettings, validateAudioSettings } from './audio-mixer.js';

export const PREFERENCES_KEY = 'embers-of-china.preferences.v1';
export const SENSITIVITY_LIMITS = Object.freeze({ min: .25, max: 3, step: .05 });
let sharedPreferences = null;
export function getPlayerPreferences() { return sharedPreferences ??= createPlayerPreferences(); }
const motionValues = [0, .35, 1];
export function defaultPreferences() {
  return { mouseSensitivity: 1, aimSensitivity: 1, motionStrength: 1, tankCrushing: true, audio: defaultAudioSettings(),
    quality: { preset: 'high', effects: Object.fromEntries(QUALITY_EFFECTS.map(effect => [effect, true])) } };
}

export function validatePreferences(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid player preferences');
  for (const key of ['mouseSensitivity', 'aimSensitivity']) {
    if (!Number.isFinite(value[key]) || value[key] < SENSITIVITY_LIMITS.min || value[key] > SENSITIVITY_LIMITS.max) {
      throw new RangeError(`Invalid ${key}`);
    }
  }
  if (!motionValues.includes(value.motionStrength)) throw new RangeError('Invalid camera motion strength');
  if (typeof value.tankCrushing !== 'boolean') throw new TypeError('Invalid tank crushing setting');
  if (!['high', 'low'].includes(value.quality?.preset)) throw new RangeError('Invalid saved graphics preset');
  for (const effect of QUALITY_EFFECTS) {
    if (typeof value.quality.effects?.[effect] !== 'boolean') throw new TypeError(`Invalid saved graphics effect: ${effect}`);
  }
  return { mouseSensitivity: value.mouseSensitivity, aimSensitivity: value.aimSensitivity,
    motionStrength: value.motionStrength, tankCrushing: value.tankCrushing,
    audio: validateAudioSettings(value.audio), quality: { preset: value.quality.preset,
      effects: Object.fromEntries(QUALITY_EFFECTS.map(effect => [effect, value.quality.effects[effect]])) } };
}

export function lookSensitivity(settings, { aiming, scopeSensitivity = null }) {
  const aimed = aiming || scopeSensitivity !== null;
  return .0022 * (scopeSensitivity ?? (aiming ? .6 : 1)) *
    (aimed ? settings.aimSensitivity : settings.mouseSensitivity);
}

export function createPlayerPreferences({ storage = () => window.localStorage, warn = console.warn } = {}) {
  let state = defaultPreferences();
  let status = '设置保存在此浏览器，不保存战局或弹药。';
  let problem = false;
  function failure(message, error) {
    problem = true;
    status = `${message}：${error.message}`;
    warn(status);
  }
  try {
    const saved = storage().getItem(PREFERENCES_KEY);
    if (saved !== null) {
      const record = JSON.parse(saved);
      if (record?.version !== 1) throw new RangeError('不支持的设置版本');
      // Earlier v1 settings predate audio controls; preserve their sensitivity and graphics.
      state = validatePreferences({ ...record.settings,
        tankCrushing: record.settings?.tankCrushing === undefined ? true : record.settings.tankCrushing,
        audio: record.settings?.audio === undefined ? defaultAudioSettings() : record.settings.audio });
      status = '已恢复此浏览器保存的设置。';
    }
  } catch (error) {
    failure('无法读取保存的设置，本次使用默认值；修改后会尝试重新保存', error);
  }
  return {
    update(patch) {
      const next = validatePreferences({ ...state, ...patch });
      state = next;
      try {
        storage().setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, settings: state }));
        problem = false;
        status = '设置已保存在此浏览器。';
      } catch (error) {
        failure('设置已在本页生效，但无法保存；刷新后可能丢失', error);
      }
    },
    get snapshot() { return validatePreferences(state); },
    get status() { return { message: status, problem }; },
  };
}
