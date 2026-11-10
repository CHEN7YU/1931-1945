import { infantryWeaponProfile, TYPE11_CLIP_RELOAD } from './rifle-action.js';

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * smooth(t));
const ready = [-.029, -.101, -.386];
export const ZB26_HAND = Object.freeze({
  grip: Object.freeze([.031, .127, -.247]),
  press: Object.freeze([.065, .221, -.247]),
});

export function machineGunReloadPose(state, { prone = 0, supported = 0 } = {}) {
  if (![prone, supported].every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1))
    throw new RangeError('Reload posture weights must be between zero and one');
  const profile = infantryWeaponProfile(state);
  if (!profile.automatic) throw new RangeError('Machine-gun reload requires an automatic infantry weapon');
  const t = state.action === 'reload' ? Math.min(1, state.elapsed / profile.reloadSeconds) : 0;
  const result = { stage: 'ready', feed: [0, 0, 0], feedVisible: true, palm: ready,
    handWeight: 0, supportWeight: 0, pressWeight: 0, handRotation: 0, press: 0, lidAngle: 0, clip: [0, 0, 0], clipVisible: false,
    loadedClips: Math.ceil(state.ammo / 5) };
  if (state.action !== 'reload') return result;
  result.supportWeight = smooth(t / .08) * (1 - smooth((t - (state.model === 'type11' ? .96 : .91)) /
    (state.model === 'type11' ? .04 : .09)));
  if (profile.smg) {
    const grip = [-.20, -.043, -.15], away = [-.14, -.08, .05], ready = [0, -.095, -.34];
    const feed = t < .15 ? [0, 0, 0] : t < .35 ? mix([0, 0, 0], away, (t - .15) / .2)
      : t < .45 ? away : t < .8 ? mix(away, [0, 0, 0], (t - .45) / .35) : [0, 0, 0];
    result.stage = t < .15 ? 'grip' : t < .35 ? 'remove' : t < .45 ? 'retrieve' : t < .8 ? 'insert' : 'return';
    result.feed = feed; result.feedVisible = t < .35 || t >= .45;
    result.palm = t < .15 ? mix(ready, grip, t / .15) : t < .8 ? grip.map((value, i) => value + feed[i])
      : mix(grip, ready, (t - .8) / .2);
    result.handWeight = smooth(t / .15) * (1 - smooth((t - .8) / .2));
    return result;
  } else if (state.model === 'zb26') {
    const grip = ZB26_HAND.grip, top = ZB26_HAND.press;
    const away = mix(mix([-.3, -.48, .16], [-.26, -.32, .26], supported), [-.32, -.02, .08], prone);
    let feed = [0, 0, 0];
    if (t < .12) {
      result.stage = 'grip'; result.palm = mix(ready, grip, t / .12);
    } else if (t < .32) {
      result.stage = 'remove';
      feed = t < .21 ? mix([0, 0, 0], [0, .11, 0], (t - .12) / .09)
        : mix([0, .11, 0], away, (t - .21) / .11);
      result.palm = grip.map((value, i) => value + feed[i]);
    } else if (t < .42) {
      result.stage = 'retrieve'; feed = away;
      result.feedVisible = false; result.palm = grip.map((value, i) => value + feed[i]);
    } else if (t < .7) {
      result.stage = 'insert';
      feed = t < .59 ? mix(away, [0, .11, 0], (t - .42) / .17)
        : mix([0, .11, 0], [0, 0, 0], (t - .59) / .11);
      result.palm = grip.map((value, i) => value + feed[i]);
    } else if (t < .78) {
      result.stage = 'reach-press';
      result.palm = t < .74 ? mix(grip, [.031, .247, -.247], (t - .7) / .04)
        : mix([.031, .247, -.247], top, (t - .74) / .04);
    } else if (t < .86) {
      result.stage = 'press'; result.press = Math.sin((t - .78) / .08 * Math.PI) * .012;
      result.palm = [top[0], top[1] - result.press, top[2]];
      feed = [0, -result.press, 0];
    } else {
      result.stage = 'return';
      result.palm = t < .91 ? mix(top, [-.045, .23, -.247], (t - .86) / .05)
        : mix([-.045, .23, -.247], ready, (t - .91) / .09);
    }
    result.feed = feed;
    result.pressWeight = smooth((t - .7) / .08) * (1 - smooth((t - .86) / .08));
  } else {
    // The Type 11 has a fixed hopper, not a removable box magazine.
    result.lidAngle = smooth((t - .1) / .1) * (1 - smooth((t - .86) / .1)) * 1.3;
    const lidPalm = angle => [-.197 + .09 * Math.cos(angle) - .018 * Math.sin(angle),
      .071 + .09 * Math.sin(angle) + .018 * Math.cos(angle), -.216];
    if (t < .2) {
      result.stage = 'open-hopper';
      result.palm = t < .1 ? mix(ready, lidPalm(0), t / .1) : lidPalm(result.lidAngle);
      result.pressWeight = smooth(t / .1);
    } else if (t < TYPE11_CLIP_RELOAD.start) {
      const away = mix(mix([-.23, -.28, -.02], [-.20, -.14, .12], supported), [-.30, .04, 0], prone);
      const emptyHand = [away[0] - .035, away[1] + .025, away[2]];
      result.stage = 'reach-ammunition'; result.palm = mix(lidPalm(1.3), emptyHand, (t - .2) / .05);
      result.pressWeight = 1 - smooth((t - .2) / .05);
    } else if (t < .82) {
      const missing = Math.max(1, Math.ceil((profile.magazine - state.ammo) / 5));
      const progress = (t - TYPE11_CLIP_RELOAD.start) / TYPE11_CLIP_RELOAD.duration * missing, cycle = progress % 1;
      result.loadedClips = Math.min(6, result.loadedClips + Math.floor(progress) + Number(cycle >= .8));
      const away = mix(mix([-.23, -.28, -.02], [-.20, -.14, .12], supported), [-.30, .04, 0], prone);
      const above = [-.123, .19, -.216], seated = [-.123, .07, -.216];
      const target = cycle < .5 ? mix(away, above, cycle / .5) :
        cycle < .8 ? mix(above, seated, (cycle - .5) / .3) : mix(seated, away, (cycle - .8) / .2);
      result.stage = cycle < .5 ? 'bring-clip' : cycle < .8 ? 'press-clip' : 'retrieve-clip';
      result.clip = [target[0] + .123, target[1] - .07, target[2] + .216];
      result.clipVisible = cycle < .8;
      result.palm = [target[0] - .035, target[1] + .025, target[2]];
      result.pressWeight = smooth((cycle - .45) / .15) * (1 - smooth((cycle - .8) / .2));
    } else {
      result.loadedClips = 6;
      const away = mix(mix([-.23, -.28, -.02], [-.20, -.14, .12], supported), [-.30, .04, 0], prone);
      const emptyHand = [away[0] - .035, away[1] + .025, away[2]];
      result.stage = 'close-hopper';
      result.palm = t < .86 ? mix(emptyHand, lidPalm(1.3), (t - .82) / .04)
        : t < .96 ? lidPalm(result.lidAngle) : mix(lidPalm(0), ready, (t - .96) / .04);
      result.pressWeight = smooth((t - .82) / .04) * (1 - smooth((t - .96) / .04));
    }
  }
  result.handWeight = state.model === 'type11'
    ? smooth(t / .1) * (1 - smooth((t - .96) / .04))
    : smooth(t / .12) * (1 - smooth((t - .91) / .09));
  return result;
}
