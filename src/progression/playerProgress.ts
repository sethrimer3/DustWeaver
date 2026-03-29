/**
 * Player progression state — level, dust slots, loadout, and world progress.
 */

import { ParticleKind } from '../sim/particles/kinds';
import { getSlotCost, totalSlotCost } from '../sim/particles/slotCost';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout } from '../sim/weaves/playerLoadout';

export { getSlotCost, totalSlotCost };

// ---- Slot table per level -----------------------------------------------

/**
 * Dust slots available at each level (index = level number).
 * Level 0 is unused; level 1 starts at 5 slots.
 */
const DUST_SLOTS_PER_LEVEL: number[] = [0, 5, 7, 10, 14, 20];

/** Maximum supported level. */
export const MAX_LEVEL = DUST_SLOTS_PER_LEVEL.length - 1;

/** Returns the number of dust slots available at the given level. */
export function getDustSlots(level: number): number {
  const clamped = Math.max(1, Math.min(level, MAX_LEVEL));
  return DUST_SLOTS_PER_LEVEL[clamped] ?? DUST_SLOTS_PER_LEVEL[MAX_LEVEL];
}

// ---- State type ----------------------------------------------------------

export interface PlayerProgress {
  /** Current player level (1–MAX_LEVEL). */
  level: number;
  /** Total dust slots available at this level. */
  dustSlots: number;
  /** Currently equipped particle kinds (legacy — kept for backward compat). */
  loadout: ParticleKind[];
  /** Weave-based loadout with primary/secondary weave bindings and bound dust. */
  weaveLoadout: PlayerWeaveLoadout;
  /**
   * Number of World 1 levels unlocked (1 = only L1 available, 7 = all unlocked).
   * Increases by 1 each time the player completes a level.
   */
  world1UnlockedCount: number;
  /**
   * Number of World 2 levels unlocked (0 = World 2 locked, 1 = L1 available, etc.).
   * Unlocks to 1 when the player completes World 1 boss (level 7).
   */
  world2UnlockedCount: number;
  /** Set of room IDs the player has visited (used for the world map). */
  exploredRoomIds: string[];
  /** Room ID of the last save point used (for "Return to Last Save"). */
  lastSaveRoomId: string | null;
  /** Block coordinates of the last save point used. */
  lastSaveSpawnBlock: [number, number] | null;
}

// ---- Factory / helpers ---------------------------------------------------

/**
 * Creates the default starting PlayerProgress (level 1, Fire + Ice loadout).
 * Total slot cost = 2 (Fire) + 2 (Ice) = 4, which fits within the 5-slot budget.
 * Only World 1 Level 1 is unlocked initially.
 */
export function createDefaultProgress(): PlayerProgress {
  const level = 1;
  const weaveLoadout = createDefaultWeaveLoadout();
  return {
    level,
    dustSlots: getDustSlots(level),
    loadout: [ParticleKind.Fire, ParticleKind.Ice],
    weaveLoadout,
    world1UnlockedCount: 1,
    world2UnlockedCount: 0,
    exploredRoomIds: [],
    lastSaveRoomId: null,
    lastSaveSpawnBlock: null,
  };
}

/**
 * Returns true if `kinds` fits within the player's current dust slot budget.
 */
export function loadoutFits(
  kinds: ReadonlyArray<ParticleKind>,
  dustSlots: number,
): boolean {
  return totalSlotCost(kinds) <= dustSlots;
}

/**
 * Adds `kind` to the loadout if it fits within the slot budget.
 * Returns a new array (does not mutate the input).
 */
export function addToLoadout(
  loadout: ParticleKind[],
  kind: ParticleKind,
  dustSlots: number,
): ParticleKind[] {
  const next = [...loadout, kind];
  return loadoutFits(next, dustSlots) ? next : loadout;
}

/**
 * Removes one occurrence of `kind` from the loadout.
 * Returns a new array (does not mutate the input).
 */
export function removeFromLoadout(
  loadout: ParticleKind[],
  kind: ParticleKind,
): ParticleKind[] {
  const idx = loadout.indexOf(kind);
  if (idx === -1) return loadout;
  const next = loadout.slice();
  next.splice(idx, 1);
  return next;
}
