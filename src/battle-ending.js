export const BATTLE_END_STATES = Object.freeze(['victory', 'defeat', 'draw', 'commemoration']);

export const ENDING_NARRATION = Object.freeze({
  'taierzhuang-fort': '感谢有你，我们第一次在正面战场围歼了日军！',
  nanjing: '感谢你在城外拖延日军，感谢你在渡口掩护百姓和友军撤退，唐司令命令我们撤离南京，我们会再打回来了！',
  sihang: '弟兄们，友军已经过河。我们守住了阵地，也把战友带回来了。记住这座仓库，记住并肩作战的人。',
});

export function endingVoiceClips() {
  return Object.entries(ENDING_NARRATION).map(([campaign, text]) => ({
    id: `ending-${campaign}`, file: `ending-${campaign}.mp3`, campaign, text,
    voice: 'zh-CN-YunjianNeural', locale: 'zh-CN', gender: 'Male', style: 'serious',
    styledegree: '1.6', rate: '-5%', pitch: '-5%', volume: 'loud', phase: 'ending',
  }));
}

export const BATTLE_HISTORY = Object.freeze({
  sihang: {
    title: '上海四行仓库 · 孤军不孤', date: '1937年10月27日—31日',
    sections: [
      ['四百余人，八百壮士', '淞沪会战后期，谢晋元率第88师第262旅第524团四百余名官兵坚守四行仓库，掩护主力后撤。守军对外号称八百人，“八百壮士”由此成为中国军民不屈抗争的象征。'],
      ['隔河相望的坚守', '守军与日军激战四昼夜。新华社相关报道记述其打退十余次进攻、毙伤日军二百余人。南岸百姓声援，运送旗帜、食物和药品。守军的牺牲和普通人的苦难，不应被缩减为游戏里的数字。'],
      ['淞沪会战：为抗战争取时间', '10月31日凌晨，四行守军奉命撤入公共租界。历时约三个月的淞沪会战伤亡惨重，上海最终失陷，但中国军民的抵抗挫败了日军企图在三个月内迫使中国屈服的图谋。四行仓库的坚守是这场抵抗的一部分。本关的战斗与撤退流程为游戏化演绎。'],
    ],
    sources: [['人民日报：淞沪会战', 'https://politics.people.com.cn/n1/2018/1031/c1001-30372286.html'],
      ['新华社：孤军浴血守四行', 'https://www.xinhuanet.com/politics/20250624/dbf2a07cbf3f43e9857ff7377e4b768f/c.html'],
      ['国防部转载新华社：谢晋元等八百壮士', 'http://www.mod.gov.cn/2018gfbztlbmb/2018-12/22/content_4832662.htm']],
  },
  'taierzhuang-fort': {
    title: '台儿庄 · 浴血铸就的胜利', date: '1938年3月16日—4月15日',
    sections: [
      ['正面战场的重大胜利', '中国军队在台儿庄及周边浴血抗击日军。城镇化为废墟，守军在断壁间反复争夺，以血肉与意志挫败侵略者的攻势，振奋了全国抗战军民的信心。'],
      ['胜利的代价', '新华社综述记载，整场台儿庄大战中国军队伤亡约5万余人，毙伤日军约2万余人；这一口径包括滕县、临沂、台儿庄及追击作战，不是台儿庄城内单一战斗的数字。不同史料统计存在差异。'],
      ['记住归来的人，也记住未归的人', '胜利背后，是阵亡将士、救护人员和失去家园的百姓。我们铭记中国人民的不屈，也铭记侵略造成的苦难。让牺牲不被遗忘，让和平不再失去。'],
    ],
    sources: [['新华社综述（中央驻澳联络办转载）', 'https://www.zlb.gov.cn/2015-08/24/c_128159913.htm']],
  },
  nanjing: {
    title: '南京 · 中华门与上新河', date: '1937年12月',
    sections: [
      ['中华门：守军的抵抗', '中华门及邻近雨花台一线，中国守军在装备与兵力劣势下顽强抗击日军，许多将士战死。新华网相关综述记载，仅雨花台守卫将士就有6000余人殉国；这不是中华门单一阵地或全城守军伤亡的统一统计。'],
      ['上新河：未能逃离的生命', '城破后，日军在上新河一带屠杀难民与解除武装的中国士兵。当地遇难同胞丛葬地碑文记载，28730余人在此遭到杀害。这是当地屠杀的碑文记述，不能混作保卫战双方战斗伤亡，也不是南京全城遇难人数。'],
      ['为他们多争得一刻生机', '撤退失序、船只不足，使许多军民陷入绝境。游戏中的掩护与撤离，不改变南京沦陷及日军暴行的历史。记住守军的牺牲，也记住普通人的苦难——他们不只是数字，更是不能被遗忘的生命。'],
    ],
    sources: [
      ['新华社南京保卫战综述', 'https://www.bjwmb.gov.cn/kz2025/jdzy/10104690.html'],
      ['南京党史网：上新河地区丛葬地碑文', 'https://dsb.nanjing.gov.cn/yzyj/201501/t20150104_2083963.html'],
    ],
  },
});

