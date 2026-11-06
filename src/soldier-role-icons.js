import { SCORE_ICON_PATHS } from './score-icons.js';

export const SOLDIER_ROLE_PATHS = Object.freeze({
  rifleman: 'M14 4l2-3 2 3v17h-4z M14 17h4',
  sniper: 'M16 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M16 1v6 M16 17v6 M5 12h6 M21 12h6',
  mortarman: SCORE_ICON_PATHS.mortar,
  'grenade-discharger': SCORE_ICON_PATHS['grenade-discharger'],
  sapper: 'M8 3h16v13l-8 6-8-6z M12 8h8 M12 12h8 M16 6v11',
  'machine-gunner': 'M5 5l2-3 2 3v16H5z M14 5l2-3 2 3v16h-4z M23 5l2-3 2 3v16h-4z M5 17h4 M14 17h4 M23 17h4',
  dead: 'M8 10a8 8 0 0 1 16 0v6l-4 2v4h-8v-4l-4-2z M11 10h3v3h-3z M18 10h3v3h-3z M15 17h2 M15 19v3 M18 19v3',
});

export function soldierRoleIcon(role) {
  const path = SOLDIER_ROLE_PATHS[role];
  if (!path) throw new RangeError(`Unknown soldier role icon: ${role}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 24'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-role-icon', role); svg.classList.add('soldier-role-icon');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path); svg.append(shape);
  return svg;
}
