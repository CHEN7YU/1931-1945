// 江阴要塞阻击战 · 大厅资料与入口地址（纯数据，无 DOM，可在 node 测试中导入）。
// 本关不加入 src/campaigns.js 的 CAMPAIGNS 列表：那里的条目会进入 main.js 的步兵战局与现有测试/资源审计；
// 江阴关由 jiangyin-launcher.js 在大厅下拉框中追加一项，选中后以 /?map=jiangyin 进入独立的江阴战局。
export const JIANGYIN_MAP_PARAM = 'map';

export const JIANGYIN_CAMPAIGN = Object.freeze({
  id: 'jiangyin', name: '江阴要塞阻击战', year: 1937, region: '江阴',
  description: '日军舰队自下游逆流而上。第一阶段江面决战：在“平海”“宁海”“逸仙”任一舰上操纵舰艏主炮迎击日舰；三舰沉没后阻塞船自沉封江。第二阶段死守两岸炮台，抵御日军海陆空进攻5分钟。',
  history: '1937年8月起，中国海军在江阴江面以沉船构筑堵塞线，阻止日军沿长江西进南京。9月22日至23日，日军飞机连续轰炸，“平海”“宁海”等舰相继被炸沉；12月初江阴要塞失守。本关将数月战事压缩为一场改编阻击战。',
  historySource: Object.freeze({ name: '维基百科 · 江阴海战', url: 'https://zh.wikipedia.org/zh-cn/江阴海战' }),
  goals: Object.freeze([
    '第一阶段：随舰作战，舰艇由 AI 航行，可在任一我舰复生并操纵舰艏主炮塔。',
    '三舰全部沉没后，下游锚地的阻塞船依次逆流驶向江面最窄处自沉，旗舰“通济”最后沉没、堵住日舰逆流而上的航道。',
    '第二阶段：死守两岸炮台5分钟，或击退全部7个波次；两岸阵地全部失守即失败。',
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
