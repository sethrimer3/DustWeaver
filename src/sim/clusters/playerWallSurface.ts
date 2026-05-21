/**
 * Wall-surface analysis helpers for wall-jump and wall-slide eligibility.
 *
 * The key problem these helpers solve: wall geometry can be partitioned into
 * many thin horizontal slats (for rendering, chunking, or performance reasons).
 * Checking eligibility against a single slat would misclassify stacked slats
 * as "too short" to wall-jump or wall-slide on.
 *
 * These helpers aggregate vertically-adjacent wall partitions that share the
 * same vertical face (faceX) into a single logical wall surface, then apply
 * the correct eligibility rules against that aggregated surface.
 *
 * Design rules implemented here:
 *
 *   Wall jump:
 *     - Works from any logical vertical surface (no minimum height).
 *     - Suppressed only when the contact point is inside the bottom
 *       WALL_GROUND_EXCLUSION_HEIGHT_WORLD above a ground-connected floor.
 *
 *   Wall slide:
 *     - Requires the logical wall surface to be at least
 *       MIN_WALL_SLIDE_SURFACE_HEIGHT_WORLD (3 blocks) tall.
 *     - Also suppressed inside the bottom 4-block ground-connected exclusion.
 *
 *   Ground-connected exclusion:
 *     - Detected by sampling slightly to the PLAYER'S SIDE of the wall face
 *       (canonical solid-occupancy query — see `computeGroundConnectedExclusion`).
 *     - The exclusion zone spans the bottom WALL_GROUND_EXCLUSION_HEIGHT_WORLD
 *       of the exposed face above the detected floor.
 *     - This approach is symmetric: equivalent left-facing and right-facing
 *       walls are treated the same regardless of how collision partitions are
 *       merged, because the query targets the player-side solid geometry rather
 *       than the wall-side rectangle boundaries.
 */

import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import type { WorldState } from '../world';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Tolerance (world units) used when comparing wall face X coordinates.
 * Two walls whose face-X values differ by at most this amount are treated
 * as sharing the same vertical face (handles float precision from collision
 * push-out).
 */
export const WALL_FACE_EPSILON = 1;

/**
 * Maximum vertical gap (world units) between the bottom of one wall partition
 * and the top of the next for them to be merged into one logical surface.
 * A gap of 0 = touching; 1 = 1 pixel gap (e.g. rounding from block pop).
 */
export const WALL_VERTICAL_GAP_TOLERANCE = 1;

/**
 * Minimum logical wall surface height (world units) required for the player
 * to wall-slide on it.  Equals 3 small blocks.
 * Short walls (stairs, lips, single block) cannot trigger a wall slide.
 */
export const MIN_WALL_SLIDE_SURFACE_HEIGHT_WORLD = BLOCK_SIZE_SMALL * 3; // 24 wu

/**
 * Height (world units) of the ground-connected no-wall-action zone measured
 * upward from the floor at the base of the logical wall.  Equals 4 small blocks.
 * Neither wall-jumping nor wall-sliding is allowed within this zone when the
 * wall base directly contacts a flat standable floor.
 */
export const WALL_GROUND_EXCLUSION_HEIGHT_WORLD = BLOCK_SIZE_SMALL * 4; // 32 wu

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A merged vertical wall surface formed by aggregating one or more wall
 * partitions that share the same face X and are vertically contiguous.
 *
 * All Y values are in world space (positive Y = downward as is the convention
 * in this engine).
 */
export interface LogicalWallSurface {
  /** X coordinate of the vertical face (right face of wall-to-player-left, or left face of wall-to-player-right). */
  faceX: number;
  /** Top Y of the aggregated surface (smallest Y = highest). */
  minY: number;
  /** Bottom Y of the aggregated surface (largest Y = lowest). */
  maxY: number;
  /** Total height: maxY − minY. */
  height: number;
  /** Number of individual wall rectangles merged into this surface. */
  rectCount: number;
  /** Height of the individual partition the player is directly overlapping (for debug). */
  rawPartitionHeightWorld: number;
}

/**
 * Ground-connected exclusion zone for a logical wall surface.
 *
 * When `hasGroundConnectedFloor` is true, the zone [exclusionMinY, exclusionMaxY]
 * at the base of the logical wall is ineligible for both wall-jumping and
 * wall-sliding.
 */
