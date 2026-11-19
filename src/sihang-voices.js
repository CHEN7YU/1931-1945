import { battleVoiceMix } from './battle-voices.js';

export const SIHANG_VOICE_LINES = Object.freeze({
  installing: '北墙发现日军爆破队！阻止他们安装炸药！',
  armed: '北墙炸药已装好！二十五秒后引爆，立刻靠近拆除！',
  disarmed: '炸药已经拆除！继续守住仓库！',
  detonated: '北墙被炸开了！守住缺口！',
  withdrawal: '撤退命令！各队到仓库南面集合！',
  assembled: '队伍集结完毕！准备撤离！',
  'wave-start': '下一批弟兄，准备过桥！',
  'wave-cover': '掩护队，撤退！',
  counterattack: '日军反扑！掩护弟兄们过桥！',
  'retreat-open': '过半弟兄已撤离！带上你的弟兄，过桥！',
  'final-retreat': '部队完成撤退，你已经完成掩护任务，立刻撤退到南岸。',
  cheer1: '弟兄们，挺住啊！',
  cheer2: '中国军人，好样的！',
  cheer3: '弟兄们，保重啊！',
  memorial: '我们会记住这里的坚守，记住每一位没有归来的弟兄。',
});

export function sihangVoiceClips() {
  return Object.entries(SIHANG_VOICE_LINES).map(([cue, text]) => ({
    id: `sihang-${cue}`, file: `${cue}.mp3`, cue, text, phase: 'sihang',
    voice: cue === 'cheer2' ? 'zh-CN-XiaoxiaoNeural' : 'zh-CN-YunjianNeural',
    locale: 'zh-CN', gender: cue === 'cheer2' ? 'Female' : 'Male',
    style: cue === 'cheer2' ? 'cheerful' : 'serious',
    styledegree: '1.4', rate: '-3%', pitch: '-3%', volume: 'loud',
    audioRevision: ['detonated', 'withdrawal', 'assembled', 'wave-start', 'wave-cover', 'counterattack', 'retreat-open'].includes(cue)
      ? 'sihang-regroup-v1' : cue === 'armed' ? 'sihang-demolition-v2' : 'sihang-1937-v1',
  }));
}

export function createSihangVoices(buffers) {
  const clips = sihangVoiceClips().filter(clip => !['memorial', 'retreat-open'].includes(clip.cue));
  for (const clip of clips)
    if (!buffers[clip.cue] || buffers[clip.cue].duration <= .1 || buffers[clip.cue].duration > 20)
      throw new Error(`Missing or invalid Sihang voice: ${clip.cue}`);
  let output = null, current = null, nextCheerAt = 12, spoken = 0, cheers = 0;
  const stop = () => { if (current) { current.source.stop(); current = null; } };
  const api = {
    setOutput(node) { output = node; },
    sync(enabled) { if (!enabled) stop(); },
    reset() { stop(); nextCheerAt = 12; spoken = cheers = 0; },
    play(context, cue, position = null, listener = null) {
      if (!clips.some(clip => clip.cue === cue)) throw new RangeError(`Unknown Sihang voice cue: ${cue}`);
      if (!context || context.state !== 'running' || !output) return false;
      stop();
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffers[cue];
      let pan = null;
      if (position && listener) {
        const mix = battleVoiceMix(position, listener);
        gain.gain.value = mix.gain * .22;
        pan = context.createStereoPanner(); pan.pan.value = mix.pan;
        source.connect(gain).connect(pan).connect(output);
      } else { gain.gain.value = .92; source.connect(gain).connect(output); }
      current = { source, cue };
      source.onended = () => {
        if (current?.source === source) current = null;
        source.disconnect(); gain.disconnect(); pan?.disconnect();
      };
      source.start(); spoken++; if (position) cheers++;
      return true;
    },
    update(context, campaign, civilians, listener, now, enabled) {
      if (!enabled || campaign.outcome) { stop(); return; }
      if (current || now < nextCheerAt || listener.position.z < -10) return;
      const cue = campaign.stage === 'sihang-retreat' ? 'cheer3' : cheers % 2 ? 'cheer2' : 'cheer1';
      const female = cue === 'cheer2';
      const speaker = civilians.find(person => person.visible && !person.userData.dead &&
        person.userData.presentation === (female ? 'woman' : 'man') &&
        Math.hypot(person.position.x - listener.position.x, person.position.z - listener.position.z) < 65);
      if (speaker && api.play(context, cue, speaker.position, listener)) nextCheerAt = now + 18 + Math.random() * 8;
    },
    get snapshot() { return { spoken, cheers, active: current?.cue ?? null, clips: clips.length }; },
  };
  return api;
}

export async function loadSihangVoices() {
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Browser does not provide Sihang voice decoding');
  const context = new Audio(1, 1, 24000), buffers = {};
  await Promise.all(sihangVoiceClips().filter(clip => !['memorial', 'retreat-open'].includes(clip.cue)).map(async clip => {
    const url = `/assets/audio/sihang-voices/${clip.file}?v=${clip.audioRevision}`;
    const response = await fetch(url,
      { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Sihang voice ${url}: HTTP ${response.status}`);
    buffers[clip.cue] = await context.decodeAudioData(await response.arrayBuffer());
  }));
  return createSihangVoices(buffers);
}
