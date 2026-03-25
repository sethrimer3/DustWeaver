import { WorldSnapshot } from '../snapshot';

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
