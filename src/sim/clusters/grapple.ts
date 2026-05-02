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

import { WorldState, MAX_ROPE_SEGMENTS } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS, GRAPPLE_SUPER_JUMP_MULTIPLIER } from './movement';
import { COYOTE_TIME_TICKS, debugSpeedOverrides, ov, GRAPPLE_ZIP_DOUBLE_TAP_WINDOW_TICKS } from './movementConstants';
import { resolveAABBPenetration } from '../physics/collision';
import { resolveClusterSolidWallCollision, resolveClusterFloorCollision, moveClusterByDelta } from './movementCollision';
import {
  GRAPPLE_SEGMENT_COUNT,
  GRAPPLE_MIN_LENGTH_WORLD,
  GRAPPLE_ATTACH_FX_TICKS,
  BEHAVIOR_MODE_GRAPPLE_CHAIN,
  GRAPPLE_CHAIN_LIFETIME_TICKS,
  raycastWalls,
  startGrappleMiss,
  cancelGrappleMiss,
  startGrappleRetract,
} from './grappleMiss';
import { getEffectiveGrappleRangeWorld } from '../motes/orderedMoteQueue';

// ============================================================================
// Tuning constants — adjust these to dial in the grapple feel
// ============================================================================

/**
 * Speed at which the rope shortens while the jump button is held (world units per second).
 * Shorter rope = tighter swing radius = faster rotation = bigger launch when released.
 */
const GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC = 60.0;

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

/**
 * Maximum total rope that can be pulled in before the grapple breaks (world units).
 * This is a tension limit — pulling too hard snaps the rope and the player flies
 * off with their accumulated swing momentum.  Acts as the skill ceiling for the mechanic.
 */
const GRAPPLE_MAX_PULL_IN_WORLD = 100.0;

/**
 * Maximum ratio by which tangential velocity can increase in a single tick due
 * to rope shortening (conservation of angular momentum).  Prevents extreme
 * speed spikes when the rope is very short.  1.1 = max 10 % boost per tick.
 */
const GRAPPLE_MAX_RETRACT_SPEED_RATIO = 1.1;

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
 * Distance (world units) within which a grapple hit triggers the special
 * proximity bounce instead of a normal rope attachment.  Equals the side
 * length of a 2×2 small-block area (16 virtual pixels = 16 world units).
 * If the player's centre is within this distance of the hit surface at fire
 * time, the player is launched instantly in the surface-normal direction at
 * super-jump speed.  Works on any surface orientation: floor, wall, or ceiling.
 */
const GRAPPLE_PROXIMITY_BOUNCE_THRESHOLD_WORLD = 16.0;

/**
 * How many ticks to display the rotated jumping sprite after a proximity bounce
 * off a wall or ceiling (0.5 seconds at 60 fps).
 */
const GRAPPLE_PROXIMITY_BOUNCE_SPRITE_TICKS = 30;

/**
 * Speed at which the player is zipped toward the grapple anchor — ~3× sprint speed.
 */
const GRAPPLE_ZIP_SPEED_WORLD_PER_SEC = 480.0;

/**
 * Arrival distance (world units) — the player is snapped to the target when
 * the remaining distance falls within one zip step plus this threshold.
 */
const GRAPPLE_ZIP_ARRIVAL_THRESHOLD_WORLD = 4.0;

/**
 * Tolerance (world units) used by the per-frame line-of-sight check between
 * the player and the grapple anchor during zip.  Wall hits whose distance to
 * the anchor is within this margin are treated as the anchor surface itself
 * (i.e. not an obstruction), preventing the LOS check from firing on the
 * final approach into the wall.  Sized to comfortably cover rounding error
 * and the player's AABB half-extents.
 */
const GRAPPLE_ZIP_LOS_TOLERANCE_WORLD = 8.0;

/**
 * Minimum distance (world units) required to record the zip direction as the
 * stuck velocity.  Below this value the direction is unreliable.
 */
