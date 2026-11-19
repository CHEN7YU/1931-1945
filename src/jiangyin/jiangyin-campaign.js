// 江阴要塞阻击战 · 大厅资料与入口地址（纯数据，无 DOM，可在 node 测试中导入）。
// 本关不加入 src/campaigns.js 的 CAMPAIGNS 列表：那里的条目会进入 main.js 的步兵战局与现有测试/资源审计；
// 江阴关由 jiangyin-launcher.js 在大厅下拉框中追加一项，选中后以 /?map=jiangyin 进入独立的江阴战局。
export const JIANGYIN_MAP_PARAM = 'map';

export const JIANGYIN_CAMPAIGN = Object.freeze({
  id: 'jiangyin', name: '江阴要塞阻击战', year: 1937, region: '江阴',
  description: '日军舰队自下游逆流而上，企图摧毁江阴要塞。你将随我军舰艇在江面迎敌，并在两岸山头的炮台与阵地上坚持抵抗。',
  history: '1937年8月起，中国海军与江阴要塞两岸炮台在江阴江面构筑封锁线，阻止日军沿长江西进南京，与日军海空力量激战数月。本关为改编战役。',
  historySource: Object.freeze({ name: '维基百科 · 江阴海战', url: 'https://zh.wikipedia.org/zh-cn/江阴海战' }),
  goals: Object.freeze([
    '江面迎敌：舰艇由 AI 航行，你可在任一我军舰艇上操纵舰艏主炮，阻击逆流而上的日军舰队。',
    '守住两岸阵地：日军会从水面、陆路和空中进攻，目标是摧毁我军全部阵地。',
    '战局会随战斗推进而变化，留意江防总指挥部的命令。',
  ]),
});

// 进入江阴战局的地址：保留当前站点路径（兼容子目录部署），去掉主游戏的 campaign 参数。
export function jiangyinUrl(href) {
  const url = new URL(href);
  url.searchParams.delete('campaign');
  url.searchParams.set(JIANGYIN_MAP_PARAM, JIANGYIN_CAMPAIGN.id);
  url.hash = '';
  return url.href;
}

export function isJiangyinRequest(search) {
  return new URLSearchParams(search).get(JIANGYIN_MAP_PARAM) === JIANGYIN_CAMPAIGN.id;
}

// 返回作战大厅：去掉 map 参数，其余（如 resources=low-memory）保留。
export function lobbyUrl(href) {
  const url = new URL(href);
  url.searchParams.delete(JIANGYIN_MAP_PARAM);
  url.hash = '';
  return url.href;
}
