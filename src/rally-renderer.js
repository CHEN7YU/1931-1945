import { rallyPointModel } from './world.js';

export function createRallyRenderer(scene) {
  const views = new Map();
  const update = points => {
    const live = points.filter(point => point.kind === 'rally' && point.health > 0 && point.enabled !== false);
    const ids = new Set(live.map(point => point.id));
    if (ids.size !== live.length) throw new Error('Duplicate live rally identity');
    for (const [id, view] of views) if (!ids.has(id)) {
      scene.remove(view.model);
      views.delete(id);
    }
    for (const point of live) {
      if (!views.has(point.id)) {
        const model = rallyPointModel(point.team);
        model.traverse(object => { if (object.isMesh) object.userData.rallyId = point.id; });
        views.set(point.id, { model, team: point.team });
        scene.add(model);
      }
      const view = views.get(point.id);
      if (view.team !== point.team) throw new Error('A rally identity cannot be reused by a different team');
      view.model.position.set(point.x, point.altitude, point.z);
      view.model.updateMatrixWorld(true);
    }
    return live;
  };
  return {
    update,
    targets(points) { return update(points).map(point => views.get(point.id).model); },
    clear() {
      for (const view of views.values()) scene.remove(view.model);
      views.clear();
    },
    get snapshot() { return { count: views.size, ids: [...views.keys()] }; },
  };
}
