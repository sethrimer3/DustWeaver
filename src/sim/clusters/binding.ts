/**
 * Owner-anchor binding forces.
 *
 * Each particle has a unique anchor point relative to its owner cluster:
 *   anchorTarget = ownerPos + (cos(anchorAngleRad), sin(anchorAngleRad)) * anchorRadiusWorld
 *
 * Two forces are applied:
 *   1. Spring (attraction) toward the anchor target, scaled by attractionStrength.
 *   2. Orbital (tangential) force perpendicular to the owner→particle vector,
 *      scaled by orbitalStrength.  This drives circular orbiting without needing
 *      to rotate the anchor angle each tick.
 *
 * Influence radius: binding forces are only applied when a particle is within
 * INFLUENCE_RADIUS_WORLD of its owner.  Particles that drift outside this radius
 * (e.g. after being knocked back) move freely until they re-enter the ring.
 *
 * Force magnitudes come from the particle's ElementProfile so each element
 * feels differently "attached" to its owner.
 *
 * Player-state behaviors (player orbit particles only):
 *
 *  Attacking — some player particles are in attack mode (behaviorMode 1); the
 *    remaining orbit particles swirl faster (boosted orbitalStrength) to convey
 *    a charging/excited look while the attack is in flight.
 *
 *  Blocking — handled entirely by combat.ts (particles set to mode 2 and
 *    positioned into shield formations); no changes here.
 *
 *  Standing still — player is grounded and nearly stationary: orbital force is
 *    greatly reduced so particles slow to a hovering halo.  The spring radius
 *    breathes gently in/out with a per-particle phase offset, giving a calm
 *    "idle pulse" feel.
 *
 *  Jumping — player is airborne: the computed spring target is displaced
 *    backward (opposite to player velocity) by an offset that grows with speed
 *    up to TRAIL_OFFSET_MAX_WORLD.  This pulls particles into a comet-tail
 *    stream behind the player.  Orbital force is reduced so particles trail
 *    rather than orbit.
 */

import { WorldState } from '../world';
import { getElementProfile } from '../particles/elementProfiles';

/**
 * Radius (world units) within which a cluster can control its particles.
 * Exported so the renderer can draw the matching influence ring.
 */
export const INFLUENCE_RADIUS_WORLD = 200.0;

// ── Player-state behaviour constants ─────────────────────────────────────────

/** Speed (world units/sec) below which the player is considered standing still. */
const STANDING_STILL_SPEED_WORLD = 30.0;
/** Fraction of normal orbitalStrength applied while standing still. */
const STANDING_STILL_ORBITAL_SCALE = 0.15;
/**
 * Rate of the idle breathing oscillation (radians per tick).
 * ~0.04 rad/tick at 60 fps ≈ 0.4 Hz — a slow, calm pulse.
 */
const STANDING_STILL_BREATH_RATE_RAD = 0.04;
/**
 * Half-amplitude of the radius breathing pulse (world units).
 * Orbit radius varies by ±this amount at full breathing depth.
 */
const STANDING_STILL_BREATH_AMP_WORLD = 6.0;

/** Fraction of normal orbitalStrength applied while the player is airborne (comet tail). */
const JUMP_ORBITAL_SCALE = 0.25;
/**
 * Minimum player speed (world units/sec) before the comet-tail offset begins.
 * Below this the particles just orbit normally even while airborne.
 */
const TRAIL_MIN_SPEED_WORLD = 40.0;
/**
 * Player speed (world units/sec) at which the tail offset reaches its maximum.
 * Scales linearly from TRAIL_MIN_SPEED_WORLD to this value.
 */
const TRAIL_FULL_SPEED_WORLD = 500.0;
/** Maximum distance (world units) the spring target is displaced behind the player. */
const TRAIL_OFFSET_MAX_WORLD = 70.0;

/** Fraction of normal orbitalStrength applied while an attack is in flight. */
const ATTACK_ORBITAL_SCALE = 2.5;

