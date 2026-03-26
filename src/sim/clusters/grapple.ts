/**
 * Grappling hook mechanics.
 *
 * The grapple attaches an inextensible rope from the player cluster to a fixed
 * world-space anchor point. Each tick two operations are performed:
 *
 *   applyGrappleClusterConstraint  (step 0.25, after cluster movement)
 *     • Enforces the rope length: if the player drifts beyond grappleLengthWorld,
 *       their position is snapped back onto the rope circle and the outward
 *       velocity component is removed.  Tangential velocity (swing momentum) is
 *       preserved, so the player naturally pendulum-swings.
 *
 *   updateGrappleChainParticles    (step 6.75, after particle integration)
 *     • Positions GRAPPLE_SEGMENT_COUNT Gold particles evenly along the rope
 *       between the player cluster and the anchor.
 *     • Zeroes their velocity so integration-accumulated drift is discarded.
 *
 * Chain particles are pre-allocated in the particle buffer by the game screen
 * at startup (grappleParticleStartIndex) and kept alive/dead according to the
 * grapple active state.
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';

/** Maximum rope length the player can shoot (world units). */
export const GRAPPLE_MAX_LENGTH_WORLD = 300;

/** Minimum rope length to prevent degenerate zero-length ropes. */
const GRAPPLE_MIN_LENGTH_WORLD = 30;

/** Number of Gold particles that form the visible chain between player and anchor. */
export const GRAPPLE_SEGMENT_COUNT = 10;

/**
 * Behavior mode value used for grapple chain particles.
 * Binding forces (binding.ts) already skip any particle whose behaviorMode !== 0,
 * so this non-standard value prevents chain particles from being pulled toward
 * their owner anchor — the grapple system overrides their positions directly.
 */
const BEHAVIOR_MODE_GRAPPLE_CHAIN = 3;

/**
 * Initialises the GRAPPLE_SEGMENT_COUNT chain particle slots starting at
 * world.particleCount.  Records the start index in world.grappleParticleStartIndex
 * and advances world.particleCount.  Called once by the game screen at startup.
 */
export function initGrappleChainParticles(world: WorldState, playerEntityId: number): void {
  const profile = getElementProfile(ParticleKind.Gold);
  const startIndex = world.particleCount;

  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const idx = world.particleCount++;

    world.positionXWorld[idx]    = 0.0;
    world.positionYWorld[idx]    = 0.0;
    world.velocityXWorld[idx]    = 0.0;
    world.velocityYWorld[idx]    = 0.0;
    world.forceX[idx]            = 0.0;
    world.forceY[idx]            = 0.0;
    world.massKg[idx]            = profile.massKg;
    world.chargeUnits[idx]       = 0.0;
    world.isAliveFlag[idx]       = 0;   // inactive until grapple fires
    world.kindBuffer[idx]        = ParticleKind.Gold;
    world.ownerEntityId[idx]     = playerEntityId;
    world.anchorAngleRad[idx]    = 0.0;
    world.anchorRadiusWorld[idx] = 0.0;
    world.disturbanceFactor[idx] = 0.0;
    world.ageTicks[idx]          = 0.0;
    world.lifetimeTicks[idx]     = 9999999.0;  // never expires naturally
    world.noiseTickSeed[idx]     = (0xdeadbe00 + i) >>> 0;
    world.behaviorMode[idx]      = BEHAVIOR_MODE_GRAPPLE_CHAIN;
    world.particleDurability[idx]  = profile.toughness;
    world.respawnDelayTicks[idx]   = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.isTransientFlag[idx]     = 1;  // no respawn on death — grapple system controls
  }

  world.grappleParticleStartIndex = startIndex;
}

/**
 * Fires the grapple, setting the anchor at the given world-space position
 * (pre-clamped to GRAPPLE_MAX_LENGTH_WORLD by the caller).
 * Activates the chain particles.
 */
