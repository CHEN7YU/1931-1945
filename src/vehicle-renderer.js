import { tankModel, planeModel } from './world.js';
import { chiHaModel, animateChiHa } from './chi-ha-model.js';
import { CHI_HA } from './chi-ha.js';

export function createVehicleRenderer(scene) {
  const views = new Map();
  const remove = view => {
    scene.remove(view.model);
    view.model.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  };
  return {
    update(vehicles, time = 0, cockpitVehicleId = null) {
      if (!Number.isFinite(time) || time < 0) throw new RangeError('Vehicle presentation time must be finite and non-negative');
      const records = [...vehicles], ids = new Set(records.map(vehicle => vehicle.id));
      if (ids.size !== records.length) throw new Error('Duplicate vehicle view identity');
      for (const [id, view] of views) if (!ids.has(id)) {
        remove(view);
        views.delete(id);
      }
      for (const vehicle of records) {
        if (!['tank', 'plane'].includes(vehicle.type) || !vehicle.position ||
          !Number.isFinite(vehicle.position.x) || !Number.isFinite(vehicle.position.y) || !Number.isFinite(vehicle.position.z) ||
          !Number.isFinite(vehicle.heading) || !Number.isFinite(vehicle.pitch) || !Number.isFinite(vehicle.roll) ||
          !Number.isFinite(vehicle.turretYaw) || !Number.isFinite(vehicle.turretPitch)) throw new Error('Vehicle projection requires an owned finite pose');
        if (vehicle.variant != null && (vehicle.variant !== CHI_HA.id || vehicle.type !== 'tank' ||
          !Number.isFinite(vehicle.trackDistance) || !Number.isFinite(vehicle.turretPitch))) {
          throw new Error('Vehicle projection requires a known variant and finite track/gun pose');
        }
        if (!views.has(vehicle.id)) {
          const model = vehicle.variant === CHI_HA.id ? chiHaModel() : vehicle.type === 'tank' ? tankModel() : planeModel(vehicle.team);
          model.traverse(object => { if (object.isMesh) object.userData.vehicleId = vehicle.id; });
          views.set(vehicle.id, { model, type: vehicle.type, variant: vehicle.variant });
          scene.add(model);
        }
        const view = views.get(vehicle.id);
        if (view.type !== vehicle.type) throw new Error('A vehicle identity cannot change model type');
        if (view.variant !== vehicle.variant) throw new Error('A vehicle identity cannot change model variant');
        view.model.visible = vehicle.id !== cockpitVehicleId;
        view.model.position.copy(vehicle.position);
        view.model.rotation.set(vehicle.type === 'plane' ? vehicle.pitch : 0, vehicle.heading, vehicle.type === 'plane' ? vehicle.roll : 0);
        if (vehicle.type === 'tank') {
          view.model.userData.turret.rotation.y = vehicle.turretYaw - vehicle.heading;
          view.model.userData.gun.rotation.x = vehicle.turretPitch;
        } else if (vehicle.health > 0) view.model.userData.propeller.rotation.z = time * 95;
        if (vehicle.variant === CHI_HA.id) {
          if (!vehicle.machineGuns?.every(gun => Number.isFinite(gun.yaw) && Number.isFinite(gun.pitch))) {
            throw new Error('Vehicle projection requires finite owned machine-gun poses');
          }
          animateChiHa(view.model, vehicle.trackDistance, vehicle.turretPitch, vehicle.health <= 0, vehicle.machineGuns);
        }
        view.model.updateMatrixWorld(true);
      }
    },
    model(id) {
      const view = views.get(id);
      if (!view) throw new Error(`Vehicle geometry has no registered view: ${id}`);
      return view.model;
    },
    clear() {
      for (const view of views.values()) remove(view);
      views.clear();
    },
    get snapshot() { return { count: views.size, ids: [...views.keys()] }; },
  };
}
