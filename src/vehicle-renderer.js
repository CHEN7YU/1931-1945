import { tankModel, planeModel } from './world.js';

export function createVehicleRenderer(scene) {
  const views = new Map();
  return {
    update(vehicles) {
      const records = [...vehicles], ids = new Set(records.map(vehicle => vehicle.id));
      if (ids.size !== records.length) throw new Error('Duplicate vehicle view identity');
      for (const [id, view] of views) if (!ids.has(id)) {
        scene.remove(view.model);
        views.delete(id);
      }
      for (const vehicle of records) {
        if (!['tank', 'plane'].includes(vehicle.type) || !vehicle.position ||
          !Number.isFinite(vehicle.position.x) || !Number.isFinite(vehicle.position.y) || !Number.isFinite(vehicle.position.z) ||
          !Number.isFinite(vehicle.heading) || !Number.isFinite(vehicle.pitch) || !Number.isFinite(vehicle.roll) ||
          !Number.isFinite(vehicle.turretYaw)) throw new Error('Vehicle projection requires an owned finite pose');
        if (!views.has(vehicle.id)) {
          const model = vehicle.type === 'tank' ? tankModel() : planeModel();
          model.traverse(object => { if (object.isMesh) object.userData.vehicleId = vehicle.id; });
          views.set(vehicle.id, { model, type: vehicle.type });
          scene.add(model);
        }
        const view = views.get(vehicle.id);
        if (view.type !== vehicle.type) throw new Error('A vehicle identity cannot change model type');
        view.model.position.copy(vehicle.position);
        view.model.rotation.set(vehicle.type === 'plane' ? vehicle.pitch : 0, vehicle.heading, vehicle.type === 'plane' ? vehicle.roll : 0);
        if (vehicle.type === 'tank') view.model.userData.turret.rotation.y = vehicle.turretYaw - vehicle.heading;
        view.model.updateMatrixWorld(true);
      }
    },
    model(id) {
      const view = views.get(id);
      if (!view) throw new Error(`Vehicle geometry has no registered view: ${id}`);
      return view.model;
    },
    clear() {
      for (const view of views.values()) scene.remove(view.model);
      views.clear();
    },
    get snapshot() { return { count: views.size, ids: [...views.keys()] }; },
  };
}