export function createBattleEnding({ onBlack = () => {}, onFinish = () => {} } = {}) {
  let phase = 'idle', result = null, elapsed = 0, lastAt = null, fadeSeconds = 8;
  return {
    start(outcome, now, narrationSeconds = 0) {
      if (!BATTLE_END_STATES.includes(outcome) || !Number.isFinite(now) ||
        !Number.isFinite(narrationSeconds) || narrationSeconds < 0) throw new RangeError('Invalid battle ending');
      if (phase !== 'idle') return false;
      phase = 'fade'; result = outcome; elapsed = 0; lastAt = now;
      fadeSeconds = Math.max(8, narrationSeconds + .3);
      return true;
    },
    update(now, paused = false) {
      if (!Number.isFinite(now) || typeof paused !== 'boolean') throw new RangeError('Invalid ending clock');
      if (lastAt !== null && now < lastAt) throw new RangeError('Ending time must be monotonic');
      const dt = lastAt === null ? 0 : (now - lastAt) / 1000; lastAt = now;
      if (paused || !['fade', 'history'].includes(phase)) return;
      elapsed += dt;
      if (phase === 'fade' && elapsed >= fadeSeconds) {
        phase = 'history'; elapsed = 0; onBlack();
      } else if (phase === 'history' && elapsed >= 20) this.finish();
    },
    finish() {
      if (phase !== 'history' || elapsed < 6) return false;
      phase = 'done'; onFinish(result); return true;
    },
    reset() { phase = 'idle'; result = null; elapsed = 0; lastAt = null; },
    get fading() { return phase === 'fade'; },
    get black() { return phase === 'history'; },
    get complete() { return phase === 'done'; },
    get snapshot() {
      return { phase, result, elapsed, opacity: phase === 'fade' ? Math.min(1, elapsed / fadeSeconds) : phase === 'history' ? 1 : 0,
        pageProgress: phase === 'history' ? Math.min(1, elapsed / 6) : 0,
        canContinue: phase === 'history' && elapsed >= 6 };
    },
  };
}

export async function loadEndingNarration(campaign, outcome = 'victory') {
  if (!BATTLE_END_STATES.includes(outcome)) throw new RangeError('Invalid narration outcome');
  const clip = endingVoiceClips().find(clip => clip.campaign === campaign);
  if (!clip) throw new RangeError('No ending narration for this campaign');
  const file = outcome !== 'victory' && campaign === 'sihang' ? '/assets/audio/sihang-voices/memorial.mp3'
    : outcome === 'victory' || outcome === 'commemoration' ? `/assets/audio/battle-endings/${clip.file}`
    : `/assets/audio/battle-voices/friendly-0-${outcome}-1.mp3`;
  const response = await fetch(file, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Ending narration: HTTP ${response.status}`);
  const Audio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Audio) throw new Error('Ending voice decoding is unavailable');
  const context = new Audio(1, 1, 24000), buffer = await context.decodeAudioData(await response.arrayBuffer());
  if (buffer.numberOfChannels !== 1 || buffer.duration <= .1 || buffer.duration > 30)
    throw new Error('Invalid ending narration buffer');
  return buffer;
}

export function playEndingNarration(context, buffer, output) {
  let source = null, offset = 0, started = 0, finished = false;
  const stopCurrent = () => {
    const previous = source; source = null;
    if (previous) { previous.stop(); previous.disconnect(); }
  };
  const resume = () => {
    if (source || finished) return;
    source = context.createBufferSource(); source.buffer = buffer;
    const current = source; started = context.currentTime;
    source.connect(output); source.start(0, offset);
    source.onended = () => { if (source === current) { source.disconnect(); source = null; finished = true; } };
  };
  resume();
  return {
    pause() { if (source) { offset = Math.min(buffer.duration, offset + context.currentTime - started); stopCurrent(); } },
    resume,
    stop() { stopCurrent(); finished = true; },
  };
}
