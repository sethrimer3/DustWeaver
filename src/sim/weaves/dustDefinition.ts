/**
 * Dust Definition Layer.
 *
 * Each dust type defines its identity, visual theme, passive motion profile,
 * and slot cost. Dust types do NOT define active attack/block behavior — that
 * responsibility belongs to Weaves.
 *
 * Dust types govern:
 *   - Elemental/material identity
 *   - Passive ambient motion around the player
 *   - Visual color / shape / rendering hints
 *   - Slot cost when bound to a Weave
 *   - Particle interaction data (via negation.ts multiplier table)
 */

import { ParticleKind } from '../particles/kinds';

// ---- Dust Definition -------------------------------------------------------

export interface DustDefinition {
  /** Unique identifier matching ParticleKind enum value. */
  id: ParticleKind;
  /** Display name shown in UI (e.g., "Flame Dust"). */
  displayName: string;
  /** Cost in dust slots when bound to a Weave. */
  slotCost: number;
  /** Primary color hex for UI and render hints. */
  colorHex: string;
  /** Short flavor description for the loadout UI. */
  description: string;
}

// ---- Dust Registry ---------------------------------------------------------

/**
 * All dust type definitions, indexed by ParticleKind value.
 * Only Gold Dust (Physical) is player-equippable.
 */
export const DUST_DEFINITIONS: ReadonlyMap<ParticleKind, DustDefinition> = new Map([
  [ParticleKind.Physical,  { id: ParticleKind.Physical,  displayName: 'Golden Dust',    slotCost: 1, colorHex: '#ffd700', description: 'Dense golden motes with a bright metallic glow.' }],
]);

/**
 * Returns the DustDefinition for a given ParticleKind.
 * Falls back to a default if the kind is not in the registry.
 */
export function getDustDefinition(kind: ParticleKind): DustDefinition {
  return DUST_DEFINITIONS.get(kind) ?? {
    id: kind,
    displayName: 'Unknown Dust',
    slotCost: 1,
    colorHex: '#888888',
    description: 'Unknown dust type.',
  };
}

/**
 * Returns the dust slot cost for the given kind from the DustDefinition registry.
 * This is the canonical source for slot costs in the new Weave system.
 */
export function getDustSlotCost(kind: ParticleKind): number {
  return getDustDefinition(kind).slotCost;
}

/**
 * List of equippable dust kinds in display order.
 * Matches the existing EQUIPPABLE_KINDS but provides a convenient re-export
 * scoped to the weave system.
 */
export { EQUIPPABLE_KINDS } from '../particles/kinds';
