/**
 * Golden Beetle AI — surface-crawling enemy that can traverse floors, walls,
 * and ceilings.  Damages the player on contact and flies when agitated.
 *
 * State machine:
 *   0 = crawl_toward  (50%)  — crawl toward player along current surface
 *   1 = crawl_away    (25%)  — crawl away from player along current surface
 *   2 = idle          (25%)  — sit still on surface
 *   3 = fly_away            — fly away from player (triggered by damage)
 *   4 = fly_toward          — fly toward player (50% chance after idle)
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

// ── Beetle tuning constants ────────────────────────────────────────────────

/** Half-size (world units) of the beetle's AABB. */
export const BEETLE_HALF_SIZE_WORLD = 3;

/** Crawl speed along a surface (world units/s). */
const BEETLE_CRAWL_SPEED_WORLD = 55;

/** Flight speed (world units/s). */
const BEETLE_FLY_SPEED_WORLD = 100;

/** Adhesion acceleration toward the surface when crawling (world units/s²). */
const BEETLE_ADHESION_ACCEL_WORLD = 600;

/** Max distance (world units) to detect a wall surface to stick to. */
const BEETLE_SURFACE_DETECT_RANGE_WORLD = 6;

/** Snap distance threshold — beetle snaps flush to surface when within this range. */
const BEETLE_SNAP_DIST_WORLD = 0.5;

/** Distance from player that triggers contact damage (world units, AABB overlap). */
const BEETLE_CONTACT_DAMAGE_POINTS = 1;

/** Ticks of invulnerability on the beetle side after dealing contact damage. */
const BEETLE_CONTACT_COOLDOWN_TICKS = 90;

/** Min/max ticks for crawl states (0, 1). */
const BEETLE_CRAWL_DURATION_MIN_TICKS  = 90;
const BEETLE_CRAWL_DURATION_RANGE_TICKS = 120;

/** Min/max ticks for idle state (2). */
const BEETLE_IDLE_DURATION_MIN_TICKS  = 60;
const BEETLE_IDLE_DURATION_RANGE_TICKS = 60;

/** Min/max ticks for flight states (3, 4). */
const BEETLE_FLY_DURATION_MIN_TICKS  = 90;
const BEETLE_FLY_DURATION_RANGE_TICKS = 90;

/** Flight drag coefficient (fraction of velocity kept per second). */
const BEETLE_FLY_DRAG = 0.85;

/** How close to a surface the beetle must be to land from flight (world units). */
const BEETLE_LANDING_RANGE_WORLD = 4;

// ── State identifiers ──────────────────────────────────────────────────────
const STATE_CRAWL_TOWARD = 0;
const STATE_CRAWL_AWAY   = 1;
const STATE_IDLE         = 2;
const STATE_FLY_AWAY     = 3;
const STATE_FLY_TOWARD   = 4;

// ── Internal contact-damage cooldown (per-beetle, stored via ClusterState) ─
// We re-use beetleAiStateTicks to avoid adding another field; instead, a
// separate counter lives in a module-level WeakMap keyed by cluster reference.
// This is only a few bytes per beetle and avoids polluting ClusterState.
const _contactCooldownMap = new WeakMap<object, number>();

function getContactCooldown(cluster: object): number {
  return _contactCooldownMap.get(cluster) ?? 0;
}

function setContactCooldown(cluster: object, ticks: number): void {
  _contactCooldownMap.set(cluster, ticks);
}

// ── Surface detection ───────────────────────────────────────────────────────

/**
 * Returns the best surface for the beetle to stick to.
 * Scans all solid (non-platform) walls for the nearest face within detection range.
 *
 * @returns { normalX, normalY, penetrationWorld } where penetration > 0 means
 *          the beetle is inside the wall, and penetration < 0 means it's outside
 *          (gap to surface).  Returns null if no surface found.
 */
