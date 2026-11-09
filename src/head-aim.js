import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { rifleStockSection } from './rifle-contacts.js';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const bounds = [[-.9, .8], [-.7, .3], [-.7, .15], [-.65, .65]];
const cache = new WeakMap();
const headBases = new WeakMap();
const vector = values => new Vector3().fromArray(values);
const quaternion = values => new Quaternion().fromArray(values);
const point = bone => bone.getWorldPosition(new Vector3());
const headBaseInputs = pose => [pose.upright, pose.idleTime, pose.hipDrop, pose.bodyLean, pose.torsoYaw,
  pose.upperBody?.yaw ?? 0, pose.upperBody?.pitch ?? 0, pose.upperBody?.roll ?? 0,
  pose.upperBody?.lift ?? 0, pose.upperBody?.lateral ?? 0,
  ...Object.entries(pose.postures).flat()];

function channel(track, time, rotation) {
  if (track.times.length === 1) return rotation ? quaternion(track.values) : vector(track.values);
  let low = 0, high = track.times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (track.times[middle] <= time) low = middle;
    else high = middle;
  }
  const weight = Math.max(0, Math.min(1, (time - track.times[low]) / (track.times[high] - track.times[low])));
  const size = rotation ? 4 : 3;
  return rotation ? new Quaternion().fromArray(track.values, low * size).slerp(new Quaternion().fromArray(track.values, high * size), weight)
    : new Vector3().fromArray(track.values, low * size).lerp(new Vector3().fromArray(track.values, high * size), weight);
}

function clipChannels(clip, names) {
  const result = {};
  for (const track of clip.tracks) {
    const match = track.name.match(/^(?:\.bones\[([^\]]+)\]|([^.[\]]+))\.(position|quaternion|scale)$/);
    if (!match || !names.has(match[1] ?? match[2])) continue;
    const name = match[1] ?? match[2];
    (result[name] ??= {})[match[3]] = { times: Array.from(track.times), values: Array.from(track.values) };
  }
  return result;
}

function skinSample(mesh, indices) {
  const sums = new Map(), p = new Vector3();
  for (const index of indices) for (let slot = 0; slot < 4; slot++) {
    const weight = mesh.geometry.attributes.skinWeight.getComponent(index, slot) / indices.length;
    if (!weight) continue;
    const boneIndex = mesh.geometry.attributes.skinIndex.getComponent(index, slot);
    const name = mesh.skeleton.bones[boneIndex].name;
    if (!sums.has(name)) sums.set(name, { point: new Vector3(), weight: 0 });
    const sum = sums.get(name);
    p.fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(mesh.bindMatrix)
      .applyMatrix4(mesh.skeleton.boneInverses[boneIndex]);
    sum.point.addScaledVector(p, weight); sum.weight += weight;
  }
  return [...sums].map(([bone, sum]) => ({ bone, point: sum.point.divideScalar(sum.weight).toArray(), weight: sum.weight }));
}

function projectSkin(sample, base, neckRotation, headPosition, headRotation) {
  const result = new Vector3();
  for (const influence of sample) {
    const bone = base[influence.bone];
    if (!bone) throw new Error(`Head skin references an uncalibrated bone: ${influence.bone}`);
    const rotation = influence.bone === 'Head' ? headRotation : influence.bone === 'Neck' ? neckRotation : bone.rotation;
    const position = influence.bone === 'Head' ? headPosition : bone.position;
    result.addScaledVector(vector(influence.point).multiply(bone.scale).applyQuaternion(rotation).add(position), influence.weight);
  }
  return result;
}

