export const PLAYER_IDENTITY_KEY = 'shanhe.player-identity.v1';
const unit = (id, name, description, source) => Object.freeze({ id, name, description, source });
const taierzhuangSource = 'https://cpc.people.com.cn/n1/2018/1219/c421684-30476925.html';
const nanjingSource = 'https://www.19371213.com.cn/information/news/202112/t20211209_3226524.html';
const custom = unit('custom', '自定义小队', '最后也可以使用自己的小队名字，不选择历史番号。', null);
export const PLAYER_UNIT_OPTIONS = Object.freeze({
  sihang: Object.freeze([
    unit('524', '国民革命军第88师262旅524团', '淞沪会战后期，第524团一部坚守四行仓库。末尾班号为游戏分组。', nanjingSource),
    custom,
  ]),
  'taierzhuang-fort': Object.freeze([
    unit('31', '国民革命军第31师', '孙连仲第2集团军所属部队。台儿庄战役中承担城内防御，进行激烈巷战。', taierzhuangSource),
    unit('27', '国民革命军第27师', '孙连仲第2集团军所属部队。参加台儿庄及周边作战，与友军协同抗击日军。', taierzhuangSource),
    unit('20-corps', '国民革命军第20军团', '由汤恩伯指挥。台儿庄战役中在外围机动作战，并参加反攻。', taierzhuangSource),
    custom,
  ]),
  nanjing: Object.freeze([
    unit('88', '国民革命军第88师', '抗战初期接受德式整训，先后参加淞沪会战与南京保卫战。淞沪作战期间，该师第524团一部坚守四行仓库。', nanjingSource),
    unit('87', '国民革命军第87师', '抗战初期接受德式整训的部队。南京保卫战中参加光华门等处防御与反击。',
      'https://www.19371213.com.cn/information/news/201812/t20181211_2232762.html'),
    unit('74-corps', '国民革命军第74军', '先后参加淞沪会战和南京保卫战。南京作战中承担城西及上新河方向的防御任务。', nanjingSource),
    unit('training', '教导总队', '南京卫戍部队之一，由桂永清指挥。在紫金山等地进行顽强抵抗。',
      'https://www.19371213.com.cn/research/rbqhnjdtsyj/202506/t20250604_5577275.html'),
    custom,
  ]),
});
const mapId = id => id === 'taierzhuang-streets' ? 'taierzhuang-fort' : id;
export function playerUnitOptions(campaignId) {
  const options = PLAYER_UNIT_OPTIONS[mapId(campaignId)];
  if (!options) throw new RangeError(`No playable unit selection for ${campaignId}`);
  return options;
}
const defaultIdentity = () => ({ nickname: '玩家', customName: '我的小队',
  selections: { 'taierzhuang-fort': '31', nanjing: '88', sihang: '524' } });
function name(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(value))
    throw new RangeError(`${label}须为1–24个字符，不能包含控制字符`);
  return value.trim();
}
export function validatePlayerIdentity(value) {
  const selections = {};
  for (const id of Object.keys(PLAYER_UNIT_OPTIONS)) {
    if (!playerUnitOptions(id).some(option => option.id === value?.selections?.[id])) throw new RangeError('保存的番号不属于该战役');
    selections[id] = value.selections[id];
  }
  return { nickname: name(value.nickname, '昵称'), customName: name(value.customName, '小队名'), selections };
}
export function createPlayerIdentityStore({ storage = () => window.localStorage, warn = console.warn } = {}) {
  let state = defaultIdentity(), status = '昵称与番号只保存在此浏览器，不上传性能诊断。', problem = false;
  const failure = (message, error) => { status = `${message}：${error.message}`; problem = true; warn(status); };
  try {
    const saved = storage().getItem(PLAYER_IDENTITY_KEY);
    if (saved !== null) {
      const record = JSON.parse(saved);
      if (record.version !== 1) throw new Error('不支持的身份设置版本');
      const identity = record.identity;
      state = validatePlayerIdentity(identity?.selections && !Object.hasOwn(identity.selections, 'sihang')
        ? { ...identity, selections: { ...identity.selections, sihang: '524' } } : identity);
    }
  } catch (error) { failure('无法读取身份设置，本次先使用默认值', error); }
  return {
    update(patch) {
      state = validatePlayerIdentity({ ...state, ...patch, selections: { ...state.selections, ...patch.selections } });
      try {
        storage().setItem(PLAYER_IDENTITY_KEY, JSON.stringify({ version: 1, identity: state }));
        status = '昵称与番号已保存在此浏览器，不上传性能诊断。'; problem = false;
      } catch (error) { failure('本页已生效，但无法保存身份设置', error); }
    },
    get snapshot() { return validatePlayerIdentity(state); },
    get status() { return { message: status, problem }; },
  };
}
let shared = null;
const identityStore = () => shared ??= createPlayerIdentityStore();
export function getPlayerIdentity(campaignId) {
  const profile = identityStore().snapshot;
  const selected = playerUnitOptions(campaignId).find(option => option.id === profile.selections[mapId(campaignId)]);
  return { nickname: profile.nickname, unitId: selected.id, custom: selected.id === 'custom',
    unitName: selected.id === 'custom' ? profile.customName : selected.name };
}

export function createPlayerIdentityControls(doc = document, store = identityStore()) {
  const root = doc.getElementById('player-identity'), cards = doc.getElementById('player-unit-cards');
  const nickname = doc.getElementById('player-nickname'), customName = doc.getElementById('custom-squad-name');
  const customField = doc.getElementById('custom-squad-field'), status = doc.getElementById('player-identity-status');
  if (!root || !cards || !nickname || !customName || !customField || !status) throw new Error('Player identity controls are incomplete');
  let current = null;
  nickname.value = store.snapshot.nickname; customName.value = store.snapshot.customName;
  const report = () => { status.textContent = store.status.message; status.dataset.problem = String(store.status.problem); };
  const commit = () => {
    if (!current || root.hidden) return true;
    const selected = cards.querySelector('input:checked')?.value;
    customField.hidden = selected !== 'custom';
    try {
      store.update({ nickname: nickname.value, customName: selected === 'custom' ? customName.value : store.snapshot.customName,
        selections: { [mapId(current.id)]: selected } });
      report(); return true;
    } catch (error) { status.textContent = error.message; status.dataset.problem = 'true'; return false; }
  };
  const beforeDeploy = event => {
    if (!commit()) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  nickname.addEventListener('change', commit); customName.addEventListener('change', commit);
  cards.addEventListener('change', commit);
  for (const id of ['deploy', 'confirm-identity', 'confirm-deploy']) doc.getElementById(id).addEventListener('click', beforeDeploy);
  report();
  return {
    show(campaign, target) {
      current = campaign; target.append(root); root.hidden = false;
      const selected = store.snapshot.selections[mapId(campaign.id)];
      cards.replaceChildren(...playerUnitOptions(campaign.id).map(option => {
        const label = doc.createElement('label'), radio = doc.createElement('input');
        label.className = 'player-unit-card'; radio.type = 'radio'; radio.name = 'player-unit';
        radio.value = option.id; radio.checked = option.id === selected;
        const title = doc.createElement('strong'), description = doc.createElement('small');
        title.textContent = option.name; description.textContent = option.description;
        label.append(radio, title, description); return label;
      }));
      customField.hidden = selected !== 'custom'; report();
    },
    hide() { root.hidden = true; },
  };
}
