export const CAMPAIGNS = Object.freeze([
  Object.freeze({ id: 'taierzhuang-streets', name: '台儿庄 · 街巷争夺', year: 1938, region: '鲁南', hidden: true,
    x: 76, y: 51, description: '沿运河街巷争夺路口、石桥与街垒。' }),
  Object.freeze({ id: 'taierzhuang-fort', name: '台儿庄 · 城寨攻防', year: 1938, region: '鲁南',
    x: 76, y: 51, description: '城寨合围战：争夺粮栈高楼、运河桥与东侧城门。开局4队，占点增援2队并解锁永久敌后重生点，关闭最近2处日军地面重生点；三点合围后停止日军重生，全歼残敌（含飞机）获胜。' }),
  Object.freeze({ id: 'shanghai', name: '淞沪会战', year: 1937, region: '上海', locked: true,
    x: 85, y: 61, description: '战场设计待提交，当前不可进入。' }),
  Object.freeze({ id: 'nanjing', name: '南京保卫战', year: 1937, region: '南京', locked: true,
    x: 81, y: 58, description: '战场设计待提交，当前不可进入。' }),
]);

export const SELECTABLE_CAMPAIGNS = Object.freeze(CAMPAIGNS.filter(campaign => !campaign.hidden));
export const DEFAULT_CAMPAIGN = SELECTABLE_CAMPAIGNS.find(campaign => !campaign.locked);

export function campaignById(id) {
  const campaign = CAMPAIGNS.find(item => item.id === id);
  if (!campaign) throw new RangeError(`Unknown campaign: ${id}`);
  return campaign;
}
