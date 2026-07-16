/**
 * customBlockWindMask.ts — Phase 2F: native-pixel wind-TRANSMISSION mask for
 * custom blocks.
 *
 * This is a SEPARATE concept from `SolidMask` (pixelMaterialSolid.ts) and from
 * the per-material `getMaterialWindResponse` table (pixelMaterialTypes.ts):
 *
 *   - `SolidMask` answers "can a pixel-material particle occupy this cell?" —
 *     reused as-is; this phase does not touch it or its meaning.
 *   - `getMaterialWindResponse` answers "how reactive IS this material to
 *     wind, once a force reaches it?" — reused as-is.
 *   - `CustomBlockWindMask` (this file) answers "how much of an emitter's
 *     force reaches a given native pixel at all, given the custom blocks
 *     standing between the emitter and that pixel?" — a pure TRANSMISSION
 *     term, applied once via `resolveCustomBlockWindTransmission` and
 *     multiplied into `PixelMaterialSystem.applyWindForce` alongside the
 *     existing distance falloff and material response:
 *
 *       final velocity delta = forceX/Y * falloff * transmission * materialResponse
 *
 * A cell only ever has an entry here if a custom block placement was
 * registered with `windResponse: 'dampen'` or `'block'` AND `collision:
 * 'solid'` (see `isEligibleForWindTransmission` in customBlockProperties.ts).
 * `'passThrough'` blocks (the default, and every pre-Phase-2F wall) are never
 * written to this mask at all — an empty mask (`isEmpty === true`) means the
 * room behaves byte-identically to pre-Phase-2F code, and callers use that
 * flag to skip ray tracing entirely (see the fast path in `applyWindForce`).
 */

const WIND_TRANSMISSION_TIER_NONE = 0;
const WIND_TRANSMISSION_TIER_DAMPEN = 1;
const WIND_TRANSMISSION_TIER_BLOCK = 2;

/**
 * Centralized dampening multiplier for the 'dampen' wind-response tier.
 * Existing per-material wind response (getMaterialWindResponse) ranges from
 * 0.55 (2x2 sand, heaviest) to 1.3 (water, lightest/most reactive) — 0.4 sits
 * below that entire range so a dampened impulse is always clearly weaker than
 * even the heaviest material's own response would otherwise suggest, while
 * staying well above the 'block' tier's exact 0. This value affects only the
 * transmission term; it never modifies `getMaterialWindResponse` or any
 * emitter's base force/radius/falloff constants.
 */
export const CUSTOM_BLOCK_WIND_DAMPEN_FACTOR = 0.4;

/** Defensive upper bound on ray-trace steps — no real room's native-pixel diagonal comes close to this. */
const MAX_TRACE_STEPS = 4096;

/**
 * Native-pixel resolution wind-transmission occupancy mask, mirroring the
 * architecture of `SolidMask` (pixelMaterialSolid.ts) but storing a 3-value
 * tier (0 = no restriction / not a wind-modifying block, 1 = dampen, 2 =
 * block) instead of a boolean, and tracking a non-zero-cell count so callers
 * can cheaply detect "no wind-modifying blocks in this room at all" without
 * scanning the array.
 */
export class CustomBlockWindMask {
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
   * True when no custom block in the room currently dampens or blocks wind.
   * Callers (`applyWindForce`) check this ONCE per call and skip ray tracing
   * entirely when true — the required fast path for passThrough-only rooms.
   */
  get isEmpty(): boolean {
    return this.nonZeroCells === 0;
  }

