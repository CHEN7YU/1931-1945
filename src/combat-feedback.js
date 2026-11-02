import { KILL_COLUMNS } from './battle-stats.js';

const creditNames = { player: '你', ally: '友军', enemy: '日军', environment: '事故' };

export function attackSourceLabel(source) {
  if (source.credit === 'environment' && source.cause === 'fall') return '高处坠落';
  const credit = creditNames[source.credit];
  if (!credit) throw new RangeError('Unknown attack credit');
  const weapon = KILL_COLUMNS.find(([id]) => id === source.weaponClass)?.[1];
  return weapon ? `${credit}·${weapon}` : credit;
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
          const target = event.target.team === 'friendly' ? '我方士兵阵亡' : '日军守兵';
          feed.unshift({ text: `${attackSourceLabel(event.source)}　›　${target}`, until: event.time + 5,
            targetId: event.target.id, sourceId: event.source.soldierId ?? event.source.vehicleId });
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
