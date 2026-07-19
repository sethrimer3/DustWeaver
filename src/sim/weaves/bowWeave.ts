/**
 * Bow Weave (Stage 3) — independent charge-and-release arrow system.
 *
 * This is the new independently-unlockable Bow Weave driven by
 * `secondaryWeaveGesture.ts` (see `secondaryWeaveCoordinator.ts`), distinct
 * from the legacy single-slot `WEAVE_ARROW` path in `arrowWeave.ts` (which
 * remains for `combatMode === 'legacy'`). It shares the same fired-arrow
 * flight buffers (`world.arrow*`) and physics tables (`bowProjectilePhysics.ts`)
 * so `tickArrows()` in `arrowWeave.ts` continues to animate arrows fired from
 * either path with identical behavior.
 *
 * Charging is purely "logical" while held: the tier is computed from
 * available motes but nothing is physically removed from the mote pool until
 * the arrow is actually fired, so Shield can keep using the same motes while
 * Bow charges alongside it.
 */

import { WorldState } from '../world';
import {
  getAvailableMoteSlotCount,
  getAvailableOrderedMoteSlots,
  depleteFirstNMoteSlots,
} from '../motes/orderedMoteQueue';
import { findFreeArrowSlot, MOTE_3_LOAD_TICKS, MOTE_4_LOAD_TICKS } from './arrowWeave';
import { getBowSpeedForMoteCount, getBowLifetimeForMoteCount } from './bowProjectilePhysics';

/** Starts a logical charge on gesture press. No-op (silent) if unlocked but under 2 motes available. */
export function startNewBowCharge(world: WorldState, gestureId: number): void {
  if (world.moteSlotCount > 0 && getAvailableMoteSlotCount(world) < 2) return;
  world.newBowChargingFlag    = 1;
  world.newBowGestureId       = gestureId;
  world.newBowChargeStartTick = world.tick;
  world.newBowTierMoteCount   = 2;
}

/**
 * Advances the logical charge tier each tick. Tier is capped live by
 * currently-available motes; if a combat hit drops availability below 2,
 * the charge is cancelled outright (matches legacy arrow-loading behavior).
 */
export function updateNewBowCharge(world: WorldState): void {
  if (world.newBowChargingFlag === 0) return;
  const elapsed = world.tick - world.newBowChargeStartTick;
  let tier = elapsed >= MOTE_4_LOAD_TICKS ? 4 : elapsed >= MOTE_3_LOAD_TICKS ? 3 : 2;

  if (world.moteSlotCount > 0) {
    const available = getAvailableMoteSlotCount(world);
    if (available < 2) {
      cancelNewBowCharge(world);
      return;
    }
    tier = Math.min(tier, available);
  }
  world.newBowTierMoteCount = tier;
}

/** Cancels the in-progress logical charge without firing. */
export function cancelNewBowCharge(world: WorldState): void {
  world.newBowChargingFlag  = 0;
  world.newBowTierMoteCount = 0;
}

/**
 * Fires a bow arrow toward (aimDirX, aimDirY), consuming exactly `moteCount`
 * mote slots. The arrow flight slot is reserved BEFORE any motes are
 * depleted — if reservation fails (no free slot), nothing is consumed and
 * this returns false. Captures the fired arrow's dust kind from the
 * first-in-queue available mote at fire time so a later dust-type switch
 * cannot retroactively change it.
 */
export function fireNewBow(
  world: WorldState,
  playerXWorld: number,
  playerYWorld: number,
  aimDirXWorld: number,
  aimDirYWorld: number,
  moteCount: number,
): boolean {
  if (moteCount < 2) return false;

  const slot = findFreeArrowSlot(world);
  if (slot === -1) return false; // No room; consume nothing.

  const available = getAvailableOrderedMoteSlots(world);
  const dustKind = available.count > 0 ? world.moteSlotKind[available.indices[0]] : 0;

  const speed = getBowSpeedForMoteCount(moteCount);

  world.arrowXWorld[slot]                = playerXWorld;
  world.arrowYWorld[slot]                = playerYWorld;
  world.arrowVelXWorld[slot]             = aimDirXWorld * speed;
  world.arrowVelYWorld[slot]             = aimDirYWorld * speed;
  world.arrowDirXWorld[slot]             = aimDirXWorld;
  world.arrowDirYWorld[slot]             = aimDirYWorld;
  world.arrowMoteCount[slot]             = moteCount;
  world.isArrowStuckFlag[slot]           = 0;
  world.isArrowHitEnemyFlag[slot]        = 0;
  world.arrowLifetimeTicksLeft[slot]     = getBowLifetimeForMoteCount(moteCount);
  world.arrowHitSequenceMotesLeft[slot]  = 0;
  world.arrowHitSequenceDelayTicks[slot] = 0;
  world.arrowHitTargetClusterIndex[slot] = -1;
  world.arrowDamageCooldownTicks[slot]   = 0;
  world.arrowDustKind[slot]              = dustKind;

  // Reservation succeeded and arrow is fully set up — now spend the motes.
  depleteFirstNMoteSlots(world, moteCount);
  return true;
}

/** Resets all Bow Weave transient state (cancel / room teardown). Never touches in-flight arrows. */
export function resetNewBowState(world: WorldState): void {
  world.newBowChargingFlag            = 0;
  world.newBowGestureId               = -1;
  world.newBowChargeStartTick         = -1;
  world.newBowTierMoteCount           = 0;
  world.newBowPendingReleaseFlag      = 0;
  world.newBowPendingReleaseAimXWorld = 0;
  world.newBowPendingReleaseAimYWorld = 0;
  world.newBowPendingReleaseMoteCount = 0;
}
