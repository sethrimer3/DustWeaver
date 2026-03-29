/**
 * Player Loadout — Weave equipment and dust binding.
 *
 * The loadout defines:
 *   - Primary Weave (left click)
 *   - Secondary Weave (right click)
 *   - Which dust types are bound to each Weave
 *   - Validation that dust assignments do not exceed Weave slot capacity
 *
 * Example:
 *   Primary: Spire Weave (3 dust slots)
 *     Bound: Flame Dust (2 slots) + Steel Dust (1 slot) = 3/3
 *   Secondary: Aegis Weave (4 dust slots)
 *     Bound: Water Dust (2 slots) + Wind Dust (2 slots) = 4/4
 */

import { ParticleKind } from '../particles/kinds';
import { WeaveId, getWeaveDefinition, WEAVE_SPIRE, WEAVE_AEGIS } from './weaveDefinition';
import { getDustSlotCost } from './dustDefinition';

// ---- Weave Binding ---------------------------------------------------------

/** Dust types bound to a single Weave. */
export interface WeaveBinding {
  /** ID of the equipped Weave. */
  weaveId: WeaveId;
  /** Dust types assigned to this Weave. Order matters for display. */
  boundDust: ParticleKind[];
}

// ---- Player Loadout --------------------------------------------------------

export interface PlayerWeaveLoadout {
  /** Primary Weave binding (left click). */
  primary: WeaveBinding;
  /** Secondary Weave binding (right click). */
  secondary: WeaveBinding;
}

// ---- Validation ------------------------------------------------------------

/** Returns the total slot cost of dust bound to a weave binding. */
export function getBindingSlotCost(binding: WeaveBinding): number {
  let total = 0;
  for (let i = 0; i < binding.boundDust.length; i++) {
    total += getDustSlotCost(binding.boundDust[i]);
  }
  return total;
}

/** Returns true if the binding's dust fits within the weave's slot capacity. */
export function isBindingValid(binding: WeaveBinding): boolean {
  const capacity = getWeaveDefinition(binding.weaveId).dustSlotCapacity;
  return getBindingSlotCost(binding) <= capacity;
}

/** Returns true if the entire loadout is valid (both bindings fit). */
export function isLoadoutValid(loadout: PlayerWeaveLoadout): boolean {
  return isBindingValid(loadout.primary) && isBindingValid(loadout.secondary);
}

/**
 * Returns the remaining slot capacity for a weave binding.
 * Negative means over budget.
 */
export function getRemainingSlots(binding: WeaveBinding): number {
  const capacity = getWeaveDefinition(binding.weaveId).dustSlotCapacity;
  return capacity - getBindingSlotCost(binding);
}

/**
 * Attempts to add a dust type to a weave binding.
 * Returns a new binding if the dust fits; returns the original binding if it would exceed capacity.
 */
export function addDustToBinding(binding: WeaveBinding, kind: ParticleKind): WeaveBinding {
  const newBound = [...binding.boundDust, kind];
  const newBinding: WeaveBinding = { weaveId: binding.weaveId, boundDust: newBound };
  if (!isBindingValid(newBinding)) return binding;
  return newBinding;
}

/**
 * Removes one occurrence of a dust type from a weave binding.
 * Returns a new binding.
 */
export function removeDustFromBinding(binding: WeaveBinding, kind: ParticleKind): WeaveBinding {
  const idx = binding.boundDust.indexOf(kind);
  if (idx === -1) return binding;
  const newBound = binding.boundDust.slice();
  newBound.splice(idx, 1);
  return { weaveId: binding.weaveId, boundDust: newBound };
}

/**
 * Collects all unique dust kinds across both weave bindings in the loadout.
 * Used for spawning the correct particle types.
 */
export function getAllBoundDust(loadout: PlayerWeaveLoadout): ParticleKind[] {
  const seen = new Set<ParticleKind>();
  const result: ParticleKind[] = [];
  for (const kind of loadout.primary.boundDust) {
    if (!seen.has(kind)) { seen.add(kind); result.push(kind); }
  }
  for (const kind of loadout.secondary.boundDust) {
    if (!seen.has(kind)) { seen.add(kind); result.push(kind); }
  }
  return result;
}

/**
 * Returns the flat list of all dust kinds (with duplicates for particle counts)
 * from both bindings. Used for determining how many particles of each type to spawn.
 */
export function getAllBoundDustFlat(loadout: PlayerWeaveLoadout): ParticleKind[] {
  return [...loadout.primary.boundDust, ...loadout.secondary.boundDust];
}

// ---- Default loadout -------------------------------------------------------

/**
 * Creates the default starting loadout for a new game.
 *
 * Primary: Spire Weave with Flame Dust (2 slots) + Steel/Physical Dust (1 slot) = 3/3
 * Secondary: Aegis Weave with Water Dust (2 slots) + Wind Dust (2 slots) = 4/4
 */
export function createDefaultWeaveLoadout(): PlayerWeaveLoadout {
  return {
    primary: {
      weaveId: WEAVE_SPIRE,
      boundDust: [ParticleKind.Fire, ParticleKind.Physical],
    },
    secondary: {
      weaveId: WEAVE_AEGIS,
      boundDust: [ParticleKind.Water, ParticleKind.Wind],
    },
  };
}

// ---- Weave slot index for particles ----------------------------------------

/** Identifies which weave slot a particle is bound to. */
export const WEAVE_SLOT_NONE      = 0;
export const WEAVE_SLOT_PRIMARY   = 1;
export const WEAVE_SLOT_SECONDARY = 2;
