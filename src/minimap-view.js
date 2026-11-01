export function drawFacingSector(ctx, x, z, heading, radius = 48) {
  if (![x, z, heading, radius].every(Number.isFinite) || radius <= 0) {
    throw new RangeError('Minimap facing sector requires finite position, heading and positive radius');
  }
  const direction = -Math.PI / 2 - heading;
  ctx.save();
  ctx.fillStyle = '#f6e0a970';
  ctx.strokeStyle = '#f6e0a9bd';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(x, z);
  ctx.arc(x, z, radius, direction - Math.PI / 4, direction + Math.PI / 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
