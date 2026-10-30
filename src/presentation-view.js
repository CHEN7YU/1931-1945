import { Frustum, Matrix4, Sphere } from 'three';

export function createPresentationView(camera) {
  const frustum = new Frustum(), projection = new Matrix4(), sphere = new Sphere();
  return {
    update() {
      camera.updateWorldMatrix(true, false);
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
    },
    intersects(position, radius) {
      sphere.center.copy(position);
      // Keep a world-space apron for effects entering the image and nearby reflected light.
      sphere.radius = radius + 2;
      return frustum.intersectsSphere(sphere);
    },
  };
}
