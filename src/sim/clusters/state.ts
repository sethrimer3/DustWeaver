export interface ClusterState {
  entityId: number;
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isAliveFlag: 0 | 1;
  isPlayerFlag: 0 | 1;
  healthPoints: number;
  maxHealthPoints: number;

  // ---- Platformer physics -------------------------------------------------
  /** 1 when the cluster is resting on a surface (floor or platform top). */
  isGroundedFlag: 0 | 1;
  /** Half-width of the cluster box in world units (used for rendering and collision). */
  halfWidthWorld: number;
  /** Half-height of the cluster box in world units (used for rendering and collision). */
  halfHeightWorld: number;

  // ---- Dash (player and enemy) -------------------------------------------
  /** Remaining cooldown ticks before dash is available again.  0 = ready. */
  dashCooldownTicks: number;
  /** Set to a non-zero value when dash recharges — counts down for visual ring. */
  dashRechargeAnimTicks: number;

  // ---- Enemy AI state (populated only when isPlayerFlag === 0) -----------
  /** Ticks until the enemy can attack again. */
  enemyAiAttackCooldownTicks: number;
  /** Set to 1 by enemy AI to trigger an attack launch this tick. */
  enemyAttackTriggeredFlag: 0 | 1;
  /** Normalized direction the enemy should attack toward. */
  enemyAttackDirXWorld: number;
  enemyAttackDirYWorld: number;
  /** 1 while this enemy is in block mode. */
  enemyAiIsBlockingFlag: 0 | 1;
  /** Normalized block direction for this enemy. */
  enemyAiBlockDirXWorld: number;
  enemyAiBlockDirYWorld: number;
  /** Ticks remaining in the current block stance. */
  enemyAiBlockRemainingTicks: number;
  /** Ticks remaining in the current dodge burst. */
  enemyAiDodgeTicks: number;
  /** Lateral dodge velocity (world units / sec). */
  enemyAiDodgeDirXWorld: number;
  enemyAiDodgeDirYWorld: number;
}

export function createClusterState(
  entityId: number,
  positionXWorld: number,
  positionYWorld: number,
  isPlayerFlag: 0 | 1,
  maxHealthPoints: number,
): ClusterState {
  return {
    entityId,
    positionXWorld,
    positionYWorld,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isAliveFlag: 1,
    isPlayerFlag,
    healthPoints: maxHealthPoints,
    maxHealthPoints,
    isGroundedFlag: 0,
    halfWidthWorld: 20,
    halfHeightWorld: 28,
    dashCooldownTicks: 0,
    dashRechargeAnimTicks: 0,
    enemyAiAttackCooldownTicks: 30,
    enemyAttackTriggeredFlag: 0,
    enemyAttackDirXWorld: 1,
    enemyAttackDirYWorld: 0,
    enemyAiIsBlockingFlag: 0,
    enemyAiBlockDirXWorld: 1,
    enemyAiBlockDirYWorld: 0,
    enemyAiBlockRemainingTicks: 0,
    enemyAiDodgeTicks: 0,
    enemyAiDodgeDirXWorld: 0,
    enemyAiDodgeDirYWorld: 0,
  };
}
