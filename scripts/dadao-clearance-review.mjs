import * as T from 'three';
import { swordRig, swordBodyVolumes, segmentClearance } from './lib/dadao-rig.mjs';
const rig = await swordRig(), report = {};
console.log('body landmarks', Object.fromEntries(['Spine', 'Neck', 'Head', 'LeftArm', 'RightArm'].map(name => [name, rig.point(name).toArray()])));
for (const style of [0, 1]) {
  let worst = { clearance: Infinity }, edge = { alignment: 1 }, face = { slip: 0 };
  const active = { edge: 1, face: 0, projected: 1 };
  for (const phase of ['draw', 'windup', 'cut', 'recover']) for (let frame = 0; frame <= 200; frame++) {
    const pose = { style, phase, progress: frame / 200 };
    rig.sample(pose);
    for (const side of ['Left', 'Right']) for (const [a, b] of [['Arm', 'ForeArm'], ['ForeArm', 'Hand']])
      for (const volume of swordBodyVolumes(rig.point)) {
        const clearance = segmentClearance(rig.point(side + a), rig.point(side + b), volume);
        if (clearance < worst.clearance) worst = { clearance, style, phase, frame, side, segment: a, volume: volume.name };
      }
    if (phase === 'cut' && frame >= 2 && frame <= 198) {
      const current = [.3, .45, .6].map(y => rig.sword.blade.localToWorld(new T.Vector3(.04, y, 0)));
      const rotation = rig.sword.blade.getWorldQuaternion(new T.Quaternion());
      rig.sample({ ...pose, progress: pose.progress - .0001 });
      for (const [i, y] of [.3, .45, .6].entries()) {
        const velocity = current[i].sub(rig.sword.blade.localToWorld(new T.Vector3(.04, y, 0))).normalize();
        const alignment = velocity.dot(new T.Vector3(1, 0, 0).applyQuaternion(rotation));
        const slip = Math.abs(velocity.dot(new T.Vector3(0, 0, 1).applyQuaternion(rotation)));
        const bladeAxis = new T.Vector3(0, 1, 0).applyQuaternion(rotation);
        const projected = velocity.clone().addScaledVector(bladeAxis, -velocity.dot(bladeAxis)).normalize()
          .dot(new T.Vector3(1, 0, 0).applyQuaternion(rotation));
        if (frame >= 20 && frame <= 180) {
          active.edge = Math.min(active.edge, alignment); active.face = Math.max(active.face, slip);
          active.projected = Math.min(active.projected, projected);
        }
        if (alignment < edge.alignment) edge = { alignment, frame, y };
        if (slip > face.slip) face = { slip, frame, y };
      }
    }
  }
  report[style] = { worst, edge, face, active };
}
console.log(JSON.stringify(report, null, 2));
