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
  /**
   * Coyote-time countdown (ticks).  Set to COYOTE_TIME_TICKS when the cluster
   * leaves a grounded surface; a jump is still allowed while > 0.
   */
  coyoteTimeTicks: number;
  /**
   * Jump-buffer countdown (ticks).  Set to JUMP_BUFFER_TICKS when a jump input
   * arrives while the cluster is airborne; the jump fires when the cluster next
   * lands while bufferTicks > 0.
   */
  jumpBufferTicks: number;
  /**
   * Snapshot of playerJumpHeldFlag from the previous tick.
   * Retained for potential future use; no longer drives the jump-cut logic
   * (jump cut is now implemented via an extra gravity multiplier, not velocity clamping).
   */
  prevJumpHeldFlag: 0 | 1;

  // ---- Variable jump sustain (Celeste-style) --------------------------------
  /**
   * Ticks remaining in the variable-jump sustain window.
   * While > 0 and the jump button is held, upward velocity is sustained so
   * gravity cannot eat into the launch speed — producing expressive full jumps.
   */
  varJumpTimerTicks: number;
  /**
   * Snapshot of the vertical launch speed at the moment of a jump.
   * Used by the sustain window to cap velocity (negative = upward).
   */
  varJumpSpeedWorld: number;

  // ---- Wall interaction ---------------------------------------------------
  /** 1 when the player's left side is pressed against a solid wall this tick. */
  isTouchingWallLeftFlag: 0 | 1;
  /** 1 when the player's right side is pressed against a solid wall this tick. */
  isTouchingWallRightFlag: 0 | 1;
  /** 1 while the player is performing a controlled wall slide. */
  isWallSlidingFlag: 0 | 1;
  /**
   * Ticks remaining in the post-wall-jump lockout window.
   * While > 0 the wall sensor that triggered the jump will not allow a new
   * wall slide or wall jump, preventing instant re-grab / infinite climbing.
   */
  wallJumpLockoutTicks: number;
  /**
   * Ticks remaining in the post-wall-jump force window.
   * While > 0, horizontal input is overridden by the outward wall-jump
   * direction so the player cannot immediately steer back to the wall.
   */
  wallJumpForceTimeTicks: number;
  /**
   * Direction of the most recent wall jump (±1).
   * Used during the force-time window to maintain outward velocity.
   */
  wallJumpDirX: number;

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
  /** Dodge velocity direction (world units / sec). */
  enemyAiDodgeDirXWorld: number;
  enemyAiDodgeDirYWorld: number;

  // ---- Flying Eye (populated only when isFlyingEyeFlag === 1) ------------
  /**
   * 1 if this cluster is a flying eye — hovers in the air, moves in 2D,
   * and is rendered as 4 concentric diamond outlines.
   */
  isFlyingEyeFlag: 0 | 1;
  /**
   * The angle (radians) the eye is currently "looking" toward.
   * Smoothly tracks the cluster's velocity direction each tick.
   * Used by the renderer to slide the inner diamond rings in the facing direction.
   */
  flyingEyeFacingAngleRad: number;
  /**
   * Primary element kind used by this flying eye (ParticleKind value).
   * Stored here so the renderer can apply the correct element colour without
   * scanning the particle buffers each frame.
   */
  flyingEyeElementKind: number;

  // ---- Rolling Enemy (populated only when isRollingEnemyFlag === 1) -------
  /**
   * 1 if this cluster is a rolling ground enemy — uses a sprite that rotates
   * as the enemy rolls, and forms a crescent shield when blocking.
   */
  isRollingEnemyFlag: 0 | 1;
  /**
   * Which enemy sprite to render (1–6), corresponding to enemy (N).png.
   * Set at spawn time from RoomEnemyDef; never changed during gameplay.
   */
  rollingEnemySpriteIndex: number;
  /**
   * Accumulated roll rotation (radians) — incremented each tick proportional
   * to horizontal velocity so the sprite appears to roll along the ground.
   */
  rollingEnemyRollAngleRad: number;
  /**
   * Countdown ticks during which the enemy aggressively chases the player
   * after taking damage, even if the player is outside normal sight range.
   * Decremented each tick; set to ROLLING_ENEMY_AGGRO_DURATION_TICKS on damage.
   */
  rollingEnemyAggressiveTicks: number;

  // ---- Player sprite rotation (populated only when isPlayerFlag === 1) -----
  /**
   * Accumulated rotation angle (radians) for the player sprite.
   * Slowly increments each tick; speeds up while the player is blocking.
   */
  playerRotationAngleRad: number;
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
    halfWidthWorld: 5,
    halfHeightWorld: 5,
    coyoteTimeTicks: 0,
    jumpBufferTicks: 0,
    prevJumpHeldFlag: 0,
    varJumpTimerTicks: 0,
    varJumpSpeedWorld: 0,
    isTouchingWallLeftFlag: 0,
    isTouchingWallRightFlag: 0,
    isWallSlidingFlag: 0,
    wallJumpLockoutTicks: 0,
    wallJumpForceTimeTicks: 0,
    wallJumpDirX: 0,
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
    isFlyingEyeFlag: 0,
    flyingEyeFacingAngleRad: 0,
    flyingEyeElementKind: 0,
    isRollingEnemyFlag: 0,
    rollingEnemySpriteIndex: 1,
    rollingEnemyRollAngleRad: 0,
    rollingEnemyAggressiveTicks: 0,
    playerRotationAngleRad: 0,
  };
}
