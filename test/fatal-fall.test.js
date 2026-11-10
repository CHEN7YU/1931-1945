import test from 'node:test';
import assert from 'node:assert/strict';
import { beginFatalFall, fatalFallExpired, fatalFallActionAllowed } from '../src/fatal-fall.js';
import { landingDamage, TRAVERSAL } from '../src/infantry-traversal.js';

test('a lethal high fall grants one finite last-throw window, not immunity or healing', () => {
  const actor = { health: 100 }, damage = landingDamage(Math.sqrt(2 * TRAVERSAL.gravity * 16.8));
  assert.equal(damage, 100);
  assert.equal(beginFatalFall(actor, damage, 10, true), true);
  actor.health = 1;
  assert.equal(actor.fatalFall.deadline, 14);
  assert.equal(fatalFallExpired(actor, 13.99), false);
  assert.equal(fatalFallExpired(actor, 14), true);
  assert.equal(beginFatalFall(actor, 100, 13, true), false, 'landing again cannot extend survival');
  for (const action of ['look', 'equipGrenade', 'equipExplosivePack', 'pressFire', 'releaseGrenade'])
    assert.equal(fatalFallActionAllowed(actor, action), true);
  for (const action of ['jump', 'cycleMember', 'equipRifle', 'interact', 'reload', 'crouch'])
    assert.equal(fatalFallActionAllowed(actor, action), false);
});

test('safe falls and non-controlled actors retain normal fall damage', () => {
  assert.equal(beginFatalFall({ health: 100 }, 40, 1, true), false);
  assert.equal(beginFatalFall({ health: 100 }, 100, 1, false), false);
  assert.equal(beginFatalFall({ health: 0 }, 100, 1, true), false);
  assert.throws(() => beginFatalFall({ health: 100 }, NaN, 1, true), RangeError);
});
