/**
 * Falling Block simulation — tick logic, trigger detection, and collision.
 *
 * Called as step 0.05 in the tick pipeline (after wall setup, before other
 * hazards so falling groups' wall slots are current during hazard checks).
 *
 * Rules:
 *   - idleStable → warning when a qualifying disturbance occurs.
 *   - warning     → preFallPause after WARN_DURATION_TICKS.
 *   - preFallPause→ falling after PRE_FALL_PAUSE_TICKS.
 *   - falling     → landedStable when collision detected (only if crumbling
 *                   variant has NOT yet reached terminal speed).
 *   - falling     → crumbling for the crumbling variant if it landed AFTER
 *                   reaching terminal speed, or airborne crumble timer expires.
 *   - crumbling   → removed after CRUMBLE_DURATION_TICKS.
 *
 * All geometry is in world units.  Positive Y = downward.
 *
 * Collision shape:
 *   Each group stores per-tile collider rects in colliderRel{X,Y}World plus
 *   collider{W,H}World.  All sim-side checks (triggers, landing, crush,
 *   chain reaction, grapple) use these rects.  The bounding box (wWorld ×
 *   hWorld) is used only for broad-phase culling and the movement-system
 *   wall slot.
 *
 * Dynamic wall slots:
 *   Every falling block group owns a wall slot (wallIndex).  findLandingSurface
 *   builds a Set of ALL falling-block wall indices and skips them in the static
 *   wall scan.  Landing on another group is handled in a dedicated group pass.
 */

import type { WorldState } from '../world';
import type { FallingBlockGroup } from './fallingBlockTypes';
import {
  FB_STATE_IDLE_STABLE,
  FB_STATE_WARNING,
  FB_STATE_PRE_FALL_PAUSE,
  FB_STATE_FALLING,
  FB_STATE_LANDED_STABLE,
  FB_STATE_CRUMBLING,
  FB_STATE_REMOVED,
  WARN_DURATION_TICKS,
  PRE_FALL_PAUSE_TICKS,
  FALL_ACCEL_WORLD_PER_SEC2,
  FALL_TERMINAL_SPEED_WORLD_PER_SEC,
  TOUGH_LAND_VELOCITY_THRESHOLD_WORLD,
  TOUGH_GRAPPLE_DOWN_DOT_THRESHOLD,
  CRUMBLE_DELAY_TICKS,
  CRUMBLE_DURATION_TICKS,
  FB_COLLISION_EPSILON,
  MAX_LANDING_CONTACTS,
  SHAKE_AMPLITUDE_WORLD,
  SHAKE_PERIOD_TICKS,
  FB_TRIGGER_PLAYER_TOP_LAND,
  FB_TRIGGER_PLAYER_TOUCH,
  FB_TRIGGER_GRAPPLE_DOWN,
  FB_TRIGGER_GRAPPLE_ANY,
  FB_TRIGGER_ENEMY_TOUCH,
  FB_TRIGGER_BLOCK_LAND,
} from './fallingBlockTypes';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

/** Damage dealt to the player on crush (enough to kill at full health). */
const CRUSH_DAMAGE = 999;

/** How many wu the group's bottom can extend below a contact surface before
 *  it is considered "landed" — prevents micro-oscillation at rest. */
const LAND_OVERLAP_EPSILON = 0.1;

// ── Module-level scratch buffers ──────────────────────────────────────────────
// Pre-allocated to MAX_LANDING_CONTACTS to avoid per-frame allocations in the
// landing contact computation loop.  Only valid within a single findLandingSurface
// call (single-threaded, synchronous execution).
const _tmpContactX1 = new Float32Array(MAX_LANDING_CONTACTS);
const _tmpContactX2 = new Float32Array(MAX_LANDING_CONTACTS);
const _tmpContactY  = new Float32Array(MAX_LANDING_CONTACTS);

