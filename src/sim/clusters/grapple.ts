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
import { PLAYER_JUMP_SPEED_WORLD } from './movement';
import { moveClusterByDelta } from './movementCollision';
import {
  GRAPPLE_SEGMENT_COUNT,
  GRAPPLE_MIN_LENGTH_WORLD,
  GRAPPLE_ATTACH_FX_TICKS,
  BEHAVIOR_MODE_GRAPPLE_CHAIN,
  GRAPPLE_CHAIN_LIFETIME_TICKS,
  GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD,
  raycastWalls,
  releaseGrapple,
  clearLegacyGrappleMissState,
} from './grappleShared';
import { getEffectiveGrappleRangeWorld } from '../motes/orderedMoteQueue';
import { tickGrappleWrapping } from './grappleWrapping';
import { raycastRopeSegments } from './grappleRopeSupport';
import { tickGrappleZip } from './grappleZip';

export { updateGrappleRopeAnchor } from './grappleRopeSupport';
export { raycastRopeSegments } from './grappleRopeSupport';
// Re-export so existing callers (gameCommandProcessor) need not change import paths.
export { releaseGrapple } from './grappleShared';

// ============================================================================
// Tuning constants — adjust these to dial in the grapple feel
// ============================================================================

/**
 * Base speed at which the rope shortens while the down key is held (world units per second).
 * Applied at the start of a retraction hold before the ramp reaches full speed.
 * Intentionally equal to the old constant so the feel is identical at tick 0.
 */
const GRAPPLE_PULL_IN_SPEED_BASE_WORLD_PER_SEC = 60.0;

/**
 * Full speed at which the rope shortens while the down key is held (world units per second).
 * Reached after GRAPPLE_PULL_IN_RAMP_TICKS ticks of continuous hold.
 * Shorter rope = tighter swing radius = faster rotation = bigger launch when released.
 */
const GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC = 180.0;

/**
 * Number of ticks over which the retraction speed ramps from the base speed
 * to the full speed.  At 60 fps this is 0.35 seconds.
 * Prevents an instantaneous velocity spike when the player starts retracting.
 */
const GRAPPLE_PULL_IN_RAMP_TICKS = 21;

/**
 * Ticks of out-of-range rope before grapple breaks automatically.
 * Each tick the attached rope length exceeds the current effective grapple
 * range increments the counter; when the counter reaches this value the
 * grapple is released.  At 60 fps this is 0.75 seconds.
 *
 * Gives the player a short grace window when motes are depleted mid-swing
 * without instantly punishing them, while still enforcing the mote economy.
 */
const GRAPPLE_OUT_OF_RANGE_BREAK_TICKS = 45;

/**
 * Visual tension ramp denominator.  Tension starts becoming visible after
 * this many out-of-range ticks so the player gets a warning before the break.
 */
const GRAPPLE_RANGE_SHRINK_GRACE_TICKS = 20;

export const GRAPPLE_FAIL_BEAM_TOTAL_TICKS = 14;
export const GRAPPLE_FAIL_BEAM_EXTEND_TICKS = 5;
export const GRAPPLE_FAIL_BEAM_HOVER_TICKS = 3;
export const GRAPPLE_EMPTY_FX_TOTAL_TICKS = 12;

/**
 * Maximum total rope that can be pulled in before the grapple breaks (world units).
 * This is a tension limit — pulling too hard snaps the rope and the player flies
 * off with their accumulated swing momentum.  Acts as the skill ceiling for the mechanic.
 * Raised from 100 to 150 to give more retraction time at the higher pull speed.
 */
const GRAPPLE_MAX_PULL_IN_WORLD = 150.0;

/**
 * Maximum ratio by which tangential velocity can increase in a single tick due
 * to rope shortening (conservation of angular momentum).  Prevents extreme
 * speed spikes when the rope is very short.  1.1 = max 10 % boost per tick.
 */
const GRAPPLE_MAX_RETRACT_SPEED_RATIO = 1.1;

/**
 * Maximum tangential speed (world units/second) the player can reach via rope
 * retraction.  Acts as a hard cap so unbounded speed cannot accumulate even
 * when the rope is very short and angular-momentum conservation would produce
 * extreme values.  540 wu/s ≈ 9 wu/tick at 60 fps — fast but safe.
 */
const GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC = 540.0;

/**
 * Tangential velocity damping coefficient (fraction of speed lost per second).
 * At 0.12 the player loses ~12% of tangential speed each second — subtle
 * enough that single swings feel lively, but energy decays visibly over 3–4
 * full oscillations.  Increase for more drag; decrease for a floatier feel.
 */