export interface GroundConnectedExclusion {
  /** True when the wall base directly touches a flat standable floor. */
  hasGroundConnectedFloor: boolean;
  /** Top Y of the exclusion zone (exclusionMaxY − WALL_GROUND_EXCLUSION_HEIGHT_WORLD). */
  exclusionMinY: number;
  /** Bottom Y of the exclusion zone (effective exposed-face bottom / top of the floor). */
  exclusionMaxY: number;
  /**
   * The detected adjacent floor top Y, measured by lateral solid-occupancy sampling.
   * `Infinity` when no floor was found; equals `surface.maxY` for the world-floor
   * shortcut path.  Exposed here for debug visualisation — shows which Y level the
   * system identified as "ground at the base of this wall face".
   */
  adjacentFloorTopY: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Aggregates all vertically-contiguous wall partitions that share `faceX` into
 * a single logical wall surface, and returns the segment that contains (or is
 * nearest to) the player's Y range.
 *
 * @param faceX         The X coordinate of the wall face to aggregate.
 *                      For a left-side wall: pass `playerPosX − playerHalfWidth`.
 *                      For a right-side wall: pass `playerPosX + playerHalfWidth`.
 * @param side          Which face type: 'left' = wall's right face; 'right' = wall's left face.
 * @param playerTop     Player AABB top (for finding the overlapping partition).
 * @param playerBottom  Player AABB bottom (for finding the overlapping partition).
 * @param world         Current world state.
 */
export function computeLogicalWallSurface(
  faceX: number,
  side: 'left' | 'right',
  playerTop: number,
  playerBottom: number,
  world: WorldState,
): LogicalWallSurface {
  // Collect (minY, maxY) spans for all non-platform, non-ramp walls whose
  // relevant face X is within WALL_FACE_EPSILON of faceX.
  // We use a simple segment list to avoid typed-array allocation — this path
  // is called at most twice per tick (once per side), not in the particle loop.
  const spans: Array<{ minY: number; maxY: number }> = [];
  let rawPartitionHeightWorld = 0;
  let seedMinY = playerTop;
  let seedMaxY = playerBottom;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop  + world.wallHWorld[wi];

    // Determine which face of this wall we're checking.
    const thisFaceX = side === 'left' ? wallRight : wallLeft;
    if (Math.abs(thisFaceX - faceX) > WALL_FACE_EPSILON) continue;

    spans.push({ minY: wallTop, maxY: wallBottom });

    // Track the partition that the player's AABB overlaps with as the "seed".
    const overlap = Math.min(playerBottom, wallBottom) - Math.max(playerTop, wallTop);
    if (overlap > 0) {
      rawPartitionHeightWorld = wallBottom - wallTop;
      seedMinY = wallTop;
      seedMaxY = wallBottom;
    }
  }

  if (spans.length === 0) {
    return {
      faceX,
      minY: playerTop,
      maxY: playerBottom,
      height: playerBottom - playerTop,
      rectCount: 0,
      rawPartitionHeightWorld,
    };
  }

  // Sort spans by their top Y (ascending = topmost first).
  spans.sort((a, b) => a.minY - b.minY);

  // Merge vertically-contiguous segments.
  const merged: Array<{ minY: number; maxY: number; count: number }> = [];
  for (const seg of spans) {
    if (merged.length === 0) {
      merged.push({ minY: seg.minY, maxY: seg.maxY, count: 1 });
    } else {
      const last = merged[merged.length - 1];
      if (seg.minY <= last.maxY + WALL_VERTICAL_GAP_TOLERANCE) {
        // Extend the current segment downward if needed.
        if (seg.maxY > last.maxY) last.maxY = seg.maxY;
        last.count += 1;
      } else {
        merged.push({ minY: seg.minY, maxY: seg.maxY, count: 1 });
      }
    }
  }

  // Find the merged segment that contains the seed partition (or is closest to
  // the player's Y range).
  let best = merged[0];
  for (const m of merged) {
    if (seedMinY >= m.minY - WALL_VERTICAL_GAP_TOLERANCE &&
        seedMaxY <= m.maxY + WALL_VERTICAL_GAP_TOLERANCE) {
      best = m;
      break;
    }
    // Fallback: prefer by distance from player midpoint.
    const playerMidY   = (playerTop + playerBottom) * 0.5;
    const bestMidY     = (best.minY + best.maxY) * 0.5;
    const mMidY        = (m.minY + m.maxY) * 0.5;
    if (Math.abs(playerMidY - mMidY) < Math.abs(playerMidY - bestMidY)) {
      best = m;
    }
  }

