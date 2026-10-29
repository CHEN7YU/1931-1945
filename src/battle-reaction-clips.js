export const ADDITIONAL_REACTION_CLIPS = Object.freeze([
  '1yell3', '1yell11', '2yell4', '2yell6', '3grunt1', '3grunt2',
  '3grunt6', '3yell13', '3yell16', 'yell1', 'yell2', 'yell5',
].map((name, index) => Object.freeze({
  file: `hurt-extra-${String(index + 1).padStart(2, '0')}.wav`,
  cue: 'hurt', auditionNumber: index + 1, selectionWeight: index >= 7 ? 3 : 1,
  original: `${name}.wav`, maxDuration: 4.5,
})));

export function reactionClips() {
  return [0, 1, 2].flatMap(variant => ['hurt', 'cover', 'charge'].flatMap(cue =>
    [0, 1].map(take => ({ variant, cue, take, file: `${variant}-${cue}-${take}.wav` }))))
    .concat(ADDITIONAL_REACTION_CLIPS);
}