const GRAPPLE_SWING_DAMPING_PER_SEC = 0.12;

/**
 * Upward velocity impulse (world units/second) added to the player when they
 * press jump to release the grapple.  This is a "jump off the rope" that adds
 * upward momentum to whatever swing velocity the player has.
 * Applied by *subtracting* from velocityYWorld — negative Y is upward.
 */
const GRAPPLE_JUMP_OFF_SPEED_WORLD = PLAYER_JUMP_SPEED_WORLD;

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
  if (world.hasGrappleChargeFlag === 0) {
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
  const maxCastDist = Math.min(dist, effectiveRangeWorld);

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

  const hitDist = Math.sqrt((hit.x - player.positionXWorld) ** 2 + (hit.y - player.positionYWorld) ** 2);

  // Don't attach when the wall is closer than the minimum rope length — doing
  // so would place the anchor inside the block geometry, which causes the
  // visible dot to appear embedded in the tile and produces erratic physics.
  if (hitDist < GRAPPLE_MIN_LENGTH_WORLD) {
    triggerGrappleFailBeam(world, dirX, dirY, maxCastDist);
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
/**
 * Step 0.25 — Enforces the rope constraint and applies swing physics.
 *
 * Called after applyClusterMovement (which applies gravity and floor collision)
 * so the constraint acts on the fully-updated cluster position and velocity.
 *
 * Controls:
 *   • Jump (W/Space/Up) → release grapple + upward velocity impulse.
 *   • Down (S/ArrowDown) held → retract (shorten) the rope.
 *     Shortening conserves angular momentum so the player swings faster.
 *     RMB while attached → activate zip: player rockets toward the anchor,
 *     momentum stops on arrival, then a 0.15 s zip-jump window opens.
 *     Jump in window = high-velocity zip-jump biased by held input direction.
 *     Miss window = grapple releases quietly, no automatic impulse.
 *
 * Pipeline per tick:
 *   1. Consume playerJumpTriggeredFlag and playerDownTriggeredFlag.
 *   2. Delegate zip activation + state machine to tickGrappleZip.
 *   3. If zip active → skip normal swing.
 *   4. Jump pressed (normal swing) → release with upward impulse.
 *   5. While down held (retraction):
 *      a. Decompose velocity into radial + tangential components.
 *      b. Shorten the rope.
 *      c. Scale tangential velocity by (oldLength / newLength) to conserve
 *         angular momentum.
 *      d. Recompose velocity from radial + boosted tangential.
 *   6. Enforce rope length: if player distance > ropeLength, snap position
 *      onto the rope circle and remove the outward radial velocity component.
 *   7. Post-constraint wall collision check to prevent ground clipping.
 *   8. Apply subtle tangential damping (air resistance / friction).
 */
export function applyGrappleClusterConstraint(world: WorldState): void {
  if (world.isGrappleActiveFlag === 0) return;

  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    releaseGrapple(world);
    return;
  }

  const dtSec = world.dtMs / 1000.0;

  // ── Jump input ────────────────────────────────────────────────────────────
  // movement.ts preserves playerJumpTriggeredFlag when grapple is active so we
  // can detect the rising edge of a jump press here.
  const jumpJustPressed = world.playerJumpTriggeredFlag === 1;
  world.playerJumpTriggeredFlag = 0; // consume — grapple owns the flag while active

  // Consume the down triggered flag so it does not accumulate during grapple.
  // (Retraction uses playerCrouchHeldFlag; playerDownTriggeredFlag was only
  //  needed by the old double-tap zip detection which has been replaced by RMB.)
  world.playerDownTriggeredFlag = 0;

  if (tickGrappleZip(world, player, jumpJustPressed, dtSec)) {
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Normal grapple — pendulum swing
  // ════════════════════════════════════════════════════════════════════════════

  // ── Phase 2: Geometric wrapping tick ─────────────────────────────────────
  // Must run before the constraint so wrap points are current this tick.
  if (world.isGrappleWrappingEnabled === 1) {
    tickGrappleWrapping(world, player);
  }

  // ── Jump input: release grapple + upward impulse ──────────────────────────
  // Any jump press immediately releases the grapple and gives the player an
  // upward velocity boost so they can "jump off" the rope.
  if (jumpJustPressed) {
    player.velocityYWorld -= GRAPPLE_JUMP_OFF_SPEED_WORLD;
    player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
    player.varJumpSpeedWorld = player.velocityYWorld;
    releaseGrapple(world, false);
    return;
  }

  // ── Compute radial direction from anchor to player ────────────────────────
  // Phase 2: When wrapping is enabled and wrap points exist, the active swing
  // anchor is the newest wrap point rather than the main grapple anchor.
  const ax = (world.isGrappleWrappingEnabled === 1 && world.grappleWrapPointCount > 0)
    ? world.grappleWrapPointXWorld[world.grappleWrapPointCount - 1]
    : world.grappleAnchorXWorld;
  const ay = (world.isGrappleWrappingEnabled === 1 && world.grappleWrapPointCount > 0)
    ? world.grappleWrapPointYWorld[world.grappleWrapPointCount - 1]
    : world.grappleAnchorYWorld;
  let dx = player.positionXWorld - ax;
  let dy = player.positionYWorld - ay;
  let dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1.0) return; // degenerate — player at anchor point

  let invDist = 1.0 / dist;
  // Unit vector pointing from anchor toward player (outward / radial direction)
  let nx = dx * invDist;
  let ny = dy * invDist;

  // ── Rope retraction (hold down / S) ───────────────────────────────────────
  // While the down key is held the rope shortens, and angular momentum is
  // conserved: v_tangential_new = v_tangential_old × (L_old / L_new).
  // This is why figure skaters spin faster when they pull their arms in.
  // A ramp-up over GRAPPLE_PULL_IN_RAMP_TICKS prevents an instant speed spike
  // on the first tick of a retraction hold.
  if (world.playerCrouchHeldFlag === 1) {
    world.grappleRetractHeldTicks++;
    // Ramp: starts at base speed on tick 1, reaches full speed at RAMP_TICKS.
    const rampFactor = Math.max(
      GRAPPLE_PULL_IN_SPEED_BASE_WORLD_PER_SEC / GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC,
      Math.min(1.0, world.grappleRetractHeldTicks / GRAPPLE_PULL_IN_RAMP_TICKS),
    );
    const pullThisTick = GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC * rampFactor * dtSec;
    const oldLength = world.grappleLengthWorld;
    const newLength = Math.max(oldLength - pullThisTick, GRAPPLE_MIN_LENGTH_WORLD);

    if (newLength < oldLength) {
      // Wall obstruction check: shortening the rope snaps the player toward
      // the anchor.  If a wall blocks that path, stop retraction rather than
      // pulling the player through geometry.  Cast from the player toward the
      // anchor; only check up to however far the player would actually move.
      // When retractDistWorld <= 0 the player is already within the new rope
      // length, so no snap occurs and no wall check is needed.
      const retractDistWorld = dist - newLength;
      const isRetractPathClear = retractDistWorld <= 0 || raycastWalls(
        world,
        player.positionXWorld, player.positionYWorld,
        -nx, -ny,
        retractDistWorld,
      ) === null;

      if (isRetractPathClear) {
        // Decompose velocity into radial and tangential components relative to
        // the anchor→player axis.
        const vRadial = player.velocityXWorld * nx + player.velocityYWorld * ny;
        const vTangX  = player.velocityXWorld - vRadial * nx;
        const vTangY  = player.velocityYWorld - vRadial * ny;

        // Scale tangential velocity to conserve angular momentum (L = m·v·r).
        // The ratio is clamped to prevent extreme spikes when the rope is very short.
        const ratio = Math.min(oldLength / newLength, GRAPPLE_MAX_RETRACT_SPEED_RATIO);
        let newVTangX = vTangX * ratio;
        let newVTangY = vTangY * ratio;

        // Hard cap on tangential speed to prevent unbounded acceleration when
        // the rope becomes very short.  Clamp after the ratio is applied so the
        // cap is consistent regardless of rope length.
        const tangSpeedSq = newVTangX * newVTangX + newVTangY * newVTangY;
        const maxTangSpeedSq = GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC * GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC;
        if (tangSpeedSq > maxTangSpeedSq) {
          const invTangSpeed = 1.0 / Math.sqrt(tangSpeedSq);
          newVTangX *= GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC * invTangSpeed;
          newVTangY *= GRAPPLE_MAX_TANGENTIAL_SPEED_WORLD_PER_SEC * invTangSpeed;
        }

        player.velocityXWorld = vRadial * nx + newVTangX;
        player.velocityYWorld = vRadial * ny + newVTangY;

        world.grappleLengthWorld        = newLength;
        world.grapplePullInAmountWorld += (oldLength - newLength);

        // Snap limit: too much accumulated tension breaks the rope
        if (world.grapplePullInAmountWorld >= GRAPPLE_MAX_PULL_IN_WORLD) {
          releaseGrapple(world);
          return;
        }
      }
      // If a wall blocks retraction, or if newLength equals GRAPPLE_MIN_LENGTH_WORLD,
      // no further pull occurs this tick.
    }
  } else {
    // Crouch key released — reset ramp counter so the next press starts fresh.
    world.grappleRetractHeldTicks = 0;
  }

  // ── Enforce rope length constraint ────────────────────────────────────────
  // If the player has drifted beyond the current rope length (due to gravity,
  // movement, or the rope shortening around them), move their position back
  // onto the rope circle using the collision-safe helper so the correction
  // cannot push them through a wall.  The outward radial velocity component
  // is removed afterward to prevent the rope from being stretched further.
  // The tangential (swing) component is fully preserved — this is what makes
  // the pendulum feel physical rather than scripted.
  const ropeLength = world.grappleLengthWorld;

  if (dist > ropeLength) {
    // Target position: player centre on the rope circle.
    const targetX = ax + nx * ropeLength;
    const targetY = ay + ny * ropeLength;
    const deltaX  = targetX - player.positionXWorld;
    const deltaY  = targetY - player.positionYWorld;

    // Move toward the target safely.  moveClusterByDelta uses the same
    // axis-separated sub-stepped sweep as normal movement, so the snap cannot
    // carry the player through solid geometry.  If a wall obstructs the path
    // the player stops at the wall face rather than being clipped inside it.
    // If a bounce pad is contacted, moveClusterByDelta applies the reflected
    // real velocity (based on the swing momentum, not the snap delta), and we
    // release the grapple so the player travels with the bounce trajectory.
    const snapResult = moveClusterByDelta(player, world, deltaX, deltaY, false, dtSec);
    if (snapResult.bounced) {
      // Reflected swing velocity is already on the player cluster (applied by
      // moveClusterByDelta).  Release the grapple so normal movement takes over.
      releaseGrapple(world, false);
      return;
    }

    // Remove outward velocity component (rope can only pull — never push).
    // Use the pre-snap nx/ny direction; the position change is a small
    // correction so the angular error is negligible.
    const velDotN = player.velocityXWorld * nx + player.velocityYWorld * ny;
    if (velDotN > 0) {
      player.velocityXWorld -= velDotN * nx;
      player.velocityYWorld -= velDotN * ny;
    }
  }

  // Recompute radial direction after potential wall correction
  dx = player.positionXWorld - ax;
  dy = player.positionYWorld - ay;
  dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1.0) return;
  invDist = 1.0 / dist;
  nx = dx * invDist;
  ny = dy * invDist;

  // ── Phase 9: Out-of-range tension break ──────────────────────────────────
  // While attached, if motes are depleted mid-swing the effective grapple range
  // can shrink below the current rope length.  Give the player a grace window
  // before snapping the rope so they are not instantly punished.
  {
    const effectiveRangeWorld = getEffectiveGrappleRangeWorld(world);
    if (world.grappleLengthWorld > effectiveRangeWorld) {
      world.grappleOutOfRangeTicks++;
      // Tension ramps from 0 → 1 starting after the grace window
      const ticksPastGrace = world.grappleOutOfRangeTicks - GRAPPLE_RANGE_SHRINK_GRACE_TICKS;
      const tensionWindow = GRAPPLE_OUT_OF_RANGE_BREAK_TICKS - GRAPPLE_RANGE_SHRINK_GRACE_TICKS;
      world.grappleTensionFactor = Math.max(0, Math.min(1.0, ticksPastGrace / tensionWindow));

      if (world.grappleOutOfRangeTicks >= GRAPPLE_OUT_OF_RANGE_BREAK_TICKS) {
        releaseGrapple(world);
        return;
      }
    } else {
      // Rope back within range — drain tension
      world.grappleOutOfRangeTicks = 0;
      world.grappleTensionFactor   = 0;
    }
  }

  // ── Swing damping (subtle air resistance on tangential velocity) ──────────
  // Only the tangential component is damped so gravity's natural acceleration
  // is not penalised.  The effect is subtle: enough that perpetual motion
  // eventually decays, but not so strong that the swing feels dead.
  {
    const vRadial = player.velocityXWorld * nx + player.velocityYWorld * ny;
    const vTangX  = player.velocityXWorld - vRadial * nx;
    const vTangY  = player.velocityYWorld - vRadial * ny;
    const dampFactor = Math.max(0.0, 1.0 - GRAPPLE_SWING_DAMPING_PER_SEC * dtSec);
    player.velocityXWorld = vRadial * nx + vTangX * dampFactor;
    player.velocityYWorld = vRadial * ny + vTangY * dampFactor;
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


