const profiles = {
  woman: { voice: 'zh-CN-XiaoxiaoNeural', gender: 'Female', age: 'adult', presentation: 'woman', style: 'fearful', rate: '+4%', pitch: '-2%' },
  man: { voice: 'zh-CN-YunjianNeural', gender: 'Male', age: 'adult', presentation: 'man', style: 'sad', rate: '+6%', pitch: '-3%' },
  grandmother: { voice: 'zh-CN-XiaomoNeural', gender: 'Female', age: 'elderly', presentation: 'woman', role: 'SeniorFemale', style: 'sad', rate: '-8%', pitch: '-3%' },
  grandfather: { voice: 'zh-CN-YunzeNeural', gender: 'Male', age: 'elderly', presentation: 'man', role: 'SeniorMale', style: 'sad', rate: '-7%', pitch: '-2%' },
  girl: { voice: 'zh-CN-XiaomoNeural', gender: 'Female', age: 'child', presentation: 'woman', role: 'Girl', style: 'fearful', rate: '+3%', pitch: '+2%' },
  boy: { voice: 'zh-CN-YunjianNeural', gender: 'Male', age: 'child', presentation: 'man', style: 'sad', rate: '+4%', pitch: '+2%' },
};

const dialogue = {
  woman: [
    ['dock', '船什么时候来？我们已经等了好久了。'],
    ['both', '谁看到了我的孩子？他穿着一件蓝布袄！'],
    ['both', '孩子，拉紧我的手，千万别松开！'],
    ['city', '鬼子打进来了！快往江边跑！'],
    ['city', '娘，别回头了，房子不要了！'],
    ['dock', '能不能先让孩子上去？我求求你们了。'],
    ['dock', '这条船还坐得下吗？我们只有两个人。'],
    ['both', '你爹还没回来，我不能把他丢下啊。'],
    ['dock', '那是我们的船吗？求求你，靠岸啊！'],
    ['city', '箱子扔了吧，抱着孩子走！'],
    ['both', '有人见过一个白头发的老太太吗？那是我娘！'],
    ['dock', '别挤孩子，他快喘不过气了！'],
    ['dock', '过了江，就能活下来了，对不对？'],
    ['both', '我家里的人还在后面，能不能再等等？'],
    ['city', '这边的巷子还能走，快跟上！'],
    ['dock', '孩子别哭，娘在这里，娘在这里。'],
  ],
  man: [
    ['city', '别走散了！沿着这条路去渡口！'],
    ['dock', '船上还有空位！先扶老人过去！'],
    ['city', '城门那边全是枪声，不能回去了！'],
    ['both', '谁有水？给这孩子喝一口吧。'],
    ['dock', '我会划船，让我上去帮忙！'],
    ['city', '爹，靠着我，我背您走。'],
    ['dock', '再来一条船啊！这里还有这么多人！'],
    ['both', '有人看见我家姑娘了吗？她才这么高！'],
    ['city', '别停在路中间！后头还有人！'],
    ['dock', '别推了！再推就掉进江里了！'],
    ['both', '都跟着家里人，千万别松手。'],
    ['city', '那边起火了！从这条巷子绕过去！'],
    ['dock', '这船太小了……后面的人怎么办？'],
    ['dock', '慢一点，把老人扶稳！'],
    ['both', '屋子没了，人活着就好，快走吧。'],
    ['dock', '长官，后面还有百姓，求你们再守一会儿！'],
  ],
  grandmother: [
    ['both', '我走不动了……你们带着孩子先走。'],
    ['city', '别管那包衣裳了，快去找你妹妹！'],
    ['dock', '这么冷的江水，可千万别掉下去。'],
    ['both', '我的孙儿呢？刚才还在我身边啊！'],
    ['dock', '求求你们，让这个小的先上船吧。'],
    ['city', '我们一家人，不能在这儿走散啊。'],
    ['dock', '那边有人叫我吗？是不是我儿子？'],
    ['both', '好孩子，别怕，奶奶还在。'],
    ['dock', '船还会回来吧？可别把我们落下了。'],
    ['city', '我这一辈子都住在这里……快走，别回头了。'],
    ['both', '谁来扶我一把？我看不清路了。'],
    ['dock', '再等一等，我家老头子还没有来。'],
  ],
  grandfather: [
    ['city', '别走那边，前头的路堵住了。'],
    ['both', '我还能走，先扶那个孩子。'],
    ['dock', '这江上的船，怎么还不靠岸啊？'],
    ['city', '家里的门，不用再锁了……走吧。'],
    ['both', '孩子，你叫什么？你家大人呢？'],
    ['dock', '我年轻时撑过船，让我帮着划。'],
    ['dock', '让一让，别把老人挤倒了。'],
    ['both', '一家人平平安安，比什么都强。'],
    ['city', '扶着墙慢慢走，别摔下去了。'],
    ['dock', '他们还会来接我们吗？'],
    ['both', '有人看见我老伴了吗？她腿脚不好。'],
    ['dock', '我不上这条，先让那一家人走吧。'],
  ],
  girl: [
    ['both', '妈妈！妈妈！你在哪里？'],
    ['both', '娘！别丢下我！'],
    ['city', '我害怕，我想回家……'],
    ['dock', '我们什么时候能上船啊？'],
    ['both', '哥哥！等等我！'],
    ['dock', '妈妈，那条船会沉吗？'],
    ['city', '爹爹还在家里，我们不等他了吗？'],
    ['both', '奶奶，我拉着你，你别走丢了。'],
    ['dock', '船走了……它还回来吗？'],
    ['both', '有没有人看见我娘？'],
    ['city', '不要开枪！我害怕！'],
    ['dock', '娘，我冷……我想抱一抱。'],
  ],
  boy: [
    ['both', '妈妈！妈妈！你在哪里呀！'],
    ['city', '爹！我找不到我妹妹了！'],
    ['dock', '别推我！我要掉下去了！'],
    ['both', '姐姐，你抓住我！'],
    ['city', '他们打过来了！快跑啊！'],
    ['dock', '能不能也带上我奶奶？'],
    ['both', '我不要一个人走！'],
    ['dock', '娘，江那边还有枪声吗？'],
    ['city', '我跑不动了，等等我……'],
    ['both', '爹爹！你听见我了吗！'],
    ['dock', '叔叔，我们还要等多久？'],
    ['city', '家里着火了……我们以后住哪里？'],
  ],
};