function findNearestSurface(
  beetleX: number,
  beetleY: number,
  hw: number,
  hh: number,
  world: WorldState,
): { normalX: number; normalY: number; penetrationWorld: number } | null {
  let bestNX = 0;
  let bestNY = 0;
  let bestDist = BEETLE_SURFACE_DETECT_RANGE_WORLD + 1; // outside range = not found
  let found = false;

  const detectRange = BEETLE_SURFACE_DETECT_RANGE_WORLD;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue; // skip ramps

    const wx  = world.wallXWorld[wi];
    const wy  = world.wallYWorld[wi];
    const ww  = world.wallWWorld[wi];
    const wh  = world.wallHWorld[wi];
    const wx2 = wx + ww;
    const wy2 = wy + wh;

    const beetleLeft   = beetleX - hw;
    const beetleRight  = beetleX + hw;
    const beetleTop    = beetleY - hh;
    const beetleBottom = beetleY + hh;

    // ── Top face (beetle stands on top) ─────────────────────────────────────
    // Requires horizontal overlap between beetle and wall.
    if (beetleRight > wx && beetleLeft < wx2) {
      // dist = gap between beetle's bottom and wall's top face (positive = beetle above).
      const dist = wy - beetleBottom;
      if (dist > -hh && dist < detectRange) {
        const absDist = Math.abs(dist);
        if (absDist < bestDist) {
          bestDist = absDist;
          bestNX   = 0;
          bestNY   = -1;
          found    = true;
        }
      }
    }

    // ── Bottom face (beetle hangs from ceiling) ──────────────────────────────
    if (beetleRight > wx && beetleLeft < wx2) {
      const dist = beetleTop - wy2;
      if (dist > -hh && dist < detectRange) {
        const absDist = Math.abs(dist);
        if (absDist < bestDist) {
          bestDist = absDist;
          bestNX   = 0;
          bestNY   = 1;
          found    = true;
        }
      }
    }

    // ── Left face (beetle on the left side of a wall) ───────────────────────
    if (beetleBottom > wy && beetleTop < wy2) {
      const dist = wx - beetleRight;
      if (dist > -hw && dist < detectRange) {
        const absDist = Math.abs(dist);
        if (absDist < bestDist) {
          bestDist = absDist;
          bestNX   = -1;
          bestNY   = 0;
          found    = true;
        }
      }
    }

    // ── Right face (beetle on the right side of a wall) ─────────────────────
    if (beetleBottom > wy && beetleTop < wy2) {
      const dist = beetleLeft - wx2;
      if (dist > -hw && dist < detectRange) {
        const absDist = Math.abs(dist);
        if (absDist < bestDist) {
          bestDist = absDist;
          bestNX   = 1;
          bestNY   = 0;
          found    = true;
        }
      }
    }
  }

  if (!found) return null;

  // bestDist is the absolute gap/penetration; we need signed penetration.
  // Actually we need: how much the beetle overlaps (or is short of) the surface.
  // Recalculate as signed penetration for the found face.
  // penetration > 0: beetle is inside the wall (needs to be pushed out by that amount)
  // penetration ≤ 0: beetle is outside (gap = -penetration)
  // We recompute based on bestNX/bestNY.

  // For top face (ny=-1): surface is at wy for that wall; penetration = (beetleY+hh) - wy
  // But we don't track which wall produced the best hit, so we use bestDist with sign.
  // beetleBottom - wy = -(bestDist) when above → penetration = -bestDist (< 0 = outside)
  // For landing purposes we can sign the penetration from the normal perspective.
  // The caller only needs to know whether to snap and in which direction.
  // We return a positive "gap" meaning distance from beetle edge to surface.
  // Sign: < 0 means we're inside (clamp), > 0 means we're outside (approaching).
  // Here bestDist is the raw gap (always positive). Penetration = -bestDist when outside.
  return { normalX: bestNX, normalY: bestNY, penetrationWorld: -bestDist };
}

// ── State transition ────────────────────────────────────────────────────────

/**
 * Picks a new beetle AI state and duration based on the previous state.
 * Uses the seeded RNG (never Math.random()).
 */
