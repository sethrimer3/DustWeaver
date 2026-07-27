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
import { updateShieldWeaveState, deactivateShieldWeave } from '../stormweave/shieldWeave';
import { getAvailableCanonicalMotes, MoteOwnershipState } from './moteOwnership';
import { MAX_CANONICAL_MOTES } from '../world';
import {
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  latchBowArrowRelease,
  tryResolveLatchedBowArrowRelease,
  cancelBowArrow,
  tickBowArrowOutbound,
  resetBowArrowState,
  isBowArrowActive,
  BOW_ARROW_PHASE_ASSEMBLING,
  BOW_ARROW_PHASE_OUTBOUND,
} from './bowArrow';
import { WEAVE_ARROW, WEAVE_SHIELD, WEAVE_SWORD, WEAVE_SHIELD_SWORD } from './weaveDefinition';

function _hasSwordUnlocked(world: WorldState): boolean {
  return world.hasSwordWeaveUnlockedFlag === 1 ||
    world.playerSecondaryWeaveId === WEAVE_SWORD ||
    world.playerSecondaryWeaveId === WEAVE_SHIELD_SWORD;
}

function _hasShieldUnlocked(world: WorldState): boolean {
  return world.hasShieldWeaveUnlockedFlag === 1 ||
    world.playerSecondaryWeaveId === WEAVE_SHIELD ||
    world.playerSecondaryWeaveId === WEAVE_SHIELD_SWORD ||
    world.playerSecondaryWeaveId === WEAVE_ARROW;
}

function _hasBowUnlocked(world: WorldState): boolean {
  return world.hasBowWeaveUnlockedFlag === 1 ||
    world.playerSecondaryWeaveId === WEAVE_ARROW;
}

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
    // A release latch (task section 6) can leave a PREVIOUS gesture's arrow
    // still ASSEMBLING (motes reserved, in BEHAVIOR_MODE_BOW_ARROW) after that
    // gesture has otherwise gone idle, since seating can take a few more
    // ticks to finish. A brand-new press always supersedes it — cancel it
    // here (releasing its motes back to Storm) BEFORE the new gesture's Sword
    // swipe reserves motes, so the same particle can never be claimed by both
    // an old latched Bow arrow and a new Sword swipe at once.
    if (world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) cancelBowArrow(world);
    if (_hasSwordUnlocked(world)) {
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
    _hasShieldUnlocked(world) &&
    isHeldPhase &&
    !_isSwordBlockingShield(world);

  if (shieldShouldBeActive) {
    const firstShieldTick = world.shieldWeaveIndependentActiveFlag === 0;
    world.shieldWeaveIndependentActiveFlag = 1;

    const aimDirX = gesture.holdAimXWorld - player.positionXWorld;
    const aimDirY = gesture.holdAimYWorld - player.positionYWorld;

    // The tick the Shield first forms is the schedule origin for the arrow.
    if (firstShieldTick && _hasBowUnlocked(world)) {
      beginBowArrowAssembly(world, world.tick, gesture.gestureId);
    }
    // Reserve/advance the arrow BEFORE the crescent so reserved motes (marked
    // BEHAVIOR_MODE_BOW_ARROW) are excluded from ordinary shield-slot placement.
    if (world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) {
      tickBowArrowAssembly(world, aimDirX, aimDirY, /* isHeld */ true);
    }
    const avail = getAvailableCanonicalMotes(world);
    world.shieldWeave.isHeldRequested = true;
    updateShieldWeaveState(
      world.shieldWeave,
      1 / 60,
      avail.count,
      player.positionXWorld,
      player.positionYWorld,
      player.halfHeightWorld * 2,
      aimDirX,
      aimDirY,
    );
    for (let i = 0; i < avail.count; i++) {
      const idx = avail.indices[i];
      if (idx < MAX_CANONICAL_MOTES) {
        world.canonicalMoteOwnership[idx] = MoteOwnershipState.Shield;
      }
    }
  } else {
    if (world.shieldWeaveIndependentActiveFlag === 1) {
      endShieldOwnership(world);
    }
    // The gesture is no longer actively held (idle, or mid-sword-swipe
    // suppression), but an arrow may still have motes mid-arc from before
    // release, or be waiting on a release latch — keep seating them (no new
    // motes are pulled while not held; see tickBowArrowAssembly's `isHeld`
    // gate) so a latched release can resolve and a plain cancel never leaves
    // a mote frozen mid-animation.
    if (world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) {
      tickBowArrowAssembly(world, world.bowArrowDirXWorld, world.bowArrowDirYWorld, /* isHeld */ false);
    }
  }

  // ── Resolve a pending release latch as soon as enough motes finish seating. ─
  if (world.bowArrowReleaseLatchedFlag === 1) {
    tryResolveLatchedBowArrowRelease(world);
  }

  // ── Release: fire the assembled arrow if enough motes are seated, latch a
  // pending fire if enough are reserved but still seating, or cancel outright
  // if fewer than the minimum are even reserved (task section 6). ──────────
  if (gesture.releaseEventFlag) {
    if (_hasBowUnlocked(world) && world.bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING) {
      const aimDirX = gesture.releaseAimXWorld - player.positionXWorld;
      const aimDirY = gesture.releaseAimYWorld - player.positionYWorld;
      if (!fireBowArrow(world, aimDirX, aimDirY)) {
        if (!latchBowArrowRelease(world, aimDirX, aimDirY)) {
          cancelBowArrow(world);
        }
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
  deactivateShieldWeave(world.shieldWeave);
  for (let i = 0; i < MAX_CANONICAL_MOTES; i++) {
    if (world.canonicalMoteOwnership[i] === MoteOwnershipState.Shield) {
      world.canonicalMoteOwnership[i] = MoteOwnershipState.Resting;
    }
  }
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