export function applyBindingForces(world: WorldState): void {
  const {
    clusters,
    positionXWorld, positionYWorld,
    forceX, forceY,
    ownerEntityId, isAliveFlag,
    kindBuffer,
    anchorAngleRad, anchorRadiusWorld,
    behaviorMode,
    particleCount,
  } = world;

  // ── Pre-loop: collect player cluster state ────────────────────────────────
  // We need the player's velocity and grounding state to derive the four
  // action modes (attacking, blocking, standing still, jumping).  Blocking is
  // handled by combat.ts, so we only derive the other three here.
  let playerEntityId = -1;
  let playerIsGroundedFlag: 0 | 1 = 1;
  let playerVelXWorld = 0.0;
  let playerVelYWorld = 0.0;

  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerEntityId       = c.entityId;
      playerIsGroundedFlag = c.isGroundedFlag;
      playerVelXWorld      = c.velocityXWorld;
      playerVelYWorld      = c.velocityYWorld;
      break;
    }
  }

  // Count how many player particles are currently in attack mode (mode 1).
  // Used to detect whether an attack is still in flight.
  let playerAttackActiveCount = 0;
  if (playerEntityId !== -1) {
    for (let i = 0; i < particleCount; i++) {
      if (
        isAliveFlag[i] === 1 &&
        ownerEntityId[i] === playerEntityId &&
        behaviorMode[i] === 1
      ) {
        playerAttackActiveCount++;
      }
    }
  }

  // Derive scalar player action states.
  const playerSpeedWorld = Math.sqrt(
    playerVelXWorld * playerVelXWorld + playerVelYWorld * playerVelYWorld,
  );
  const playerIsJumping   = playerEntityId !== -1 &&
                            playerIsGroundedFlag === 0 &&
                            world.isPlayerBlockingFlag === 0;
  const playerIsStanding  = playerEntityId !== -1 &&
                            playerIsGroundedFlag === 1 &&
                            playerSpeedWorld < STANDING_STILL_SPEED_WORLD;
  const playerIsAttacking = playerEntityId !== -1 &&
                            playerAttackActiveCount > 0;

  // Pre-compute comet-tail direction (unit vector opposite to player velocity)
  // and offset magnitude so we don't recompute per particle.
  let playerTrailDirX   = 0.0;
  let playerTrailDirY   = 0.0;
  let playerTrailOffset = 0.0;
  if (playerIsJumping && playerSpeedWorld > TRAIL_MIN_SPEED_WORLD) {
    const invSpeed    = 1.0 / playerSpeedWorld;
    playerTrailDirX   = -playerVelXWorld * invSpeed;
    playerTrailDirY   = -playerVelYWorld * invSpeed;
    const t           = (playerSpeedWorld - TRAIL_MIN_SPEED_WORLD) /
                        (TRAIL_FULL_SPEED_WORLD - TRAIL_MIN_SPEED_WORLD);
    playerTrailOffset = (t < 1.0 ? t : 1.0) * TRAIL_OFFSET_MAX_WORLD;
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  for (let particleIndex = 0; particleIndex < particleCount; particleIndex++) {
    if (isAliveFlag[particleIndex] === 0) continue;
    if (behaviorMode[particleIndex] !== 0) continue;

    // Find the owning cluster
    const ownerId = ownerEntityId[particleIndex];
    let ownerX = 0.0;
    let ownerY = 0.0;
    let found = false;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusters[ci].entityId === ownerId && clusters[ci].isAliveFlag === 1) {
        ownerX = clusters[ci].positionXWorld;
        ownerY = clusters[ci].positionYWorld;
        found = true;
        break;
      }
    }
    if (!found) continue;

    // ── Influence radius check ─────────────────────────────────────────────
    // Skip binding for particles outside the owner's influence ring so they
    // drift freely and only orbit when within range.
    const dxToOwner = positionXWorld[particleIndex] - ownerX;
    const dyToOwner = positionYWorld[particleIndex] - ownerY;
    const distToOwnerSq = dxToOwner * dxToOwner + dyToOwner * dyToOwner;
    if (distToOwnerSq > INFLUENCE_RADIUS_WORLD * INFLUENCE_RADIUS_WORLD) continue;

    const profile = getElementProfile(kindBuffer[particleIndex]);

    const isPlayerParticle = (ownerId === playerEntityId);

    // ── Compute anchor target (may be modified by player state below) ──────
    const aAngle  = anchorAngleRad[particleIndex];
    const aRadius = anchorRadiusWorld[particleIndex];
    let targetX = ownerX + Math.cos(aAngle) * aRadius;
    let targetY = ownerY + Math.sin(aAngle) * aRadius;

    // ── Player-state target / orbital modifiers ────────────────────────────
    let orbitalScale = 1.0;

    if (isPlayerParticle) {
      if (playerIsJumping) {
        // Comet tail: displace spring target behind player, reduce orbital
        // so particles stream rather than continue to orbit.
        targetX += playerTrailDirX * playerTrailOffset;
        targetY += playerTrailDirY * playerTrailOffset;
        orbitalScale = JUMP_ORBITAL_SCALE;
      } else if (playerIsStanding) {
        // Idle breathing pulse: modulate the radius with a gentle sine wave.
        // Each particle uses its anchor angle as an extra phase offset so the
        // halo "breathes" with a wave-like ripple rather than all pulsing together.
        const breathPhase  = world.tick * STANDING_STILL_BREATH_RATE_RAD +
                             aAngle * 3.0;
        const breathRadius = aRadius + Math.sin(breathPhase) * STANDING_STILL_BREATH_AMP_WORLD;
        const clampedRadius = breathRadius > 1.0 ? breathRadius : 1.0;
        targetX = ownerX + Math.cos(aAngle) * clampedRadius;
        targetY = ownerY + Math.sin(aAngle) * clampedRadius;
        orbitalScale = STANDING_STILL_ORBITAL_SCALE;
      } else if (playerIsAttacking) {
        // Excited swirl: remaining orbit particles spin faster to convey
        // energy while the launched attack is in flight.
        orbitalScale = ATTACK_ORBITAL_SCALE;
      }
    }

    // ---- 1. Spring toward anchor target ----------------------------------
    const dax = targetX - positionXWorld[particleIndex];
    const day = targetY - positionYWorld[particleIndex];
    forceX[particleIndex] += dax * profile.attractionStrength;
    forceY[particleIndex] += day * profile.attractionStrength;

    // ---- 2. Orbital tangential force -------------------------------------
    // Perpendicular to the owner→particle vector drives circular orbit.
    // Using a constant-magnitude force so distance doesn't cause runaway.
    const toOwnerX = ownerX - positionXWorld[particleIndex];
    const toOwnerY = ownerY - positionYWorld[particleIndex];
    const dist = Math.sqrt(toOwnerX * toOwnerX + toOwnerY * toOwnerY);
    if (dist > 0.5) {
      // Tangent: rotate toOwner 90° counter-clockwise
      const invDist = 1.0 / dist;
      const tangentX = -toOwnerY * invDist;
      const tangentY =  toOwnerX * invDist;
      forceX[particleIndex] += tangentX * profile.orbitalStrength * orbitalScale;
      forceY[particleIndex] += tangentY * profile.orbitalStrength * orbitalScale;
    }
  }
}