  return {
    faceX,
    minY: best.minY,
    maxY: best.maxY,
    height: best.maxY - best.minY,
    rectCount: best.count,
    rawPartitionHeightWorld,
  };
}

/**
 * Determines whether the base of the given logical wall surface is connected to
 * solid ground, and returns the corresponding exclusion zone.
 *
 * WHY LATERAL SAMPLING instead of wallTop-boundary matching:
 *
 *   The previous implementation scanned for a wall whose TOP edge coincides
 *   exactly with `surface.maxY` (the bottom of the merged logical surface).
 *   This breaks when the wall column was vertically merged with the floor block
 *   directly below it: the merge pass fuses them because they share the same X
 *   and width.  In the merged case the floor IS PART of the same rectangle as
 *   the wall, so no separate rectangle has wallTop == surface.maxY.  Result:
 *   the exclusion zone was never created, and wall-slide / wall-jump fired
 *   incorrectly on stair-step terrain.  The bug was asymmetric — one side of
 *   a formation worked because its floor happened to be a different partition,
 *   while the equivalent other side failed because the same-column floor block
 *   had been merged into the wall rectangle.
 *
 * THE FIX — canonical solid-occupancy lateral sample:
 *
 *   Rather than matching a specific partition boundary, we sample slightly to
 *   the PLAYER'S SIDE of the wall face and query which solid geometry exists
 *   there:
 *
 *     left wall  (wall body LEFT,  player RIGHT): sampleX = faceX + WALL_FACE_EPSILON
 *     right wall (wall body RIGHT, player LEFT):  sampleX = faceX − WALL_FACE_EPSILON
 *
 *   We then find the HIGHEST (smallest Y = most upward) solid wallTop at
 *   sampleX within the bottom WALL_GROUND_EXCLUSION_HEIGHT_WORLD of the
 *   logical surface.  This is the adjacent-floor level, regardless of how
 *   wall rectangles happen to be merged.
 *
 *   This approach is symmetric by construction: equivalent left-facing and
 *   right-facing walls probe the same kind of lateral occupancy and return the
 *   same result even when their internal partitions differ.
 *
 * @param surface  The logical wall surface to check.
 * @param side     'left' = wall is to player's left (right face = faceX);
 *                 'right' = wall is to player's right (left face = faceX).
 * @param world    Current world state.
 */
