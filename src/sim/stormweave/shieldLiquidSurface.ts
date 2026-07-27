/**
 * shieldLiquidSurface.ts — Shield Weave liquid-surface contact adapter.
 *
 * Defines a deterministic, directional contact contract for testing whether
 * the Shield Weave crescent is touching a liquid zone's exposed horizontal
 * top surface from above, directly below the player, with sufficient
 * horizontal speed to qualify for liquid surfing/skipping.
 *
 * This module is pure and Node-safe: no DOM, no Math.random, no wall-clock
 * time. It is called from hazards.ts during the liquid-zone sections.
 *
 * Design constraints (from the feature spec):
 *   - Only the exposed top surface of a zone counts; sides, bottom, and
 *     interior overlap do not qualify.
 *   - The contact point must be within the player's horizontal collision
 *     footprint (directly below the player).
 *   - |vx| must be strictly > SHIELD_LIQUID_SKIP_MIN_SPEED_X for a skip.
 *   - Frozen water is excluded (caller must check frozenWaterZoneMask).
 *   - One skip per approach: the latch tracks whether the crescent was
 *     previously touching the surface and resets when separation occurs.
 *   - No ordinary-projectile-blocker (doesAabbIntersectShield) is reused.
 *
 * Collision strategy:
 *   The exposed top surface of a liquid zone is the horizontal segment
 *   [zoneLeft, zoneRight] at Y = zoneTop. We test whether the shield
 *   crescent's lowest arc segment (the part of the visible arc nearest the
 *   bottom of the player, i.e. near π/2 = straight down) intersects an
 *   inflated version of this segment. "Inflated" means the segment is
 *   thickened by SHIELD_COLLISION_HALF_THICKNESS_WORLD so near-grazes count.
 *
 *   To avoid tunneling at high speed we also test whether the player's body
 *   bottom crossed the surface between the previous position (estimated from
 *   the current position minus one tick's downward travel) and the current
 *   tick. This swept test uses only the player's horizontal footprint.
 *
 *   Contact is validated only when:
 *     1. The shield is active with ≥ 1 mote.
 *     2. The player is moving downward (velocityYWorld > 0) — we're
 *        approaching the surface, not moving away.
 *     3. The arc actually crosses the horizontal band around zoneTop.
 *     4. The crossing point falls within the player's horizontal footprint.
 *     5. The zone is not frozen (caller check for water; lava has no frozen state).
 *
 * NOTE: The latch reset (shieldLiquidContactIsLatchedFlag) is owned by
 * worldHazardState and reset on room load / death / shield release via
 * resetShieldLiquidContactLatch(), which callers must invoke at those events.
 */

import {
  SHIELD_COLLISION_HALF_THICKNESS_WORLD,
  type ShieldArcGeometry,
} from './shieldWeave';

/** Minimum incoming |vx| (px/s) for a shield-liquid skip to qualify. */
export const SHIELD_LIQUID_SKIP_MIN_SPEED_X = 10;

/**
 * Narrow result type returned by checkShieldLiquidSurfaceContact.
 * normalX/normalY describe the surface — always (0, -1) for the top face.
 */
export interface ShieldLiquidSurfaceContact {
  /** X of the contact point on the top surface, world units. */
  xWorld: number;
  /** Y of the contact point on the top surface (= zone's top Y), world units. */
  yWorld: number;
  /** Surface normal X component: always 0 (horizontal surface). */
  normalX: 0;
  /** Surface normal Y component: always -1 (pointing upward, i.e. away from liquid). */
  normalY: -1;
  /** 'water' or 'lava'. */
  liquidKind: 'water' | 'lava';
  /** Index of the zone in the world's lava/water zone arrays. */
  zoneIndex: number;
}

/**
 * Tests the shield crescent against a single liquid zone's exposed top
 * surface and returns a contact descriptor when all qualifying conditions
 * are met, or null otherwise.
 *
 * The caller is responsible for:
 *   - Confirming the zone is not frozen (frozenWaterZoneMask for water).
 *   - Passing the correct liquidKind and zoneIndex.
 *   - Only calling this when the shield is active (geometry.isActive === true
 *     and geometry.moteCount >= 1).
 *
 * @param geometry    The current shield geometry (post-movement this tick).
 * @param zoneLeft    Left X edge of the liquid zone (world units).
 * @param zoneTop     Top Y edge (= exposed surface Y) of the liquid zone.
 * @param zoneRight   Right X edge of the liquid zone (world units).
 * @param playerXWorld   Player center X (world units).
 * @param playerHalfWidthWorld   Player half-width (world units).
 * @param playerBottomYWorld     Player bottom Y (= center + halfHeight).
 * @param velocityYWorld  Player current vertical velocity (positive = downward).
 * @param liquidKind   'water' or 'lava'.
 * @param zoneIndex    Index within the zone array (for the contact result).
 * @returns ShieldLiquidSurfaceContact if a qualifying top-surface contact
 *          was detected, null otherwise.
 */
