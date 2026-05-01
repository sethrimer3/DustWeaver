/**
 * Grapple miss & retract chain simulation.
 *
 * When the grapple fires but hits nothing (or passes through open air), this
 * module runs a verlet-style rope chain that flies outward, falls under gravity,
 * and sticks to the first surface it touches.  If the tip hits a wall, the
 * grapple attaches there; otherwise the chain retracts back to the player after
 * GRAPPLE_MISS_MAX_TICKS ticks.
 *
 * Also exports the shared low-level helpers used by grapple.ts:
 *   • raycastWalls / RayHit     — AABB slab-intersection raycast against world walls
 *   • isSpecialZipGrapple       — detects top-surface grapple (zip + stick) targets
 *   • GRAPPLE_MAX_LENGTH_WORLD  — max rope length (= influence radius)
 *   • GRAPPLE_SEGMENT_COUNT     — number of chain particles
 *   • GRAPPLE_ATTACH_FX_TICKS   — sparkle effect duration on attach
 *   • BEHAVIOR_MODE_GRAPPLE_CHAIN — particle behaviorMode sentinel value
 *   • GRAPPLE_CHAIN_LIFETIME_TICKS — near-infinite lifetime assigned to chain particles
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { INFLUENCE_RADIUS_WORLD } from './binding';

// ============================================================================
// Shared constants (re-used by grapple.ts)
// ============================================================================

/** Maximum rope length — matches the player's zone-of-influence radius. */
export const GRAPPLE_MAX_LENGTH_WORLD = INFLUENCE_RADIUS_WORLD;

/** Number of Gold particles that form the visible chain between player and anchor. */
export const GRAPPLE_SEGMENT_COUNT = 10;

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

// ============================================================================
// Raycast helpers (shared with grapple.ts)
// ============================================================================

export interface RayHit {
  t: number;
  x: number;
  y: number;
  /** Index into world.wallXWorld/Y/W/H of the wall that was hit. */
  wallIndex: number;
}

/**
 * Ray–AABB slab intersection against all world walls.
 * Returns the closest hit along ray (ox,oy) + t*(dx,dy) within [0,maxDist],
 * or null if the ray misses all walls.
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

  for (let wi = 0; wi < world.wallCount; wi++) {
    const minX = world.wallXWorld[wi];
    const minY = world.wallYWorld[wi];
    const maxX = minX + world.wallWWorld[wi];
    const maxY = minY + world.wallHWorld[wi];

    let tMin = 0;
    let tMax = maxDist;

    if (Math.abs(dx) < 1e-6) {
      if (ox < minX || ox > maxX) continue;
    } else {
      const tx1 = (minX - ox) / dx;
      const tx2 = (maxX - ox) / dx;
      const txMin = tx1 < tx2 ? tx1 : tx2;
      const txMax = tx1 > tx2 ? tx1 : tx2;
      tMin = txMin > tMin ? txMin : tMin;
      tMax = txMax < tMax ? txMax : tMax;
      if (tMin > tMax) continue;
    }

    if (Math.abs(dy) < 1e-6) {
      if (oy < minY || oy > maxY) continue;
    } else {
      const ty1 = (minY - oy) / dy;
      const ty2 = (maxY - oy) / dy;
      const tyMin = ty1 < ty2 ? ty1 : ty2;
      const tyMax = ty1 > ty2 ? ty1 : ty2;
      tMin = tyMin > tMin ? tyMin : tMin;
      tMax = tyMax < tMax ? tyMax : tMax;
      if (tMin > tMax) continue;
    }

    if (tMin >= 0 && tMin <= maxDist && tMin < bestT) {
      bestT = tMin;
      bestX = ox + dx * tMin;
      bestY = oy + dy * tMin;
      bestWi = wi;
    }
  }

  return Number.isFinite(bestT) ? { t: bestT, x: bestX, y: bestY, wallIndex: bestWi } : null;
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
// Grapple miss — limp chain physics
// ============================================================================

/**
 * Speed at which the grapple chain extends outward when fired (world units/sec).
 * High enough to cover the full influence radius (~96 world units) in ~3 frames
 * (3/60 s = 0.05 s) so the throw feels nearly instant:
 *   tip speed ≈ 2000 × 0.97 ≈ 1940 wu/s → 1940 × 0.05 ≈ 97 wu in 3 frames.
 */
