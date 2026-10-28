export const SCORE_ICON_PATHS = Object.freeze({
  rifle: 'M3 19l5-6 4 2 14-10 2 2-14 10-1 4-4-2-3 3z M14 13l3 3',
  sniper: 'M3 19l5-6 4 2 14-10 2 2-14 10-1 4-4-2-3 3z M16 6l7-4 2 3-7 4z M17 8l1 3',
  'machine-gun': 'M3 17h7l5-7 13-2v3l-12 2-4 7H8v-3 M15 10V5h6v5 M23 12l-3 9 M23 12l5 8',
  grenade: 'M13 8h7l4 4v7l-4 3h-7l-4-3v-7z M14 8V5h5v3 M18 5l5 5 M17 3a3 3 0 1 1 5 0',
  'explosive-pack': 'M5 8h22v11H5z M5 11h22 M5 15h22 M10 7v13 M22 7v13 M13 8V4h5l4 4',
  tank: 'M5 14h22l3 6H2z M8 14V9h12l4 5 M16 10V6h5 M19 9h12 M6 18h20',
  'tank-machine-gun': 'M5 14h22l3 6H2z M8 14V9h12l4 5 M6 18h20 M19 9h9 M27 5h4 M29 9h2 M27 13h4',
  mortar: 'M9 19l10-15 4 3-10 15 M17 11l9 10 M17 11l-2 10 M4 22h22 M19 3l5 3',
  plane: 'M15 2h3v7l12 6v3l-12-3v5l5 2H10l5-2v-5L3 18v-3l12-6z',
  total: 'M16 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M16 1v6 M16 17v6 M5 12h6 M21 12h6',
  destroyed: 'M5 14h22l3 6H2z M8 14V9h12l4 5 M19 9h12 M5 3l20 19 M25 3L5 22',
  squad: 'M12 5a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M8 22v-5a8 8 0 0 1 16 0v5 M4 4a3 3 0 1 0 0 6 M4 14H1v8 M28 4a3 3 0 1 1 0 6 M28 14h3v8',
  player: 'M12 6a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M7 22v-5a9 9 0 0 1 18 0v5',
  clock: 'M16 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M16 5v7l5 3',
  flag: 'M7 23V2h17l-3 5 3 5H7',
});

export function scoreIcon(kind) {
  const path = SCORE_ICON_PATHS[kind];
  if (!path) throw new RangeError(`Unknown scoreboard icon: ${kind}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 24'); svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('score-icon');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path); svg.append(shape);
  return svg;
}
