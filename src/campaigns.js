import previews from '../public/assets/campaign-previews/source.json' with { type: 'json' };
import { SIHANG_PREVIEW } from './sihang-preview.js';

function campaignPreview(id) {
  const record = previews.files.find(file => file.campaign === id);
  if (!record) throw new Error(`Missing campaign preview: ${id}`);
  return Object.freeze({ src: `/assets/campaign-previews/${record.file}?v=${record.sha256.slice(0, 12)}`, alt: record.alt });
}

export const CAMPAIGNS = Object.freeze([
  Object.freeze({ id: 'taierzhuang-streets', name: '台儿庄 · 街巷争夺', year: 1938, region: '鲁南', hidden: true,
    x: 76, y: 51, description: '沿运河街巷争夺路口、石桥与街垒。' }),
  Object.freeze({ id: 'taierzhuang-fort', name: '血战台儿庄', year: 1938, region: '鲁南',
    preview: campaignPreview('taierzhuang-fort'),
    x: 76, y: 51, description: '进入粮栈高楼夺取补给点，接应外线援军，完成城寨合围。',
    history: '1938年春，国军在鲁南台儿庄与日军激战，这是徐州会战的重要组成部分。守军依托城镇与运河防御，展开逐街逐屋争夺，最终取得台儿庄大捷。',
    historySource: Object.freeze({ name: '新华网／人民网 · 台儿庄战役',
      url: 'https://cpc.people.com.cn/n1/2018/1219/c421684-30476925.html' }),
    goals: Object.freeze(['进入A点粮栈夺取补给点，再合围A/B/C三点。',
      '合围后在C点布防20秒，阻击日军从东门突围。',
      '目标歼灭至少2/3、逃脱不超过1/3；全部地面残敌解决后结算。']) }),
  Object.freeze({ id: 'shanghai', name: '淞沪会战', year: 1937, region: '上海', locked: true,
    x: 85, y: 61, description: '战场设计待提交，当前不可进入。' }),
  Object.freeze({ id: 'sihang', name: '上海四行仓库', year: 1937, region: '上海',
    preview: SIHANG_PREVIEW, x: 86, y: 62,
    description: '坚守四行仓库四分钟，掩护友军经桥梁退往苏州河南岸租界。',
    history: '1937年淞沪会战后期，第88师第262旅第524团一部坚守四行仓库，掩护主力撤退。游戏采用三层仓库、东侧桥梁与限时撤退的改编布局。',
    historySource: Object.freeze({ name: '南京大屠杀遇难同胞纪念馆 · 第88师史料',
      url: 'https://www.19371213.com.cn/information/news/202112/t20211209_3226524.html' }),
    goals: Object.freeze(['坚守仓库一楼4分钟，阻止日军占领与北墙爆破。',
      '全军累计400人（含开局44人）；撤退命令下达后不再补充。',
      '5分钟内掩护AI友军过桥；其他友军撤离或阵亡后，操纵本队幸存士兵抵达南岸。']) }),
  Object.freeze({ id: 'nanjing', name: '南京保卫战', year: 1937, region: '南京',
    preview: campaignPreview('nanjing'),
    x: 81, y: 58, description: '坚守中华门，沿陆路撤往上新河渡口，掩护百姓渡江后登船撤离。',
    history: '1937年12月，中国守军在南京城郊与城垣一线抵抗日军，中华门等处战斗激烈。12月13日南京沦陷，城内平民与放下武器的军人随后遭到日军大规模屠杀。',
    historySource: Object.freeze({ name: '南京大屠杀遇难同胞纪念馆 · 南京保卫战史料',
      url: 'https://www.19371213.com.cn/research/yjda/202012/t20201209_2746867.html' }),
    goals: Object.freeze(['守住中华门第二道门内左侧阵地，日军独占20秒将导致失守。',
      '收到撤退命令后前往上新河渡口，掩护百姓登船过江。',
      '掩护百姓与友军撤退，带领本队登船撤离南京。']) }),
]);

export const SELECTABLE_CAMPAIGNS = Object.freeze(CAMPAIGNS.filter(campaign => !campaign.hidden));
export const DEFAULT_CAMPAIGN = SELECTABLE_CAMPAIGNS.find(campaign => !campaign.locked);

export function campaignById(id) {
  const campaign = CAMPAIGNS.find(item => item.id === id);
  if (!campaign) throw new RangeError(`Unknown campaign: ${id}`);
  return campaign;
}
