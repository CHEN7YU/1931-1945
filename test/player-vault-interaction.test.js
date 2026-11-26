import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { circleBlocked } from '../src/core.js';
import { createControlInput } from '../src/control-input.js';
import { advanceTraversal, createTraversal, TRAVERSAL } from '../src/infantry-traversal.js';
import { beginFallbackVault, resolvePlayerInteractionFallback } from '../src/player-vault-interaction.js';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('F keeps real interaction priority and falls back to a collision-checked dock-fence vault', () => {
  assert.match(mainSource, /KeyF:\s*'interact'/);
  assert.match(mainSource, /resolvePlayerInteractionFallback\(/);
  const control = createControlInput();
  const owner = { unitId: 'unit', soldierId: 'soldier', vehicleId: null, seatId: null, weaponId: 'rifle' };
  control.bind(owner);

  let vaultCalls = 0, interaction = null;
  const attempt = options => {
    const command = control.capture('interact');
    const result = control.execute(command, owner, true, () => {
      interaction = resolvePlayerInteractionFallback({
        ...options,
        tryVault: () => { vaultCalls++; return 'started'; },
      });
    });
    assert.equal(result.status, 'applied');
    return interaction;
  };
  assert.equal(attempt({ door: {}, interactDoor: () => {} }), 'door');
  assert.equal(vaultCalls, 0, 'a focused door remains ahead of vaulting');
  assert.equal(attempt({ interactVehicle: () => true }), 'vehicle');
  assert.equal(vaultCalls, 0, 'an available vehicle interaction remains ahead of vaulting');
  assert.equal(attempt({ dockMessage: true, showDockMessage: () => {} }), 'started',
    'the non-interactive dock status message must not swallow a valid vault');
  assert.equal(vaultCalls, 1);
  let dockMessageShown = false;
  assert.equal(resolvePlayerInteractionFallback({
    dockMessage: true, tryVault: () => 'unavailable',
    showDockMessage: () => { dockMessageShown = true; },
  }), 'dock-message');
  assert.equal(dockMessageShown, true, 'the existing dock status remains when no vault is possible');
});

test('F vault crosses dock-fence collider geometry without disabling collision', () => {
  const ground = () => 0, obstacles = [];
  const postCount = Math.ceil(12.8 / 2.5);
  for (let index = 0; index <= postCount; index++) {
    const x = -12.8 / 2 + index * 12.8 / postCount;
    obstacles.push({ minX: x - .115, maxX: x + .115, minZ: -.115, maxZ: .115, minY: 0, height: 1.44 });
  }
  for (const [y, height] of [[.48, .17], [1.12, .17]]) {
    obstacles.push({ minX: -6.4, maxX: 6.4, minZ: -.09, maxZ: .09,
      minY: y - height / 2, height: y + height / 2 });
  }
  const control = createControlInput();
  const owner = { unitId: 'unit', soldierId: 'soldier', vehicleId: null, seatId: null, weaponId: 'rifle' };
  control.bind(owner);
  const actor = {
    position: { x: 12.8 / postCount / 2, y: 0, z: -.7 }, vehicleId: null,
    traversal: createTraversal(), locomotion: { stamina: 1, regenDelay: 0 },
  };
  let plan = null, status;
  const command = control.capture('interact');
  const execution = control.execute(command, owner, true, () => {
    status = resolvePlayerInteractionFallback({
      tryVault: () => beginFallbackVault(actor, {
        yaw: Math.PI, obstacles, heightAt: ground, onStart: value => { plan = value; },
      }),
    });
  });
  assert.equal(execution.status, 'applied');
  assert.equal(status, 'started');
  assert.equal(actor.traversal.kind, 'vaulting');
  assert.equal(actor.locomotion.stamina, 1 - TRAVERSAL.vaultCost);
  assert.ok(plan);
  assert.ok(plan.end.z > 0, 'the vault reaches the far side of the fence');
  for (let frame = 0; frame < 90 && actor.traversal.kind !== 'grounded'; frame++) {
    advanceTraversal(actor.traversal, actor.position, 1 / 60, obstacles, ground);
    assert.equal(circleBlocked(actor.position.x, actor.position.z, TRAVERSAL.radius,
      obstacles, actor.position.y, TRAVERSAL.bodyHeight), false, 'the real fence collision remains active');
  }
  assert.equal(actor.traversal.kind, 'grounded');
  assert.deepEqual(actor.position, plan.end);
});
