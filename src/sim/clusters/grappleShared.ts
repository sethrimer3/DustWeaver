/**
 * Shared grapple constants and deterministic wall raycast helpers.
 *
 * Exports the shared low-level helpers used by grapple.ts and other sim code:
 *   • raycastWalls / RayHit     — AABB slab-intersection raycast against world walls
 *   • isSpecialZipGrapple       — detects top-surface grapple (zip + stick) targets
 *   • GRAPPLE_MAX_LENGTH_WORLD  — max rope length (= influence radius)
 *   • GRAPPLE_SEGMENT_COUNT     — number of chain particles
 *   • GRAPPLE_ATTACH_FX_TICKS   — sparkle effect duration on attach
 *   • BEHAVIOR_MODE_GRAPPLE_CHAIN — particle behaviorMode sentinel value
 *   • GRAPPLE_CHAIN_LIFETIME_TICKS — near-infinite lifetime assigned to chain particles
 */

import { WorldState } from '../world';
import { forEachWallSolidRect } from '../stairsWorldGeometry';
import { INFLUENCE_RADIUS_WORLD } from './binding';
import { COYOTE_TIME_TICKS } from './movementConstants';

// ============================================================================
// Shared constants (re-used by grapple.ts)
// ============================================================================

/** Maximum rope length — matches the player's zone-of-influence radius. */
export const GRAPPLE_MAX_LENGTH_WORLD = INFLUENCE_RADIUS_WORLD;

/** Number of Gold particles that form the visible chain between player and anchor. */
export const GRAPPLE_SEGMENT_COUNT = 10;

/**
 * Number of release-pool groups kept alive simultaneously. Each group holds
 * GRAPPLE_SEGMENT_COUNT released motes from one grapple release; a 4th
 * overlapping release evicts the oldest group (deterministic round-robin).
 */
export const GRAPPLE_RELEASE_POOL_GROUPS = 3;

/** Total dedicated pool capacity for released grapple motes. */
export const GRAPPLE_RELEASE_POOL_CAPACITY = GRAPPLE_SEGMENT_COUNT * GRAPPLE_RELEASE_POOL_GROUPS;

/** Duration of the sparkle burst effect on attach (ticks). */
export const GRAPPLE_ATTACH_FX_TICKS = 14;

/**
 * Behavior mode value used for grapple chain particles.
 * Binding forces (binding.ts) skip particles with behaviorMode !== 0, so this
 * prevents chain slots from being pulled toward their owner anchor.
 */
export const BEHAVIOR_MODE_GRAPPLE_CHAIN = 3;

/**
 * Lifetime (ticks) assigned to grapple chain particles — effectively infinite.
 * Lifetime is managed by the grapple system; this prevents the particle loop
 * from expiring chain particles independently.
 */
export const GRAPPLE_CHAIN_LIFETIME_TICKS = 9999999.0;

/** Released chain motes fade independently over 0.2-0.4 seconds at 60 Hz. */
const GRAPPLE_RELEASE_FADE_MIN_TICKS = 12.0;
const GRAPPLE_RELEASE_FADE_TICK_RANGE = 12.0;
const GRAPPLE_RELEASE_SPEED_MIN_WORLD_PER_SEC = 42.0;
const GRAPPLE_RELEASE_SPEED_RANGE_WORLD_PER_SEC = 24.0;
const GRAPPLE_RELEASE_SPREAD_RAD = 20.0 * Math.PI / 180.0;
const GRAPPLE_JUMP_RELEASE_MAX_DOWN_BIAS = 0.9;
const GRAPPLE_JUMP_RELEASE_MAX_SPEED_BOOST = 0.9;

