/**
 * Falling Block collision helpers — shape contact tests and landing surface
 * detection.
 *
 * Extracted from fallingBlockSim.ts to keep the state-machine tick file
 * focused on state transitions while this module owns all geometry queries.
 *
 * All functions are pure (no module-level side effects beyond pre-allocated
 * scratch buffers that are reset on each call).
 */

import type { WorldState } from '../world';
import type { FallingBlockGroup } from './fallingBlockTypes';
import {
  FB_COLLISION_EPSILON,
  MAX_LANDING_CONTACTS,
  FB_STATE_IDLE_STABLE,
  FB_STATE_LANDED_STABLE,
  FB_STATE_WARNING,
  FB_STATE_PRE_FALL_PAUSE,
  getFBGroupTopWorld,
  getFBGroupBottomWorld,
  getFBGroupLeftWorld,
  getFBGroupRightWorld,
} from './fallingBlockTypes';

// ── Module-level scratch buffers ──────────────────────────────────────────────
// Pre-allocated to MAX_LANDING_CONTACTS to avoid per-frame allocations in the
// landing contact computation loop.  Only valid within a single findLandingSurface
// call (single-threaded, synchronous execution).
const _tmpContactX1 = new Float32Array(MAX_LANDING_CONTACTS);
const _tmpContactX2 = new Float32Array(MAX_LANDING_CONTACTS);
const _tmpContactY  = new Float32Array(MAX_LANDING_CONTACTS);

// ── Per-tile shape contact helpers ────────────────────────────────────────────

/**
 * Returns true if the given AABB (ax1,ay1)→(ax2,ay2) contacts any of the
 * group's collider rects within `epsilon` tolerance.
 *
 * Uses a broad-phase bounding-box check first, then tests each rect.
 */
export function contactsGroupShape(
  g: FallingBlockGroup,
  ax1: number, ay1: number, ax2: number, ay2: number,
  epsilon: number,
): boolean {
  // Broad-phase: bounding box
  const gbLeft   = getFBGroupLeftWorld(g);
  const gbTop    = getFBGroupTopWorld(g);
  const gbRight  = getFBGroupRightWorld(g);
  const gbBottom = getFBGroupBottomWorld(g);
  if (ax1 > gbRight + epsilon || ax2 < gbLeft - epsilon ||
      ay1 > gbBottom + epsilon || ay2 < gbTop - epsilon) return false;

  // Per-rect check
  const gx = g.restXWorld;
  const gy = g.restYWorld + g.offsetYWorld;
  for (let ri = 0; ri < g.colliderRectCount; ri++) {
    const rx1 = gx + g.colliderRelXWorld[ri];
    const ry1 = gy + g.colliderRelYWorld[ri];
    const rx2 = rx1 + g.colliderWWorld[ri];
    const ry2 = ry1 + g.colliderHWorld[ri];
    if (ax1 < rx2 + epsilon && ax2 > rx1 - epsilon &&
        ay1 < ry2 + epsilon && ay2 > ry1 - epsilon) return true;
  }
  return false;
}

/**
 * Returns true if the point (px, py) is inside any of the group's collider
 * rects (within epsilon tolerance).  Used for grapple anchor hit-testing.
 */
export function pointInGroupShape(
  g: FallingBlockGroup,
  px: number, py: number,
  epsilon: number,
): boolean {
  // Broad-phase
  if (px < getFBGroupLeftWorld(g) - epsilon || px > getFBGroupRightWorld(g) + epsilon ||
      py < getFBGroupTopWorld(g) - epsilon  || py > getFBGroupBottomWorld(g) + epsilon) return false;

  const gx = g.restXWorld;
  const gy = g.restYWorld + g.offsetYWorld;
  for (let ri = 0; ri < g.colliderRectCount; ri++) {
    const rx1 = gx + g.colliderRelXWorld[ri];
    const ry1 = gy + g.colliderRelYWorld[ri];
    const rx2 = rx1 + g.colliderWWorld[ri];
    const ry2 = ry1 + g.colliderHWorld[ri];
    if (px >= rx1 - epsilon && px <= rx2 + epsilon &&
        py >= ry1 - epsilon && py <= ry2 + epsilon) return true;
  }
  return false;
}