  /** Tier at (x, y): 0 = no restriction (pass-through, unregistered, or out of bounds), 1 = dampen, 2 = block. */
  tierAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.widthPx || y >= this.heightPx) return WIND_TRANSMISSION_TIER_NONE;
    return this.mask[y * this.widthPx + x];
  }

  clear(): void {
    this.mask.fill(0);
    this.nonZeroCells = 0;
  }

  /** Marks the native-pixel rectangle [x0,x1) x [y0,y1) with the given tier, clamped to mask bounds. */
  markRect(x0: number, y0: number, x1: number, y1: number, tier: 1 | 2): void {
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(this.widthPx, Math.ceil(x1));
    const cy1 = Math.min(this.heightPx, Math.ceil(y1));
    for (let y = cy0; y < cy1; y++) {
      const rowBase = y * this.widthPx;
      for (let x = cx0; x < cx1; x++) {
        const idx = rowBase + x;
        if (this.mask[idx] === WIND_TRANSMISSION_TIER_NONE) this.nonZeroCells++;
        this.mask[idx] = tier;
      }
    }
  }

  /**
   * Clears the native-pixel rectangle back to "no restriction". Used when a
   * fragile windbreak block is destroyed — see `destroyBreakableBlockCell` in
   * sim/hazards.ts, which calls this to invalidate just the destroyed cell's
   * region rather than rebuilding the whole room's mask (matching the
   * targeted-region precedent already used for solid-mask sync).
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
        if (this.mask[idx] !== WIND_TRANSMISSION_TIER_NONE) this.nonZeroCells--;
        this.mask[idx] = WIND_TRANSMISSION_TIER_NONE;
      }
    }
  }
}

/**
 * Bounded integer Bresenham line trace from (x0,y0) to (x1,y1) (both native-
 * pixel coordinates, rounded to the nearest cell), returning the MAXIMUM
 * transmission tier encountered along the path — the "minimum transmission
 * encountered" policy requested for thick/2x2 windbreaks and for paths that
 * cross multiple distinct blocks: since tier ordering (0=passThrough <
 * 1=dampen < 2=block) is monotonic in restrictiveness, taking the max tier
 * is equivalent to taking the minimum transmission, and converting to a
 * float multiplier only ONCE after the walk (via
 * `resolveCustomBlockWindTransmission`) avoids compounding dampening by
 * thickness — a 2-cell-thick dampening wall attenuates exactly as much as a
 * 1-cell-thick one, never more.
 *
 * No heap allocation, no recursion, bounded by MAX_TRACE_STEPS. Exits early
 * the moment tier 2 (full block) is seen, since no tier can exceed it.
 *
 * A cell beside the source-target path is never visited (only cells the line
 * itself crosses are), so a block standing next to the path but not between
 * the two points has no effect — matching the "beside vs. between" directional
 * requirement.
 */
export function traceMaxWindTransmissionTier(
  mask: CustomBlockWindMask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  if (mask.isEmpty) return WIND_TRANSMISSION_TIER_NONE;

  let cx = Math.round(x0);
  let cy = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);

  const dx = Math.abs(tx - cx);
  const dy = -Math.abs(ty - cy);
  const sx = cx < tx ? 1 : -1;
  const sy = cy < ty ? 1 : -1;
  let err = dx + dy;

  let maxTier = WIND_TRANSMISSION_TIER_NONE;
  let steps = 0;
  for (;;) {
    const tier = mask.tierAt(cx, cy);
    if (tier > maxTier) maxTier = tier;
    if (maxTier >= WIND_TRANSMISSION_TIER_BLOCK) return WIND_TRANSMISSION_TIER_BLOCK;
    if (cx === tx && cy === ty) break;
    if (++steps > MAX_TRACE_STEPS) break; // defensive; should never trigger for any real room size
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
  return maxTier;
}

/**
 * Converts a tier (as returned by `traceMaxWindTransmissionTier`) into the
 * float multiplier applied to wind force. 'passThrough'/no-occluder is
 * exactly 1 (a complete no-op, byte-identical to pre-Phase-2F behavior);
 * 'block' is exactly 0; 'dampen' uses the single centralized
 * `CUSTOM_BLOCK_WIND_DAMPEN_FACTOR`. This is the ONLY place a tier is turned
 * into a number — no other call site compares tiers or hardcodes a factor.
 */
export function resolveCustomBlockWindTransmission(tier: number): number {
  switch (tier) {
    case WIND_TRANSMISSION_TIER_BLOCK: return 0;
    case WIND_TRANSMISSION_TIER_DAMPEN: return CUSTOM_BLOCK_WIND_DAMPEN_FACTOR;
    default: return 1;
  }
}