/** Stable [0, 1) noise so grapple release visuals remain deterministic. */
function grappleReleaseNoise(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

// ============================================================================
// Raycast helpers (shared with grapple.ts)
// ============================================================================

export interface RayHit {
  t: number;
  x: number;
  y: number;
  /** Index into world.wallXWorld/Y/W/H of the wall that was hit. */
  wallIndex: number;
  /**
   * Outward surface normal at the hit point — points away from the wall
   * toward the ray origin (unit axis vector: one of ±(1,0) or ±(0,1)).
   *
   * Used to offset the grapple anchor slightly outside the wall surface so
   * the anchor is never epsilon-inside solid geometry.  This is the
   * canonical surface contact direction for validation purposes.
   *
   * Convention: normalX = –sign(dx) when X-face was hit; normalY = –sign(dy)
   * when Y-face was hit; the other component is 0.
   */
  normalX: number;
  normalY: number;
}

/**
 * Small epsilon (world units) used when placing the grapple anchor just
 * outside a wall surface.  Prevents the anchor from sitting exactly on the
 * boundary where floating-point math might classify it as "inside" solid.
 *
 * Value chosen to be large enough to avoid float noise (tile coordinates
 * are exact multiples of 8 wu, so 0.1 wu is well within the safe margin)
 * yet small enough that the anchor appears visually attached to the surface.
 *
 * NOTE: The miss-chain path uses GRAPPLE_TIP_SKIN_WORLD (0.5 wu) which
 * already subsumes this epsilon; the direct-fire path needs this separately.
 */
export const GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD = 0.1;

/**
 * Ray–AABB slab intersection against all world walls.
 * Returns the closest hit along ray (ox,oy) + t*(dx,dy) within [0,maxDist],
 * or null if the ray misses all walls.
 *
 * COLLISION AUTHORITY NOTE:
 *   Merged wall rectangles (world.wallXWorld/Y/W/H) are a broad-phase
 *   optimisation that eliminates internal seam edges between same-theme
 *   adjacent tiles.  For exact collision queries (grapple raycast, anchor
 *   placement, LOS checks) these merged rectangles ARE the authoritative
 *   source of solid geometry — individual tile boundaries are not stored at
 *   runtime.  Seam-free merging at load time (gameRoom.ts loadRoomWalls)
 *   ensures adjacent same-theme blocks present a single face to raycasts
 *   instead of a crack at every tile boundary.
 *
 *   Platform walls (isPlatformFlag === 1) are NOT excluded from the raycast;
 *   callers that should skip platforms must filter on hit.wallIndex.
 */
export function raycastWalls(
  world: WorldState,
  ox: number, oy: number,
  dx: number, dy: number,
  maxDist: number,
): RayHit | null {
  let bestT = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestY = 0;
  let bestWi = -1;
  // 0 = hit X-face (left/right), 1 = hit Y-face (top/bottom).
  // Tracks which axis' slab entry was the tightest constraint, which
  // determines the outward normal direction at the hit point.
  let bestHitAxis = 1;

  for (let wi = 0; wi < world.wallCount; wi++) {
    // Stair walls resolve into their step rectangles, so the ray can enter the
    // stair's empty upper region and strike an exposed tread or riser face
    // rather than the bounding box's outer edge.
    forEachWallSolidRect(world, wi, (minX, minY, maxX, maxY) => {
      let tMin = 0;
      let tMax = maxDist;
      // hitAxis for this rect: updated as each axis tightens tMin.
      let hitAxis = 1;

      if (Math.abs(dx) < 1e-6) {
        if (ox < minX || ox > maxX) return;
      } else {
        const tx1 = (minX - ox) / dx;
        const tx2 = (maxX - ox) / dx;
        const txMin = tx1 < tx2 ? tx1 : tx2;
        const txMax = tx1 > tx2 ? tx1 : tx2;
        if (txMin > tMin) { tMin = txMin; hitAxis = 0; }
        tMax = txMax < tMax ? txMax : tMax;
        if (tMin > tMax) return;
      }

      if (Math.abs(dy) < 1e-6) {
        if (oy < minY || oy > maxY) return;
      } else {
        const ty1 = (minY - oy) / dy;
        const ty2 = (maxY - oy) / dy;
        const tyMin = ty1 < ty2 ? ty1 : ty2;
        const tyMax = ty1 > ty2 ? ty1 : ty2;
        if (tyMin > tMin) { tMin = tyMin; hitAxis = 1; }
        tMax = tyMax < tMax ? tyMax : tMax;
        if (tMin > tMax) return;
      }

      if (tMin >= 0 && tMin <= maxDist && tMin < bestT) {
        bestT = tMin;
        bestX = ox + dx * tMin;
        bestY = oy + dy * tMin;
        bestWi = wi;
        bestHitAxis = hitAxis;
      }
    });
  }

  if (!Number.isFinite(bestT)) return null;

  // Outward surface normal: points away from the wall toward the ray origin.
  // For an X-face hit the normal is –sign(dx) on the X axis (0 on Y).
  // For a Y-face hit the normal is –sign(dy) on the Y axis (0 on X).
  const normalX = bestHitAxis === 0 ? (dx > 0 ? -1 : 1) : 0;
  const normalY = bestHitAxis === 1 ? (dy > 0 ? -1 : 1) : 0;

  return { t: bestT, x: bestX, y: bestY, wallIndex: bestWi, normalX, normalY };
}

// ============================================================================
// Special zip grapple detection (shared with grapple.ts)
// ============================================================================

/**
 * Minimum vertical drop from player feet to anchor required to trigger the
 * grapple zip/stick behavior (top-surface mode).
 */
const GRAPPLE_SPECIAL_ZIP_MIN_DROP_WORLD = 16.0;

/**
 * Returns true when the grapple should use the special zip/stick behavior.
 *
 * Requirements:
 *   1) Anchor must be at least GRAPPLE_SPECIAL_ZIP_MIN_DROP_WORLD below feet.
 *   2) Straight path from player center to anchor has no obstruction before
 *      the anchor point.
 */
export function isSpecialZipGrapple(
  world: WorldState,
  player: { positionXWorld: number; positionYWorld: number; halfHeightWorld: number },
  anchorXWorld: number,
  anchorYWorld: number,
): boolean {
  const playerFeetYWorld = player.positionYWorld + player.halfHeightWorld;
  if (anchorYWorld < playerFeetYWorld + GRAPPLE_SPECIAL_ZIP_MIN_DROP_WORLD) {
    return false;
  }

  const dxWorld = anchorXWorld - player.positionXWorld;
  const dyWorld = anchorYWorld - player.positionYWorld;
  const distanceWorld = Math.sqrt(dxWorld * dxWorld + dyWorld * dyWorld);
  if (distanceWorld <= 0.0001) return false;

  const inverseDistance = 1.0 / distanceWorld;
  const dirXWorld = dxWorld * inverseDistance;
  const dirYWorld = dyWorld * inverseDistance;
  const firstHit = raycastWalls(
    world,
    player.positionXWorld,
    player.positionYWorld,
    dirXWorld,
    dirYWorld,
    distanceWorld + 0.5,
  );
  if (firstHit === null) return true;

  const firstHitDistanceWorld = Math.sqrt(
    (firstHit.x - player.positionXWorld) ** 2 +
    (firstHit.y - player.positionYWorld) ** 2,
  );
  return firstHitDistanceWorld >= distanceWorld - 0.5;
}

// ============================================================================

/** Minimum rope length to prevent degenerate zero-length rope attachment (world units). */
export const GRAPPLE_MIN_LENGTH_WORLD = 20;

// ============================================================================
// Release helpers (used by grapple.ts, grappleZip.ts, and gameCommandProcessor)
// ============================================================================

/** Resets all legacy "miss" (fail-beam retract) state fields. */
export function clearLegacyGrappleMissState(world: WorldState): void {
  world.isGrappleMissActiveFlag = 0;
  world.isGrappleRetractingFlag = 0;
  world.grappleMissDirXWorld = 0.0;
  world.grappleMissDirYWorld = 0.0;
  world.grappleMissTickCount = 0;
}

/**
 * Releases the grapple and deactivates the chain particles.
 * The player retains their current velocity (built-up swing momentum).
 *
 * Grants the player coyote-time frames so they can still jump immediately
 * after releasing the grapple (e.g. letting go of the mouse button mid-swing).
 *
 * @param grantCoyoteTime  When true (default), sets the player's coyoteTimeTicks so
 *   a jump pressed in the next few frames still counts.  Pass false when the
 *   release is itself a jump (jump-off and stuck-jump paths) because those paths
 *   already apply an upward velocity impulse directly.
 * @param isJumpOff  Adds a downward, player-proximity-weighted burst to the
 *   released chain motes. Only true for player-initiated grapple jumps.
 */
export function releaseGrapple(world: WorldState, grantCoyoteTime = true, isJumpOff = false): void {
  const shouldRetractFromActiveGrapple = world.isGrappleActiveFlag === 1;

  // Let the visible chain break into free-flying motes instead of vanishing.
  // Each mote continues away from the player's release position toward the
  // grapple anchor, with a small deterministic spread and individual fade.
  //
  // Released motes are written into a dedicated release-pool group rather
  // than reusing the active chain slots directly: the active chain slots
  // (world.grappleParticleStartIndex..+GRAPPLE_SEGMENT_COUNT) are immediately
  // reinitialised by the next fireGrapple() call, so writing the release
  // burst there would erase it the instant the player re-grapples. The
  // dedicated pool has GRAPPLE_RELEASE_POOL_GROUPS groups of
  // GRAPPLE_SEGMENT_COUNT slots and round-robins across them, so up to
  // GRAPPLE_RELEASE_POOL_GROUPS overlapping release bursts persist
  // simultaneously and only the next one evicts the oldest group.
  if (shouldRetractFromActiveGrapple && world.grappleParticleStartIndex >= 0) {
    const chainStart = world.grappleParticleStartIndex;
    const player = world.clusters[0];
    let farthestParticleDistance = 0.0;
    if (isJumpOff && player !== undefined) {
      for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
        const idx = chainStart + i;
        const playerDx = world.positionXWorld[idx] - player.positionXWorld;
        const playerDy = world.positionYWorld[idx] - player.positionYWorld;
        farthestParticleDistance = Math.max(
          farthestParticleDistance,
          Math.sqrt(playerDx * playerDx + playerDy * playerDy),
        );
      }
    }

    const releasePoolStart = world.grappleReleaseStartIndex;
    const hasReleasePool = releasePoolStart >= 0;
    const groupIndex = world.grappleReleaseBurstCounter % GRAPPLE_RELEASE_POOL_GROUPS;
    const groupStart = releasePoolStart + groupIndex * GRAPPLE_SEGMENT_COUNT;

    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      const chainIdx = chainStart + i;
      const dx = world.grappleAnchorXWorld - world.positionXWorld[chainIdx];
      const dy = world.grappleAnchorYWorld - world.positionYWorld[chainIdx];
      const distance = Math.sqrt(dx * dx + dy * dy);
      const baseAngle = distance > 1e-6 ? Math.atan2(dy, dx) : 0.0;
      const seed = (world.noiseTickSeed[chainIdx] ^ world.tick ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
      const angle = baseAngle + (grappleReleaseNoise(seed) * 2.0 - 1.0) * GRAPPLE_RELEASE_SPREAD_RAD;
      let dirX = Math.cos(angle);
      let dirY = Math.sin(angle);
      let speed = GRAPPLE_RELEASE_SPEED_MIN_WORLD_PER_SEC
        + grappleReleaseNoise(seed ^ 0xa511e9b3) * GRAPPLE_RELEASE_SPEED_RANGE_WORLD_PER_SEC;

      if (isJumpOff && player !== undefined && farthestParticleDistance > 1e-6) {
        const playerDx = world.positionXWorld[chainIdx] - player.positionXWorld;
        const playerDy = world.positionYWorld[chainIdx] - player.positionYWorld;
        const playerDistance = Math.sqrt(playerDx * playerDx + playerDy * playerDy);
        const proximity = 1.0 - Math.min(1.0, playerDistance / farthestParticleDistance);
        const downBias = proximity * GRAPPLE_JUMP_RELEASE_MAX_DOWN_BIAS;
        dirX *= 1.0 - downBias;
        dirY = dirY * (1.0 - downBias) + downBias;
        const biasedLength = Math.sqrt(dirX * dirX + dirY * dirY);
        if (biasedLength > 1e-6) {
          dirX /= biasedLength;
          dirY /= biasedLength;
        }
        speed *= 1.0 + proximity * GRAPPLE_JUMP_RELEASE_MAX_SPEED_BOOST;
      }

      // The active chain slot's job is done — kill it so the old chain
      // never renders alongside the released burst.
      world.isAliveFlag[chainIdx] = 0;
      world.velocityXWorld[chainIdx] = 0.0;
      world.velocityYWorld[chainIdx] = 0.0;

      if (!hasReleasePool) continue;
      const releaseIdx = groupStart + i;
      world.positionXWorld[releaseIdx] = world.positionXWorld[chainIdx];
      world.positionYWorld[releaseIdx] = world.positionYWorld[chainIdx];
      world.velocityXWorld[releaseIdx] = dirX * speed;
      world.velocityYWorld[releaseIdx] = dirY * speed;
      world.forceX[releaseIdx] = 0.0;
      world.forceY[releaseIdx] = 0.0;
      world.ageTicks[releaseIdx] = 0.0;
      world.lifetimeTicks[releaseIdx] = GRAPPLE_RELEASE_FADE_MIN_TICKS
        + grappleReleaseNoise(seed ^ 0x63d83595) * GRAPPLE_RELEASE_FADE_TICK_RANGE;
      world.behaviorMode[releaseIdx] = 0;
      world.ownerEntityId[releaseIdx] = -1;
      world.kindBuffer[releaseIdx] = world.kindBuffer[chainIdx];
      world.isTransientFlag[releaseIdx] = 1;
      world.isAliveFlag[releaseIdx] = 1;
    }

    if (hasReleasePool) {
      world.grappleReleaseBurstCounter = world.grappleReleaseBurstCounter + 1;
    }
  }

  // Grant coyote time so the player can jump in the first few frames after
  // releasing the grapple without pressing jump at the exact release moment.
  if (grantCoyoteTime && shouldRetractFromActiveGrapple) {
    const player = world.clusters[0];
    if (player !== undefined && player.isPlayerFlag === 1 && player.isAliveFlag === 1) {
      player.coyoteTimeTicks = COYOTE_TIME_TICKS;
    }
  }

  world.isGrappleActiveFlag = 0;
  world.isGrappleZipActiveFlag = 0;
  world.isGrappleZipTriggeredFlag = 0; // cancel any pending zip request
  world.isGrappleQuietReleaseRequestedFlag = 0; // consumed (or moot) — never leak into the next session
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.isZipJumpWindowOpenFlag = 0;
  world.grappleZipStickXWorld = 0.0;
  world.grappleZipStickYWorld = 0.0;
  world.hasZipImpactFxFiredFlag = 0;
  world.hasZipImpactedSurfaceFlag = 0;
  world.grappleJumpHeldTickCount = 0;
  world.grappleRetractHeldTicks = 0;
  world.grapplePullInAmountWorld = 0.0;
  world.grappleOutOfRangeTicks = 0;
  world.grappleTensionFactor = 0;
  world.grappleRopeIndex = -1; // detach from rope segment (if any)
  world.grappleCarryBlockIndex = -1;
  world.grappleWrapPointCount = 0;  // clear wrap corners
  // Clear surface-anchor state (no longer attached to any surface).
  world.grappleAnchorNormalXWorld = 0.0;
  world.grappleAnchorNormalYWorld = 0.0;
  clearLegacyGrappleMissState(world);
  // Keep debug fields so the overlay can still show the last sweep until the
  // next grapple fire; isGrappleDebugActiveFlag persists for the current frame.
}