/**
 * Check whether the player cluster is resting on top of any of the group's
 * collider rects.  Returns true if the player's bottom edge is within epsilon
 * of any rect's top surface and horizontally overlaps that rect.
 */
export function isPlayerRestingOnGroupTop(
  g: FallingBlockGroup,
  playerX: number, playerY: number,
  playerHW: number, playerHH: number,
): boolean {
  const playerLeft  = playerX - playerHW;
  const playerRight = playerX + playerHW;
  const playerBot   = playerY + playerHH;

  // Broad-phase bounding box
  const groupTop   = getFBGroupTopWorld(g);
  const groupLeft  = getFBGroupLeftWorld(g);
  const groupRight = getFBGroupRightWorld(g);
  if (playerRight <= groupLeft || playerLeft >= groupRight) return false;
  if (playerBot < groupTop - (FB_COLLISION_EPSILON + 1.0)) return false;

  // Per-rect: check each collider rect's top surface
  const gx = g.restXWorld;
  const gy = g.restYWorld + g.offsetYWorld;
  for (let ri = 0; ri < g.colliderRectCount; ri++) {
    const rx1 = gx + g.colliderRelXWorld[ri];
    const rx2 = rx1 + g.colliderWWorld[ri];
    const ry1 = gy + g.colliderRelYWorld[ri];
    // Horizontal overlap with this specific rect
    if (playerRight <= rx1 || playerLeft >= rx2) continue;
    // Player bottom within epsilon of this rect's top
    if (Math.abs(playerBot - ry1) <= FB_COLLISION_EPSILON + 1.0) return true;
  }
  return false;
}

/**
 * Check whether any part of the player AABB contacts the group shape
 * (any side contact, standing on top, or within epsilon of any face).
 */
export function playerContactsGroup(
  g: FallingBlockGroup,
  playerX: number, playerY: number,
  playerHW: number, playerHH: number,
): boolean {
  return contactsGroupShape(
    g,
    playerX - playerHW, playerY - playerHH,
    playerX + playerHW, playerY + playerHH,
    FB_COLLISION_EPSILON,
  );
}

/**
 * Check whether any enemy cluster AABB contacts the group shape.
 * Returns the index of the first matching enemy cluster, or -1.
 */
export function findContactingEnemyIndex(g: FallingBlockGroup, world: WorldState): number {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 || c.isAliveFlag === 0) continue;
    if (contactsGroupShape(
      g,
      c.positionXWorld - c.halfWidthWorld,
      c.positionYWorld - c.halfHeightWorld,
      c.positionXWorld + c.halfWidthWorld,
      c.positionYWorld + c.halfHeightWorld,
      FB_COLLISION_EPSILON,
    )) return ci;
  }
  return -1;
}

// ── Landing collision ─────────────────────────────────────────────────────────

/** How many wu the group's bottom can extend below a contact surface before
 *  it is considered "landed" — prevents micro-oscillation at rest. */
export const LAND_OVERLAP_EPSILON = 0.1;
/**
 * Find the highest Y position (lowest numeric value = highest on screen) at
 * which the group lands without penetrating any static terrain or stable
 * falling block group.
 *
 * Fills the group's `lastLandingContactX1/X2/YWorld` arrays with the horizontal
 * spans where contact occurs.
 *
 * @param fbWallIndexSet  Set of all wall indices reserved by ANY falling block
 *                        group.  These are skipped in the static wall scan and
 *                        handled separately in the group-on-group pass.
 *
 * @returns  The new `g.restYWorld + g.offsetYWorld` value after snapping, or
 *           null if no surface was found.
 */