function transitionBeetleState(
  cluster: { beetleAiState: number; beetleAiStateTicks: number; beetleIsFlightModeFlag: 0 | 1; beetleSurfaceNormalXWorld: number; beetleSurfaceNormalYWorld: number },
  world: WorldState,
  prevState: number,
): void {
  const rng = world.rng;
  const r = nextFloat(rng);

  let nextState: number;
  if (prevState === STATE_IDLE) {
    // After idle: 50% fly toward, 50% crawl
    if (r < 0.5) {
      nextState = STATE_FLY_TOWARD;
    } else {
      nextState = r < 0.75 ? STATE_CRAWL_TOWARD : STATE_CRAWL_AWAY;
    }
  } else if (prevState === STATE_FLY_AWAY || prevState === STATE_FLY_TOWARD) {
    // After flying: always return to a crawl/idle state
    const r2 = nextFloat(rng);
    if (r2 < 0.5) nextState = STATE_CRAWL_TOWARD;
    else if (r2 < 0.75) nextState = STATE_CRAWL_AWAY;
    else nextState = STATE_IDLE;
  } else {
    // General: 50% crawl_toward, 25% crawl_away, 25% idle
    if (r < 0.5) nextState = STATE_CRAWL_TOWARD;
    else if (r < 0.75) nextState = STATE_CRAWL_AWAY;
    else nextState = STATE_IDLE;
  }

  let durationTicks: number;
  if (nextState === STATE_IDLE) {
    durationTicks = BEETLE_IDLE_DURATION_MIN_TICKS
      + Math.floor(nextFloat(rng) * BEETLE_IDLE_DURATION_RANGE_TICKS);
  } else if (nextState === STATE_FLY_AWAY || nextState === STATE_FLY_TOWARD) {
    durationTicks = BEETLE_FLY_DURATION_MIN_TICKS
      + Math.floor(nextFloat(rng) * BEETLE_FLY_DURATION_RANGE_TICKS);
  } else {
    durationTicks = BEETLE_CRAWL_DURATION_MIN_TICKS
      + Math.floor(nextFloat(rng) * BEETLE_CRAWL_DURATION_RANGE_TICKS);
  }

  cluster.beetleAiState       = nextState;
  cluster.beetleAiStateTicks  = durationTicks;
  cluster.beetleIsFlightModeFlag =
    (nextState === STATE_FLY_AWAY || nextState === STATE_FLY_TOWARD) ? 1 : 0;
}

// ── Main AI update ───────────────────────────────────────────────────────────

