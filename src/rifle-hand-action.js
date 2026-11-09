import { riflePose, infantryWeaponProfile } from './rifle-action.js';
import { BOLT_HANDLE, RIFLE_CONTACTS } from './rifle-contacts.js';

export const RIFLE_HAND_SAMPLES = Object.freeze([
  { hand: 0, loading: 0, boltLift: 0, boltTravel: 0, cartridgePush: 0 },
  { hand: 1, loading: 0, boltLift: 0, boltTravel: 0, cartridgePush: 0 },
  { hand: 1, loading: 0, boltLift: Math.PI / 3, boltTravel: 0, cartridgePush: 0 },
  { hand: 1, loading: 0, boltLift: Math.PI / 3, boltTravel: .09, cartridgePush: 0 },
  { hand: 1, loading: 1, boltLift: Math.PI / 3, boltTravel: .09, cartridgePush: 0 },
  { hand: 1, loading: 1, boltLift: Math.PI / 3, boltTravel: .09, cartridgePush: 1 },
  { hand: 0, loading: 0, boltLift: 0, boltTravel: 0, cartridgePush: 0, bodyRecoil: 1 },
].map(Object.freeze));

export function rifleHandAction(state) {
  if (!state || infantryWeaponProfile(state).automatic || !['cycle', 'reload'].includes(state.action)) return null;
  return riflePose(state);
}

export function rifleHandWeights(pose) {
  const hand = pose?.hand ?? 0, loading = pose?.loading ?? 0;
  const lift = (pose?.boltLift ?? 0) / (Math.PI / 3), travel = (pose?.boltTravel ?? 0) / .09;
  const push = pose?.cartridgePush ?? 0, bolt = hand * (1 - loading);
  const recoil = (1 - hand) * (pose?.bodyRecoil ?? 0);
  return [1 - hand - recoil, bolt * (1 - lift), bolt * lift * (1 - travel), bolt * lift * travel,
    hand * loading * (1 - push), hand * loading * push, recoil];
}

export function rifleActionPalm(pose, clipY = -.055 * pose.cartridgePush) {
  const [x, y, z] = BOLT_HANDLE.center, angle = pose.boltLift;
  const bolt = [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z + pose.boltTravel];
  const load = [0, .13 + clipY, -.18];
  return RIFLE_CONTACTS.triggerPalm.map((value, index) =>
    value * (1 - pose.hand) + pose.hand * ((1 - pose.loading) * bolt[index] + pose.loading * load[index]));
}