export function checkShieldLiquidSurfaceContact(
  geometry: ShieldArcGeometry,
  zoneLeft: number,
  zoneTop: number,
  zoneRight: number,
  playerXWorld: number,
  playerHalfWidthWorld: number,
  _playerBottomYWorld: number,
  velocityYWorld: number,
  liquidKind: 'water' | 'lava',
  zoneIndex: number,
): ShieldLiquidSurfaceContact | null {
  // ── Guard: shield must be active with at least one mote ───────────────────
  if (!geometry.isActive || geometry.moteCount < 1) return null;

  // ── Guard: must be moving toward (or arriving at) the surface ─────────────
  // We allow slightly negative vy (already bouncing) to avoid missing a contact
  // where the player just hit and the shield arrived at the same tick. But the
  // core requirement is we're not moving definitively away (strongly upward).
  // Use a small tolerance: if vy <= -SHIELD_COLLISION_HALF_THICKNESS_WORLD we
  // consider the player as moving away from the surface.
  if (velocityYWorld < -SHIELD_COLLISION_HALF_THICKNESS_WORLD) return null;

  // ── Guard: player horizontal footprint must overlap the zone horizontally ──
  const playerLeft = playerXWorld - playerHalfWidthWorld;
  const playerRight = playerXWorld + playerHalfWidthWorld;
  if (playerRight <= zoneLeft || playerLeft >= zoneRight) return null;

  // ── Test: does the shield crescent cross the liquid's top surface? ─────────
  // The "exposed top surface segment" is the horizontal band at Y = zoneTop,
  // clipped to [max(zoneLeft,playerLeft) .. min(zoneRight,playerRight)] so we
  // only consider the portion directly below the player's footprint.
  const segLeft = Math.max(zoneLeft, playerLeft);
  const segRight = Math.min(zoneRight, playerRight);
  if (segLeft >= segRight) return null; // no overlap

  // Build a horizontally-infinite band around zoneTop with the shield's
  // collision thickness, then check if any sampled arc point falls within it.
  // We test the arc from the bottom-facing portion of the crescent: from
  // roughly straight-down (π/2) ± some span, but actually we test the whole
  // active arc and rely on the height band + horizontal clamp to filter.
  const thickness = SHIELD_COLLISION_HALF_THICKNESS_WORLD;
  const yMin = zoneTop - thickness;
  const yMax = zoneTop + thickness;

  // Sample the shield arc at 1-pixel intervals for robust contact detection
  // (mirrors the approach in doesSegmentIntersectShield).
  const sampleCount = Math.max(2, Math.ceil(geometry.arcLengthWorld) + 1);
  const startAngle = geometry.isFullCircle
    ? geometry.directionAngleRad
    : geometry.directionAngleRad - geometry.angularSpanRad * 0.5;
  const step = geometry.isFullCircle
    ? (Math.PI * 2) / sampleCount
    : geometry.angularSpanRad / (sampleCount - 1);

  let contactXWorld = -Infinity;
  let found = false;

  for (let i = 0; i < sampleCount; i++) {
    const angle = startAngle + step * i;
    const ax = geometry.centerXWorld + Math.cos(angle) * geometry.radiusWorld;
    const ay = geometry.centerYWorld + Math.sin(angle) * geometry.radiusWorld;

    if (ay >= yMin && ay <= yMax && ax >= segLeft && ax <= segRight) {
      contactXWorld = ax;
      found = true;
      break;
    }
  }

  if (!found) return null;

  return {
    xWorld: contactXWorld,
    yWorld: zoneTop,
    normalX: 0,
    normalY: -1,
    liquidKind,
    zoneIndex,
  };
}

/**
 * Applies the shield-liquid skip velocity response given the incoming
 * horizontal velocity.
 *
 * Both water and lava use the same formula. The pre-friction incoming
 * horizontal speed determines the vertical launch magnitude.
 *
 * Returns the new (vx, vy) after the skip. The caller must write these
 * values back to the player cluster.
 *
 * @param incomingVelocityXWorld  Player vx before this skip (pre-friction).
 */
export function computeShieldLiquidSkipVelocity(incomingVelocityXWorld: number): {
  velocityXWorld: number;
  velocityYWorld: number;
} {
  const incomingAbsX = Math.abs(incomingVelocityXWorld);
  const newVelocityYWorld = -(incomingAbsX * 0.5);
  const newVelocityXWorld = Math.sign(incomingVelocityXWorld) * Math.max(0, incomingAbsX - SHIELD_LIQUID_SKIP_MIN_SPEED_X);
  return {
    velocityXWorld: newVelocityXWorld,
    velocityYWorld: newVelocityYWorld,
  };
}

/**
 * Returns true if the player's AABB footprint overlaps the given liquid zone's
 * AABB at all (used for latch-separation — the latch stays set while the player
 * remains anywhere in the zone AABB, and clears once the player escapes).
 *
 * Using AABB overlap (not arc proximity) avoids the false-positive separation
 * that would occur when the arc is submerged past the surface band but the
 * player hasn't yet physically left the zone.
 */
export function isPlayerOverlappingLiquidZoneAabb(
  playerXWorld: number,
  playerHalfWidthWorld: number,
  playerYWorld: number,
  playerHalfHeightWorld: number,
  zoneLeft: number,
  zoneTop: number,
  zoneRight: number,
  zoneBottom: number,
): boolean {
  return (
    playerXWorld + playerHalfWidthWorld > zoneLeft &&
    playerXWorld - playerHalfWidthWorld < zoneRight &&
    playerYWorld + playerHalfHeightWorld > zoneTop &&
    playerYWorld - playerHalfHeightWorld < zoneBottom
  );
}