export function computeGroundConnectedExclusion(
  surface: LogicalWallSurface,
  side: 'left' | 'right',
  world: WorldState,
): GroundConnectedExclusion {
  const surfaceBottom = surface.maxY;
  const faceX         = surface.faceX;

  // ── World-floor shortcut ─────────────────────────────────────────────────
  // When the wall extends all the way to the world floor there is no separate
  // floor rectangle; treat the world boundary itself as the connected ground.
  if (surfaceBottom >= world.worldHeightWorld - WALL_VERTICAL_GAP_TOLERANCE) {
    return {
      hasGroundConnectedFloor: true,
      exclusionMinY:  surfaceBottom - WALL_GROUND_EXCLUSION_HEIGHT_WORLD,
      exclusionMaxY:  surfaceBottom,
      adjacentFloorTopY: surfaceBottom,
    };
  }

  // ── Lateral solid-occupancy sample ───────────────────────────────────────
  // sampleX is one epsilon to the PLAYER'S SIDE of the face so that we query
  // the ground geometry the player would stand on — not the wall body geometry.
  const sampleX = side === 'left'
    ? faceX + WALL_FACE_EPSILON   // player is to the right of a left-side wall
    : faceX - WALL_FACE_EPSILON;  // player is to the left of a right-side wall

  // Vertical search window: look for a floor whose top is within the bottom
  // WALL_GROUND_EXCLUSION_HEIGHT_WORLD of the logical surface.  This covers:
  //   (a) non-merged case: floor wallTop ≈ surfaceBottom (original scenario), and
  //   (b) merged case: floor wallTop < surfaceBottom because the floor block was
  //       fused into the wall column — the floor is "inside" the merged rect.
  const searchTopY    = surfaceBottom - WALL_GROUND_EXCLUSION_HEIGHT_WORLD;
  const searchBottomY = surfaceBottom + WALL_VERTICAL_GAP_TOLERANCE;

  let adjacentFloorTopY = Infinity;

  for (let wi = 0; wi < world.wallCount; wi++) {
    // Platforms are one-way and not standable as lateral ground context.
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    // Ramps use a different contact model; exclude from ground check.
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wallLeft  = world.wallXWorld[wi];
    const wallTop   = world.wallYWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];

    // The wall must horizontally contain the lateral sample point.
    if (sampleX < wallLeft - WALL_FACE_EPSILON) continue;
    if (sampleX > wallRight + WALL_FACE_EPSILON) continue;

    // The wall top must fall within the vertical search window.
    if (wallTop < searchTopY - WALL_VERTICAL_GAP_TOLERANCE) continue;
    if (wallTop > searchBottomY) continue;

    // Track the highest (smallest Y = topmost) floor top found.
    if (wallTop < adjacentFloorTopY) {
      adjacentFloorTopY = wallTop;
    }
  }

  if (adjacentFloorTopY === Infinity) {
    // No connected ground found — wall face is over a gap or ledge.
    return {
      hasGroundConnectedFloor: false,
      exclusionMinY:  0,
      exclusionMaxY:  0,
      adjacentFloorTopY: Infinity,
    };
  }

  // When the wall column was merged with the floor block below it, surfaceBottom
  // is the bottom of the merged rectangle (deeper than the real exposed face).
  // adjacentFloorTopY is the actual floor level detected on the player's side.
  // Taking min() gives the correct "where the exposed face actually ends" value
  // in both the merged and non-merged cases.
  const effectiveExposedBottom = Math.min(surfaceBottom, adjacentFloorTopY);

  return {
    hasGroundConnectedFloor: true,
    exclusionMinY:  effectiveExposedBottom - WALL_GROUND_EXCLUSION_HEIGHT_WORLD,
    exclusionMaxY:  effectiveExposedBottom,
    adjacentFloorTopY,
  };
}

/**
 * Returns true when the player's contact position is inside the ground-connected
 * exclusion zone.
 *
 * @param contactY  The Y coordinate to test (typically playerBottom = player feet).
 * @param exclusion The exclusion result from `computeGroundConnectedExclusion`.
 */
export function isContactInsideGroundExclusion(
  contactY: number,
  exclusion: GroundConnectedExclusion,
): boolean {
  if (!exclusion.hasGroundConnectedFloor) return false;
  return contactY >= exclusion.exclusionMinY && contactY <= exclusion.exclusionMaxY;
}

/**
 * Returns true when the player may wall-jump from the given surface at the
 * given contact Y.
 *
 * Wall jump rules:
 *   - Allowed from any logical surface (no minimum height requirement).
 *   - Suppressed only when the contact Y is inside the ground-connected
 *     bottom-4-block exclusion zone.
 *
 * @param surface   The aggregated logical wall surface.
 * @param exclusion The ground-connected exclusion for this surface.
 * @param contactY  The Y at which the player is contacting the wall
 *                  (typically player AABB bottom).
 */
export function canWallJumpFromSurface(
  surface: LogicalWallSurface,
  exclusion: GroundConnectedExclusion,
  contactY: number,
): boolean {
  if (surface.rectCount === 0) return false;
  if (isContactInsideGroundExclusion(contactY, exclusion)) return false;
  return true;
}

/**
 * Returns true when the player may wall-slide on the given surface at the
 * given contact Y.
 *
 * Wall slide rules:
 *   - Requires logical wall surface height >= MIN_WALL_SLIDE_SURFACE_HEIGHT_WORLD.
 *   - Suppressed inside the ground-connected bottom-4-block exclusion zone.
 *
 * @param surface   The aggregated logical wall surface.
 * @param exclusion The ground-connected exclusion for this surface.
 * @param contactY  The Y at which the player is contacting the wall
 *                  (typically player AABB bottom).
 */
export function canWallSlideOnSurface(
  surface: LogicalWallSurface,
  exclusion: GroundConnectedExclusion,
  contactY: number,
): boolean {
  if (surface.rectCount === 0) return false;
  if (surface.height < MIN_WALL_SLIDE_SURFACE_HEIGHT_WORLD) return false;
  if (isContactInsideGroundExclusion(contactY, exclusion)) return false;
  return true;
}
