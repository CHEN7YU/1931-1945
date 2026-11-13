import { NANJING_BOAT_CAPACITY } from './nanjing-campaign.js';

export const NANJING_FERRY_ROUTE = Object.freeze({
  visibleStartX: -112, hiddenX: -144, speed: 2.8, offscreenSeconds: 6,
  riverWidth: 2000, riverDepth: 3000, maximumLoadingSeconds: 15,
});

export function selectCivilianBoarding(campaign, ferries, queue, now) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Civilian boarding requires simulation time');
  if (!campaign.dockActivated || campaign.boardingClock < 1 || !queue.length || !ferries.length) return null;
  const start = campaign.nextCivilianFerry ?? 0;
  for (let offset = 0; offset < ferries.length; offset++) {
    const index = (start + offset) % ferries.length, ferry = ferries[index], data = ferry.userData;
    const boat = campaign.boats.find(candidate => candidate.id === data.ferryId);
    if (!boat) throw new Error('Civilian ferry is missing its campaign boat');
    if (data.state !== 'docked' || data.boarding || data.troopBoarding ||
      boat.returning || boat.passengers >= NANJING_BOAT_CAPACITY) continue;
    const retry = data.civilianRouteRetry;
    const candidates = queue.filter(person => (retry?.get(person.userData.civilianId) ?? 0) <= now);
    if (!candidates.length) continue;
    const distance = person => (person.position.x - ferry.position.x) ** 2 + (person.position.z - ferry.position.z) ** 2;
    const civilian = candidates.reduce((nearest, person) => distance(person) < distance(nearest) ? person : nearest);
    campaign.boardingClock = 0;
    campaign.nextCivilianFerry = (index + 1) % ferries.length;
    return { ferry, civilian };
  }
  return null;
}

export function shouldDepartNanjingFerry(ferry, boat, now, allArrivalsResolved, queueLength) {
  return boat.passengers > 0 && !boat.returning && !ferry.userData.boarding &&
    (allArrivalsResolved && queueLength === 0 ||
      Number.isFinite(ferry.userData.loadedAt) && now - ferry.userData.loadedAt >= NANJING_FERRY_ROUTE.maximumLoadingSeconds);
}

export function ferryVisibility(x) {
  if (!Number.isFinite(x)) throw new RangeError('Ferry visibility requires a finite river position');
  return Math.max(0, Math.min(1, (x - NANJING_FERRY_ROUTE.hiddenX) /
    (NANJING_FERRY_ROUTE.visibleStartX - NANJING_FERRY_ROUTE.hiddenX)));
}

export function updateFerryVisibility(ferry) {
  const opacity = ferryVisibility(ferry.position.x);
  if (ferry.userData.opacity === opacity) return;
  ferry.userData.opacity = opacity;
  ferry.visible = opacity > 0;
  ferry.traverse(object => {
    if (!object.isMesh) return;
    if (object.userData.ferryOriginalMaterial === undefined) {
      object.userData.ferryOriginalMaterial = object.material;
      object.material = Array.isArray(object.material)
        ? object.material.map(material => material.clone()) : object.material.clone();
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity === 1;
    }
  });
}

export function restoreFerryPassenger(person) {
  person.traverse(object => {
    if (!object.userData.ferryOriginalMaterial) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    object.material = object.userData.ferryOriginalMaterial;
    delete object.userData.ferryOriginalMaterial;
  });
}

export function setFerryPassengerMaterial(object, material) {
  const original = object.userData.ferryOriginalMaterial;
  if (original === undefined) { object.material = material; return; }
  if (original === material) return;
  const { opacity, transparent, depthWrite } = object.material;
  object.material.copy(material);
  Object.assign(object.material, { opacity, transparent, depthWrite });
  object.material.needsUpdate = true;
  object.userData.ferryOriginalMaterial = material;
}
