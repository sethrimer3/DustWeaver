/**
 * Grappling hook mechanics — physically convincing pendulum swing.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DEVELOPER NOTES — PHYSICS MODEL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. Momentum Preservation
 *    When the grapple attaches, the player's existing velocity is left entirely
 *    untouched.  The rope constraint only acts when the player tries to move
 *    *beyond* the rope length — at that point it removes the outward radial
 *    component of velocity (the part pulling away from the anchor) while
 *    preserving the tangential component (the swing).  This means a fast-moving
 *    player naturally carries their speed into a wide arc.
 *
 * 2. Rope Shortening → Speed Increase (Conservation of Angular Momentum)
 *    Angular momentum L = m × v_tangential × radius.  When the rope shortens
 *    from L_old to L_new, the tangential velocity is scaled by (L_old / L_new)
 *    so that L is conserved.  This is why figure skaters spin faster when they
 *    pull their arms in — same physics.  The result feels like the player is
 *    winding up for a powerful launch.
 *
 * 3. Swing Damping
 *    A very subtle damping factor is applied to the tangential velocity each
 *    tick while grappling.  This models air resistance / rope friction and
 *    slowly bleeds energy so the player cannot swing forever without input.
 *    The damping only affects the tangential component — gravity's natural
 *    acceleration is not penalised.  At the default coefficient (0.12 per
 *    second) the player barely notices energy loss within a single swing but
 *    will feel it after 3–4 full oscillations.
 *
 * 4. Jump Off Grapple
 *    While the grapple is active, pressing jump immediately releases the
 *    grapple and adds an upward velocity impulse (equal to the normal jump
 *    speed).  This lets the player "jump off" the rope at any point in their
 *    swing, combining their swing momentum with the upward boost.
 *
 * 5. Rope Retraction (Hold Down/S)
 *    While the grapple is active, holding down/S retracts the rope.  As the
 *    rope shortens, angular momentum is conserved (v_tang × radius = const),
 *    so the player swings faster.  If the accumulated retraction exceeds
 *    GRAPPLE_MAX_PULL_IN_WORLD the rope snaps.
 *
 * 6. Single Grapple Charge
 *    The player can only grapple once until they touch the ground or grapple
 *    onto a top surface (which instantly refreshes the charge).  This prevents
 *    infinite air grappling while still allowing ledge-to-ledge chaining.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The grapple attaches an inextensible rope from the player cluster to a fixed
 * world-space anchor point. Each tick two operations are performed:
 *
 *   applyGrappleClusterConstraint  (step 0.25, after cluster movement)
 *     • If jump pressed: releases grapple with upward velocity impulse.
 *     • While down/S held: retracts the rope, conserving angular momentum.
 *     • Enforces the rope length: snaps the player back onto the rope circle
 *       and removes the outward radial velocity component.
 *     • Runs a post-constraint wall collision check to prevent ground clipping.
 *     • Applies subtle tangential damping.
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
import { ClusterState } from './state';
import {
  GRAPPLE_SEGMENT_COUNT,
  GRAPPLE_MIN_LENGTH_WORLD,
  GRAPPLE_ATTACH_FX_TICKS,
  BEHAVIOR_MODE_GRAPPLE_CHAIN,
  GRAPPLE_CHAIN_LIFETIME_TICKS,
  GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD,
  raycastWalls,
  clearLegacyGrappleMissState,
} from './grappleShared';
import { getEffectiveGrappleRangeWorld } from '../motes/orderedMoteQueue';
import { raycastRopeSegments } from './grappleRopeSupport';
import { findGrappleCarryBlockRayHit } from '../grappleCarryBlocks';

export { updateGrappleRopeAnchor } from './grappleRopeSupport';
export { raycastRopeSegments } from './grappleRopeSupport';
// Re-export so existing callers (gameCommandProcessor) need not change import paths.
export { releaseGrapple } from './grappleShared';
// Re-export so tick.ts need not change its import path.
export { applyGrappleClusterConstraint } from './grappleConstraint';

export const GRAPPLE_FAIL_BEAM_TOTAL_TICKS = 14;
export const GRAPPLE_FAIL_BEAM_EXTEND_TICKS = 5;
export const GRAPPLE_FAIL_BEAM_HOVER_TICKS = 3;
export const GRAPPLE_EMPTY_FX_TOTAL_TICKS = 12;

/**
 * Damping factor applied to the remaining grapple distance when it bounces off
 * an ice surface.  0.6 = 60% of the remaining reach is shown as the reflected ray.
 */
