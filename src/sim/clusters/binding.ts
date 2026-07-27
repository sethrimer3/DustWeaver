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
export const INFLUENCE_RADIUS_WORLD = 96.0;

// ── Player-state behaviour constants ─────────────────────────────────────────

/** Speed (world units/sec) below which the player is considered standing still. */
const STANDING_STILL_SPEED_WORLD = 20.0;
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
const STANDING_STILL_BREATH_AMP_WORLD = 3.0;

/** Fraction of normal orbitalStrength applied while the player is airborne (comet tail). */
const JUMP_ORBITAL_SCALE = 0.25;
/**
 * Minimum player speed (world units/sec) before the comet-tail offset begins.
 * Below this the particles just orbit normally even while airborne.
 */
const TRAIL_MIN_SPEED_WORLD = 27.0;
/**
 * Player speed (world units/sec) at which the tail offset reaches its maximum.
 * Scales linearly from TRAIL_MIN_SPEED_WORLD to this value.
 */
const TRAIL_FULL_SPEED_WORLD = 333.0;
/** Maximum distance (world units) the spring target is displaced behind the player. */
const TRAIL_OFFSET_MAX_WORLD = 23.0;

/** Fraction of normal orbitalStrength applied while an attack is in flight. */
const ATTACK_ORBITAL_SCALE = 2.5;

/**
 * Velocity-matching gain (1/s) for player orbit motes (task section 2 — faster
 * Storm follow).
 *
 * A pure position spring tracking a moving anchor lags by a steady-state offset
 * proportional to player speed (offset ≈ v·drag·mass / attractionStrength). For
 * Gold Dust's heavy/weak profile that offset exceeds the influence radius at
 * grapple/zip/launch speeds, so motes detach and are left far behind.
 *
 * This feed-forward drives each mote's *velocity* toward the player's velocity.
 * The applied force is scaled by the mote's mass so the resulting acceleration
 * — (playerVel − moteVel)·gain — is mass-independent, giving every mote type the
 * same small, bounded velocity deficit (≈ drag/gain of player speed) instead of
 * a large positional lag. At steady state the term vanishes, so it adds no
 * offset and does not fight the orbital swirl; it only removes systematic lag.
 *
 * Explicit-Euler stability: gain·dtSec = 40/60 ≈ 0.67 ≪ 2, so it is
 * well-damped and cannot oscillate/overshoot at the fixed 60 Hz step.
 *
 * Gated to when the player is actually moving (speed above the standing-still
 * threshold), so the idle hovering halo is byte-for-byte unchanged.
 */
const PLAYER_FOLLOW_VELOCITY_MATCH_GAIN = 40.0;

/**
 * Far-recovery policy for player-owned motes beyond `INFLUENCE_RADIUS_WORLD`
 * (task section 4). Without this, a mote knocked or left far outside the
 * influence ring is skipped by binding entirely and can drift indefinitely —
 * nothing ever pulls it back. This applies ONLY to player-owned orbit/return
 * motes (never non-player particles, which keep their prior free-drift
 * behavior), and only outside the ordinary influence radius, so it can never
 * affect the calm idle halo or normal in-range orbiting.
 *
 * Below `FAR_RECOVERY_HARD_SNAP_DISTANCE_WORLD`: a stable, distance-scaled
 * pursuit force (proportional to how far beyond the influence radius the mote
 * has drifted, capped at `FAR_RECOVERY_MAX_PURSUIT_ACCEL_WORLD` so it can
 * never be explosive) steers it back toward the owner. Combined with the
 * element's normal drag during integration this converges to a bounded
 * steady-state speed — no oscillation, no runaway.
 *
 * At or beyond `FAR_RECOVERY_HARD_SNAP_DISTANCE_WORLD` (an extreme distance
 * that should only occur after a discontinuity such as the owner teleporting
 * to a different room while the mote was mid-flight elsewhere): a one-time
 * hard relocation places the mote just inside the influence ring with zero
 * velocity, so ordinary binding resumes cleanly next tick instead of asking
 * the pursuit force to close an unbounded gap.
 */
const FAR_RECOVERY_MAX_PURSUIT_ACCEL_WORLD = 900.0;
/** Proportional gain (1/s²) on how far beyond the influence radius the mote has drifted. */
const FAR_RECOVERY_GAIN = 6.0;
/** Extreme-distance safety-relocation threshold (world units) — see doc above. */
const FAR_RECOVERY_HARD_SNAP_DISTANCE_WORLD = 480.0;

