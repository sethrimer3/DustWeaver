/**
 * Ordered Mote Queue — logical representation of the player's dust mote
 * inventory.
 *
 * The mote queue is a parallel resource layer that sits above the physical
 * particle simulation.  Each slot represents one dust mote's worth of player
 * capacity and tracks:
 *   - kind                (ParticleKind — whatever dust the player loaded)
 *   - state               (available or depleted)
 *   - cooldownTicksLeft   (ticks remaining before a depleted slot recovers)
 *   - particleIndex       (index into the world particle buffer for this mote)
 *
 * The queue order is stable.  Depleted slots are skipped when weaves form
 * active positions.  Regenerated slots return to their original queue position.
 *
 * Designed per MajorDustUpgradePlan.md Phases 1–4.
 *
 * Sim-layer rules respected:
 *   • No DOM or browser APIs.
 *   • No Math.random() — RNG not needed here (depletion is deterministic).
 *   • No per-tick heap allocations in hot paths.
 */

import { WorldState, MAX_MOTE_SLOTS } from '../world';
import { ParticleKind } from '../particles/kinds';
import { GRAPPLE_MAX_LENGTH_WORLD } from '../clusters/grappleMiss';

// ── Constants ──────────────────────────────────────────────────────────────────

// Re-export MAX_MOTE_SLOTS for callers who import from this module.
export { MAX_MOTE_SLOTS } from '../world';

/** Ticks for standard mote regeneration after a combat kill (~3 s at 60 fps). */
export const BASE_MOTE_REGENERATION_TICKS = 180;

/** Faster regeneration for short-duration weave use (~1.5 s at 60 fps). */
export const FAST_MOTE_REGENERATION_TICKS = 90;

/** Slower regeneration for heavy combat kills (~5 s at 60 fps). */
export const SLOW_MOTE_REGENERATION_TICKS = 300;

/** Minimum grapple-range ratio when all motes are depleted. */
const MIN_GRAPPLE_RANGE_RATIO = 0.25;

/**
 * Lerp factor for smoothing the displayed grapple influence circle toward
 * the target effective range.  0.12 ≈ ~8-tick visual lag.
 */
const GRAPPLE_RANGE_VISUAL_LERP_FACTOR = 0.12;

// ── Slot state values ─────────────────────────────────────────────────────────

/** Mote slot is live and can participate in weave formations. */
export const MOTE_STATE_AVAILABLE: 0 = 0;
/** Mote slot was destroyed in combat and is waiting for cooldown recovery. */
export const MOTE_STATE_DEPLETED:  1 = 1;

// ── Initialization ─────────────────────────────────────────────────────────────

/**
 * Initializes the mote queue by scanning the particle buffer for
 * player-owned non-transient, non-Fluid particles and linking each one to a
 * logical mote slot in buffer order.
 *
 * Call once per room load, after all player particles are spawned and
 * before `initGrappleChainParticles` (grapple chains are transient and
 * are filtered out automatically, so call order relative to them is safe).
 *
 * Resets all slot states to available and clears cooldowns.
 */
export function initMoteQueueFromParticles(world: WorldState, playerEntityId: number): void {
  world.moteSlotCount = 0;
  world.moteSlotState.fill(MOTE_STATE_AVAILABLE);
  world.moteSlotCooldownTicksLeft.fill(0);
  world.moteSlotParticleIndex.fill(-1);

  for (let i = 0; i < world.particleCount; i++) {
    if (world.ownerEntityId[i] !== playerEntityId) continue;
    if (world.kindBuffer[i] === ParticleKind.Fluid)   continue;
    if (world.isTransientFlag[i] === 1)               continue;
    if (world.moteSlotCount >= MAX_MOTE_SLOTS) break;

    const slot = world.moteSlotCount++;
    world.moteSlotKind[slot]              = world.kindBuffer[i];
    world.moteSlotState[slot]             = MOTE_STATE_AVAILABLE;
    world.moteSlotCooldownTicksLeft[slot] = 0;
    world.moteSlotParticleIndex[slot]     = i;
  }

  // Snap the smoothed display radius to the target so the circle does not
  // lerp from zero on the first frame of each room load.
  resetMoteGrappleDisplayRadius(world);
}

/**
 * Snaps `moteGrappleDisplayRadiusWorld` to the current effective grapple
 * range with no lerp lag.
 *
 * Call after `initMoteQueueFromParticles()`, or any time the mote loadout
 * changes in a way that should instantly reposition the influence circle
 * (e.g., hero swap, save/load, cheat commands).
 */
export function resetMoteGrappleDisplayRadius(world: WorldState): void {
  world.moteGrappleDisplayRadiusWorld = getEffectiveGrappleRangeWorld(world);
}

// ── Query helpers ──────────────────────────────────────────────────────────────

/** Returns the total number of logical mote slots (including depleted ones). */
export function getTotalMoteSlotCount(world: WorldState): number {
  return world.moteSlotCount;
}

/** Returns the number of available (non-depleted) mote slots. */
export function getAvailableMoteSlotCount(world: WorldState): number {
  let count = 0;
  for (let i = 0; i < world.moteSlotCount; i++) {
    if (world.moteSlotState[i] === MOTE_STATE_AVAILABLE) count++;
  }
  return count;
}

/**
 * Returns the fraction of mote slots that are currently available.
 * Returns 1.0 when the player has no mote slots configured (no dust
 * containers or loadout), so grapple and sword range remain at full.
 */
export function getAvailableMoteRatio(world: WorldState): number {
  if (world.moteSlotCount === 0) return 1.0;
  return getAvailableMoteSlotCount(world) / world.moteSlotCount;
}