const ICE_GRAPPLE_BOUNCE_DAMPING = 0.6;

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
    world.lifetimeTicks[idx]     = GRAPPLE_CHAIN_LIFETIME_TICKS;
    world.noiseTickSeed[idx]     = (0xdeadbe00 + i) >>> 0;
    world.behaviorMode[idx]      = BEHAVIOR_MODE_GRAPPLE_CHAIN;
    world.particleDurability[idx]  = profile.toughness;
    world.respawnDelayTicks[idx]   = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.isTransientFlag[idx]     = 1;  // no respawn on death — grapple system controls
  }

  world.grappleParticleStartIndex = startIndex;
}

function getPlayerGrappleOriginWorld(player: ClusterState): { x: number; y: number } {
  const offsetDir = player.isFacingLeftFlag === 1 ? -1 : 1;
  return {
    x: player.positionXWorld + offsetDir * player.halfWidthWorld,
    y: player.positionYWorld,
  };
}

function clearGrappleFailureFx(world: WorldState): void {
  world.grappleFailBeamTicksLeft = 0;
  world.grappleEmptyFxTicksLeft = 0;
  world.grappleIceBounceTicksLeft = 0;
}

function triggerGrappleFailBeam(world: WorldState, dirXWorld: number, dirYWorld: number, maxDistWorld: number): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;

  const origin = getPlayerGrappleOriginWorld(player);
  world.grappleFailBeamTicksLeft = GRAPPLE_FAIL_BEAM_TOTAL_TICKS;
  world.grappleFailBeamTotalTicks = GRAPPLE_FAIL_BEAM_TOTAL_TICKS;
  world.grappleFailBeamStartXWorld = origin.x;
  world.grappleFailBeamStartYWorld = origin.y;
  world.grappleFailBeamEndXWorld = origin.x + dirXWorld * maxDistWorld;
  world.grappleFailBeamEndYWorld = origin.y + dirYWorld * maxDistWorld;
}

function triggerGrappleEmptyFx(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;

  const origin = getPlayerGrappleOriginWorld(player);
  world.grappleEmptyFxTicksLeft = GRAPPLE_EMPTY_FX_TOTAL_TICKS;
  world.grappleEmptyFxTotalTicks = GRAPPLE_EMPTY_FX_TOTAL_TICKS;
  world.grappleEmptyFxXWorld = origin.x;
  world.grappleEmptyFxYWorld = origin.y;
}

/**
 * Fires the grapple, setting the anchor just outside the raycast wall surface.
 * Returns without attaching if the wall is too close (less than
 * GRAPPLE_MIN_LENGTH_WORLD away) to prevent degenerate behaviour.
 * Activates the chain particles.
 *
 * ANCHOR PLACEMENT:
 *   The anchor is placed at hitPoint + normal * GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD
 *   (i.e. slightly OUTSIDE the wall, not at the exact boundary).  This prevents
 *   the anchor from sitting exactly on a wall face where floating-point math
 *   could classify it as "inside" solid geometry on subsequent validation
 *   checks.  The anchor is a surface-contact point — validate it by checking
 *   the stored normal + wall index, NOT by testing if the point is inside
 *   solid geometry.
 *
 * The player can only grapple once until they touch the ground or grapple onto
 * a top surface (which instantly refreshes the charge).
 */
