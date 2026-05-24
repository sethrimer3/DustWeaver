/**
 * Void Singularity — tuning constants.
 *
 * All numeric design knobs for both AI and rendering live here so both enemies
 * can be balanced without hunting through logic code.
 *
 * Covers both Void Singularity (single black-hole enemy) and
 * Void Singularity Pair (linked black hole + white hole).
 */

// ── Capacity ──────────────────────────────────────────────────────────────────

/** Maximum simultaneous Void Singularity / Pair instances per room. */
export const MAX_VOID_SINGULARITIES = 4;

/** Motes per VS slot (inward-spiraling motes). */
export const MAX_MOTES_PER_VS = 8;

/** Maximum outbound projectiles per VSP slot (white hole eruption). */
export const MAX_PROJS_PER_VSP = 8;

// ── Health ────────────────────────────────────────────────────────────────────

/** Health points for the single Void Singularity. */
export const VS_HP = 12;

/** Shared health for the Void Singularity Pair. */
export const VSP_HP = 20;

/** Hitbox half-width/height for both variants (world units). */
export const VS_HALF_W = 8.0;
export const VS_HALF_H = 8.0;

// ── Movement ──────────────────────────────────────────────────────────────────

/** Distance at which the enemy activates (world units). */
export const VS_ACTIVATION_RANGE_WORLD = 200.0;

/** Max drift from spawn point (world units). */
export const VS_LEASH_RADIUS_WORLD = 150.0;

/** Maximum hover speed toward player when activated (world units/tick). */
export const VS_HOVER_SPEED = 0.30;

/** Velocity drag factor applied each tick (dampens movement). */
export const VS_VELOCITY_DRAG = 0.90;

/** Bob amplitude (world units). */
export const VS_BOB_AMPLITUDE_WORLD = 3.0;

/** Bob frequency (radians/tick). */
export const VS_BOB_FREQ_RAD_PER_TICK = 0.020;

// ── Pull field ────────────────────────────────────────────────────────────────

/** Radius in which the pull field is mechanically active (world units). */
export const VS_PULL_RADIUS_WORLD = 80.0;

/** Base pull force applied to the player (world units/tick). Ramps up near center. */
export const VS_PULL_STRENGTH = 0.22;

/** Maximum pull force cap per tick (world units/tick). */
export const VS_MAX_PULL_FORCE = 0.80;

/** Radius for absorbing nearby neutral particles (world units). */
export const VS_ABSORPTION_RADIUS_WORLD = 14.0;

/** Energy gained per absorbed neutral particle. */
export const VS_ABSORPTION_ENERGY_PER_PARTICLE = 1;

/** Energy gained passively per tick while in ActivePull state. */
export const VS_PASSIVE_CHARGE_PER_TICK = 0.05;

// ── State durations ───────────────────────────────────────────────────────────

/** Ticks the enemy stays idle before activating (initial delay). */
export const VS_IDLE_SETTLE_TICKS = 60;

/** Ticks for the ChargePulse telegraph before firing. */
export const VS_CHARGE_PULSE_TICKS = 70;

/** Ticks the expanding pulse ring is active. */
export const VS_COLLAPSE_PULSE_TICKS = 50;

/** Ticks spent recovering after a pulse. */
export const VS_RECOVER_TICKS = 80;

/** Energy threshold to trigger ChargePulse. */
export const VS_PULSE_TRIGGER_ENERGY = 6.0;

/** Death animation duration (ticks). */
export const VS_DEATH_DURATION_TICKS = 55;

// ── Collapse Pulse ────────────────────────────────────────────────────────────

/** Maximum radius the pulse ring expands to (world units). */
export const VS_PULSE_MAX_RADIUS_WORLD = 70.0;

/** Thickness of the pulse ring hitbox (world units). */
export const VS_PULSE_THICKNESS_WORLD = 12.0;

/** Damage dealt by the pulse ring. */
export const VS_PULSE_DAMAGE = 1;

/** Player invulnerability ticks after a pulse hit. */
export const VS_PULSE_IFRAMES_TICKS = 60;

