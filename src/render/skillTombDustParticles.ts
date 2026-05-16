/**
 * skillTombDustParticles.ts — Dust particle types, physics constants, and
 * simulation logic for save-tomb golden dust particles.
 *
 * Extracted from skillTombRenderer.ts so the physics simulation
 * (proximity detection, dust gravity, particle-particle collision, wall
 * penetration resolution) lives in a dedicated module separate from the
 * 2D canvas rendering code in SkillTombRenderer.
 *
 * All coordinate values are in world units.  Randomness (Math.random()) is
 * used only at spawn time in skillTombRenderer.ts (init()) — not here.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

// ── Exported spatial constant ─────────────────────────────────────────────

/** Distance in world units within which the tomb activates. */
export const SKILL_TOMB_INTERACT_RADIUS_WORLD = 3 * BLOCK_SIZE_MEDIUM;

// ── Exported count constant ───────────────────────────────────────────────

/** Number of decorative dust particles per tomb. */
export const DUST_PARTICLE_COUNT = 24;

// ── Physics constants (module-private) ───────────────────────────────────

/** Horizontal friction applied per second while a dust particle slides on the floor. */
const FLOOR_FRICTION_PER_SEC = 6.0;

/** Physical contact radius of each dust particle for collision resolution (world units). */
const DUST_CONTACT_RADIUS_WORLD = 2.0;

/** Outward launch speed (world units/sec) given to dust particles when swirl deactivates. */
const DUST_FALL_LAUNCH_SPEED_WORLD = 10.0;

/** World units from a floor surface at which a falling particle gently settles (no instant snap). */
const LANDING_THRESHOLD_WORLD = 2.0;

/** Soft gravity for falling dust particles (world units/s²). */
const DUST_GRAVITY_WORLD = 22.0;

/** Base terminal fall speed (world units/s); scaled per particle by fallSpeedScale. */
const DUST_TERMINAL_FALL_SPEED_BASE = 28.0;

/**
 * How far below the tomb center (relative Y) a particle may fall before being
 * faded out and respawned at the swirl orbit.
 */
const MAX_FALL_OFFSET_REL_WORLD = 80;

/** Speed at which alpha fades when a particle cannot find a floor (per second). */
const FADE_SPEED_PER_SEC = 1.5;

/**
 * Maximum vertical distance (world units) between a grounded particle and the
 * nearest floor below it before the particle is considered to be off an edge
 * and is ungrounded.
 */
const FLOOR_REVALIDATION_THRESHOLD_WORLD = 1.0;

// ── Types ─────────────────────────────────────────────────────────────────

export interface DustParticle {
  /** Current position relative to tomb center (world units). */
  xWorld: number;
  yWorld: number;
  /** Velocity (world units per second). */
  vxWorld: number;
  vyWorld: number;
  /** Swirl angle (radians). */
  angleRad: number;
  /** Swirl radius (world units). */
  radiusWorld: number;
  /** Particle size in world units. */
  sizeWorld: number;
  /** Current brightness 0..1 (1 = bright gold, 0 = dull). */
  brightness: number;
  /** Is this particle "grounded" (fallen to a heap)? */
  isGroundedFlag: boolean;
  /**
   * Alpha fade scale: 1 = fully visible, 0 = faded out / respawning.
   * Fades to 0 when the particle cannot find a floor within MAX_FALL_OFFSET_REL_WORLD.
   * Fades back to 1 once the tomb re-activates and swirl begins.
   */
  alphaFade: number;
  /** Y-coordinate of the floor this particle landed on (relative to tomb center, world units). */
  groundYRelWorld: number;
  /** Per-particle fall speed scale (0.7–1.3) for variation. */
  fallSpeedScale: number;
  /** Phase offset for sinusoidal horizontal drift while falling. */
  driftPhase: number;
  /** Oscillation frequency of the horizontal drift (rad/s relative to swirlAngleRad). */
  driftSpeed: number;
  /** Horizontal drift force amplitude (world units/s²). */
  driftAmplitudeWorld: number;
  /** Gold color variant index 0–3. */
  colorVariant: number;
  /** Trail: previous-frame X position relative to tomb center (world units). */
  trailPrevXWorld: number;
  /** Trail: previous-frame Y position relative to tomb center (world units). */
  trailPrevYWorld: number;
  /** Per-particle swirl angle speed scale (0.8–1.2). */
  swirlAngleSpeedScale: number;
  /** Per-particle vertical squish scale for swirl orbit (0.50–0.70). */
  swirlSquishScale: number;
}

