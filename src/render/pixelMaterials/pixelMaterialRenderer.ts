/**
 * Renders occupied pixel-material cells (currently: sand) as crisp,
 * one-native-pixel squares. No smoothing/subpixel blending — matches the
 * project's pixel-art rendering behaviour.
 *
 * Allocation policy: zero per-particle allocations in the steady-state path.
 * `forEachParticle` iterates the system's own `Map` directly (no snapshot
 * array); this function does not build any intermediate `{x,y}` records or
 * per-material grouping arrays — it sets `ctx.fillStyle` lazily, only when
 * the material actually changes between consecutive particles in iteration
 * order (cheap because occupancy is a single `Map`, typically dominated by
 * one material for now). With only one material (`MATERIAL_SAND`) this is
 * equivalent to a single `fillStyle` assignment for the whole draw; the
 * per-particle check is what keeps this correct once more materials exist,
 * without reintroducing a grouping allocation.
 */

import type { WorldState } from '../../sim/world';
import { MATERIAL_VISUALS } from '../../sim/pixelMaterials/pixelMaterialTypes';

const FALLBACK_COLOR = '#ffffff';

export function renderPixelMaterials(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const system = world.pixelMaterialSystem;
  if (system.occupiedCount === 0) return;

  // Snap zoom-scaled cell size to whole device pixels so every particle
  // renders at an identical size — fractional zoom would otherwise round
  // some cells up and others down, producing visibly inconsistent sizes.
  const size = Math.max(1, Math.round(zoom));
  let currentMaterial = -1;

  system.forEachParticle((x, y, material) => {
    if (material !== currentMaterial) {
      currentMaterial = material;
      const visual = MATERIAL_VISUALS[material];
      ctx.fillStyle = visual !== undefined ? visual.color : FALLBACK_COLOR;
    }
    const px = Math.round(x * zoom + offsetXPx);
    const py = Math.round(y * zoom + offsetYPx);
    ctx.fillRect(px, py, size, size);
  });
}
