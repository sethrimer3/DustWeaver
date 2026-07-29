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
  /** Optional informal/lore name, kept separate from the formal display name. */
  nickname?: string;
  /** Cost in dust slots when bound to a Weave. */
  slotCost: number;
  /** Primary color hex for UI and render hints. */
  colorHex: string;
  /** Short flavor description for the loadout UI. */
  description: string;
  /** Relative sprite URL under ASSETS for UI iconography. */
  spriteUrl?: string;
}

// ---- Dust Registry ---------------------------------------------------------

/**
 * Player-facing dust definitions, indexed by ParticleKind value.
 * Internal particle kinds intentionally have no entry here.
 */
export const DUST_DEFINITIONS: ReadonlyMap<ParticleKind, DustDefinition> = new Map([
  [ParticleKind.Golden, { id: ParticleKind.Golden, displayName: 'Golden Dust', slotCost: 1, colorHex: '#ffd700', description: 'Versatile, foundational golden motes used for weaving.', spriteUrl: 'SPRITES/DUST/DustTypes/GoldenMote.png' }],
  [ParticleKind.Ice, { id: ParticleKind.Ice, displayName: 'Ice Dust', nickname: 'Frost Dust', slotCost: 1, colorHex: '#88ccff', description: 'Cold crystalline motes associated with freezing.', spriteUrl: 'SPRITES/DUST/DustTypes/IceMote.png' }],
  [ParticleKind.Nature, { id: ParticleKind.Nature, displayName: 'Nature Dust', nickname: 'Verdant Dust', slotCost: 1, colorHex: '#44cc44', description: 'Living green motes associated with growth and organic energy.', spriteUrl: 'SPRITES/DUST/DustTypes/VerdantMote.png' }],
  [ParticleKind.Void, { id: ParticleKind.Void, displayName: 'Void Dust', slotCost: 1, colorHex: '#220044', description: 'Unstable dark motes associated with absence, distortion, and the beyond.', spriteUrl: 'SPRITES/DUST/DustTypes/VoidMote.png' }],
  [ParticleKind.Light, { id: ParticleKind.Light, displayName: 'Light Dust', nickname: 'Luminant Dust', slotCost: 1, colorHex: '#fff4b0', description: 'Radiant motes that emit illumination and push back darkness.', spriteUrl: 'SPRITES/DUST/DustTypes/LuminantMote.png' }],
  // No spriteUrl yet — no pixel-art asset exists for Fire Dust; the loadout UI
  // falls back to a colour swatch (see skillTombLoadout.ts) rather than risk a
  // missing-asset load error. Add spriteUrl once SPRITES/DUST/DustTypes/FireMote.png exists.
  [ParticleKind.FireDust, { id: ParticleKind.FireDust, displayName: 'Fire Dust', nickname: 'Ember Dust', slotCost: 1, colorHex: '#e65515', description: 'Hot ember motes associated with heat and burning light.' }],
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
