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

// ============================================================================
// Tuning constants — adjust these to dial in the grapple feel
// ============================================================================

/** Maximum rope length the player can shoot (world units). */
export const GRAPPLE_MAX_LENGTH_WORLD = 300;

/** Minimum rope length to prevent degenerate zero-length ropes. */
const GRAPPLE_MIN_LENGTH_WORLD = 30;

/** Duration of the sparkle burst effect on attach (ticks). */
const GRAPPLE_ATTACH_FX_TICKS = 14;

/**
 * Speed at which the rope shortens while the jump button is held (world units per second).
 * Shorter rope = tighter swing radius = faster rotation = bigger launch when released.
 */
const GRAPPLE_PULL_IN_SPEED_WORLD_PER_SEC = 90.0;

/**
 * Maximum total rope that can be pulled in before the grapple breaks (world units).
 * This is a tension limit — pulling too hard snaps the rope and the player flies
 * off with their accumulated swing momentum.  Acts as the skill ceiling for the mechanic.
 */
const GRAPPLE_MAX_PULL_IN_WORLD = 150.0;

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

/** Number of Gold particles that form the visible chain between player and anchor. */
export const GRAPPLE_SEGMENT_COUNT = 10;

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
  if (dist < 1.0) return; // cursor too close to player — ignore

  const invDist = 1.0 / dist;
  const dirX = dx * invDist;
  const dirY = dy * invDist;
  const maxCastDist = Math.min(dist, GRAPPLE_MAX_LENGTH_WORLD);
  const hit = raycastWalls(world, player.positionXWorld, player.positionYWorld, dirX, dirY, maxCastDist);
  if (hit === null) return;

  const hitDist = Math.sqrt((hit.x - player.positionXWorld) ** 2 + (hit.y - player.positionYWorld) ** 2);
  const clampedDist = Math.min(Math.max(hitDist, GRAPPLE_MIN_LENGTH_WORLD), GRAPPLE_MAX_LENGTH_WORLD);

  // Place anchor at clamped distance along the aim direction
  world.grappleAnchorXWorld = player.positionXWorld + dirX * clampedDist;
  world.grappleAnchorYWorld = player.positionYWorld + dirY * clampedDist;
  world.grappleLengthWorld  = clampedDist;
  world.grapplePullInAmountWorld = 0.0;  // reset pull-in counter for this new attachment
  world.grappleJumpHeldTickCount = 0;   // reset tap/hold tracker
  world.isGrappleActiveFlag = 1;
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

  // Ultra-fast tap: pressed and released within a single frame (both keydown
  // and keyup fired between two ticks).  The triggered flag is set but the
  // held flag is already false.
  if (jumpJustPressed && world.playerJumpHeldFlag === 0) {
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
