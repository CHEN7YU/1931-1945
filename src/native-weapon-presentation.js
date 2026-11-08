export function nativeDischargerPresentation(actor) {
  return Boolean(actor?.health > 0 && actor.discharger?.presentationActive === true &&
    actor.tactics?.mode === 'operate-grenade-discharger');
}

export function nativeEngineerPresentation(actor) {
  return Boolean(actor?.health > 0 && !actor.vehicleId && actor.engineer?.construction.mode === 'building');
}

export function nativeSupportWeaponPresentation(actor) {
  return Boolean(actor?.formation?.sihangDemolition) || nativeEngineerPresentation(actor) || nativeDischargerPresentation(actor) || Boolean(actor?.health > 0 &&
    (actor.sihangShield?.active || actor.supportWeaponPose?.active)) || Boolean(actor?.health > 0 &&
    !actor.vehicleId && actor.emplacementId);
}
