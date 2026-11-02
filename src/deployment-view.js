import { deploymentMapPoint } from './deployment-map.js';

export const DEPLOYMENT_SQUADS = Object.freeze([
  { id: 'infantry', name: '步兵小队', members: 11, icon: '⚑' },
  { id: 'tank', name: '装甲车组', members: 3, icon: '▰' },
  { id: 'plane', name: '航空小队', members: 1, icon: '✈' },
]);

export function deploymentCards(container) {
  container.replaceChildren(...DEPLOYMENT_SQUADS.map(squad => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.type = squad.id; button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('strong'); name.textContent = `${squad.icon} ${squad.name}`;
    const detail = document.createElement('small'); detail.textContent = `${squad.members} 人 · 可出击`;
    button.append(name, detail);
    return button;
  }));
}

export function deploymentMarker(point, type) {
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.spawn = point.id;
  const icon = document.createElement('span'); icon.className = 'spawn-map-icon';
  icon.textContent = DEPLOYMENT_SQUADS.find(squad => squad.id === type)?.icon ?? '⚑';
  const name = document.createElement('span'); name.className = 'spawn-map-name'; name.textContent = point.name;
  button.style.left = `${(point.x + 110) / 220 * 100}%`;
  button.style.top = `${(point.z + 110) / 220 * 100}%`;
  button.append(icon, name, document.createElement('small'));
  return button;
}

export function deploymentMarkerPositions(points, view = { x: 0, z: 0, span: 220 }) {
  const placed = [];
  return points.map(point => {
    const [x, y] = deploymentMapPoint(view, point.x, point.z, 100);
    let position = { x, y };
    for (let attempt = 0; attempt <= points.length * 2; attempt++) {
      if (!placed.some(other => Math.abs(other.x - position.x) < 9 && Math.abs(other.y - position.y) < 9)) break;
      const offset = Math.ceil((attempt + 1) / 2) * 10 * (attempt % 2 ? -1 : 1);
      position = { x: Math.max(5, Math.min(95, x + offset)), y };
    }
    placed.push(position);
    return { id: point.id, ...position };
  });
}
