/**
 * Renders occupied pixel-material cells (currently: sand) as crisp,
 * one-native-pixel squares. No smoothing/subpixel blending — matches the
 * project's pixel-art rendering behaviour. Single draw loop, no per-particle
 * scene objects or draw calls beyond individual `fillRect`s batched by color.
 */

import type { WorldState } from '../../sim/world';
import { MATERIAL_VISUALS } from '../../sim/pixelMaterials/pixelMaterialTypes';

export function renderPixelMaterials(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const system = world.pixelMaterialSystem;
  if (system.occupiedCount === 0) return;

  // Group by material so each color only needs one fillStyle assignment.
  const byMaterial = new Map<number, { x: number; y: number }[]>();
  system.forEachParticle((x, y, material) => {
    let list = byMaterial.get(material);
    if (list === undefined) {
      list = [];
      byMaterial.set(material, list);
    }
    list.push({ x, y });
  });

  const size = Math.max(1, zoom);
  for (const [material, cells] of byMaterial) {
    const visual = MATERIAL_VISUALS[material];
    ctx.fillStyle = visual !== undefined ? visual.color : '#ffffff';
    for (const c of cells) {
      const px = Math.round(c.x * zoom + offsetXPx);
      const py = Math.round(c.y * zoom + offsetYPx);
      ctx.fillRect(px, py, size, size);
    }
  }
}