/**
 * Restores the player's grapple charge, triggering the golden recharge-ring
 * effect only on a depleted→charged transition.
 */
export function rechargeGrappleCharge(world: WorldState): void {
  if (world.canUsePlayerGrappleFlag === 0) {
    world.hasGrappleChargeFlag = 0;
    world.prevHasGrappleChargeFlag = 0;
    return;
  }
  const wasChargeDepleted =
    world.prevHasGrappleChargeFlag === 0 && world.hasGrappleChargeFlag === 0;
  world.hasGrappleChargeFlag = 1;
  if (wasChargeDepleted) {
    world.grappleRechargeRingTicksLeft = world.grappleRechargeRingTotalTicks;
  }
  world.prevHasGrappleChargeFlag = world.hasGrappleChargeFlag;
}

// ============================================================================
// Effective grapple range and smoothed influence radius
// ============================================================================

const GRAPPLE_RANGE_VISUAL_LERP_FACTOR = 0.08;

/**
 * Returns the grapple's configured range. This is intentionally independent of
 * player health/mote count/damage state — the legacy mechanic that shrank
 * grapple range as the player took damage or lost motes has been removed.
 * Legitimate range configuration (upgrades, editor settings, room modifiers)
 * should adjust `GRAPPLE_MAX_LENGTH_WORLD` or wrap this function, not couple
 * to damage state.
 */
export function getEffectiveGrappleRangeWorld(_world: WorldState): number {
  return GRAPPLE_MAX_LENGTH_WORLD;
}

/** Alias for circle of influence radius. */
export function getCircleOfInfluenceRadiusWorld(world: WorldState): number {
  return getEffectiveGrappleRangeWorld(world);
}

/**
 * Snaps `grappleDisplayRadiusWorld` directly to the current effective grapple range.
 * Must be called during world creation, room loads, respawns, and player reconstruction
 * so it never lerps from zero or retains a stale room value.
 */
export function resetGrappleDisplayRadius(world: WorldState): void {
  world.grappleDisplayRadiusWorld = getEffectiveGrappleRangeWorld(world);
}

/**
 * Smoothly lerps `grappleDisplayRadiusWorld` toward effective range each tick.
 */
export function tickGrappleDisplayRadius(world: WorldState): void {
  const targetRadiusWorld = getEffectiveGrappleRangeWorld(world);
  world.grappleDisplayRadiusWorld +=
    (targetRadiusWorld - world.grappleDisplayRadiusWorld) * GRAPPLE_RANGE_VISUAL_LERP_FACTOR;
}
