/**
 * customBlockWindVents.ts — Phase 2H: continuous directional pixel-material
 * wind emission from custom-block placements (`windEmission: 'left' | 'right'
 * | 'up' | 'down'` — see customBlockProperties.ts).
 *
 * This is a production CALLER of the existing `PixelMaterialSystem.applyWindForce`
 * primitive (extended in Phase 2H with an optional forward-only directional
 * gate — see `WindForceParams` in pixelMaterialTypes.ts), NOT a second wind
 * physics engine. Every vent emission reuses, unchanged:
 *   - The existing circular radius + linear falloff region.
 *   - `CustomBlockWindMask`/`resolveCustomBlockWindTransmission` (Phase 2F) —
 *     a vent's outgoing wind is dampened/blocked by other windbreaks exactly
 *     like any other wind source.
 *   - `getMaterialWindResponse` — sand/water/sandstone each respond to vent
 *     wind exactly as they do to movement wind.
 *   - Particle deduplication, momentum accumulation/damping, and wake
 *     behavior (`applyWindForce`'s existing `windAffectedScratch`/`wake`).
 *
 * Mirrors `pixelMaterialMovementWind.ts`'s role: this module only decides
 * WHEN, WHERE, and in WHICH DIRECTION to call the existing primitive.
 *
 * ── Self-occlusion (a vent that is also its own windbreak) ─────────────────
 *
 * A block with `windResponse: 'block'` AND `windEmission: 'right'` must
 * still emit outward. This is solved GEOMETRICALLY, not by excluding cells
 * from the mask: the emission source is placed exactly at the outer edge of
 * the placement's footprint (a `WIND_VENT_SOURCE_OFFSET_PX` nudge further
 * out), and `CustomBlockWindMask.markRect` marks the placement's footprint
 * as `[xBlock, xBlock+wBlock) x [yBlock, yBlock+hBlock)` — a half-open range
 * that does NOT include the source point. Because the emission direction
 * points strictly away from the footprint, the ray from source to any
 * forward target cell can never re-enter the block's own mask region —
 * self-occlusion is structurally impossible, with no ownership/exclusion
 * bookkeeping required. An independent block placed further along the
 * emission path is NOT excluded by anything here and still occludes
 * normally, exactly as Phase 2F already guarantees.
 *
 * ── Directional geometry ────────────────────────────────────────────────────
 *
 * "Forward range" and "lateral fan width" are expressed as a single cone —
 * the existing circular `radiusPx` (forward reach) intersected with an
 * angular half-plane test relative to the direction vector (lateral spread)
 * — rather than as two independent rectangle dimensions. This keeps the
 * geometry exactly cardinal-direction symmetric (rotating the direction
 * vector 90° at a time produces the exact same cone shape, just rotated) and
 * needs no new region primitive in `applyWindForce`.
 */

import type { WorldState } from '../world';

/**
 * Engine-owned base emission force (px/s equivalent, pre-material-response),
 * chosen from the existing movement-wind scale
 * (`pixelMaterialMovementWind.ts`: MIN_FORCE=24, MAX_FORCE=130 — the
 * strongest movement gusts, e.g. a grapple-zip player, reach 130) and the
 * sandstone erosion floor (`SANDSTONE_MIN_EROSION_WIND_SPEED` = 40 px/s,
 * post-material-response). 90 sits clearly above both the erosion floor and
 * ordinary movement-wind gusts (visibly stronger and clearly directional
 * against sand/water) while staying below the strongest possible
 * player-generated gust (130) — matching the requirement that a vent be
 * strong but not stronger than an extreme high-speed player gust.
 */
export const CUSTOM_BLOCK_WIND_VENT_FORCE = 90;

/**
 * Engine-owned forward range (native px), reused directly as `radiusPx` in
 * the underlying `applyWindForce` call. Larger than movement wind's
 * MAX_RADIUS_PX (11) since a vent is a persistent directional beam meant to
 * visibly affect a stretch of material, not a brief local disturbance — but
 * still bounded (not room-spanning) so cost stays O(range²), matching
 * `applyWindForce`'s existing localized-scan architecture.
 */
export const CUSTOM_BLOCK_WIND_VENT_RANGE_PX = 24;

/** Full linear falloff to 0 at the edge of the range — matches every other wind source's default. */
export const CUSTOM_BLOCK_WIND_VENT_FALLOFF = 1;