const GRAPPLE_MISS_EXTEND_SPEED_WORLD_PER_SEC = 2000.0;

/**
 * Gravity applied to limp chain links after full extension (world units/sec²).
 * Heavier than normal gravity for a weighty feel.
 */
const GRAPPLE_MISS_GRAVITY_WORLD_PER_SEC2 = 500.0;

/**
 * Maximum spring force between connected chain links (world units).
 * Keeps the chain from stretching too far apart.
 * LINK_STRETCH_MULTIPLIER allows 30% stretch beyond evenly-spaced distance.
 */
const GRAPPLE_MISS_LINK_STRETCH_MULTIPLIER = 1.3;
const GRAPPLE_MISS_LINK_MAX_DIST_WORLD = GRAPPLE_MAX_LENGTH_WORLD / GRAPPLE_SEGMENT_COUNT * GRAPPLE_MISS_LINK_STRETCH_MULTIPLIER;

/**
 * Drag applied to limp chain link velocities per second.
 * Provides "heavy inertia" feel.
 */
const GRAPPLE_MISS_DRAG_PER_SEC = 0.8;

/**
 * Relaxation factor for the iterative constraint solver.
 * 0.5 = split correction equally between both connected links.
 */
const GRAPPLE_MISS_CONSTRAINT_RELAX_FACTOR = 0.5;

/** Duration in ticks after which the miss animation auto-cancels. */
const GRAPPLE_MISS_MAX_TICKS = 90;
const GRAPPLE_RETRACT_SPEED_WORLD_PER_SEC = 6000.0;

/**
 * Pre-allocated position/velocity arrays for the limp chain simulation.
 * These store independent per-link physics separate from the particle buffer
 * (we write the final positions into the particle buffer each tick).
 */
const missLinkX = new Float32Array(GRAPPLE_SEGMENT_COUNT);
const missLinkY = new Float32Array(GRAPPLE_SEGMENT_COUNT);
const missLinkVx = new Float32Array(GRAPPLE_SEGMENT_COUNT);
const missLinkVy = new Float32Array(GRAPPLE_SEGMENT_COUNT);

/** 1 if a link has attached to a surface and is now anchored. */
const missLinkStuckFlag = new Uint8Array(GRAPPLE_SEGMENT_COUNT);

export function startGrappleMiss(world: WorldState, dirX: number, dirY: number): void {
  const player = world.clusters[0];
  if (player === undefined) return;
  if (world.grappleParticleStartIndex < 0) return;
  const playerEntityId = player.entityId;
  const chainProfile = getElementProfile(ParticleKind.Gold);

  world.isGrappleMissActiveFlag = 1;
  world.isGrappleRetractingFlag = 0;
  world.grappleMissDirXWorld = dirX;
  world.grappleMissDirYWorld = dirY;
  world.grappleMissTickCount = 0;

  // Position chain links along the fire direction from the player,
  // evenly spaced, with outward velocity.
  const start = world.grappleParticleStartIndex;
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const t = (i + 1) / (GRAPPLE_SEGMENT_COUNT + 1);
    // Initial position: start near the player, spread outward
    missLinkX[i] = player.positionXWorld + dirX * t * 10;
    missLinkY[i] = player.positionYWorld + dirY * t * 10;
    // Initial velocity: throw outward, each further link is faster
    const speedScale = 0.7 + 0.3 * t;
    missLinkVx[i] = dirX * GRAPPLE_MISS_EXTEND_SPEED_WORLD_PER_SEC * speedScale;
    missLinkVy[i] = dirY * GRAPPLE_MISS_EXTEND_SPEED_WORLD_PER_SEC * speedScale;
    missLinkStuckFlag[i] = 0;

    // Activate the chain particle
    const idx = start + i;
    world.isAliveFlag[idx] = 1;
    world.ageTicks[idx] = 0.0;
    world.lifetimeTicks[idx] = GRAPPLE_CHAIN_LIFETIME_TICKS;
    world.kindBuffer[idx] = ParticleKind.Gold;
    world.ownerEntityId[idx] = playerEntityId;
    world.behaviorMode[idx] = BEHAVIOR_MODE_GRAPPLE_CHAIN;
    world.isTransientFlag[idx] = 1;
    world.particleDurability[idx] = chainProfile.toughness;
    world.respawnDelayTicks[idx] = 0;
  }
}

