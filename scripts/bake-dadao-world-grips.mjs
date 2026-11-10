import { writeFileSync } from 'node:fs';
import * as T from 'three';
import { swordRig, swordBodyVolumes, segmentClearance } from './lib/dadao-rig.mjs';
import { dadaoWorldStroke, authoredDadaoWorldCut } from '../src/dadao-model.js';

const rig = await swordRig(), output = [], cuts = [], count = 40;
const diff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
for (const style of [0, 1]) {
  const rawFrameUnprojected = progress => {
    const pose = { phase: 'cut', progress, style };
    rig.reset(pose);
    const key = authoredDadaoWorldCut(style === 1, T.MathUtils.smoothstep(progress, 0, 1));
    const chest = rig.chest(), shoulder = rig.point('RightArm').add(rig.point('LeftArm')).multiplyScalar(.5);
    return { anchor: key.anchor.applyQuaternion(chest).add(shoulder),
      axis: new T.Vector3(0, 1, 0).applyQuaternion(chest.clone().multiply(key.rotation)), chest, shoulder };
  };
  const planeNormal = new T.Vector3().crossVectors(rawFrameUnprojected(0).axis, rawFrameUnprojected(1).axis).normalize();
  const rawFrame = progress => {
    const frame = rawFrameUnprojected(progress);
    frame.axis.addScaledVector(planeNormal, -frame.axis.dot(planeNormal)).normalize();
    return frame;
  };
  const steps = 2000, samples = [], dt = 1 / steps;
  let anchor = rawFrame(0).anchor.clone();
  for (let frame = 0; frame <= steps; frame++) {
    const t = frame / steps, before = rawFrame(Math.max(0, t - .0001)), after = rawFrame(Math.min(1, t + .0001));
    const current = rawFrame(t), span = Math.min(1, t + .0001) - Math.max(0, t - .0001);
    const axisVelocity = after.axis.sub(before.axis).divideScalar(span);
    const normal = planeNormal;
    const rawVelocity = after.anchor.sub(before.anchor).divideScalar(span);
    const velocity = rawVelocity.clone();
    velocity.addScaledVector(normal, -velocity.dot(normal));
    const correction = current.anchor.clone().sub(anchor);
    velocity.addScaledVector(correction.addScaledVector(normal, -correction.dot(normal)), 18 * t * (1 - t));
    const tangent = axisVelocity.clone().normalize(), minimum = -.20 * axisVelocity.length();
    if (velocity.dot(tangent) < minimum) velocity.addScaledVector(tangent, minimum - velocity.dot(tangent));
    const actualAnchor = anchor.clone();
    const edge = axisVelocity.clone().addScaledVector(current.axis, -axisVelocity.dot(current.axis)).normalize();
    const rotation = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(
      edge, current.axis, new T.Vector3().crossVectors(edge, current.axis)));
    if (frame % (steps / count) === 0) {
      samples.push({ anchor: actualAnchor.sub(current.shoulder).applyQuaternion(current.chest.clone().invert()),
        rotation: current.chest.clone().invert().multiply(rotation) });
    }
    anchor.addScaledVector(velocity, dt);
  }
  cuts.push(samples.map(key => [...key.anchor.toArray(), ...key.rotation.toArray()].map(value => +value.toFixed(9))));
  for (let i = 1; i < samples.length; i++) if (samples[i].rotation.angleTo(samples[i - 1].rotation) > .3)
    console.log('large authored rotation', style, i, samples[i].rotation.angleTo(samples[i - 1].rotation),
      samples[i].anchor.toArray());
  const cutAt = progress => {
    const t = progress * count;
    const at = Math.floor(t), next = Math.min(count, at + 1);
    return { anchor: samples[at].anchor.clone().lerp(samples[next].anchor, t - at),
      rotation: samples[at].rotation.clone().slerp(samples[next].rotation, t - at) };
  };
  const frames = {};
  for (const phase of ['draw', 'windup', 'cut', 'recover']) {
    frames[phase] = [];
    for (let frame = 0; frame <= count; frame++) {
      const pose = { phase, progress: frame / count, style };
      rig.sample(pose, 0, cutAt);
      const rotation = rig.sword.blade.getWorldQuaternion(new T.Quaternion());
      const key = dadaoWorldStroke(pose, cutAt), chest = rotation.clone().multiply(key.rotation.clone().invert());
      frames[phase].push({ rotation, right: rig.sword.blade.localToWorld(new T.Vector3(0, -.03, 0)),
        left: rig.sword.blade.localToWorld(new T.Vector3(0, -.12, 0)),
        shoulders: { right: rig.point('RightArm'), left: rig.point('LeftArm') },
        poles: { right: key.rightPole.applyQuaternion(chest), left: key.leftPole.applyQuaternion(chest) },
        volumes: swordBodyVolumes(rig.point), chest, pose, crown: rig.point('Head').y + .215 });
    }
  }
  const table = Object.fromEntries(Object.keys(frames).map(phase => [phase, Array.from({ length: count + 1 }, () => [])]));
  for (const side of ['right', 'left']) {
    const { center, knuckle, lengths: [a, b] } = rig.grips[side];
    const candidates = frame => {
      const axis = new T.Vector3(0, 1, 0).applyQuaternion(frame.rotation);
      const across = new T.Vector3(1, 0, 0).applyQuaternion(frame.rotation), normal = new T.Vector3(0, 0, 1).applyQuaternion(frame.rotation);
      const shoulder = frame.shoulders[side], anchor = frame[side], pole = frame.poles[side], result = [];
      const natural = shoulder.clone().add(pole.clone().normalize().multiplyScalar(.20));
      const diagnostics = { reachable: 0, aligned: 0, clearance: -Infinity, anchor: anchor.toArray(),
        axis: axis.toArray(), origin: shoulder.toArray() };
      for (let roll = 0; roll < 180; roll++) {
        const theta = -Math.PI + roll * Math.PI / 90;
        const y = across.clone().multiplyScalar(Math.cos(theta)).addScaledVector(normal, Math.sin(theta));
        const z = new T.Vector3().crossVectors(axis, y);
        const wrist = anchor.clone().addScaledVector(axis, -center.x).addScaledVector(y, -center.y).addScaledVector(z, -center.z);
        const palmEnd = wrist.clone().addScaledVector(axis, knuckle.x).addScaledVector(y, knuckle.y).addScaledVector(z, knuckle.z);
        const direction = wrist.clone().sub(shoulder), distance = direction.length(); direction.normalize();
        if (distance > a + b - .001 || distance < Math.abs(a - b) + .001) continue;
        diagnostics.reachable++;
        if (style && frame.pose.phase === 'windup' && frame.pose.progress === 1 && wrist.y < frame.crown + .005) continue;
        const along = (a * a - b * b + distance * distance) / (2 * distance), height = Math.sqrt(Math.max(0, a * a - along * along));
        const out = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize(), tangent = new T.Vector3().crossVectors(direction, out);
        const possible = [];
        for (let swivel = 0; swivel < 72; swivel++) {
          const phi = -Math.PI + swivel * Math.PI / 36;
          const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(out, height * Math.cos(phi))
            .addScaledVector(tangent, height * Math.sin(phi));
          const alignment = wrist.clone().sub(elbow).normalize().dot(y);
          if (alignment < .75) continue;
          diagnostics.aligned++;
          let clearance = Infinity, obstruction;
          for (const volume of frame.volumes) {
            const value = Math.min(segmentClearance(shoulder, elbow, volume), segmentClearance(elbow, wrist, volume),
              segmentClearance(wrist, anchor, volume), segmentClearance(wrist, palmEnd, volume));
            if (value < clearance) { clearance = value; obstruction = volume.name; }
          }
          if (clearance > diagnostics.clearance) Object.assign(diagnostics, { clearance, obstruction,
            wrist: wrist.toArray(), elbow: elbow.toArray(), shoulder: shoulder.toArray() });
          if (clearance < .008) continue;
          const relative = elbow.clone().sub(shoulder).applyQuaternion(frame.chest.clone().invert());
          const flare = Math.max(0, Math.abs(relative.x) - .13);
          possible.push({ theta, phi, elbow, cost: elbow.distanceToSquared(natural) * 10 +
            flare * flare * 50 + (1 - alignment) * .1 + Math.max(0, .03 - clearance) ** 2 * 50 });
        }
        possible.sort((a, b) => a.cost - b.cost);
        const sectors = new Set();
        for (const value of possible) {
          const sector = Math.floor((value.phi + Math.PI) / (Math.PI / 4));
          if (!sectors.has(sector)) { result.push(value); sectors.add(sector); }
        }
      }
      if (!result.length) throw Error(`No collision-free candidates ${style}/${side}/${JSON.stringify(frame.pose)} ${JSON.stringify(diagnostics)}`);
      return result.sort((a, b) => a.cost - b.cost);
    };
    const rows = Object.fromEntries(Object.entries(frames).map(([phase, frames]) => [phase, frames.map(candidates)]));
    const initial = rows.windup[0][0];
    const solve = (rows, start, end) => {
      const states = [start ? [{ ...start, cumulative: 0, previous: -1 }] : rows[0].map(value => ({ ...value, cumulative: value.cost, previous: -1 }))];
      for (let i = 1; i < rows.length; i++) {
        const next = [], previous = states.at(-1), values = i === rows.length - 1 ? [end] : rows[i];
        for (const value of values) {
          let best = Infinity, index = -1;
          for (let j = 0; j < previous.length; j++) {
            const last = previous[j], ed = value.elbow.distanceTo(last.elbow), rd = Math.abs(diff(value.theta, last.theta)), pd = Math.abs(diff(value.phi, last.phi));
            if (ed > .065 || rd > .6 || pd > .7) continue;
            const score = last.cumulative + value.cost + ed * ed * 600 + rd * rd * 1.2 + pd * pd * .3;
            if (score < best) { best = score; index = j; }
          }
          if (index >= 0) next.push({ ...value, cumulative: best, previous: index });
        }
        if (!next.length) throw Error(`Disconnected ${style}/${side}/${i}`);
        states.push(next);
      }
      let index = states.at(-1).reduce((best, value, i, rows) => value.cumulative < rows[best].cumulative ? i : best, 0);
      const chosen = [];
      for (let i = states.length - 1; i >= 0; i--) { const value = states[i][index]; chosen.push(value); index = value.previous; }
      return chosen.reverse();
    };
    const loop = solve([...rows.windup, ...rows.cut.slice(1), ...rows.recover.slice(1)], initial, initial);
    const draw = solve(rows.draw, null, initial);
    for (const [phase, rows] of Object.entries({ draw, windup: loop.slice(0, 41), cut: loop.slice(40, 81), recover: loop.slice(80) })) {
      let lastTheta = rows[0].theta, lastPhi = rows[0].phi;
      rows.forEach((value, i) => {
        lastTheta += diff(value.theta, lastTheta); lastPhi += diff(value.phi, lastPhi);
        table[phase][i].push(+lastTheta.toFixed(7), +lastPhi.toFixed(7));
      });
    }
    console.log('baked collision-free grip', style, side);
  }
  output.push(table);
}
const text = `import { MathUtils, Vector3, Quaternion } from 'three';\n\n// Generated by scripts/bake-dadao-world-grips.mjs; original bones, body clearance and fixed palms.\nconst cuts = ${JSON.stringify(cuts)};\nconst keys = ${JSON.stringify(output, null, 2)};\n
export function sampleDadaoWorldCut(pose) {
  const rows = cuts[pose.style === 1 ? 1 : 0], t = MathUtils.clamp(pose.progress, 0, 1) * (rows.length - 1);
  const at = Math.floor(t), next = Math.min(rows.length - 1, at + 1);
  return { anchor: new Vector3().fromArray(rows[at]).lerp(new Vector3().fromArray(rows[next]), t - at),
    rotation: new Quaternion().fromArray(rows[at], 3).slerp(new Quaternion().fromArray(rows[next], 3), t - at) };
}

export function sampleDadaoWorldGrip(pose, side) {
  const phases = keys[pose.style === 1 ? 1 : 0];
  const rows = phases[pose.phase === 'ready' ? 'windup' : pose.phase];
  if (!rows) throw new RangeError(\`Unknown dadao world grip phase: \${pose.phase}\`);
  const t = pose.phase === 'ready' ? 0 : MathUtils.clamp(pose.progress, 0, 1) * (rows.length - 1);
  const at = Math.floor(t), next = Math.min(rows.length - 1, at + 1), offset = side === 'right' ? 0 : 2;
  return [0, 1].map(i => MathUtils.lerp(rows[at][offset + i], rows[next][offset + i], t - at));
}\n`;
writeFileSync(new URL('../src/dadao-world-grips.js', import.meta.url), text);
