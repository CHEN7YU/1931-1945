import { DynamicDrawUsage } from 'three';

export function createGrenadeSupport(solids, groundHeight, dynamicClear = () => true) {
  const slots = new Map(solids.map((object, index) => [object, index]));
  const disposed = new WeakSet(), observed = new WeakSet();
  return {
    mesh(object, point, radius) {
      const slot = slots.get(object), geometry = object.geometry;
      if (slot === undefined || !object.isMesh || object.isInstancedMesh || object.isSkinnedMesh ||
        object.userData.doorId || object.userData.doorIds || object.userData.vehicleId ||
        object.morphTargetInfluences?.length || disposed.has(geometry) ||
        geometry.attributes.position.usage === DynamicDrawUsage) return null;
      if (!observed.has(geometry)) {
        observed.add(geometry);
        geometry.addEventListener('dispose', () => disposed.add(geometry));
      }
      const matrix = [...object.matrixWorld.elements], position = geometry.attributes.position;
      const index = geometry.index, positionVersion = position.version, indexVersion = index?.version;
      const range = { ...geometry.drawRange }, raycast = object.raycast, material = object.material;
      const materials = (Array.isArray(material) ? material : [material]).map(value => ({ value, side: value.side }));
      const location = { ...point };
      return () => dynamicClear(location, radius) && solids[slot] === object && object.geometry === geometry && !disposed.has(geometry) &&
        geometry.attributes.position === position && position.version === positionVersion &&
        geometry.index === index && index?.version === indexVersion &&
        geometry.drawRange.start === range.start && geometry.drawRange.count === range.count &&
        object.raycast === raycast && object.material === material &&
        materials.every(({ value, side }, i) => (Array.isArray(object.material) ? object.material[i] : object.material) === value && value.side === side) &&
        object.matrixWorld.elements.every((value, i) => value === matrix[i]);
    },
    ground(position, radius) {
      const { x, z } = position, height = groundHeight(x, z);
      const location = { ...position };
      return () => dynamicClear(location, radius) && groundHeight(x, z) === height;
    },
  };
}
