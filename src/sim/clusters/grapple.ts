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
import { PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS } from './movement';
import { COYOTE_TIME_TICKS } from './movementConstants';
import { resolveAABBPenetration } from '../physics/collision';
import {
  GRAPPLE_MAX_LENGTH_WORLD,
  GRAPPLE_SEGMENT_COUNT,
  GRAPPLE_ATTACH_FX_TICKS,
  BEHAVIOR_MODE_GRAPPLE_CHAIN,
  GRAPPLE_CHAIN_LIFETIME_TICKS,
  raycastWalls,
  isSpecialZipGrapple,
  startGrappleMiss,
  cancelGrappleMiss,
  startGrappleRetract,
} from './grappleMiss';

// ============================================================================
// Tuning constants — adjust these to dial in the grapple feel
// ============================================================================

/** Minimum rope length to prevent degenerate zero-length ropes. */
const GRAPPLE_MIN_LENGTH_WORLD = 20;

/**
 * Speed at which the rope shortens while the jump button is held (world units per second).
 * Shorter rope = tighter swing radius = faster rotation = bigger launch when released.
 */
const GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC = 60.0;

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

/** Number of Gold particles that form the visible chain between player and anchor. */

// ── Top-surface grapple (zip + stick) ────────────────────────────────────────

/**
 * Speed at which the player zips toward a top-surface grapple anchor.
 * 3× the player's top sprint speed: MAX_RUN_SPEED(105) × SPRINT(1.5) × 3.
 */
const GRAPPLE_ZIP_SPEED_WORLD_PER_SEC = 472.5;

/**
 * Per-tick velocity multiplier while grapple-stuck, applied multiplicatively.
 * 0.05 = 95% speed loss each tick — almost instant stop in 2–3 frames.
 */
const GRAPPLE_STUCK_DECEL_FACTOR = 0.05;

/** Speed threshold (world units/sec) below which a stuck player is considered fully stopped. */
const GRAPPLE_STUCK_STOP_THRESHOLD_WORLD = 1.0;

/**
 * Ticks after coming to a full stop while grapple-stuck during which a jump
 * receives 100% extra vertical height (super jump).
 */
const GRAPPLE_STUCK_SUPER_JUMP_WINDOW_TICKS = 10;

/** Jump speed multiplier for the super jump (2× = 100% extra height). */
const GRAPPLE_STUCK_SUPER_JUMP_MULTIPLIER = 2.0;

/**
 * Distance threshold (world units) within which the player is considered to
 * have arrived at the zip destination.  Prevents overshooting the target on
 * the final tick when the remaining distance is smaller than the zip step.
 */
const GRAPPLE_ZIP_ARRIVAL_THRESHOLD_WORLD = 1.0;

/**
 * Minimum distance (world units) for computing a normalized direction toward
 * the zip target.  Prevents division-by-near-zero when the player is
 * essentially on top of the anchor.
 */
const GRAPPLE_ZIP_MIN_DIST_WORLD = 0.01;



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
  const maxCastDist = Math.min(dist, GRAPPLE_MAX_LENGTH_WORLD);
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

  const hitDist = Math.sqrt((hit.x - player.positionXWorld) ** 2 + (hit.y - player.positionYWorld) ** 2);

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
  const isSpecialTopHit = isSpecialZipGrapple(world, player, anchorX, anchorY);

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
  world.isGrappleTopSurfaceFlag = isSpecialTopHit ? 1 : 0;
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
  world.grappleAttachFxXWorld = anchorX;
  world.grappleAttachFxYWorld = anchorY;

  // Consume grapple charge. Top-surface grapples instantly refresh the charge
  // so the player can chain grapple between ledges.
  if (isSpecialTopHit) {
    world.hasGrappleChargeFlag = 1;
  } else {
    world.hasGrappleChargeFlag = 0;
  }

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
  world.isGrappleTopSurfaceFlag = 0;
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.grappleJumpHeldTickCount = 0;
  world.grapplePullInAmountWorld = 0.0;

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
 *
 * Pipeline per tick:
 *   1. Consume playerJumpTriggeredFlag (movement.ts preserves it when grappling).
 *   2. If jump pressed → release grapple with upward impulse.
 *   3. While down held (retraction):
 *      a. Decompose velocity into radial + tangential components.
 *      b. Shorten the rope.
 *      c. Scale tangential velocity by (oldLength / newLength) to conserve
 *         angular momentum.
 *      d. Recompose velocity from radial + boosted tangential.
 *   4. Enforce rope length: if player distance > ropeLength, snap position
 *      onto the rope circle and remove the outward radial velocity component.
 *   5. Post-constraint wall collision check to prevent ground clipping.
 *   6. Apply subtle tangential damping (air resistance / friction).
 */
