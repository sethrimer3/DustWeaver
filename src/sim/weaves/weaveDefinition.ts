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
export const WEAVE_AEGIS   = 'aegis';
export const WEAVE_BASTION = 'bastion';
export const WEAVE_SPIRE   = 'spire';
export const WEAVE_TORRENT = 'torrent';
export const WEAVE_COMET   = 'comet';
export const WEAVE_SCATTER = 'scatter';

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

const AEGIS_DEF: WeaveDefinition = {
  id: WEAVE_AEGIS,
  displayName: 'Aegis Weave',
  description: 'Forms a controlled orbit or shield ring around the Weaver. Sustained while held.',
  role: WeaveRole.Either,
  dustSlotCapacity: 4,
  durationTicks: 0,     // sustained — active while input is held
  cooldownTicks: 30,    // ~0.5 sec cooldown after release
  deploySpeedWorld: 0,  // particles orbit, not launched
  spreadRad: Math.PI * 2, // full circle
};

const BASTION_DEF: WeaveDefinition = {
  id: WEAVE_BASTION,
  displayName: 'Bastion Weave',
  description: 'Forms a directional wall or barrier in the aimed direction. Sustained while held.',
  role: WeaveRole.Either,
  dustSlotCapacity: 4,
  durationTicks: 0,     // sustained
  cooldownTicks: 30,
  deploySpeedWorld: 0,  // particles spring to position, not launched
  spreadRad: 0,         // straight wall (perpendicular to aim)
};

const SPIRE_DEF: WeaveDefinition = {
  id: WEAVE_SPIRE,
  displayName: 'Spire Weave',
  description: 'Shoots all bound dust forward in a straight line toward the aimed direction.',
  role: WeaveRole.Either,
  dustSlotCapacity: 3,
  durationTicks: 45,    // ~0.75 sec flight time
  cooldownTicks: 45,    // ~0.75 sec cooldown
  deploySpeedWorld: 350, // fast forward launch
  spreadRad: 0.12,       // very tight line
};

const TORRENT_DEF: WeaveDefinition = {
  id: WEAVE_TORRENT,
  displayName: 'Torrent Weave',
  description: 'Sprays bound dust in a directed cone or burst.',
  role: WeaveRole.Either,
  dustSlotCapacity: 4,
  durationTicks: 35,
  cooldownTicks: 50,
  deploySpeedWorld: 250,
  spreadRad: Math.PI * 0.5, // 90° cone
};

const COMET_DEF: WeaveDefinition = {
  id: WEAVE_COMET,
  displayName: 'Comet Weave',
  description: 'Compresses all bound dust into one dense projectile mass that scatters on impact.',
  role: WeaveRole.Either,
  dustSlotCapacity: 5,
  durationTicks: 60,
  cooldownTicks: 90,
  deploySpeedWorld: 300,
  spreadRad: 0,
};

const SCATTER_DEF: WeaveDefinition = {
  id: WEAVE_SCATTER,
  displayName: 'Scatter Weave',
  description: 'Explodes all bound dust outward in every direction.',
  role: WeaveRole.Either,
  dustSlotCapacity: 4,
  durationTicks: 40,
  cooldownTicks: 60,
  deploySpeedWorld: 280,
  spreadRad: Math.PI * 2, // full circle
};

// ---- Weave Registry --------------------------------------------------------

/** All available weave definitions, keyed by WeaveId. */
export const WEAVE_REGISTRY: ReadonlyMap<WeaveId, WeaveDefinition> = new Map([
  [WEAVE_AEGIS,   AEGIS_DEF],
  [WEAVE_BASTION, BASTION_DEF],
  [WEAVE_SPIRE,   SPIRE_DEF],
  [WEAVE_TORRENT, TORRENT_DEF],
  [WEAVE_COMET,   COMET_DEF],
  [WEAVE_SCATTER, SCATTER_DEF],
]);

/** Ordered list of weave IDs for UI display. */
export const WEAVE_LIST: readonly WeaveId[] = [
  WEAVE_AEGIS,
  WEAVE_BASTION,
  WEAVE_SPIRE,
  WEAVE_TORRENT,
  WEAVE_COMET,
  WEAVE_SCATTER,
];

/**
 * Returns the WeaveDefinition for a given weave ID.
 * Falls back to Spire if the ID is not found.
 */
export function getWeaveDefinition(id: WeaveId): WeaveDefinition {
  return WEAVE_REGISTRY.get(id) ?? SPIRE_DEF;
}
