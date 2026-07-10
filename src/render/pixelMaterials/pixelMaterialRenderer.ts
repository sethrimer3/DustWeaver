/**
 * Renders pixel-material particles as crisp, footprint-sized squares: a 1x1
 * `MATERIAL_SAND` particle draws one native pixel; a 2x2 `MATERIAL_SAND_2X2`
 * particle draws one 2x2 native-pixel square (via `getMaterialFootprintSize`,
 * not a hard-coded size). No smoothing/subpixel blending — matches the
 * project's pixel-art rendering behaviour.
 *
 * Allocation policy: zero per-particle allocations in the steady-state path.
 * `forEachParticle` iterates the system's own particle `Set` directly (one
 * call per particle, regardless of footprint size — not per occupied cell),
 * with no snapshot array; this function does not build any intermediate
 * `{x,y}` records or per-material grouping arrays — it sets `ctx.fillStyle`
 * lazily, only when the material actually changes between consecutive
 * particles in iteration order. With a single material present (the common
 * case today) this reduces to one `fillStyle` assignment for the whole draw;
 * the per-particle check is what keeps this correct as more materials are
 * added, without reintroducing a grouping allocation.
 */

import type { WorldState } from '../../sim/world';
import { MATERIAL_VISUALS, getMaterialFootprintSize } from '../../sim/pixelMaterials/pixelMaterialTypes';

const FALLBACK_COLOR = '#ffffff';

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
  });
}
