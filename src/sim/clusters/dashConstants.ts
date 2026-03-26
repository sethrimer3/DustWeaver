/**
 * Shared dash / recharge constants used by both the player and enemy systems.
 * Centralised here so movement.ts, enemyAi.ts, and snapshot.ts can all import
 * from a single source of truth without introducing circular dependencies.
 */

/** Ticks until a dash can be used again after activation (3 seconds @ 60 fps). */
export const DASH_COOLDOWN_TICKS = 180;

/** Ticks the golden recharge-ring animation plays after a dash refills (0.6 s). */
export const DASH_RECHARGE_ANIM_TICKS = 36;

/** Lateral dodge speed used by enemy clusters during a weave burst (world units/sec). */
export const ENEMY_DODGE_SPEED_WORLD = 220.0;
