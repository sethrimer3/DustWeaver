/**
 * timeStopFieldPlayerState.ts — Player Suspended-Momentum State.
 *
 * Tracks whether the player is currently inside a connected TimeStop Field
 * region and owns the "suspended momentum" contract described in the design:
 *
 *   Entering a connected field (outside → inside, exactly once per crossing):
 *     storedMomentum = player.velocity.clone()
 *     player.velocity.set(0, 0)
 *
 *   Leaving a connected field (inside → outside, exactly once per crossing):
 *     player.velocity.add(storedMomentum)
 *     storedMomentum.set(0, 0)
 *
 * Region membership is evaluated once per tick from the player's CENTER
 * point only (never the full AABB) against the cached connected-region set
 * (see timeStopFieldCache.ts). Using a single point means the player is
 * always in at most one region, which is what makes the "moving between
 * connected tiles must not retrigger" and "switching disconnected regions
 * releases-then-captures exactly once, same tick" requirements trivially
 * correct: the whole transition is one sequential release-then-capture
 * driven off "did the looked-up region id change since last tick".
 *
 * Teleportation policy (documented here per the task spec, since no special
 * teleport code exists): teleports in this codebase (see
 * gameCommandProcessor.ts's Lambda Anchor teleport) only mutate position and
 * always zero velocity — they never call this module directly. Because
 * `updateTimeStopFieldPlayerState` re-evaluates region membership from
 * scratch every tick using the player's CURRENT position, a teleport is
 * handled for free by the same generic logic on the very next tick:
 *   - Teleport from inside → outside: the region-id diff on the next tick
 *     detects "was inside, now outside" and releases stored momentum once
 *     (added into the velocity the teleport just zeroed).
 *   - Teleport from outside → inside: captures whatever velocity survived
 *     the teleport (0, since this codebase's teleports zero velocity) —
 *     safely a no-op capture of (0,0).
 *   No special-cased teleport handling is required or present.
 *
 * Death/respawn/room-load policy: `resetTimeStopFieldPlayerState` performs a
 * HARD CLEAR (no release) and must be called from the room-scoped state
 * reset that already runs on every room activation (see
 * gameLoadRoomPhases.ts's resetRoomScopedSimState) — the player's velocity
 * itself is reset to 0 by the fresh spawn, so silently dropping stale stored
 * momentum is correct and matches "respawn clears without applying".
 *
 * Room-transition policy: because a TimeStop Field region cannot span two
 * separate rooms' WorldState, `releaseTimeStopFieldMomentumIfActive` is
 * called once inside the transition-fire callback in
 * gameRoomTransitionOrchestrator.ts — i.e. only at the exact moment a
 * transition is CONFIRMED to fire, not every frame — treating a transition
 * as an implicit field exit, so momentum the player already earned is added
 * back (and carried into the new room's velocity) rather than silently
 * discarded. `resetTimeStopFieldPlayerState` then clears the (already-
 * released) state when the destination room activates.
 *
 * Region-identity policy across cache rebuilds: `activeRegionId` is a plain
 * array index that is only meaningful within the `TimeStopFieldRegionSet`
 * generation it was computed against. If the cache rebuilds while the
 * player is standing in a field, `updateTimeStopFieldPlayerState` rebinds
 * `activeRegionId` to the new generation's id for the SAME physical tile
 * instead of comparing indices across generations — see the inline comment
 * in that function.
 */

import type { WorldState } from '../world';
import { getTimeStopFieldRegions } from './timeStopFieldCache';
import { encodeTimeStopTileKey, worldToTimeStopGrid, type TimeStopFieldRegionSet } from './timeStopFieldBuilder';
import {
  TIME_STOP_ENTRY_TRANSITION_TICKS,
  TIME_STOP_EXIT_TRANSITION_TICKS,
} from './timeStopFieldConfig';

