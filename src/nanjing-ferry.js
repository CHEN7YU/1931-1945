export const NANJING_FERRY_ROUTE = Object.freeze({
  visibleStartX: -112, hiddenX: -144, speed: 2.8, offscreenSeconds: 6,
  riverWidth: 2000, riverDepth: 3000,
});

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
