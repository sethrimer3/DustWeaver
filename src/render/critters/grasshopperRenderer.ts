/**
 * Grasshopper critter renderer — draws 1×1 virtual-pixel light-blue dots.
 */

import type { WorldSnapshot } from '../snapshot';

export function renderGrasshoppers(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  if (snapshot.grasshopperCount === 0) return;
  ctx.fillStyle = '#88ccff';
  for (let i = 0; i < snapshot.grasshopperCount; i++) {
    if (snapshot.isGrasshopperAliveFlag[i] === 0) continue;
    const virtualXPx = Math.round(snapshot.grasshopperXWorld[i] * zoom + offsetXPx);
    const virtualYPx = Math.round(snapshot.grasshopperYWorld[i] * zoom + offsetYPx);
    ctx.fillRect(virtualXPx, virtualYPx, 1, 1);
  }
}
