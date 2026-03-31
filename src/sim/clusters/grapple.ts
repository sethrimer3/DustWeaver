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
 * 4. Tap Jump vs Hold Jump Detection
 *    While the grapple is active, the jump button has dual purpose:
 *      • Tap  (press + release within GRAPPLE_JUMP_TAP_THRESHOLD_TICKS) →
 *        instantly release the grapple.  The player flies off with exactly
 *        the velocity they had at the instant of release.
 *      • Hold (held beyond the threshold) → retract the rope, building
 *        angular speed via conservation of angular momentum.
 *    Retraction begins immediately (no delay), so the hold feels responsive.
 *    If the player releases within the tap window, the tiny amount of
 *    retraction that occurred (~7 px) is imperceptible.
 *    An ultra-fast tap (pressed and released within a single frame) is
 *    detected via the playerJumpTriggeredFlag and triggers an immediate release.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The grapple attaches an inextensible rope from the player cluster to a fixed
 * world-space anchor point. Each tick two operations are performed:
 *
 *   applyGrappleClusterConstraint  (step 0.25, after cluster movement)
 *     • Detects tap-vs-hold jump input and either releases or retracts.
 *     • On retraction, conserves angular momentum (tangential speed × radius).
 *     • Enforces the rope length: snaps the player back onto the rope circle
 *       and removes the outward radial velocity component.
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
import { INFLUENCE_RADIUS_WORLD } from './binding';

// ============================================================================
// Tuning constants — adjust these to dial in the grapple feel
// ============================================================================

/** Maximum rope length the player can shoot (world units) — matches the zone of influence radius. */
export const GRAPPLE_MAX_LENGTH_WORLD = INFLUENCE_RADIUS_WORLD;

/** Minimum rope length to prevent degenerate zero-length ropes. */
const GRAPPLE_MIN_LENGTH_WORLD = 20;

/** Duration of the sparkle burst effect on attach (ticks). */
const GRAPPLE_ATTACH_FX_TICKS = 14;

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
 * Number of ticks the jump button can be held before it is considered a "hold"
 * rather than a "tap".  At 60 fps, 6 ticks ≈ 100 ms — fast enough to feel
 * instant as a tap, long enough to reliably distinguish from a deliberate hold.
 */
const GRAPPLE_JUMP_TAP_THRESHOLD_TICKS = 6;

/**
 * Upward velocity impulse (world units/second) added to the player when they
 * tap-release the grapple.  Gives a small "hop" on release so the player can
 * pop off ledges or continue upward momentum after a swing.
 * Applied by *subtracting* from velocityYWorld — negative Y is upward in this
 * coordinate system (Y increases downward on screen).
 */
const GRAPPLE_TAP_HOP_SPEED_WORLD = 53.0;

/** Number of Gold particles that form the visible chain between player and anchor. */
export const GRAPPLE_SEGMENT_COUNT = 10;

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
 * Player jump speed (world units/sec, applied upward = negated).
 * Must stay in sync with PLAYER_JUMP_SPEED_WORLD in movement.ts.
 */
const GRAPPLE_PLAYER_JUMP_SPEED_WORLD = 300.0;

/**
 * Variable-jump sustain window in ticks.
 * Must stay in sync with VAR_JUMP_TIME_TICKS in movement.ts.
 */
const GRAPPLE_VAR_JUMP_TIME_TICKS = 12;

/**
 * Behavior mode value used for grapple chain particles.
 * Binding forces (binding.ts) already skip any particle whose behaviorMode !== 0,
 * so this non-standard value prevents chain particles from being pulled toward
 * their owner anchor — the grapple system overrides their positions directly.
 */
const BEHAVIOR_MODE_GRAPPLE_CHAIN = 3;

interface RayHit {
  t: number;
  x: number;
  y: number;
}

function raycastWalls(world: WorldState, ox: number, oy: number, dx: number, dy: number, maxDist: number): RayHit | null {
  let bestT = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestY = 0;

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
    }
  }

  return Number.isFinite(bestT) ? { t: bestT, x: bestX, y: bestY } : null;
}

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
 * Returns true if the given hit point is on the top surface of any wall.
 * Used to detect when the grapple attaches to a horizontal ledge.
 */
function isTopSurfaceHit(world: WorldState, hitX: number, hitY: number): boolean {
  const eps = 0.5;
  for (let wi = 0; wi < world.wallCount; wi++) {
    const topY = world.wallYWorld[wi];
    const leftX = world.wallXWorld[wi];
    const rightX = leftX + world.wallWWorld[wi];
    if (Math.abs(hitY - topY) < eps && hitX >= leftX - eps && hitX <= rightX + eps) {
      return true;
    }
  }
  return false;
}

