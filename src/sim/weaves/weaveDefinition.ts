/**
 * Weave Definition Layer.
 *
 * A Weave is the active combat technique that controls how bound dust moves
 * when activated. The Weave defines the deployment pattern (motion shape),
 * timing, and activation role (primary / secondary / either).
 *
 * Weave definitions are data + behavior strategy:
 *   - Data: id, display name, description, slot capacity, timing, role support
 *   - Behavior: activation pattern that moves bound dust particles each tick
 *
 * The Weave is the main source of active combat readability. Dust type governs
 * passive motion and elemental identity; Weave governs the active form.
 */

// ---- Weave Identifiers -----------------------------------------------------

/**
 * Unique identifier for each Weave technique.
 * String-based for extensibility and readability in save data.
 */
export type WeaveId = string;

/** Built-in weave IDs. */
export const WEAVE_STORM        = 'storm';
export const WEAVE_SHIELD       = 'shield';
export const WEAVE_ARROW        = 'arrow';
export const WEAVE_SHIELD_SWORD = 'shield_sword';

// ---- Weave Activation Role -------------------------------------------------

/** Which input slot a Weave can be equipped to. */
export enum WeaveRole {
  /** Can only be equipped as primary (left click). */
  PrimaryOnly = 0,
  /** Can only be equipped as secondary (right click). */
  SecondaryOnly = 1,
  /** Can be equipped as either primary or secondary. */
  Either = 2,
}

// ---- Weave Definition -------------------------------------------------------

export interface WeaveDefinition {
  /** Unique weave identifier. */
  id: WeaveId;
  /** Display name shown in UI (e.g., "Aegis Weave"). */
  displayName: string;
  /** Short description for the loadout UI. */
  description: string;
  /** Which input role(s) this weave supports. */
  role: WeaveRole;
  /** Maximum dust slots this weave can hold. */
  dustSlotCapacity: number;

  // ---- Timing data ----------------------------------------------------------
  /** Duration in ticks the weave stays active after activation. 0 = sustained while held. */
  durationTicks: number;
  /** Ticks before the weave can be used again after ending. */
  cooldownTicks: number;

  // ---- Pattern metadata (used by the weave behavior implementation) ---------
  /**
   * Speed at which dust particles deploy in the weave pattern (world units/sec).
   * Interpretation varies by weave — e.g., launch speed for Spire, orbit speed for Aegis.
   */
  deploySpeedWorld: number;
  /**
   * Spread angle in radians for directional weaves.
   * 0 = focused line, π/2 = 90° cone, π = hemisphere, 2π = full circle.
   */
  spreadRad: number;
}

// ---- Built-in Weave Definitions --------------------------------------------

const STORM_DEF: WeaveDefinition = {
  id: WEAVE_STORM,
  displayName: 'Storm Weave',
  description: 'Passively attracts nearby dust to the Weaver. Always active.',
  role: WeaveRole.PrimaryOnly,
  dustSlotCapacity: 0,   // Storm does not bind dust — it is always active passively
  durationTicks: 0,
  cooldownTicks: 0,
  deploySpeedWorld: 0,
  spreadRad: Math.PI * 2,
};

const SHIELD_DEF: WeaveDefinition = {
  id: WEAVE_SHIELD,
  displayName: 'Shield Weave',
  description: 'Forms a crescent shield of dust in the aimed direction. More dust = larger crescent.',
  role: WeaveRole.Either,
  dustSlotCapacity: 0,        // 0 = no binding limit; uses all available dust
  durationTicks: 0,           // sustained
  cooldownTicks: 15,
  deploySpeedWorld: 0,
  spreadRad: Math.PI * 0.5,   // 90° crescent arc
};

const ARROW_DEF: WeaveDefinition = {
  id: WEAVE_ARROW,
  displayName: 'Arrow Weave',
  description: 'Hold to load an arrow of dust motes; release to fire. More loading time = more motes, more damage, faster flight.',
  role: WeaveRole.SecondaryOnly,
  dustSlotCapacity: 0,
  durationTicks: 0,
  cooldownTicks: 0,
  deploySpeedWorld: 0,
  spreadRad: 0,
};

/**
 * Shield Sword Weave — sword-form upgrade conceptually built from Storm and
 * Shield motes.  Forms a golden-crossguard sword that auto-swings at nearby
 * enemies; while right mouse is held the motes collapse into the existing
 * Shield Weave crescent; on release the sword reforms into its ready stance.
 */
const SHIELD_SWORD_DEF: WeaveDefinition = {
  id: WEAVE_SHIELD_SWORD,
  displayName: 'Shield Sword Weave',
  description: 'Forms a golden-crossguard sword from Storm/Shield motes. Auto-swings at nearby enemies; hold right mouse to raise the crescent shield instead.',
  role: WeaveRole.SecondaryOnly,
  dustSlotCapacity: 0,
  durationTicks: 0,
  cooldownTicks: 0,
  deploySpeedWorld: 0,
  spreadRad: Math.PI * 0.75,
};

// ---- Weave Registry --------------------------------------------------------

/** All available weave definitions, keyed by WeaveId. */
export const WEAVE_REGISTRY: ReadonlyMap<WeaveId, WeaveDefinition> = new Map([
  [WEAVE_STORM,        STORM_DEF],
  [WEAVE_SHIELD,       SHIELD_DEF],
  [WEAVE_ARROW,        ARROW_DEF],
  [WEAVE_SHIELD_SWORD, SHIELD_SWORD_DEF],
]);

/** Ordered list of weave IDs for UI display. */
export const WEAVE_LIST: readonly WeaveId[] = [
  WEAVE_STORM,
  WEAVE_SHIELD,
  WEAVE_ARROW,
  WEAVE_SHIELD_SWORD,
];

/**
 * Returns the WeaveDefinition for a given weave ID.
 * Falls back to Storm if the ID is not found.
 */
export function getWeaveDefinition(id: WeaveId): WeaveDefinition {
  return WEAVE_REGISTRY.get(id) ?? STORM_DEF;
}
