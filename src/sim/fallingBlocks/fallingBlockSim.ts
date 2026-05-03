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
 *   - falling     → landedStable when downward collision detected.
 *   - falling     → crumbling for the crumbling variant after top speed reached
 *                   for CRUMBLE_DELAY_TICKS.
 *   - crumbling   → removed after CRUMBLE_DURATION_TICKS.
 *
 * All geometry is in world units.  Positive Y = downward.
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

// ── AABB overlap test ──────────────────────────────────────────────────────────

function aabbOverlap(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
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
 * Check whether the player cluster is resting on top of the falling block group.
 * Returns true if the player's bottom edge is at or within epsilon of the group's
 * top surface, and the player's AABB horizontally overlaps the group.
 */
function isPlayerRestingOnGroupTop(
  g: FallingBlockGroup,
  playerX: number, playerY: number,
  playerHW: number, playerHH: number,
): boolean {
  const groupTop    = getFBGroupTopWorld(g);
  const groupLeft   = getFBGroupLeftWorld(g);
  const groupRight  = getFBGroupRightWorld(g);
  const playerLeft  = playerX - playerHW;
  const playerRight = playerX + playerHW;
  const playerBot   = playerY + playerHH;

  // Player must overlap the group horizontally
  if (playerRight <= groupLeft || playerLeft >= groupRight) return false;

  // Player bottom must be within epsilon of the group top (above or just touching)
  return Math.abs(playerBot - groupTop) <= FB_COLLISION_EPSILON + 1.0;
}

/**
 * Check whether any part of the player AABB overlaps the group AABB
 * (any side contact or standing on top).
 */
function playerOverlapsGroup(
  g: FallingBlockGroup,
  playerX: number, playerY: number,
  playerHW: number, playerHH: number,
): boolean {
  return aabbOverlap(
    playerX - playerHW, playerY - playerHH, playerX + playerHW, playerY + playerHH,
    getFBGroupLeftWorld(g), getFBGroupTopWorld(g),
    getFBGroupRightWorld(g), getFBGroupBottomWorld(g),
  );
}

/**
 * Check whether any enemy cluster AABB overlaps the group.
 * Returns the index of the first overlapping enemy cluster, or -1.
 */
function findOverlappingEnemyIndex(g: FallingBlockGroup, world: WorldState): number {
  const gLeft   = getFBGroupLeftWorld(g);
  const gTop    = getFBGroupTopWorld(g);
  const gRight  = getFBGroupRightWorld(g);
  const gBottom = getFBGroupBottomWorld(g);

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 || c.isAliveFlag === 0) continue;
    const cLeft   = c.positionXWorld - c.halfWidthWorld;
    const cRight  = c.positionXWorld + c.halfWidthWorld;
    const cTop    = c.positionYWorld - c.halfHeightWorld;
    const cBottom = c.positionYWorld + c.halfHeightWorld;
    if (cLeft < gRight && cRight > gLeft && cTop < gBottom && cBottom > gTop) {
      return ci;
    }
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
      // Grapple downward pull
      if (world.isGrappleActiveFlag === 1) {
        const ax = world.grappleAnchorXWorld;
        const ay = world.grappleAnchorYWorld;
        // Anchor must be inside this group's AABB
        if (
          ax >= getFBGroupLeftWorld(g) && ax <= getFBGroupRightWorld(g) &&
          ay >= getFBGroupTopWorld(g)  && ay <= getFBGroupBottomWorld(g)
        ) {
          // Pull direction = from anchor toward player
          const dx = px - ax;
          const dy = py - ay;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) {
            // normalised downward component must exceed threshold
            const normY = dy / len; // positive = downward
            if (normY >= TOUGH_GRAPPLE_DOWN_DOT_THRESHOLD) {
              triggerGroup(g, FB_TRIGGER_GRAPPLE_DOWN);
              return;
            }
          }
        }
      }
    }

    // ── Sensitive / Crumbling: any player contact ─────────────────────────
    if (variant === 'sensitive' || variant === 'crumbling') {
      if (playerOverlapsGroup(g, px, py, phw, phh)) {
        triggerGroup(g, FB_TRIGGER_PLAYER_TOUCH);
        return;
      }
      // Any grapple contact (anchor in group AABB)
      if (world.isGrappleActiveFlag === 1) {
        const ax = world.grappleAnchorXWorld;
        const ay = world.grappleAnchorYWorld;
        if (
          ax >= getFBGroupLeftWorld(g) && ax <= getFBGroupRightWorld(g) &&
          ay >= getFBGroupTopWorld(g)  && ay <= getFBGroupBottomWorld(g)
        ) {
          triggerGroup(g, FB_TRIGGER_GRAPPLE_ANY);
          return;
        }
      }
      // Enemy contact
      if (findOverlappingEnemyIndex(g, world) >= 0) {
        triggerGroup(g, FB_TRIGGER_ENEMY_TOUCH);
        return;
      }
    }
  }
}

// ── Landing collision ─────────────────────────────────────────────────────────

/**
 * Find the lowest Y position the group bottom can reach without entering solid
 * terrain.  Returns the new group top Y (i.e. the group's yWorld after snapping)
 * or null if no solid was found below.
 *
 * Checks both the static wall array and other stable/warning falling block groups.
 *
 * Uses a swept approach: finds the first solid surface below the group bottom
 * within the horizontal span of the group, then snaps the group to rest just
 * above it.
 */
