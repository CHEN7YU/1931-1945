export function nativeDischargerPresentation(actor) {
  return Boolean(actor?.health > 0 && actor.discharger?.presentationActive === true &&
    actor.tactics?.mode === 'operate-grenade-discharger');
}

export function nativeSupportWeaponPresentation(actor) {
  return Boolean(actor?.formation?.sihangDemolition) || nativeDischargerPresentation(actor) || Boolean(actor?.health > 0 &&
    (actor.sihangShield?.active || actor.supportWeaponPose?.active)) || Boolean(actor?.health > 0 &&
    !actor.vehicleId && actor.emplacementId);
}