export interface TimeStopFieldPlayerState {
  /** 1 while the player's center point is inside a connected TimeStop Field region this tick. */
  isInsideFieldFlag: 0 | 1;
  /** Region id (from the current cache generation) the player is inside, or -1 when outside. */
  activeRegionId: number;
  /** 1 while a suspended-momentum vector is currently stored. */
  hasStoredMomentumFlag: 0 | 1;
  /** Suspended world-space velocity captured at the moment of entry. */
  storedMomentumXWorld: number;
  storedMomentumYWorld: number;
  /**
   * Smoothly-animated 0..1 visual intensity for the field glow + inversion
   * compositor. Follows `isInsideFieldFlag` with the configured entry/exit
   * transition duration. Purely cosmetic — never gates gameplay logic.
   */
  visualIntensity: number;
  /** Debug/testing aid: incremented exactly once per capture. */
  entrySequence: number;
  /** Debug/testing aid: incremented exactly once per release. */
  exitSequence: number;
  /**
   * Internal bookkeeping only — never read by gameplay or rendering code
   * outside this module, never serialized. Reference to the
   * `TimeStopFieldRegionSet` that `activeRegionId` was last computed
   * against. `activeRegionId` is a plain array index into
   * `TimeStopFieldRegionSet.regions`, which is ONLY meaningful within the
   * generation it came from — BFS region numbering can (and does) reshuffle
   * across a cache rebuild even when the underlying tile geometry the
   * player is standing on hasn't actually changed (Set iteration order
   * depends on insertion order, which can differ between rebuilds). See the
   * rebind check inside `updateTimeStopFieldPlayerState` for how this is
   * used to avoid treating a mere renumbering as a false exit+entry event.
   */
  _lastRegionSet: TimeStopFieldRegionSet | null;
}

export function createTimeStopFieldPlayerState(): TimeStopFieldPlayerState {
  return {
    isInsideFieldFlag: 0,
    activeRegionId: -1,
    hasStoredMomentumFlag: 0,
    storedMomentumXWorld: 0,
    storedMomentumYWorld: 0,
    visualIntensity: 0,
    entrySequence: 0,
    exitSequence: 0,
    _lastRegionSet: null,
  };
}

/**
 * Hard-clears all TimeStop Field player state WITHOUT releasing stored
 * momentum into velocity. Use on respawn/death/room-load, where the
 * player's velocity is independently reset to zero by the fresh spawn.
 */
export function resetTimeStopFieldPlayerState(state: TimeStopFieldPlayerState): void {
  state.isInsideFieldFlag = 0;
  state.activeRegionId = -1;
  state.hasStoredMomentumFlag = 0;
  state.storedMomentumXWorld = 0;
  state.storedMomentumYWorld = 0;
  state.visualIntensity = 0;
  state._lastRegionSet = null;
}