const GRAPPLE_ZIP_MIN_DIST_WORLD = 1.0;

/**
 * Speed (world units/second) below which the player is considered fully stopped
 * while in the stuck phase.
 */
const GRAPPLE_STUCK_STOP_THRESHOLD_WORLD = 10.0;

/**
 * Per-tick velocity multiplier applied during the stuck deceleration phase.
 * 0.7 means the player loses ~30 % of their speed each tick — almost instantly.
 */
const GRAPPLE_STUCK_DECEL_FACTOR = 0.7;

/**
 * Ticks after coming to a complete stop during which a jump input fires a
 * high-velocity zip-jump in the surface normal direction.  At 60 fps,
 * 15 ticks = 0.25 seconds (¼ second).
 */
const GRAPPLE_ZIP_JUMP_WINDOW_TICKS = 15;

/**
 * Speed (world units/second) applied as a gentle hop-off impulse when the
 * zip-jump window expires without a jump input.  Equivalent to ~40 % of
 * normal jump speed — enough to peel the player off the surface but not a
 * powerful launch.
 */
const GRAPPLE_ZIP_HOP_OFF_SPEED_WORLD = PLAYER_JUMP_SPEED_WORLD * 0.4;

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

/**
 * Fires the grapple, setting the anchor at the exact raycast hit point on a
 * wall surface.  Returns without attaching if the wall is too close (less than
 * GRAPPLE_MIN_LENGTH_WORLD away) to prevent degenerate behaviour.
 * Activates the chain particles.
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
  if (world.hasGrappleChargeFlag === 0) return;

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
      if (world.isGrappleMissActiveFlag === 1) cancelGrappleMiss(world);
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
    // No wall hit. Cancel any pre-existing miss/retract animation, then start
    // a fresh miss throw from the current player position.
    if (world.isGrappleMissActiveFlag === 1) {
      cancelGrappleMiss(world);
    }
    startGrappleMiss(world, dirX, dirY);
    return;
  }

  // Bounce pad walls cannot be grappled — treat as a miss.
  if (hit.wallIndex >= 0 && world.wallIsBouncePadFlag[hit.wallIndex] === 1) {
    if (world.isGrappleMissActiveFlag === 1) {
      cancelGrappleMiss(world);
    }
    startGrappleMiss(world, dirX, dirY);
    return;
  }

  const hitDist = Math.sqrt((hit.x - player.positionXWorld) ** 2 + (hit.y - player.positionYWorld) ** 2);

  // ── Special proximity bounce ────────────────────────────────────────────────
  // If the player is within GRAPPLE_PROXIMITY_BOUNCE_THRESHOLD_WORLD (16 world
  // units = 2 small blocks) of the hit surface at the moment the grapple
  // fires, the hook acts as an instant surface-bounce rather than a rope attach.
  // The player is launched in the surface-normal direction (from anchor toward
  // player) at super-jump speed.  Works on any surface orientation: floor,
  // wall, or ceiling.
  if (hitDist > 0.01 && hitDist < GRAPPLE_PROXIMITY_BOUNCE_THRESHOLD_WORLD) {
    // Cancel any active miss/retract animation before the bounce.
    if (world.isGrappleMissActiveFlag === 1) {
      cancelGrappleMiss(world);
    }
    // Normal direction: from anchor (surface) toward player.
    const invHitDist = 1.0 / hitDist;
    const normalX = (player.positionXWorld - hit.x) * invHitDist;
    const normalY = (player.positionYWorld - hit.y) * invHitDist;
    // Apply super-jump speed in the surface-normal direction.
    const jumpSpeed = PLAYER_JUMP_SPEED_WORLD
      * ov(debugSpeedOverrides.grappleSuperJumpMultiplier, GRAPPLE_SUPER_JUMP_MULTIPLIER);
    player.velocityXWorld = normalX * jumpSpeed;
    player.velocityYWorld = normalY * jumpSpeed;
    player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
    player.varJumpSpeedWorld = player.velocityYWorld;
    player.isFastFallModeFlag = 0;
    // Sparkle FX at the anchor point.
    world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
    world.grappleAttachFxXWorld = hit.x;
    world.grappleAttachFxYWorld = hit.y;
    // Consume grapple charge (proximity bounce is a one-shot move, no recharge).
    world.hasGrappleChargeFlag = 0;
    // Reset the jump trigger so the same press isn't replayed.
    world.playerJumpTriggeredFlag = 0;
    // Stub sprite: show jumping sprite rotated toward the wall/ceiling for a
    // brief window after the bounce.  Floor bounces (normalY < 0) use no
    // rotation — only wall and ceiling bounces get the special orientation.
    // Always reset the state first so a floor bounce after a wall/ceiling bounce
    // doesn't leave a stale rotation active.
    world.grappleProximityBounceTicksLeft = 0;
    world.grappleProximityBounceRotationAngleRad = 0;
    if (Math.abs(normalY) > Math.abs(normalX)) {
      if (normalY > 0) {
        // Ceiling bounce — normal points downward; rotate 180° (upside-down).
        world.grappleProximityBounceRotationAngleRad = Math.PI;
        world.grappleProximityBounceTicksLeft = GRAPPLE_PROXIMITY_BOUNCE_SPRITE_TICKS;
      }
      // Floor bounce (normalY < 0): leave rotation at 0; jumping sprite looks correct.
    } else if (normalX !== 0) {
      if (normalX > 0) {
        // Left-wall bounce — normal points rightward; rotate -90° (CCW).
        world.grappleProximityBounceRotationAngleRad = -Math.PI / 2;
      } else {
        // Right-wall bounce — normal points leftward; rotate +90° (CW).
        world.grappleProximityBounceRotationAngleRad = Math.PI / 2;
      }
      world.grappleProximityBounceTicksLeft = GRAPPLE_PROXIMITY_BOUNCE_SPRITE_TICKS;
    }
    return;
  }

  // Don't attach when the wall is closer than the minimum rope length — doing
  // so would place the anchor inside the block geometry, which causes the
  // visible dot to appear embedded in the tile and produces erratic physics.
  if (hitDist < GRAPPLE_MIN_LENGTH_WORLD) return;

  // Confirmed wall hit — cancel any active miss/retract before attaching.
  if (world.isGrappleMissActiveFlag === 1) {
    cancelGrappleMiss(world);
  }

  const anchorX = hit.x;
  const anchorY = hit.y;
  const anchorDist = Math.sqrt((anchorX - player.positionXWorld) ** 2 + (anchorY - player.positionYWorld) ** 2);

  // Place the anchor exactly at the (potentially snapped) surface hit point.
  world.grappleAnchorXWorld = anchorX;
  world.grappleAnchorYWorld = anchorY;
  world.grappleLengthWorld  = anchorDist;
  world.grapplePullInAmountWorld = 0.0;  // reset pull-in counter for this new attachment
  world.grappleJumpHeldTickCount = 0;   // reset tap/hold tracker
  // Clear any pending jump trigger so that a jump press made on the same frame
  // as the grapple fire (e.g. jumping then immediately grappling) is not
  // misread as a tap-release by applyGrappleClusterConstraint on the very
  // first tick after attachment.
  world.playerJumpTriggeredFlag = 0;
  world.isGrappleActiveFlag = 1;
  world.isGrappleZipActiveFlag = 0;  // zip activated by double-tap down, not at fire time
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
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
 *
 * Grants the player coyote-time frames so they can still jump immediately
 * after releasing the grapple (e.g. letting go of the mouse button mid-swing).
 *
 * @param grantCoyoteTime  When true (default), sets the player's coyoteTimeTicks so
 *   a jump pressed in the next few frames still counts.  Pass false when the
 *   release is itself a jump (jump-off and stuck-jump paths) because those paths
 *   already apply an upward velocity impulse directly.
 */
