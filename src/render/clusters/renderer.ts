import { WorldSnapshot } from '../snapshot';

/**
 * Renders walls (level geometry) from the snapshot on the 2D canvas.
 * Walls are drawn before cluster indicators so clusters appear on top.
 */
export function renderWalls(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const walls = snapshot.walls;
  if (walls.count === 0) return;

  ctx.save();
  for (let wi = 0; wi < walls.count; wi++) {
    const sx = walls.xWorld[wi] * scalePx + offsetXPx;
    const sy = walls.yWorld[wi] * scalePx + offsetYPx;
    const sw = walls.wWorld[wi] * scalePx;
    const sh = walls.hWorld[wi] * scalePx;

    // Fill
    ctx.fillStyle = '#1a2535';
    ctx.fillRect(sx, sy, sw, sh);

    // Inner highlight (top-left edges)
    ctx.fillStyle = 'rgba(80,120,180,0.18)';
    ctx.fillRect(sx, sy, sw, 2);
    ctx.fillRect(sx, sy, 2, sh);

    // Outer shadow (bottom-right edges)
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(sx, sy + sh - 2, sw, 2);
    ctx.fillRect(sx + sw - 2, sy, 2, sh);

    // Glow border
    ctx.strokeStyle = 'rgba(60,140,220,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  }
  ctx.restore();
}

export function renderClusters(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const screenX = cluster.positionXWorld * scalePx + offsetXPx;
    const screenY = cluster.positionYWorld * scalePx + offsetYPx;

    const color = cluster.isPlayerFlag === 1 ? '#00ff99' : '#ff6600';
    const radiusPx = 10;

    ctx.beginPath();
    ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    const barWidthPx = 40;
    const barHeightPx = 4;
    const barXPx = screenX - barWidthPx / 2;
    const barYPx = screenY - radiusPx - 8;
    const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;

    ctx.fillStyle = '#333';
    ctx.fillRect(barXPx, barYPx, barWidthPx, barHeightPx);
    ctx.fillStyle = cluster.isPlayerFlag === 1 ? '#00ff99' : '#ff6600';
    ctx.fillRect(barXPx, barYPx, barWidthPx * healthRatio, barHeightPx);
  }
}