export function applyBeetleAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Locate player
  let playerX = 0;
  let playerY = 0;
  let playerFound = false;
  let playerCluster: (typeof world.clusters)[0] | null = null;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      playerCluster = c;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const beetle = world.clusters[ci];
    if (beetle.isBeetleFlag !== 1 || beetle.isAliveFlag === 0) continue;

    const hw = beetle.halfWidthWorld;
    const hh = beetle.halfHeightWorld;

    // ── Tick down contact damage cooldown ────────────────────────────────────
    let contactCooldown = getContactCooldown(beetle);
    if (contactCooldown > 0) {
      contactCooldown -= 1;
      setContactCooldown(beetle, contactCooldown);
    }

    // ── Detect incoming damage (health drop since last tick) ─────────────────
    const tookDamage = beetle.healthPoints < beetle.beetlePrevHealthPoints;
    beetle.beetlePrevHealthPoints = beetle.healthPoints;

    // ── Force transition to fly_away if hit ─────────────────────────────────
    if (tookDamage && beetle.beetleIsFlightModeFlag === 0) {
      beetle.beetleAiState       = STATE_FLY_AWAY;
      beetle.beetleAiStateTicks  = BEETLE_FLY_DURATION_MIN_TICKS
        + Math.floor(nextFloat(world.rng) * BEETLE_FLY_DURATION_RANGE_TICKS);
      beetle.beetleIsFlightModeFlag = 1;
    }

    // ── Tick down state timer → trigger transition ───────────────────────────
    if (beetle.beetleAiStateTicks > 0) {
      beetle.beetleAiStateTicks -= 1;
    } else {
      transitionBeetleState(beetle, world, beetle.beetleAiState);
    }

    // ── Contact damage with player ───────────────────────────────────────────
    let dealtDamage = false;
    if (playerFound && playerCluster !== null && contactCooldown === 0) {
      const px = playerCluster.positionXWorld;
      const py = playerCluster.positionYWorld;
      const phw = playerCluster.halfWidthWorld;
      const phh = playerCluster.halfHeightWorld;
      const overlapX = (beetle.positionXWorld - px);
      const overlapY = (beetle.positionYWorld - py);
      const combinedHW = hw + phw;
      const combinedHH = hh + phh;
      if (Math.abs(overlapX) < combinedHW && Math.abs(overlapY) < combinedHH) {
        // AABBs overlap → contact damage
        applyPlayerDamageWithKnockback(
          playerCluster,
          BEETLE_CONTACT_DAMAGE_POINTS,
          beetle.positionXWorld,
          beetle.positionYWorld,
        );
        setContactCooldown(beetle, BEETLE_CONTACT_COOLDOWN_TICKS);
        dealtDamage = true;
      }
    }

    // ── Force transition to fly_away if we just dealt damage ─────────────────
    if (dealtDamage && beetle.beetleIsFlightModeFlag === 0) {
      beetle.beetleAiState      = STATE_FLY_AWAY;
      beetle.beetleAiStateTicks = BEETLE_FLY_DURATION_MIN_TICKS
        + Math.floor(nextFloat(world.rng) * BEETLE_FLY_DURATION_RANGE_TICKS);
      beetle.beetleIsFlightModeFlag = 1;
    }

    // ── Flight mode ───────────────────────────────────────────────────────────
    if (beetle.beetleIsFlightModeFlag === 1) {
      // Compute steering direction
      let steerX = 0;
      let steerY = 0;
      if (playerFound) {
        const dxToPlayer = playerX - beetle.positionXWorld;
        const dyToPlayer = playerY - beetle.positionYWorld;
        const dist = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
        if (dist > 0.1) {
          const nx = dxToPlayer / dist;
          const ny = dyToPlayer / dist;
          if (beetle.beetleAiState === STATE_FLY_AWAY) {
            steerX = -nx;
            steerY = -ny;
          } else {
            // STATE_FLY_TOWARD
            steerX = nx;
            steerY = ny;
          }
        }
      }

      // Apply steering acceleration
      const accel = BEETLE_FLY_SPEED_WORLD * 4.0;
      beetle.velocityXWorld += steerX * accel * dtSec;
      beetle.velocityYWorld += steerY * accel * dtSec;

      // Clamp to max speed
      const speed = Math.sqrt(
        beetle.velocityXWorld * beetle.velocityXWorld +
        beetle.velocityYWorld * beetle.velocityYWorld,
      );
      if (speed > BEETLE_FLY_SPEED_WORLD) {
        const inv = BEETLE_FLY_SPEED_WORLD / speed;
        beetle.velocityXWorld *= inv;
        beetle.velocityYWorld *= inv;
      }

      // Apply drag
      const dragFactor = Math.pow(BEETLE_FLY_DRAG, dtSec);
      beetle.velocityXWorld *= dragFactor;
      beetle.velocityYWorld *= dragFactor;

      // Integrate position
      beetle.positionXWorld += beetle.velocityXWorld * dtSec;
      beetle.positionYWorld += beetle.velocityYWorld * dtSec;

      // Clamp to room boundaries
      beetle.positionXWorld = Math.max(hw, Math.min(world.worldWidthWorld - hw, beetle.positionXWorld));
      beetle.positionYWorld = Math.max(hh, Math.min(world.worldHeightWorld - hh, beetle.positionYWorld));

      // Check for landing (near a surface → switch to crawl)
      const surf = findNearestSurface(
        beetle.positionXWorld, beetle.positionYWorld, hw, hh, world,
      );
      if (surf !== null && surf.penetrationWorld >= -BEETLE_LANDING_RANGE_WORLD) {
        // Land: snap to surface and transition to crawl
        beetle.beetleSurfaceNormalXWorld = surf.normalX;
        beetle.beetleSurfaceNormalYWorld = surf.normalY;
        beetle.beetleIsFlightModeFlag    = 0;
        transitionBeetleState(beetle, world, beetle.beetleAiState);
        // Cancel velocity component into the surface
        const velDotNormal = beetle.velocityXWorld * surf.normalX
          + beetle.velocityYWorld * surf.normalY;
        if (velDotNormal < 0) {
          beetle.velocityXWorld -= velDotNormal * surf.normalX;
          beetle.velocityYWorld -= velDotNormal * surf.normalY;
        }
      }

      continue; // skip crawl logic for this beetle
    }

    // ── Crawl mode ─────────────────────────────────────────────────────────
    // 1. Find nearest surface
    const surf = findNearestSurface(
      beetle.positionXWorld, beetle.positionYWorld, hw, hh, world,
    );

    if (surf !== null) {
      beetle.beetleSurfaceNormalXWorld = surf.normalX;
      beetle.beetleSurfaceNormalYWorld = surf.normalY;

      // 2. Snap to surface if within snap range
      const gap = -surf.penetrationWorld; // positive = outside
      if (gap < BEETLE_SNAP_DIST_WORLD || surf.penetrationWorld > 0) {
        // Move beetle so its AABB edge is flush with the surface
        // The beetle's edge in the -normal direction is at:
        //   posX - normalX * hw (for horizontal normals)
        //   posY - normalY * hh (for vertical normals)
        // We want that edge to be at surfacePos (distance 0 from wall face).
        // Since we only know normal, we snap using the signed distance.
        const snapAmount = surf.penetrationWorld; // > 0 = push OUT, < 0 = too far
        if (Math.abs(snapAmount) < 20) { // sanity guard
          beetle.positionXWorld += surf.normalX * snapAmount;
          beetle.positionYWorld += surf.normalY * snapAmount;
        }
      }

      // 3. Apply adhesion acceleration toward the surface
      const velDotNormal = beetle.velocityXWorld * (-surf.normalX)
        + beetle.velocityYWorld * (-surf.normalY);
      if (velDotNormal < BEETLE_ADHESION_ACCEL_WORLD * dtSec) {
        beetle.velocityXWorld += (-surf.normalX) * BEETLE_ADHESION_ACCEL_WORLD * dtSec;
        beetle.velocityYWorld += (-surf.normalY) * BEETLE_ADHESION_ACCEL_WORLD * dtSec;
      }

      // Zero out velocity into the wall
      const vDotN = beetle.velocityXWorld * surf.normalX + beetle.velocityYWorld * surf.normalY;
      if (vDotN > 0) {
        beetle.velocityXWorld -= vDotN * surf.normalX;
        beetle.velocityYWorld -= vDotN * surf.normalY;
      }

      // 4. Tangential movement along surface
      // Tangent = rotate normal 90° CCW: (−normalY, normalX)
      const tangentX = -surf.normalY;
      const tangentY =  surf.normalX;

      let moveDir = 0; // +1 = positive tangent, -1 = negative tangent
      if (beetle.beetleAiState === STATE_CRAWL_TOWARD && playerFound) {
        const dxToPlayer = playerX - beetle.positionXWorld;
        const dyToPlayer = playerY - beetle.positionYWorld;
        const proj = dxToPlayer * tangentX + dyToPlayer * tangentY;
        moveDir = proj >= 0 ? 1 : -1;
      } else if (beetle.beetleAiState === STATE_CRAWL_AWAY && playerFound) {
        const dxToPlayer = playerX - beetle.positionXWorld;
        const dyToPlayer = playerY - beetle.positionYWorld;
        const proj = dxToPlayer * tangentX + dyToPlayer * tangentY;
        moveDir = proj >= 0 ? -1 : 1;
      }
      // STATE_IDLE: moveDir stays 0

      beetle.velocityXWorld = tangentX * moveDir * BEETLE_CRAWL_SPEED_WORLD;
      beetle.velocityYWorld = tangentY * moveDir * BEETLE_CRAWL_SPEED_WORLD;

    } else {
      // No surface detected — beetle has lost its surface.
      // Apply weak gravity toward last-known surface normal direction.
      const fallAccel = 300;
      beetle.velocityXWorld += (-beetle.beetleSurfaceNormalXWorld) * fallAccel * dtSec;
      beetle.velocityYWorld += (-beetle.beetleSurfaceNormalYWorld) * fallAccel * dtSec;
    }

    // 5. Integrate position
    beetle.positionXWorld += beetle.velocityXWorld * dtSec;
    beetle.positionYWorld += beetle.velocityYWorld * dtSec;

    // Clamp to room boundaries
    beetle.positionXWorld = Math.max(hw, Math.min(world.worldWidthWorld - hw, beetle.positionXWorld));
    beetle.positionYWorld = Math.max(hh, Math.min(world.worldHeightWorld - hh, beetle.positionYWorld));
  }
}
