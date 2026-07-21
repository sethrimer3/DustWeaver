/**
 * Dust Type Switch — recall/transform/return animation driving a global
 * dust-type change for all of the player's ordinary motes.
 *
 * State machine per mote slot (mirrors the Ordered Mote Queue's slot indexing):
 *
 *   NORMAL  --beginDustTypeSwitch()--> RECALLING_TO_PLAYER --(reaches/crosses
 *   player center)--> TRANSFORMED_RETURNING --(grace period elapses)--> NORMAL
 *
 * RECALLING_TO_PLAYER fully owns the particle's position/velocity each tick
 * (custom steering, see integration.ts's exclusion of BEHAVIOR_MODE_DUST_SWITCH_RECALL)
 * so it can test the movement segment against the moving player center every
 * tick and snap exactly onto it — a fast mote can never skip over the
 * transformation point. TRANSFORMED_RETURNING hands the particle back to the
 * normal integration + binding-force pipeline (binding.ts explicitly allows
 * this mode through) so it eases back to orbit organically; this module only
 * records trail samples and counts down a short grace period during which the
 * particle stays excluded from combat/weave-formation (see
 * dustSwitchBehaviorMode.ts and its call sites in forces.ts, playerCombat.ts,
 * weaveCombat.ts).
 *
 * Depleted/absent mote slots are retargeted immediately with no animation —
 * they keep their existing depletion cooldown and simply respawn as the new
 * kind later (see beginDustTypeSwitch). A mote destroyed mid-recall is
 * resolved the same way so the transition can never deadlock.
 */

