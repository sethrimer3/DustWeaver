/**
 * Solid occupancy mask for the pixel-material simulation.
 *
 * Builds a native-pixel resolution boolean mask from the world's wall
 * rectangles (`WorldState.wallXWorld` etc.) so the falling-sand sim can query
 * "is this native pixel blocked by immutable world geometry" in O(1) without
 * re-scanning the wall list every step.
 *
 * World tiles are NOT converted into simulated particles — this mask is a
 * read-only collision query surface layered on top of the existing wall
 * arrays. Internal 8x8 tile boundaries do not matter; only occupied vs.
 * unoccupied space is tracked (per the task's "Solid occupancy" requirements).
 *
 * One-way platforms do not block sand (sand falls through them, matching
 * their one-way gameplay semantics). Ramps are conservatively treated as
 * full solid rectangles for this first version — a documented simplification
 * (see docs/pixelMaterials.md).
 */

import type { WorldState } from '../world';

export class SolidMask {
  readonly widthPx: number;
  readonly heightPx: number;
  private readonly mask: Uint8Array;

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = Math.max(0, Math.floor(widthPx));
    this.heightPx = Math.max(0, Math.floor(heightPx));
    this.mask = new Uint8Array(this.widthPx * this.heightPx);
  }

  isSolid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.widthPx || y >= this.heightPx) return true; // room bounds are solid
    return this.mask[y * this.widthPx + x] === 1;
  }

  clear(): void {
    this.mask.fill(0);
  }

  /** Marks the native-pixel rectangle [x0,x1) x [y0,y1) as solid, clamped to mask bounds. */
  markRect(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(this.widthPx, Math.ceil(x1));
    const cy1 = Math.min(this.heightPx, Math.ceil(y1));
    for (let y = cy0; y < cy1; y++) {
      const rowBase = y * this.widthPx;
      this.mask.fill(1, rowBase + cx0, rowBase + cx1);
    }
  }
}

/**
 * Rebuilds a solid-occupancy mask from the current wall geometry.
 * Call whenever room geometry changes (room load, editor tile paint/erase).
 */
export function buildSolidMaskFromWorld(world: WorldState, widthPx: number, heightPx: number): SolidMask {
  const mask = new SolidMask(widthPx, heightPx);
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue; // one-way platforms don't block sand
    const x0 = world.wallXWorld[wi];
    const y0 = world.wallYWorld[wi];
    const x1 = x0 + world.wallWWorld[wi];
    const y1 = y0 + world.wallHWorld[wi];
    if (x1 <= x0 || y1 <= y0) continue;
    mask.markRect(x0, y0, x1, y1);
  }
  return mask;
}