/**
 * Fires the grapple, setting the anchor at the exact raycast hit point on a
 * wall surface.  Returns without attaching if the wall is too close (less than
 * GRAPPLE_MIN_LENGTH_WORLD away) to prevent degenerate behaviour.
 * Activates the chain particles.
 */
export function fireGrapple(world: WorldState, anchorXWorld: number, anchorYWorld: number): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;

  // Cancel any active miss animation
  if (world.isGrappleMissActiveFlag === 1) {
    cancelGrappleMiss(world);
  }

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
    // No wall hit — start the miss animation.
    // Chain extends to full influence radius, then falls limp.
    startGrappleMiss(world, dirX, dirY);
    return;
  }

  const hitDist = Math.sqrt((hit.x - player.positionXWorld) ** 2 + (hit.y - player.positionYWorld) ** 2);

  // Don't attach when the wall is closer than the minimum rope length — doing
  // so would place the anchor inside the block geometry, which causes the
  // visible dot to appear embedded in the tile and produces erratic physics.
  if (hitDist < GRAPPLE_MIN_LENGTH_WORLD) return;

  // Place the anchor exactly at the raycast surface hit point.
  world.grappleAnchorXWorld = hit.x;
  world.grappleAnchorYWorld = hit.y;
  world.grappleLengthWorld  = hitDist;
  world.grapplePullInAmountWorld = 0.0;  // reset pull-in counter for this new attachment
  world.grappleJumpHeldTickCount = 0;   // reset tap/hold tracker
  // Clear any pending jump trigger so that a jump press made on the same frame
  // as the grapple fire (e.g. jumping then immediately grappling) is not
  // misread as a tap-release by applyGrappleClusterConstraint on the very
  // first tick after attachment.
  world.playerJumpTriggeredFlag = 0;
  world.isGrappleActiveFlag = 1;
  world.isGrappleTopSurfaceFlag = isTopSurfaceHit(world, hit.x, hit.y) ? 1 : 0;
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
  world.grappleAttachFxXWorld = world.grappleAnchorXWorld;
  world.grappleAttachFxYWorld = world.grappleAnchorYWorld;

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
  world.isGrappleTopSurfaceFlag = 0;
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.grappleJumpHeldTickCount = 0;

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
 * Pipeline per tick:
 *   1. Consume playerJumpTriggeredFlag (movement.ts preserves it when grappling).
 *   2. Detect ultra-fast tap (triggered + not held) → immediate release.
 *   3. Track jump hold duration for tap-vs-hold detection.
 *   4. On jump release within tap window → release grapple.
 *   5. While jump held (retraction):
 *      a. Decompose velocity into radial + tangential components.
 *      b. Shorten the rope.
 *      c. Scale tangential velocity by (oldLength / newLength) to conserve
 *         angular momentum.
 *      d. Recompose velocity from radial + boosted tangential.
 *   6. Enforce rope length: if player distance > ropeLength, snap position
 *      onto the rope circle and remove the outward radial velocity component.
 *   7. Apply subtle tangential damping (air resistance / friction).
 */
