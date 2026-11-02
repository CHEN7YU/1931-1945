export const BATTLE_VOICE_PROFILES = Object.freeze({
  friendly: [
    { voice: 'zh-CN-YunjianNeural', locale: 'zh-CN', style: 'angry', rate: '+12%', pitch: '-2%' },
    { voice: 'zh-CN-YunxiNeural', locale: 'zh-CN', style: 'angry', rate: '+16%', pitch: '+2%' },
    { voice: 'zh-CN-YunfengNeural', locale: 'zh-CN', style: 'angry', rate: '+10%', pitch: '-4%' },
  ],
  enemy: [
    { voice: 'ja-JP-KeitaNeural', locale: 'ja-JP', style: null, rate: '+12%', pitch: '-3%' },
    { voice: 'ja-JP-DaichiNeural', locale: 'ja-JP', style: null, rate: '+16%', pitch: '+2%' },
    { voice: 'ja-JP-NaokiNeural', locale: 'ja-JP', style: null, rate: '+10%', pitch: '-5%' },
  ],
});

export const BATTLE_VOICE_LINES = Object.freeze({
  friendly: [
    ...['一', '二', '三', '四', '五', '六', '七'].flatMap((minutes, index) => [
      { id: `nanjing-gate-${index + 1}`, cue: `nanjing-gate-${index + 1}`,
        text: `弟兄们，我们还要在这里坚守${minutes}分钟，给百姓撤退争取时间！` },
      { id: `nanjing-dock-${index + 1}`, cue: `nanjing-dock-${index + 1}`,
        text: `守住渡口！还要坚守${minutes}分钟，掩护百姓渡江！` },
    ]),
    { id: 'nanjing-withdrawal', cue: 'nanjing-withdrawal', text: '我们撤退到渡口，掩护百姓渡江！' },
    { id: 'advance-1', cue: 'advance', text: '冲啊！跟我上！' },
    { id: 'advance-2', cue: 'advance', text: '弟兄们，向前推进！' },
    { id: 'advance-3', cue: 'advance', text: '跟紧队伍，别掉队！' },
    { id: 'advance-4', cue: 'advance', text: '杀鬼子啊！弟兄们，冲！' },
    { id: 'advance-5', cue: 'advance', text: '中国人不是亡国奴！冲啊！' },
    { id: 'advance-6', cue: 'advance', text: '保家卫国！跟我冲！' },
    { id: 'advance-7', cue: 'advance', text: '弟兄们，守住我们的家园！' },
    { id: 'contact-1', cue: 'contact', text: '发现敌人！准备射击！' },
    { id: 'contact-2', cue: 'contact', text: '敌人在前面！小心！' },
    { id: 'contact-3', cue: 'contact', text: '瞄准了打！' },
    { id: 'cover-1', cue: 'cover', text: '找掩护！压低身子！' },
    { id: 'cover-2', cue: 'cover', text: '掩护我！别让他们靠近！' },
    { id: 'reload-1', cue: 'reload', text: '我装子弹！掩护一下！' },
    { id: 'reload-2', cue: 'reload', text: '换弹！帮我盯住前面！' },
    { id: 'grenade-1', cue: 'grenade', text: '手榴弹！快躲开！' },
    { id: 'grenade-2', cue: 'grenade', text: '小心手榴弹！散开！' },
    { id: 'order-advance-1', cue: 'order-advance', text: '全班注意！向目标前进！' },
    { id: 'order-advance-2', cue: 'order-advance', text: '弟兄们，拿下前面的阵地！' },
    { id: 'order-advance-3', cue: 'order-advance', text: '中国人不是亡国奴！拿下阵地！' },
    { id: 'order-advance-4', cue: 'order-advance', text: '杀鬼子啊！全班跟我上！' },
    { id: 'order-hold-1', cue: 'order-hold', text: '向标记位置移动！就地防守！' },
    { id: 'order-follow-1', cue: 'order-follow', text: '取消命令！都跟我来！' },
    { id: 'deploy-1', cue: 'deploy', text: '全队准备！出发！' },
    { id: 'capturing-1', cue: 'capturing', text: '正在占领阵地！守住这里！' },
    { id: 'contested-1', cue: 'contested', text: '敌人进了阵地！把他们赶出去！' },
    { id: 'setback-1', cue: 'setback', text: '进攻受挫！重新组织，继续进攻！' },
    { id: 'captured-1', cue: 'captured', text: '阵地拿下了！弟兄们，继续前进！' },
    { id: 'rally-lost-1', cue: 'rally-lost', text: '我方集结点被毁！寻找其他出发位置！' },
    { id: 'victory-1', cue: 'victory', text: '作战胜利！弟兄们，守住阵地！' },
    { id: 'defeat-1', cue: 'defeat', text: '作战失利！重整队伍，准备再战！' },
    { id: 'draw-1', cue: 'draw', text: '时间到了！双方未分胜负，重整队伍！' },
    { id: 'lost-1', cue: 'lost', text: '阵地失去控制！重新集结，准备夺回！' },
    { id: 'supply-brief-1', cue: 'supply-brief', text: '拿下A点高楼，就能切断日军补给！' },
    { id: 'supply-cut-1', cue: 'supply-cut', text: '日军补给切断了！守住高楼，拖住敌人！' },
    { id: 'supply-restored-1', cue: 'supply-restored', text: '日军夺回了补给点！弟兄们，把高楼抢回来！' },
    { id: 'reinforcements-1', cue: 'reinforcements', text: '我们的援军到了！弟兄们，继续进攻！' },
    { id: 'supply-reinforced-1', cue: 'supply-reinforced', text: '敌军补给已断，我们的援军也到了！' },
    { id: 'encircled-1', cue: 'encircled', text: '敌军被我们包围了！消灭地面残敌！' },
    { id: 'reinforcements-blocked-1', cue: 'reinforcements-blocked', text: '敌军援军被拦截了！别让残敌跑了！' },
    { id: 'cleanup-orders-1', cue: 'cleanup-orders', text: '敌人援军被切断，全歼被围日军，我们就赢了！' },
    ...['十二', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一'].flatMap((hour, index) =>
      [
        { role: 'sniper', label: '狙击手' },
        { role: 'machine-gunner', label: '机枪手' },
        { role: 'tank', label: '坦克' },
      ].map(({ role, label }) => ({
        id: `callout-${role}-${index || 12}`,
        cue: `callout-${role}-${index || 12}`,
        text: role === 'tank' && index === 0 ? '前方发现敌军坦克！' : `${hour}点钟方向，敌方${label}！`,
      }))),
  ],
  enemy: [
    { id: 'advance-1', cue: 'advance', text: '突撃！前へ！', translation: '冲锋！向前！' },
    { id: 'advance-2', cue: 'advance', text: '進め！ついてこい！', translation: '前进！跟上来！' },
    { id: 'advance-3', cue: 'advance', text: '隊列を崩すな！前進！', translation: '保持队形！前进！' },
    { id: 'contact-1', cue: 'contact', text: '敵を発見！射撃準備！', translation: '发现敌人！准备射击！' },
    { id: 'contact-2', cue: 'contact', text: '前方に敵！気をつけろ！', translation: '前方有敌人！小心！' },
    { id: 'contact-3', cue: 'contact', text: 'よく狙え！撃て！', translation: '瞄准！开火！' },
    { id: 'cover-1', cue: 'cover', text: '身を隠せ！頭を下げろ！', translation: '找掩护！低头！' },
    { id: 'cover-2', cue: 'cover', text: '援護しろ！近づけるな！', translation: '掩护！别让他们靠近！' },
    { id: 'reload-1', cue: 'reload', text: '弾を込める！援護しろ！', translation: '装填！掩护我！' },
    { id: 'reload-2', cue: 'reload', text: '装填中！前を見ていろ！', translation: '正在装填！盯住前面！' },
    { id: 'grenade-1', cue: 'grenade', text: '手榴弾だ！伏せろ！', translation: '手榴弹！卧倒！' },
    { id: 'grenade-2', cue: 'grenade', text: '手榴弾！離れろ！', translation: '手榴弹！散开！' },
    { id: 'order-advance-1', cue: 'order-advance', text: '目標に向かって進め！', translation: '向目标前进！' },
    { id: 'order-advance-2', cue: 'order-advance', text: '前方の陣地を確保しろ！', translation: '占领前方阵地！' },
    { id: 'order-hold-1', cue: 'order-hold', text: '指定の位置へ！そこで守れ！', translation: '到指定位置！守住那里！' },
    { id: 'order-follow-1', cue: 'order-follow', text: '命令を取り消す！ついてこい！', translation: '取消命令！跟上来！' },
    { id: 'deploy-1', cue: 'deploy', text: '全員、準備！出発！', translation: '全队准备！出发！' },
    { id: 'capturing-1', cue: 'capturing', text: '敵が陣地を占領中だ！阻止しろ！', translation: '敌人正在占领阵地！阻止他们！' },
    { id: 'contested-1', cue: 'contested', text: '陣地で交戦中！持ちこたえろ！', translation: '阵地正在交战！坚持住！' },
    { id: 'setback-1', cue: 'setback', text: '敵の攻撃を押し返した！警戒を続けろ！', translation: '击退敌人的进攻了！继续警戒！' },
    { id: 'captured-1', cue: 'captured', text: '陣地を失った！次の防衛線へ！', translation: '阵地失守！到下一道防线！' },
    { id: 'rally-lost-1', cue: 'rally-lost', text: '集合地点が破壊された！', translation: '集结点被摧毁了！' },
    { id: 'victory-1', cue: 'victory', text: '防衛に成功した！警戒を続けろ！', translation: '防守成功！继续警戒！' },
    { id: 'defeat-1', cue: 'defeat', text: '防衛線が突破された！後退しろ！', translation: '防线被突破！后退！' },
    { id: 'draw-1', cue: 'draw', text: '時間切れだ！勝負はついていない！', translation: '时间到了！胜负未分！' },
    { id: 'lost-1', cue: 'lost', text: '陣地を確保した！警戒を続けろ！', translation: '占领阵地了！继续警戒！' },
  ],
});