export function cancelGrappleMiss(world: WorldState): void {
  world.isGrappleMissActiveFlag = 0;
  world.isGrappleRetractingFlag = 0;
  world.grappleMissTickCount = 0;
  if (world.grappleParticleStartIndex >= 0) {
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      world.isAliveFlag[start + i] = 0;
    }
  }
}

export function startGrappleRetract(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || world.grappleParticleStartIndex < 0) return;
  const playerEntityId = player.entityId;

  world.isGrappleMissActiveFlag = 1;
  world.isGrappleRetractingFlag = 1;
  world.grappleMissTickCount = 0;

  const start = world.grappleParticleStartIndex;
  const chainProfile = getElementProfile(ParticleKind.Gold);
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const idx = start + i;
    missLinkX[i] = world.positionXWorld[idx];
    missLinkY[i] = world.positionYWorld[idx];
    missLinkVx[i] = 0.0;
    missLinkVy[i] = 0.0;
    missLinkStuckFlag[i] = 0;
    // Fully reinitialise fields so stale lifetime/kind data from slot reuse
    // cannot cause chain particles to die during the retract animation.
    world.isAliveFlag[idx]        = 1;
    world.ageTicks[idx]           = 0.0;
    world.lifetimeTicks[idx]      = GRAPPLE_CHAIN_LIFETIME_TICKS;
    world.kindBuffer[idx]         = ParticleKind.Gold;
    world.ownerEntityId[idx]      = playerEntityId;
    world.behaviorMode[idx]       = BEHAVIOR_MODE_GRAPPLE_CHAIN;
    world.isTransientFlag[idx]    = 1;
    world.particleDurability[idx] = chainProfile.toughness;
    world.respawnDelayTicks[idx]  = 0;
  }
}

/**
 * Step 6.75 (alt) — Update limp chain physics when the grapple missed.
 * Chain links fly outward, fall under gravity, and stick to the first
 * surface they touch. If any link hits a wall, the grapple attaches there.
 */
