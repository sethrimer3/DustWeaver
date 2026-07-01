/**
 * Momentum Combat configuration constants.
 *
 * Sprint speed = MAX_RUN_SPEED_WORLD_PER_SEC × SPRINT_SPEED_MULTIPLIER = 105 × 1.5 = 157.5 px/s.
 * MOMENTUM_COMBAT_MIN_SPEED is set above sprint speed so normal running cannot
 * activate the high-velocity attack state.  Players must grapple, swing, or
 * fall to reach this speed.
 */

/** Minimum speed (px/s) required to enter the momentum-combat attack state.
 *  Set above sprint speed (157.5 px/s) so only grapple/fall speed qualifies. */
export const MOMENTUM_COMBAT_MIN_SPEED = 205;

/** Damage scale factor: dmg = max(1, round(1 + (speed - threshold) * scale)).
 *  At 2× threshold (410 px/s) extra = 205 → dmg ≈ round(1 + 7.175) = 8. */
export const MOMENTUM_COMBAT_DAMAGE_SCALE = 0.035;

/** Minimum ticks between momentum-combat hits on the same enemy (≈150 ms at 60 fps). */
export const MOMENTUM_HIT_COOLDOWN_TICKS = 9;