export function fireGrapple(world: WorldState, anchorXWorld: number, anchorYWorld: number): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;
  const playerEntityId = player.entityId;

  // Grapple charge: cannot fire when spent.  The refire-during-retract
  // shortcut is intentionally removed — the charge system already refreshes
  // after top-surface grapples and ground contact, so a genuine refire only
  // succeeds when the player actually has a charge.
  //
  // Assist Mode exception: the "must touch ground before grappling again"
  // restriction is bypassed when isAssistModeFlag is set.  All other grapple
  // constraints (range, line-of-sight, wall collision, cooldown, etc.) remain
  // fully enforced regardless of assist mode.
  if (world.hasGrappleChargeFlag === 0 && world.isAssistModeFlag === 0) {
    triggerGrappleEmptyFx(world);
    return;
  }

  const dx = anchorXWorld - player.positionXWorld;
  const dy = anchorYWorld - player.positionYWorld;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1.0) return; // cursor too close to player — ignore

  const invDist = 1.0 / dist;
  const dirX = dx * invDist;
  const dirY = dy * invDist;
  const effectiveRangeWorld = getEffectiveGrappleRangeWorld(world);
  // Always cast the full grapple range — the mouse position indicates direction only,
  // not the desired length. This ensures the grapple always fires to its full reach
  // even when the cursor is inside the influence radius.
  const maxCastDist = effectiveRangeWorld;

  // ── Check rope segments first — ropes take priority over walls ──────────
  const ropeHit = raycastRopeSegments(world, player.positionXWorld, player.positionYWorld, dirX, dirY, maxCastDist);
  if (ropeHit !== null) {
    const ropeDist = ropeHit.distWorld;
    if (ropeDist >= GRAPPLE_MIN_LENGTH_WORLD) {
      clearGrappleFailureFx(world);
      world.grappleAnchorXWorld = ropeHit.hitX;
      world.grappleAnchorYWorld = ropeHit.hitY;
      world.grappleLengthWorld  = ropeDist;
      world.grapplePullInAmountWorld = 0.0;
      world.grappleJumpHeldTickCount = 0;
      world.playerJumpTriggeredFlag = 0;
      world.isGrappleActiveFlag = 1;
      world.isGrappleZipActiveFlag = 0;
      world.isGrappleStuckFlag = 0;
      world.grappleStuckStoppedTickCount = 0;
      world.grappleProximityBounceTicksLeft = 0;
      world.grappleProximityBounceRotationAngleRad = 0;
      world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
      world.grappleAttachFxXWorld = ropeHit.hitX;
      world.grappleAttachFxYWorld = ropeHit.hitY;
      player.isFastFallModeFlag = 0;
      world.hasGrappleChargeFlag = 0;
      // Track which rope segment we're attached to so the anchor moves with rope
      world.grappleRopeIndex = ropeHit.ropeIndex;
      world.grappleRopeAttachSegF = ropeHit.segF;
      // Activate chain particles
      if (world.grappleParticleStartIndex >= 0) {
        const start = world.grappleParticleStartIndex;
        const chainProfile = getElementProfile(ParticleKind.Gold);
        for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
          const idx = start + i;
          world.isAliveFlag[idx]        = 1;
          world.ageTicks[idx]           = 0.0;
          world.lifetimeTicks[idx]      = GRAPPLE_CHAIN_LIFETIME_TICKS;
          world.kindBuffer[idx]         = ParticleKind.Gold;
          world.ownerEntityId[idx]      = playerEntityId;
          world.behaviorMode[idx]       = BEHAVIOR_MODE_GRAPPLE_CHAIN;
          world.isTransientFlag[idx]    = 1;
          world.particleDurability[idx] = chainProfile.toughness;
          world.respawnDelayTicks[idx]  = 0;
          world.velocityXWorld[idx]     = 0.0;
          world.velocityYWorld[idx]     = 0.0;
        }
      }
      return;
    }
  }

  const carryHit = findGrappleCarryBlockRayHit(world, player.positionXWorld, player.positionYWorld, dirX, dirY, maxCastDist);
  if (carryHit !== null && carryHit.t >= GRAPPLE_MIN_LENGTH_WORLD) {
    clearGrappleFailureFx(world);
    world.grappleCarryBlockIndex = carryHit.index;
    world.grappleRopeIndex = -1;
    world.grappleAnchorXWorld = world.grappleCarryBlockXWorld[carryHit.index];
    world.grappleAnchorYWorld = world.grappleCarryBlockYWorld[carryHit.index];
    world.grappleAnchorNormalXWorld = 0;
    world.grappleAnchorNormalYWorld = 0;
    world.grappleLengthWorld = carryHit.t;
    world.grapplePullInAmountWorld = 0.0;
    world.grappleJumpHeldTickCount = 0;
    world.grappleRetractHeldTicks = 0;
    world.playerJumpTriggeredFlag = 0;
    world.isGrappleActiveFlag = 1;
    world.isGrappleZipActiveFlag = 0;
    world.isGrappleZipTriggeredFlag = 0;
    world.isGrappleStuckFlag = 0;
    world.grappleStuckStoppedTickCount = 0;
    world.grappleWrapPointCount = 0;
    world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
    world.grappleAttachFxXWorld = world.grappleAnchorXWorld;
    world.grappleAttachFxYWorld = world.grappleAnchorYWorld;
    player.isFastFallModeFlag = 0;
    world.hasGrappleChargeFlag = 0;
    if (world.grappleParticleStartIndex >= 0) {
      const start = world.grappleParticleStartIndex;
      const chainProfile = getElementProfile(ParticleKind.Gold);
      for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
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
        world.velocityXWorld[idx] = 0.0;
        world.velocityYWorld[idx] = 0.0;
      }
    }
    return;
  }

  const hit = raycastWalls(world, player.positionXWorld, player.positionYWorld, dirX, dirY, maxCastDist);

  if (hit === null) {
    clearLegacyGrappleMissState(world);
    triggerGrappleFailBeam(world, dirX, dirY, maxCastDist);
    return;
  }

  // Bounce pad walls cannot be grappled — treat as a miss.
  if (hit.wallIndex >= 0 && world.wallIsBouncePadFlag[hit.wallIndex] === 1) {
    clearLegacyGrappleMissState(world);
    triggerGrappleFailBeam(world, dirX, dirY, maxCastDist);
    return;
  }

  // Ice walls cannot be grappled — the grapple head bounces off the surface.
  if (hit.wallIndex >= 0 && (world.wallIsIceFlag[hit.wallIndex] === 1 || world.wallIsUltraIceFlag[hit.wallIndex] === 1)) {
    clearLegacyGrappleMissState(world);
    // Show the normal approach beam from the player to the ice surface.
    triggerGrappleFailBeam(world, dirX, dirY, hit.t);
    // Compute reflected direction for the ice-bounce visual.
    // The reflected direction is: d - 2*(d·n)*n (vector reflection).
    const dot = dirX * hit.normalX + dirY * hit.normalY;
    const reflDirX = dirX - 2.0 * dot * hit.normalX;
    const reflDirY = dirY - 2.0 * dot * hit.normalY;
    const remainingDist = (maxCastDist - hit.t) * ICE_GRAPPLE_BOUNCE_DAMPING;
    world.grappleIceBounceTicksLeft = GRAPPLE_FAIL_BEAM_TOTAL_TICKS;
    world.grappleIceBounceTicksTotal = GRAPPLE_FAIL_BEAM_TOTAL_TICKS;
    world.grappleIceBounceStartXWorld = hit.x;
    world.grappleIceBounceStartYWorld = hit.y;
    world.grappleIceBounceEndXWorld = hit.x + reflDirX * remainingDist;
    world.grappleIceBounceEndYWorld = hit.y + reflDirY * remainingDist;
    return;
  }

  // Confirmed wall hit — cancel any active miss/retract before attaching.
  clearLegacyGrappleMissState(world);
  clearGrappleFailureFx(world);

  // Place the anchor just outside the wall surface using the surface normal from
  // the raycast.  Offsetting by GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD prevents the
  // anchor from sitting exactly on the wall boundary where floating-point math
  // could classify it as inside solid geometry.
  //
  // SURFACE-ANCHOR VALIDATION NOTE:
  //   This anchor is a confirmed surface-contact point from a swept raycast —
  //   do NOT re-validate it with a point-in-solid test.  Instead, validate by
  //   checking that hit.wallIndex is still solid (relevant for breakable blocks)
  //   and that the player→anchor line remains unobstructed.  A generic
  //   "is this point inside a wall?" check will incorrectly fire because the
  //   anchor sits exactly on (or within floating-point noise of) the wall face.
  const anchorX = hit.x - hit.normalX * GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD;
  const anchorY = hit.y - hit.normalY * GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD;
  const anchorDist = Math.sqrt((anchorX - player.positionXWorld) ** 2 + (anchorY - player.positionYWorld) ** 2);

  world.grappleAnchorXWorld = anchorX;
  world.grappleAnchorYWorld = anchorY;
  // Store the outward surface normal so:
  //   1. Constraint/validation code knows this is a surface anchor (not a free point).
  //   2. Debug rendering can draw the normal arrow at the anchor.
  world.grappleAnchorNormalXWorld = hit.normalX;
  world.grappleAnchorNormalYWorld = hit.normalY;
  world.grappleLengthWorld  = anchorDist;
  world.grapplePullInAmountWorld = 0.0;  // reset pull-in counter for this new attachment
  world.grappleJumpHeldTickCount = 0;   // reset tap/hold tracker
  world.grappleRetractHeldTicks  = 0;   // reset retraction ramp counter
  // Clear any pending jump trigger so that a jump press made on the same frame
  // as the grapple fire (e.g. jumping then immediately grappling) is not
  // misread as a tap-release by applyGrappleClusterConstraint on the very
  // first tick after attachment.
  world.playerJumpTriggeredFlag = 0;
  world.isGrappleActiveFlag = 1;
  world.isGrappleZipActiveFlag = 0;  // zip activated by RMB, not at fire time
  world.isGrappleZipTriggeredFlag = 0; // clear any pending zip request from before attachment
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  // Clear wrap points — this is a new grapple attachment.
  world.grappleWrapPointCount = 0;
  // Clear any lingering proximity bounce sprite state — the player is now
  // swinging on a normal rope, so the bounce rotation is no longer relevant.
  world.grappleProximityBounceTicksLeft = 0;
  world.grappleProximityBounceRotationAngleRad = 0;
  world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
  world.grappleAttachFxXWorld = anchorX;
  world.grappleAttachFxYWorld = anchorY;
  // Attaching a grapple exits committed fast-fall mode — the player is now
  // swinging, not falling, so the fast-fall terminal velocity no longer applies.
  player.isFastFallModeFlag = 0;
  // Debug: record the sweep segment and raw hit point for overlay rendering.
  world.grappleDebugSweepFromXWorld = player.positionXWorld;
  world.grappleDebugSweepFromYWorld = player.positionYWorld;
  world.grappleDebugSweepToXWorld   = player.positionXWorld + dirX * maxCastDist;
  world.grappleDebugSweepToYWorld   = player.positionYWorld + dirY * maxCastDist;
  world.grappleDebugRawHitXWorld    = hit.x;
  world.grappleDebugRawHitYWorld    = hit.y;
  world.isGrappleDebugActiveFlag    = 1;

  // Consume grapple charge (normal rope attachment — no auto-recharge).
  world.hasGrappleChargeFlag = 0;

  // Activate chain particles — fully reinitialise fields that may have been
  // overwritten while the slots were reused by stone shards or other transient
  // particles (e.g. lifetimeTicks, kindBuffer, behaviorMode).  Without this
  // reset, chain particles can expire mid-swing and the renderer falls back to
  // displaying the rope attached to the old anchor position.
  if (world.grappleParticleStartIndex >= 0) {
    const start = world.grappleParticleStartIndex;
    const chainProfile = getElementProfile(ParticleKind.Gold);
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      const idx = start + i;
      world.isAliveFlag[idx]        = 1;
      world.ageTicks[idx]           = 0.0;
      world.lifetimeTicks[idx]      = GRAPPLE_CHAIN_LIFETIME_TICKS;
      world.kindBuffer[idx]         = ParticleKind.Gold;
      world.ownerEntityId[idx]      = playerEntityId;
      world.behaviorMode[idx]       = BEHAVIOR_MODE_GRAPPLE_CHAIN;
      world.isTransientFlag[idx]    = 1;
      world.particleDurability[idx] = chainProfile.toughness;
      world.respawnDelayTicks[idx]  = 0;
      world.velocityXWorld[idx]     = 0.0;
      world.velocityYWorld[idx]     = 0.0;
    }
  }
}

/**
 * Releases the grapple and deactivates the chain particles.
 * The player retains their current velocity (built-up swing momentum).
 */

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
  const dx = ax - px;
  const dy = ay - py;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = len > 1e-6 ? -dy / len : 0.0;
  const ny = len > 1e-6 ? dx / len : 0.0;

  const start = world.grappleParticleStartIndex;
  const count = GRAPPLE_SEGMENT_COUNT;

  for (let i = 0; i < count; i++) {
    const idx = start + i;
    // Interpolate from player (t=0) toward anchor (t=1).
    // Skip the endpoints (player pos and anchor itself) so segments
    // sit between them rather than on top of either.
    const t = (i + 1) / (count + 1);
    const spacedT = 0.08 + t * 0.84;
    const wobble = Math.sin(world.tick * 0.33 + i * 1.17) * 2.2;
    world.positionXWorld[idx] = px + dx * spacedT + nx * wobble;
    world.positionYWorld[idx] = py + dy * spacedT + ny * wobble;
    world.velocityXWorld[idx] = 0.0;
    world.velocityYWorld[idx] = 0.0;
    world.forceX[idx]         = 0.0;
    world.forceY[idx]         = 0.0;
  }
}


