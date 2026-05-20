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
 * All 17 elemental/material dust types are player-collectible.
 * Fluid (background), Gold (grapple chain), and Light (boss) are excluded.
 */
export const DUST_DEFINITIONS: ReadonlyMap<ParticleKind, DustDefinition> = new Map([
  [ParticleKind.Physical,  { id: ParticleKind.Physical,  displayName: 'Golden Dust',    slotCost: 1, colorHex: '#ffd700', description: 'Dense golden motes with a bright metallic glow.' }],
  [ParticleKind.Fire,      { id: ParticleKind.Fire,      displayName: 'Fire Dust',      slotCost: 1, colorHex: '#ff4400', description: 'Scorching embers that ignite on contact.' }],
  [ParticleKind.Ice,       { id: ParticleKind.Ice,       displayName: 'Ice Dust',       slotCost: 1, colorHex: '#88ccff', description: 'Frozen crystals that chill enemies to the bone.' }],
  [ParticleKind.Lightning, { id: ParticleKind.Lightning, displayName: 'Lightning Dust', slotCost: 1, colorHex: '#ffffaa', description: 'Crackling sparks that arc between targets.' }],
  [ParticleKind.Poison,    { id: ParticleKind.Poison,    displayName: 'Poison Dust',    slotCost: 1, colorHex: '#88ff44', description: 'Toxic spores that linger and corrode.' }],
  [ParticleKind.Arcane,    { id: ParticleKind.Arcane,    displayName: 'Arcane Dust',    slotCost: 1, colorHex: '#cc66ff', description: 'Mysterious energy from forgotten rituals.' }],
  [ParticleKind.Wind,      { id: ParticleKind.Wind,      displayName: 'Wind Dust',      slotCost: 1, colorHex: '#aaffee', description: 'Whirling gusts that push and scatter.' }],
  [ParticleKind.Holy,      { id: ParticleKind.Holy,      displayName: 'Holy Dust',      slotCost: 1, colorHex: '#ffeeaa', description: 'Sacred motes that burn undead and purify.' }],
  [ParticleKind.Shadow,    { id: ParticleKind.Shadow,    displayName: 'Shadow Dust',    slotCost: 1, colorHex: '#6644aa', description: 'Tendrils of darkness that sap enemy will.' }],
  [ParticleKind.Metal,     { id: ParticleKind.Metal,     displayName: 'Metal Dust',     slotCost: 1, colorHex: '#aabbcc', description: 'Razor shards with exceptional penetration.' }],
  [ParticleKind.Earth,     { id: ParticleKind.Earth,     displayName: 'Earth Dust',     slotCost: 1, colorHex: '#aa7744', description: 'Heavy stone fragments with crushing force.' }],
  [ParticleKind.Nature,    { id: ParticleKind.Nature,    displayName: 'Nature Dust',    slotCost: 1, colorHex: '#44cc44', description: 'Living spores that sap and regrow.' }],
  [ParticleKind.Crystal,   { id: ParticleKind.Crystal,   displayName: 'Crystal Dust',   slotCost: 1, colorHex: '#88ffff', description: 'Glittering shards that refract and pierce.' }],
  [ParticleKind.Void,      { id: ParticleKind.Void,      displayName: 'Void Dust',      slotCost: 1, colorHex: '#220044', description: 'Unstable matter from beyond existence.' }],
  [ParticleKind.Water,     { id: ParticleKind.Water,     displayName: 'Water Dust',     slotCost: 1, colorHex: '#4488ff', description: 'Flowing droplets that erode and drown.' }],
  [ParticleKind.Lava,      { id: ParticleKind.Lava,      displayName: 'Lava Dust',      slotCost: 1, colorHex: '#ff6622', description: 'Molten fragments that melt through defenses.' }],
  [ParticleKind.Stone,     { id: ParticleKind.Stone,     displayName: 'Stone Dust',     slotCost: 1, colorHex: '#888888', description: 'Ancient fragments worn smooth by time.' }],
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
