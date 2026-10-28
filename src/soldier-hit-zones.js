import { Object3D, Group, Ray, Sphere, Vector3, Quaternion, Matrix4 } from 'three';
import { RIFLE } from './rifle-action.js';

const sides = ['Left', 'Right'];
const joints = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftShoulder', 'RightShoulder',
  ...sides.flatMap(side => ['Arm', 'ForeArm', 'Hand', 'HandMiddle1', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => side + name))];
const up = new Vector3(0, 1, 0), sphere = new Sphere(new Vector3(), 1);

export function readAnatomicalBones(bones) {
  return Object.fromEntries(joints.map(name => {
    const bone = bones.get(name);
    if (!bone?.isBone) throw new Error(`Missing anatomical joint: ${name}`);
    return [name, bone.getWorldPosition(new Vector3())];
  }));
}

export function createHitPoseSampler(createView) {
  let view = null;
  return (actor, now) => {
    view ??= createView();
    if (view.actorId !== actor.id) view.bind(actor.id);
    view.update(actor, now, null);
    return view.anatomy;
  };
}

class HitEllipsoid extends Object3D {
  constructor(actor, zone, part) {
    super();
    this.userData = { actor, hitZone: zone, bodyPart: part };
  }
  raycast(raycaster, intersections) {
    const inverse = new Matrix4().copy(this.matrixWorld).invert();
    const localRay = new Ray().copy(raycaster.ray).applyMatrix4(inverse);
    const localHit = localRay.intersectSphere(sphere, new Vector3());
    if (!localHit) return;
    const point = localHit.applyMatrix4(this.matrixWorld), distance = point.distanceTo(raycaster.ray.origin);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersections.push({ distance, point, object: this, face: null });
  }
}

function proceduralBones(actor) {
  const lowered = actor.stance === 'crouched', prone = actor.stance === 'prone';
  const drop = lowered ? .62 : 0;
  const local = {
    Hips: [0, .98 - drop, 0], Spine: [0, 1.1 - drop, 0], Spine2: [0, 1.34 - drop, 0],
    Neck: [0, 1.49 - drop, 0], Head: [0, 1.54 - drop, -.015], HeadTop_End: [0, 1.76 - drop, -.015],
  };
  if (prone) Object.assign(local, { Hips: [0, .25, .08], Spine: [0, .25, -.06],
    Spine2: [0, .25, -.3], Neck: [0, .28, -.45], Head: [0, .32, -.55], HeadTop_End: [0, .52, -.55] });
  for (const [index, side] of sides.entries()) {
    const sign = index ? 1 : -1;
    Object.assign(local, {
      [side + 'Arm']: [sign * .24, 1.32 - drop, 0],
      [side + 'Shoulder']: [sign * .12, 1.4 - drop, 0],
      [side + 'ForeArm']: [sign * .22, 1.13 - drop, -.22],
      [side + 'Hand']: [index ? .173 : .1, 1.325 - drop, index ? -.095 : -.43],
      [side + 'HandMiddle1']: [index ? .173 : .1, 1.325 - drop, index ? -.15 : -.49],
      [side + 'UpLeg']: [sign * .135, .94 - drop, 0],
      [side + 'Leg']: [sign * .135, lowered ? index ? .08 : .5 : .48, lowered ? index ? .3 : -.32 : 0],
      [side + 'Foot']: [sign * .135, lowered && index ? .22 : .09, lowered ? index ? .65 : -.32 : -.02],
      [side + 'ToeBase']: [sign * .135, .04, lowered ? index ? .77 : -.46 : -.17],
    });
    if (prone) Object.assign(local, {
      [side + 'Arm']: [sign * .24, .26, -.35], [side + 'ForeArm']: [sign * .25, .15, -.68],
      [side + 'Shoulder']: [sign * .12, .26, -.35],
      [side + 'Hand']: [sign * .12, .32, -.88], [side + 'HandMiddle1']: [sign * .12, .32, -.94],
      [side + 'UpLeg']: [sign * .135, .25, .12], [side + 'Leg']: [sign * .135, .12, .5],
      [side + 'Foot']: [sign * .135, .22, .84], [side + 'ToeBase']: [sign * .135, .1, .95],
    });
  }
  const facing = new Quaternion().setFromAxisAngle(up, actor.heading);
  return Object.fromEntries(Object.entries(local).map(([name, value]) =>
    [name, new Vector3(...value).applyQuaternion(facing).add(actor.position)]));
}

