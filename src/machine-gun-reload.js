import * as THREE from 'three';
import { infantryWeaponProfile, TYPE11_CLIP_RELOAD } from './rifle-action.js';
import { SMG_MAGAZINE } from './submachine-gun-model.js';

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * smooth(t));
const ready = [-.029, -.101, -.386];
const frame = (across, forward) => {
  const y = new THREE.Vector3(...forward).normalize(), x = new THREE.Vector3(...across);
  x.addScaledVector(y, -x.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4()
    .makeBasis(x, y, x.clone().cross(y)));
};
export const SMG_RELOAD_FRAMES = Object.freeze({
  magazine: frame([1, 0, 0], [0, .6, -.8]),
  carry: frame([0, 1, 0], [-.18, .86, -.48]),
});

export function smgMagazinePresentationRotation(progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new RangeError('SMG magazine presentation must be between zero and one');
  return SMG_RELOAD_FRAMES.magazine.clone().slerp(SMG_RELOAD_FRAMES.carry, progress)
    .multiply(SMG_RELOAD_FRAMES.magazine.clone().invert());
}
export const ZB26_HAND = Object.freeze({
  grip: Object.freeze([.031, .127, -.247]),
  press: Object.freeze([.065, .221, -.247]),
});

export function machineGunReloadPose(state, { prone = 0, supported = 0, firstPerson = false } = {}) {
  if (![prone, supported].every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1))
    throw new RangeError('Reload posture weights must be between zero and one');
  if (typeof firstPerson !== 'boolean') throw new TypeError('Reload perspective must be a boolean');
  const profile = infantryWeaponProfile(state);
  if (!profile.automatic) throw new RangeError('Machine-gun reload requires an automatic infantry weapon');
  const t = state.action === 'reload' ? Math.min(1, state.elapsed / profile.reloadSeconds) : 0;
  const result = { stage: 'ready', feed: [0, 0, 0], feedVisible: true, palm: ready,
    spareFeed: [0, 0, 0], spareVisible: false, handWeight: 0, supportWeight: 0, pressWeight: 0,
    handRotation: 0, press: 0, lidAngle: 0, clip: [0, 0, 0], clipVisible: false,
    loadedClips: Math.ceil(state.ammo / 5), viewDrop: 0 };
  if (state.action !== 'reload') return result;
  result.supportWeight = smooth(t / .08) * (1 - smooth((t - (state.model === 'type11' ? .96 : .91)) /
    (state.model === 'type11' ? .04 : .09)));
  if (profile.smg) {
    const grip = firstPerson ? [SMG_MAGAZINE.center[0] - .025, SMG_MAGAZINE.center[1] - SMG_MAGAZINE.size[1] / 2 - .007,
      SMG_MAGAZINE.center[2]] : [-.20, -.043, -.15];
    const readyHand = [0, -.095, -.34], clear = [-.095, 0, 0];
    if (!firstPerson) {
      const away = [-.14, -.08, .05];
      result.feed = t < .15 ? [0, 0, 0] : t < .35 ? mix([0, 0, 0], away, (t - .15) / .2)
        : t < .45 ? away : t < .8 ? mix(away, [0, 0, 0], (t - .45) / .35) : [0, 0, 0];
      result.stage = t < .15 ? 'grip' : t < .35 ? 'remove' : t < .45 ? 'retrieve' : t < .8 ? 'insert' : 'return';
      result.palm = t < .15 ? mix(readyHand, grip, t / .15)
        : t < .8 ? grip.map((value, i) => value + result.feed[i]) : mix(grip, readyHand, (t - .8) / .2);
      result.handWeight = smooth(t / .15) * (1 - smooth((t - .8) / .2));
      return result;
    }

    const oldAway = [-.06, -.13, .055], spareStart = [-.06, -.13, .055];
    const contact = feed => grip.map((value, i) => value + feed[i]);
    result.viewDrop = .10 * smooth((t - .28) / .07) * (1 - smooth((t - .50) / .10));
    result.stage = t < .15 ? 'grip' : t < .24 ? 'clear' : t < .35 ? 'remove'
      : t < .45 ? 'retrieve' : t < .55 ? 'grip-spare' : t < .65 ? 'insert'
        : t < .75 ? 'seat' : t < .8 ? 'press' : 'return';
    if (t < .15) {
      result.palm = mix(readyHand, grip, t / .15);
    } else if (t < .24) {
      result.feed = mix([0, 0, 0], clear, (t - .15) / .09);
      result.palm = contact(result.feed);
    } else if (t < .35) {
      result.feed = mix(clear, oldAway, (t - .24) / .11);
      result.palm = contact(result.feed);
      result.handRotation = .11 * smooth((t - .24) / .11);
    } else if (t < .45) {
      result.feed = oldAway; result.feedVisible = t < .4;
      result.spareFeed = spareStart; result.spareVisible = t >= .4;
      result.palm = contact(spareStart);
      result.handRotation = .11 + .11 * smooth((t - .35) / .1);
    } else if (t < .55) {
      result.feedVisible = false; result.spareVisible = true;
      result.spareFeed = mix(spareStart, oldAway, (t - .45) / .1);
      result.palm = contact(result.spareFeed);
      result.handRotation = .22;
    } else if (t < .65) {
      result.feedVisible = false; result.spareVisible = true;
      result.spareFeed = mix(oldAway, clear, (t - .55) / .1);
      result.palm = contact(result.spareFeed);
      result.handRotation = .22 * (1 - smooth((t - .55) / .1));
    } else if (t < .75) {
      result.feedVisible = false; result.spareVisible = true;
      result.spareFeed = mix(clear, [0, 0, 0], (t - .65) / .1);
      result.palm = contact(result.spareFeed);
    } else if (t < .8) {
      result.feedVisible = false; result.spareVisible = true;
      result.spareFeed = [0, 0, 0];
      result.palm = contact([0, .012 * Math.sin((t - .75) / .05 * Math.PI), 0]);
    } else {
      result.palm = mix(grip, readyHand, (t - .8) / .1);
    }
    result.handWeight = smooth(t / .12) * (1 - smooth((t - .8) / .15));
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
