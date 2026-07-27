/**
 * Canonical Mote Ownership — Authoritative ability ownership layer for canonical player motes.
 *
 * Replaces the legacy ordered combat-mote queue and physical orbit particles with a deterministic,
 * allocation-conscious model indexed directly by canonical mote ID (0..getPlayerMoteCount(player)-1).
 * Each mote exists in exactly one conceptual state at a time.
 */

import type { WorldState } from '../world';
import { getPlayerMoteCount } from '../playerMoteLife';
import { MAX_CANONICAL_MOTES } from '../world';

/** Authoritative ownership states for canonical player motes. */
export enum MoteOwnershipState {
  Resting = 0,       // Normal Stormweave following / available for Shield or abilities
  Sword = 1,         // Owned by active Sword swipe
  Shield = 2,        // Owned by canonical Shield Weave
  BowAssembling = 3, // Reserved / assembling for Bow Weave
  BowOutbound = 4,   // In flight as an outbound Bow arrow
}

/** Allocation-free container for available canonical mote indices. */
export interface AvailableCanonicalMotes {
  count: number;
  readonly indices: Int32Array;
}

const _availableMoteIndices = new Int32Array(32); // MAX_CANONICAL_MOTES
const _availableResult: AvailableCanonicalMotes = {
  count: 0,
  indices: _availableMoteIndices,
};

/**
 * Returns a deterministic, zero-allocation list of canonical mote indices currently
 * available for secondary weave abilities (Sword or Bow).
 * Motes currently Resting or forming the Shield crescent are available to be claimed
 * by active secondary abilities (e.g. Bow arrow assembly). Once claimed by Sword or Bow,
 * they are automatically sequestered and excluded from simultaneous usage.
 */
export function getAvailableCanonicalMotes(world: WorldState): AvailableCanonicalMotes {
  let playerCount = 0;
  for (let i = 0; i < world.clusters.length; i++) {
    const c = world.clusters[i];
    if (c.isAliveFlag === 1 && c.isPlayerFlag === 1) {
      playerCount = getPlayerMoteCount(c);
      break;
    }
  }
  const maxCount = Math.min(playerCount, MAX_CANONICAL_MOTES);
  let count = 0;
  for (let idx = 0; idx < maxCount; idx++) {
    const state = world.canonicalMoteOwnership[idx];
    if (state === MoteOwnershipState.Resting || state === MoteOwnershipState.Shield) {
      _availableMoteIndices[count++] = idx;
    }
  }
  _availableResult.count = count;
  return _availableResult;
}

/**
 * Reconciles canonical mote count against current player life when damage or max capacity alters mote availability.
 * Guaranteed zero allocation and safe against sudden health drops or expansions.
 */
export function reconcileCanonicalMoteOwnership(world: WorldState): void {
  let playerCount = 0;
  for (let i = 0; i < world.clusters.length; i++) {
    const c = world.clusters[i];
    if (c.isAliveFlag === 1 && c.isPlayerFlag === 1) {
      playerCount = getPlayerMoteCount(c);
      break;
    }
  }
  const currentCount = Math.min(playerCount, MAX_CANONICAL_MOTES);
  // Any mote index beyond current player health must immediately release ability ownership
  for (let idx = currentCount; idx < MAX_CANONICAL_MOTES; idx++) {
    world.canonicalMoteOwnership[idx] = MoteOwnershipState.Resting;
  }
}

/** Legacy alias to transition old imports smoothly without reviving the queue. */
export { getAvailableCanonicalMotes as getAvailableOrderedMoteSlots };