/** Contact damage when player overlaps the core (world units). */
export const VS_CONTACT_RADIUS_WORLD = 10.0;

/** Damage from direct core contact. */
export const VS_CONTACT_DAMAGE = 1;

/** Player iframes after core contact. */
export const VS_CONTACT_IFRAMES_TICKS = 60;

// ── Motes ─────────────────────────────────────────────────────────────────────

/** Starting radius of the inward-spiral motes (world units). */
export const VS_MOTE_START_RADIUS_WORLD = 28.0;

/** Minimum mote radius before it "gets absorbed" and resets (world units). */
export const VS_MOTE_MIN_RADIUS_WORLD = 3.0;

/** Angular speed of the motes (radians/tick). Negative = clockwise. */
export const VS_MOTE_ANG_VEL_RAD_PER_TICK = -0.040;

/** Spiral inward speed in idle state (world units/tick shrinkage). */
export const VS_MOTE_IDLE_SPIRAL_SPEED = 0.06;

/** Spiral inward speed in active pull state (world units/tick shrinkage). */
export const VS_MOTE_ACTIVE_SPIRAL_SPEED = 0.18;

/** Spiral inward speed in charge state (faster pull). */
export const VS_MOTE_CHARGE_SPIRAL_SPEED = 0.40;

/** Mote brightness pulse frequency (radians/tick). */
export const VS_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.065;

// ── Visual radii ──────────────────────────────────────────────────────────────

/** Core visual radius (world units). */
export const VS_CORE_RADIUS_WORLD = 7.0;

/** Event horizon rim thickness in world units. */
export const VS_RIM_THICKNESS_WORLD = 2.5;

/** Outer glow halo radius (world units). */
export const VS_HALO_RADIUS_WORLD = 18.0;

/** Hit flash duration (ticks). */
export const VS_HIT_FLASH_TICKS = 6;

// ── Pair: positioning ─────────────────────────────────────────────────────────

/** Distance between the black hole and white hole centers (world units). */
export const VSP_NODE_DISTANCE_WORLD = 40.0;

/** Angular orbit speed of the pair around the shared midpoint (radians/tick). */
export const VSP_ORBIT_SPEED_RAD_PER_TICK = 0.012;

// ── Pair: white hole charge ────────────────────────────────────────────────────

/** Absorbed energy required to trigger a white-hole Radiant Eruption. */
export const VSP_CHARGE_THRESHOLD = 8.0;

/** Ticks the white hole spends telegraphing before eruption. */
export const VSP_ERUPTION_CHARGE_TICKS = 55;

/** Ticks the white hole eruption is active (projectile lifetime). */
export const VSP_ERUPTION_ACTIVE_TICKS = 90;

/** Cooldown ticks between eruptions. */
export const VSP_ERUPTION_COOLDOWN_TICKS = 180;

// ── Pair: white hole projectiles ──────────────────────────────────────────────

/** Number of projectiles in one Radiant Eruption burst. */
export const VSP_ERUPTION_PROJ_COUNT = 8;

/** Projectile speed (world units/tick). */
export const VSP_PROJ_SPEED_WORLD = 2.8;

/** Projectile lifetime (ticks). */
export const VSP_PROJ_LIFETIME_TICKS = 90;

/** Projectile hit radius (world units). */
export const VSP_PROJ_HIT_RADIUS_WORLD = 4.0;

/** Damage dealt by a white-hole projectile. */
export const VSP_PROJ_DAMAGE = 1;

/** Player iframes after projectile hit. */
export const VSP_PROJ_IFRAMES_TICKS = 50;

/** Visual radius of a white-hole projectile (world units). */
export const VSP_PROJ_VISUAL_RADIUS_WORLD = 3.5;

// ── Pair: link visual ─────────────────────────────────────────────────────────

/** Number of link "dust" segments drawn between BH and WH centers. */
export const VSP_LINK_SEGMENT_COUNT = 6;

// ── Debug ─────────────────────────────────────────────────────────────────────

/** Set to true to show debug overlays. */
export const VS_DEBUG_ENABLED = false;