export function findLandingSurface(
  g: FallingBlockGroup,
  world: WorldState,
  fbWallIndexSet: Set<number>,
): number | null {
  // We test each collider rect independently and find the surface that limits
  // downward movement the most (= smallest newGroupTopY).
  let nearestGroupTopY = Infinity;

  // Temporary contact storage using pre-allocated module-level scratch buffers.
  // These are only valid within this synchronous call.
  let tmpCount = 0;

  const gx = g.restXWorld;
  const gy = g.restYWorld + g.offsetYWorld;

  for (let ri = 0; ri < g.colliderRectCount; ri++) {
    const rectLeft   = gx + g.colliderRelXWorld[ri];
    const rectRight  = rectLeft + g.colliderWWorld[ri];
    const rectTop    = gy + g.colliderRelYWorld[ri];
    const rectBottom = rectTop + g.colliderHWorld[ri];

    // ── Static wall array ─────────────────────────────────────────────────
    for (let wi = 0; wi < world.wallCount; wi++) {
      // Skip platform walls (one-way)
      if (world.wallIsPlatformFlag[wi] === 1) continue;
      // Skip ramp walls
      if (world.wallRampOrientationIndex[wi] !== 255) continue;
      // Skip ALL falling block wall slots — handled in the group pass below.
      if (fbWallIndexSet.has(wi)) continue;

      const wLeft  = world.wallXWorld[wi];
      const wTop   = world.wallYWorld[wi];
      const wRight = wLeft + world.wallWWorld[wi];

      // Horizontal overlap with this rect
      if (rectRight <= wLeft || rectLeft >= wRight) continue;
      // Wall must be at or below this rect's top (falling downward)
      if (wTop < rectTop) continue;
      // This rect's bottom must have reached or passed the wall top
      if (rectBottom < wTop - FB_COLLISION_EPSILON) continue;

      // snapGroupTopY: where does the group top land so this rect's bottom
      // sits exactly on wTop?
      const snapGroupTopY = wTop - g.colliderRelYWorld[ri] - g.colliderHWorld[ri];
      if (snapGroupTopY < nearestGroupTopY) {
        nearestGroupTopY = snapGroupTopY;
      }
    }

    // ── Other falling block groups in stable/landed states ────────────────
    for (const other of world.fallingBlockGroups) {
      if (other === g) continue;
      // Only allow landing on groups that are resting/idle (not falling/crumbling/removed)
      if (
        other.state !== FB_STATE_IDLE_STABLE &&
        other.state !== FB_STATE_LANDED_STABLE &&
        other.state !== FB_STATE_WARNING &&
        other.state !== FB_STATE_PRE_FALL_PAUSE
      ) continue;

      // Broad-phase against other group's bounding box
      const oLeft   = getFBGroupLeftWorld(other);
      const oRight  = getFBGroupRightWorld(other);
      const oTop    = getFBGroupTopWorld(other);

      if (rectRight <= oLeft || rectLeft >= oRight) continue;
      if (oTop < rectTop) continue;
      if (rectBottom < oTop - FB_COLLISION_EPSILON) continue;

      // Per-rect check against the other group's collider rects
      const ox = other.restXWorld;
      const oy = other.restYWorld + other.offsetYWorld;
      for (let ori = 0; ori < other.colliderRectCount; ori++) {
        const orLeft  = ox + other.colliderRelXWorld[ori];
        const orRight = orLeft + other.colliderWWorld[ori];
        const orTop   = oy + other.colliderRelYWorld[ori];

        if (rectRight <= orLeft || rectLeft >= orRight) continue;
        if (orTop < rectTop) continue;
        if (rectBottom < orTop - FB_COLLISION_EPSILON) continue;

        const snapGroupTopY = orTop - g.colliderRelYWorld[ri] - g.colliderHWorld[ri];
        if (snapGroupTopY < nearestGroupTopY) {
          nearestGroupTopY = snapGroupTopY;
        }
      }
    }
  }

  if (nearestGroupTopY === Infinity) return null;

  // ── Compute landing contact segments ──────────────────────────────────────
  // Walk through the collider rects again at the snapped position and record
  // which rects' bottom edges align with an underlying surface.
  const snappedGY = nearestGroupTopY; // = g.restYWorld + new offsetYWorld

  for (let ri = 0; ri < g.colliderRectCount; ri++) {
    const rectLeft   = gx + g.colliderRelXWorld[ri];
    const rectRight  = rectLeft + g.colliderWWorld[ri];
    const rectBottom = snappedGY + g.colliderRelYWorld[ri] + g.colliderHWorld[ri];

    // Static walls
    for (let wi = 0; wi < world.wallCount; wi++) {
      if (world.wallIsPlatformFlag[wi] === 1) continue;
      if (world.wallRampOrientationIndex[wi] !== 255) continue;
      if (fbWallIndexSet.has(wi)) continue;

      const wLeft  = world.wallXWorld[wi];
      const wTop   = world.wallYWorld[wi];
      const wRight = wLeft + world.wallWWorld[wi];

      if (Math.abs(rectBottom - wTop) > FB_COLLISION_EPSILON + LAND_OVERLAP_EPSILON) continue;
      const cx1 = Math.max(rectLeft, wLeft);
      const cx2 = Math.min(rectRight, wRight);
      if (cx2 <= cx1) continue;

      if (tmpCount < MAX_LANDING_CONTACTS) {
        _tmpContactX1[tmpCount] = cx1;
        _tmpContactX2[tmpCount] = cx2;
        _tmpContactY[tmpCount]  = wTop;
        tmpCount++;
      }
    }

    // Other stable falling block groups
    for (const other of world.fallingBlockGroups) {
      if (other === g) continue;
      if (other.state !== FB_STATE_IDLE_STABLE && other.state !== FB_STATE_LANDED_STABLE &&
          other.state !== FB_STATE_WARNING && other.state !== FB_STATE_PRE_FALL_PAUSE) continue;

      const ox = other.restXWorld;
      const oy = other.restYWorld + other.offsetYWorld;
      for (let ori = 0; ori < other.colliderRectCount; ori++) {
        const orLeft  = ox + other.colliderRelXWorld[ori];
        const orRight = orLeft + other.colliderWWorld[ori];
        const orTop   = oy + other.colliderRelYWorld[ori];

        if (Math.abs(rectBottom - orTop) > FB_COLLISION_EPSILON + LAND_OVERLAP_EPSILON) continue;
        const cx1 = Math.max(rectLeft, orLeft);
        const cx2 = Math.min(rectRight, orRight);
        if (cx2 <= cx1) continue;

        if (tmpCount < MAX_LANDING_CONTACTS) {
          _tmpContactX1[tmpCount] = cx1;
          _tmpContactX2[tmpCount] = cx2;
          _tmpContactY[tmpCount]  = orTop;
          tmpCount++;
        }
      }
    }
  }

  // Write contacts into the group (merge overlapping segments at the same Y)
  g.lastLandingContactCount = 0;
  for (let k = 0; k < tmpCount; k++) {
    let merged = false;
    for (let m = 0; m < g.lastLandingContactCount; m++) {
      if (Math.abs(g.lastLandingContactYWorld[m] - _tmpContactY[k]) < FB_COLLISION_EPSILON &&
          _tmpContactX1[k] <= g.lastLandingContactX2World[m] + FB_COLLISION_EPSILON &&
          _tmpContactX2[k] >= g.lastLandingContactX1World[m] - FB_COLLISION_EPSILON) {
        // Extend existing segment
        g.lastLandingContactX1World[m] = Math.min(g.lastLandingContactX1World[m], _tmpContactX1[k]);
        g.lastLandingContactX2World[m] = Math.max(g.lastLandingContactX2World[m], _tmpContactX2[k]);
        merged = true;
        break;
      }
    }
    if (!merged && g.lastLandingContactCount < MAX_LANDING_CONTACTS) {
      const idx = g.lastLandingContactCount++;
      g.lastLandingContactX1World[idx] = _tmpContactX1[k];
      g.lastLandingContactX2World[idx] = _tmpContactX2[k];
      g.lastLandingContactYWorld[idx]  = _tmpContactY[k];
    }
  }

  return nearestGroupTopY;
}