function headSurfaces(root, bones, meshes) {
  root.updateMatrixWorld(true);
  const head = bones.get('Head');
  const hp = point(head), eyeCandidates = [];
  for (const mesh of meshes) {
    if (!mesh.isSkinnedMesh || !mesh.material?.map) continue;
    const box = new Box3().setFromObject(mesh, true), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
    if (size.x > .04 && size.x < .15 && size.y > .005 && size.y < .05 && size.z < .05 &&
      center.y - hp.y > .04 && center.y - hp.y < .16) eyeCandidates.push(mesh);
  }
  if (eyeCandidates.length !== 1) throw new Error(`Expected one inspected eye surface, found ${eyeCandidates.length}`);
  const eyes = [new Vector3(), new Vector3()], indices = [[], []];
  const p = new Vector3();
  for (let i = 0; i < eyeCandidates[0].geometry.attributes.position.count; i++) {
    eyeCandidates[0].getVertexPosition(i, p).applyMatrix4(eyeCandidates[0].matrixWorld);
    const side = p.x > hp.x ? 1 : 0;
    eyes[side].add(p); indices[side].push(i);
  }
  if (indices.some(list => list.length === 0)) throw new Error('Eye surface does not contain two identifiable eyes');
  eyes.forEach((value, i) => value.divideScalar(indices[i].length));
  const rightEye = eyes[1], leftEye = eyes[0];
  const cheekTarget = rightEye.clone().add(new Vector3(.025, -.073, .005));
  let cheek = null, cheekMesh = null, cheekIndex = -1, nearest = Infinity;
  for (const mesh of meshes) {
    if (!mesh.isSkinnedMesh || !(mesh.userData.skinRegion || mesh.name === '\u81c9\u90e8')) continue;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      const distance = p.distanceToSquared(cheekTarget);
      if (distance < nearest) { nearest = distance; cheek = p.clone(); cheekMesh = mesh; cheekIndex = i; }
    }
  }
  if (!cheek || nearest > .025 ** 2) throw new Error('Cannot calibrate a real lower-cheek contact surface');
  return { head, rightEye, leftEye, cheek, eyeMesh: eyeCandidates[0], indices, cheekMesh, cheekIndex };
}

export function createHeadAimProfile(root, bones, idle, postures, meshes) {
  const head = bones.get('Head'), neck = bones.get('Neck'), spine = bones.get('Spine');
  if (!head || !neck || !spine || head.parent !== neck) throw new Error('Head aiming requires the inspected neck/head chain');
  const surface = headSurfaces(root, bones, meshes);
  const chain = [];
  for (let node = head; node; node = node.parent) {
    chain.unshift({ name: node.isBone ? node.name : null, position: node.position.toArray(),
      rotation: node.quaternion.toArray(), scale: node.scale.toArray() });
    if (node === root) break;
  }
  const names = new Set(chain.map(node => node.name).filter(Boolean));
  const samples = { eye: skinSample(surface.eyeMesh, surface.indices[1]), leftEye: skinSample(surface.eyeMesh, surface.indices[0]),
    cheek: skinSample(surface.cheekMesh, [surface.cheekIndex]) };
  for (const sample of Object.values(samples)) for (const influence of sample) {
    if (!names.has(influence.bone)) throw new Error(`Facial landmark includes an unsupported skin bone: ${influence.bone}`);
  }
  const restRotation = head.getWorldQuaternion(new Quaternion()), inverse = restRotation.clone().invert();
  return {
    chain, samples, channels: { standing: clipChannels(idle, names),
      ...Object.fromEntries(Object.entries(postures).map(([name, value]) => [name, clipChannels(value.clip, names)])) },
    restRotation: restRotation.toArray(),
    forward: new Vector3(0, 0, -1).applyQuaternion(inverse).toArray(),
  };
}

