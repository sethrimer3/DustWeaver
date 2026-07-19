/**
 * Secondary Weave Coordinator (Stage 3) — the per-gesture decision layer
 * that drives independently-unlockable Sword / Shield / Bow Weaves off the
 * single secondary-button gesture exposed by
 * `src/input/secondaryWeaveGesture.ts`.
 *
 * Runs once per tick in the default (non-legacy) `applyPlayerWeaveCombat`
 * path. Reads `world.secondaryWeaveGesture` (physical press/hold/release
 * shape — already ticked earlier this frame by gameCommandProcessor.ts) plus
 * `hasSwordWeaveUnlockedFlag` / `hasShieldWeaveUnlockedFlag` /
 * `hasBowWeaveUnlockedFlag` and ordered-mote availability, and decides:
 *
 *   - whether Sword should start this tick (press, if unlocked)
 *   - whether Shield should be forming (while held, if unlocked, and not
 *     currently suppressed by an in-progress Sword swipe)
 *   - whether Bow should be charging (from press, if unlocked, continuing
 *     through Sword + Shield)
 *   - whether Bow should fire (on release, if unlocked and tier >= 2, or via
 *     the deferred pending-release path if release happened before Sword's
 *     swipe finished)
 *
 * Mote ownership arbitration priority within one gesture:
 *   Sword transition → Shield formation (while held) → Bow consumes its
 *   reserved slots only at the moment of fire. Bow charging is purely
 *   logical (tier from availability) until fire; it never removes motes from
 *   the Shield pool while charging.
 */

import { WorldState } from '../world';
import { SecondaryWeaveGesturePhase } from '../../input/secondaryWeaveGesture';
import {
  startNewSwordSwipe,
  tickNewSwordSwipe,
  resetNewSwordState,
} from './swordWeave';
import { applyShieldWeaveCrescent, releaseShieldWeaveParticles } from './shieldWeave';
import {
  startNewBowCharge,
  updateNewBowCharge,
  cancelNewBowCharge,
  fireNewBow,
  resetNewBowState,
} from './bowWeave';

/** Finds the live player cluster, or null. */
function _findPlayer(world: WorldState) {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) return c;
  }
  return null;
}

/** Resets ALL Stage 3 coordinator state (sword, bow, shield ownership). Safe to call idempotently. */
export function resetSecondaryWeaveCoordinatorState(world: WorldState): void {
  resetNewSwordState(world);
  resetNewBowState(world);
  world.shieldWeaveIndependentActiveFlag = 0;
}

/**
 * Returns true when the Shield crescent should currently be suppressed
 * because a Sword swipe from this same gesture is still in progress (the
 * "sword cuts open into shield" handoff — the crescent should not appear
 * mid-swing).
 */
function _isSwordBlockingShield(world: WorldState): boolean {
  return world.newSwordActiveFlag === 1;
}

