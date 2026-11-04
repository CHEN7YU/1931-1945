import { PLAYER_UNIT_OPTIONS } from './player-identity.js';

const chinese = [
  ['第31师', 1], ['第31师', 3], ['第31师', 4], ['第31师', 5],
  ['第27师', 1], ['第27师', 2], ['第27师', 3],
  ['第20军团', 1], ['第20军团', 2], ['第20军团', 3],
];

export function friendlyAIFormationName(campaignId, playerUnitName, index) {
  if (!Number.isInteger(index) || index < 1) throw new RangeError('AI formation index must be positive');
  const normalize = name => name.replace(/^国民革命军/, '').split('·')[0].replace(/\s/g, '');
  const options = PLAYER_UNIT_OPTIONS[campaignId === 'taierzhuang-streets' ? 'taierzhuang-fort' : campaignId];
  if (!options) throw new RangeError(`Unknown campaign formations: ${campaignId}`);
  const available = options.filter(unit => unit.id !== 'custom' && normalize(unit.name) !== normalize(playerUnitName));
  return available[(index - 1) % available.length].name;
}

export function soldierRoleLabel(actor) {
  return { mortarman: '迫击炮手', sniper: '狙击手', 'machine-gunner': '机枪手',
    rifleman: '步枪手', tanker: '车组', pilot: '飞行员' }[actor.role] ?? actor.role;
}

export function campaignUnitName(unit) {
  if (!['friendly', 'enemy'].includes(unit.team) || !Number.isInteger(unit.index) || unit.index < 0 ||
    !['infantry', 'mortar', 'tank', 'plane'].includes(unit.type)) throw new RangeError('Campaign labels require a valid game formation');
  if (unit.historicalName) return unit.player ? unit.historicalName : `${unit.historicalName}·${unit.index + 1}班`;
  if (unit.type !== 'infantry') {
    const role = { mortar: '炮兵', tank: '装甲', plane: '航空' }[unit.type];
    const number = unit.team === 'enemy' && unit.type === 'tank' && unit.index >= 8 ? unit.index - 7 : unit.index + 1;
    return `${role}支援·游戏${unit.player ? '' : number}`;
  }
  if (unit.team === 'friendly') {
    const [formation, number] = chinese[unit.index % chinese.length];
    return `${formation}·${unit.player && unit.squadId === 'infantry-reserve' ? 2 : number}班`;
  }
  return unit.index % 10 < 6 ? `第10师团·濑谷${unit.index % 10 + 1}` : `第5师团·坂本${unit.index % 10 - 5}`;
}

export function campaignUnitDescription(name) {
  const selected = Object.values(PLAYER_UNIT_OPTIONS).flat().find(unit => unit.id !== 'custom' && name.startsWith(unit.name));
  if (selected) return selected.description;
  const formations = [
    ['第31师', '国民革命军第2集团军第31师，台儿庄守备部队'],
    ['第27师', '国民革命军第2集团军第27师，台儿庄参战部队'],
    ['第20军团', '国民革命军第20军团，台儿庄战役外围机动与援攻部队'],
    ['第10师团', '日军第10师团濑谷支队'],
    ['第5师团', '日军第5师团坂本支队，台儿庄及外围作战'],
  ];
  const historical = formations.find(([prefix]) => name.startsWith(prefix));
  return historical ? `${historical[1]}。末尾班号为游戏分组，不是史实编制或兵力比例。`
    : `${name}：保留的游戏支援编制，不代表该战役实有独立部队番号或装备配属。`;
}