function baseHead(profile, pose, goal = null) {
  const inputs = headBaseInputs(pose), retained = goal && headBases.get(goal);
  if (retained?.profile === profile && inputs.length === retained.inputs.length &&
    inputs.every((value, index) => Object.is(value, retained.inputs[index]))) return retained.result;
  const clips = [['standing', pose.upright, pose.idleTime],
    ...Object.entries(pose.postures).map(([name, weight]) => [name, weight, 0])].filter(([, weight]) => weight > 0);
  const matrix = new Matrix4(), local = new Matrix4(), result = {};
  for (const node of profile.chain) {
    const position = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
    let accumulated = 0;
    for (const [name, weight, time] of clips) {
      const tracks = node.name ? profile.channels[name]?.[node.name] : null;
      position.addScaledVector(tracks?.position ? channel(tracks.position, time, false) : vector(node.position), weight);
      scale.addScaledVector(tracks?.scale ? channel(tracks.scale, time, false) : vector(node.scale), weight);
      const q = tracks?.quaternion ? channel(tracks.quaternion, time, true) : quaternion(node.rotation);
      if (!accumulated) rotation.copy(q);
      else rotation.slerp(q, weight / (accumulated + weight));
      accumulated += weight;
    }
    local.compose(position, rotation, scale); matrix.multiply(local);
    if (node.name) {
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
      matrix.decompose(position, rotation, scale);
      result[node.name] = { position, rotation, scale };
    }
  }
  const originalHead = result.Head.rotation.clone();
  const pivot = result.Spine.position.clone(); pivot.y -= pose.hipDrop;
  const upper = pose.upperBody ?? {};
  const delta = new Quaternion().setFromAxisAngle(Z, upper.roll ?? 0)
    .multiply(new Quaternion().setFromAxisAngle(X, -pose.bodyLean + (upper.pitch ?? 0)))
    .multiply(new Quaternion().setFromAxisAngle(Y, pose.torsoYaw + (upper.yaw ?? 0)));
  const translation = new Vector3(upper.lateral ?? 0, upper.lift ?? 0, 0);
  let afterSpine = false;
  for (const [name, bone] of Object.entries(result)) {
    bone.position.y -= pose.hipDrop;
    if (name === 'Spine') afterSpine = true;
    if (!afterSpine) continue;
    bone.position.sub(pivot).applyQuaternion(delta).add(pivot).add(translation);
    bone.rotation.premultiply(delta);
  }
  result.Head.rotation.copy(originalHead)
    .premultiply(new Quaternion().setFromAxisAngle(X, -.2 * pose.bodyLean + .2 * (upper.pitch ?? 0)))
    .premultiply(new Quaternion().setFromAxisAngle(Z, .2 * (upper.roll ?? 0)));
  if (goal) headBases.set(goal, { profile, inputs, result });
  return result;
}

function woodDistance(p) {
  const z = Math.max(-.73, Math.min(.22, p.z)), [center, width, height] = rifleStockSection(z);
  const radial = (Math.hypot(p.x / width, (p.y - center) / height) - 1) * Math.min(width, height);
  return Math.abs(p.z - z) > 0 ? Math.hypot(Math.max(0, radial), p.z - z) : radial;
}

function boundedStep(derivatives, error, parameters) {
  let free = parameters.map((_, i) => i), result = parameters.map(() => 0);
  for (let pass = 0; pass <= parameters.length && free.length; pass++) {
    const a = free.map(i => free.map(j => derivatives[i].reduce((sum, value, row) =>
      sum + value * derivatives[j][row], 0) + (i === j ? .000001 : 0)));
    const b = free.map(i => -derivatives[i].reduce((sum, value, row) => sum + value * error[row], 0));
    for (let column = 0; column < free.length; column++) {
      const divisor = a[column][column];
      for (let j = column; j < free.length; j++) a[column][j] /= divisor;
      b[column] /= divisor;
      for (let row = 0; row < free.length; row++) if (row !== column) {
        const factor = a[row][column];
        for (let j = column; j < free.length; j++) a[row][j] -= factor * a[column][j];
        b[row] -= factor * b[column];
      }
    }
    result = parameters.map(() => 0);
    free.forEach((index, i) => { result[index] = b[i]; });
    const blocked = free.filter(i => parameters[i] <= bounds[i][0] + 1e-8 && result[i] < 0 ||
      parameters[i] >= bounds[i][1] - 1e-8 && result[i] > 0);
    if (!blocked.length) break;
    free = free.filter(i => !blocked.includes(i));
    if (!free.length) return parameters.map(() => 0);
  }
  return result;
}

