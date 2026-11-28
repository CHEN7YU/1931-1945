import { KILL_COLUMNS } from './battle-stats.js';
import { JAPANESE_AIRCRAFT_PROFILE, VEHICLE_PROFILES } from './vehicle-model.js';

const creditNames = { player: '你', ally: '友军', enemy: '日军', environment: '事故' };
const causeNames = { fall: '高处坠落', crash: '坠毁', boundary: '脱离战区',
  'tank-crush': '坦克碾压', 'abandoned-squad': '放弃小队' };

function casualtyFeedEntry(event) {
  const source = event.source, attacker = creditNames[source.credit];
  if (!attacker) throw new RangeError('Unknown attack credit');
  const weapon = KILL_COLUMNS.find(([id]) => id === source.weaponClass);
  if (source.weaponClass != null && !weapon) throw new RangeError(`Unknown attack weapon: ${source.weaponClass}`);
  const icon = source.cause ?? source.weaponClass ?? 'total';
  const weaponLabel = causeNames[source.cause] ?? (source.weaponClass === 'tank' ? '坦克主炮' : weapon?.[1]) ?? '攻击';
  const target = event.target.team === 'friendly' ? '友军' : '日军';
  return { attacker, target, icon, weaponLabel, sourceTeam: source.team ?? 'environment', targetTeam: event.target.team,
    text: `${attacker} · ${weaponLabel} · ${target}`, until: event.time + 5,
    targetId: event.target.id, sourceId: source.soldierId ?? source.vehicleId };
}

export function attackSourceLabel(source) {
  const credit = creditNames[source.credit];
  if (!credit) throw new RangeError('Unknown attack credit');
  if (source.credit === 'environment' && source.cause === 'abandoned-squad') return '放弃小队';
  if (source.credit === 'environment' && source.cause === 'fall') return '高处坠落';
  const weapon = source.cause === 'tank-crush' ? '坦克碾压' : source.weaponClass === 'tank' ? '坦克主炮'
    : KILL_COLUMNS.find(([id]) => id === source.weaponClass)?.[1];
  return weapon ? `${credit}·${weapon}` : credit;
}

export function deathCauseLabel(source, weaponKind) {
  if (weaponKind === 'boundary') return '脱离战区';
  const credit = creditNames[source.credit];
  if (!credit) throw new RangeError('Unknown attack credit');
  if (source.credit === 'environment' && causeNames[source.cause]) return causeNames[source.cause];
  if (weaponKind === 'collision') return '坦克碾压';
  if (weaponKind === 'bayonet') return `${credit}·刺刀突刺`;
  if (weaponKind === 'dadao') return `${credit}·大刀斩击`;
  if (source.weaponClass === 'plane') {
    const aircraft = source.team === 'enemy' ? JAPANESE_AIRCRAFT_PROFILE.name.split(' · ')[0] : VEHICLE_PROFILES.plane.name;
    return `${credit}·${aircraft}${weaponKind === 'aircraft-bomb' ? '投下的炸弹' : '机枪'}`;
  }
  if (source.weaponName) return `${credit}·${source.weaponName}`;
  return attackSourceLabel(source);
}

export function deathNoticeText(reason) {
  if (!reason) return '';
  const attack = reason.match(/^(你|友军|日军)·(.+)$/);
  if (!attack) return reason;
  if (/刺刀|大刀/.test(attack[2])) return `遭${attack[1]}${attack[2]}`;
  return `被${attack[1]}${attack[2]}击中`;
}

export function createCombatFeedback() {
  let flash = 0, markerUntil = 0, markerSource = null;
  const feed = [];
  const resetPersonal = () => { flash = markerUntil = 0; markerSource = null; };
  const entries = now => {
    if (!Number.isFinite(now) || now < 0) throw new RangeError('HUD feedback requires finite simulation time');
    return feed.filter(entry => entry.until > now).map(entry => ({ ...entry }));
  };
  return {
    consume(event, viewer, now) {
      if (!['damage', 'casualty'].includes(event.type)) throw new RangeError('HUD feedback requires damage or casualty events');
      if (!Number.isFinite(now) || now < event.time || (viewer && typeof viewer.active !== 'boolean')) throw new RangeError('HUD feedback requires simulation time and an explicit viewer state');
      if (viewer?.active && !['soldierId', 'weaponId'].every(field => typeof viewer[field] === 'string' && viewer[field])) throw new Error('Active HUD feedback requires a controlled soldier and weapon');
      if (viewer?.grenadeWeaponId != null && (typeof viewer.grenadeWeaponId !== 'string' || !viewer.grenadeWeaponId)) {
        throw new Error('Grenade hit feedback requires an owned weapon identity');
      }
      if (viewer?.explosivePackWeaponId != null && (typeof viewer.explosivePackWeaponId !== 'string' || !viewer.explosivePackWeaponId)) {
        throw new Error('Explosive pack feedback requires its owned weapon identity');
      }
      if (viewer?.machineGunWeaponIds != null && (!Array.isArray(viewer.machineGunWeaponIds) ||
        viewer.machineGunWeaponIds.some(id => typeof id !== 'string' || !id))) throw new Error('Machine-gun feedback requires owned weapon identities');
      if (event.type === 'casualty') {
        if (event.target.team === 'enemy' || event.target.team === 'friendly') {
          feed.unshift(casualtyFeedEntry(event));
          if (feed.length > 4) feed.pop();
        }
        return;
      }
      if (!viewer?.active) return;
      if (event.observerId === viewer.soldierId) {
        const strength = event.target.kind === 'vehicle' ? .5 : .65;
        flash = Math.max(flash, strength - (now - event.time) * .65);
      }
      if (event.target.team === 'enemy' && event.source.credit === 'player' &&
        event.source.soldierId === viewer.soldierId &&
        (event.source.weaponId === viewer.weaponId || event.source.weaponId === viewer.grenadeWeaponId ||
          event.source.weaponId === viewer.explosivePackWeaponId || viewer.machineGunWeaponIds?.includes(event.source.weaponId))) {
        markerUntil = Math.max(markerUntil, event.time + (event.health === 0 ? .25 : .2));
        markerSource = { soldierId: event.source.soldierId, weaponId: event.source.weaponId };
      }
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('HUD feedback timestep must be non-negative and finite');
      flash = Math.max(0, flash - dt * .65);
    },
    resetPersonal,
    clear() { resetPersonal(); feed.length = 0; },
    entries,
    snapshot(now) { return { flash, markerUntil, markerVisible: now < markerUntil,
      markerSource: markerSource ? { ...markerSource } : null, feed: entries(now) }; },
    get flash() { return flash; },
    get markerUntil() { return markerUntil; },
  };
}
