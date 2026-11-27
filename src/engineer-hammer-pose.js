import { Matrix4, Quaternion, Vector3 } from 'three';

export const HAMMER_GRIP_RADIUS = .014;

export function hammerHandFrame(shoulder, wrist, pole, lengths, shaftHint) {
  const [upper, lower] = lengths;
  const direction = wrist.clone().sub(shoulder), distance = direction.length();
  if (![upper, lower, distance].every(Number.isFinite) || distance >= upper + lower ||
    distance <= Math.abs(upper - lower)) throw new RangeError('Hammer wrist is outside the native arm reach');
  direction.divideScalar(distance);
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) throw new RangeError('Hammer elbow direction is parallel to the arm');
  bend.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  const forward = shaftHint.clone().normalize();
  const palm = wrist.clone().sub(elbow);
  palm.addScaledVector(forward, -palm.dot(forward));
  if (palm.lengthSq() < 1e-8) throw new RangeError('Hammer palm cannot align with the shaft');
  palm.normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward, palm,
    new Vector3().crossVectors(forward, palm)));
}