export interface TombState {
  xWorld: number;
  yWorld: number;
  /** Is the player currently nearby? */
  isPlayerNearbyFlag: boolean;
  /** Transition factor 0..1 (1 = fully active/swirling, 0 = fully grounded). */
  activationFactor: number;
  /** Activation factor from the previous update — used to detect swirl→fall transition. */
  prevActivationFactor: number;
  /** Decorative dust particles. */
  dustParticles: DustParticle[];
  /** Accumulator for swirl animation. */
  swirlAngleRad: number;
}

/**
 * Axis-aligned bounding box for a solid (non-platform) wall in world units.
 * Passed to updateTombDust so the physics can detect floors and resolve penetration.
 */
export type TombWallRect = {
  leftWorld: number;
  rightWorld: number;
  topWorld: number;
  bottomWorld: number;
};

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * Find the nearest wall top surface that is at or below `absY` and horizontally
 * overlaps `absX`.  Returns the wall-top world Y coordinate, or `null` if none found.
 *
 * In world space Y increases downward, so "below the particle" means
 * `wall.topWorld >= absY` (larger Y = visually lower on screen).  Among all
 * qualifying walls the one with the smallest topWorld is the closest floor.
 *
 * A small horizontal seam tolerance (DUST_CONTACT_RADIUS_WORLD) is applied to
 * the X bounds so particles near block seams still detect the floor.
 */
function findFloorTopWorld(
  wallRects: TombWallRect[],
  absX: number,
  absY: number,
): number | null {
  let closestY = Infinity;
  const seam = DUST_CONTACT_RADIUS_WORLD;
  for (let i = 0; i < wallRects.length; i++) {
    const wall = wallRects[i];
    if (
      absX >= wall.leftWorld - seam && absX <= wall.rightWorld + seam &&
      wall.topWorld >= absY
    ) {
      if (wall.topWorld < closestY) {
        closestY = wall.topWorld;
      }
    }
  }
  return closestY === Infinity ? null : closestY;
}

/**
 * Resolve a particle out of any solid wall it has penetrated.
 * Tests the particle (treated as a point) against all wall AABBs and,
 * if inside, pushes it out via the smallest-penetration axis.
 * Velocity is zeroed on the collision axis and reflected slightly for a bounce.
 *
 * @param wallRects  Precomputed solid wall rectangles in world units.
 * @param dp         The dust particle (relative coordinates).
 * @param tombX      Absolute X of the tomb center (world units).
 * @param tombY      Absolute Y of the tomb center (world units).
 */
function resolveParticleWallPenetration(
  wallRects: TombWallRect[],
  dp: DustParticle,
  tombX: number,
  tombY: number,
): void {
  const absX = tombX + dp.xWorld;
  const absY = tombY + dp.yWorld;

  for (let i = 0; i < wallRects.length; i++) {
    const wall = wallRects[i];
    if (
      absX > wall.leftWorld && absX < wall.rightWorld &&
      absY > wall.topWorld  && absY < wall.bottomWorld
    ) {
      const penLeft   = absX - wall.leftWorld;
      const penRight  = wall.rightWorld  - absX;
      const penTop    = absY - wall.topWorld;
      const penBottom = wall.bottomWorld - absY;

      const minPen = Math.min(penLeft, penRight, penTop, penBottom);
      if (minPen === penLeft) {
        dp.xWorld -= penLeft;
        if (dp.vxWorld > 0) dp.vxWorld *= -0.1;
      } else if (minPen === penRight) {
        dp.xWorld += penRight;
        if (dp.vxWorld < 0) dp.vxWorld *= -0.1;
      } else if (minPen === penTop) {
        dp.yWorld -= penTop;
        dp.groundYRelWorld = dp.yWorld;
        dp.vyWorld *= -0.15;
        if (Math.abs(dp.vyWorld) < 2) dp.vyWorld = 0;
        dp.isGroundedFlag = true;
      } else {
        dp.yWorld += penBottom;
        if (dp.vyWorld < 0) dp.vyWorld *= -0.1;
      }
    }
  }
}

/**
 * Respawn a faded particle at its original swirl-orbit position, ready to
 * re-join the swirl when the player next approaches.
 */
function respawnParticle(dp: DustParticle, particleIndex: number): void {
  const angle = (particleIndex / DUST_PARTICLE_COUNT) * Math.PI * 2;
  const radius = dp.radiusWorld;
  dp.xWorld = Math.cos(angle) * radius;
  dp.yWorld = Math.sin(angle) * radius;
  dp.vxWorld = 0;
  dp.vyWorld = 0;
  dp.isGroundedFlag = true;
  dp.alphaFade = 0.0; // keep invisible until swirl re-activates
  dp.groundYRelWorld = dp.yWorld;
  dp.brightness = 0.3;
  dp.trailPrevXWorld = dp.xWorld;
  dp.trailPrevYWorld = dp.yWorld;
}