function findLandingSurface(
  g: FallingBlockGroup,
  world: WorldState,
): number | null {
  const groupLeft   = getFBGroupLeftWorld(g);
  const groupRight  = getFBGroupRightWorld(g);
  const groupBottom = getFBGroupBottomWorld(g);
  const groupTop    = getFBGroupTopWorld(g);

  let nearestSurfaceTop = Infinity;

  // ── Static wall array ────────────────────────────────────────────────────
  for (let wi = 0; wi < world.wallCount; wi++) {
    // Skip: platform walls (one-way)
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    // Skip: ramp walls (don't land on ramps for simplicity)
    if (world.wallRampOrientationIndex[wi] !== 255) continue;
    // Skip: this group's own wall slot
    if (wi === g.wallIndex) continue;

    const wLeft   = world.wallXWorld[wi];
    const wTop    = world.wallYWorld[wi];
    const wRight  = wLeft + world.wallWWorld[wi];

    // Wall must overlap the group horizontally
    if (groupRight <= wLeft || groupLeft >= wRight) continue;

    // Wall top must be below the group top (we're falling downward)
    if (wTop < groupTop) continue;

    // Group bottom must now be at or past the wall top
    if (groupBottom >= wTop - FB_COLLISION_EPSILON) {
      if (wTop < nearestSurfaceTop) {
        nearestSurfaceTop = wTop;
      }
    }
  }

  // ── Other falling block groups in stable/landed states ───────────────────
  for (const other of world.fallingBlockGroups) {
    if (other === g) continue;
    if (
      other.state !== FB_STATE_IDLE_STABLE &&
      other.state !== FB_STATE_LANDED_STABLE &&
      other.state !== FB_STATE_WARNING &&
      other.state !== FB_STATE_PRE_FALL_PAUSE
    ) continue;

    const oLeft   = getFBGroupLeftWorld(other);
    const oTop    = getFBGroupTopWorld(other);
    const oRight  = getFBGroupRightWorld(other);

    if (groupRight <= oLeft || groupLeft >= oRight) continue;
    if (oTop < groupTop) continue;
    if (groupBottom >= oTop - FB_COLLISION_EPSILON) {
      if (oTop < nearestSurfaceTop) {
        nearestSurfaceTop = oTop;
      }
    }
  }

  if (nearestSurfaceTop === Infinity) return null;
  return nearestSurfaceTop - g.hWorld;
}

// ── Entity crush detection ────────────────────────────────────────────────────

/**
 * Check whether any entity (player or enemy) was caught under the landing group
 * and apply lethal damage.
 *
 * This is called once when the group transitions to landedStable.
 */
function checkCrush(g: FallingBlockGroup, world: WorldState): void {
  const gLeft   = getFBGroupLeftWorld(g);
  const gTop    = getFBGroupTopWorld(g);
  const gRight  = getFBGroupRightWorld(g);
  const gBottom = getFBGroupBottomWorld(g);
  const gCenterX = (gLeft + gRight) * 0.5;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;

    const cLeft   = c.positionXWorld - c.halfWidthWorld;
    const cRight  = c.positionXWorld + c.halfWidthWorld;
    const cTop    = c.positionYWorld - c.halfHeightWorld;
    const cBottom = c.positionYWorld + c.halfHeightWorld;

    // Overlap check
    if (cLeft >= gRight || cRight <= gLeft || cTop >= gBottom || cBottom <= gTop) continue;

    if (c.isPlayerFlag === 1) {
      // Apply lethal crush damage to the player
      // TODO: replace CRUSH_DAMAGE with a proper "instakill" API if one is added
      applyPlayerDamageWithKnockback(c, CRUSH_DAMAGE, gCenterX, gTop);
    } else {
      // Kill enemy directly (no crush damage API for enemies yet)
      // TODO: replace with formal enemy instakill API when available
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

          const snapY = findLandingSurface(g, world);
          if (snapY !== null && snapY <= g.restYWorld + g.offsetYWorld + LAND_OVERLAP_EPSILON) {
            // Snap the group to the contact surface
            g.offsetYWorld = snapY - g.restYWorld;
            landed = true;
            break;
          }
        }

        if (landed) {
          if (g.variant === 'crumbling') {
            // Crumbling variant: enter crumbling state instead of stable
            g.state = FB_STATE_CRUMBLING;
            g.stateTimerTicks = 0;
            g.crumbleTimerTicks = CRUMBLE_DELAY_TICKS + CRUMBLE_DURATION_TICKS;
          } else {
            g.state = FB_STATE_LANDED_STABLE;
            g.stateTimerTicks = 0;
          }
          g.velocityYWorld = 0;
          updateWallSlot(g, world);
          checkCrush(g, world);
          triggerGroupsBelow(g, world);
        } else {
          // Check if the crumbling variant has reached top speed
          if (
            g.variant === 'crumbling' &&
            g.hasReachedTopSpeedFlag === 0 &&
            g.velocityYWorld >= FALL_TERMINAL_SPEED_WORLD_PER_SEC - 0.5
          ) {
            g.hasReachedTopSpeedFlag = 1;
            g.crumbleTimerTicks = CRUMBLE_DELAY_TICKS + CRUMBLE_DURATION_TICKS;
          }

          // Crumbling variant: once the crumble timer starts, countdown even while falling
          if (g.variant === 'crumbling' && g.hasReachedTopSpeedFlag === 1) {
            g.crumbleTimerTicks -= 1;
            if (g.crumbleTimerTicks <= 0) {
              g.state = FB_STATE_REMOVED;
              g.velocityYWorld = 0;
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
        }
        break;
      }

      // ── removed ────────────────────────────────────────────────────────────
      case FB_STATE_REMOVED: {
        // Already fully removed — just keep the wall slot cleared
        break;
      }
    }

    // Sync wall slot position every tick (covers both moving and static states)
    updateWallSlot(g, world);
  }
}