function solve(profile, base, gunPosition, gunRotation, initial) {
  const inverse = gunRotation.clone().invert(), relative = base.Head.position.clone().sub(base.Neck.position);
  const rest = quaternion(profile.restRotation);
  const evaluate = parameters => {
    const neck = new Quaternion().setFromAxisAngle(Z, parameters[1])
      .multiply(new Quaternion().setFromAxisAngle(Y, parameters[3]))
      .multiply(new Quaternion().setFromAxisAngle(X, parameters[0]));
    const head = gunRotation.clone().multiply(new Quaternion().setFromAxisAngle(Z, parameters[2])).multiply(rest);
    const headPosition = relative.clone().applyQuaternion(neck).add(base.Neck.position);
    const neckRotation = neck.clone().multiply(base.Neck.rotation);
    const eye = projectSkin(profile.samples.eye, base, neckRotation, headPosition, head).sub(gunPosition).applyQuaternion(inverse);
    const cheek = projectSkin(profile.samples.cheek, base, neckRotation, headPosition, head).sub(gunPosition).applyQuaternion(inverse);
    const contact = woodDistance(cheek);
    // Skin contact has a small tolerance; sight alignment does not.
    return { error: [eye.x, eye.y - .05, Math.sign(contact) * Math.max(0, Math.abs(contact) - .002)], neck, head, headPosition };
  };
  let parameters = initial.slice(), current = evaluate(parameters);
  const norm = values => values.reduce((sum, value) => sum + value * value, 0);
  let iterations = 0, stalled = false;
  for (let iteration = 0; iteration < 32 && norm(current.error) > 1e-8; iteration++) {
    iterations++;
    const derivatives = parameters.map((_, column) => {
      const test = parameters.slice(); test[column] += .0001;
      return evaluate(test).error.map((value, row) => (value - current.error[row]) / .0001);
    });
    const b = boundedStep(derivatives, current.error, parameters);
    let improved = false;
    const trust = Math.min(1, .2 / Math.max(...b.map(Math.abs), 1e-8));
    for (const fraction of [1, .5, .25, .125]) {
      const next = parameters.map((value, i) => Math.max(bounds[i][0], Math.min(bounds[i][1],
        value + b[i] * trust * fraction)));
      const candidate = evaluate(next);
      if (norm(candidate.error) < norm(current.error)) { parameters = next; current = candidate; improved = true; break; }
    }
    if (!improved) { stalled = true; break; }
  }
  return { ...current, parameters, iterations, stalled };
}

export function solveHeadAimGoal(profile, pose, previous = null) {
  const base = baseHead(profile, pose, previous), gunPosition = vector(pose.weaponPosition), gunRotation = quaternion(pose.weaponQuaternion);
  const prior = previous?.parameters ?? [-.4, -.35, -.3, 0], cost = result => result.error.reduce((sum, value) => sum + value * value, 0);
  let solved = null;
  for (const seed of [prior, [-.7, -.5, -.4, .2], [.2, -.4, -.3, -.2]]) {
    const candidate = solve(profile, base, gunPosition, gunRotation, seed);
    if (!solved || cost(candidate) < cost(solved)) solved = candidate;
    if (Math.hypot(solved.error[0], solved.error[1]) < .001 && Math.abs(solved.error[2]) < .003) break;
  }
  const result = Object.freeze({ neckRotation: Object.freeze(solved.neck.toArray()), headRotation: Object.freeze(solved.head.toArray()),
    parameters: Object.freeze(solved.parameters), iterations: solved.iterations, stalled: solved.stalled });
  headBases.set(result, { profile, inputs: headBaseInputs(pose), result: base });
  return result;
}

export function projectUnaimedEye(profile, pose) {
  const base = baseHead(profile, pose), neck = new Quaternion();
  const headPosition = base.Head.position.clone().sub(base.Neck.position).applyQuaternion(neck).add(base.Neck.position);
  const neckRotation = neck.clone().multiply(base.Neck.rotation);
  return Object.freeze(projectSkin(profile.samples.eye, base, neckRotation, headPosition, base.Head.rotation).toArray());
}

