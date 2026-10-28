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
    { id: 'advance-1', cue: 'advance', text: '冲啊！跟我上！' },
    { id: 'advance-2', cue: 'advance', text: '弟兄们，向前推进！' },
    { id: 'advance-3', cue: 'advance', text: '跟紧队伍，别掉队！' },
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

export function battleVoiceClips() {
  return Object.entries(BATTLE_VOICE_LINES).flatMap(([team, lines]) =>
    BATTLE_VOICE_PROFILES[team].flatMap((profile, variant) => lines.map(line => ({
      ...line, ...profile, team, variant,
      file: `${team}-${variant}-${line.id}.mp3`,
    }))));
}
