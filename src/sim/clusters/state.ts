import { PLAYER_HALF_WIDTH_WORLD, PLAYER_HALF_HEIGHT_WORLD } from '../../levels/roomDef';

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
  /**
   * 1 after any wall jump has been used since the last reset point.
   * Reset points: touching ground or attaching a grapple.
   */
  hasUsedWallJumpSinceResetFlag: 0 | 1;

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

  // ---- Rock Elemental (populated only when isRockElementalFlag === 1) ------
  /**
   * 1 if this cluster is a rock elemental — hovers near the ground,
   * orbits brown-rock dust, and fires dust projectiles at the player.
   */
  isRockElementalFlag: 0 | 1;
  /**
   * Current Rock Elemental state:
   *  0 = inactive (rock pieces on ground, not damageable)
   *  1 = activating (transitioning from rock pieces to floating formation)
   *  2 = active (hovering, idle)
   *  3 = evading (retreating from player when too close)
   *  4 = attacking (firing dust projectile)
   *  5 = regenerating (rebuilding dust orbit)
   *  6 = dead
   */
  rockElementalState: number;
  /** Ticks elapsed in the current state (used for activation lerp, etc.). */
  rockElementalStateTicks: number;
  /** Spawn X position (world units) — used for leash radius check. */
  rockElementalSpawnXWorld: number;
  /** Spawn Y position (world units) — used for leash radius check. */
  rockElementalSpawnYWorld: number;
  /** Current number of orbiting dust particles. */
  rockElementalDustCount: number;
  /** Accumulated orbit angle (radians) — drives dust rotation. */
  rockElementalOrbitAngleRad: number;
  /** Ticks since last dust regeneration. */
  rockElementalRegenTicks: number;
  /**
   * Activation lerp progress in [0, 1].
   * 0 = fully on ground (rock pieces), 1 = fully floating formation.
   */
  rockElementalActivationProgress: number;

  // ---- Grapple Hunter (populated only when isGrappleHunterFlag === 1) --------
  /** 1 if this cluster is a grapple hunter — walks, jumps, fires a slow grapple at the player. */
  isGrappleHunterFlag: 0 | 1;
  /**
   * Grapple Hunter AI state:
   *  0 = idle (waiting, not engaged)
   *  1 = chase (walking toward player)
   *  2 = attack (extending grapple chain toward player)
   *  3 = reel (zip-pulling toward player after hit)
   *  4 = recover (cooldown after attack or miss)
   */
  grappleHunterState: number;
  /** Ticks elapsed in the current grapple hunter state. */
  grappleHunterStateTicks: number;
  /** Cooldown ticks before grapple hunter can attack again. */
  grappleHunterCooldownTicks: number;
  /** Start index in particle buffer for this hunter's grapple chain (8 segments). -1 if not allocated. */
  grappleHunterChainStartIndex: number;
  /** X position of the grapple chain tip during attack. */
  grappleHunterTipXWorld: number;
  /** Y position of the grapple chain tip during attack. */
  grappleHunterTipYWorld: number;
  /** Direction the grapple was fired (normalized X). */
  grappleHunterFireDirX: number;
  /** Direction the grapple was fired (normalized Y). */
  grappleHunterFireDirY: number;
  /** 1 if the grapple tip has hit the player during this attack. */
  grappleHunterHasHitPlayerFlag: 0 | 1;

  // ---- Radiant Tether boss (populated only when isRadiantTetherFlag === 1) --
  /**
   * 1 if this cluster is the Radiant Tether boss — a floating sphere of light
   * that uses rotating laser telegraphs and anchored chains of light.
   */
  isRadiantTetherFlag: 0 | 1;
  /**
   * Current Radiant Tether state:
   *  0 = inactive (dormant, awaiting player proximity)
   *  1 = telegraph (rotating laser preview lines)
   *  2 = lock (lasers fixed for reaction window)
   *  3 = firing (chains extending to anchors)
   *  4 = movement (boss moves via chain winching)
   *  5 = reset (retracting chains, preparing next cycle)
   *  6 = dead
   */
  radiantTetherState: number;
  /** Ticks elapsed in the current state. */
  radiantTetherStateTicks: number;
  /** Base angle (radians) for evenly-spaced telegraph / chain directions. */
  radiantTetherBaseAngleRad: number;
  /** Current number of active chains (determined by health thresholds). */
  radiantTetherChainCount: number;
  /** Boss horizontal velocity (world units/tick). */
  radiantTetherVelXWorld: number;
  /** Boss vertical velocity (world units/tick). */
  radiantTetherVelYWorld: number;

  // ---- Player sprite state (populated only when isPlayerFlag === 1) --------
  /** 1 when the player is facing left (sprites face right by default). */
  isFacingLeftFlag: 0 | 1;
  /** 1 while the player is sprinting (shift held + grounded + moving). */
  isSprintingFlag: 0 | 1;
  /** 1 while the player is crouching (S/down held + grounded). */
  isCrouchingFlag: 0 | 1;
  /** Ticks since last horizontal movement input (for idle animation trigger). */
  playerIdleTimerTicks: number;
  /**
   * Current idle animation state:
   *  0 = standing (default)
   *  1 = idle1
   *  2 = idle2
   *  3 = idleBlink
   */
  playerIdleAnimState: number;
  /** Ticks remaining until the next idle animation switch. */
  playerIdleNextSwitchTicks: number;

  // ---- Player skid / slide state -------------------------------------------
  /** 1 while the player is skidding (sprint + traveling opposite to facing). */
  isSkiddingFlag: 0 | 1;
  /** 1 while the player is sliding (sprint + crouch/down on ground). */
  isSlidingFlag: 0 | 1;

  // ---- Damage / hit feedback -----------------------------------------------
  /**
   * Ticks remaining during which the player is invulnerable to damage.
   * Counted down each tick; while > 0 incoming hits are ignored.
   */
  invulnerabilityTicks: number;
  /**
   * Ticks remaining in the hurt visual feedback window.
   * While > 0 the player sprite shows a damage tint / flash.
   */
  hurtTicks: number;

  // ---- Slime enemy (populated only when isSlimeFlag === 1) ----------------
  /** 1 if this cluster is a slime — hops toward player each interval. */
  isSlimeFlag: 0 | 1;
  /** Countdown ticks until next hop. */
  slimeHopTimerTicks: number;

  // ---- Large Dust Slime (populated only when isLargeSlimeFlag === 1) ------
  /** 1 if this cluster is a large dust slime — larger, slower, orbiting dust, splits on death. */
  isLargeSlimeFlag: 0 | 1;
  /** Accumulated orbit angle (radians) for dust visual. */
  largeSlimeDustOrbitAngleRad: number;
  /** 1 once the split-on-death has been triggered so it only fires once. */
  largeSlimeSplitDoneFlag: 0 | 1;

  // ---- Wheel enemy (populated only when isWheelEnemyFlag === 1) -----------
  /** 1 if this cluster is a wheel enemy — rolls along surfaces toward the player. */
  isWheelEnemyFlag: 0 | 1;
  /** Accumulated roll angle (radians) — drives spoke rotation renderer. */
  wheelRollAngleRad: number;

  // ---- Golden Beetle (populated only when isBeetleFlag === 1) ---------------
  /**
   * 1 if this cluster is a golden beetle — crawls on any surface (floor/wall/ceiling),
   * damages the player on contact, and flies when agitated.
   */
  isBeetleFlag: 0 | 1;
  /**
   * Current beetle AI state:
   *  0 = crawl_toward  — crawling toward player along current surface (50% base prob)
   *  1 = crawl_away    — crawling away from player along current surface (25% base prob)
   *  2 = idle          — sitting still on surface (25% base prob)
   *  3 = fly_away      — flying away from player (triggered by damage dealt/received)
   *  4 = fly_toward    — flying toward player (50% chance after idle state ends)
   */
  beetleAiState: number;
  /** Ticks remaining in the current AI state. 0 triggers a state transition. */
  beetleAiStateTicks: number;
  /** X component of the surface normal the beetle is currently attached to (0 = no surface). */
  beetleSurfaceNormalXWorld: number;
  /** Y component of the surface normal the beetle is currently attached to. */
  beetleSurfaceNormalYWorld: number;
  /** 1 while the beetle is in flight (states 3 or 4); 0 when crawling/idle. */
  beetleIsFlightModeFlag: 0 | 1;
  /** Health recorded at end of last tick, used to detect incoming damage. */
  beetlePrevHealthPoints: number;

  // ---- Square Stampede (populated only when isSquareStampedeFlag === 1) -----
  /**
   * 1 if this cluster is a square stampede enemy — floats in 2D, dashes
   * along orthogonal axes, and leaves a shrinking ghost trail.
   */
  isSquareStampedeFlag: 0 | 1;
  /**
   * Index into the WorldState square-stampede trail ring-buffer arrays.
   * -1 when no slot has been assigned.
   */
  squareStampedeSlotIndex: number;
  /**
   * Original full-health half-size (world units). Constant after spawn.
   * Used by the renderer to scale each trail ghost independently of current HP.
   */
  squareStampedeBaseHalfSizeWorld: number;
  /**
   * Current AI movement state:
   *   0 = idle (pausing between dashes)
   *   1 = dashing horizontally (±X)
   *   2 = dashing vertically (±Y)
   */
  squareStampedeAiState: number;
  /** Ticks remaining in the current AI state. */
  squareStampedeAiStateTicks: number;
  /** Countdown ticks until the next trail position is recorded. */
  squareStampedeTrailTimerTicks: number;

  // ---- Bubble enemy (populated only when isBubbleEnemyFlag === 1) ----------
  /**
   * 1 if this cluster is a bubble enemy (water or ice variant).
   * Drifts in 2D, repelled by walls/other bubbles, ring of particles orbits center.
   */
  isBubbleEnemyFlag: 0 | 1;
  /** 1 if this is the ice variant (pops on any damage); 0 for water variant (pops at <75% HP). */
  isIceBubbleFlag: 0 | 1;
  /**
   * 0 = alive/drifting, 1 = popped (particles flying free).
   * Cluster's isAliveFlag is set to 0 once all popped particles are gone.
   */
  bubbleState: number;
  /** Maximum number of ring particles (set at spawn, never changes). */
  bubbleMaxParticleCount: number;
  /** Accumulated rotation angle (radians) of the orbit ring — incremented each tick. */
  bubbleOrbitAngleRad: number;
  /** Countdown ticks until the water bubble regenerates one particle (water only). */
  bubbleRegenTicks: number;
  /** Phase (radians) for the Lissajous-curve drift direction — incremented each tick. */
  bubbleDriftPhaseRad: number;
  /** Health recorded at end of previous tick — used by ice bubble to detect any damage instantly. */
  bubblePrevHealthPoints: number;

  // ---- Golden Mimic (populated only when isGoldenMimicFlag === 1) -----------
  /**
   * 1 if this cluster is a golden mimic — a golden silhouette of the player that
   * mirrors the player's movement (X-axis flipped), deals contact damage, and
   * collapses into a heap when half its particles are destroyed.
   */
  isGoldenMimicFlag: 0 | 1;
  /**
   * 1 for the XY-flipped variant: moves with both axes flipped relative to the
   * player (X and Y mirrored), and floats upward instead of falling in heap state.
   */
  isGoldenMimicYFlippedFlag: 0 | 1;
  /**
   * Current mimic state:
   *  0 = active  — mimicking player movement, dealing contact damage
   *  1 = heap    — half pixels gone; falling (normal) or rising (Y-flipped); fading out
   */
  goldenMimicState: number;
  /** Ticks elapsed in the current mimic state. */
  goldenMimicStateTicks: number;
  /**
   * Particle count recorded at spawn.  Used to detect the half-dead threshold
   * (alive count ≤ goldenMimicInitialParticleCount / 2 → transition to heap).
   */
  goldenMimicInitialParticleCount: number;
  /**
   * Fade alpha for the heap state, in [1.0, 0.0].
   * Decremented each tick in heap state; when it reaches 0 the cluster is killed.
   * Read by the renderer to set globalAlpha on the golden silhouette.
   */
  goldenMimicFadeAlpha: number;

  // ---- Bee Swarm (populated only when isBeeSwarmFlag === 1) ------------------
  /**
   * 1 if this cluster is a bee swarm — 10 bees that orbit a spawn area until
   * the player comes close or the swarm takes damage, then charge the player.
   * Each bee can be killed by 1 golden mote (1 Physical particle hit).
   */
  isBeeSwarmFlag: 0 | 1;
  /**
   * Index into the WorldState bee-position arrays (0..MAX_BEE_SWARMS-1).
   * -1 when no slot has been assigned.
   */
  beeSwarmSlotIndex: number;
  /**
   * Current bee-swarm AI state:
   *   0 = swarming — bees orbit the spawn area in a natural pattern
   *   1 = charging — bees fly toward the player and deal contact damage
   */
  beeSwarmState: number;
  /** Ticks elapsed in the current bee-swarm AI state. */
  beeSwarmStateTicks: number;
  /** Spawn X position (world units) — center of the swarm's patrol area. */
  beeSwarmSpawnXWorld: number;
  /** Spawn Y position (world units) — center of the swarm's patrol area. */
  beeSwarmSpawnYWorld: number;
  /** Health recorded at end of last tick, used to detect incoming damage for aggro. */
  beeSwarmPrevHealthPoints: number;
  /** Global orbit angle (radians) incremented each tick to animate the swarm path. */
  beeSwarmOrbitAngleRad: number;
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
    halfWidthWorld: PLAYER_HALF_WIDTH_WORLD,
    halfHeightWorld: PLAYER_HALF_HEIGHT_WORLD,
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
    hasUsedWallJumpSinceResetFlag: 0,
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
    isRockElementalFlag: 0,
    rockElementalState: 0,
    rockElementalStateTicks: 0,
    rockElementalSpawnXWorld: positionXWorld,
    rockElementalSpawnYWorld: positionYWorld,
    rockElementalDustCount: 0,
    rockElementalOrbitAngleRad: 0,
    rockElementalRegenTicks: 0,
    rockElementalActivationProgress: 0,
    isRadiantTetherFlag: 0,
    radiantTetherState: 0,
    radiantTetherStateTicks: 0,
    radiantTetherBaseAngleRad: 0,
    radiantTetherChainCount: 3,
    radiantTetherVelXWorld: 0,
    radiantTetherVelYWorld: 0,
    isGrappleHunterFlag: 0,
    grappleHunterState: 0,
    grappleHunterStateTicks: 0,
    grappleHunterCooldownTicks: 0,
    grappleHunterChainStartIndex: -1,
    grappleHunterTipXWorld: 0,
    grappleHunterTipYWorld: 0,
    grappleHunterFireDirX: 0,
    grappleHunterFireDirY: 0,
    grappleHunterHasHitPlayerFlag: 0,
    isFacingLeftFlag: 0,
    isSprintingFlag: 0,
    isCrouchingFlag: 0,
    playerIdleTimerTicks: 0,
    playerIdleAnimState: 0,
    playerIdleNextSwitchTicks: 0,
    isSkiddingFlag: 0,
    isSlidingFlag: 0,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
    isSlimeFlag: 0,
    slimeHopTimerTicks: 0,
    isLargeSlimeFlag: 0,
    largeSlimeDustOrbitAngleRad: 0,
    largeSlimeSplitDoneFlag: 0,
    isWheelEnemyFlag: 0,
    wheelRollAngleRad: 0,
    isBeetleFlag: 0,
    beetleAiState: 0,
    beetleAiStateTicks: 0,
    beetleSurfaceNormalXWorld: 0,
    beetleSurfaceNormalYWorld: -1,
    beetleIsFlightModeFlag: 0,
    beetlePrevHealthPoints: maxHealthPoints,
    isSquareStampedeFlag: 0,
    squareStampedeSlotIndex: -1,
    squareStampedeBaseHalfSizeWorld: 0,
    squareStampedeAiState: 0,
    squareStampedeAiStateTicks: 0,
    squareStampedeTrailTimerTicks: 0,
    isBubbleEnemyFlag: 0,
    isIceBubbleFlag: 0,
    bubbleState: 0,
    bubbleMaxParticleCount: 0,
    bubbleOrbitAngleRad: 0,
    bubbleRegenTicks: 0,
    bubbleDriftPhaseRad: 0,
    bubblePrevHealthPoints: maxHealthPoints,
    isGoldenMimicFlag: 0,
    isGoldenMimicYFlippedFlag: 0,
    goldenMimicState: 0,
    goldenMimicStateTicks: 0,
    goldenMimicInitialParticleCount: 0,
    goldenMimicFadeAlpha: 1.0,
    isBeeSwarmFlag: 0,
    beeSwarmSlotIndex: -1,
    beeSwarmState: 0,
    beeSwarmStateTicks: 0,
    beeSwarmSpawnXWorld: positionXWorld,
    beeSwarmSpawnYWorld: positionYWorld,
    beeSwarmPrevHealthPoints: maxHealthPoints,
    beeSwarmOrbitAngleRad: 0,
  };
}
