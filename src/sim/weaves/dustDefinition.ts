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
 * Only equippable kinds are included (Fluid and Gold are excluded).
 */
export const DUST_DEFINITIONS: ReadonlyMap<ParticleKind, DustDefinition> = new Map([
  [ParticleKind.Physical,  { id: ParticleKind.Physical,  displayName: 'Golden Dust',    slotCost: 1, colorHex: '#ffd700', description: 'Physical starter dust. Dense motes with a bright metallic glow.' }],
  [ParticleKind.Fire,      { id: ParticleKind.Fire,      displayName: 'Flame Dust',     slotCost: 2, colorHex: '#ff5500', description: 'Flickering embers that rise and bob with heat-like motion.' }],
  [ParticleKind.Ice,       { id: ParticleKind.Ice,       displayName: 'Frost Dust',     slotCost: 2, colorHex: '#88ddff', description: 'Crystalline shards that hang in place a moment before drifting back.' }],
  [ParticleKind.Lightning, { id: ParticleKind.Lightning,  displayName: 'Lightning Dust', slotCost: 3, colorHex: '#ffff44', description: 'Electric sparks. Explosive and volatile.' }],
  [ParticleKind.Poison,    { id: ParticleKind.Poison,    displayName: 'Poison Dust',    slotCost: 2, colorHex: '#44ff44', description: 'Toxic motes. Sticky and diffuse.' }],
  [ParticleKind.Arcane,    { id: ParticleKind.Arcane,    displayName: 'Arcane Dust',    slotCost: 3, colorHex: '#cc44ff', description: 'Mystic spiraling particles of strange turbulence.' }],
  [ParticleKind.Wind,      { id: ParticleKind.Wind,      displayName: 'Wind Dust',      slotCost: 2, colorHex: '#88ffee', description: 'Fast gusts that swirl in spiral arcs around the Weaver.' }],
  [ParticleKind.Holy,      { id: ParticleKind.Holy,      displayName: 'Holy Dust',      slotCost: 3, colorHex: '#ffeeaa', description: 'Sacred motes. Rising and orderly.' }],
  [ParticleKind.Shadow,    { id: ParticleKind.Shadow,    displayName: 'Shadow Dust',    slotCost: 3, colorHex: '#9966ff', description: 'Dark tendrils. Sinking and unstable.' }],
  [ParticleKind.Metal,     { id: ParticleKind.Metal,     displayName: 'Iron Dust',      slotCost: 3, colorHex: '#aabbcc', description: 'Heavy iron shards. Dense and durable.' }],
  [ParticleKind.Earth,     { id: ParticleKind.Earth,     displayName: 'Earth Dust',     slotCost: 2, colorHex: '#aa8833', description: 'Grounded fragments with steady, weighty drift.' }],
  [ParticleKind.Nature,    { id: ParticleKind.Nature,    displayName: 'Nature Dust',    slotCost: 1, colorHex: '#44cc44', description: 'Organic motes. Light and gentle.' }],
  [ParticleKind.Crystal,   { id: ParticleKind.Crystal,   displayName: 'Crystal Dust',   slotCost: 3, colorHex: '#aaeeff', description: 'Prismatic shards. Precise and brilliant.' }],
  [ParticleKind.Void,      { id: ParticleKind.Void,      displayName: 'Void Dust',      slotCost: 4, colorHex: '#9933cc', description: 'Dark matter particles. Unstable phase-like drifting.' }],
  [ParticleKind.Water,     { id: ParticleKind.Water,     displayName: 'Water Dust',     slotCost: 2, colorHex: '#2299ee', description: 'Flowing motes that roll low and spread outward.' }],
  [ParticleKind.Lava,      { id: ParticleKind.Lava,      displayName: 'Lava Dust',      slotCost: 4, colorHex: '#ff2200', description: 'Molten rock. Slow, devastating, few particles.' }],
  [ParticleKind.Stone,     { id: ParticleKind.Stone,     displayName: 'Stone Dust',     slotCost: 2, colorHex: '#888899', description: 'Rock fragments. Heavy low hover with short hops.' }],
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
