import './nanjing-preview.css';
import './nanjing-first-person.js';

const phases = {
  defense: {
    title: '第一阶段 · 守中华门',
    time: '坚守 03:00',
    stamp: 'DEFENSE',
    description: '我方3队据守瓮城阵地。南面日军进攻，城内百姓从玩家视野之外分散汇向西侧。',
    rule: '计时结束后停止新增日军，现存敌军仍会推进；穿过水西门或附近破口后触发第二阶段。',
    forces: [
      ['我方', '3队：玩家小队 + 2支友军小队，依托中华门与瓮城防守。'],
      ['日军', '10个单位：8支步兵队、1辆坦克、1架飞机；从南面施压。'],
      ['百姓', '由多个街区分散汇流；不在玩家视野内突然出现。'],
    ],
    civilians: ['—', '—', '—'],
    note: '箭头是设计地图中的路线提示，不表示角色会在玩家镜头内刷出。',
  },
  withdrawal: {
    title: '转场 · 边打边撤',
    time: '沿路撤退 · 无固定倒计时',
    stamp: 'WITHDRAWAL',
    description: '3分钟守城结束后，我军离开中华门向渡口撤退。日军不再增援，但现存敌军继续推进。',
    rule: '玩家穿过水西门或附近破口后激活第二阶段；本段仍有交火，不是安全传送。',
    forces: [
      ['我方', '原有3队沿城内路线撤向西侧渡口。'],
      ['日军', '停止新增援，沿战场持续逼近；撤离途中仍可能被全歼。'],
      ['百姓', '从视野外沿不同街区来路逐步汇向西岸。'],
    ],
    civilians: ['—', '—', '—'],
    note: '友军位置、敌军推进和人群标记均为流程示意，不代表实际行军速度。',
  },
  ferry: {
    title: '第二阶段 · 渡口总攻',
    time: '坚守 03:00',
    stamp: 'RIVER CROSSING',
    description: '玩家出城后任务切换。我方共5队（原有3队 + 2支增援），守住渡口并掩护百姓登船。',
    rule: '日军现存兵力分北、东、南三路进攻；友军小队先撤，玩家最后登船。',
    forces: [
      ['我方', '5队：原有3队 + 2支增援小队；渡口失守时撤离路线被切断。'],
      ['日军', '10队按北、东、南三路压向渡口；编成与来路仍可调整。'],
      ['船只', '5艘木船，每艘载满10人启航并往返接驳。'],
    ],
    civilians: ['86', '42', '8'],
    note: '样例统计：累计136人抵达 = 86人已登船 + 42人等候 + 8人伤亡。登船与伤亡分开计数。',
  },
};

const map = document.querySelector('#battle-map');
const buttons = [...document.querySelectorAll('[data-phase-button]')];
const title = document.querySelector('#phase-title');
const description = document.querySelector('#phase-description');
const time = document.querySelector('#phase-time');
const rule = document.querySelector('#phase-rule');
const stamp = document.querySelector('#phase-stamp');
const forceSummary = document.querySelector('#force-summary');
const boarded = document.querySelector('#boarded-count');
const waiting = document.querySelector('#waiting-count');
const casualty = document.querySelector('#casualty-count');
const civilianNote = document.querySelector('#civilian-note');
const civilianMessage = document.querySelector('#civilian-message');
const liveStatus = document.querySelector('#live-status');
const playButton = document.querySelector('#play-flow');
const phaseOrder = Object.keys(phases);
let currentPhase = 'defense';
let playbackTimer;

function renderPhase(id) {
  const phase = phases[id];
  if (!phase) throw new Error(`Unknown Nanjing preview phase: ${id}`);
  currentPhase = id;
  map.dataset.phase = id;
  title.textContent = phase.title;
  description.textContent = phase.description;
  time.textContent = phase.time;
  rule.textContent = phase.rule;
  stamp.textContent = phase.stamp;
  forceSummary.replaceChildren(...phase.forces.map(([label, detail]) => {
    const line = document.createElement('div');
    line.className = 'force-line';
    const name = document.createElement('b');
    name.textContent = label;
    const value = document.createElement('span');
    value.textContent = detail;
    line.append(name, value);
    return line;
  }));
  [boarded, waiting, casualty].forEach((node, index) => {
    node.textContent = phase.civilians[index];
  });
  civilianNote.textContent = phase.note;
  civilianMessage.hidden = id !== 'ferry';
  civilianMessage.textContent = id === 'ferry'
    ? '你已经成功掩护 136 名百姓到达上新河渡口，其中 86 名已撤离南京，免于日军屠刀。'
    : '';
  liveStatus.textContent = phase.title;
  for (const button of buttons) {
    const active = button.dataset.phaseButton === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function stopPlayback() {
  clearInterval(playbackTimer);
  playbackTimer = undefined;
  playButton.textContent = '▶ 顺序演示';
  playButton.setAttribute('aria-pressed', 'false');
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    stopPlayback();
    renderPhase(button.dataset.phaseButton);
  });
}

playButton.addEventListener('click', () => {
  if (playbackTimer) {
    stopPlayback();
    return;
  }
  playButton.textContent = '■ 停止演示';
  playButton.setAttribute('aria-pressed', 'true');
  let index = phaseOrder.indexOf(currentPhase);
  playbackTimer = setInterval(() => {
    index = (index + 1) % phaseOrder.length;
    renderPhase(phaseOrder[index]);
  }, 4200);
});

document.querySelector('#reset-flow').addEventListener('click', () => {
  stopPlayback();
  renderPhase('defense');
});

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLButtonElement) return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < phaseOrder.length) {
    stopPlayback();
    renderPhase(phaseOrder[index]);
  }
});

window.__nanjingPreview = {
  get phase() { return currentPhase; },
  get ready() { return true; },
  phaseIds: phaseOrder,
  demoCounts: { arrived: 136, boarded: 86, waiting: 42, casualties: 8 },
};

renderPhase(currentPhase);
