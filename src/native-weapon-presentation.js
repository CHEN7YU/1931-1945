export function nativeDischargerPresentation(actor) {
  return Boolean(actor?.health > 0 && actor.discharger?.presentationActive === true &&
    actor.tactics?.mode === 'operate-grenade-discharger');
}