export function createSoldierHitSystem(sampleNative) {
  if (typeof sampleNative !== 'function') throw new TypeError('Anatomical collision requires a native-pose sampler');
  const proxies = new WeakMap();
  return {
    sync(actor, now) {
      if (!actor?.id || actor.health <= 0 || actor.vehicleId || !Number.isFinite(now) ||
        !Number.isFinite(actor.heading) || !['x', 'y', 'z'].every(axis => Number.isFinite(actor.position?.[axis]))) {
        throw new Error('Anatomical collision requires a living unseated soldier and finite owned pose');
      }
      const points = actor.nativeMotion ? sampleNative(actor, now) : proceduralBones(actor);
      if (joints.some(name => !points[name]?.isVector3 || !points[name].toArray().every(Number.isFinite))) {
        throw new Error('Anatomical pose has missing or invalid body joints');
      }
      let proxy = proxies.get(actor);
      if (!proxy) {
        proxy = new Group();
        proxies.set(actor, proxy);
      }
      let index = 0;
      const facing = new Quaternion().setFromAxisAngle(up, actor.heading), inverseFacing = facing.clone().invert();
      const segment = (part, zone, from, to, width, depth = width, padding = width * .6) => {
        const a = points[from], b = points[to], direction = b.clone().sub(a), length = direction.length();
        if (length < 1e-5) throw new Error(`Degenerate anatomical segment: ${part}`);
        const volume = proxy.children[index] ?? new HitEllipsoid(actor, zone, part);
        if (!volume.parent) proxy.add(volume);
        volume.position.copy(a).lerp(b, .5);
        volume.quaternion.copy(facing).multiply(new Quaternion().setFromUnitVectors(up,
          direction.divideScalar(length).applyQuaternion(inverseFacing)));
        if (part === 'torso' || part === 'neck') {
          const vertical = b.clone().sub(a).normalize();
          const across = points.RightShoulder.clone().sub(points.LeftShoulder);
          across.addScaledVector(vertical, -across.dot(vertical)).normalize();
          volume.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(across, vertical, across.clone().cross(vertical)));
        }
        volume.scale.set(width, length / 2 + padding, depth);
        volume.updateMatrix();
        index++;
      };
      const build = 1 + (actor.avatarAppearance?.build ?? 0) * .025;
      segment('head', 'head', 'Head', 'HeadTop_End', .105, .10, .008);
      segment('torso', 'torso', 'Hips', 'Neck', .21 * build, .14, .025);
      segment('pelvis', 'torso', 'Hips', 'Spine', .175 * build, .135, .11);
      segment('neck', 'torso', 'Neck', 'Head', .065, .065, .02);
      for (const side of sides) {
        segment(side + '-upper-arm', 'limb', side + 'Arm', side + 'ForeArm', .06);
        segment(side + '-forearm', 'limb', side + 'ForeArm', side + 'Hand', .045);
        segment(side + '-hand', 'limb', side + 'Hand', side + 'HandMiddle1', .035, .04, .025);
        segment(side + '-thigh', 'limb', side + 'UpLeg', side + 'Leg', .085);
        segment(side + '-shin', 'limb', side + 'Leg', side + 'Foot', .065);
        segment(side + '-foot', 'limb', side + 'Foot', side + 'ToeBase', .05, .065, .025);
      }
      proxy.updateMatrixWorld(true);
      return proxy;
    },
    raycast(actor, now, origin, direction, raycaster) {
      if (!origin?.isVector3 || !direction?.isVector3 || ![...origin, ...direction].every(Number.isFinite) ||
        Math.abs(direction.length() - 1) > 1e-5) throw new RangeError('Body ray requires a finite origin and normalized direction');
      raycaster.set(origin, direction); raycaster.near = 0; raycaster.far = RIFLE.range;
      return raycaster.intersectObject(this.sync(actor, now), true)[0] ?? null;
    },
  };
}