// Reusable Set for the set of wall indices owned by falling block groups.
// Cleared and rebuilt at the start of each tickFallingBlocks call.
const _fbWallIndexSet = new Set<number>();

/**
 * Returns the current effective Y top of the group in world space.
 */
export function getFBGroupTopWorld(g: FallingBlockGroup): number {
  return g.restYWorld + g.offsetYWorld;
}

/**
 * Returns the current effective Y bottom of the group.
 */
export function getFBGroupBottomWorld(g: FallingBlockGroup): number {
  return g.restYWorld + g.offsetYWorld + g.hWorld;
}

/** Returns the current left edge (X never changes). */
export function getFBGroupLeftWorld(g: FallingBlockGroup): number {
  return g.restXWorld;
}

/** Returns the current right edge. */
export function getFBGroupRightWorld(g: FallingBlockGroup): number {
  return g.restXWorld + g.wWorld;
}

// ── Per-tile shape contact helpers ────────────────────────────────────────────

/**
 * Returns true if the given AABB (ax1,ay1)→(ax2,ay2) contacts any of the
 * group's collider rects within `epsilon` tolerance.
 *
 * Uses a broad-phase bounding-box check first, then tests each rect.
 */
function contactsGroupShape(
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
function pointInGroupShape(
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

// ── Trigger helpers ────────────────────────────────────────────────────────────

/**
 * Trigger a group to start shaking (transition idleStable → warning).
 * Only valid when the group is currently idleStable.
 */
function triggerGroup(g: FallingBlockGroup, triggerType: number): void {
  if (g.state !== FB_STATE_IDLE_STABLE) return;
  g.state = FB_STATE_WARNING;
  g.stateTimerTicks = 0;
  g.lastTriggerType = triggerType;
}

/**
 * Check whether the player cluster is resting on top of any of the group's
 * collider rects.  Returns true if the player's bottom edge is within epsilon
 * of any rect's top surface and horizontally overlaps that rect.
 */
function isPlayerRestingOnGroupTop(
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
function playerContactsGroup(
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
function findContactingEnemyIndex(g: FallingBlockGroup, world: WorldState): number {
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

// ── Trigger detection ─────────────────────────────────────────────────────────

/**
 * Check all qualifying disturbance conditions for one idleStable group.
 * Only the FIRST matching condition fires; the function returns immediately
 * after the first trigger to avoid double-transition.
 */
function checkTriggers(g: FallingBlockGroup, world: WorldState): void {
  if (g.state !== FB_STATE_IDLE_STABLE) return;

  const variant  = g.variant;
  // Get the player cluster (always index 0 when alive)
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
  const playerAlive = player !== undefined && player.isAliveFlag === 1;

  if (playerAlive && player !== undefined) {
    const px = player.positionXWorld;
    const py = player.positionYWorld;
    const phw = player.halfWidthWorld;
    const phh = player.halfHeightWorld;

    // ── Tough variant: strong downward velocity landing on top ────────────
    if (variant === 'tough') {
      if (isPlayerRestingOnGroupTop(g, px, py, phw, phh)) {
        // world.playerPrevVelocityYWorld holds the velocity from just before
        // this tick's movement+collision resolved the landing.
        if (world.playerPrevVelocityYWorld >= TOUGH_LAND_VELOCITY_THRESHOLD_WORLD) {
          triggerGroup(g, FB_TRIGGER_PLAYER_TOP_LAND);
          return;
        }
      }

      // Grapple downward pull:
      //   • Anchor must be on or inside the group's actual tile shape.
      //   • Pull vector (anchor → player) must point within 30° of straight down.
      //   • Player must be actively retracting the rope by holding the crouch /
      //     down key (playerCrouchHeldFlag).  In DustWeaver the same key serves
      //     as both crouch-on-ground and rope-retract-while-grappling; simply
      //     hanging below the block without holding down does NOT trigger.
      if (world.isGrappleActiveFlag === 1 && world.playerCrouchHeldFlag === 1) {
        const ax = world.grappleAnchorXWorld;
        const ay = world.grappleAnchorYWorld;
        if (pointInGroupShape(g, ax, ay, FB_COLLISION_EPSILON)) {
          // Pull direction = from anchor toward player
          const dx = px - ax;
          const dy = py - ay;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) {
            const normY = dy / len; // positive = downward
            if (normY >= TOUGH_GRAPPLE_DOWN_DOT_THRESHOLD) {
              triggerGroup(g, FB_TRIGGER_GRAPPLE_DOWN);
              return;
            }
          }
        }
      }
    }

    // ── Sensitive / Crumbling: any player contact (with epsilon) ──────────
    if (variant === 'sensitive' || variant === 'crumbling') {
      if (playerContactsGroup(g, px, py, phw, phh)) {
        triggerGroup(g, FB_TRIGGER_PLAYER_TOUCH);
        return;
      }
      // Any grapple contact (anchor on group tile shape)
      if (world.isGrappleActiveFlag === 1) {
        const ax = world.grappleAnchorXWorld;
        const ay = world.grappleAnchorYWorld;
        if (pointInGroupShape(g, ax, ay, FB_COLLISION_EPSILON)) {
          triggerGroup(g, FB_TRIGGER_GRAPPLE_ANY);
          return;
        }
      }
      // Enemy contact (per-rect with epsilon)
      if (findContactingEnemyIndex(g, world) >= 0) {
        triggerGroup(g, FB_TRIGGER_ENEMY_TOUCH);
        return;
      }
    }
  }
}

// ── Landing collision ─────────────────────────────────────────────────────────

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
function findLandingSurface(
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

// ── Entity crush detection ────────────────────────────────────────────────────

/**
 * Check whether any entity (player or enemy) was caught under the landing group
 * and apply lethal damage.
 *
 * Uses per-rect collision so only entities under actual tile shapes are crushed.
 * Called once when the group transitions to landedStable or crumbling.
 */
function checkCrush(g: FallingBlockGroup, world: WorldState): void {
  const gx = g.restXWorld;
  const gy = g.restYWorld + g.offsetYWorld;
  const gCenterX = gx + g.wWorld * 0.5;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;

    const cLeft   = c.positionXWorld - c.halfWidthWorld;
    const cRight  = c.positionXWorld + c.halfWidthWorld;
    const cTop    = c.positionYWorld - c.halfHeightWorld;
    const cBottom = c.positionYWorld + c.halfHeightWorld;

    // Per-rect overlap check
    let crushed = false;
    for (let ri = 0; ri < g.colliderRectCount; ri++) {
      const rx1 = gx + g.colliderRelXWorld[ri];
      const ry1 = gy + g.colliderRelYWorld[ri];
      const rx2 = rx1 + g.colliderWWorld[ri];
      const ry2 = ry1 + g.colliderHWorld[ri];
      if (cLeft < rx2 && cRight > rx1 && cTop < ry2 && cBottom > ry1) {
        crushed = true;
        break;
      }
    }
    if (!crushed) continue;

    if (c.isPlayerFlag === 1) {
      applyPlayerDamageWithKnockback(c, CRUSH_DAMAGE, gCenterX, gy);
    } else {
      c.healthPoints = 0;
      c.isAliveFlag  = 0;
    }
  }
}

// ── Chain reaction trigger ────────────────────────────────────────────────────

/**
 * When a group lands, trigger any other idleStable groups whose top surface
 * sits exactly beneath this group's bottom surface.
 *
 * Chain reaction uses FB_TRIGGER_BLOCK_LAND so each group goes through its
 * own warning + pause cycle rather than collapsing instantly.
 */
function triggerGroupsBelow(g: FallingBlockGroup, world: WorldState): void {
  const gLeft   = getFBGroupLeftWorld(g);
  const gRight  = getFBGroupRightWorld(g);
  const gBottom = getFBGroupBottomWorld(g);

  for (const other of world.fallingBlockGroups) {
    if (other === g) continue;
    if (other.state !== FB_STATE_IDLE_STABLE) continue;

    const oLeft  = getFBGroupLeftWorld(other);
    const oRight = getFBGroupRightWorld(other);
    const oTop   = getFBGroupTopWorld(other);

    // Must overlap horizontally
    if (gRight <= oLeft || gLeft >= oRight) continue;
    // The group we landed on must be directly beneath (within epsilon)
    if (Math.abs(gBottom - oTop) <= FB_COLLISION_EPSILON + 1.0) {
      triggerGroup(other, FB_TRIGGER_BLOCK_LAND);
    }
  }
}

// ── Wall slot management ──────────────────────────────────────────────────────

/**
 * Synchronise the group's reserved wall slot in the world wall arrays to match
 * the group's current vertical position.  Called every tick while the group is
 * not removed.
 */
function updateWallSlot(g: FallingBlockGroup, world: WorldState): void {
  const wi = g.wallIndex;
  if (wi < 0 || wi >= world.wallCount) return;

  if (g.state === FB_STATE_REMOVED) {
    // Zero out the AABB so the slot contributes no collision
    world.wallWWorld[wi] = 0;
    world.wallHWorld[wi] = 0;
    return;
  }

  world.wallXWorld[wi] = getFBGroupLeftWorld(g);
  world.wallYWorld[wi] = getFBGroupTopWorld(g);
  world.wallWWorld[wi] = g.wWorld;
  world.wallHWorld[wi] = g.hWorld;
}

// ── Main tick ─────────────────────────────────────────────────────────────────

/**
 * Tick all falling block groups.
 *
 * @param world  Current world state.
 * @param dtMs   Time elapsed since last tick in milliseconds.
 */
export function tickFallingBlocks(world: WorldState, dtMs: number): void {
  if (world.fallingBlockGroups.length === 0) return;
  const dtSec = dtMs / 1000.0;

  // Rebuild the falling-block wall index set from scratch each tick.
  // Group count is small (≤ MAX_FALLING_BLOCK_GROUPS = 64); clearing + filling
  // a module-level Set is faster than allocating a new one every tick.
  _fbWallIndexSet.clear();
  for (const g of world.fallingBlockGroups) {
    if (g.wallIndex >= 0) _fbWallIndexSet.add(g.wallIndex);
  }

  for (const g of world.fallingBlockGroups) {
    switch (g.state) {

      // ── idleStable ─────────────────────────────────────────────────────────
      case FB_STATE_IDLE_STABLE: {
        g.shakeOffsetXWorld = 0;
        checkTriggers(g, world);
        break;
      }

      // ── warning ────────────────────────────────────────────────────────────
      case FB_STATE_WARNING: {
        g.stateTimerTicks += 1;
        // Pixel-perfect sinusoidal shake
        const phase = (g.stateTimerTicks / SHAKE_PERIOD_TICKS) * Math.PI * 2;
        g.shakeOffsetXWorld = Math.round(Math.sin(phase) * SHAKE_AMPLITUDE_WORLD);

        if (g.stateTimerTicks >= WARN_DURATION_TICKS) {
          g.state = FB_STATE_PRE_FALL_PAUSE;
          g.stateTimerTicks = 0;
          g.shakeOffsetXWorld = 0;
        }
        break;
      }

      // ── preFallPause ───────────────────────────────────────────────────────
      case FB_STATE_PRE_FALL_PAUSE: {
        g.stateTimerTicks += 1;
        if (g.stateTimerTicks >= PRE_FALL_PAUSE_TICKS) {
          g.state = FB_STATE_FALLING;
          g.stateTimerTicks = 0;
          g.velocityYWorld = 0;
          g.hasReachedTopSpeedFlag = 0;
          g.crumbleTimerTicks = 0;
        }
        break;
      }

      // ── falling ────────────────────────────────────────────────────────────
      case FB_STATE_FALLING: {
        g.stateTimerTicks += 1;

        // Accelerate downward toward terminal velocity
        g.velocityYWorld = Math.min(
          g.velocityYWorld + FALL_ACCEL_WORLD_PER_SEC2 * dtSec,
          FALL_TERMINAL_SPEED_WORLD_PER_SEC,
        );

        // Move the group downward (sub-stepped for safety against thin blocks)
        const maxStep = Math.max(1, g.hWorld * 0.5);
        let remainingMovement = g.velocityYWorld * dtSec;
        let landed = false;

        while (remainingMovement > 0) {
          const step = Math.min(remainingMovement, maxStep);
          g.offsetYWorld += step;
          remainingMovement -= step;

          const snapY = findLandingSurface(g, world, _fbWallIndexSet);
          if (snapY !== null && snapY <= g.restYWorld + g.offsetYWorld + LAND_OVERLAP_EPSILON) {
            // Snap the group to the contact surface
            g.offsetYWorld = snapY - g.restYWorld;
            landed = true;
            break;
          }
        }

        if (landed) {
          g.velocityYWorld = 0;
          if (g.variant === 'crumbling' && g.hasReachedTopSpeedFlag === 1) {
            // Reached terminal speed before landing — crumble countdown is already
            // running; just enter the crumbling visual state to let it finish.
            g.state = FB_STATE_CRUMBLING;
            g.stateTimerTicks = 0;
            // crumbleTimerTicks keeps its current countdown value
          } else {
            // Did not reach terminal speed before landing — become stable.
            g.state = FB_STATE_LANDED_STABLE;
            g.stateTimerTicks = 0;
          }
          updateWallSlot(g, world);
          checkCrush(g, world);
          triggerGroupsBelow(g, world);
        } else {
          // Still airborne — check if the crumbling variant just hit terminal speed
          if (
            g.variant === 'crumbling' &&
            g.hasReachedTopSpeedFlag === 0 &&
            g.velocityYWorld >= FALL_TERMINAL_SPEED_WORLD_PER_SEC - 0.5
          ) {
            g.hasReachedTopSpeedFlag = 1;
            g.crumbleTimerTicks = CRUMBLE_DELAY_TICKS + CRUMBLE_DURATION_TICKS;
          }

          // Crumbling variant: countdown once terminal speed is reached
          if (g.variant === 'crumbling' && g.hasReachedTopSpeedFlag === 1) {
            g.crumbleTimerTicks -= 1;
            if (g.crumbleTimerTicks <= 0) {
              // Disappeared mid-air — clear collision immediately
              g.state = FB_STATE_REMOVED;
              g.velocityYWorld = 0;
              updateWallSlot(g, world);
            }
          }
        }
        break;
      }

      // ── landedStable ───────────────────────────────────────────────────────
      case FB_STATE_LANDED_STABLE: {
        g.shakeOffsetXWorld = 0;
        // No further action — stable blocks remain until the room is reset
        break;
      }

      // ── crumbling ──────────────────────────────────────────────────────────
      case FB_STATE_CRUMBLING: {
        g.stateTimerTicks += 1;
        g.crumbleTimerTicks -= 1;
        if (g.crumbleTimerTicks <= 0) {
          g.state = FB_STATE_REMOVED;
          // Clear collision immediately on removal
          updateWallSlot(g, world);
        }
        break;
      }

      // ── removed ────────────────────────────────────────────────────────────
      case FB_STATE_REMOVED: {
        // Wall slot was already cleared when transitioning to removed.
        break;
      }
    }

    // Sync wall slot position every tick for all non-removed states
    if (g.state !== FB_STATE_REMOVED) {
      updateWallSlot(g, world);
    }
  }
}
