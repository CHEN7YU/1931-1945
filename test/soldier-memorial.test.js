import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoldierMemorialAllocator, SOLDIER_MEMORIAL_ROSTER } from '../src/soldier-memorial.js';

test('the game memorial pool has 100 distinct generated names and includes the sample identity', () => {
  assert.equal(SOLDIER_MEMORIAL_ROSTER.length, 100);
  assert.equal(new Set(SOLDIER_MEMORIAL_ROSTER.map(person => person.name)).size, 100);
  assert.ok(SOLDIER_MEMORIAL_ROSTER.some(person => person.name === '汪洋'));
});

test('death cards receive a deterministic shuffled identity, unit, and campaign-year range', () => {
  const createCards = () => {
    const allocator = createSoldierMemorialAllocator(1937);
    return Array.from({ length: 100 }, () => allocator.next({ year: 1937, unitName: '国民革命军第88师' }));
  };
  const cards = createCards();
  assert.deepEqual(cards, createCards());
  assert.equal(new Set(cards.map(card => card.name)).size, 100);
  assert.ok(cards.every(card => card.unitName === '国民革命军第88师战士' &&
    card.birthYear < card.deathYear && card.deathYear === 1937));
  assert.throws(() => createSoldierMemorialAllocator(NaN), /seed/);
  assert.throws(() => createSoldierMemorialAllocator(1).next({ year: 1937, unitName: '' }), /year and unit name/);
});
