/**
 * Momentum Combat configuration constants.
 *
 * Ordinary input-generated horizontal speed remains below this threshold.
 *   = 105 × 1.5 = 157.5 px/s.
 *
 * ACTIVATION uses horizontal speed only (ignoring vy) so that a vertical jump
 * (~255 px/s upward) does NOT trigger the attack state — only lateral grapple
 * momentum does.  MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED is set above sprint speed.
 *
 * DAMAGE FORMULA uses total speed (hypot(vx, vy)) once horizontal activation
 * fires, rewarding fast grapple arcs that also carry vertical momentum.
 * MOMENTUM_COMBAT_MIN_SPEED is the damage-formula baseline (dmg = 1 at this speed).
 */

/** Minimum HORIZONTAL speed (px/s) required to enter the momentum-combat attack state.
 *  Set above sprint speed (157.5 px/s) so only grapple/swing qualifies.
 *  A straight vertical jump adds no extra horizontal speed and cannot activate this. */
export const MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED = 175;

/** Baseline total speed (px/s) for the damage formula.
 *  dmg = max(1, round(1 + (totalSpeed - MOMENTUM_COMBAT_MIN_SPEED) * MOMENTUM_COMBAT_DAMAGE_SCALE)).
 *  At 2× baseline (410 px/s total), extra = 205 → dmg ≈ round(1 + 7.175) = 8. */
export const MOMENTUM_COMBAT_MIN_SPEED = 205;

/** Damage scale factor applied to (totalSpeed − baseline).
 *  At 2× baseline speed → ~8 dmg; at 3× baseline → ~15 dmg. */
export const MOMENTUM_COMBAT_DAMAGE_SCALE = 0.035;

/** Minimum ticks between momentum-combat hits on the same enemy (≈150 ms at 60 fps). */
export const MOMENTUM_HIT_COOLDOWN_TICKS = 9;
