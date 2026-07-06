/**
 * The Void Herald - void wizard boss tuning constants.
 *
 * Attack package: Void Sphere plus first-pass Phantasmal Geometry hazards.
 */

export const VOID_HERALD_BOSS_NAME = 'The Void Herald';

// Capacity.
export const MAX_VOID_SPHERES = 3;
export const MAX_PHANTASMAL_SPIKES = 12;
export const MAX_PHANTASMAL_BLOCKS = 6;
export const MAX_PHANTASMAL_SHOCKWAVES = 6;
export const MAX_VOID_LASERS = 8;
export const MAX_VOID_LASER_DUST = 48;

// Health / hitbox.
export const HERALD_HP = 40;
export const HERALD_HALF_W = 7.0;
export const HERALD_HALF_H = 11.0;

// State machine.
export const HERALD_STATE_IDLE = 0;
export const HERALD_STATE_CAST = 1;
export const HERALD_STATE_RECOVER = 2;
export const HERALD_ATTACK_VOID_SPHERE = 0;
export const HERALD_ATTACK_PHANTASMAL_SPIKES = 1;
export const HERALD_ATTACK_PHANTASMAL_BLOCKS = 2;
export const HERALD_ATTACK_VOID_LASER_WEB = 3;

/** Ticks spent telegraphing before a Void Sphere is released. */
export const HERALD_CAST_TICKS = 34;
/** Ticks spent recovering after firing before the next cooldown begins. */
export const HERALD_RECOVER_TICKS = 26;
/** Cooldown between the end of recovery and the next cast. */
export const HERALD_ATTACK_COOLDOWN_TICKS = 70;
/** Cooldown before the very first attack after spawning. */
export const HERALD_INITIAL_COOLDOWN_TICKS = 60;

// Idle movement.
export const HERALD_HOVER_MAX_SPEED = 0.55;
export const HERALD_HOVER_ACCEL = 0.02;
export const HERALD_HOVER_DAMPING = 0.96;
export const HERALD_ROOM_MARGIN = 20;
export const HERALD_IDLE_DRIFT_STRENGTH_X = 0.5;
export const HERALD_IDLE_DRIFT_STRENGTH_Y = 0.3;

// Contact damage.
export const HERALD_CONTACT_DAMAGE = 1;
export const HERALD_CONTACT_IFRAMES = 40;

// Void Sphere projectile.
export const VOID_SPHERE_RADIUS_WORLD = 10.0;
export const VOID_SPHERE_DAMAGE_RADIUS_WORLD = 9.0;
export const VOID_SPHERE_DISTORTION_RADIUS_WORLD = 26.0;
export const VOID_SPHERE_SPEED_WORLD = 0.62;
export const VOID_SPHERE_LIFETIME_TICKS = 260;
export const VOID_SPHERE_BOUNDS_MARGIN_WORLD = 48.0;
export const VOID_SPHERE_DAMAGE = 2;
export const VOID_SPHERE_IFRAMES = 44;
export const VOID_SPHERE_DISTORTION_STRENGTH_PX = 14.0;

// Phantasmal Spikes.
export const PHANTASMAL_SPIKE_COUNT = 6;
export const PHANTASMAL_SPIKE_TELEGRAPH_TICKS = 44;
export const PHANTASMAL_SPIKE_ACTIVE_TICKS = 92;
export const PHANTASMAL_SPIKE_FADE_TICKS = 28;
export const PHANTASMAL_SPIKE_TOTAL_TICKS =
  PHANTASMAL_SPIKE_TELEGRAPH_TICKS + PHANTASMAL_SPIKE_ACTIVE_TICKS + PHANTASMAL_SPIKE_FADE_TICKS;
export const PHANTASMAL_SPIKE_LENGTH_WORLD = 18;
export const PHANTASMAL_SPIKE_WIDTH_WORLD = 12;
export const PHANTASMAL_SPIKE_DAMAGE = 2;
export const PHANTASMAL_SPIKE_IFRAMES = 38;
export const PHANTASMAL_SPIKE_PLAYER_SAFETY_RADIUS_WORLD = 42;

// Phantasmal Blocks.
export const PHANTASMAL_BLOCK_COUNT = 4;
export const PHANTASMAL_BLOCK_SIZE_WORLD = 18;
export const PHANTASMAL_BLOCK_SPAWN_RADIUS_WORLD = 42;
export const PHANTASMAL_BLOCK_LIFETIME_TICKS = 210;
export const PHANTASMAL_BLOCK_FORM_TICKS = 32;
export const PHANTASMAL_BLOCK_DAMAGE = 1;
export const PHANTASMAL_BLOCK_IFRAMES = 24;
export const PHANTASMAL_BLOCK_BREAK_SPEED = 240;
export const PHANTASMAL_BLOCK_RESIST_BUMP_SPEED = 110;
export const PHANTASMAL_BLOCK_FLASH_TICKS = 12;
export const PHANTASMAL_BLOCK_SHOVE_STRENGTH = 420;
export const PHANTASMAL_BLOCK_MIN_SHOVE_STRENGTH = 260;
export const PHANTASMAL_BLOCK_MAX_PLAYER_SPEED = 620;
export const PHANTASMAL_SHOCKWAVE_RADIUS_WORLD = 58;
export const PHANTASMAL_SHOCKWAVE_TICKS = 28;

// Void Laser Web.
export const VOID_LASER_COUNT = 4;
export const VOID_LASER_WIDTH_WORLD = 4.5;
export const VOID_LASER_TELEGRAPH_TICKS = 48;
export const VOID_LASER_ACTIVE_TICKS = 116;
export const VOID_LASER_FADE_TICKS = 18;
export const VOID_LASER_TOTAL_TICKS = VOID_LASER_TELEGRAPH_TICKS + VOID_LASER_ACTIVE_TICKS + VOID_LASER_FADE_TICKS;
export const VOID_LASER_DAMAGE = 1;
export const VOID_LASER_IFRAMES = 34;
export const VOID_LASER_CENTER_SAFE_RATIO = 0.25;
export const VOID_LASER_CENTER_SAFE_MIN_T = 0.5 - VOID_LASER_CENTER_SAFE_RATIO * 0.5;
export const VOID_LASER_CENTER_SAFE_MAX_T = 0.5 + VOID_LASER_CENTER_SAFE_RATIO * 0.5;
export const VOID_LASER_MIN_LENGTH_WORLD = 92;
export const VOID_LASER_MAX_SPAWN_ATTEMPTS = 80;
export const VOID_LASER_ENDPOINT_BURY_DEPTH = 8;
export const VOID_LASER_PLAYER_SAFETY_RADIUS_WORLD = 36;
export const VOID_LASER_MOMENTUM_ARREST_STRENGTH = 0.12;
export const VOID_LASER_DUST_LIFETIME_TICKS = 30;
export const VOID_LASER_DUST_PER_DISSIPATION = 8;
