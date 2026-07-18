import type { WorldSnapshot } from '../snapshot';
import type { ClusterSnapshot } from '../clusterSnapshotTypes';
import * as C from '../../sim/clusters/needleUrchinConfig';

export function renderNeedleProjectiles(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.strokeStyle = '#d9d2c5';
  ctx.lineWidth = 1;

  for (let needleIndex = 0; needleIndex < snapshot.needleProjectileAliveFlag.length; needleIndex++) {
    if (snapshot.needleProjectileAliveFlag[needleIndex] === 0) {
      continue;
    }
    const velocityX = snapshot.needleProjectileVelXWorld[needleIndex];
    const velocityY = snapshot.needleProjectileVelYWorld[needleIndex];
    const speed = Math.hypot(velocityX, velocityY) || 1;
    const x = snapshot.needleProjectileXWorld[needleIndex] * scale + offsetX;
    const y = snapshot.needleProjectileYWorld[needleIndex] * scale + offsetY;

    ctx.beginPath();
    ctx.moveTo(
      x - velocityX / speed * C.NEEDLE_PROJECTILE_LENGTH_WORLD * scale,
      y - velocityY / speed * C.NEEDLE_PROJECTILE_LENGTH_WORLD * scale,
    );
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderNeedleUrchin(
  ctx: CanvasRenderingContext2D,
  urchin: ClusterSnapshot,
  scale: number,
  offsetX: number,
  offsetY: number,
  tick: number,
): void {
  const centerX = urchin.renderPositionXWorld * scale + offsetX;
  const centerY = urchin.renderPositionYWorld * scale + offsetY;
  const telegraphing = urchin.needleUrchinState === C.NEEDLE_URCHIN_STATE_TELEGRAPH;
  const extension = telegraphing
    ? 1 + urchin.needleUrchinStateTicks / C.NEEDLE_URCHIN_TELEGRAPH_TICKS
    : 0.65;
  const hitFlashing = urchin.needleUrchinHitFlashTicks > 0;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.strokeStyle = hitFlashing
    ? '#ffffff'
    : telegraphing && (tick & 2) === 0
      ? '#fff4d8'
      : '#aaa4bc';
  ctx.lineWidth = hitFlashing ? Math.max(1.5, scale) : 1;

  for (let spineIndex = 0; spineIndex < C.NEEDLE_URCHIN_NEEDLES_PER_BURST; spineIndex++) {
    const angleRad = urchin.needleUrchinBurstPhaseRad + spineIndex * Math.PI / 6;
    const innerRadius = 4 * scale;
    const outerRadius = (5 + 4 * extension) * scale;
    ctx.beginPath();
    ctx.moveTo(
      centerX + Math.cos(angleRad) * innerRadius,
      centerY + Math.sin(angleRad) * innerRadius,
    );
    ctx.lineTo(
      centerX + Math.cos(angleRad) * outerRadius,
      centerY + Math.sin(angleRad) * outerRadius,
    );
    ctx.stroke();
  }

  ctx.fillStyle = hitFlashing ? '#eee8ff' : '#303441';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = urchin.needleUrchinShotFlashTicks > 0 || hitFlashing ? '#ffffff' : '#9e88ba';
  ctx.fillRect(centerX - scale, centerY - scale, 2 * scale, 2 * scale);
  ctx.restore();
}
