/**
 * Renders pixel-material particles as crisp, footprint-sized squares: a 1x1
 * `MATERIAL_SAND` particle draws one native pixel; a 2x2 `MATERIAL_SAND_2X2`
 * particle draws one 2x2 native-pixel square (via `getMaterialFootprintSize`,
 * not a hard-coded size). No smoothing/subpixel blending — matches the
 * project's pixel-art rendering behaviour.
 *
 * Water/water merging (visual only, no physics change): adjacent liquid
 * particles already draw as touching, seamless `fillRect`s (no per-cell
 * borders), so a puddle of many 1x1 water particles already reads as one
 * connected body rather than a grid of separate squares. The one extra visual
 * cue added on top of that is a thin lighter "surface" strip drawn along the
 * top edge of any liquid particle whose cell directly above is NOT the same
 * liquid (empty, solid, or a different material) — since this is checked per
 * particle independently, a contiguous run of water automatically produces
 * one continuous highlight line across its exposed top, without any flood
 * fill or connectivity tracking.
 *
 * Allocation policy: zero per-particle allocations in the steady-state path.
 * `forEachParticle` iterates the system's own particle `Set` directly (one
 * call per particle, regardless of footprint size — not per occupied cell),
 * with no snapshot array; this function does not build any intermediate
 * `{x,y}` records or per-material grouping arrays — it sets `ctx.fillStyle`
 * lazily, only when the material actually changes between consecutive
 * particles in iteration order (the surface-highlight pass forces a refresh
 * on the next particle so it can't leak into an unrelated particle's fill).
 */

import type { WorldState } from '../../sim/world';
import {
  MATERIAL_VISUALS, getMaterialFootprintSize, getMaterialBehavior,
} from '../../sim/pixelMaterials/pixelMaterialTypes';

const FALLBACK_COLOR = '#ffffff';
const LIQUID_SURFACE_HIGHLIGHT_COLOR = 'rgba(255,255,255,0.35)';

export function renderPixelMaterials(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const system = world.pixelMaterialSystem;
  if (system.particleCount === 0) return;

  // Snap zoom-scaled cell size to whole device pixels so every particle
  // renders at an identical size — fractional zoom would otherwise round
  // some cells up and others down, producing visibly inconsistent sizes.
  const cellPx = Math.max(1, Math.round(zoom));
  const highlightPx = Math.max(1, Math.round(zoom * 0.35));
  let currentMaterial = -1;

  // `forEachParticle` visits one call per PARTICLE (anchor position), not
  // per occupied cell — a 2x2 particle is drawn as one fillRect covering its
  // full footprint (`getMaterialFootprintSize` * cellPx), not four separate
  // 1x1 squares. No per-particle array/object allocation either way.
  system.forEachParticle((x, y, material) => {
    if (material !== currentMaterial) {
      currentMaterial = material;
      const visual = MATERIAL_VISUALS[material];
      ctx.fillStyle = visual !== undefined ? visual.color : FALLBACK_COLOR;
    }
    const footprint = getMaterialFootprintSize(material);
    const px = Math.round(x * zoom + offsetXPx);
    const py = Math.round(y * zoom + offsetYPx);
    ctx.fillRect(px, py, cellPx * footprint, cellPx * footprint);

    if (getMaterialBehavior(material) === 'liquid') {
      let topExposed = false;
      for (let dx = 0; dx < footprint; dx++) {
        if (system.getMaterialAt(x + dx, y - 1) !== material) { topExposed = true; break; }
      }
      if (topExposed) {
        ctx.fillStyle = LIQUID_SURFACE_HIGHLIGHT_COLOR;
        ctx.fillRect(px, py, cellPx * footprint, highlightPx);
        // Force the next particle to re-set fillStyle rather than trusting
        // the "material unchanged" skip above, since we just overwrote it.
        currentMaterial = -1;
      }
    }
  });
}
