import { tankModel, planeModel } from './world.js';
import { chiHaModel, animateChiHa } from './chi-ha-model.js';
import { CHI_HA } from './chi-ha.js';
import { InstancedMesh, InstancedBufferAttribute, Matrix4 } from 'three';

export function createVehicleRenderer(scene) {
  const views = new Map(), wreckMaterials = new Map(), wreckBatches = new Map();
  const scratch = new Matrix4();
  const batchWreck = view => {
    view.wreckSlots = [];
    view.model.visible = true;
    view.model.traverseVisible(object => {
      if (!object.isMesh) return;
      const materialKey = (Array.isArray(object.material) ? object.material : [object.material]).map(material => material.uuid).join(':');
      const key = `${Math.floor(view.model.position.x / 32)},${Math.floor(view.model.position.z / 32)}:${object.geometry.uuid}:${materialKey}:${object.renderOrder}:${object.castShadow}:${object.receiveShadow}`;
      if (!wreckBatches.has(key)) {
        const mesh = new InstancedMesh(object.geometry, object.material, 8);
        mesh.castShadow = object.castShadow; mesh.receiveShadow = object.receiveShadow;
        mesh.renderOrder = object.renderOrder;
        mesh.count = 0; mesh.userData.wreckBatch = true; scene.add(mesh);
        wreckBatches.set(key, { mesh, slots: [], capacity: 8 });
      }
      const batch = wreckBatches.get(key);
      for (let index = 0; index < (object.isInstancedMesh ? object.count : 1); index++) {
        if (batch.slots.length === batch.capacity) {
          batch.capacity *= 2;
          const matrices = new Float32Array(batch.capacity * 16);
          matrices.set(batch.mesh.instanceMatrix.array);
          batch.mesh.instanceMatrix = new InstancedBufferAttribute(matrices, 16);
        }
        const slot = { batch, index: batch.slots.length };
        if (object.isInstancedMesh) {
          object.getMatrixAt(index, scratch); scratch.premultiply(object.matrixWorld);
        } else scratch.copy(object.matrixWorld);
        batch.mesh.setMatrixAt(slot.index, scratch);
        batch.slots.push(slot); view.wreckSlots.push(slot);
      }
      batch.mesh.count = batch.slots.length;
      batch.mesh.visible = true; batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.computeBoundingSphere();
    });
    view.model.visible = false;
  };
  const charModel = view => {
    view.model.traverse(object => {
      if (!object.isMesh) return;
      const char = source => {
        if (!wreckMaterials.has(source)) {
          const material = source.clone();
          material.color?.setHex(0x25231f);
          material.emissive?.setHex(0x000000);
          if ('roughness' in material) material.roughness = 1;
          if ('metalness' in material) material.metalness = .05;
          wreckMaterials.set(source, material);
        }
        return wreckMaterials.get(source);
      };
      object.material = Array.isArray(object.material) ? object.material.map(char) : char(object.material);
    });
    view.charred = true; view.model.userData.wreck = true;
  };
  const remove = view => {
    for (const slot of view.wreckSlots ?? []) {
      const { batch, index } = slot, last = batch.slots.pop();
      if (last !== slot) {
        batch.mesh.getMatrixAt(last.index, scratch); batch.mesh.setMatrixAt(index, scratch);
        batch.slots[index] = last; last.index = index;
      }
      batch.mesh.count = batch.slots.length;
      batch.mesh.visible = batch.mesh.count > 0;
      batch.mesh.instanceMatrix.needsUpdate = true; batch.mesh.computeBoundingSphere();
    }
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
          views.set(vehicle.id, { model, type: vehicle.type, variant: vehicle.variant, team: vehicle.team });
          scene.add(model);
        }
        const view = views.get(vehicle.id);
        if (view.type !== vehicle.type) throw new Error('A vehicle identity cannot change model type');
        if (view.team !== vehicle.team) throw new Error('A vehicle identity cannot change team');
        if (view.variant !== vehicle.variant) throw new Error('A vehicle identity cannot change model variant');
        if (view.charred) continue;
        view.model.visible = vehicle.id !== cockpitVehicleId;
        view.model.position.copy(vehicle.position);
        view.model.rotation.set(vehicle.type === 'plane' ? vehicle.pitch : 0, vehicle.heading,
          vehicle.type === 'plane' ? vehicle.roll : 0, vehicle.type === 'plane' ? 'YXZ' : 'XYZ');
        if (vehicle.type === 'tank') {
          view.model.userData.turret.rotation.y = vehicle.turretYaw - vehicle.heading;
          view.model.userData.gun.rotation.x = vehicle.turretPitch;
        } else if (vehicle.health > 0) view.model.userData.propeller.rotation.z = time * 95;
        if (vehicle.variant === CHI_HA.id && !view.charred) {
          if (!vehicle.machineGuns?.every(gun => Number.isFinite(gun.yaw) && Number.isFinite(gun.pitch))) {
            throw new Error('Vehicle projection requires finite owned machine-gun poses');
          }
          animateChiHa(view.model, vehicle.trackDistance, vehicle.turretPitch, vehicle.health <= 0, vehicle.machineGuns);
        }
        if (!view.charred && vehicle.health <= 0 && (vehicle.type === 'tank' || vehicle.fall?.grounded)) charModel(view);
        view.model.updateMatrixWorld(true);
        if (view.charred) batchWreck(view);
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
      for (const material of wreckMaterials.values()) material.dispose();
      wreckMaterials.clear();
      for (const { mesh } of wreckBatches.values()) { scene.remove(mesh); mesh.dispose(); }
      wreckBatches.clear();
    },
    get snapshot() { return { count: views.size, ids: [...views.keys()],
      wrecks: [...views.values()].filter(view => view.charred).length,
      wreckBatches: [...wreckBatches.values()].filter(batch => batch.mesh.count > 0).length }; },
  };
}
