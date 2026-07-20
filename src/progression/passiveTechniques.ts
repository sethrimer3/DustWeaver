/**
 * Legacy passive-technique identifiers retained for save/campaign compatibility.
 *
 * Cycle was retired when its dust-attraction/orbit behavior became the Storm
 * Weave. It must not be offered by the editor or applied to player progression.
 * The legacy registry entry remains only so older campaign files containing
 * `startingPassives: ['cycle']` continue to validate and load.
 */

// ---- Legacy Passive Technique IDs -------------------------------------------

/** Legacy identifiers accepted while reading older campaign data. */
export type PassiveTechniqueId = 'cycle';

/**
 * Passive techniques currently available to players or campaign authors.
 * Empty because Cycle was replaced by the Storm Weave.
 */
export const ALL_PASSIVE_TECHNIQUE_IDS: readonly PassiveTechniqueId[] = [];

// ---- Legacy Definition -------------------------------------------------------

export interface PassiveTechniqueDefinition {
  /** Legacy identifier. */
  id: PassiveTechniqueId;
  /** Display name retained for diagnostics and old data inspection. */
  displayName: string;
  /** Explanation of the retired identifier. */
  description: string;
}

/**
 * Legacy definitions accepted by campaign validation only. These entries are
 * deliberately excluded from ALL_PASSIVE_TECHNIQUE_IDS and are never granted.
 */
export const PASSIVE_TECHNIQUE_DEFINITIONS: ReadonlyMap<PassiveTechniqueId, PassiveTechniqueDefinition> = new Map([
  ['cycle', {
    id: 'cycle',
    displayName: 'Cycle (Deprecated)',
    description: 'Deprecated legacy passive. Storm Weave now provides dust attraction and orbit behavior.',
  }],
]);

// ---- Helpers ----------------------------------------------------------------

/** Returns the legacy definition for a passive-technique identifier. */
export function getPassiveTechniqueDefinition(id: PassiveTechniqueId): PassiveTechniqueDefinition {
  return PASSIVE_TECHNIQUE_DEFINITIONS.get(id) ?? {
    id,
    displayName: 'Unknown',
    description: 'Unknown passive technique.',
  };
}
