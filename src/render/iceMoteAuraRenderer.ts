/**
 * iceMoteAuraRenderer.ts — Frost visual overlay for Ice Mote frozen water zones.
 *
 * Draws a semi-transparent ice/frost layer on top of each water zone that is
 * currently frozen by the Ice Mote aura.  The overlay completely covers the
 * underlying water so it no longer visually reads as liquid.
 *
 * Rendering is deliberately lightweight — one fillRect per frozen zone plus
 * two thin edge passes (top surface rim and an inner shimmer band).
 * No per-frame allocations; zone data is read directly from WorldState.
 */

import type { WorldState } from '../sim/world';
import { isScreenRectVisible } from './viewportCull';

// ── Visual constants ──────────────────────────────────────────────────────────

/** Base fill colour — pale blue-white ice. */
const ICE_FILL_RGBA     = 'rgba(190,230,255,0.82)';

/** Top-surface crisp rim — bright frosty white edge. */
const ICE_RIM_RGBA      = 'rgba(255,255,255,0.90)';

/** Inner shimmer band just below the top surface (softer glow). */
const ICE_SHIMMER_RGBA  = 'rgba(220,245,255,0.55)';

/** Thickness of the crisp rim at the top edge (world units). */
const ICE_RIM_THICKNESS_WORLD = 1.5;

/** Thickness of the shimmer band below the rim (world units). */
const ICE_SHIMMER_THICKNESS_WORLD = 3;

// ── Exported renderer ─────────────────────────────────────────────────────────

/**
 * Renders frost overlays for all currently frozen water zones.
 * Call this after renderWaterZones so the overlay draws on top of any
 * residual water graphics.
 *
 * @param ctx       Canvas 2D rendering context.
 * @param world     Current world state (read-only in this function).
 * @param offsetXPx Camera X offset in canvas pixels.
 * @param offsetYPx Camera Y offset in canvas pixels.
 * @param zoom      World-to-canvas pixel scale factor.
 * @param vpW       Viewport width in canvas pixels (for culling).
 * @param vpH       Viewport height in canvas pixels (for culling).
 */
export function renderIceMoteAuraOverlay(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  vpW = 480,
  vpH = 270,
): void {
  let anyFrozen = false;
  for (let i = 0; i < world.waterZoneCount; i++) {
    if (world.frozenWaterZoneMask[i] !== 1) continue;
    anyFrozen = true;
    break;
  }
  if (!anyFrozen) return;

  ctx.save();

  for (let i = 0; i < world.waterZoneCount; i++) {
    if (world.frozenWaterZoneMask[i] !== 1) continue;

    const rx = world.waterZoneXWorld[i];
    const ry = world.waterZoneYWorld[i];
    const rw = world.waterZoneWWorld[i];
    const rh = world.waterZoneHWorld[i];

    const sx = rx * zoom + offsetXPx;
    const sy = ry * zoom + offsetYPx;
    const sw = rw * zoom;
    const sh = rh * zoom;

    if (!isScreenRectVisible(sx, sy, sw, sh, vpW, vpH)) continue;

    // ── Base ice fill ────────────────────────────────────────────────────
    ctx.fillStyle = ICE_FILL_RGBA;
    ctx.fillRect(sx, sy, sw, sh);

    // ── Shimmer band — just below the top surface ────────────────────────
    const shimmerH = Math.min(ICE_SHIMMER_THICKNESS_WORLD * zoom, sh * 0.4);
    if (shimmerH >= 1) {
      ctx.fillStyle = ICE_SHIMMER_RGBA;
      ctx.fillRect(sx, sy + ICE_RIM_THICKNESS_WORLD * zoom, sw, shimmerH);
    }

    // ── Crisp top-surface rim ────────────────────────────────────────────
    const rimH = Math.min(ICE_RIM_THICKNESS_WORLD * zoom, sh);
    if (rimH >= 0.5) {
      ctx.fillStyle = ICE_RIM_RGBA;
      ctx.fillRect(sx, sy, sw, rimH);
    }
  }

  ctx.restore();
}