import { WorldState, MAX_MOTE_SLOTS, DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { MOTE_STATE_AVAILABLE } from '../motes/orderedMoteQueue';
import {
  BEHAVIOR_MODE_DUST_SWITCH_RECALL,
  BEHAVIOR_MODE_DUST_SWITCH_RETURN,
  isDustSwitchBehaviorMode,
} from '../particles/dustSwitchBehaviorMode';
import { isBowArrowBehaviorMode } from '../particles/bowArrowBehaviorMode';
import { isSwordSlashBehaviorMode } from '../particles/swordSlashBehaviorMode';

// ── Per-slot phase values ───────────────────────────────────────────────────

export const DUST_SWITCH_PHASE_NORMAL = 0;
export const DUST_SWITCH_PHASE_RECALLING = 1;
export const DUST_SWITCH_PHASE_RETURNING = 2;

// ── Tuning constants (centralized) ──────────────────────────────────────────

/** Acceleration (world units/s²) steering a recalling mote toward the player center. */
const DUST_SWITCH_RECALL_ACCEL_WORLD = 900.0;
/** High but finite speed cap (world units/s) for the recall leg. */
const DUST_SWITCH_RECALL_MAX_SPEED_WORLD = 260.0;
/** Minimum recall speed (world units/s) — guarantees finite-time arrival even very close to center. */
const DUST_SWITCH_RECALL_MIN_SPEED_WORLD = 60.0;
/** Distance (world units) at which arrival steering begins damping the desired speed down to the minimum. */
const DUST_SWITCH_RECALL_ARRIVAL_RADIUS_WORLD = 12.0;
/**
 * Grace period (ticks) after transforming during which the mote is still
 * excluded from combat/weave-formation while normal binding forces ease it
 * back out to orbit. ~0.3s at 60 fps.
 */
export const DUST_SWITCH_RETURN_TICKS = 18;

// ── Trail sample helpers ─────────────────────────────────────────────────────

function _recordTrailSample(
  world: WorldState,
  slot: number,
  xWorld: number,
  yWorld: number,
  isPostTransform: 0 | 1,
): void {
  const cap = DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT;
  const writeIndex = world.dustSwitchTrailWriteIndex[slot];
  const base = slot * cap + writeIndex;
  world.dustSwitchTrailXWorld[base] = xWorld;
  world.dustSwitchTrailYWorld[base] = yWorld;
  world.dustSwitchTrailAgeTicks[base] = 0;
  world.dustSwitchTrailIsPostTransformFlag[base] = isPostTransform;
  world.dustSwitchTrailWriteIndex[slot] = (writeIndex + 1) % cap;
  if (world.dustSwitchTrailActiveCount[slot] < cap) world.dustSwitchTrailActiveCount[slot]++;
}

// ── Kickoff ──────────────────────────────────────────────────────────────────

/**
 * Begins a global dust-type switch: every ordinary player mote slot targets
 * `targetKind`. Live/available slots animate (recall → transform → return);
 * depleted or unlinked slots retarget immediately with no animation. Slots
 * already at `targetKind` are left untouched.
 *
 * No-op if a switch is already in progress (callers must gate the wheel on
 * `isDustTypeSwitchInProgress` so this should never actually happen).
 */
export function beginDustTypeSwitch(world: WorldState, targetKind: ParticleKind): void {
  if (world.dustSwitchActiveSlotCount > 0) return;

  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    const currentKind = world.moteSlotKind[slot];
    if (currentKind === targetKind) continue;

    const pidx = world.moteSlotParticleIndex[slot];
    // A mote currently owned by the Bow arrow (in flight or mid-assembly) or
    // the Sword crescent must NOT be hijacked into the dust-switch recall
    // animation — that would silently overwrite its behaviorMode out from
    // under the owning weave (which still believes it owns the particle),
    // violating the "one authoritative behaviorMode owner per mote" invariant.
    // Treat it the same as "not currently available for animation": retarget
    // its logical/physical kind immediately (no recall animation) so it comes
    // out the other side of its current weave already showing the new type,
    // then resumes normal dust-switch-free behavior when that weave releases it.
    const isOwnedByAnotherWeave = pidx >= 0 && pidx < world.particleCount
      && (isBowArrowBehaviorMode(world.behaviorMode[pidx]) || isSwordSlashBehaviorMode(world.behaviorMode[pidx]));
    const isLiveAndAvailable = world.moteSlotState[slot] === MOTE_STATE_AVAILABLE
      && pidx >= 0 && pidx < world.particleCount && world.isAliveFlag[pidx] === 1
      && !isOwnedByAnotherWeave;

    if (isLiveAndAvailable) {
      world.dustSwitchSourceKind[slot] = currentKind;
      world.dustSwitchTargetKind[slot] = targetKind;
      world.dustSwitchPhase[slot] = DUST_SWITCH_PHASE_RECALLING;
      world.dustSwitchReturnTicksLeft[slot] = 0;
      world.dustSwitchTrailWriteIndex[slot] = 0;
      world.dustSwitchTrailActiveCount[slot] = 0;
      world.behaviorMode[pidx] = BEHAVIOR_MODE_DUST_SWITCH_RECALL;
      world.dustSwitchActiveSlotCount++;
    } else {
      // Depleted, regenerating, unlinked, or currently owned by the Bow/Sword
      // Weave — retarget the slot (and its linked particle's stored kind, if
      // any) so it shows the newly selected type immediately without an
      // animation, preserving its depletion/regen timer and current weave
      // ownership untouched.
      world.moteSlotKind[slot] = targetKind;
      if (pidx >= 0 && pidx < world.particleCount) {
        world.kindBuffer[pidx] = targetKind;
      }
    }
  }
}

// ── Per-tick step ────────────────────────────────────────────────────────────

function _resolveInterruptedSlot(world: WorldState, slot: number): void {
  const targetKind = world.dustSwitchTargetKind[slot];
  world.moteSlotKind[slot] = targetKind;
  const pidx = world.moteSlotParticleIndex[slot];
  if (pidx >= 0 && pidx < world.particleCount && isDustSwitchBehaviorMode(world.behaviorMode[pidx])) {
    world.kindBuffer[pidx] = targetKind;
    world.behaviorMode[pidx] = 0;
  }
  world.dustSwitchPhase[slot] = DUST_SWITCH_PHASE_NORMAL;
  world.dustSwitchReturnTicksLeft[slot] = 0;
  world.dustSwitchActiveSlotCount--;
}

