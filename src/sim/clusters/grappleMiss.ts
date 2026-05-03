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
    const minX = world.wallXWorld[wi];
    const minY = world.wallYWorld[wi];
    const maxX = minX + world.wallWWorld[wi];
    const maxY = minY + world.wallHWorld[wi];

    let tMin = 0;
    let tMax = maxDist;
    // hitAxis for this wall: updated as each axis tightens tMin.
    let hitAxis = 1;

    if (Math.abs(dx) < 1e-6) {
      if (ox < minX || ox > maxX) continue;
    } else {
      const tx1 = (minX - ox) / dx;
      const tx2 = (maxX - ox) / dx;
      const txMin = tx1 < tx2 ? tx1 : tx2;
      const txMax = tx1 > tx2 ? tx1 : tx2;
      if (txMin > tMin) { tMin = txMin; hitAxis = 0; }
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
      if (tyMin > tMin) { tMin = tyMin; hitAxis = 1; }
      tMax = tyMax < tMax ? tyMax : tMax;
      if (tMin > tMax) continue;
    }

    if (tMin >= 0 && tMin <= maxDist && tMin < bestT) {
      bestT = tMin;
      bestX = ox + dx * tMin;
      bestY = oy + dy * tMin;
      bestWi = wi;
      bestHitAxis = hitAxis;
    }
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
// Grapple miss — limp chain physics
// ============================================================================

/**
 * Speed at which the grapple chain extends outward when fired (world units/sec).
 * Set so the tip reaches the full influence radius (96 wu) in exactly 1/8 second:
 *   768 wu/s × 0.125 s = 96 wu
 * This keeps the throw responsive while limiting per-tick movement to ~12.8 wu
 * at 60 fps — small enough for the swept collision check to catch all solid walls.
 */
const GRAPPLE_MISS_EXTEND_SPEED_WORLD_PER_SEC = 768.0;

/**
 * Skin thickness (world units) used when clamping the grapple tip to a wall
 * surface during swept extension.  The tip rests just outside the tile instead
 * of exactly on (or inside) the wall face, which prevents re-triggering on the
 * very next tick.
 */
const GRAPPLE_TIP_SKIN_WORLD = 0.5;

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

      // ── Swept tip collision — cast ray from old position to new position ──
      // Anti-tunneling: at the configured extension speed (~12.8 wu/tick at
      // 60 fps) a simple point-in-box check can miss thin walls entirely if
      // the tip teleports across them.  Raycasting from the previous position
      // to the intended next position ensures the tip always stops at the first
      // solid surface it would cross.
      const prevLinkX = missLinkX[i];
      const prevLinkY = missLinkY[i];
      const moveDx = missLinkVx[i] * dtSec;
      const moveDy = missLinkVy[i] * dtSec;
      const moveDist = Math.sqrt(moveDx * moveDx + moveDy * moveDy);

      if (moveDist > 0.001) {
        const moveDirX = moveDx / moveDist;
        const moveDirY = moveDy / moveDist;
        const swept = raycastWalls(world, prevLinkX, prevLinkY, moveDirX, moveDirY, moveDist);
        if (swept !== null && world.wallIsBouncePadFlag[swept.wallIndex] !== 1) {
          // Clamp tip to just outside the wall surface (skin offset prevents
          // the contact point from resting exactly on the face and re-triggering
          // the same hit next tick).
          const clampedDist = Math.max(0.0, swept.t - GRAPPLE_TIP_SKIN_WORLD);
          missLinkX[i] = prevLinkX + moveDirX * clampedDist;
          missLinkY[i] = prevLinkY + moveDirY * clampedDist;
          missLinkStuckFlag[i] = 1;
          missLinkVx[i] = 0;
          missLinkVy[i] = 0;

          // If this is the tip (last link), attach the grapple here.
          if (i === GRAPPLE_SEGMENT_COUNT - 1) {
            const hitDist = Math.sqrt(
              (missLinkX[i] - player.positionXWorld) ** 2 +
              (missLinkY[i] - player.positionYWorld) ** 2,
            );
            if (hitDist >= GRAPPLE_MIN_LENGTH_WORLD) {
              // The miss-chain tip already sits GRAPPLE_TIP_SKIN_WORLD (0.5 wu)
              // outside the wall face (see clampedDist above), so the anchor is
              // a surface contact point — not embedded in solid geometry.
              //
              // Store the surface normal from the swept hit so that:
              //   1. The constraint solver can treat this as a surface anchor
              //      rather than a free floating point (avoiding false "inside
              //      solid" re-validation).
              //   2. Debug rendering can draw the normal arrow.
              //
              // NOTE: The anchor is intentionally NOT the exact wall face
              // (it is offset by the skin).  Merged wall rectangles are the
              // authoritative solid source for this query; the individual tile
              // boundaries are not stored at runtime.
              const missAnchorX = missLinkX[i];
              const missAnchorY = missLinkY[i];
              const missAnchorDist = Math.sqrt(
                (missAnchorX - player.positionXWorld) ** 2 +
                (missAnchorY - player.positionYWorld) ** 2,
              );

              // Attach grapple at this point (zip/stick mechanic replaced by proximity bounce)
              world.grappleAnchorXWorld = missAnchorX;
              world.grappleAnchorYWorld = missAnchorY;
              world.grappleAnchorNormalXWorld = swept.normalX;
              world.grappleAnchorNormalYWorld = swept.normalY;
              world.grappleLengthWorld = missAnchorDist;
              world.grapplePullInAmountWorld = 0.0;
              world.grappleJumpHeldTickCount = 0;
              world.playerJumpTriggeredFlag = 0;
              world.isGrappleActiveFlag = 1;
              world.isGrappleZipActiveFlag = 0;
              world.isGrappleStuckFlag = 0;
              world.grappleStuckStoppedTickCount = 0;
              world.isGrappleMissActiveFlag = 0;
              world.isGrappleRetractingFlag = 0;
              world.grappleMissTickCount = 0;
              world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
              world.grappleAttachFxXWorld = missAnchorX;
              world.grappleAttachFxYWorld = missAnchorY;
              // Debug: record sweep segment and raw hit for overlay rendering.
              world.grappleDebugSweepFromXWorld = prevLinkX;
              world.grappleDebugSweepFromYWorld = prevLinkY;
              world.grappleDebugSweepToXWorld   = prevLinkX + moveDirX * moveDist;
              world.grappleDebugSweepToYWorld   = prevLinkY + moveDirY * moveDist;
              world.grappleDebugRawHitXWorld    = swept.x;
              world.grappleDebugRawHitYWorld    = swept.y;
              world.isGrappleDebugActiveFlag    = 1;

              // Miss-chain attachment always consumes the charge (normal rope attach).
              world.hasGrappleChargeFlag = 0;
              return;
            }
          }
        } else {
          // Path is clear — advance to the new position.
          missLinkX[i] = prevLinkX + moveDx;
          missLinkY[i] = prevLinkY + moveDy;
        }
      }
      // Both wall-hit and clear-path links fall through to the world-floor and
      // circle-of-influence checks below.

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