export function tickSecondaryWeaveCoordinator(world: WorldState): void {
  const gesture = world.secondaryWeaveGesture;
  const player = _findPlayer(world);

  // ── Cancellation: gesture forced back to Idle (pause/dialogue/blur/etc.) ──
  // Detect via: gesture is Idle AND (nothing in our state still thinks a
  // gesture is active). This also naturally covers the case where the
  // gesture's own `consumedByOtherSystem` (grapple zip) voided the press —
  // our state was never armed for that gesture id in the first place because
  // we gate on `pressEventFlag`, which the coordinator layer never sets for
  // a consumed press.
  if (gesture.phase === SecondaryWeaveGesturePhase.Idle) {
    if (world.newSwordActiveFlag === 1) resetSwordOnly(world);
    if (world.newBowChargingFlag === 1) cancelNewBowCharge(world);
    if (world.newBowPendingReleaseFlag === 1) clearPendingBowRelease(world);
    if (world.shieldWeaveIndependentActiveFlag === 1) endShieldOwnership(world);
  }

  if (player === null) return;

  // ── Press: start Sword swipe and/or Bow charge for this fresh gesture ────
  if (gesture.pressEventFlag) {
    if (world.hasSwordWeaveUnlockedFlag === 1) {
      startNewSwordSwipe(world, player, gesture.gestureId, gesture.pressAimXWorld, gesture.pressAimYWorld);
    }
    if (world.hasBowWeaveUnlockedFlag === 1) {
      startNewBowCharge(world, gesture.gestureId);
    }
  }

  // ── Advance in-progress Sword swipe (press tick and every hold tick) ─────
  if (world.newSwordActiveFlag === 1) {
    const completedThisTick = tickNewSwordSwipe(world);
    if (completedThisTick) {
      onSwordSwipeCompleted(world);
    }
  }

  // ── Advance Bow logical charge while held (independent of Sword/Shield) ──
  if (world.newBowChargingFlag === 1) {
    updateNewBowCharge(world);
  }

  // ── Shield: forms while held (Holding phase) once Sword isn't blocking ──
  const isHeldPhase = gesture.phase === SecondaryWeaveGesturePhase.Press
    || gesture.phase === SecondaryWeaveGesturePhase.Holding;
  const shieldShouldBeActive =
    world.hasShieldWeaveUnlockedFlag === 1 &&
    isHeldPhase &&
    !_isSwordBlockingShield(world);

  if (shieldShouldBeActive) {
    world.shieldWeaveIndependentActiveFlag = 1;
    applyShieldWeaveCrescent(world, player.positionXWorld, player.positionYWorld, gesture.holdAimXWorld - player.positionXWorld, gesture.holdAimYWorld - player.positionYWorld);
  } else if (world.shieldWeaveIndependentActiveFlag === 1) {
    endShieldOwnership(world);
  }

  // ── Release: fire Bow now, or latch a pending release if Sword still mid-swipe ──
  if (gesture.releaseEventFlag) {
    if (world.hasBowWeaveUnlockedFlag === 1 && world.newBowChargingFlag === 1) {
      if (world.newSwordActiveFlag === 1) {
        // Sword hasn't finished yet — latch exactly one pending release.
        latchPendingBowRelease(world, gesture.releaseAimXWorld, gesture.releaseAimYWorld, world.newBowTierMoteCount);
        world.newBowChargingFlag = 0;
      } else {
        fireBowNow(world, player, gesture.releaseAimXWorld, gesture.releaseAimYWorld, world.newBowTierMoteCount);
      }
    } else if (world.newBowChargingFlag === 1) {
      cancelNewBowCharge(world);
    }
    // Shield ownership always ends first on release (priority order).
    if (world.shieldWeaveIndependentActiveFlag === 1) {
      endShieldOwnership(world);
    }
  }

  // ── Deferred pending-arrow fire: as soon as Sword is no longer active ────
  if (world.newBowPendingReleaseFlag === 1 && world.newSwordActiveFlag === 0) {
    fireBowNow(
      world,
      player,
      world.newBowPendingReleaseAimXWorld,
      world.newBowPendingReleaseAimYWorld,
      world.newBowPendingReleaseMoteCount,
    );
    clearPendingBowRelease(world);
  }
}

/**
 * Called the tick the Sword swipe's animation finishes. Marks the
 * sword→shield transition as complete for Stage 5 rendering. No mote
 * bookkeeping is needed here: the swipe itself never claimed ordered-mote
 * slots into block mode, so if Shield is unlocked and the button is still
 * held, `applyShieldWeaveCrescent` picking up next tick IS the handoff (same
 * underlying particles, retargeted in place — no duplicate-motes frame, no
 * destroy/recreate). If Sword-only (no Shield unlocked) or the button was
 * already released, there is nothing to release since nothing was claimed.
 */
function onSwordSwipeCompleted(world: WorldState): void {
  world.newSwordToShieldTransition01 = 1;
}

function resetSwordOnly(world: WorldState): void {
  resetNewSwordState(world);
}

function endShieldOwnership(world: WorldState): void {
  world.shieldWeaveIndependentActiveFlag = 0;
  const playerEntityId = _findPlayerEntityId(world);
  if (playerEntityId !== -1) releaseShieldWeaveParticles(world, playerEntityId);
}

function _findPlayerEntityId(world: WorldState): number {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].isPlayerFlag === 1 && world.clusters[ci].isAliveFlag === 1) {
      return world.clusters[ci].entityId;
    }
  }
  return -1;
}

function latchPendingBowRelease(world: WorldState, aimXWorld: number, aimYWorld: number, moteCount: number): void {
  world.newBowPendingReleaseFlag      = 1;
  world.newBowPendingReleaseAimXWorld = aimXWorld;
  world.newBowPendingReleaseAimYWorld = aimYWorld;
  world.newBowPendingReleaseMoteCount = moteCount;
}

function clearPendingBowRelease(world: WorldState): void {
  world.newBowPendingReleaseFlag      = 0;
  world.newBowPendingReleaseAimXWorld = 0;
  world.newBowPendingReleaseAimYWorld = 0;
  world.newBowPendingReleaseMoteCount = 0;
}

function fireBowNow(
  world: WorldState,
  player: NonNullable<ReturnType<typeof _findPlayer>>,
  aimXWorld: number,
  aimYWorld: number,
  moteCount: number,
): void {
  world.newBowChargingFlag = 0;
  if (moteCount < 2) return;
  const dx = aimXWorld - player.positionXWorld;
  const dy = aimYWorld - player.positionYWorld;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const aimDirX = dist > 1e-6 ? dx / dist : 1;
  const aimDirY = dist > 1e-6 ? dy / dist : 0;
  fireNewBow(world, player.positionXWorld, player.positionYWorld, aimDirX, aimDirY, moteCount);
}