// ── Pre-allocated scratch for getAvailableOrderedMoteSlots ─────────────────────

const _availableSlotsScratch = new Uint8Array(MAX_MOTE_SLOTS);
let   _availableSlotsCount   = 0;

/**
 * Returns the indices (into the mote slot arrays) of all currently available
 * slots, in original queue order.
 *
 * The returned `indices` buffer is a module-level scratch array — contents
 * are valid only until the next call to this function.  Callers must read
 * `count` items immediately; do NOT store the reference across ticks.
 *
 * Allocation-free: safe to call every tick.
 */
export function getAvailableOrderedMoteSlots(world: WorldState): { indices: Uint8Array; count: number } {
  _availableSlotsCount = 0;
  for (let i = 0; i < world.moteSlotCount; i++) {
    if (world.moteSlotState[i] === MOTE_STATE_AVAILABLE) {
      _availableSlotsScratch[_availableSlotsCount++] = i;
    }
  }
  return { indices: _availableSlotsScratch, count: _availableSlotsCount };
}

// ── Grapple range helpers ──────────────────────────────────────────────────────

/**
 * Returns the effective grapple range (world units) for this tick.
 *
 * Formula:  GRAPPLE_MAX_LENGTH_WORLD × clamp(availableRatio, MIN, 1.0)
 *
 * When all motes are available: full range.
 * When all motes are depleted:  MIN_GRAPPLE_RANGE_RATIO × full range.
 * When moteSlotCount is 0:      full range (no motes configured → no depletion).
 */
export function getEffectiveGrappleRangeWorld(world: WorldState): number {
  const ratio = Math.max(MIN_GRAPPLE_RANGE_RATIO, getAvailableMoteRatio(world));
  return GRAPPLE_MAX_LENGTH_WORLD * ratio;
}

/**
 * Returns the current circle-of-influence radius (world units).
 *
 * In Phases 1–4 this equals the effective grapple range.  Future phases may
 * decouple these if the sword or other weaves need a separate influence model.
 *
 * Used by Sword Weave to determine the enemy-detection radius for passive
 * ready-stance formation.
 */
export function getCircleOfInfluenceRadiusWorld(world: WorldState): number {
  return getEffectiveGrappleRangeWorld(world);
}

// ── Mote lifecycle helpers ─────────────────────────────────────────────────────

/**
 * Marks the mote slot linked to `particleIndex` as depleted and starts its
 * regeneration cooldown.
 *
 * No-op when:
 *   - no slot is linked to `particleIndex`, or
 *   - the slot is already depleted.
 *
 * Safe to call from `forces.ts` or any combat resolution path.
 */
export function depleteMoteSlotForParticle(
  world: WorldState,
  particleIndex: number,
  cooldownTicks = BASE_MOTE_REGENERATION_TICKS,
): void {
  for (let i = 0; i < world.moteSlotCount; i++) {
    if (world.moteSlotParticleIndex[i] !== particleIndex) continue;
    if (world.moteSlotState[i] === MOTE_STATE_DEPLETED) return;
    world.moteSlotState[i]             = MOTE_STATE_DEPLETED;
    world.moteSlotCooldownTicksLeft[i] = cooldownTicks;
    return;
  }
}

/**
 * Scans all player-owned mote slots and depletes any whose linked particle
 * has just been combat-killed this tick (isAliveFlag === 0 while the slot
 * was still available).
 *
 * Natural particle lifetime cycling (ageTicks expiry with in-place respawn)
 * does NOT set isAliveFlag = 0, so it never triggers depletion here.
 *
 * Call once per tick, after `applyInterParticleForces`.
 * Safe and cheap when moteSlotCount === 0.
 */
export function syncMoteQueueWithParticles(world: WorldState): void {
  if (world.moteSlotCount === 0) return;

  for (let i = 0; i < world.moteSlotCount; i++) {
    if (world.moteSlotState[i] !== MOTE_STATE_AVAILABLE) continue;
    const pidx = world.moteSlotParticleIndex[i];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.isAliveFlag[pidx] === 0) {
      world.moteSlotState[i]             = MOTE_STATE_DEPLETED;
      world.moteSlotCooldownTicksLeft[i] = BASE_MOTE_REGENERATION_TICKS;
    }
  }
}

/**
 * Counts down depletion cooldowns and restores slots whose countdown has
 * reached zero.
 *
 * Call once per tick (step 7.5 of the tick pipeline).
 */
export function tickMoteSlotRegeneration(world: WorldState): void {
  for (let i = 0; i < world.moteSlotCount; i++) {
    if (world.moteSlotState[i] !== MOTE_STATE_DEPLETED) continue;
    if (world.moteSlotCooldownTicksLeft[i] > 0) {
      world.moteSlotCooldownTicksLeft[i]--;
    } else {
      world.moteSlotState[i] = MOTE_STATE_AVAILABLE;
    }
  }
}

/**
 * Smoothly lerps the displayed grapple range circle toward the current
 * effective range.
 *
 * Call once per tick after `tickMoteSlotRegeneration` so the displayed radius
 * always chases the latest value.
 */
export function tickMoteGrappleDisplayRadius(world: WorldState): void {
  const targetRadiusWorld = getEffectiveGrappleRangeWorld(world);
  world.moteGrappleDisplayRadiusWorld +=
    (targetRadiusWorld - world.moteGrappleDisplayRadiusWorld) * GRAPPLE_RANGE_VISUAL_LERP_FACTOR;
}