export function projectHeadAim(profile, pose, motion) {
  const key = [pose.idleTime, pose.hipDrop, pose.bodyLean, pose.torsoYaw, pose.lowReady, motion.cheekWeight,
    pose.upperBody?.yaw ?? 0, pose.upperBody?.pitch ?? 0, pose.upperBody?.roll ?? 0,
    pose.upperBody?.lift ?? 0, pose.upperBody?.lateral ?? 0,
    ...Object.values(pose.postures), ...pose.weaponPosition, ...pose.weaponQuaternion].join(',');
  const retained = cache.get(motion), goal = motion.headGoal, weight = motion.cheekWeight;
  if (retained?.key === key && retained.goal === goal) return retained.result;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1 || weight > 0 && !goal) throw new Error('Aimed head requires its simulation-owned target');
  const base = baseHead(profile, pose, goal), gunPosition = vector(pose.weaponPosition), gunRotation = quaternion(pose.weaponQuaternion);
  const neck = goal ? new Quaternion().slerp(quaternion(goal.neckRotation), weight) : new Quaternion();
  const headPosition = base.Head.position.clone().sub(base.Neck.position).applyQuaternion(neck).add(base.Neck.position);
  const headRotation = goal ? base.Head.rotation.clone().slerp(quaternion(goal.headRotation), weight) : base.Head.rotation;
  const neckRotation = neck.clone().multiply(base.Neck.rotation);
  const eye = projectSkin(profile.samples.eye, base, neckRotation, headPosition, headRotation);
  const leftEye = projectSkin(profile.samples.leftEye, base, neckRotation, headPosition, headRotation);
  const cheek = projectSkin(profile.samples.cheek, base, neckRotation, headPosition, headRotation);
  const localEye = eye.clone().sub(gunPosition).applyQuaternion(gunRotation.clone().invert());
  const localCheek = cheek.clone().sub(gunPosition).applyQuaternion(gunRotation.clone().invert());
  const gaze = vector(profile.forward).applyQuaternion(headRotation);
  const barrel = new Vector3(0, 0, -1).applyQuaternion(gunRotation);
  const result = Object.freeze({ weight, eye: Object.freeze(eye.toArray()), leftEye: Object.freeze(leftEye.toArray()),
    cheek: Object.freeze(cheek.toArray()), head: Object.freeze(headPosition.toArray()),
    neckRotation: Object.freeze(neck.toArray()), headRotation: Object.freeze(headRotation.toArray()),
    parameters: goal?.parameters ?? Object.freeze([0, 0, 0, 0]), sightError: Math.hypot(localEye.x, localEye.y - .05),
    solverIterations: goal?.iterations ?? 0, solverStalled: goal?.stalled ?? false,
    cheekError: Math.abs(woodDistance(localCheek)), eyeRelief: localEye.z + .36,
    gazeError: gaze.angleTo(barrel) });
  cache.set(motion, { key, goal, result });
  return result;
}

export function applyHeadAim(root, bones, pose) {
  if (!pose) return;
  const neck = bones.get('Neck'), head = bones.get('Head');
  const facing = root.getWorldQuaternion(new Quaternion());
  const world = facing.clone().multiply(quaternion(pose.neckRotation)).multiply(facing.clone().invert())
    .multiply(neck.getWorldQuaternion(new Quaternion()));
  neck.quaternion.copy(neck.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
  neck.updateMatrixWorld(true);
  head.quaternion.copy(head.parent.getWorldQuaternion(new Quaternion()).invert()
    .multiply(facing.multiply(quaternion(pose.headRotation))));
  head.updateMatrixWorld(true);
}

export function createHeadAimProbe(root, bones, meshes) {
  const surface = headSurfaces(root, bones, meshes);
  return (pose, weapon) => {
    const eye = new Vector3(), p = new Vector3();
    for (const index of surface.indices[1]) {
      surface.eyeMesh.getVertexPosition(index, p).applyMatrix4(surface.eyeMesh.matrixWorld);
      eye.add(p);
    }
    eye.divideScalar(surface.indices[1].length);
    const cheek = surface.cheekMesh.getVertexPosition(surface.cheekIndex, new Vector3()).applyMatrix4(surface.cheekMesh.matrixWorld);
    const facing = root.getWorldQuaternion(new Quaternion());
    const inverse = quaternion(weapon.weaponQuaternion).invert(), origin = vector(weapon.weaponPosition);
    const localEye = root.worldToLocal(eye.clone()).sub(origin).applyQuaternion(inverse);
    const localCheek = root.worldToLocal(cheek.clone()).sub(origin).applyQuaternion(inverse);
    return { ...pose, actualEye: eye.toArray(), actualCheek: cheek.toArray(), actualHead: point(bones.get('Head')).toArray(),
      actualSightError: Math.hypot(localEye.x, localEye.y - .05), actualCheekError: Math.abs(woodDistance(localCheek)),
      projectionError: eye.distanceTo(vector(pose.eye).applyQuaternion(facing).add(root.position)),
      cheekProjectionError: cheek.distanceTo(vector(pose.cheek).applyQuaternion(facing).add(root.position)) };
  };
}
