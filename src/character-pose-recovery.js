import { PoseGeometryError } from './nra-rifle-pose.js';

export function recoverCharacterPose(root, onRecovery) {
  const transforms = [];
  root.traverse(node => transforms.push({ node, position: node.position.clone(),
    quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible }));
  return operation => function(actor, ...args) {
    if (!actor || !onRecovery || actor.id === 'pose-bake') return operation.call(this, actor, ...args);
    for (const entry of transforms) {
      entry.position.copy(entry.node.position); entry.quaternion.copy(entry.node.quaternion);
      entry.scale.copy(entry.node.scale); entry.visible = entry.node.visible;
    }
    try { return operation.call(this, actor, ...args); }
    catch (error) {
      if (!(error instanceof PoseGeometryError)) throw error;
      if (![actor.position?.x, actor.position?.y, actor.position?.z, actor.heading].every(Number.isFinite)) throw error;
      for (const entry of transforms) {
        entry.node.position.copy(entry.position); entry.node.quaternion.copy(entry.quaternion);
        entry.node.scale.copy(entry.scale); entry.node.visible = entry.visible;
      }
      root.position.copy(actor.position); root.rotation.set(0, actor.heading, 0);
      root.visible = !actor.vehicleId && actor.id !== args[1];
      root.updateMatrixWorld(true);
      onRecovery(error, { stage: 'character-pose', soldierId: actor.id, team: actor.team, stance: actor.stance,
        position: [actor.position.x, actor.position.y, actor.position.z] });
    }
  };
}
