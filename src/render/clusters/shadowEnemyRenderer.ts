import type { ClusterSnapshot } from '../clusterSnapshotTypes';
import {
  SHADOW_REPHASE_DELAY_TICKS,
  SHADOW_START_DELAY_TICKS,
} from '../../sim/clusters/shadowEnemyConfig';

function drawShadowHumanoid(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  scale: number,
  fillStyle: string,
  rimStyle: string,
): void {
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = rimStyle;
  ctx.lineWidth = Math.max(1, scale * 0.65);
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.arc(centerX, centerY - 7.2 * scale, 2.25 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 2.3 * scale, centerY - 4.8 * scale);
  ctx.lineTo(centerX + 2.3 * scale, centerY - 4.8 * scale);
  ctx.lineTo(centerX + 2.0 * scale, centerY + 2.2 * scale);
  ctx.lineTo(centerX - 2.0 * scale, centerY + 2.2 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 2.0 * scale, centerY - 3.7 * scale);
  ctx.lineTo(centerX - 3.4 * scale, centerY + 1.0 * scale);
  ctx.moveTo(centerX + 2.0 * scale, centerY - 3.7 * scale);
  ctx.lineTo(centerX + 3.4 * scale, centerY + 1.0 * scale);
  ctx.moveTo(centerX - 1.1 * scale, centerY + 1.5 * scale);
  ctx.lineTo(centerX - 1.8 * scale, centerY + 8.8 * scale);
  ctx.moveTo(centerX + 1.1 * scale, centerY + 1.5 * scale);
  ctx.lineTo(centerX + 1.8 * scale, centerY + 8.8 * scale);
  ctx.stroke();
}

export function renderShadowEnemy(
  ctx: CanvasRenderingContext2D,
  shadow: ClusterSnapshot,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const centerX = shadow.renderPositionXWorld * scale + offsetX;
  const centerY = shadow.renderPositionYWorld * scale + offsetY;
  const speedWorld = Math.hypot(shadow.velocityXWorld, shadow.velocityYWorld);
  const trailX = speedWorld > 0 ? -shadow.velocityXWorld / speedWorld * 3 * scale : 0;
  const trailY = speedWorld > 0 ? -shadow.velocityYWorld / speedWorld * 3 * scale : 0;
  const startupAlpha = shadow.shadowStartupTicks > 0
    ? Math.max(0.08, 1 - shadow.shadowStartupTicks / SHADOW_START_DELAY_TICKS)
    : 1;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = startupAlpha;

  for (let afterimageIndex = 3; afterimageIndex >= 1; afterimageIndex--) {
    ctx.globalAlpha = startupAlpha * (0.07 + (3 - afterimageIndex) * 0.045);
    drawShadowHumanoid(
      ctx,
      centerX + trailX * afterimageIndex,
      centerY + trailY * afterimageIndex,
      scale,
      '#170a25',
      '#39205d',
    );
  }

  ctx.globalAlpha = startupAlpha * 0.82;
  drawShadowHumanoid(ctx, centerX, centerY, scale, '#100d17', '#7450b5');

  if (shadow.shadowRephaseTicks > 0) {
    const progress = shadow.shadowRephaseTicks / SHADOW_REPHASE_DELAY_TICKS;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.72;
    const bandHeight = Math.max(1, Math.ceil(scale));
    for (let bandIndex = 0; bandIndex < 5; bandIndex++) {
      const phase = Math.floor(shadow.shadowVisualPhaseRad * 3 + bandIndex) & 1;
      const bandY = centerY - 9 * scale + (bandIndex * 4 + phase) * scale;
      ctx.fillRect(centerX - 5 * scale, bandY, 10 * scale, bandHeight);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.25 + 0.35 * progress;
    ctx.fillStyle = '#8055c7';
    ctx.fillRect(centerX - 4 * scale, centerY - 9 * scale, scale, 18 * scale);
  }

  ctx.restore();
}
