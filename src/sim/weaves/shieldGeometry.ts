/**
 * Shield Geometry — shared pure helpers for the Shield Weave's crescent
 * placement and the single canonical "shield center" point (task section 2).
 *
 * The Shield crescent is not centered on the player's body; it forms in a ring
 * around a point offset SHIELD_CRESCENT_RADIUS_WORLD in front of the player,
 * along the current aim direction. That offset point — the "shield center" —
 * is where the Bow Weave's arrow assembles, launches, and previews from, so
 * this module is the single source of the radius constant and the center
 * formula. Do not duplicate SHIELD_CRESCENT_RADIUS_WORLD or re-derive the
 * center point anywhere else.
 *
 * Also hosts the center-out queue-ordering helper (`centerOutArcT`) shared by
 * the Shield crescent's per-rank placement and the Bow's deterministic
 * edge-mote selection, so both derive "which slot is where" from the exact
 * same rule instead of two independent implementations drifting apart.
 */

/** Distance (world units) from the player at which the shield crescent forms. */
export const SHIELD_CRESCENT_RADIUS_WORLD = 12.0;

/** Mutable output point, reused by callers to stay allocation-free. */
export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Computes the shield's canonical center point: the player position offset by
 * `SHIELD_CRESCENT_RADIUS_WORLD` along the normalized aim direction. This is
 * where the shield crescent's front-center slot sits, and is the single
 * authoritative seating/launch/preview origin for the Bow Weave's arrow.
 *
 * Falls back to `fallbackDirXWorld/YWorld` (assumed already meaningful, e.g.
 * the previously-resolved aim direction) when the supplied aim direction has
 * ~zero length, so callers never need their own independent fallback.
 *
 * Writes into `out` and returns it — allocation-free.
 */
export function computeShieldCenterWorld(
  out: WorldPoint,
  playerXWorld: number,
  playerYWorld: number,
  aimDirXWorld: number,
  aimDirYWorld: number,
  fallbackDirXWorld: number,
  fallbackDirYWorld: number,
): WorldPoint {
  const len = Math.hypot(aimDirXWorld, aimDirYWorld);
  const dirX = len > 1e-6 ? aimDirXWorld / len : fallbackDirXWorld;
  const dirY = len > 1e-6 ? aimDirYWorld / len : fallbackDirYWorld;
  out.x = playerXWorld + dirX * SHIELD_CRESCENT_RADIUS_WORLD;
  out.y = playerYWorld + dirY * SHIELD_CRESCENT_RADIUS_WORLD;
  return out;
}

/**
 * Computes the arc-t position (0..1 along the crescent) for a mote at `rank`
 * in the center-out ordering. Rank 0 gets the center, rank 1 just above,
 * rank 2 just below, rank 3 further above, etc. — earliest-queue motes
 * occupy the strongest defensive (center) positions.
 *
 * Shared by the Shield crescent's placement (shieldWeave.ts) and the Bow's
 * deterministic edge-mote selection (bowArrow.ts): for any slot count `n`,
 * the LAST two ranks processed in this ordering (`n-2`, `n-1`) always land on
 * the two arc extremes (posIdx 0 and posIdx n-1) — i.e. scanning available
 * motes from the end of the center-out list inward always visits the
 * outermost shield-arc slot first, then the next-outermost, deterministically
 * and without relying on any physics/position sampling.
 */
export function centerOutArcT(rank: number, n: number): number {
  if (n <= 1) return 0.5;
  const center = Math.floor((n - 1) / 2);
  let posIdx: number;
  if (rank === 0) {
    posIdx = center;
  } else if (rank % 2 === 1) {
    posIdx = center + Math.ceil(rank / 2);
  } else {
    posIdx = center - (rank / 2);
  }
  posIdx = Math.max(0, Math.min(n - 1, posIdx));
  return posIdx / (n - 1);
}
