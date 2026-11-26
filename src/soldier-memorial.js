const surnames = Object.freeze(['汪', '王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周',
  '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马']);
const givenNames = Object.freeze(['洋', '勇', '保国', '志强', '建明']);

export const SOLDIER_MEMORIAL_ROSTER = Object.freeze(surnames.flatMap((surname, family) =>
  givenNames.map((given, index) => {
    const rosterIndex = family * givenNames.length + index;
    return Object.freeze({ id: `soldier-${rosterIndex + 1}`, name: `${surname}${given}`,
      ageAtDeath: rosterIndex === 0 ? 25 : 18 + (rosterIndex * 7 + 4) % 21 });
  })));

export function createSoldierMemorialAllocator(seed = Date.now()) {
  if (!Number.isFinite(seed)) throw new RangeError('Soldier memorial seed must be finite');
  let state = Math.trunc(seed) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const order = Array.from({ length: SOLDIER_MEMORIAL_ROSTER.length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [order[index], order[target]] = [order[target], order[index]];
  }
  let cursor = 0;
  return {
    next({ year, unitName }) {
      if (!Number.isInteger(year) || year < 1900 || year > 2100 ||
        typeof unitName !== 'string' || !unitName.trim()) {
        throw new RangeError('Soldier memorial requires a valid year and unit name');
      }
      const person = SOLDIER_MEMORIAL_ROSTER[order[cursor++ % order.length]];
      return Object.freeze({ id: person.id, name: person.name,
        unitName: unitName.trim(),
        birthYear: year - person.ageAtDeath, deathYear: year });
    },
  };
}
