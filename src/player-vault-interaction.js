import { TRAVERSAL, findVault, beginTraversal } from './infantry-traversal.js';

export function beginFallbackVault(actor, { yaw, obstacles, heightAt, allowed = true, onStart = () => {} }) {
  if (!allowed || actor.vehicleId || actor.traversal.kind !== 'grounded') return 'unavailable';
  const plan = findVault(actor.position, yaw, obstacles, heightAt);
  if (!plan) return 'unavailable';
  if (actor.locomotion.stamina < TRAVERSAL.vaultCost) return 'stamina';
  beginTraversal(actor.traversal, actor.position, plan);
  actor.locomotion.stamina -= TRAVERSAL.vaultCost;
  actor.locomotion.regenDelay = 1.4;
  onStart(plan);
  return 'started';
}

export function resolvePlayerInteractionFallback({
  door = null, interactDoor = () => {}, dockMessage = false, showDockMessage = () => {},
  interactVehicle = () => false, tryVault = () => 'unavailable',
}) {
  if (door) {
    interactDoor(door);
    return 'door';
  }
  if (dockMessage) {
    const result = tryVault();
    if (result === 'started' || result === 'stamina') return result;
    showDockMessage();
    return 'dock-message';
  }
  if (interactVehicle()) return 'vehicle';
  return tryVault();
}
