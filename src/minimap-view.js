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

export function missionMarkerPosition(x, y, size, padding = 22) {
    if (![x, y, size, padding].every(Number.isFinite) || padding <= 0 || size <= padding * 2)
      throw new RangeError('Mission marker requires a finite map position and usable bounds');
    const center = size / 2, dx = x - center, dy = y - center, half = center - padding;
    const scale = Math.min(1, half / Math.abs(dx), half / Math.abs(dy));
    return { x: center + dx * scale, y: center + dy * scale, offscreen: scale < 1, angle: Math.atan2(dy, dx) };
  }

export function drawMissionMarker(ctx, x, y, size, { label, color, primary }) {
    const marker = missionMarkerPosition(x, y, size), radius = primary ? 13 : 9;
    ctx.save();
    ctx.fillStyle = '#09140feb'; ctx.strokeStyle = primary ? '#fff7df' : color; ctx.lineWidth = primary ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (primary) {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(marker.x, marker.y, radius - 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.translate(marker.x, marker.y);
    const scale = primary ? 1 : .7;
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(-4 * scale, 7 * scale); ctx.lineTo(-4 * scale, -7 * scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3 * scale, -6 * scale); ctx.lineTo(6 * scale, -6 * scale);
    ctx.lineTo(3 * scale, -2 * scale); ctx.lineTo(6 * scale, scale); ctx.lineTo(-3 * scale, scale); ctx.closePath(); ctx.fill();
    if (marker.offscreen) {
      ctx.save(); ctx.rotate(marker.angle);
      ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(14, -4); ctx.lineTo(14, 4); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.font = `bold ${primary ? 11 : 9}px sans-serif`; ctx.textAlign = 'center';
    const labelY = marker.y < 34 ? radius + 12 : -radius - 5, width = label.length * 9 + 8;
    ctx.fillStyle = '#09140feb'; ctx.fillRect(-width / 2, labelY - 10, width, 13);
    ctx.fillStyle = '#fff7df'; ctx.fillText(label, 0, labelY);
    ctx.restore();
  }
