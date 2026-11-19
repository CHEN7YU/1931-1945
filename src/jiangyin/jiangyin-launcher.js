// 江阴要塞阻击战 · 大厅接入。只需在 src/entry.js 第一行加入：
//   import './jiangyin/jiangyin-launcher.js';
// 本模块不改动 entry.js 的逻辑，而是：
//   1) 在大厅“选择战役”下拉框末尾追加“江阴要塞阻击战 / 1937”；
//   2) 选中时显示本关简介、史实与目标（拦截 change 事件，避免 campaignById('jiangyin') 抛错）；
//   3) 点击“确认战役”时直接进入江阴战局（/?map=jiangyin），不进入 main.js 的小队部署；
//   4) 地址带 ?map=jiangyin 时隐藏大厅并加载江阴战局。
// 事件在 document 捕获阶段处理并阻止继续传播，所以 entry.js 的原有监听器只在选中其他战役时运行。
import { JIANGYIN_CAMPAIGN, jiangyinUrl, isJiangyinRequest } from './jiangyin-campaign.js';
import { getMenuMusic } from '../menu-music.js';

const selected = () => document.getElementById('campaign-choice')?.value === JIANGYIN_CAMPAIGN.id;

function enterJiangyin() {
  getMenuMusic().prepareNavigation();
  location.assign(jiangyinUrl(location.href));
}

function showBriefing() {
  const description = document.getElementById('campaign-description');
  if (description) { description.textContent = JIANGYIN_CAMPAIGN.description; description.hidden = false; }
  const history = document.getElementById('campaign-history');
  if (history) history.textContent = JIANGYIN_CAMPAIGN.history;
  const goals = document.getElementById('campaign-goals');
  if (goals) goals.replaceChildren(...JIANGYIN_CAMPAIGN.goals.map(goal => {
    const item = document.createElement('li'); item.textContent = goal; return item;
  }));
}

document.addEventListener('change', event => {
  if (event.target?.id !== 'campaign-choice' || !selected()) return;
  event.stopImmediatePropagation();
  showBriefing();
}, true);

document.addEventListener('click', event => {
  if (!selected() || !(event.target instanceof Element) || !event.target.closest('#confirm-campaign')) return;
  event.stopImmediatePropagation(); event.preventDefault();
  enterJiangyin();
}, true);

// entry.js 在模块求值时同步填充下拉框；宏任务中追加本关，保证排在原有战役之后。
setTimeout(() => {
  const selector = document.getElementById('campaign-choice');
  if (selector && ![...selector.options].some(option => option.value === JIANGYIN_CAMPAIGN.id)) {
    const option = document.createElement('option');
    option.value = JIANGYIN_CAMPAIGN.id;
    option.textContent = `${JIANGYIN_CAMPAIGN.name} / ${JIANGYIN_CAMPAIGN.year}`;
    selector.append(option);
  }
  if (!isJiangyinRequest(location.search)) return;
  for (const id of ['menu', 'overlay']) { const element = document.getElementById(id); if (element) element.hidden = true; }
  const loading = document.getElementById('loading');
  if (loading) {
    loading.hidden = false;
    const text = loading.querySelector('p'); if (text) text.textContent = '正在加载江阴要塞阻击战…';
  }
  getMenuMusic().setState('loading');
  import('./jiangyin-main.js').catch(error => {
    console.error('Jiangyin loading failed', error);
    const text = document.querySelector('#loading p, #jy-text');
    if (text) text.textContent = `加载失败：${error.message}。刷新后重试。`;
  });
}, 0);
