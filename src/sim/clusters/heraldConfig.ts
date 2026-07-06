/**
 * The Herald — void wizard boss. Tuning constants.
 *
 * First-pass scaffold: a single attack (Void Sphere) is implemented. Kept
 * intentionally minimal (no phases, no combo attacks) so the boss framework
 * is easy to extend with additional attacks later.
 */

// ── Capacity ──────────────────────────────────────────────────────────────────

/** Maximum simultaneous Void Sphere projectiles across all Heralds in a room. */
export const MAX_VOID_SPHERES = 3;

// ── Health / hitbox ───────────────────────────────────────────────────────────

export const HERALD_HP = 40;
export const HERALD_HALF_W = 7.0;
export const HERALD_HALF_H = 11.0;

// ── State machine ─────────────────────────────────────────────────────────────

export const HERALD_STATE_IDLE = 0;
export const HERALD_STATE_CAST = 1;
export const HERALD_STATE_RECOVER = 2;

/** Ticks spent telegraphing (charging) before a Void Sphere is released. */
export const HERALD_CAST_TICKS = 34;
/** Ticks spent recovering after firing before the next cooldown begins. */
export const HERALD_RECOVER_TICKS = 26;
/** Cooldown between the end of recovery and the next cast. */
export const HERALD_ATTACK_COOLDOWN_TICKS = 70;
/** Cooldown before the very first attack after spawning. */
export const HERALD_INITIAL_COOLDOWN_TICKS = 60;

// ── Idle movement (gentle hover, no aggressive chase) ─────────────────────────

export const HERALD_HOVER_MAX_SPEED = 0.55;
export const HERALD_HOVER_ACCEL = 0.02;
export const HERALD_HOVER_DAMPING = 0.96;
export const HERALD_ROOM_MARGIN = 20;
export const HERALD_IDLE_DRIFT_STRENGTH_X = 0.5;
export const HERALD_IDLE_DRIFT_STRENGTH_Y = 0.3;

// ── Contact damage (touching the Herald directly) ─────────────────────────────

export const HERALD_CONTACT_DAMAGE = 1;
export const HERALD_CONTACT_IFRAMES = 40;

// ── Void Sphere projectile ─────────────────────────────────────────────────────

/** Visual/collision radius of the sphere core (world units). */
export const VOID_SPHERE_RADIUS_WORLD = 10.0;
/** Radius within which the sphere damages the player on contact (world units). */
export const VOID_SPHERE_DAMAGE_RADIUS_WORLD = 9.0;
/** Radius of the visual lensing distortion halo around the sphere (world units). */
export const VOID_SPHERE_DISTORTION_RADIUS_WORLD = 26.0;
/** Travel speed toward the aimed target (world units/tick). */
export const VOID_SPHERE_SPEED_WORLD = 0.62;
/** Maximum lifetime before forced despawn (ticks). */
export const VOID_SPHERE_LIFETIME_TICKS = 260;
/** Extra margin beyond room bounds before a sphere is considered "left the room" (world units). */
export const VOID_SPHERE_BOUNDS_MARGIN_WORLD = 48.0;
export const VOID_SPHERE_DAMAGE = 2;
export const VOID_SPHERE_IFRAMES = 44;

/** Strength of the screen-space lensing pull applied around each sphere (pixels). */
export const VOID_SPHERE_DISTORTION_STRENGTH_PX = 14.0;
