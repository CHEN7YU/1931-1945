import { Vector3 } from 'three';

export const RIFLE_STOCK_SECTIONS = Object.freeze([
  [.22, -.095, .025, .068], [.19, -.094, .027, .071], [.08, -.076, .025, .061],
  [-.025, -.052, .018, .027], [-.09, -.049, .019, .026], [-.16, -.045, .028, .037],
  [-.3, -.038, .026, .031], [-.44, -.034, .024, .028], [-.6, -.031, .021, .023], [-.73, -.026, .018, .019],
].map(section => Object.freeze(section)));

export function rifleStockSection(z) {
  if (!Number.isFinite(z) || z > .22 || z < -.73) throw new RangeError('Grip lies outside the rifle wood stock');
  for (let i = 1; i < RIFLE_STOCK_SECTIONS.length; i++) {
    const a = RIFLE_STOCK_SECTIONS[i - 1], b = RIFLE_STOCK_SECTIONS[i];
    if (z < b[0]) continue;
    const t = (a[0] - z) / (a[0] - b[0]);
    return a.slice(1).map((value, j) => value + (b[j + 1] - value) * t);
  }
  throw new Error('Rifle stock section is not covered');
}

export const RIFLE_CONTACTS = Object.freeze({
  stock: Object.freeze([0, -.095, .22]),
  shoulder: Object.freeze([-.015, .045, -.025]),
  armpit: Object.freeze([-.015, -.08, -.01]),
  triggerWrist: Object.freeze([.045, -.045, -.085]),
  supportWrist: Object.freeze([-.10, -.105, -.17]),
  carrySupportWrist: Object.freeze([-.13, -.085, -.18]),
  triggerPalm: Object.freeze([.03, -.085, -.055]),
  supportPalm: Object.freeze([0, -.095, -.34]),
  carrySupportPalm: Object.freeze([0, -.095, -.21]),
});

export function firingCarryPosition(shoulder) {
  return new Vector3().fromArray(shoulder).add(new Vector3(...RIFLE_CONTACTS.shoulder))
    .sub(new Vector3(...RIFLE_CONTACTS.stock)).toArray();
}
