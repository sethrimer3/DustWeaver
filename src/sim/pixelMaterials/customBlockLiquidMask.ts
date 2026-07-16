/**
 * customBlockLiquidMask.ts — Phase 2G: native-pixel liquid-interaction mask
 * for custom blocks (pixel-material seal/drain).
 *
 * This is a SEPARATE concept from `SolidMask` (pixelMaterialSolid.ts) and from
 * `CustomBlockWindMask` (customBlockWindMask.ts), mirroring the latter's
 * architecture:
 *
 *   - `SolidMask` answers "can ANY pixel-material particle occupy this cell?"
 *     — reused as-is; this phase does not touch it or its meaning.
 *   - `CustomBlockLiquidMask` (this file) answers "does a custom block modify
 *     how pixel-material LIQUID particles specifically (not sand/sandstone)
 *     may occupy or move into this cell?" — independent of solid occupancy,
 *     independent of player collision.
 *
 * A cell only ever has a non-zero entry here if a custom block placement was
 * registered with `liquidInteraction: 'seal'` or `'drain'` (see
 * `isEligibleForLiquidInteraction` in customBlockProperties.ts) — this applies
 * regardless of the placement's collision preset (solid, oneWay, or
 * nonSolid), unlike the wind-transmission mask, which requires solid
 * collision. 'none' (the default, and every pre-Phase-2G block) is never
 * written to this mask at all — an empty mask (`isEmpty === true`) means the
 * room's liquid simulation behaves byte-identically to pre-Phase-2G code, and
 * callers use that flag to skip all liquid-mask lookups entirely (the
 * required fast path — see `PixelMaterialSystem.stepLiquidParticle`).
 */

const LIQUID_TIER_NONE = 0;
const LIQUID_TIER_SEAL = 1;
const LIQUID_TIER_DRAIN = 2;

export { LIQUID_TIER_NONE, LIQUID_TIER_SEAL, LIQUID_TIER_DRAIN };

/**
 * Native-pixel resolution liquid-interaction occupancy mask, mirroring the
 * architecture of `CustomBlockWindMask` but storing the seal/drain tier (0 =
 * no modifier, 1 = seal, 2 = drain) instead of a wind-transmission tier, and
 * with no ray-tracing (liquid movement only ever needs to test the immediate
 * destination cell(s), not a line between two distant points).
 */
export class CustomBlockLiquidMask {
  readonly widthPx: number;
  readonly heightPx: number;
  private readonly mask: Uint8Array;
  private nonZeroCells = 0;

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = Math.max(0, Math.floor(widthPx));
    this.heightPx = Math.max(0, Math.floor(heightPx));
    this.mask = new Uint8Array(this.widthPx * this.heightPx);
  }

  /**
   * True when no custom block in the room currently seals or drains liquid.
   * Callers check this ONCE per particle movement call and skip all mask
   * lookups entirely when true — the required fast path for rooms with no
   * liquid-interaction blocks.
   */
  get isEmpty(): boolean {
    return this.nonZeroCells === 0;
  }

  /** Tier at (x, y): 0 = no modifier (unregistered or out of bounds), 1 = seal, 2 = drain. */
  tierAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.widthPx || y >= this.heightPx) return LIQUID_TIER_NONE;
    return this.mask[y * this.widthPx + x];
  }

  clear(): void {
    this.mask.fill(0);
    this.nonZeroCells = 0;
  }

  /**
   * Marks the native-pixel rectangle [x0,x1) x [y0,y1) with the given tier,
   * clamped to mask bounds. Room-build time only registers non-overlapping
   * placements (see the overlap-rejection in editorRoomBuilder.ts), but this
   * still resolves any accidental/legacy overlap deterministically by taking
   * the MAX tier per cell (drain=2 > seal=1 > none=0) rather than silently
   * letting the later call win — matching the documented "drain > seal >
   * none" priority even for malformed data.
   */
  markRect(x0: number, y0: number, x1: number, y1: number, tier: 1 | 2): void {
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(this.widthPx, Math.ceil(x1));
    const cy1 = Math.min(this.heightPx, Math.ceil(y1));
    for (let y = cy0; y < cy1; y++) {
      const rowBase = y * this.widthPx;
      for (let x = cx0; x < cx1; x++) {
        const idx = rowBase + x;
        const prev = this.mask[idx];
        if (prev === LIQUID_TIER_NONE) this.nonZeroCells++;
        if (tier > prev) this.mask[idx] = tier;
      }
    }
  }

  /**
   * Clears the native-pixel rectangle back to "no modifier". Used when a
   * fragile seal/drain block is destroyed — see `destroyBreakableBlockCell`
   * in sim/hazards.ts, which calls this to invalidate just the destroyed
   * cell's region rather than rebuilding the whole room's mask. Safe because
   * room-build time rejects overlapping liquid-interaction placements, so
   * every non-zero cell belongs to exactly one logical placement.
   */
  clearRect(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(this.widthPx, Math.ceil(x1));
    const cy1 = Math.min(this.heightPx, Math.ceil(y1));
    for (let y = cy0; y < cy1; y++) {
      const rowBase = y * this.widthPx;
      for (let x = cx0; x < cx1; x++) {
        const idx = rowBase + x;
        if (this.mask[idx] !== LIQUID_TIER_NONE) this.nonZeroCells--;
        this.mask[idx] = LIQUID_TIER_NONE;
      }
    }
  }
}
