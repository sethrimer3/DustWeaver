/** Number of current-life motes granted by one Dust Container. */
export const MOTES_PER_DUST_CONTAINER = 4;

/** Baseline mote capacity before permanent Dust Container upgrades. */
export const PLAYER_BASE_MOTE_CAPACITY = 10;

export interface PlayerMoteLifeState {
  healthPoints: number;
  maxHealthPoints: number;
}

export function normalizeMoteCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Reads the canonical current-mote value from the shared player cluster. */
export function getPlayerMoteCount(player: Pick<PlayerMoteLifeState, 'healthPoints'>): number {
  return normalizeMoteCount(player.healthPoints);
}

/** Reads the canonical maximum mote capacity from the shared player cluster. */
export function getPlayerMoteCapacity(player: Pick<PlayerMoteLifeState, 'maxHealthPoints'>): number {
  return normalizeMoteCount(player.maxHealthPoints);
}

export function getPlayerMoteCapacityForContainerCount(containerCount: number): number {
  return PLAYER_BASE_MOTE_CAPACITY
    + normalizeMoteCount(containerCount) * MOTES_PER_DUST_CONTAINER;
}

/** Grants restorative motes without exceeding the player's canonical capacity. */
export function grantPlayerMotes(player: PlayerMoteLifeState, moteCount: number): number {
  const capacity = getPlayerMoteCapacity(player);
  const before = Math.min(getPlayerMoteCount(player), capacity);
  const grant = normalizeMoteCount(moteCount);
  player.healthPoints = Math.min(capacity, before + grant);
  return player.healthPoints - before;
}

/** Adds permanent capacity and fills every newly added mote slot atomically. */
export function grantDustContainerMotes(
  player: PlayerMoteLifeState,
  containerCount = 1,
): number {
  const containers = normalizeMoteCount(containerCount);
  const grantedMotes = containers * MOTES_PER_DUST_CONTAINER;
  const previousMotes = getPlayerMoteCount(player);
  player.maxHealthPoints = getPlayerMoteCapacity(player) + grantedMotes;
  player.healthPoints = Math.min(player.maxHealthPoints, previousMotes + grantedMotes);
  return grantedMotes;
}
