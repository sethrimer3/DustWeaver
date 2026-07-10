/**
 * Development-only pixel-material debug visualization.
 *
 * Draws recent wind impulses (center, radius, direction, short fade) plus a
 * one-line occupied/active/sleeping/impulse counter readout. Reads directly
 * from `PixelMaterialSystem`'s pre-allocated typed arrays — no per-frame
 * allocation beyond what `CanvasRenderingContext2D` itself needs for text/paths.
 *
 * WIRED IN, BUT GATED: `screens/gameRender.ts` already calls
 * `renderPixelMaterialDebug(ctx, world, ox, oy, zoom)` right after the normal
 * sand render, wrapped in `if (isDebugMode) { ... }`. It is therefore a no-op
 * (never called) during normal play or non-debug screenshots/perf profiling —
 * toggle the game's existing debug mode to see it, no separate flag needed.
 */

import type { WorldState } from '../../sim/world';

/** Wind-event visuals fade out over this many fixed sim steps. */
const WIND_EVENT_FADE_STEPS = 18;

export function renderPixelMaterialDebug(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const system = world.pixelMaterialSystem;

  ctx.save();

  // ── Wind impulse visualization ────────────────────────────────────────
  const capacity = system.windDebugEventCapacity;
  for (let i = 0; i < capacity; i++) {
    const age = system.windDebugAgeSteps[i];
    if (!(age < WIND_EVENT_FADE_STEPS)) continue; // also skips Infinity (never-used slots)

    const alpha = 1 - age / WIND_EVENT_FADE_STEPS;
    const cx = system.windDebugCenterX[i] * zoom + offsetXPx;
    const cy = system.windDebugCenterY[i] * zoom + offsetYPx;
    const r = system.windDebugRadius[i] * zoom;

    ctx.strokeStyle = `rgba(120,200,255,${(alpha * 0.8).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const dirX = system.windDebugDirX[i];
    const dirY = system.windDebugDirY[i];
    if (dirX !== 0 || dirY !== 0) {
      ctx.strokeStyle = `rgba(255,230,150,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dirX * r, cy + dirY * r);
      ctx.stroke();
    }
  }

  // ── Counter readout ────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `sand: particles=${system.particleCount} cells=${system.occupiedCount} ` +
    `active=${system.activeCount} sleep=${system.sleepingCount} ` +
    `wind=${system.windImpulsesThisTick} hit=${system.windParticlesAffectedThisTick}`,
    4, 4,
  );

  ctx.restore();
}
