/**
 * Passive Techniques — abilities that are always active once unlocked.
 *
 * Passive techniques are a SEPARATE category from active weaves.
 * They are NOT assigned to left-click or right-click slots.
 * They do NOT appear in the weave equip UI.
 * Once unlocked, they are always active (no toggle required).
 *
 * Example: Cycle — owned dust particles orbit and swirl around the player.
 */

// ---- Passive Technique IDs -------------------------------------------------

/** Unique identifiers for each passive technique. */
export type PassiveTechniqueId = 'cycle';

/** Registry of all passive technique IDs for iteration. */
export const ALL_PASSIVE_TECHNIQUE_IDS: readonly PassiveTechniqueId[] = ['cycle'];

// ---- Passive Technique Definition ------------------------------------------

export interface PassiveTechniqueDefinition {
  /** Unique identifier. */
  id: PassiveTechniqueId;
  /** Display name for UI. */
  displayName: string;
  /** Short description of what this technique does. */
  description: string;
}

/** All passive technique definitions. */
export const PASSIVE_TECHNIQUE_DEFINITIONS: ReadonlyMap<PassiveTechniqueId, PassiveTechniqueDefinition> = new Map([
  ['cycle', {
    id: 'cycle',
    displayName: 'Cycle',
    description: 'Owned dust particles are attracted toward you and swirl in orbit around your body.',
  }],
]);

// ---- Helpers ---------------------------------------------------------------

/** Returns the definition for a given passive technique ID. */
export function getPassiveTechniqueDefinition(id: PassiveTechniqueId): PassiveTechniqueDefinition {
  return PASSIVE_TECHNIQUE_DEFINITIONS.get(id) ?? {
    id,
    displayName: 'Unknown',
    description: 'Unknown passive technique.',
  };
}

/** Returns true if the given technique ID is unlocked in the provided set. */
export function isPassiveTechniqueUnlocked(
  unlockedTechniques: readonly PassiveTechniqueId[],
  id: PassiveTechniqueId,
): boolean {
  return unlockedTechniques.indexOf(id) !== -1;
}