// ── Main simulation update ────────────────────────────────────────────────

/**
 * Advance dust particle physics for all tombs in a room.
 *
 * @param tombStates     Per-tomb mutable state (positions, activation factor, particles).
 * @param wallRects      Precomputed solid wall AABBs in world units.
 * @param playerXWorld   Player position X this frame.
 * @param playerYWorld   Player position Y this frame.
 * @param dtSec          Frame delta in seconds.
 */
export function updateTombDust(
  tombStates: TombState[],
  wallRects: TombWallRect[],
  playerXWorld: number,
  playerYWorld: number,
  dtSec: number,
): void {
  for (let t = 0; t < tombStates.length; t++) {
    const tomb = tombStates[t];
    const dx = playerXWorld - tomb.xWorld;
    const dy = playerYWorld - tomb.yWorld;
    const distSq = dx * dx + dy * dy;
    const isNearby = distSq < SKILL_TOMB_INTERACT_RADIUS_WORLD * SKILL_TOMB_INTERACT_RADIUS_WORLD;

    tomb.isPlayerNearbyFlag = isNearby;

    // Smoothly transition activation factor
    const targetFactor = isNearby ? 1.0 : 0.0;
    const transitionSpeed = 2.0; // factor units per second
    if (tomb.activationFactor < targetFactor) {
      tomb.activationFactor = Math.min(targetFactor, tomb.activationFactor + transitionSpeed * dtSec);
    } else {
      tomb.activationFactor = Math.max(targetFactor, tomb.activationFactor - transitionSpeed * dtSec);
    }

    tomb.swirlAngleRad += dtSec * 1.5;

    // Detect swirl→fall transition (activation just dropped below threshold)
    const prevActivation = tomb.prevActivationFactor;
    tomb.prevActivationFactor = tomb.activationFactor;
    const justDeactivated = prevActivation > 0.1 && tomb.activationFactor <= 0.1;

    // When swirl deactivates, launch particles outward so they spread and pile up
    if (justDeactivated) {
      for (let p = 0; p < tomb.dustParticles.length; p++) {
        const dp = tomb.dustParticles[p];
        const len = Math.sqrt(dp.xWorld * dp.xWorld + dp.yWorld * dp.yWorld);
        if (len > 0.001) {
          dp.vxWorld = (dp.xWorld / len) * DUST_FALL_LAUNCH_SPEED_WORLD;
          dp.vyWorld = 0;
        }
        dp.isGroundedFlag = false;
      }
    }

    // Update dust particles
    for (let p = 0; p < tomb.dustParticles.length; p++) {
      const dp = tomb.dustParticles[p];

      // Store previous position for trail rendering before any movement this frame
      dp.trailPrevXWorld = dp.xWorld;
      dp.trailPrevYWorld = dp.yWorld;

      if (tomb.activationFactor > 0.1) {
        // Swirling mode — fade alphaFade back to 1 so respawned particles reappear
        dp.alphaFade = Math.min(1.0, dp.alphaFade + 2.0 * dtSec);
        dp.isGroundedFlag = false;
        dp.angleRad += dtSec * (1.2 + p * 0.05) * dp.swirlAngleSpeedScale;
        const targetX = Math.cos(dp.angleRad) * dp.radiusWorld;
        const targetY = Math.sin(dp.angleRad) * dp.radiusWorld * dp.swirlSquishScale;
        dp.xWorld += (targetX - dp.xWorld) * Math.min(1, 4.0 * dtSec);
        dp.yWorld += (targetY - dp.yWorld) * Math.min(1, 4.0 * dtSec);
        dp.brightness = 0.7 + 0.3 * tomb.activationFactor;
      } else {
        // Falling / grounded mode
        if (!dp.isGroundedFlag && dp.alphaFade > 0) {
          // Soft gravity with per-particle terminal velocity
          const terminalFallSpeed = DUST_TERMINAL_FALL_SPEED_BASE * dp.fallSpeedScale;
          dp.vyWorld = Math.min(dp.vyWorld + DUST_GRAVITY_WORLD * dtSec, terminalFallSpeed);

          // Sinusoidal horizontal drift — floats like light dust in a breeze
          const timeProxy = tomb.swirlAngleRad;
          dp.vxWorld += Math.sin(timeProxy * dp.driftSpeed + dp.driftPhase) * dp.driftAmplitudeWorld * dtSec;
          dp.vxWorld *= Math.max(0, 1 - 1.5 * dtSec); // light air drag

          dp.xWorld += dp.vxWorld * dtSec;
          dp.yWorld += dp.vyWorld * dtSec;

          // Dynamic floor detection using actual room walls
          const absX = tomb.xWorld + dp.xWorld;
          const absY = tomb.yWorld + dp.yWorld;
          const floorTopWorld = findFloorTopWorld(wallRects, absX, absY);

          if (floorTopWorld !== null) {
            const floorRelY = floorTopWorld - tomb.yWorld;
            if (floorRelY - dp.yWorld <= LANDING_THRESHOLD_WORLD) {
              dp.yWorld = floorRelY;
              dp.groundYRelWorld = floorRelY;
              dp.vyWorld *= -0.1; // tiny bounce
              if (Math.abs(dp.vyWorld) < 1) dp.vyWorld = 0;
              dp.isGroundedFlag = true;
            }
            // else: floor is still further below — keep falling naturally
          } else if (dp.yWorld > MAX_FALL_OFFSET_REL_WORLD) {
            // Fell too far with no floor in reach — fade out then respawn
            dp.alphaFade -= FADE_SPEED_PER_SEC * dtSec;
            if (dp.alphaFade <= 0) {
              respawnParticle(dp, p);
            }
          }
        }

        // Floor friction (applied every tick when grounded)
        if (dp.isGroundedFlag) {
          dp.yWorld = dp.groundYRelWorld; // keep pinned to found floor
          dp.vxWorld *= Math.max(0, 1 - FLOOR_FRICTION_PER_SEC * dtSec);
          if (Math.abs(dp.vxWorld) < 0.3) dp.vxWorld = 0;

          // Re-validate floor under current X: particle may have been pushed
          // sideways off an edge by particle-particle collision.  If there is
          // no floor within 1 world unit of the grounded Y, unground it so it
          // falls to the correct surface below.
          const absXCheck = tomb.xWorld + dp.xWorld;
          const absYCheck = tomb.yWorld + dp.groundYRelWorld;
          const floorYWorld = findFloorTopWorld(wallRects, absXCheck, absYCheck);
          if (floorYWorld === null || floorYWorld > absYCheck + FLOOR_REVALIDATION_THRESHOLD_WORLD) {
            dp.isGroundedFlag = false;
            dp.vyWorld = 0;
          }
        }

        dp.brightness = Math.max(0.2, dp.brightness - 0.5 * dtSec);
      }
    }

    // Particle-particle collision resolution when not swirling
    if (tomb.activationFactor <= 0.1) {
      const contactDist = DUST_CONTACT_RADIUS_WORLD * 2;
      const contactDistSq = contactDist * contactDist;
      for (let particleIndexA = 0; particleIndexA < tomb.dustParticles.length; particleIndexA++) {
        const particleA = tomb.dustParticles[particleIndexA];
        for (let particleIndexB = particleIndexA + 1; particleIndexB < tomb.dustParticles.length; particleIndexB++) {
          const particleB = tomb.dustParticles[particleIndexB];
          const pdx = particleB.xWorld - particleA.xWorld;
          const pdy = particleB.yWorld - particleA.yWorld;
          const pDistSq = pdx * pdx + pdy * pdy;
          if (pDistSq >= contactDistSq || pDistSq < 0.0001) continue;
          const dist = Math.sqrt(pDistSq);
          const overlap = contactDist - dist;
          const nx = pdx / dist;
          const ny = pdy / dist;

          if (particleA.isGroundedFlag && particleB.isGroundedFlag) {
            // Both grounded: push apart horizontally only
            particleA.xWorld -= nx * overlap * 0.5;
            particleB.xWorld += nx * overlap * 0.5;
          } else {
            // At least one is airborne: full 2D push + velocity response
            particleA.xWorld -= nx * overlap * 0.5;
            particleA.yWorld -= ny * overlap * 0.5;
            particleB.xWorld += nx * overlap * 0.5;
            particleB.yWorld += ny * overlap * 0.5;
            const relVn = (particleB.vxWorld - particleA.vxWorld) * nx + (particleB.vyWorld - particleA.vyWorld) * ny;
            if (relVn < 0) {
              const impulse = relVn * 0.3;
              particleA.vxWorld += impulse * nx;
              particleA.vyWorld += impulse * ny;
              particleB.vxWorld -= impulse * nx;
              particleB.vyWorld -= impulse * ny;
            }
          }
        }
      }

      // After particle-particle resolution, push any particle that crossed into
      // a wall back out.  This prevents both lateral penetration and seam-slip.
      for (let p = 0; p < tomb.dustParticles.length; p++) {
        resolveParticleWallPenetration(wallRects, tomb.dustParticles[p], tomb.xWorld, tomb.yWorld);
      }
    }
  }
}