const openingDialogue = {
  woman: [
    '不要杀我！我抱着孩子！', '日本人来啦！快进城！',
    '别开枪！这里有孩子！', '孩子，低下头，跟紧娘！',
    '让一让！我娘走不动了！', '不要回头！快过桥！',
    '求求你们，别关城门！', '我什么都不要了，让我们过去吧！',
  ],
  man: [
    '后面有人开枪！快往城门跑！', '长官！救救后面的人！',
    '别挤！桥上别挤！', '把箱子扔了！先把孩子抱过去！',
    '老人走里边！都扶着点！', '日本人追上来了！快跑！',
    '别开枪！我们都是老百姓！', '爹，抓紧我，前头就是城门！',
  ],
  grandmother: [
    '求求你，别杀我们……', '慢一点，别让孩子掉下桥！',
    '城门还开着吗？让我们进去吧！', '我走不快，你们先走，别管我！',
    '囡囡，奶奶在这里！', '谁来扶我一把？后面还在打枪啊！',
  ],
  grandfather: [
    '别停在桥上！往前走！', '我不挡着你们，别开枪！',
    '先扶孩子进去！快！', '老婆子，前头就到城门了！',
    '我这条腿啊……谁能拉我一把？', '还没进去的，跟着前头的人！',
  ],
  girl: [
    '妈妈！别丢下我！', '不要杀我！我要找我娘！',
    '娘，后面有人打枪！', '奶奶！我拉着你走！',
    '我害怕！让我们进去吧！', '爹！等等我！别走那么快！',
  ],
  boy: [
    '日本人来啦！快跑！', '妈妈！妈妈！你在哪里！',
    '不要开枪！不要开枪！', '姐姐，抓住我的手！',
    '叔叔，救救我爷爷！', '别关门！我们还在外面！',
  ],
};

const openingSoldiers = [
  '让老百姓先进城！', '不要误伤百姓！看清目标再打！',
  '小鬼子居然用百姓当掩护！', '敌人混在百姓后面，瞄准了再开枪！',
  '别堵着城门！给百姓让条路！', '桥上还有人！掩护他们过来！',
];

export function civilianVoiceClips() {
  const encounter = [
    ['woman', '日本人来了，快跑啊！'],
    ['man', '当兵的也跑了，我们往哪里跑啊？'],
    ['grandmother', '听说渡口有船，可以离开南京，是真的吗？'],
  ].map(([profile, text], encounterOrder) => ({
    ...profiles[profile], locale: 'zh-CN', styledegree: '1.6', volume: 'loud', phase: 'retreat',
    speakerKind: 'civilian', zone: 'city', encounterOrder,
    id: `withdrawal-encounter-${encounterOrder + 1}`, file: `withdrawal-encounter-${encounterOrder + 1}.mp3`, text,
  }));
  const retreat = Object.entries(dialogue).flatMap(([profile, lines]) => lines.map(([zone, text], index) => ({
    ...profiles[profile], locale: 'zh-CN', styledegree: '1.4', volume: 'medium',
    phase: 'retreat', speakerKind: 'civilian',
    id: `${profile}-${index + 1}`, file: `${profile}-${index + 1}.mp3`, zone, text,
  })));
  const opening = Object.entries(openingDialogue).flatMap(([profile, lines]) => lines.map((text, index) => ({
    ...profiles[profile], locale: 'zh-CN', styledegree: '1.4', volume: 'medium',
    phase: 'opening', speakerKind: 'civilian', zone: 'gate',
    id: `opening-${profile}-${index + 1}`, file: `opening-${profile}-${index + 1}.mp3`, text,
  })));
  const soldiers = ['zh-CN-YunjianNeural', 'zh-CN-YunfengNeural'].flatMap((voice, voiceIndex) =>
    openingSoldiers.map((text, index) => ({
      voice, variant: voiceIndex, locale: 'zh-CN', gender: 'Male', style: 'serious', rate: '+5%', pitch: '-2%', volume: 'loud',
      age: 'adult', presentation: 'man', phase: 'opening', speakerKind: 'soldier', zone: 'gate',
      cue: index === 2 || index === 3 ? 'shield' : 'protect',
      id: `opening-soldier-${voiceIndex}-${index + 1}`, file: `opening-soldier-${voiceIndex}-${index + 1}.mp3`, text,
    })));
  const urgentCalls=new Set(['girl-1','girl-2','boy-1','boy-2','opening-girl-1','opening-boy-1']);
  return [...retreat, ...opening, ...soldiers, ...encounter].map(clip => {
    if (!urgentCalls.has(clip.id)) return clip;
    const usesYunjian = clip.voice === 'zh-CN-YunjianNeural';
    return {
      ...clip,
      style: usesYunjian ? 'sad' : 'fearful',
      styledegree: '2',
      rate: '+16%',
      volume: 'loud',
      pauseMs: 110,
      audioRevision: usesYunjian ? 'sad-2' : 'fearful-2',
    };
  });
}