export function applyGrappleClusterConstraint(world: WorldState): void {
  if (world.isGrappleActiveFlag === 0) return;

  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    releaseGrapple(world);
    return;
  }

  const dtSec = world.dtMs / 1000.0;

  // ── Jump input: release grapple with upward impulse ───────────────────────
  // movement.ts preserves playerJumpTriggeredFlag when grapple is active so we
  // can detect the rising edge of a jump press here.
  const jumpJustPressed = world.playerJumpTriggeredFlag === 1;
  world.playerJumpTriggeredFlag = 0; // consume — grapple owns the flag while active

  // ════════════════════════════════════════════════════════════════════════════
  // Top-surface grapple — zip toward anchor then stick
  // ════════════════════════════════════════════════════════════════════════════
  if (world.isGrappleTopSurfaceFlag === 1) {
    const ax = world.grappleAnchorXWorld;
    const ay = world.grappleAnchorYWorld;
    // Target position: player center such that feet rest on the wall surface.
    const targetX = ax;
    const targetY = ay - player.halfHeightWorld;

    // ── Jump input while in top-surface mode ──────────────────────────────
    // Any jump press releases the grapple and launches the player upward.
    // If the player has recently stopped while stuck, they receive 100% extra
    // jump height (super jump).
    if (jumpJustPressed || (world.playerJumpHeldFlag === 1 && world.isGrappleStuckFlag === 1)) {
      const hasSuperJump = world.isGrappleStuckFlag === 1 &&
        world.grappleStuckStoppedTickCount > 0 &&
        world.grappleStuckStoppedTickCount <= GRAPPLE_STUCK_SUPER_JUMP_WINDOW_TICKS;
      const jumpSpeed = PLAYER_JUMP_SPEED_WORLD *
        (hasSuperJump ? GRAPPLE_STUCK_SUPER_JUMP_MULTIPLIER : 1.0);
      player.velocityYWorld = -jumpSpeed;
      player.isGroundedFlag = 0;
      player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
      player.varJumpSpeedWorld = -jumpSpeed;
      releaseGrapple(world, false);
      return;
    }

    if (world.isGrappleStuckFlag === 0) {
      // ── Zip phase: move player toward anchor at 3× sprint speed ────────
      const dx = targetX - player.positionXWorld;
      const dy = targetY - player.positionYWorld;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const zipStep = GRAPPLE_ZIP_SPEED_WORLD_PER_SEC * dtSec;

      if (dist <= zipStep + GRAPPLE_ZIP_ARRIVAL_THRESHOLD_WORLD) {
        // Arrived — snap to target and transition to stuck
        player.positionXWorld = targetX;
        player.positionYWorld = targetY;
        // Preserve zip direction as velocity (for skid effect / release momentum)
        if (dist > GRAPPLE_ZIP_MIN_DIST_WORLD) {
          const nd = 1.0 / dist;
          player.velocityXWorld = dx * nd * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
          player.velocityYWorld = dy * nd * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
        }
        world.isGrappleStuckFlag = 1;
        world.grappleStuckStoppedTickCount = 0;
      } else {
        // Move toward anchor
        const nd = 1.0 / dist;
        const ndx = dx * nd;
        const ndy = dy * nd;
        player.positionXWorld += ndx * zipStep;
        player.positionYWorld += ndy * zipStep;
        player.velocityXWorld = ndx * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
        player.velocityYWorld = ndy * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
      }
    }

    if (world.isGrappleStuckFlag === 1) {
      // ── Stuck phase: lock position, decelerate rapidly, spawn skid debris ─
      player.positionXWorld = targetX;
      player.positionYWorld = targetY;

      const speed = Math.sqrt(
        player.velocityXWorld * player.velocityXWorld +
        player.velocityYWorld * player.velocityYWorld,
      );

      if (speed <= GRAPPLE_STUCK_STOP_THRESHOLD_WORLD) {
        // Fully stopped
        player.velocityXWorld = 0;
        player.velocityYWorld = 0;
        world.grappleStuckStoppedTickCount++;
      } else {
        // Heavy deceleration — almost instantly lose most speed
        player.velocityXWorld *= GRAPPLE_STUCK_DECEL_FACTOR;
        player.velocityYWorld *= GRAPPLE_STUCK_DECEL_FACTOR;

        // Set skid debris flags for the renderer (large burst of debris)
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
    // If newLength equals GRAPPLE_MIN_LENGTH_WORLD the rope is at minimum — no more pull.
  }

  // ── Enforce rope length constraint ────────────────────────────────────────
  // If the player has drifted beyond the current rope length (due to gravity,
  // movement, or the rope shortening around them), snap their position back
  // onto the rope circle and remove the outward radial velocity component.
  // The tangential (swing) component is fully preserved — this is what makes
  // the pendulum feel physical rather than scripted.
  const ropeLength = world.grappleLengthWorld;

  if (dist > ropeLength) {
    // 1. Snap player position back onto the rope circle
    player.positionXWorld = ax + nx * ropeLength;
    player.positionYWorld = ay + ny * ropeLength;

    // 2. Remove outward velocity component (rope can only pull — never push)
    const velDotN = player.velocityXWorld * nx + player.velocityYWorld * ny;
    if (velDotN > 0) {
      player.velocityXWorld -= velDotN * nx;
      player.velocityYWorld -= velDotN * ny;
    }
  }

  // ── Post-constraint wall collision (last-resort fallback) ──────────────────
  // The primary collision resolver is the axis-separated sweep in movement.ts
  // (step 0).  This minimum-penetration push-out is a *fallback safety net*
  // that only fires when the rope constraint (above) re-introduces a small
  // overlap — typically when the anchor is on a nearby floor and the rope pulls
  // the player downward into geometry.  Because the overlap is always small
  // (≤ one tick of rope correction) and velocities are low at this point,
  // minimum-penetration is acceptable here.  The axis-separated sweep is not
  // re-run because it would require re-doing the full X-then-Y integration
  // pass, which is disproportionate to the tiny correction needed.
  {
    const halfW = player.halfWidthWorld;
    const halfH = player.halfHeightWorld;
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wLeft   = world.wallXWorld[wi];
      const wTop    = world.wallYWorld[wi];
      const wRight  = wLeft + world.wallWWorld[wi];
      const wBottom = wTop + world.wallHWorld[wi];
      if (resolveAABBPenetration(player, halfW, halfH, wLeft, wTop, wRight, wBottom)) {
        break; // resolve one wall per tick — sufficient for the grapple correction
      }
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