export const CHINESE_CHARGE_DELIVERIES = Object.freeze([
  { variant: 0, speaker: 'yunjian', ahStartSample: 6643, ahEndSample: 11732,
    sourceSynthesisHash: '6f7029b366f542ede911aef8773f58a79632afe667ec45e5ffafb9321ea9a88c',
    shortHash: 'dbab7d6e1a2936498d07ec952fe1e9c058cdac5533341366dd6d1d518c407b52',
    longHash: '64f43dd260254f6925b7cc2da25f3174fff0a234d73c69455f42e311dd8270ac' },
  { variant: 2, speaker: 'yunfeng', ahStartSample: 7688, ahEndSample: 12777,
    sourceSynthesisHash: 'dc00f1d0d3967dfec37334a2d09dca7a9ebfac34a42d1ba8fc089e10dc1d46d3',
    shortHash: '63f779b22be5155929a318f0f8dc6ab269f4ebdd94366fa49cb32393efadd340',
    longHash: '4e0df56f15536957a3f0847c701550d9ab64f2fdb1fe533f71158cf3db6efe66' },
].flatMap(source => ['short', 'long'].map(take => ({
  variant: source.variant, take, selectionWeight: take === 'short' ? 3 : 1,
  sourceFile: `${source.speaker}-advance-1-ah-${take}.wav`,
  sha256: take === 'short' ? source.shortHash : source.longHash,
  sourceSynthesisHash: source.sourceSynthesisHash,
  ahStartSample: source.ahStartSample, ahEndSample: source.ahEndSample,
  originalAhDuration: (source.ahEndSample - source.ahStartSample) / 24000,
  targetAhDuration: take === 'short' ? .4 : .7,
  ahDuration: take === 'short' ? .4 : 16793 / 24000,
}))));

export function battleVoiceClips() {
  return Object.entries(BATTLE_VOICE_LINES).flatMap(([team, lines]) =>
    BATTLE_VOICE_PROFILES[team].flatMap((profile, variant) => lines.flatMap(line => {
      const clip = { ...line, ...profile, team, variant, file: `${team}-${variant}-${line.id}.mp3` };
      const deliveries = team === 'friendly' && line.id === 'advance-1'
        ? CHINESE_CHARGE_DELIVERIES.filter(delivery => delivery.variant === variant) : [];
      return deliveries.length ? deliveries.map(delivery => ({
        ...clip, rate: '+12%', pitch: '+2%', styledegree: '1.8', pauseMs: 80,
        selectionWeight: delivery.selectionWeight, delivery,
        file: `${team}-${variant}-${line.id}${delivery.take === 'long' ? '-long' : ''}.wav`,
      })) : [clip];
    })));
}
