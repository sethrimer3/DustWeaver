/**
 * Secondary Weave Coordinator (Stage 3) — the per-gesture decision layer that
 * drives the independently-unlockable Sword / Shield / Bow Weaves off the
 * single secondary-button gesture exposed by `src/input/secondaryWeaveGesture.ts`.
 *
 * Runs once per tick in the default (non-legacy) `applyPlayerWeaveCombat` path.
 *
 * Flow within one gesture:
 *   1. Press  → start the Sword swipe (if unlocked).
 *   2. Hold   → once the Sword swipe is no longer blocking, the Shield crescent
 *               forms. The tick the Shield first forms is the origin of the Bow
 *               arrow's load schedule (0.75 / 1.25 / 1.75 s). If the Bow is
 *               unlocked and ≥3 motes are available, the Bow reserves the
 *               player's ACTUAL motes into a straight arrow line (center + up to
 *               four more); reserved motes are excluded from the Shield crescent.
 *   3. Release→ if at least the minimum three motes are loaded, fire the arrow;
 *               otherwise cancel it gracefully (motes return to Storm, Shield
 *               resolves normally). A partial one/two-mote arrow is never fired.
 *
 * The outbound arrow flies independently of the gesture (it continues after
 * release) until it bounces off a wall or reaches max distance, at which point
 * its motes are handed back to Storm following.
 *
 * The old charge-strength / logical-tier / queued-mote system has been removed:
 * there is no draw strength, no separate ammunition, and every arrow mote is an
 * actual player mote.
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
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  cancelBowArrow,
  tickBowArrowOutbound,
  resetBowArrowState,
  isBowArrowActive,
  BOW_ARROW_PHASE_ASSEMBLING,
  BOW_ARROW_PHASE_OUTBOUND,
} from './bowArrow';

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
  resetBowArrowState(world);
  world.shieldWeaveIndependentActiveFlag = 0;
  world.secondaryWeaveHandledCancellationId = world.secondaryWeaveGesture.cancellationId;
}

/**
 * Returns true when the Shield crescent should currently be suppressed because
 * a Sword swipe from this same gesture is still in progress (the "sword cuts
 * open into shield" handoff — the crescent should not appear mid-swing).
 */
function _isSwordBlockingShield(world: WorldState): boolean {
  return world.newSwordActiveFlag === 1;
}

export function tickSecondaryWeaveCoordinator(world: WorldState): void {
  const gesture = world.secondaryWeaveGesture;
  const player = _findPlayer(world);

  // ── Outbound arrow flies independently of the gesture (continues after
  // release) until it bounces or reaches max distance. ─────────────────────
  if (world.bowArrowPhase === BOW_ARROW_PHASE_OUTBOUND) {
    tickBowArrowOutbound(world);
  }

  // ── Cancellation: gesture forced back to Idle mid-hold (pause/dialogue/
  // blur/dust-wheel/death/room-transition/grapple-consume). ────────────────
  if (world.secondaryWeaveHandledCancellationId !== gesture.cancellationId) {
    world.secondaryWeaveHandledCancellationId = gesture.cancellationId;
    if (world.newSwordActiveFlag === 1) resetNewSwordState(world);
    // Cancel an assembling arrow (release reserved motes to Storm). An already
    // outbound arrow is left to complete its flight — it no longer belongs to
    // the gesture and resolves on its own.
    if (world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) cancelBowArrow(world);
    if (world.shieldWeaveIndependentActiveFlag === 1) endShieldOwnership(world);
  }

  if (player === null) return;

  // ── Press: start the Sword swipe for this fresh gesture ──────────────────
  if (gesture.pressEventFlag) {
    if (world.hasSwordWeaveUnlockedFlag === 1) {
      startNewSwordSwipe(world, player, gesture.gestureId, gesture.pressAimXWorld, gesture.pressAimYWorld);
    }
  }

  // ── Advance in-progress Sword swipe ──────────────────────────────────────
  if (world.newSwordActiveFlag === 1) {
    const completedThisTick = tickNewSwordSwipe(world);
    if (completedThisTick) onSwordSwipeCompleted(world);
  }

  // ── Shield forms while held once the Sword isn't blocking; the Bow arrow
  // assembles alongside it from the moment the Shield first forms. ──────────
  const isHeldPhase = gesture.phase === SecondaryWeaveGesturePhase.Press
    || gesture.phase === SecondaryWeaveGesturePhase.Holding;
  const shieldShouldBeActive =
    world.hasShieldWeaveUnlockedFlag === 1 &&
    isHeldPhase &&
    !_isSwordBlockingShield(world);

  if (shieldShouldBeActive) {
    const firstShieldTick = world.shieldWeaveIndependentActiveFlag === 0;
    world.shieldWeaveIndependentActiveFlag = 1;

    const aimDirX = gesture.holdAimXWorld - player.positionXWorld;
    const aimDirY = gesture.holdAimYWorld - player.positionYWorld;

    // The tick the Shield first forms is the schedule origin for the arrow.
    if (firstShieldTick && world.hasBowWeaveUnlockedFlag === 1) {
      beginBowArrowAssembly(world, world.tick, gesture.gestureId);
    }
    // Reserve/advance the arrow BEFORE the crescent so reserved motes (marked
    // BEHAVIOR_MODE_BOW_ARROW) are excluded from ordinary shield-slot placement.
    if (world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) {
      tickBowArrowAssembly(world, aimDirX, aimDirY);
    }
    applyShieldWeaveCrescent(world, player.positionXWorld, player.positionYWorld, aimDirX, aimDirY);
  } else if (world.shieldWeaveIndependentActiveFlag === 1) {
    endShieldOwnership(world);
  }

  // ── Release: fire the assembled arrow, or cancel it gracefully ───────────
  if (gesture.releaseEventFlag) {
    if (world.hasBowWeaveUnlockedFlag === 1 && world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) {
      const aimDirX = gesture.releaseAimXWorld - player.positionXWorld;
      const aimDirY = gesture.releaseAimYWorld - player.positionYWorld;
      // fireBowArrow only fires when ≥3 motes are loaded; otherwise cancel so a
      // partial one/two-mote arrow is never launched and no motes are stranded.
      if (!fireBowArrow(world, aimDirX, aimDirY)) {
        cancelBowArrow(world);
      }
    }
    if (world.shieldWeaveIndependentActiveFlag === 1) {
      endShieldOwnership(world);
    }
  }
}

/**
 * Called the tick the Sword swipe's animation finishes. Marks the
 * sword→shield transition as complete for rendering. If Shield is unlocked and
 * the button is still held, `applyShieldWeaveCrescent` picking up next tick IS
 * the handoff (same underlying particles, retargeted in place).
 */
function onSwordSwipeCompleted(world: WorldState): void {
  world.newSwordToShieldTransition01 = 1;
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

// Re-export for callers/tests that want to query arrow activity.
export { isBowArrowActive };
