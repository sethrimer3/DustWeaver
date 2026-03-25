/**
 * Elemental interaction multipliers.
 *
 * ELEMENT_MULTIPLIER[attackerKind][defenderKind] returns how much damage
 * one attacker particle deals to the defender particle's durability per contact.
 * Default is 1.0 (neutral).  Values > 1.0 give the attacker an advantage;
 * values < 1.0 mean the attacker is weak against the defender type.
 *
 * Encoded rules (from the design spec):
 *   • 3 fire negate 1 ice  → fire vs ice = 0.33  (fire weak vs ice)
 *   • ice vs fire = 1.0    (ice neutral vs fire; fire just has low toughness)
 *   • Lightning destroys ice for free → lightning vs ice = 10.0
 *   • Holy counters Shadow   → holy vs shadow = 2.0; shadow vs holy = 0.5
 *   • Fire burns Nature      → fire vs nature = 2.0
 *   • Poison dissolves Nature → poison vs nature = 2.0
 *   • Earth grounds Lightning → earth vs lightning = 2.0
 *   • Lightning conducts through Metal → lightning vs metal = 2.0
 *   • Void absorbs Arcane    → void vs arcane = 2.0
 *   • Crystal shatters from Lightning → lightning vs crystal = 2.0
 *   • Wind disperses Poison  → wind vs poison = 2.0
 *   • Metal resists Nature/Earth → metal vs both = 1.5
 */

import { PARTICLE_KIND_COUNT } from './kinds';

// Flat 15×15 table indexed by [attackerKind * PARTICLE_KIND_COUNT + defenderKind]
const _table = new Float32Array(PARTICLE_KIND_COUNT * PARTICLE_KIND_COUNT).fill(1.0);

function setMultiplier(attackerKind: number, defenderKind: number, value: number): void {
  _table[attackerKind * PARTICLE_KIND_COUNT + defenderKind] = value;
}

// ---- Fire (1) interactions -----------------------------------------------
// fire vs ice: 3 fire needed per ice = already handled by ice.toughness=3 / fire.attackPower=1
// No extra multiplier needed; ice is simply tough, not fire-resistant.
setMultiplier(1, 11, 2.0);  // fire vs nature -- fire burns plants more efficiently
setMultiplier(1, 12, 0.5);  // fire vs crystal -- fire barely melts crystal (crystal handles heat)

// ---- Ice (2) interactions ------------------------------------------------
setMultiplier(2, 1, 1.0);   // ice vs fire (neutral; fire just has low toughness)

// ---- Lightning (3) interactions ------------------------------------------
setMultiplier(3, 2, 10.0);  // lightning vs ice  -- destroys ice "for free"
setMultiplier(3, 9, 2.0);   // lightning vs metal
setMultiplier(3, 12, 2.0);  // lightning vs crystal -- shatters crystal

// ---- Poison (4) interactions ---------------------------------------------
setMultiplier(4, 11, 2.0);  // poison vs nature

// ---- Wind (6) interactions -----------------------------------------------
setMultiplier(6, 4, 2.0);   // wind vs poison -- disperses clouds

// ---- Holy (7) interactions -----------------------------------------------
setMultiplier(7, 8, 2.0);   // holy vs shadow
setMultiplier(7, 13, 1.5);  // holy vs void

// ---- Shadow (8) interactions ---------------------------------------------
setMultiplier(8, 7, 0.5);   // shadow vs holy -- shadow is weak to holy

// ---- Metal (9) interactions ----------------------------------------------
setMultiplier(9, 11, 1.5);  // metal vs nature
setMultiplier(9, 10, 1.5);  // metal vs earth

// ---- Earth (10) interactions ---------------------------------------------
setMultiplier(10, 3, 2.0);  // earth vs lightning -- grounds electricity

// ---- Void (13) interactions ----------------------------------------------
setMultiplier(13, 5, 2.0);  // void vs arcane -- void absorbs magic

// ---- Lava (16) interactions ----------------------------------------------
setMultiplier(16, 11, 3.0); // lava vs nature  -- burns plants easily
setMultiplier(16, 2, 0.5);  // lava vs ice     -- ice partially quenches lava
setMultiplier(16, 6, 0.5);  // lava vs wind    -- wind disperses lava slowly
setMultiplier(2, 16, 2.0);  // ice vs lava     -- solidifies lava
setMultiplier(6, 16, 1.5);  // wind vs lava    -- fans the flames

// ---- Stone (17) interactions ---------------------------------------------
setMultiplier(17, 1, 1.5);  // stone vs fire   -- stone smothers fire
setMultiplier(17, 16, 0.5); // stone vs lava   -- lava melts stone
setMultiplier(3, 17, 2.5);  // lightning vs stone -- shatters rock
setMultiplier(16, 17, 2.0); // lava vs stone   -- melts stone
setMultiplier(1, 17, 0.5);  // fire vs stone   -- fire barely damages stone

/** Returns the elemental damage multiplier for attackerKind hitting defenderKind. */
export function getElementalMultiplier(attackerKind: number, defenderKind: number): number {
  if (attackerKind < 0 || attackerKind >= PARTICLE_KIND_COUNT) return 1.0;
  if (defenderKind < 0 || defenderKind >= PARTICLE_KIND_COUNT) return 1.0;
  return _table[attackerKind * PARTICLE_KIND_COUNT + defenderKind];
}
