/**
 * poisonExposureState.ts — Deterministic Poison Field exposure controller.
 *
 * Owns the player's poison-vulnerability exposure state: whether the player
 * currently overlaps ANY authored Poison Field rectangle (overlapping
 * multiple fields is ONE exposure — no stacked timers, no stacked damage),
 * how much continuous vulnerable time has elapsed, and whether the previous
 * tick's equipped dust type was Verdant (immune) so a Verdant→non-Verdant
 * transition while still inside a field can be detected and dealt its single
 * immediate hit.
 *
 * Contract (see docs/Todo.md Poison Field item for the full spec):
 *   - Entry (vulnerable): no immediate damage; timer begins at 0.
 *   - First damage tick at exactly 3.0s of continuous vulnerable exposure,
 *     then every 3.0s thereafter, for as long as exposure remains continuous.
 *   - Verdant Dust equipped while inside: fully immune. No damage, no timer
 *     advance, and any in-progress exposure is cancelled (not banked).
 *   - Switching from Verdant to any non-Verdant dust while still inside a
 *     Poison Field: exactly one immediate hit, then a fresh 3.0s cadence
 *     starting from that moment. Switching between two non-Verdant dust
 *     kinds never deals an immediate hit.
 *   - Leaving all Poison Fields resets exposure state entirely; re-entering
 *     starts a fresh 3.0s grace period.
 *   - Large ticks / timestep subdivision: elapsed time accumulates
 *     additively regardless of how the caller slices dt, and a single
 *     update() call fires as many scheduled ticks as the elapsed time
 *     crosses (bounded — stops immediately if the player dies mid-loop).
 *
 * State lives in WorldState (deterministic sim), never in the renderer.
 * Storage is intentionally narrow — a single elapsed-time counter and a
 * hit counter, NOT one timer per overlapping field (see module docblock in
 * roomDef.ts / worldHazardState.ts for the authoring-data-only rectangle
 * arrays this reads).
 */

import type { WorldState } from '../world';
import { isVerdantDustEquipped } from '../clusters/verdantMobility';
import { overlapAABB } from '../physics/collision';
import { applyPlayerDamageWithKnockback, type PlayerDamageTarget } from '../playerDamage';
import {
  POISON_TICK_INTERVAL_SECONDS,
  POISON_DAMAGE_PER_TICK,
  POISON_THRESHOLD_EPSILON_SECONDS,
} from './poisonFieldConfig';

export interface PoisonExposureState {
  /** 1 while the player was overlapping at least one Poison Field on the previous processed tick. */
  isInsideFieldFlag: 0 | 1;
  /** Continuous vulnerable-exposure seconds accumulated since entry (or since the last Verdant-switch-away reset). */
  elapsedSeconds: number;
  /** Number of scheduled damage ticks already fired for the current continuous exposure. */
  hitsFired: number;
  /** 1 if Verdant Dust was the equipped type on the previous tick while inside a field (used to detect switch-away). */
  wasVerdantLastTick: 0 | 1;
}

export function createPoisonExposureState(): PoisonExposureState {
  return {
    isInsideFieldFlag: 0,
    elapsedSeconds: 0,
    hitsFired: 0,
    wasVerdantLastTick: 0,
  };
}

/** Full reset with no damage — use on room load, respawn, death, resident transfer, or leaving all fields. */
export function resetPoisonExposureState(state: PoisonExposureState): void {
  state.isInsideFieldFlag = 0;
  state.elapsedSeconds = 0;
  state.hitsFired = 0;
  state.wasVerdantLastTick = 0;
}

/**
 * True when the player's hitbox AABB overlaps at least one authored Poison
 * Field rectangle this tick. Multiple overlapping fields collapse to a
 * single boolean — callers must never loop this into per-field damage.
 */
export function isPlayerInsidePoisonField(
  world: WorldState,
  player: { positionXWorld: number; positionYWorld: number; halfWidthWorld: number; halfHeightWorld: number },
): boolean {
  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const phw = player.halfWidthWorld;
  const phh = player.halfHeightWorld;
  for (let i = 0; i < world.poisonFieldCount; i++) {
    const left = world.poisonFieldXWorld[i];
    const top = world.poisonFieldYWorld[i];
    const right = left + world.poisonFieldWWorld[i];
    const bottom = top + world.poisonFieldHWorld[i];
    if (overlapAABB(px, py, phw, phh, left, top, right, bottom)) return true;
  }
  return false;
}

function dealPoisonHit(player: PlayerDamageTarget): void {
  applyPlayerDamageWithKnockback(
    player,
    POISON_DAMAGE_PER_TICK,
    player.positionXWorld,
    player.positionYWorld,
    { bypassContactInvulnerability: true },
  );
}

/**
 * Per-tick update. Call once per simulation tick (see hazards.ts), after
 * movement/collision has finalised this tick's player position, and only
 * while the game is actively simulating (paused/frozen frames must never
 * call this — the fixed-tick pipeline already guarantees this by not
 * invoking applyHazards while paused).
 */
export function updatePoisonExposure(world: WorldState, dtSeconds: number): void {
  const state = world.poisonExposure;
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;

  if (player === undefined || player.isAliveFlag === 0) {
    resetPoisonExposureState(state);
    return;
  }

  const inside = isPlayerInsidePoisonField(world, player);
  if (!inside) {
    if (state.isInsideFieldFlag === 1) resetPoisonExposureState(state);
    return;
  }

  const verdant = isVerdantDustEquipped(world);
  const firstTickInside = state.isInsideFieldFlag === 0;

  if (firstTickInside) {
    state.isInsideFieldFlag = 1;
    state.elapsedSeconds = 0;
    state.hitsFired = 0;
    state.wasVerdantLastTick = verdant ? 1 : 0;
    if (verdant) return; // immune entry: no damage, no accumulation
    // Fresh non-verdant entry: fall through to normal accumulation below.
  } else if (verdant) {
    // Continuously immune: cancel any in-progress exposure, no banking.
    state.elapsedSeconds = 0;
    state.hitsFired = 0;
    state.wasVerdantLastTick = 1;
    return;
  } else if (state.wasVerdantLastTick === 1) {
    // Verdant -> non-Verdant transition while still inside: exactly one
    // immediate hit, then a fresh 3.0s cadence starting NOW (no dt applied
    // this tick, so the next scheduled hit lands 3.0s from this moment).
    state.wasVerdantLastTick = 0;
    dealPoisonHit(player);
    state.elapsedSeconds = 0;
    state.hitsFired = 0;
    if (!player.isAliveFlag) resetPoisonExposureState(state);
    return;
  } else {
    state.wasVerdantLastTick = 0;
  }

  // Normal vulnerable accumulation — handles timestep subdivision and large
  // ticks uniformly: elapsed time is additive regardless of dt slicing, and
  // the while loop below fires every threshold crossed in one call.
  state.elapsedSeconds += dtSeconds;
  while (
    state.elapsedSeconds >=
    (state.hitsFired + 1) * POISON_TICK_INTERVAL_SECONDS - POISON_THRESHOLD_EPSILON_SECONDS
  ) {
    dealPoisonHit(player);
    state.hitsFired++;
    if (!player.isAliveFlag) {
      resetPoisonExposureState(state);
      return;
    }
  }
}