export function applyGrappleClusterConstraint(world: WorldState): void {
  if (world.isGrappleActiveFlag === 0) return;

  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    releaseGrapple(world);
    return;
  }

  const dtSec = world.dtMs / 1000.0;

  // ── Tap / hold jump detection ─────────────────────────────────────────────
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
      const jumpSpeed = GRAPPLE_PLAYER_JUMP_SPEED_WORLD *
        (hasSuperJump ? GRAPPLE_STUCK_SUPER_JUMP_MULTIPLIER : 1.0);
      player.velocityYWorld = -jumpSpeed;
      player.isGroundedFlag = 0;
      player.varJumpTimerTicks = GRAPPLE_VAR_JUMP_TIME_TICKS;
      player.varJumpSpeedWorld = -jumpSpeed;
      releaseGrapple(world);
      return;
    }

    if (world.isGrappleStuckFlag === 0) {
      // ── Zip phase: move player toward anchor at 3× sprint speed ────────
      const dx = targetX - player.positionXWorld;
      const dy = targetY - player.positionYWorld;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const zipStep = GRAPPLE_ZIP_SPEED_WORLD_PER_SEC * dtSec;

      if (dist <= zipStep + 1.0) {
        // Arrived — snap to target and transition to stuck
        player.positionXWorld = targetX;
        player.positionYWorld = targetY;
        // Preserve zip direction as velocity (for skid effect / release momentum)
        if (dist > 0.01) {
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

  // Ultra-fast tap: pressed and released within a single frame (both keydown
  // and keyup fired between two ticks).  The triggered flag is set but the
  // held flag is already false.
  if (jumpJustPressed && world.playerJumpHeldFlag === 0) {
    // Give the player a small upward "hop" on release so they can pop off
    // surfaces or continue upward momentum out of a swing.
    player.velocityYWorld -= GRAPPLE_TAP_HOP_SPEED_WORLD;
    releaseGrapple(world);
    return;
  }

  if (world.playerJumpHeldFlag === 1) {
    // Jump is currently held — increment the hold counter.
    // Retraction begins immediately so the hold feels responsive; if the
    // player releases within the tap window the tiny retraction is imperceptible.
    world.grappleJumpHeldTickCount++;
  } else if (world.grappleJumpHeldTickCount > 0) {
    // Jump was just released.  If the hold was short enough → tap → release.
    if (world.grappleJumpHeldTickCount <= GRAPPLE_JUMP_TAP_THRESHOLD_TICKS) {
      world.grappleJumpHeldTickCount = 0;
      // Give the player a small upward "hop" on release.
      player.velocityYWorld -= GRAPPLE_TAP_HOP_SPEED_WORLD;
      releaseGrapple(world);
      return;
    }
    // Long hold ended — stop retracting but stay attached.
    world.grappleJumpHeldTickCount = 0;
  }

  // ── Compute radial direction from anchor to player ────────────────────────
  const ax = world.grappleAnchorXWorld;
  const ay = world.grappleAnchorYWorld;
  const dx = player.positionXWorld - ax;
  const dy = player.positionYWorld - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1.0) return; // degenerate — player at anchor point

  const invDist = 1.0 / dist;
  // Unit vector pointing from anchor toward player (outward / radial direction)
  const nx = dx * invDist;
  const ny = dy * invDist;

  // ── Rope retraction (hold jump) ───────────────────────────────────────────
  // While the jump button is held the rope shortens, and angular momentum is
  // conserved: v_tangential_new = v_tangential_old × (L_old / L_new).
  // This is why figure skaters spin faster when they pull their arms in.
  if (world.playerJumpHeldFlag === 1) {
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

// ============================================================================
// Grapple miss — limp chain physics
// ============================================================================

/**
 * Speed at which the grapple chain extends outward when fired (world units/sec).
 * Slightly slower than the max range to give a visible "throw" animation.
 */
const GRAPPLE_MISS_EXTEND_SPEED_WORLD_PER_SEC = 400.0;

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

function startGrappleMiss(world: WorldState, dirX: number, dirY: number): void {
  const player = world.clusters[0];
  if (player === undefined) return;
  if (world.grappleParticleStartIndex < 0) return;

  world.isGrappleMissActiveFlag = 1;
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
  }
}

function cancelGrappleMiss(world: WorldState): void {
  world.isGrappleMissActiveFlag = 0;
  world.grappleMissTickCount = 0;
  if (world.grappleParticleStartIndex >= 0) {
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      world.isAliveFlag[start + i] = 0;
    }
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

  // ── Integrate link physics ────────────────────────────────────────────────
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
            // Attach grapple at this point
            world.grappleAnchorXWorld = missLinkX[i];
            world.grappleAnchorYWorld = missLinkY[i];
            world.grappleLengthWorld = hitDist;
            world.grapplePullInAmountWorld = 0.0;
            world.grappleJumpHeldTickCount = 0;
            world.playerJumpTriggeredFlag = 0;
            world.isGrappleActiveFlag = 1;
            world.isGrappleMissActiveFlag = 0;
            world.grappleMissTickCount = 0;
            world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
            world.grappleAttachFxXWorld = missLinkX[i];
            world.grappleAttachFxYWorld = missLinkY[i];
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
  }

  // ── Enforce link connectivity ─────────────────────────────────────────────
  // Each link must stay within max distance of its neighbor.
  // Link 0 is connected to the player, link N to link N-1.
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
      // Anchor point: player position for first link, previous link for others
      const anchorX = i === 0 ? player.positionXWorld : missLinkX[i - 1];
      const anchorY = i === 0 ? player.positionYWorld : missLinkY[i - 1];

      const ddx = missLinkX[i] - anchorX;
      const ddy = missLinkY[i] - anchorY;
      const linkDist = Math.sqrt(ddx * ddx + ddy * ddy);

      if (linkDist > GRAPPLE_MISS_LINK_MAX_DIST_WORLD && linkDist > 0.01) {
        const excess = linkDist - GRAPPLE_MISS_LINK_MAX_DIST_WORLD;
        const nx = ddx / linkDist;
        const ny = ddy / linkDist;

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

  // ── Write positions to particle buffer ────────────────────────────────────
  const start = world.grappleParticleStartIndex;
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const idx = start + i;
    world.positionXWorld[idx] = missLinkX[i];
    world.positionYWorld[idx] = missLinkY[i];
    world.velocityXWorld[idx] = 0.0;
    world.velocityYWorld[idx] = 0.0;
    world.forceX[idx] = 0.0;
    world.forceY[idx] = 0.0;
  }
}
