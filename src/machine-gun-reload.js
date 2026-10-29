import { infantryWeaponProfile } from './rifle-action.js';

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * smooth(t));
const ready = [-.029, -.101, -.386];

export function machineGunReloadPose(state) {
  const profile = infantryWeaponProfile(state);
  if (!profile.automatic) throw new RangeError('Machine-gun reload requires an automatic infantry weapon');
  const t = state.action === 'reload' ? Math.min(1, state.elapsed / profile.reloadSeconds) : 0;
  const result = { stage: 'ready', feed: [0, 0, 0], feedVisible: true, palm: ready,
    handWeight: 0, handRotation: 0, press: 0, lidAngle: 0, clip: [0, 0, 0], clipVisible: false,
    loadedClips: Math.ceil(state.ammo / 5) };
  if (state.action !== 'reload') return result;
  if (state.model === 'zb26') {
    const grip = [.029, .13, -.25], top = [.065, .225, -.247];
    let feed = [0, 0, 0];
    if (t < .12) {
      result.stage = 'grip'; result.palm = mix(ready, grip, t / .12);
    } else if (t < .32) {
      result.stage = 'remove';
      feed = t < .21 ? mix([0, 0, 0], [0, .11, 0], (t - .12) / .09)
        : mix([0, .11, 0], [-.3, -.48, .16], (t - .21) / .11);
      result.palm = grip.map((value, i) => value + feed[i]);
    } else if (t < .42) {
      result.stage = 'retrieve'; feed = [-.3, -.48, .16];
      result.feedVisible = false; result.palm = grip.map((value, i) => value + feed[i]);
    } else if (t < .7) {
      result.stage = 'insert';
      feed = t < .59 ? mix([-.3, -.48, .16], [0, .11, 0], (t - .42) / .17)
        : mix([0, .11, 0], [0, 0, 0], (t - .59) / .11);
      result.palm = grip.map((value, i) => value + feed[i]);
    } else if (t < .78) {
      result.stage = 'reach-press'; result.palm = mix(grip, top, (t - .7) / .08);
      result.handRotation = Math.PI * smooth((t - .7) / .08);
    } else if (t < .86) {
      result.stage = 'press'; result.press = Math.sin((t - .78) / .08 * Math.PI) * .012;
      result.handRotation = Math.PI;
      result.palm = [top[0], top[1] - result.press, top[2]];
      feed = [0, -result.press, 0];
    } else {
      result.stage = 'return'; result.palm = mix(top, ready, (t - .86) / .14);
      result.handRotation = Math.PI * (1 - smooth((t - .86) / .14));
    }
    result.feed = feed;
  } else {
    // The Type 11 has a fixed hopper, not a removable box magazine.
    result.lidAngle = smooth(t / .14) * (1 - smooth((t - .86) / .1)) * 1.3;
    if (t < .2) {
      result.stage = 'open-hopper'; result.palm = mix(ready, [-.12, .12, -.216], t / .2);
    } else if (t < .82) {
      const missing = Math.max(1, Math.ceil((profile.magazine - state.ammo) / 5));
      const progress = (t - .2) / .62 * missing, cycle = progress % 1;
      result.loadedClips = Math.min(6, result.loadedClips + Math.floor(progress) + Number(cycle >= .8));
      const away = [-.23, -.28, -.02], above = [-.123, .19, -.216], seated = [-.123, .07, -.216];
      const target = cycle < .5 ? mix(away, above, cycle / .5) :
        cycle < .8 ? mix(above, seated, (cycle - .5) / .3) : mix(seated, away, (cycle - .8) / .2);
      result.stage = cycle < .5 ? 'bring-clip' : cycle < .8 ? 'press-clip' : 'retrieve-clip';
      result.clip = [target[0] + .123, target[1] - .07, target[2] + .216];
      result.clipVisible = cycle < .8;
      result.palm = [target[0] - .035, target[1] + .025, target[2]];
    } else {
      result.loadedClips = 6;
      result.stage = 'close-hopper'; result.palm = mix([-.12, .12, -.216], ready, (t - .82) / .18);
    }
  }
  result.handWeight = 1;
  return result;
}
