/**
 * timeStopMomentumArrowRenderer.ts — Suspended-momentum vector arrow.
 *
 * Draws a glowing, translucent arrow behind the player sprite while
 * `world.timeStopField.hasStoredMomentumFlag` is set, pointing in the
 * stored WORLD-SPACE momentum direction (never rotated with player facing)
 * and length-clamped so extreme velocity never produces an unusably large
 * arrow. Fully independent from the player's active-velocity speedometer /
 * debug displays (see ui/playerSpeedometerOverlayRenderer.ts) — this reads
 * only the suspended vector, never `player.velocityXWorld/YWorld`.
 */

import type { WorldState } from '../../sim/world';
import {
  TIME_STOP_ARROW_LENGTH_PER_SPEED,
  TIME_STOP_ARROW_MIN_LENGTH_WORLD,
  TIME_STOP_ARROW_MAX_LENGTH_WORLD,
  TIME_STOP_ARROW_MIN_SPEED_WORLD,
  TIME_STOP_ARROW_OPACITY,
  TIME_STOP_ARROW_GLOW_STRENGTH_PX,
} from '../../sim/timeStopField/timeStopFieldConfig';

/**
 * Draws the stored-momentum arrow for the player cluster, if any is stored
 * and the field visual has faded in enough to be visible. No-op otherwise.
 */
export function renderTimeStopMomentumArrow(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const state = world.timeStopField;
  if (state.hasStoredMomentumFlag === 0 || state.visualIntensity <= 0) return;

  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
  if (player === undefined || player.isAliveFlag === 0) return;

  const vx = state.storedMomentumXWorld;
  const vy = state.storedMomentumYWorld;
  const speed = Math.hypot(vx, vy);
  if (speed < TIME_STOP_ARROW_MIN_SPEED_WORLD) return;

  const rawLength = speed * TIME_STOP_ARROW_LENGTH_PER_SPEED;
  const length = Math.max(
    TIME_STOP_ARROW_MIN_LENGTH_WORLD,
    Math.min(TIME_STOP_ARROW_MAX_LENGTH_WORLD, rawLength),
  );
  const dirX = vx / speed;
  const dirY = vy / speed;

  const originXWorld = player.positionXWorld;
  const originYWorld = player.positionYWorld;
  const tipXWorld = originXWorld + dirX * length;
  const tipYWorld = originYWorld + dirY * length;

  const originXPx = originXWorld * zoom + ox;
  const originYPx = originYWorld * zoom + oy;
  const tipXPx = tipXWorld * zoom + ox;
  const tipYPx = tipYWorld * zoom + oy;

  const alpha = TIME_STOP_ARROW_OPACITY * state.visualIntensity;
  const headLenPx = Math.max(2, length * 0.28 * zoom);
  const angle = Math.atan2(tipYPx - originYPx, tipXPx - originXPx);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(190,220,255,1)';
  ctx.fillStyle = 'rgba(190,220,255,1)';
  ctx.lineWidth = Math.max(1, 1.5 * zoom * 0.5);
  ctx.shadowColor = 'rgba(140,200,255,0.9)';
  ctx.shadowBlur = TIME_STOP_ARROW_GLOW_STRENGTH_PX;

  ctx.beginPath();
  ctx.moveTo(originXPx, originYPx);
  ctx.lineTo(tipXPx, tipYPx);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(tipXPx, tipYPx);
  ctx.lineTo(
    tipXPx - headLenPx * Math.cos(angle - Math.PI / 7),
    tipYPx - headLenPx * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    tipXPx - headLenPx * Math.cos(angle + Math.PI / 7),
    tipYPx - headLenPx * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