function _transformAtCenter(
  world: WorldState,
  slot: number,
  pidx: number,
  centerXWorld: number,
  centerYWorld: number,
): void {
  const targetKind = world.dustSwitchTargetKind[slot];
  const targetProfile = getElementProfile(targetKind);

  world.positionXWorld[pidx] = centerXWorld;
  world.positionYWorld[pidx] = centerYWorld;
  world.kindBuffer[pidx] = targetKind;
  world.moteSlotKind[slot] = targetKind;
  world.massKg[pidx] = targetProfile.massKg;
  world.particleDurability[pidx] = targetProfile.toughness;
  world.anchorRadiusWorld[pidx] = targetProfile.orbitRadiusWorld;
  world.behaviorMode[pidx] = BEHAVIOR_MODE_DUST_SWITCH_RETURN;

  // Record the exact center point twice — once closing the old-color leg and
  // once opening the new-color leg — giving the renderer a zero-length
  // straddling segment to blend smoothly across instead of a hard seam.
  _recordTrailSample(world, slot, centerXWorld, centerYWorld, 0);
  _recordTrailSample(world, slot, centerXWorld, centerYWorld, 1);

  world.dustSwitchPhase[slot] = DUST_SWITCH_PHASE_RETURNING;
  world.dustSwitchReturnTicksLeft[slot] = DUST_SWITCH_RETURN_TICKS;
}

function _stepRecall(
  world: WorldState,
  slot: number,
  pidx: number,
  playerXWorld: number,
  playerYWorld: number,
  dtSec: number,
): void {
  const oldX = world.positionXWorld[pidx];
  const oldY = world.positionYWorld[pidx];

  _recordTrailSample(world, slot, oldX, oldY, 0);

  const dx = playerXWorld - oldX;
  const dy = playerYWorld - oldY;
  const dist = Math.hypot(dx, dy);

  if (dist < 1e-4) {
    _transformAtCenter(world, slot, pidx, playerXWorld, playerYWorld);
    return;
  }

  const dirX = dx / dist;
  const dirY = dy / dist;
  const speedT = Math.min(1, dist / DUST_SWITCH_RECALL_ARRIVAL_RADIUS_WORLD);
  const desiredSpeed = DUST_SWITCH_RECALL_MIN_SPEED_WORLD
    + (DUST_SWITCH_RECALL_MAX_SPEED_WORLD - DUST_SWITCH_RECALL_MIN_SPEED_WORLD) * speedT;
  const desiredVelX = dirX * desiredSpeed;
  const desiredVelY = dirY * desiredSpeed;

  let velX = world.velocityXWorld[pidx];
  let velY = world.velocityYWorld[pidx];
  const dvx = desiredVelX - velX;
  const dvy = desiredVelY - velY;
  const dvLen = Math.hypot(dvx, dvy);
  const maxDv = DUST_SWITCH_RECALL_ACCEL_WORLD * dtSec;
  if (dvLen > maxDv && dvLen > 1e-6) {
    velX += (dvx / dvLen) * maxDv;
    velY += (dvy / dvLen) * maxDv;
  } else {
    velX = desiredVelX;
    velY = desiredVelY;
  }

  // Test the full movement segment against the (moving) target center before
  // applying it — if this tick's translation would reach or cross the
  // center, snap exactly onto it instead of overshooting, so a fast mote can
  // never skip over the transformation point.
  const stepDist = Math.hypot(velX * dtSec, velY * dtSec);
  if (stepDist >= dist) {
    world.velocityXWorld[pidx] = velX;
    world.velocityYWorld[pidx] = velY;
    _transformAtCenter(world, slot, pidx, playerXWorld, playerYWorld);
    return;
  }

  world.positionXWorld[pidx] = oldX + velX * dtSec;
  world.positionYWorld[pidx] = oldY + velY * dtSec;
  world.velocityXWorld[pidx] = velX;
  world.velocityYWorld[pidx] = velY;
}

