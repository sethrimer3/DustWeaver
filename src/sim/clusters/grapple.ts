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
import { INFLUENCE_RADIUS_WORLD } from './binding';
import { PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS } from './movement';

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
 * Upward velocity impulse (world units/second) added to the player when they
 * press jump to release the grapple.  This is a "jump off the rope" that adds
 * upward momentum to whatever swing velocity the player has.
 * Applied by *subtracting* from velocityYWorld — negative Y is upward.
 */
const GRAPPLE_JUMP_OFF_SPEED_WORLD = PLAYER_JUMP_SPEED_WORLD;

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
 * Behavior mode value used for grapple chain particles.
 * Binding forces (binding.ts) already skip any particle whose behaviorMode !== 0,
 * so this non-standard value prevents chain particles from being pulled toward
 * their owner anchor — the grapple system overrides their positions directly.
 */
const BEHAVIOR_MODE_GRAPPLE_CHAIN = 3;

/**
 * Lifetime (ticks) assigned to grapple chain particles — effectively infinite.
 * Chain particle lifetime is managed by the grapple system directly; using a
 * very large value prevents the standard particle lifetime loop from expiring them.
 */
const GRAPPLE_CHAIN_LIFETIME_TICKS = 9999999.0;

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
 * Returns true if the given hit point is on the top surface of any wall.
 * When true, also writes the exact wall top-Y into the provided output object
 * so the caller can snap the anchor to the precise surface.
 */
function isTopSurfaceHit(world: WorldState, hitX: number, hitY: number, out: { snappedY: number }): boolean {
  const eps = 0.5;
  for (let wi = 0; wi < world.wallCount; wi++) {
    const topY = world.wallYWorld[wi];
    const bottomY = topY + world.wallHWorld[wi];
    const leftX = world.wallXWorld[wi];
    const rightX = leftX + world.wallWWorld[wi];
    const isNearTopSurface = Math.abs(hitY - topY) < eps && hitX >= leftX - eps && hitX <= rightX + eps;
    const isNearVerticalSide = (Math.abs(hitX - leftX) < eps || Math.abs(hitX - rightX) < eps)
      && hitY >= topY - eps
      && hitY <= bottomY + eps;
    // Corner edge-case handling: when a grapple ray hits exactly at/near a
    // corner, prefer the vertical side classification over the horizontal top.
    if (isNearVerticalSide) {
      return false;
    }
    if (isNearTopSurface) {
      out.snappedY = topY;
      return true;
    }
  }
  return false;
}

/** Reusable output object for isTopSurfaceHit to avoid per-call allocation. */
const _topSurfaceOut = { snappedY: 0 };

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

  const isRefireDuringRetract = world.isGrappleRetractingFlag === 1;
  // Grapple charge: cannot fire when spent, except while retracting.
  if (world.hasGrappleChargeFlag === 0 && !isRefireDuringRetract) return;

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

  // Detect top-surface hit and snap anchor Y to exact wall surface
  const isTopHit = isTopSurfaceHit(world, hit.x, hit.y, _topSurfaceOut);
  const anchorX = hit.x;
  const anchorY = isTopHit ? _topSurfaceOut.snappedY : hit.y;
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
  world.isGrappleTopSurfaceFlag = isTopHit ? 1 : 0;
  world.isGrappleStuckFlag = 0;
  world.grappleStuckStoppedTickCount = 0;
  world.grappleAttachFxTicks = GRAPPLE_ATTACH_FX_TICKS;
  world.grappleAttachFxXWorld = anchorX;
  world.grappleAttachFxYWorld = anchorY;

  // Consume grapple charge. Top-surface grapples instantly refresh the charge
  // so the player can chain grapple between ledges.
  if (isTopHit) {
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
      world.behaviorMode[idx]       = BEHAVIOR_MODE_GRAPPLE_CHAIN;
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
export function releaseGrapple(world: WorldState): void {
  const shouldRetractFromActiveGrapple = world.isGrappleActiveFlag === 1;
  const shouldRetractFromMiss = world.isGrappleMissActiveFlag === 1;

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
      releaseGrapple(world);
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
    releaseGrapple(world);
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
    const pLeft   = player.positionXWorld - halfW;
    const pRight  = player.positionXWorld + halfW;
    const pTop    = player.positionYWorld - halfH;
    const pBottom = player.positionYWorld + halfH;
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wLeft   = world.wallXWorld[wi];
      const wTop    = world.wallYWorld[wi];
      const wRight  = wLeft + world.wallWWorld[wi];
      const wBottom = wTop + world.wallHWorld[wi];
      // Check AABB overlap
      if (pRight > wLeft && pLeft < wRight && pBottom > wTop && pTop < wBottom) {
        // Find minimum penetration axis
        const overlapLeft   = pRight - wLeft;
        const overlapRight  = wRight - pLeft;
        const overlapTop    = pBottom - wTop;
        const overlapBottom = wBottom - pTop;
        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
        if (minOverlap === overlapTop) {
          // Push up (landing on top surface)
          player.positionYWorld = wTop - halfH;
          if (player.velocityYWorld > 0) player.velocityYWorld = 0;
        } else if (minOverlap === overlapBottom) {
          // Push down (hitting bottom surface)
          player.positionYWorld = wBottom + halfH;
          if (player.velocityYWorld < 0) player.velocityYWorld = 0;
        } else if (minOverlap === overlapLeft) {
          // Push left
          player.positionXWorld = wLeft - halfW;
          if (player.velocityXWorld > 0) player.velocityXWorld = 0;
        } else {
          // Push right
          player.positionXWorld = wRight + halfW;
          if (player.velocityXWorld < 0) player.velocityXWorld = 0;
        }
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

function startGrappleMiss(world: WorldState, dirX: number, dirY: number): void {
  const player = world.clusters[0];
  if (player === undefined) return;
  if (world.grappleParticleStartIndex < 0) return;

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
  }
}

function cancelGrappleMiss(world: WorldState): void {
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

function startGrappleRetract(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || world.grappleParticleStartIndex < 0) return;

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
    world.behaviorMode[idx]       = BEHAVIOR_MODE_GRAPPLE_CHAIN;
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
              world.isGrappleRetractingFlag = 0;
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

    // ── Enforce link connectivity ───────────────────────────────────────────
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