export function fireGrapple(world: WorldState, anchorXWorld: number, anchorYWorld: number): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;

  const dx = anchorXWorld - player.positionXWorld;
  const dy = anchorYWorld - player.positionYWorld;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const clampedDist = Math.min(Math.max(dist, GRAPPLE_MIN_LENGTH_WORLD), GRAPPLE_MAX_LENGTH_WORLD);

  if (dist < 1.0) return; // cursor too close to player — ignore

  // Place anchor at clamped distance along the aim direction
  const invDist = 1.0 / dist;
  world.grappleAnchorXWorld = player.positionXWorld + dx * invDist * clampedDist;
  world.grappleAnchorYWorld = player.positionYWorld + dy * invDist * clampedDist;
  world.grappleLengthWorld  = clampedDist;
  world.isGrappleActiveFlag = 1;

  // Activate chain particles
  if (world.grappleParticleStartIndex >= 0) {
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      const idx = start + i;
      world.isAliveFlag[idx]  = 1;
      world.ageTicks[idx]     = 0.0;
      world.velocityXWorld[idx] = 0.0;
      world.velocityYWorld[idx] = 0.0;
    }
  }
}

/**
 * Releases the grapple and deactivates the chain particles.
 * The player retains their current velocity (built-up swing momentum).
 */
export function releaseGrapple(world: WorldState): void {
  world.isGrappleActiveFlag = 0;

  if (world.grappleParticleStartIndex >= 0) {
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      world.isAliveFlag[start + i] = 0;
    }
  }
}

/**
 * Step 0.25 — Enforces the rope length constraint on the player cluster.
 *
 * Called after applyClusterMovement (which applies gravity and floor collision)
 * so the constraint acts on the fully-updated cluster position and velocity.
 *
 * When the rope is taut (player distance > grappleLengthWorld):
 *   1. The player's position is snapped back onto the rope circle.
 *   2. The outward radial velocity component is removed (inelastic normal
 *      constraint), preserving the tangential (swing) component.
 */
export function applyGrappleClusterConstraint(world: WorldState): void {
  if (world.isGrappleActiveFlag === 0) return;

  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    releaseGrapple(world);
    return;
  }

  const ax = world.grappleAnchorXWorld;
  const ay = world.grappleAnchorYWorld;
  const ropeLength = world.grappleLengthWorld;

  const dx = player.positionXWorld - ax;
  const dy = player.positionYWorld - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1.0) return; // degenerate — player at anchor point

  const invDist = 1.0 / dist;
  // Unit vector pointing from anchor toward player (outward direction)
  const nx = dx * invDist;
  const ny = dy * invDist;

  if (dist > ropeLength) {
    // 1. Snap player position back onto the rope circle
    player.positionXWorld = ax + nx * ropeLength;
    player.positionYWorld = ay + ny * ropeLength;

    // 2. Remove outward velocity component (rope cannot push — only pull)
    const velDotN = player.velocityXWorld * nx + player.velocityYWorld * ny;
    if (velDotN > 0) {
      // Velocity is pointing away from anchor — clamp to zero along rope direction
      player.velocityXWorld -= velDotN * nx;
      player.velocityYWorld -= velDotN * ny;
    }
  }
}

/**
 * Step 6.75 — Repositions chain particles along the rope after integration.
 *
 * Particles are spaced evenly between the player cluster and the anchor,
 * and their velocity is zeroed so integration-accumulated drift does not
 * cause visual jitter on the next frame.
 */
export function updateGrappleChainParticles(world: WorldState): void {
  if (world.isGrappleActiveFlag === 0) return;
  if (world.grappleParticleStartIndex < 0) return;

  const player = world.clusters[0];
  if (player === undefined) return;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const ax = world.grappleAnchorXWorld;
  const ay = world.grappleAnchorYWorld;

  const start = world.grappleParticleStartIndex;
  const count = GRAPPLE_SEGMENT_COUNT;

  for (let i = 0; i < count; i++) {
    const idx = start + i;
    // Interpolate from player (t=0) toward anchor (t=1).
    // Skip the endpoints (player pos and anchor itself) so segments
    // sit between them rather than on top of either.
    const t = (i + 1) / (count + 1);
    world.positionXWorld[idx] = px + (ax - px) * t;
    world.positionYWorld[idx] = py + (ay - py) * t;
    world.velocityXWorld[idx] = 0.0;
    world.velocityYWorld[idx] = 0.0;
    world.forceX[idx]         = 0.0;
    world.forceY[idx]         = 0.0;
  }
}