export function releaseGrapple(world: WorldState, grantCoyoteTime = true): void {
  const shouldRetractFromActiveGrapple = world.isGrappleActiveFlag === 1;
  const shouldRetractFromMiss = world.isGrappleMissActiveFlag === 1;

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
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.grappleJumpHeldTickCount = 0;
  world.grapplePullInAmountWorld = 0.0;
  world.grappleOutOfRangeTicks = 0;
  world.grappleTensionFactor = 0;
  world.playerDownLastPressTick = 0; // reset double-tap state on release
  world.grappleRopeIndex = -1; // detach from rope segment (if any)

  if (shouldRetractFromActiveGrapple || shouldRetractFromMiss) {
    startGrappleRetract(world);
    return;
  }

  if (world.grappleParticleStartIndex >= 0) {
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      world.isAliveFlag[start + i] = 0;
    }
  }
}

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
 *   • Down double-tap → activate zip: player rockets toward the anchor,
 *     momentum stops on arrival, then a 0.25 s zip-jump window opens.
 *     Jump in window = high-velocity zip-jump in surface normal direction.
 *     Miss window = gentle hop off the surface.
 *     Double-tap + hold after arrival = stay stuck until jump or release.
 *
 * Pipeline per tick:
 *   1. Consume playerJumpTriggeredFlag and playerDownTriggeredFlag.
 *   2. Detect double-tap down → activate zip (isGrappleZipActiveFlag).
 *   3. If zip active → run zip/stuck/hop-off logic; skip normal swing.
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

  // ── Down double-tap detection (zip activation) ────────────────────────────
  // movement.ts preserves playerDownTriggeredFlag when grapple is active.
  // A double-tap is two rising-edge down presses within ZIP_DOUBLE_TAP_WINDOW_TICKS.
  // On double-tap: store the surface normal from anchor→player and activate zip.
  const downJustPressed = world.playerDownTriggeredFlag === 1;
  world.playerDownTriggeredFlag = 0; // consume

  if (downJustPressed && world.isGrappleZipActiveFlag === 0) {
    const ax = world.grappleAnchorXWorld;
    const ay = world.grappleAnchorYWorld;
    const currentTick = world.tick;
    const lastPressTick = world.playerDownLastPressTick;
    if (
      lastPressTick > 0 &&
      currentTick - lastPressTick <= GRAPPLE_ZIP_DOUBLE_TAP_WINDOW_TICKS
    ) {
      // Double-tap confirmed — activate zip!
      // Compute surface normal = normalized direction from anchor toward player.
      const dxToPlayer = player.positionXWorld - ax;
      const dyToPlayer = player.positionYWorld - ay;
      const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
      if (distToPlayer > 0.001) {
        world.grappleZipNormalXWorld = dxToPlayer / distToPlayer;
        world.grappleZipNormalYWorld = dyToPlayer / distToPlayer;
      } else {
        world.grappleZipNormalXWorld = 0.0;
        world.grappleZipNormalYWorld = -1.0; // default: floor normal (upward)
      }
      world.isGrappleZipActiveFlag = 1;
      world.isGrappleStuckFlag = 0;
      world.grappleStuckStoppedTickCount = 0;
      world.playerDownLastPressTick = 0; // reset so next press starts fresh
    } else {
      // First press — record tick for double-tap detection
      world.playerDownLastPressTick = currentTick;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Zip grapple — rocket toward anchor, stick, then zip-jump or hop off
  // ════════════════════════════════════════════════════════════════════════════
  if (world.isGrappleZipActiveFlag === 1) {
    const ax = world.grappleAnchorXWorld;
    const ay = world.grappleAnchorYWorld;
    const nx = world.grappleZipNormalXWorld;
    const ny = world.grappleZipNormalYWorld;

    // Arrival target: player center at anchor + surfaceNormal * halfExtent,
    // where halfExtent is the projection of the player's AABB half-extents
    // onto the surface normal (so the player touches the surface regardless
    // of approach angle: e.g. full halfHeight for a floor/ceiling, full
    // halfWidth for a wall, blended for diagonal normals).
    const halfExtent = Math.abs(nx) * player.halfWidthWorld
      + Math.abs(ny) * player.halfHeightWorld;
    const targetX = ax + nx * halfExtent;
    const targetY = ay + ny * halfExtent;

    // ── Jump input while zipping / stuck ──────────────────────────────────
    if (jumpJustPressed || (world.playerJumpHeldFlag === 1 && world.isGrappleStuckFlag === 1)) {
      const isInZipJumpWindow = world.isGrappleStuckFlag === 1 &&
        world.grappleStuckStoppedTickCount > 0 &&
        world.grappleStuckStoppedTickCount <= GRAPPLE_ZIP_JUMP_WINDOW_TICKS;
      const jumpMultiplier = isInZipJumpWindow
        ? ov(debugSpeedOverrides.grappleSuperJumpMultiplier, GRAPPLE_SUPER_JUMP_MULTIPLIER)
        : 1.0;
      const jumpSpeed = PLAYER_JUMP_SPEED_WORLD * jumpMultiplier;
      // Launch in surface normal direction (away from anchor).
      // Total speed magnitude = jumpSpeed because ||(nx,ny)|| = 1 (unit vector).
      // For ceiling zip: ny > 0 → propels downward.
      // For floor zip: ny < 0 → propels upward.
      // For wall zip: nx ≠ 0 → propels sideways.
      player.velocityXWorld = nx * jumpSpeed;
      player.velocityYWorld = ny * jumpSpeed;
      player.isGroundedFlag = 0;
      // Only sustain var jump when the launch has an upward component
      if (player.velocityYWorld < 0) {
        player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
        player.varJumpSpeedWorld = player.velocityYWorld;
      }
      releaseGrapple(world, false);
      return;
    }

    if (world.isGrappleStuckFlag === 0) {
      // ── Zip phase: move player toward anchor using swept AABB collision ────
      //
      // Why swept collision instead of direct position assignment:
      //   GRAPPLE_ZIP_SPEED_WORLD_PER_SEC (~480 wu/s) moves ~8 wu per tick at
      //   60 fps.  Direct position assignment can carry the player through thin
      //   walls (BLOCK_SIZE_SMALL = 3 wu) or into floor tiles in a single step.
      //   resolveClusterSolidWallCollision uses the same axis-separated sweep
      //   as normal movement, giving sub-tick safety and automatic wall/floor
      //   sliding at no extra cost.
      const dx = targetX - player.positionXWorld;
      const dy = targetY - player.positionYWorld;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const zipStep = GRAPPLE_ZIP_SPEED_WORLD_PER_SEC * dtSec;

      // ── Per-frame LOS check: stop zip if a wall now blocks the path ────────
      // Cast from the player position toward the grapple anchor.  If a wall is
      // hit well before the anchor (farther than GRAPPLE_ZIP_LOS_TOLERANCE_WORLD
      // from the anchor surface), the path is obstructed — continuing to zip
      // would pull the player through solid geometry.  Release the grapple
      // instead.  The anchor's own wall is excluded from the check by capping
      // the cast distance at anchorDist - LOS_TOLERANCE.
      {
        const dxToAnchor = world.grappleAnchorXWorld - player.positionXWorld;
        const dyToAnchor = world.grappleAnchorYWorld - player.positionYWorld;
        const anchorDist = Math.sqrt(dxToAnchor * dxToAnchor + dyToAnchor * dyToAnchor);
        const losCheckDist = anchorDist - GRAPPLE_ZIP_LOS_TOLERANCE_WORLD;
        if (losCheckDist > 1.0) {
          const invAD = 1.0 / anchorDist;
          const losHit = raycastWalls(
            world,
            player.positionXWorld, player.positionYWorld,
            dxToAnchor * invAD, dyToAnchor * invAD,
            losCheckDist,
          );
          if (losHit !== null) {
            // An intermediate wall blocks the direct line to the anchor.
            // Releasing the grapple here prevents the zip from dragging the
            // player through solid geometry.
            releaseGrapple(world);
            return;
          }
        }
      }

      if (dist <= zipStep + GRAPPLE_ZIP_ARRIVAL_THRESHOLD_WORLD) {
        // ── Arrival frame: swept movement toward target, then transition to stuck
        if (dist > GRAPPLE_ZIP_MIN_DIST_WORLD) {
          // Use swept collision even on the arrival frame to prevent floor/wall
          // clipping on diagonal approaches (e.g. zipping down into a corner).
          const invDist = 1.0 / dist;
          const oldX = player.positionXWorld;
          const oldY = player.positionYWorld;
          // Scale velocity so the integration moves exactly `dist` this tick.
          player.velocityXWorld = dx * invDist * (dist / dtSec);
          player.velocityYWorld = dy * invDist * (dist / dtSec);
          resolveClusterSolidWallCollision(player, world, oldX, oldY, dtSec, false);
          resolveClusterFloorCollision(player, world);
          // Restore full zip velocity for momentum-on-release and stuck decel.
          player.velocityXWorld = dx * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
          player.velocityYWorld = dy * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
        }
        world.isGrappleStuckFlag = 1;
        world.grappleStuckStoppedTickCount = 0;
      } else {
        // ── Normal zip frame: move at full speed with swept collision ─────────
        // resolveClusterSolidWallCollision zeroes velocity on the contact axis,
        // so if the player hits a wall the perpendicular component continues —
        // giving natural sliding behavior with no extra code.
        const invDist = 1.0 / dist;
        const oldX = player.positionXWorld;
        const oldY = player.positionYWorld;
        player.velocityXWorld = dx * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
        player.velocityYWorld = dy * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
        resolveClusterSolidWallCollision(player, world, oldX, oldY, dtSec, false);
        resolveClusterFloorCollision(player, world);
        // Velocity after collision correctly reflects the post-contact direction
        // (zeroed on the blocked axis, preserved on the unblocked axis).
      }
    }

    if (world.isGrappleStuckFlag === 1) {
      // ── Stuck phase: lock position, decelerate, then hop off if window expired
      player.positionXWorld = targetX;
      player.positionYWorld = targetY;

      // Safety pass: ensure the locked position is outside all solid walls.
      // The stuck target is always geometrically safe (it is the player AABB
      // resting against the anchor surface with halfExtent clearance), but a
      // final penetration resolve catches any residual overlap from ramps or
      // stacked geometry near the anchor.  We resolve all overlapping walls
      // rather than stopping at the first, since the player AABB can overlap
      // multiple walls simultaneously near stacked geometry.
      {
        const halfW = player.halfWidthWorld;
        const halfH = player.halfHeightWorld;
        for (let wi = 0; wi < world.wallCount; wi++) {
          const wLeft   = world.wallXWorld[wi];
          const wTop    = world.wallYWorld[wi];
          const wRight  = wLeft + world.wallWWorld[wi];
          const wBottom = wTop + world.wallHWorld[wi];
          resolveAABBPenetration(player, halfW, halfH, wLeft, wTop, wRight, wBottom);
        }
      }

      const speed = Math.sqrt(
        player.velocityXWorld * player.velocityXWorld +
        player.velocityYWorld * player.velocityYWorld,
      );

      if (speed <= GRAPPLE_STUCK_STOP_THRESHOLD_WORLD) {
        // Fully stopped — start/continue zip-jump window countdown
        player.velocityXWorld = 0;
        player.velocityYWorld = 0;
        world.grappleStuckStoppedTickCount++;

        // Auto hop-off after zip-jump window expires.
        // The normal vector (nx, ny) points from the anchor toward the player's
        // arrival position (away from the surface), so multiplying by a positive
        // speed peels the player off in the correct direction:
        //   floor zip (ny < 0 = upward)   → player pushed up
        //   ceiling zip (ny > 0 = down)   → player drops away
        //   wall zip (nx ≠ 0 = sideways)  → player pushed away from wall
        if (world.grappleStuckStoppedTickCount > GRAPPLE_ZIP_JUMP_WINDOW_TICKS) {
          player.velocityXWorld = nx * GRAPPLE_ZIP_HOP_OFF_SPEED_WORLD;
          player.velocityYWorld = ny * GRAPPLE_ZIP_HOP_OFF_SPEED_WORLD;
          player.isFastFallModeFlag = 0;
          releaseGrapple(world, false);
          return;
        }
      } else {
        // Still decelerating — heavy friction to stop quickly
        player.velocityXWorld *= GRAPPLE_STUCK_DECEL_FACTOR;
        player.velocityYWorld *= GRAPPLE_STUCK_DECEL_FACTOR;

        // Spawn skid debris while decelerating for dramatic effect
        world.isPlayerSkiddingFlag = 1;
        world.skidDebrisXWorld = player.positionXWorld;
        world.skidDebrisYWorld = player.positionYWorld + player.halfHeightWorld;
      }
    }

    return; // skip normal pendulum physics
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Normal grapple — pendulum swing
  // ════════════════════════════════════════════════════════════════════════════

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
  const ax = world.grappleAnchorXWorld;
  const ay = world.grappleAnchorYWorld;
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
  if (world.playerCrouchHeldFlag === 1) {
    const pullThisTick = GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC * dtSec;
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
        player.velocityXWorld = vRadial * nx + vTangX * ratio;
        player.velocityYWorld = vRadial * ny + vTangY * ratio;

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
    // The helper restores the caller's velocity, so the radial-removal below
    // still acts on the correct swing momentum.
    moveClusterByDelta(player, world, deltaX, deltaY, false, dtSec);

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

// ── Rope segment grapple support ─────────────────────────────────────────────

/** Small epsilon for rope-segment raycast distance comparisons. */
const ROPE_RAYCAST_EPSILON = 0.001;

interface RopeHitResult {
  /** World X of the hit point on the rope capsule surface. */
  hitX: number;
  /** World Y of the hit point on the rope capsule surface. */
  hitY: number;
  /** Travel distance from ray origin to hit point. */
  distWorld: number;
  /** Index of the rope that was hit. */
  ropeIndex: number;
  /** Float segment index (e.g. 2.7 = 70 % along segment 2→3). */
  segF: number;
}

/**
 * Casts a ray from (ox, oy) in direction (dirX, dirY) and tests it against
 * all rope capsule chains.  Returns the nearest hit within maxDist, or null.
 *
 * Each rope segment is modelled as a capsule (cylinder with hemispherical caps)
 * of radius ropeHalfThickWorld.  The 2D ray-vs-capsule test used here is:
 *   1. Ray vs. infinite cylinder (line segment) → two potential entry/exit t values.
 *   2. Clamp t to [0, 1] along the segment and keep the closest entry.
 *   3. Take the minimum across all segments.
 */
export function raycastRopeSegments(
  world: WorldState,
  ox: number,
  oy: number,
  dirX: number,
  dirY: number,
  maxDist: number,
): RopeHitResult | null {
  let bestDist = maxDist;
  let bestResult: RopeHitResult | null = null;

  for (let r = 0; r < world.ropeCount; r++) {
    const segCount = world.ropeSegmentCount[r];
    if (segCount < 2) continue;
    const halfThick = world.ropeHalfThickWorld[r];
    const base = r * MAX_ROPE_SEGMENTS;

    for (let s = 0; s < segCount - 1; s++) {
      const ax = world.ropeSegPosXWorld[base + s];
      const ay = world.ropeSegPosYWorld[base + s];
      const bx = world.ropeSegPosXWorld[base + s + 1];
      const by = world.ropeSegPosYWorld[base + s + 1];

      // 2D ray-vs-capsule algorithm:
      //   1. Find the point P* on segment [A, B] closest to the ray origin,
      //      parameterised as t_seg ∈ [0,1]: P* = A + t_seg·S.
      //   2. Express P* in ray-relative coordinates: cp = P* - O.
      //   3. Decompose cp into a radial component along the ray direction and a
      //      perpendicular component.  The perpendicular distance is the minimum
      //      distance from the ray to the capsule axis at P*.
      //   4. If perpDist < R (capsule radius), compute the entry t along the ray
      //      using the standard circle-intersection formula: tEntry = cpDotDir - √(R²-perpDist²).
      // This gives a tight capsule hit without building a full swept-volume test.
      const segDx = bx - ax;
      const segDy = by - ay;
      const rdx = ox - ax;
      const rdy = oy - ay;

      // Closest point on ray to closest point on segment.
      const segLenSq = segDx * segDx + segDy * segDy;
      if (segLenSq < ROPE_RAYCAST_EPSILON) continue;

      // Step 1: t_seg — closest point on the segment to the ray origin.
      const t_seg = Math.max(0.0, Math.min(1.0,
        (rdx * segDx + rdy * segDy) / segLenSq,
      ));
      // cp = P* - O (P* in ray-relative coords)
      const cpx = ax + t_seg * segDx - ox;
      const cpy = ay + t_seg * segDy - oy;

      // Step 2–3: project cp onto ray direction; compute perpendicular distance.
      const cpDotDir = cpx * dirX + cpy * dirY;
      const perpX = cpx - cpDotDir * dirX;
      const perpY = cpy - cpDotDir * dirY;
      const perpDistSq = perpX * perpX + perpY * perpY;

      if (perpDistSq > halfThick * halfThick) continue;

      // Step 4: entry t along ray.
      const offset = Math.sqrt(halfThick * halfThick - perpDistSq);
      const tEntry = cpDotDir - offset;

      if (tEntry < ROPE_RAYCAST_EPSILON || tEntry >= bestDist) continue;

      // Valid hit
      bestDist = tEntry;
      bestResult = {
        hitX:       ox + dirX * tEntry,
        hitY:       oy + dirY * tEntry,
        distWorld:  tEntry,
        ropeIndex:  r,
        segF:       s + t_seg,
      };
    }
  }

  return bestResult;
}

/**
 * Updates the grapple anchor world position from the moving rope segment it is
 * attached to.  Called once per tick (after tickRopes) when grappleRopeIndex >= 0.
 *
 * This keeps the grapple anchor point moving with the rope as it sways,
 * so the player swings naturally from the dynamic rope segment position.
 */
export function updateGrappleRopeAnchor(world: WorldState): void {
  if (world.grappleRopeIndex < 0) return;
  if (world.isGrappleActiveFlag === 0) {
    world.grappleRopeIndex = -1;
    return;
  }

  const r = world.grappleRopeIndex;
  if (r >= world.ropeCount) {
    world.grappleRopeIndex = -1;
    return;
  }

  const segCount = world.ropeSegmentCount[r];
  const base = r * MAX_ROPE_SEGMENTS;
  const segF = world.grappleRopeAttachSegF;
  const si = Math.min(Math.floor(segF), segCount - 2);
  const frac = segF - si;

  const ax = world.ropeSegPosXWorld[base + si];
  const ay = world.ropeSegPosYWorld[base + si];
  const bx = world.ropeSegPosXWorld[base + si + 1];
  const by = world.ropeSegPosYWorld[base + si + 1];

  world.grappleAnchorXWorld = ax + (bx - ax) * frac;
  world.grappleAnchorYWorld = ay + (by - ay) * frac;
}

