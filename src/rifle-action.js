export const RIFLE = Object.freeze({ magazine: 5, range: 180, cycleSeconds: .65, reloadSeconds: 3.8, length: 1.11, sightHeight: .05 });
export const INFANTRY_WEAPONS = Object.freeze({
  rifle: Object.freeze({ ...RIFLE, name: '中正式步枪', automatic: false, muzzleZ: -.891 }),
  sniper: Object.freeze({ ...RIFLE, name: '狙击步枪', automatic: false, scoped: true,
    aimFov: 18, aimSensitivity: .22, muzzleZ: -.891 }),
  zb26: Object.freeze({ magazine: 20, range: 180, cycleSeconds: .12, reloadSeconds: 3.8, length: 1.162,
    sightHeight: .05, muzzleZ: -.943, muzzleX: .065, name: 'ZB-26 捷克式轻机枪', automatic: true }),
  type11: Object.freeze({ magazine: 30, range: 180, cycleSeconds: .12, reloadSeconds: 5,
    length: 1.1, sightHeight: .05, muzzleZ: -.881, muzzleX: -.035, name: '大正十一年式轻机枪 · 歪把子', automatic: true }),
});
export function infantryWeaponProfile(state) {
  const model = state?.model ?? 'rifle';
  if (!Object.hasOwn(INFANTRY_WEAPONS, model)) throw new RangeError(`Unknown infantry weapon: ${model}`);
  return INFANTRY_WEAPONS[model];
}
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (time, from, to) => { const t = clamp((time - from) / (to - from)); return t * t * (3 - 2 * t); };

export function rifleReloadSeconds(state) {
  const profile = infantryWeaponProfile(state);
  if (profile.automatic) return profile.reloadSeconds;
  const missing = profile.magazine - state.ammo;
  return state.ammo === 0 && !profile.scoped ? profile.reloadSeconds : 2.8 + missing * .4;
}

export function createRifleState(model = 'rifle') {
  const profile = infantryWeaponProfile({ model });
  return { ...(model === 'rifle' ? {} : { model }), ammo: profile.magazine, action: 'idle', elapsed: 0, queuedReload: false, shots: 0 };
}

export function reloadRifle(state) {
  if (state.ammo === infantryWeaponProfile(state).magazine || state.action === 'reload') return false;
  if (state.action === 'cycle') state.queuedReload = true;
  else { state.action = 'reload'; state.elapsed = 0; }
  return true;
}

export function shootRifle(state) {
  if (state.action !== 'idle') return false;
  if (state.ammo <= 0) { reloadRifle(state); return false; }
  state.ammo--;
  state.shots++;
  state.action = 'cycle';
  state.elapsed = 0;
  if (state.ammo === 0 && !infantryWeaponProfile(state).automatic) reloadRifle(state);
  return true;
}

export function advanceRifle(state, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Rifle requires a non-negative finite timestep');
  const events = [];
  const profile = infantryWeaponProfile(state);
  while (dt > 0 && state.action !== 'idle') {
    const reloading = state.action === 'reload';
    const duration = reloading ? rifleReloadSeconds(state) : profile.cycleSeconds;
    const end = Math.min(duration, state.elapsed + dt);
    const clips = Math.max(1, Math.ceil((profile.magazine - state.ammo) / 5));
    const cues = profile.automatic
      ? reloading ? state.model === 'zb26' ? [[duration * .82, 'load'], [duration * .93, 'close']]
        : [...Array.from({ length: clips }, (_, index) => [duration * (.2 + .62 * (index + .8) / clips), 'load']),
          [duration * .93, 'close']] : []
      : reloading ? [[duration * .12 / 2.7, 'unlock'], [duration * .4 / 2.7, 'extract'],
        [duration * 1.45 / 2.7, 'load'], [duration * 2.3 / 2.7, 'close']] : [[.13, 'unlock'], [.3, 'extract'], [.54, 'close']];
    for (const [at, cue] of cues) if (state.elapsed < at && end >= at) events.push(cue);
    dt -= end - state.elapsed;
    state.elapsed = end;
    if (end < duration) break;
    if (reloading) { state.ammo = profile.magazine; events.push('ready'); }
    state.action = 'idle';
    state.elapsed = 0;
    if (state.queuedReload) {
      state.queuedReload = false;
      reloadRifle(state);
    }
  }
  return events;
}

export function riflePose(state) {
  const profile = infantryWeaponProfile(state);
  if (profile.automatic) return {
    boltLift: 0, boltTravel: 0, hand: 0, loading: 0, cartridgePush: 0, clipVisible: false,
    lower: state.action === 'reload' ? smooth(state.elapsed, 0, .25) * (1 - smooth(state.elapsed, profile.reloadSeconds - .3, profile.reloadSeconds)) : 0,
    recoil: state.action === 'cycle' ? 1 - smooth(state.elapsed, 0, profile.cycleSeconds) : 0,
  };
  const reload = state.action === 'reload';
  const cycling = state.action === 'cycle';
  const t = reload ? state.elapsed * 2.7 / rifleReloadSeconds(state) : state.elapsed;
  const open = reload
    ? smooth(t, .05, .2) * (1 - smooth(t, 2.4, 2.67))
    : cycling ? smooth(t, .08, .2) * (1 - smooth(t, .5, .64)) : 0;
  const pull = reload
    ? smooth(t, .2, .45) * (1 - smooth(t, 2.12, 2.38))
    : cycling ? smooth(t, .2, .34) * (1 - smooth(t, .38, .54)) : 0;
  const hand = reload ? smooth(t, .02, .2) * (1 - smooth(t, 2.4, 2.7)) : cycling ? smooth(t, .08, .18) * (1 - smooth(t, .54, .65)) : 0;
  const loading = reload ? smooth(t, .5, .85) * (1 - smooth(t, 1.8, 2.15)) : 0;
  return {
    boltLift: open * Math.PI / 3, boltTravel: pull * .09,
    hand, loading, cartridgePush: reload ? smooth(t, 1.1, 1.65) : 0,
    clipVisible: reload && t > .6 && t < 1.95,
    lower: reload ? smooth(t, 0, .25) * (1 - smooth(t, 2.4, 2.7)) : 0,
    recoil: cycling ? (1 - smooth(t, 0, .12)) : 0,
  };
}