function finiteOrZero(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function releaseInto(
  state: TimeStopFieldPlayerState,
  player: { velocityXWorld: number; velocityYWorld: number },
): void {
  player.velocityXWorld += state.storedMomentumXWorld;
  player.velocityYWorld += state.storedMomentumYWorld;
  state.hasStoredMomentumFlag = 0;
  state.storedMomentumXWorld = 0;
  state.storedMomentumYWorld = 0;
  state.exitSequence++;
}

function captureFrom(
  state: TimeStopFieldPlayerState,
  player: { velocityXWorld: number; velocityYWorld: number },
): void {
  state.storedMomentumXWorld = finiteOrZero(player.velocityXWorld);
  state.storedMomentumYWorld = finiteOrZero(player.velocityYWorld);
  state.hasStoredMomentumFlag = 1;
  player.velocityXWorld = 0;
  player.velocityYWorld = 0;
  state.entrySequence++;
}

/**
 * Releases any currently-stored momentum into the player's velocity exactly
 * once, without waiting for the next tick's region re-evaluation. Used by
 * the room-transition hook (a field region cannot span rooms) and by
 * dynamic-field-removal handling. Safe to call when nothing is stored (no-op).
 */
export function releaseTimeStopFieldMomentumIfActive(
  world: WorldState,
): void {
  const state = world.timeStopField;
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
  if (state.activeRegionId === -1 && state.hasStoredMomentumFlag === 0) return;
  if (player !== undefined) releaseInto(state, player);
  else { state.hasStoredMomentumFlag = 0; state.storedMomentumXWorld = 0; state.storedMomentumYWorld = 0; }
  state.activeRegionId = -1;
  state.isInsideFieldFlag = 0;
  state._lastRegionSet = null;
}

/**
 * Per-tick update: evaluates the player's current connected-region
 * membership, performs the capture/release transaction on region-id change
 * (exactly once per crossing — moving between tiles of the SAME connected
 * region never re-triggers since the region id is unchanged), and advances
 * the cosmetic visual-intensity transition.
 *
 * Call once per tick, after movement/collision has finalised this tick's
 * velocity and position (see tick.ts).
 */
export function updateTimeStopFieldPlayerState(world: WorldState): void {
  const state = world.timeStopField;
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;

  if (player === undefined || player.isAliveFlag === 0) {
    // Death (or no player cluster yet): clear immediately without releasing,
    // so the arrow/inversion effect disappears the instant the player dies
    // rather than lingering until the respawn room-load reset runs.
    if (state.activeRegionId !== -1 || state.hasStoredMomentumFlag === 1) {
      resetTimeStopFieldPlayerState(state);
    } else {
      // Still let the visual intensity relax toward 0 even with no active state.
      stepVisualIntensity(state, false);
    }
    return;
  }

  const regionSet = getTimeStopFieldRegions(world);
  const { gx, gy } = worldToTimeStopGrid(player.positionXWorld, player.positionYWorld);
  const newRegionId = regionSet.regions.length === 0
    ? -1
    : (regionSet.tileToRegion.get(encodeTimeStopTileKey(gx, gy)) ?? -1);

  // The region cache was rebuilt since we last evaluated (room-scoped reset
  // normally guarantees this can't coincide with an active region today —
  // see the module docblock — but this guard makes the logic correct even
  // if a future caller marks the cache dirty during live occupancy, e.g. a
  // runtime field edit or region merge/split while the player stands on it).
  // `activeRegionId` is a bare array index into the OLD regions array and is
  // therefore meaningless when compared against ids from a NEW regionSet —
  // BFS numbering can reshuffle across a rebuild even when the tile the
  // player is standing on didn't actually change. Rebind instead of
  // comparing indices across generations, so an incidental rebuild (or a
  // region merge that swallows the player's region into a bigger one) never
  // produces a false exit+entry event.
  const regionSetChanged = regionSet !== state._lastRegionSet;
  if (regionSetChanged && state.activeRegionId !== -1 && newRegionId !== -1) {
    state.activeRegionId = newRegionId;
    state._lastRegionSet = regionSet;
    stepVisualIntensity(state, true);
    return;
  }

  if (newRegionId !== state.activeRegionId) {
    // Deterministic ordering: release the old region's momentum BEFORE
    // capturing the new region's entry velocity, so a same-tick crossing
    // between two disconnected regions never captures a stale/blended
    // velocity and never double-releases.
    if (state.activeRegionId !== -1) releaseInto(state, player);
    if (newRegionId !== -1) captureFrom(state, player);
    state.activeRegionId = newRegionId;
    state.isInsideFieldFlag = newRegionId !== -1 ? 1 : 0;
  }
  state._lastRegionSet = regionSet;

  stepVisualIntensity(state, state.isInsideFieldFlag === 1);
}

function stepVisualIntensity(state: TimeStopFieldPlayerState, active: boolean): void {
  const target = active ? 1 : 0;
  const ticks = active ? TIME_STOP_ENTRY_TRANSITION_TICKS : TIME_STOP_EXIT_TRANSITION_TICKS;
  const step = 1 / Math.max(1, ticks);
  if (state.visualIntensity < target) {
    state.visualIntensity = Math.min(target, state.visualIntensity + step);
  } else if (state.visualIntensity > target) {
    state.visualIntensity = Math.max(target, state.visualIntensity - step);
  }
}
