/**
 * Combat mode persistence layer.
 *
 * ARCHITECTURE — single source of truth:
 *   world.combatMode  ← runtime source of truth for ALL sim code.
 *                        Synced from the module singleton at the top of each tick.
 *   _currentMode      ← module singleton; updated by the pause menu toggle and
 *                        on game start (from localStorage via getCombatModeFromStorage).
 *   localStorage      ← persistence; written by saveCombatModeToStorage in renderSettings.ts.
 *
 * Toggle flow (pause menu):
 *   pauseMenu → setCombatMode(mode) + saveCombatModeToStorage(mode)
 *   next tick  → tick() syncs world.combatMode = getCombatMode()
 *
 * Init flow (game start):
 *   gameScreen → setCombatMode(getCombatModeFromStorage())
 *             → world.combatMode = getCombatModeFromStorage()  (explicit on world creation)
 */

export type CombatMode = 'legacy' | 'momentum';
export const DEFAULT_COMBAT_MODE: CombatMode = 'momentum';

let _currentMode: CombatMode = DEFAULT_COMBAT_MODE;

export function getCombatMode(): CombatMode { return _currentMode; }
export function setCombatMode(mode: CombatMode): void { _currentMode = mode; }