/**
 * Advances the dust-switch state machine by one tick. Call once per
 * simulation tick, after `integrateParticles` (recalling motes fully manage
 * their own position/velocity and are skipped by normal integration;
 * returning motes have already been moved by normal integration + binding
 * forces by the time this runs, so their position is final for this tick).
 */
export function tickDustTypeSwitch(world: WorldState): void {
  // Age all trail samples every tick, independent of phase, so a slot that
  // just finished returning keeps fading its trail out smoothly.
  const cap = DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT;
  for (let slot = 0; slot < MAX_MOTE_SLOTS; slot++) {
    const count = world.dustSwitchTrailActiveCount[slot];
    if (count === 0) continue;
    const base = slot * cap;
    for (let s = 0; s < count; s++) {
      world.dustSwitchTrailAgeTicks[base + s] += 1;
    }
  }

  if (world.dustSwitchActiveSlotCount === 0) return;

  let playerXWorld = 0;
  let playerYWorld = 0;
  let hasPlayer = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerYWorld = c.positionYWorld;
      hasPlayer = true;
      break;
    }
  }

  const dtSec = world.dtMs / 1000.0;

  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    const phase = world.dustSwitchPhase[slot];
    if (phase === DUST_SWITCH_PHASE_NORMAL) continue;

    const pidx = world.moteSlotParticleIndex[slot];
    const particleMissing = pidx < 0 || pidx >= world.particleCount || world.isAliveFlag[pidx] === 0;

    if (particleMissing) {
      _resolveInterruptedSlot(world, slot);
      continue;
    }

    if (phase === DUST_SWITCH_PHASE_RECALLING) {
      if (!hasPlayer) continue; // no live player to recall toward this tick — hold in place
      _stepRecall(world, slot, pidx, playerXWorld, playerYWorld, dtSec);
    } else if (phase === DUST_SWITCH_PHASE_RETURNING) {
      _recordTrailSample(world, slot, world.positionXWorld[pidx], world.positionYWorld[pidx], 1);
      const ticksLeft = world.dustSwitchReturnTicksLeft[slot] - 1;
      if (ticksLeft <= 0) {
        world.dustSwitchPhase[slot] = DUST_SWITCH_PHASE_NORMAL;
        world.behaviorMode[pidx] = 0;
        world.dustSwitchActiveSlotCount--;
      } else {
        world.dustSwitchReturnTicksLeft[slot] = ticksLeft;
      }
    }
  }
}

// ── Queries / teardown ──────────────────────────────────────────────────────

/** True while any mote slot is mid-transition (recalling or returning). */
export function isDustTypeSwitchInProgress(world: WorldState): boolean {
  return world.dustSwitchActiveSlotCount > 0;
}

/**
 * Immediately resolves every in-progress slot to its target kind and clears
 * all transient dust-switch state. Safe to call unconditionally (no-op when
 * nothing is in progress). Used on death, room transition, and teardown so
 * particles are never left stuck mid-animation and logical/physical kinds
 * never desync.
 */
export function cancelAllDustTypeSwitches(world: WorldState): void {
  if (world.dustSwitchActiveSlotCount === 0) return;
  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    if (world.dustSwitchPhase[slot] === DUST_SWITCH_PHASE_NORMAL) continue;
    const targetKind = world.dustSwitchTargetKind[slot];
    world.moteSlotKind[slot] = targetKind;
    const pidx = world.moteSlotParticleIndex[slot];
    if (pidx >= 0 && pidx < world.particleCount) {
      world.kindBuffer[pidx] = targetKind;
      if (isDustSwitchBehaviorMode(world.behaviorMode[pidx])) {
        world.behaviorMode[pidx] = 0;
      }
    }
    world.dustSwitchPhase[slot] = DUST_SWITCH_PHASE_NORMAL;
    world.dustSwitchReturnTicksLeft[slot] = 0;
  }
  world.dustSwitchActiveSlotCount = 0;
}
