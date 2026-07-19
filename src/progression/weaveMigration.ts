/**
 * Independent Active-Weave Unlock Migration.
 *
 * Historically, Sword/Shield/Bow behavior was gated behind a single
 * mutually-exclusive "secondary weave" choice (`shield`, `arrow`, or the
 * combo `shield_sword`) recorded in `WeaveBinding.weaveId` /
 * `world.playerSecondaryWeaveId`. That field is still the *equipped* slot
 * (LMB/RMB binding) and is left untouched here — it is not the source of
 * truth for whether an ability is *usable*.
 *
 * `PlayerProgress.unlockedActiveWeaves` is already the independent-unlock
 * list (see `unlockActiveWeave` in `./unlocks.ts`): any WeaveId placed in it
 * is usable regardless of what is currently equipped. Because it is already
 * a flat array of independent flags, legacy `shield` / `arrow` entries are
 * already independent unlocks and need no transformation — the ONLY gap is
 * that the legacy `shield_sword` combo id does not by itself imply the new,
 * separate Sword unlock (`WEAVE_SWORD`). This module closes that gap.
 *
 * NOTE: Stormweave has its own independent unlock system already
 * (`unlockedActiveWeaves` containing `WEAVE_STORM`, granted via the early
 * auto-assignment / campaign options) and is intentionally left alone here.
 */

import { PlayerProgress } from './playerProgress';
import {
  WeaveId,
  WEAVE_REGISTRY,
  WEAVE_SHIELD,
  WEAVE_ARROW,
  WEAVE_SHIELD_SWORD,
  WEAVE_SWORD,
} from '../sim/weaves/weaveDefinition';
import { unlockActiveWeave } from './unlocks';

/**
 * Migrates `progress.unlockedActiveWeaves` in place so Sword/Shield/Bow are
 * independently unlockable:
 *   - Legacy `shield_sword` → grants both `sword` and `shield` (in addition
 *     to leaving `shield_sword` itself in the list, since it is still read
 *     directly by the equip/combat code as the combo weave id).
 *   - Legacy `arrow` → already an independent unlock (WEAVE_ARROW doubles as
 *     the Bow Weave id); nothing to add beyond what is already present.
 *   - Legacy `shield` → already an independent unlock; nothing to add.
 *   - Unknown/invalid weave ids are dropped (sanitized), never thrown on.
 *   - Duplicate ids are removed.
 *
 * Idempotent: running this twice produces the same result as running it
 * once. Never removes an id that was already present — only sanitizes
 * unknown entries and adds newly-implied unlocks.
 */
export function migrateLegacyWeaveUnlocks(progress: PlayerProgress): void {
  const existing = Array.isArray(progress.unlockedActiveWeaves)
    ? progress.unlockedActiveWeaves
    : [];

  // Sanitize: keep only known weave ids (never throw on unknown/garbage
  // entries), and de-duplicate.
  const sanitized: WeaveId[] = [];
  const seen = new Set<WeaveId>();
  for (const id of existing) {
    if (typeof id !== 'string') continue;
    if (!WEAVE_REGISTRY.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    sanitized.push(id);
  }

  progress.unlockedActiveWeaves = sanitized;

  // shield_sword implies the independent Sword + Shield unlocks.
  if (seen.has(WEAVE_SHIELD_SWORD)) {
    unlockActiveWeave(progress, WEAVE_SWORD);
    unlockActiveWeave(progress, WEAVE_SHIELD);
  }

  // arrow / shield are already independent unlocks by virtue of being in
  // `unlockedActiveWeaves` — WEAVE_ARROW is the Bow Weave id and WEAVE_SHIELD
  // is the Shield Weave id, so `hasBowWeave`/`hasShieldWeave` already see
  // them. No additional grant needed.
}

// ---- Independent unlock getters --------------------------------------------

/** Returns true if the player has independently unlocked the Sword Weave. */
export function hasSwordWeave(progress: Pick<PlayerProgress, 'unlockedActiveWeaves'>): boolean {
  return progress.unlockedActiveWeaves.indexOf(WEAVE_SWORD) !== -1;
}

/** Returns true if the player has independently unlocked the Shield Weave. */
export function hasShieldWeave(progress: Pick<PlayerProgress, 'unlockedActiveWeaves'>): boolean {
  return progress.unlockedActiveWeaves.indexOf(WEAVE_SHIELD) !== -1;
}

/** Returns true if the player has independently unlocked the Bow Weave. */
export function hasBowWeave(progress: Pick<PlayerProgress, 'unlockedActiveWeaves'>): boolean {
  return progress.unlockedActiveWeaves.indexOf(WEAVE_ARROW) !== -1;
}

/**
 * Maps a legacy single-value "starting weave" / equip slot value to the set
 * of independent weave ids it should grant. Used by campaign starting-weave
 * migration so old single-value campaign configs still grant the right
 * independent unlocks.
 *   - 'shield_sword' → ['shield_sword', 'sword', 'shield']
 *   - 'arrow'        → ['arrow']  (already == Bow Weave id)
 *   - 'shield'       → ['shield']
 *   - 'storm'        → ['storm']  (left as its own independent system)
 *   - anything else known to WEAVE_REGISTRY → itself, unchanged
 *   - unknown ids → [] (safely ignored, never throws)
 */
export function expandLegacyWeaveId(weaveId: string): WeaveId[] {
  if (!WEAVE_REGISTRY.has(weaveId)) return [];
  if (weaveId === WEAVE_SHIELD_SWORD) return [WEAVE_SHIELD_SWORD, WEAVE_SWORD, WEAVE_SHIELD];
  return [weaveId];
}