/**
 * Half-angle (degrees) of the vent's forward cone. 40° keeps the lateral
 * spread narrow enough to read as clearly directional (not an omnidirectional
 * gust with a favored side) while still affecting a visible fan of cells
 * directly in front of the face, rather than a single-pixel-wide ray.
 */
export const CUSTOM_BLOCK_WIND_VENT_HALF_FAN_DEG = 40;

/** Precomputed once at module load — never recomputed per tick/per vent. */
export const CUSTOM_BLOCK_WIND_VENT_COS_HALF_FAN_ANGLE = Math.cos(CUSTOM_BLOCK_WIND_VENT_HALF_FAN_DEG * (Math.PI / 180));

/**
 * How far outside the placement's own footprint the emission source sits
 * (native px). Zero would already be safe (the mask's half-open upper bound
 * excludes the exact boundary pixel), but a small positive nudge adds a
 * defensive margin against float/rounding edge cases without meaningfully
 * changing the emission geometry.
 */
export const CUSTOM_BLOCK_WIND_VENT_SOURCE_OFFSET_PX = 0.5;

/** Packed-direction-index -> outward unit vector. Indexed by `windEmissionDirectionToIndex` (0=left,1=right,2=up,3=down). Built once at module load. */
const VENT_DIRECTION_X: readonly number[] = [-1, 1, 0, 0];
const VENT_DIRECTION_Y: readonly number[] = [0, 0, -1, 1];

/**
 * Emits one directional wind impulse per active vent per fixed step. Run in
 * the existing fixed-step wind phase (see tick.ts), before pixel-material
 * movement, alongside `applyMovementWindToPixelMaterials`.
 *
 * Deterministic: fixed iteration order (ascending vent index), no
 * `Math.random()`, no wall-clock timers, no per-tick JSON/registry lookups
 * (every value read here is a pre-resolved typed-array entry). Zero-vent
 * rooms return immediately — the required fast path.
 */
export function applyCustomBlockWindVents(world: WorldState): void {
  const count = world.windVentCount;
  if (count === 0) return;

  const system = world.pixelMaterialSystem;
  const xWorld = world.windVentXWorld;
  const yWorld = world.windVentYWorld;
  const wWorld = world.windVentWWorld;
  const hWorld = world.windVentHWorld;
  const direction = world.windVentDirection;
  const active = world.windVentActiveFlag;

  for (let i = 0; i < count; i++) {
    if (active[i] === 0) continue;

    const dirIndex = direction[i];
    const dirX = VENT_DIRECTION_X[dirIndex];
    const dirY = VENT_DIRECTION_Y[dirIndex];

    const x0 = xWorld[i];
    const y0 = yWorld[i];
    const w = wWorld[i];
    const h = hWorld[i];

    // Face center of the emitting side — the full width/height of the
    // logical placement, so a 2x2 vent emits once from the center of its
    // complete two-tile-wide face, never once per occupied tile.
    let faceX: number;
    let faceY: number;
    switch (dirIndex) {
      case 0: faceX = x0; faceY = y0 + h * 0.5; break; // left
      case 1: faceX = x0 + w; faceY = y0 + h * 0.5; break; // right
      case 2: faceX = x0 + w * 0.5; faceY = y0; break; // up
      default: faceX = x0 + w * 0.5; faceY = y0 + h; break; // down
    }

    // Source sits just OUTSIDE the footprint, in the emission direction —
    // see the module doc comment's self-occlusion explanation.
    const sourceX = faceX + dirX * CUSTOM_BLOCK_WIND_VENT_SOURCE_OFFSET_PX;
    const sourceY = faceY + dirY * CUSTOM_BLOCK_WIND_VENT_SOURCE_OFFSET_PX;

    system.applyWindForce({
      centerXPx: sourceX,
      centerYPx: sourceY,
      radiusPx: CUSTOM_BLOCK_WIND_VENT_RANGE_PX,
      forceX: dirX * CUSTOM_BLOCK_WIND_VENT_FORCE,
      forceY: dirY * CUSTOM_BLOCK_WIND_VENT_FORCE,
      falloff: CUSTOM_BLOCK_WIND_VENT_FALLOFF,
      dirX,
      dirY,
      cosHalfFanAngle: CUSTOM_BLOCK_WIND_VENT_COS_HALF_FAN_ANGLE,
      // No sourceId — that field is otherwise unused by applyWindForce, and
      // constructing a per-tick debug string for every vent every tick would
      // be needless per-tick string allocation for a value nothing reads.
    });
  }
}
