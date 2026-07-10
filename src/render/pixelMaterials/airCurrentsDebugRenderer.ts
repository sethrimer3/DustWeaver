/**
 * Development-only "Air Currents" debug overlay.
 *
 * Visualizes the live wind-momentum field carried on
 * `PixelMaterialParticle.windVelX/windVelY` (the same field player- and
 * enemy-movement wind impulses write into via
 * `PixelMaterialSystem.applyWindForce`, see `pixelMaterialMovementWind.ts`)
 * as small directional arrows sampled on an evenly spaced grid across the
 * current camera viewport. Purely a read-only visualization — see
 * `airCurrentsDebugSampler.ts` for the (also read-only) sampling logic.
 *
 * GATING: only rendered when both the game's shared debug mode AND the
 * player's independent "Air Currents" overlay toggle are on (see
 * `ui/renderSettings.ts` — `getAirCurrentsDebugEnabled`), mirroring the gating
 * convention used by `pixelMaterialDebugRenderer.ts`. When either is off this
 * module is never called, so it adds zero per-frame cost.
 */

import type { WorldState } from '../../sim/world';
import {
  AirCurrentsDebugSampler,
  AIR_CURRENTS_MAX_SPEED_PX_S,
  AIR_CURRENTS_SAMPLE_SPACING_PX,
} from './airCurrentsDebugSampler';

/** Reused across calls/frames — sampling never allocates once this exists. */
const sampler = new AirCurrentsDebugSampler();

/** Arrow length (screen px, before zoom) at/above `AIR_CURRENTS_MAX_SPEED_PX_S`. */
const MAX_ARROW_LENGTH_PX = 14;
/** Arrow length (screen px, before zoom) floor for any rendered (above-threshold) sample. */
const MIN_ARROW_LENGTH_PX = 3;

function drawArrowhead(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, dirX: number, dirY: number, size: number): void {
  const backX = tipX - dirX * size;
  const backY = tipY - dirY * size;
  const perpX = -dirY * size * 0.5;
  const perpY = dirX * size * 0.5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + perpX, backY + perpY);
  ctx.lineTo(backX - perpX, backY - perpY);
  ctx.closePath();
  ctx.fill();
}

export function renderAirCurrentsDebug(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): void {
  const system = world.pixelMaterialSystem;

  // Screen viewport -> world-space viewport, so sampling only covers what's actually visible.
  const viewLeftPx = -offsetXPx / zoom;
  const viewTopPx = -offsetYPx / zoom;
  const viewRightPx = (viewportWidthPx - offsetXPx) / zoom;
  const viewBottomPx = (viewportHeightPx - offsetYPx) / zoom;

  sampler.sample(system, viewLeftPx, viewTopPx, viewRightPx, viewBottomPx);

  ctx.save();

  for (let i = 0; i < sampler.count; i++) {
    const speed = sampler.speed[i];
    const t = Math.min(1, speed / AIR_CURRENTS_MAX_SPEED_PX_S);
    const length = (MIN_ARROW_LENGTH_PX + t * (MAX_ARROW_LENGTH_PX - MIN_ARROW_LENGTH_PX)) * zoom;

    const dirX = sampler.velX[i] / speed;
    const dirY = sampler.velY[i] / speed;

    const sx = sampler.sampleXPx[i] * zoom + offsetXPx;
    const sy = sampler.sampleYPx[i] * zoom + offsetYPx;
    const ex = sx + dirX * length;
    const ey = sy + dirY * length;

    // Stronger currents render slightly more opaque; weak-but-above-threshold currents stay faint.
    const alpha = 0.25 + t * 0.55;
    const color = `rgba(140,215,255,${alpha.toFixed(3)})`;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    drawArrowhead(ctx, ex, ey, dirX, dirY, Math.max(2, length * 0.35));
  }

  // ── Legend ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `air currents: samples=${sampler.count} spacing=${AIR_CURRENTS_SAMPLE_SPACING_PX}px ` +
    `arrow len = |wind| (clamped ${AIR_CURRENTS_MAX_SPEED_PX_S}px/s), arrow dir = wind dir`,
    4, 14,
  );

  ctx.restore();
}