function _applyFarRecoveryForce(
  world: WorldState,
  particleIndex: number,
  ownerX: number,
  ownerY: number,
  distToOwnerSq: number,
): void {
  const dist = Math.sqrt(distToOwnerSq);

  if (dist >= FAR_RECOVERY_HARD_SNAP_DISTANCE_WORLD) {
    const px = world.positionXWorld[particleIndex];
    const py = world.positionYWorld[particleIndex];
    const angle = (dist > 1e-6) ? Math.atan2(py - ownerY, px - ownerX) : 0;
    world.positionXWorld[particleIndex] = ownerX + Math.cos(angle) * INFLUENCE_RADIUS_WORLD * 0.9;
    world.positionYWorld[particleIndex] = ownerY + Math.sin(angle) * INFLUENCE_RADIUS_WORLD * 0.9;
    world.velocityXWorld[particleIndex] = 0;
    world.velocityYWorld[particleIndex] = 0;
    return;
  }

  const excess = dist - INFLUENCE_RADIUS_WORLD; // > 0 here
  const invDist = dist > 1e-6 ? 1.0 / dist : 0;
  const dx = (ownerX - world.positionXWorld[particleIndex]) * invDist;
  const dy = (ownerY - world.positionYWorld[particleIndex]) * invDist;
  const accel = Math.min(FAR_RECOVERY_MAX_PURSUIT_ACCEL_WORLD, FAR_RECOVERY_GAIN * excess);
  const mass = world.massKg[particleIndex] > 0 ? world.massKg[particleIndex] : 1.0;
  world.forceX[particleIndex] += dx * accel * mass;
  world.forceY[particleIndex] += dy * accel * mass;
}

export function applyBindingForces(world: WorldState): void {
  const {
    clusters,
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    massKg,
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

  // Count how many player particles are currently in attack mode (mode 1)
  // or weave active (mode 3). Used to detect whether an attack/weave is in flight.
  let playerAttackActiveCount = 0;
  if (playerEntityId !== -1) {
    for (let i = 0; i < particleCount; i++) {
      if (
        isAliveFlag[i] === 1 &&
        ownerEntityId[i] === playerEntityId &&
        (behaviorMode[i] === 1 || behaviorMode[i] === 3)
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
    // Normal orbit (0) always binds. All non-zero modes manage their own motion.
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

    const isPlayerParticle = (ownerId === playerEntityId);

    // ── Influence radius check ─────────────────────────────────────────────
    // Skip ordinary binding for particles outside the owner's influence ring
    // so they drift freely and only orbit when within range. Non-player
    // particles keep exactly this prior behavior (skip entirely, drift
    // freely) — the far-recovery policy below applies ONLY to player-owned
    // motes (task section 4), since only the player's own inventory motes
    // must be guaranteed to eventually return.
    const dxToOwner = positionXWorld[particleIndex] - ownerX;
    const dyToOwner = positionYWorld[particleIndex] - ownerY;
    const distToOwnerSq = dxToOwner * dxToOwner + dyToOwner * dyToOwner;
    if (distToOwnerSq > INFLUENCE_RADIUS_WORLD * INFLUENCE_RADIUS_WORLD) {
      if (isPlayerParticle) {
        _applyFarRecoveryForce(world, particleIndex, ownerX, ownerY, distToOwnerSq);
      }
      continue;
    }

    const profile = getElementProfile(kindBuffer[particleIndex]);

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

    // ---- 3. Player-follow velocity matching (task section 2) -------------
    // Drive the mote's velocity toward the player's so it keeps pace during
    // fast movement (grapple, zip, fall, launch, invulnerability dash) instead
    // of lagging behind by the position spring's large steady-state offset.
    // Mass-scaled so the acceleration is mass-independent; gated to a moving
    // player so the idle halo is unchanged.
    if (isPlayerParticle && playerSpeedWorld >= STANDING_STILL_SPEED_WORLD) {
      const massScale = massKg[particleIndex] > 0 ? massKg[particleIndex] : 1.0;
      forceX[particleIndex] +=
        (playerVelXWorld - velocityXWorld[particleIndex]) * PLAYER_FOLLOW_VELOCITY_MATCH_GAIN * massScale;
      forceY[particleIndex] +=
        (playerVelYWorld - velocityYWorld[particleIndex]) * PLAYER_FOLLOW_VELOCITY_MATCH_GAIN * massScale;
    }
  }
}
