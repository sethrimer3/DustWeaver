export type CombatMode = 'legacy' | 'momentum';
export const DEFAULT_COMBAT_MODE: CombatMode = 'momentum';

let _currentMode: CombatMode = DEFAULT_COMBAT_MODE;

export function getCombatMode(): CombatMode { return _currentMode; }
export function setCombatMode(mode: CombatMode): void { _currentMode = mode; }