export function updateGrappleMissChain(world: WorldState): void {
  if (world.isGrappleMissActiveFlag === 0) return;
  if (world.grappleParticleStartIndex < 0) return;

  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    cancelGrappleMiss(world);
    return;
  }

  world.grappleMissTickCount++;
  if (world.grappleMissTickCount > GRAPPLE_MISS_MAX_TICKS) {
    cancelGrappleMiss(world);
    return;
  }

  const dtSec = world.dtMs / 1000.0;
  const dragFactor = Math.max(0.0, 1.0 - GRAPPLE_MISS_DRAG_PER_SEC * dtSec);

  if (world.isGrappleRetractingFlag === 1) {
    let hasAnyLinkFarFromPlayerFlag: 0 | 1 = 0;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      const dx = player.positionXWorld - missLinkX[i];
      const dy = player.positionYWorld - missLinkY[i];
      const distanceWorld = Math.sqrt(dx * dx + dy * dy);

      if (distanceWorld > 0.001) {
        const moveWorld = Math.min(GRAPPLE_RETRACT_SPEED_WORLD_PER_SEC * dtSec, distanceWorld);
        const invDistance = 1.0 / distanceWorld;
        missLinkX[i] += dx * invDistance * moveWorld;
        missLinkY[i] += dy * invDistance * moveWorld;
      }

      if (distanceWorld > 1.0) {
        hasAnyLinkFarFromPlayerFlag = 1;
      }
    }

    if (hasAnyLinkFarFromPlayerFlag === 0) {
      cancelGrappleMiss(world);
      return;
    }
  } else {
    // ── Integrate link physics ──────────────────────────────────────────────
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      if (missLinkStuckFlag[i] === 1) continue; // stuck links don't move

      // Apply gravity
      missLinkVy[i] += GRAPPLE_MISS_GRAVITY_WORLD_PER_SEC2 * dtSec;

      // Apply drag for heavy inertia feel
      missLinkVx[i] *= dragFactor;
      missLinkVy[i] *= dragFactor;

      // Integrate position
      missLinkX[i] += missLinkVx[i] * dtSec;
      missLinkY[i] += missLinkVy[i] * dtSec;

      // ── Check wall collision — stick on contact ──────────────────────────
      for (let wi = 0; wi < world.wallCount; wi++) {
        const wx = world.wallXWorld[wi];
        const wy = world.wallYWorld[wi];
        const ww = world.wallWWorld[wi];
        const wh = world.wallHWorld[wi];

        if (missLinkX[i] >= wx && missLinkX[i] <= wx + ww &&
          missLinkY[i] >= wy && missLinkY[i] <= wy + wh) {
          // Bounce pad walls do not catch the grapple chain — pass through.
          if (world.wallIsBouncePadFlag[wi] === 1) break;
          // This link hit a wall! Stick it here.
          missLinkStuckFlag[i] = 1;
          missLinkVx[i] = 0;
          missLinkVy[i] = 0;

          // If this is the tip (last link), attach the grapple here
          if (i === GRAPPLE_SEGMENT_COUNT - 1) {
            // Check if distance is valid for grapple attachment
            const hitDist = Math.sqrt(
              (missLinkX[i] - player.positionXWorld) ** 2 +
              (missLinkY[i] - player.positionYWorld) ** 2,
            );
            if (hitDist >= GRAPPLE_MIN_LENGTH_WORLD) {
              const missAnchorX = missLinkX[i];
              const missAnchorY = missLinkY[i];
              const missAnchorDist = Math.sqrt(
                (missAnchorX - player.positionXWorld) ** 2 +
                (missAnchorY - player.positionYWorld) ** 2,
              );

              // Attach grapple at this point (zip/stick mechanic replaced by proximity bounce)
              world.grappleAnchorXWorld = missAnchorX;
              world.grappleAnchorYWorld = missAnchorY;
              world.grappleLengthWorld = missAnchorDist;
              world.grapplePullInAmountWorld = 0.0;
              world.grappleJumpHeldTickCount = 0;
              world.playerJumpTriggeredFlag = 0;
              world.isGrappleActiveFlag = 1;
              world.isGrappleTopSurfaceFlag = 0;
              world.isGrappleStuckFlag = 0;
              world.grappleStuckStoppedTickCount = 0;
              world.isGrappleMissActiveFlag = 0;
              world.isGrappleRetractingFlag = 0;
              world.grappleMissTickCount = 0;
              world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
              world.grappleAttachFxXWorld = missAnchorX;
              world.grappleAttachFxYWorld = missAnchorY;

              // Miss-chain attachment always consumes the charge (normal rope attach).
              world.hasGrappleChargeFlag = 0;
              return;
            }
          }
          break;
        }
      }

      // ── Check world floor ────────────────────────────────────────────────
      if (missLinkY[i] >= world.worldHeightWorld) {
        missLinkY[i] = world.worldHeightWorld - 0.5;
        missLinkStuckFlag[i] = 1;
        missLinkVx[i] = 0;
        missLinkVy[i] = 0;
      }

      // ── Clamp to circle of influence ─────────────────────────────────────
      // The grapple tip (and all chain links) must never extend beyond the
      // player's influence radius.  If a link drifts outside, snap it back
      // onto the circle edge and zero its outward velocity component.
      {
        const cdx = missLinkX[i] - player.positionXWorld;
        const cdy = missLinkY[i] - player.positionYWorld;
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
        if (cdist > GRAPPLE_MAX_LENGTH_WORLD) {
          const inv = 1.0 / cdist;
          const cnx = cdx * inv;
          const cny = cdy * inv;
          missLinkX[i] = player.positionXWorld + cnx * GRAPPLE_MAX_LENGTH_WORLD;
          missLinkY[i] = player.positionYWorld + cny * GRAPPLE_MAX_LENGTH_WORLD;
          // Remove outward velocity component so the link stays on the edge
          const vDotN = missLinkVx[i] * cnx + missLinkVy[i] * cny;
          if (vDotN > 0) {
            missLinkVx[i] -= vDotN * cnx;
            missLinkVy[i] -= vDotN * cny;
          }
        }
      }
    }

    // ── Enforce link connectivity ───────────────────────────────────────────
    // Each link must stay within max distance of its neighbor.
    // Link 0 is connected to the player, link N to link N-1.
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
        // Anchor point: player position for first link, previous link for others
        const anchorX = i === 0 ? player.positionXWorld : missLinkX[i - 1];
        const anchorY = i === 0 ? player.positionYWorld : missLinkY[i - 1];

        const linkDxWorld = missLinkX[i] - anchorX;
        const linkDyWorld = missLinkY[i] - anchorY;
        const linkDist = Math.sqrt(linkDxWorld * linkDxWorld + linkDyWorld * linkDyWorld);

        if (linkDist > GRAPPLE_MISS_LINK_MAX_DIST_WORLD && linkDist > 0.01) {
          const excess = linkDist - GRAPPLE_MISS_LINK_MAX_DIST_WORLD;
          const nx = linkDxWorld / linkDist;
          const ny = linkDyWorld / linkDist;

          if (missLinkStuckFlag[i] === 0) {
            // Pull this link toward anchor
            missLinkX[i] -= nx * excess * GRAPPLE_MISS_CONSTRAINT_RELAX_FACTOR;
            missLinkY[i] -= ny * excess * GRAPPLE_MISS_CONSTRAINT_RELAX_FACTOR;
          }
          if (i > 0 && missLinkStuckFlag[i - 1] === 0) {
            // Push previous link toward this one
            missLinkX[i - 1] += nx * excess * GRAPPLE_MISS_CONSTRAINT_RELAX_FACTOR;
            missLinkY[i - 1] += ny * excess * GRAPPLE_MISS_CONSTRAINT_RELAX_FACTOR;
          }
        }
      }
    }
  }

  // ── Write positions to particle buffer ────────────────────────────────────
  // Also force isAliveFlag = 1: if a chain particle was killed mid-retract by
  // combat damage or lifetime expiry the renderer would fall back to rendering
  // the rope at grappleAnchorXWorld/Y (the original fixed anchor), making it
  // look like the grapple is still attached while the player falls.
  const start = world.grappleParticleStartIndex;
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const idx = start + i;
    world.isAliveFlag[idx]    = 1;
    world.positionXWorld[idx] = missLinkX[i];
    world.positionYWorld[idx] = missLinkY[i];
    world.velocityXWorld[idx] = 0.0;
    world.velocityYWorld[idx] = 0.0;
    world.forceX[idx] = 0.0;
    world.forceY[idx] = 0.0;
  }
}

/** Minimum rope length to prevent degenerate zero-length rope attachment (world units). */
export const GRAPPLE_MIN_LENGTH_WORLD = 20;
