import { PLAYER_HALF_WIDTH_WORLD, PLAYER_HALF_HEIGHT_WORLD } from '../../levels/roomDef';
import { MAX_CW_METEOR_SCHEDULE } from './crimsonWizardConfig';
import type { ChallengeModeState } from '../challengeMode';

export interface ClusterState {
  /** World-local challenge state reference, assigned only on the active player. */
  challengeMode: ChallengeModeState | null;
  challengeReturnGuard: 0 | 1;
  entityId: number;
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isAliveFlag: 0 | 1;
  isPlayerFlag: 0 | 1;
  countsTowardRoomCompletionFlag: 0 | 1;
  healthPoints: number;
  maxHealthPoints: number;

  // ---- Platformer physics -------------------------------------------------
  /** 1 when the cluster is resting on a surface (floor or platform top). */
  isGroundedFlag: 0 | 1;
  /**
   * 1 when the cluster is grounded on an ice surface (wallIsIceFlag[wi] === 1).
   * Cleared each tick alongside isGroundedFlag; set by resolveWallsY when
   * the landing wall is an ice block.  Used by playerHorizontalMovement to
   * suppress normal friction and apply reduced ice traction instead.
   */
  isGroundedOnIceFlag: 0 | 1;
  /**
   * 1 when the cluster is grounded on an ultra-ice surface (wallIsUltraIceFlag[wi] === 1).
   * Cleared each tick alongside isGroundedFlag; set by resolveWallsY when the landing
   * wall is an ultra-ice block.
   */
  isGroundedOnUltraIceFlag: 0 | 1;
  /**
   * 1 while the player is in the "ultra ice" state — lateral velocity is locked and
   * input cannot accelerate or decelerate horizontally.  Set when the player first
   * touches an ultra-ice surface; cleared when the player lands on any non-ultra-ice
   * surface.  Persists through jumps and airborne phases.
   */
  isOnUltraIceFlag: 0 | 1;
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

  // ---- Committed fast-fall mode --------------------------------------------
  /**
   * 1 while the player is in committed fast-fall mode.
   * Set when the player holds down while falling; cleared by landing, jumping,
   * attaching a grapple, or holding jump long enough to brake back to normalFallCap.
   * While active, the terminal fall speed is fastFallCap instead of normalFallCap.
   */
  isFastFallModeFlag: 0 | 1;

  // ---- Airborne tracking --------------------------------------------------
  /**
   * Number of consecutive ticks the player has been airborne (not grounded).
   * Reset to 0 each tick the player is grounded; incremented while airborne.
   * Used by the wall-jump intent filter to distinguish quick post-ground clips
   * from deliberate mid-air wall interactions.
   */
  airborneTicks: number;

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
   * Number of wall jumps used since the last reset point (0 = none yet).
   * Reset points: touching ground or attaching a grapple.
   * Used to apply a three-tier height profile:
   *   0 → first jump (full bonus)
   *   1 → second jump (WALL_JUMP_SECOND_Y_MULTIPLIER × first-jump speed)
   *   2+ → subsequent jumps (WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER × base speed)
   */
  wallJumpCountSinceReset: number;
  /**
   * Grace timer for the left wall.  Set to WALL_JUMP_GRACE_TICKS when the
   * player leaves a left-wall contact; while > 0 a wall jump off the left
   * wall is still allowed (wall coyote time).
   */
  wallJumpGraceLeftTicks: number;
  /**
   * Grace timer for the right wall.  Set to WALL_JUMP_GRACE_TICKS when the
   * player leaves a right-wall contact; while > 0 a wall jump off the right
   * wall is still allowed (wall coyote time).
   */
  wallJumpGraceRightTicks: number;

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

  // ---- Wall Snake / Needle Snake (isWallSnakeFlag or isNeedleSnakeFlag) --------
  /** 1 if this cluster is a Big Wallback Snake — large, slow, wall-climber. */
  isWallSnakeFlag: 0 | 1;
  /** 1 if this cluster is a Needle Snake — thin, fast, wall-climber. */
  isNeedleSnakeFlag: 0 | 1;
  /**
   * Snake AI state:
   *   0 = patrol   — slithering around nearby floor/wall
   *   1 = pursue   — pathfinding toward player
   *   2 = climb    — following a wall-climb segment of the path
   *   3 = repath   — waiting to recompute path
   *   4 = recover  — stuck recovery / unreachable fallback
   */
  snakeAiState: number;
  /** Ticks elapsed in current snake state. */
  snakeAiStateTicks: number;
  /** Countdown to next path recomputation. */
  snakeRepathCooldownTicks: number;
  /** 1 while the snake is attached to a background wall. */
  snakeIsOnWallFlag: 0 | 1;
  /** Current heading direction X (normalized) — the direction the head faces. */
  snakeHeadDirXWorld: number;
  /** Current heading direction Y (normalized). */
  snakeHeadDirYWorld: number;
  /** Phase angle (radians) for sine-wave slither animation. Incremented each tick. */
  snakeSlitherPhaseRad: number;
  /** Spawn X (world units) — patrol center. */
  snakeSpawnXWorld: number;
  /** Spawn Y (world units) — patrol center. */
  snakeSpawnYWorld: number;

  // ---- Radiant Tether boss (populated only when isRadiantTetherFlag === 1) --
  /**
   * 1 if this cluster is the Radiant Tether boss — a floating sphere of light
   * that uses anchored chains of light to move.
   */
  isRadiantTetherFlag: 0 | 1;
  /**
   * Current Radiant Tether state:
   *  0 = inactive (dormant, awaiting player proximity)
   *  1 = active (chains fired, boss moves via chain winching)
   *  2 = reset (retracting chains, brief pause)
   *  3 = dead
   */
  radiantTetherState: number;
  /** Ticks elapsed in the current state. */
  radiantTetherStateTicks: number;
  /** Base angle (radians) for evenly-spaced chain directions. */
  radiantTetherBaseAngleRad: number;
  /** Current number of active chains (determined by health thresholds). */
  radiantTetherChainCount: number;
  /** Boss horizontal velocity (world units/tick). */
  radiantTetherVelXWorld: number;
  /** Boss vertical velocity (world units/tick). */
  radiantTetherVelYWorld: number;

  // ---- Radiant Web boss (populated only when isRadiantWebFlag === 1) --------
  /** 1 if this cluster is the Radiant Web boss — a web-beam attack specialist. */
  isRadiantWebFlag: 0 | 1;
  /**
   * Current Radiant Web state:
   *  0 = inactive
   *  1 = beam_grow
   *  2 = branch_grow
   *  3 = energized
   *  4 = rope_decay
   *  5 = reset
   *  6 = dead
   */
  radiantWebState: number;
  /** Ticks elapsed in the current Radiant Web state. */
  radiantWebStateTicks: number;

  /** 1 if this cluster is the Crimson Wizard boss. */
  isCrimsonWizardFlag: 0 | 1;
  /** Current Crimson Wizard attack state. */
  crimsonWizardState: number;
  /** Ticks elapsed in the current Crimson Wizard state. */
  crimsonWizardStateTicks: number;
  /** Horizontal facing direction, -1 left or 1 right. */
  crimsonWizardFacingX: number;
  /** Boss horizontal velocity (world units/tick). */
  crimsonWizardVelXWorld: number;
  /** Boss vertical velocity (world units/tick). */
  crimsonWizardVelYWorld: number;
  /** Organic hover phase for deterministic movement variation. */
  crimsonWizardHoverPhaseRad: number;
  /** Countdown ticks before the next attack can start. */
  crimsonWizardAttackCooldownTicks: number;
  /** Deterministic selector salt for the next Crimson Wizard attack. */
  crimsonWizardNextAttackIndex: number;
  /** Placeholder telegraph timer for fire pillars. */
  crimsonWizardTelegraphTicks: number;
  /** Last Crimson Wizard attack state chosen by the phase selector. */
  crimsonWizardLastAttackState: number;
  /** Consecutive times the last Crimson Wizard attack state has been chosen. */
  crimsonWizardRepeatCount: number;
  /** Number of scheduled meteors for the current Crimson Wizard meteor attack. */
  crimsonWizardMeteorCount: number;
  /** Scheduled meteor landing X values. */
  crimsonWizardMeteorTargetXWorld: Float32Array;
  /** Scheduled meteor landing Y values. */
  crimsonWizardMeteorTargetYWorld: Float32Array;
  /** Scheduled meteor spawn X values. */
  crimsonWizardMeteorSpawnXWorld: Float32Array;
  /** Scheduled meteor spawn Y values. */
  crimsonWizardMeteorSpawnYWorld: Float32Array;
  /** State tick at which each scheduled meteor should spawn. */
  crimsonWizardMeteorSpawnTick: Uint16Array;
  /** 1 once the scheduled meteor has spawned. */
  crimsonWizardMeteorSpawnedFlag: Uint8Array;

  /** 1 if this cluster is The Herald — void wizard boss. */
  isHeraldFlag: 0 | 1;
  /** Current Herald state (idle/cast/recover). */
  heraldState: number;
  /** Ticks elapsed in the current Herald state. */
  heraldStateTicks: number;
  /** Horizontal facing direction, -1 left or 1 right. */
  heraldFacingX: number;
  /** Boss horizontal velocity (world units/tick). */
  heraldVelXWorld: number;
  /** Boss vertical velocity (world units/tick). */
  heraldVelYWorld: number;
  /** Organic hover phase for deterministic idle-movement variation. */
  heraldHoverPhaseRad: number;
  /** Countdown ticks before the next Void Sphere cast can start. */
  heraldAttackCooldownTicks: number;
  /** Current selected Void Herald attack package. */
  heraldAttackKind: number;
  /** Deterministic attack cycle counter. */
  heraldNextAttackIndex: number;

  /** 1 if this cluster is the Ice Wizard boss. */
  isIceWizardFlag: 0 | 1;
  /** Current Ice Wizard state: idle/telegraphSlam/slamDown/recovery/summon phases. */
  iceWizardState: number;
  /** Ticks elapsed in the current Ice Wizard state. */
  iceWizardStateTicks: number;
  /** Grid-aligned top-left tile occupied by the 4x4 boss footprint. */
  iceWizardGridX: number;
  iceWizardGridY: number;
  /** Last floor Y used by the slam impact, for debug/tests/future effects. */
  iceWizardImpactFloorYWorld: number;
  /** Bitmask of HP thresholds already queued for this Ice Wizard instance. */
  iceWizardSummonTriggeredMask: number;
  /** Bitmask of HP thresholds waiting to run their summon sequence. */
  iceWizardSummonPendingMask: number;
  /** Threshold index currently being summoned, or -1 when no summon is active. */
  iceWizardCurrentSummonThresholdIndex: number;
  /** 1 once the current summon release has spawned its Ice Bubble enemies. */
  iceWizardSummonReleasedFlag: 0 | 1;

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

  // ---- Momentum combat -------------------------------------------------------
  /**
   * 1 while the player is moving above MOMENTUM_COMBAT_MIN_SPEED in momentum
   * combat mode.  Grants invulnerability to contact damage and enables
   * collision-based enemy damage.
   */
  isHighVelocityAttacking: 0 | 1;
  /**
   * Countdown ticks before this enemy cluster can take another momentum-combat
   * hit from the player.  0 = hittable.  Cleared on enemy death / room reset.
   */
  momentumHitCooldownTicks: number;

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

  // ---- Web Spider (populated only when isWebSpiderFlag === 1) ----------------
  /**
   * 1 if this cluster is a web spider — fires white web lines to terrain,
   * swings toward the player, detaches, and repeats.
   */
  isWebSpiderFlag: 0 | 1;
  /**
   * Current web spider AI state:
   *   0 = seek     — falling/drifting, searching for a wall anchor
   *   1 = swinging — attached to anchor, swinging on rope constraint
   *   2 = cooldown — brief pause after detaching before next web attempt
   */
  webSpiderState: number;
  /** Ticks elapsed in the current web spider state. */
  webSpiderStateTicks: number;
  /** World X of the current web anchor (only valid when webSpiderState === 1). */
  webSpiderAnchorXWorld: number;
  /** World Y of the current web anchor. */
  webSpiderAnchorYWorld: number;
  /** Distance from spider to anchor when it first attached (rope length, world units). */
  webSpiderRopeLengthWorld: number;
  /** Countdown ticks after detaching before spider may fire next web. */
  webSpiderCooldownTicks: number;
  /** Countdown ticks until next anchor search attempt (decremented in SEEK state). */
  webSpiderAnchorSearchTicks: number;

  // ---- Dust Constellation Sentinel (isDustConstellationFlag === 1) ----------
  /**
   * 1 if this cluster is a Dust Constellation Sentinel — a floating enemy
   * made of glowing dust motes that attacks by firing sequential beams.
   */
  isDustConstellationFlag: 0 | 1;
  /** 1 for the large variant (more motes, higher HP). */
  isDustConstellationLargeFlag: 0 | 1;
  /**
   * Current AI state:
   *   0 = idle      — motes drift; waiting for activation
   *   1 = gather    — motes converge to formation
   *   2 = telegraph — frozen pattern; lines glow; no damage
   *   3 = beam_fire — beams fire sequentially
   *   4 = recover   — beams fade; cooldown begins
   */
  dustConstellationState: number;
  /** Ticks elapsed in the current constellation state. */
  dustConstellationStateTicks: number;
  /** Remaining ticks before the next attack may begin. */
  dustConstellationAttackCooldownTicks: number;
  /** WorldState slot index for per-constellation mote arrays (-1 if unallocated). */
  dustConstellationSlotIndex: number;
  /** Index of the constellation pattern selected for the current attack cycle. */
  dustConstellationPatternIndex: number;
  /** Index of the currently-firing beam segment (0 = mote[0]→mote[1], etc.). */
  dustConstellationActiveBeamIndex: number;
  /** X of the spawn point — used as the home/leash origin (world units). */
  dustConstellationSpawnXWorld: number;
  /** Y of the spawn point — used as the home/leash origin (world units). */
  dustConstellationSpawnYWorld: number;
  /** Phase angle for the idle bobbing motion (radians). */
  dustConstellationBobPhaseRad: number;

  // ---- Orbital Dust Core (isOrbitalDustCoreFlag === 1) ----------------------
  /**
   * 1 if this cluster is an Orbital Dust Core — a floating enemy made of
   * orbiting dust mote rings around a vulnerable core.
   */
  isOrbitalDustCoreFlag: 0 | 1;
  /** 1 for the large variant (4 rings, more motes, higher HP). */
  isOrbitalDustCoreLargeFlag: 0 | 1;
  /**
   * Current AI state:
   *   0 = idle     — drifting near spawn; motes orbit slowly
   *   1 = active   — player in range; normal orbit speed + attack cooldown
   *   2 = charge   — Gravity Pulse telegraph; motes tighten inward
   *   3 = pulse    — pulse ring expanding outward
   *   4 = recover  — post-pulse cooldown
   *   5 = dying    — core collapse + burst
   */
  orbitalDustCoreState: number;
  /** Ticks elapsed in the current state. */
  orbitalDustCoreStateTicks: number;
  /** WorldState slot index for per-ODC mote arrays (-1 if unallocated). */
  orbitalDustCoreSlotIndex: number;
  /** X of the spawn point (world units). */
  orbitalDustCoreSpawnXWorld: number;
  /** Y of the spawn point (world units). */
  orbitalDustCoreSpawnYWorld: number;
  /** Phase angle for the idle bob motion (radians). */
  orbitalDustCoreBobPhaseRad: number;
  /** Remaining ticks before the next attack. */
  orbitalDustCoreAttackCooldownTicks: number;
  /**
   * Index of the currently exposed (damageable) ring.
   * 0 = outermost ring; increments as rings are destroyed.
   * When >= ringCount, the core is vulnerable.
   */
  orbitalDustCoreExposedRing: number;
  /** Remaining health of ring 0 (outermost). -1 = ring does not exist. */
  orbitalDustCoreRing0Health: number;
  /** Remaining health of ring 1. -1 = ring does not exist. */
  orbitalDustCoreRing1Health: number;
  /** Remaining health of ring 2. -1 = ring does not exist. */
  orbitalDustCoreRing2Health: number;
  /** Remaining health of ring 3 (innermost). -1 = ring does not exist. */
  orbitalDustCoreRing3Health: number;
  /** Current gravity-pulse expansion radius (world units). 0 when inactive. */
  orbitalDustCorePulseRadius: number;
  /** 1 while the pulse ring is live and can deal damage. */
  orbitalDustCorePulseActiveFlag: 0 | 1;
  /** 1 once the pulse has already hit the player this emission. */
  orbitalDustCorePulseHitPlayerFlag: 0 | 1;
  /** Ticks remaining for the shield-hit flash visual (when core is protected). */
  orbitalDustCoreShieldFlashTicks: number;
  /** Ticks remaining for the core pulse flash on ring collapse. */
  orbitalDustCoreCorePulseTicks: number;

  // ---- Dust Block Mimic (isDustBlockMimicFlag === 1) -------------------------
  /**
   * 1 if this cluster is a Dust Block Mimic — a false block that cracks open
   * into a hostile swarm of living dust.
   */
  isDustBlockMimicFlag: 0 | 1;
  /** 1 for the large (2×2 block) variant. */
  isDustBlockMimicLargeFlag: 0 | 1;
  /**
   * Current AI state:
   *   0 = dormant   — looks like a block; waiting for wake trigger
   *   1 = wake      — shaking, cracking, leaking dust; no damage yet
   *   2 = burst     — fragments flying outward into mote formation
   *   3 = activeIdle — swarm hovers and tracks player; attack cooldown
   *   4 = telegraph — motes compress into wedge; visual warning
   *   5 = attack    — shard rush lunge; damage window
   *   6 = recover   — motes slow and rejoin; return to activeIdle
   *   7 = dying     — cohesion failure, inward collapse, outward burst
   */
  dustBlockMimicState: number;
  /** Ticks elapsed in the current state. */
  dustBlockMimicStateTicks: number;
  /** WorldState slot index for per-mimic mote arrays (-1 if unallocated). */
  dustBlockMimicSlotIndex: number;
  /** X of the spawn point (world units). */
  dustBlockMimicSpawnXWorld: number;
  /** Y of the spawn point (world units). */
  dustBlockMimicSpawnYWorld: number;
  /** Phase angle for the idle bob (radians). */
  dustBlockMimicBobPhaseRad: number;
  /** Remaining ticks before the next attack. */
  dustBlockMimicAttackCooldownTicks: number;
  /** Shard rush lunge direction X (normalised). */
  dustBlockMimicLungeDirXWorld: number;
  /** Shard rush lunge direction Y (normalised). */
  dustBlockMimicLungeDirYWorld: number;
  /** Distance covered so far during a shard rush (world units). */
  dustBlockMimicLungeDistCovered: number;
  /** 1 once the shard rush has hit the player this pass. */
  dustBlockMimicLungeHitPlayerFlag: 0 | 1;
  /** Ticks remaining for the hit-flash visual. */
  dustBlockMimicHitFlashTicks: number;

  // ---- Dust Weaver Architect (isDustWeaverArchitectFlag === 1) ----------------
  /**
   * 1 if this cluster is a Dust Weaver Architect — a hovering dust-core enemy
   * that weaves temporary destructible blocks into the arena.
   */
  isDustWeaverArchitectFlag: 0 | 1;
  /** 1 for the large variant (more motes, higher HP, larger block patterns). */
  isDustWeaverArchitectLargeFlag: 0 | 1;
  /**
   * Current AI state:
   *   0 = idle          — motes orbit, cooldown countdown
   *   1 = telegraph     — motes stretch toward build site, outline flickers
   *   2 = build         — blocks materialise
   *   3 = recover       — motes relax, cooldown begins
   *   4 = dying         — core collapses, owned blocks crumble
   */
  dustWeaverArchitectState: number;
  /** Ticks elapsed in the current state. */
  dustWeaverArchitectStateTicks: number;
  /** WorldState slot index for per-Architect mote arrays (-1 if unallocated). */
  dustWeaverArchitectSlotIndex: number;
  /** X of the spawn point (world units). */
  dustWeaverArchitectSpawnXWorld: number;
  /** Y of the spawn point (world units). */
  dustWeaverArchitectSpawnYWorld: number;
  /** Phase angle for the idle bob animation (radians). */
  dustWeaverArchitectBobPhaseRad: number;
  /** Remaining ticks before the next build cycle starts. */
  dustWeaverArchitectAttackCooldownTicks: number;
  /** X of the chosen build site center (world units). */
  dustWeaverArchitectBuildSiteXWorld: number;
  /** Y of the chosen build site center (world units). */
  dustWeaverArchitectBuildSiteYWorld: number;
  /** Index into DWA_PATTERNS for the chosen build pattern. */
  dustWeaverArchitectBuildPatternIndex: number;
  /** Ticks remaining for the hit-flash visual. */
  dustWeaverArchitectHitFlashTicks: number;
  /**
   * Counts up while the player stays outside DWA_NAIL_MIN_RANGE_WORLD.
   * Resets to 0 when the player comes within range or a nail is fired.
   */
  dustWeaverArchitectRangePressureTicks: number;
  /** Cooldown ticks remaining after firing a Dust Nail (counts down to 0). */
  dustWeaverArchitectNailCooldownTicks: number;

  // ── Void Singularity ────────────────────────────────────────────────────────
  /** 1 if this cluster is a Void Singularity or Void Singularity Pair. */
  isVoidSingularityFlag: 0 | 1;
  /** 1 if this cluster is the Pair variant (black hole + white hole). */
  isVoidSingularityPairFlag: 0 | 1;
  /** Current VS state (use VS_STATE_* constants). */
  voidSingularityState: number;
  /** Ticks elapsed in the current VS state. */
  voidSingularityStateTicks: number;
  /** WorldState slot index for per-VS mote arrays (-1 if unallocated). */
  voidSingularitySlotIndex: number;
  /** X of the spawn point (world units). */
  voidSingularitySpawnXWorld: number;
  /** Y of the spawn point (world units). */
  voidSingularitySpawnYWorld: number;
  /** Phase angle for idle bob animation (radians). */
  voidSingularityBobPhaseRad: number;
  /** Accumulated absorbed energy (charges the collapse pulse). */
  voidSingularityAbsorbedEnergy: number;
  /** Current radius of the expanding collapse-pulse ring (world units). */
  voidSingularityPulseRadius: number;
  /** 1 while the collapse-pulse ring is active and can damage. */
  voidSingularityPulseActiveFlag: 0 | 1;
  /** 1 once the pulse ring has already hit the player this cycle. */
  voidSingularityPulseHitPlayerFlag: 0 | 1;
  /** Ticks remaining for hit-flash visual. */
  voidSingularityHitFlashTicks: number;
  /** Pair: orbit angle of the white hole around the black hole center (radians). */
  voidSingularityPairAngleRad: number;
  /** Pair: accumulated white-hole charge from BH absorption. */
  voidSingularityWholeCharge: number;
  /** Pair: white hole state (use VSP_WH_STATE_* constants). */
  voidSingularityWholeState: number;
  /** Pair: ticks elapsed in the current white hole state. */
  voidSingularityWholeStateTicks: number;

  // ── Grid Block Enemy ────────────────────────────────────────────────────────
  /** 1 if this cluster is a grid-aligned block enemy. */
  isGridBlockEnemyFlag: 0 | 1;
  /** 0 = 1×1 tile, 1 = 2×2 tiles. */
  gridBlockSizeIndex: number;
  /** 0 = slow (20 ticks/step), 1 = medium (12), 2 = fast (7). */
  gridBlockSpeedIndex: number;
  /** Committed grid column (top-left for 2×2). */
  gridBlockGridX: number;
  /** Committed grid row (top-left for 2×2). */
  gridBlockGridY: number;
  /** Target grid column during the current interpolated step. */
  gridBlockTargetGridX: number;
  /** Target grid row during the current interpolated step. */
  gridBlockTargetGridY: number;
  /** Countdown ticks for the current visual interpolation step (0 = idle). */
  gridBlockMoveTicks: number;
  /** Ticks until next BFS repath. */
  gridBlockRepathCooldownTicks: number;
  /** Cached BFS first-step direction X (-1, 0, or 1). */
  gridBlockNextDirX: number;
  /** Cached BFS first-step direction Y (-1, 0, or 1). */
  gridBlockNextDirY: number;
  /** Phase (radians) driving the animated glint sweep. */
  gridBlockGlintPhase: number;
  /** Ticks remaining for the hit-flash visual. */
  gridBlockHitFlashTicks: number;
  /** Health recorded at end of previous tick — used to detect incoming damage. */
  gridBlockPrevHealthPoints: number;
  gridBlockAiState: number;
  gridBlockChargeDirX: number;
  gridBlockChargeDirY: number;
  gridBlockChargeSpeedWorld: number;
  gridBlockRecoverTicks: number;
  isGridSnakeEnemyFlag: 0 | 1;
  gridSnakeLength: number;
  gridSnakeGridX: number;
  gridSnakeGridY: number;
  gridSnakeTargetGridX: number;
  gridSnakeTargetGridY: number;
  gridSnakeMoveTicks: number;
  gridSnakeRepathCooldownTicks: number;
  gridSnakeNextDirX: number;
  gridSnakeNextDirY: number;
  gridSnakeSegmentGridX: number[];
  gridSnakeSegmentGridY: number[];
  gridSnakePhase: number;
  gridSnakePrevHealthPoints: number;

  // ── Dust Leech ──────────────────────────────────────────────────────────────
  /** 1 if this cluster is a Dust Leech. */
  isDustLeechFlag: 0 | 1;
  /** Current Leech state (use DL_STATE_* constants). */
  dustLeechState: number;
  /** Ticks elapsed in the current Leech state. */
  dustLeechStateTicks: number;
  /** WorldState slot index for per-Leech mote arrays (-1 if unallocated). */
  dustLeechSlotIndex: number;
  /** X of the spawn point (world units). */
  dustLeechSpawnXWorld: number;
  /** Y of the spawn point (world units). */
  dustLeechSpawnYWorld: number;
  /** Phase angle for idle bob animation (radians). */
  dustLeechBobPhaseRad: number;
  /** Accumulated siphon charge (0..DL_SIPHON_CHARGE_REQUIRED). */
  dustLeechSiphonCharge: number;
  /** Cooldown ticks until next siphon attempt. */
  dustLeechAttackCooldownTicks: number;
  /** Ticks remaining for hit-flash visual. */
  dustLeechHitFlashTicks: number;

  // ── Dust Echo ───────────────────────────────────────────────────────────────
  /** 1 if this cluster is a Dust Echo (runtime-spawned by a Leech). */
  isDustEchoFlag: 0 | 1;
  /** Current Echo state (use DE_STATE_* constants). */
  dustEchoState: number;
  /** Ticks elapsed in the current Echo state. */
  dustEchoStateTicks: number;
  /** Remaining lifetime ticks before auto-decay. */
  dustEchoLifetimeTicks: number;
  /** EntityId of the owning Leech cluster (-1 if no owner). */
  dustEchoOwnerEntityId: number;
  /** WorldState slot index for per-Echo mote arrays (-1 if unallocated). */
  dustEchoSlotIndex: number;
  /** Lunge direction X (world units, normalized). */
  dustEchoLungeDirXWorld: number;
  /** Lunge direction Y (world units, normalized). */
  dustEchoLungeDirYWorld: number;
  /** World-unit distance covered during the current lunge. */
  dustEchoLungeDistCovered: number;
  /** 1 if the player was already hit during the current lunge. */
  dustEchoLungeHitPlayerFlag: 0 | 1;
  /** Cooldown ticks until next lunge attempt. */
  dustEchoLungeCooldownTicks: number;
  /** Ticks remaining for hit-flash visual. */
  dustEchoHitFlashTicks: number;
}

export function createClusterState(
  entityId: number,
  positionXWorld: number,
  positionYWorld: number,
  isPlayerFlag: 0 | 1,
  maxHealthPoints: number,
): ClusterState {
  return {
    challengeMode: null,
    challengeReturnGuard: 0,
    entityId,
    positionXWorld,
    positionYWorld,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isAliveFlag: 1,
    isPlayerFlag,
    countsTowardRoomCompletionFlag: isPlayerFlag === 1 ? 0 : 1,
    healthPoints: maxHealthPoints,
    maxHealthPoints,
    isGroundedFlag: 0,
    isGroundedOnIceFlag: 0,
    isGroundedOnUltraIceFlag: 0,
    isOnUltraIceFlag: 0,
    halfWidthWorld: PLAYER_HALF_WIDTH_WORLD,
    halfHeightWorld: PLAYER_HALF_HEIGHT_WORLD,
    coyoteTimeTicks: 0,
    jumpBufferTicks: 0,
    prevJumpHeldFlag: 0,
    varJumpTimerTicks: 0,
    varJumpSpeedWorld: 0,
    isFastFallModeFlag: 0,
    airborneTicks: 0,
    isTouchingWallLeftFlag: 0,
    isTouchingWallRightFlag: 0,
    isWallSlidingFlag: 0,
    wallJumpLockoutTicks: 0,
    wallJumpForceTimeTicks: 0,
    wallJumpDirX: 0,
    wallJumpCountSinceReset: 0,
    wallJumpGraceLeftTicks: 0,
    wallJumpGraceRightTicks: 0,
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
    isRadiantWebFlag: 0,
    radiantWebState: 0,
    radiantWebStateTicks: 0,
    isCrimsonWizardFlag: 0,
    crimsonWizardState: 0,
    crimsonWizardStateTicks: 0,
    crimsonWizardFacingX: 1,
    crimsonWizardVelXWorld: 0,
    crimsonWizardVelYWorld: 0,
    crimsonWizardHoverPhaseRad: 0,
    crimsonWizardAttackCooldownTicks: 0,
    crimsonWizardNextAttackIndex: 0,
    crimsonWizardTelegraphTicks: 0,
    crimsonWizardLastAttackState: 0,
    crimsonWizardRepeatCount: 0,
    crimsonWizardMeteorCount: 0,
    crimsonWizardMeteorTargetXWorld: new Float32Array(MAX_CW_METEOR_SCHEDULE),
    crimsonWizardMeteorTargetYWorld: new Float32Array(MAX_CW_METEOR_SCHEDULE),
    crimsonWizardMeteorSpawnXWorld: new Float32Array(MAX_CW_METEOR_SCHEDULE),
    crimsonWizardMeteorSpawnYWorld: new Float32Array(MAX_CW_METEOR_SCHEDULE),
    crimsonWizardMeteorSpawnTick: new Uint16Array(MAX_CW_METEOR_SCHEDULE),
    crimsonWizardMeteorSpawnedFlag: new Uint8Array(MAX_CW_METEOR_SCHEDULE),
    isHeraldFlag: 0,
    heraldState: 0,
    heraldStateTicks: 0,
    heraldFacingX: 1,
    heraldVelXWorld: 0,
    heraldVelYWorld: 0,
    heraldHoverPhaseRad: 0,
    heraldAttackCooldownTicks: 0,
    heraldAttackKind: 0,
    heraldNextAttackIndex: 0,
    isIceWizardFlag: 0,
    iceWizardState: 0,
    iceWizardStateTicks: 0,
    iceWizardGridX: 0,
    iceWizardGridY: 0,
    iceWizardImpactFloorYWorld: 0,
    iceWizardSummonTriggeredMask: 0,
    iceWizardSummonPendingMask: 0,
    iceWizardCurrentSummonThresholdIndex: -1,
    iceWizardSummonReleasedFlag: 0,
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
    isWallSnakeFlag: 0,
    isNeedleSnakeFlag: 0,
    snakeAiState: 0,
    snakeAiStateTicks: 0,
    snakeRepathCooldownTicks: 0,
    snakeIsOnWallFlag: 0,
    snakeHeadDirXWorld: 1,
    snakeHeadDirYWorld: 0,
    snakeSlitherPhaseRad: 0,
    snakeSpawnXWorld: positionXWorld,
    snakeSpawnYWorld: positionYWorld,
    isFacingLeftFlag: 0,
    isSprintingFlag: 0,
    isCrouchingFlag: 0,
    playerIdleTimerTicks: 0,
    playerIdleAnimState: 0,
    playerIdleNextSwitchTicks: 0,
    isSkiddingFlag: 0,
    isSlidingFlag: 0,
    isHighVelocityAttacking: 0,
    momentumHitCooldownTicks: 0,
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
    isWebSpiderFlag: 0,
    webSpiderState: 0,
    webSpiderStateTicks: 0,
    webSpiderAnchorXWorld: 0,
    webSpiderAnchorYWorld: 0,
    webSpiderRopeLengthWorld: 0,
    webSpiderCooldownTicks: 0,
    webSpiderAnchorSearchTicks: 0,
    isDustConstellationFlag: 0,
    isDustConstellationLargeFlag: 0,
    dustConstellationState: 0,
    dustConstellationStateTicks: 0,
    dustConstellationAttackCooldownTicks: 0,
    dustConstellationSlotIndex: -1,
    dustConstellationPatternIndex: 0,
    dustConstellationActiveBeamIndex: 0,
    dustConstellationSpawnXWorld: positionXWorld,
    dustConstellationSpawnYWorld: positionYWorld,
    dustConstellationBobPhaseRad: 0,
    isOrbitalDustCoreFlag: 0,
    isOrbitalDustCoreLargeFlag: 0,
    orbitalDustCoreState: 0,
    orbitalDustCoreStateTicks: 0,
    orbitalDustCoreSlotIndex: -1,
    orbitalDustCoreSpawnXWorld: positionXWorld,
    orbitalDustCoreSpawnYWorld: positionYWorld,
    orbitalDustCoreBobPhaseRad: 0,
    orbitalDustCoreAttackCooldownTicks: 0,
    orbitalDustCoreExposedRing: 0,
    orbitalDustCoreRing0Health: -1,
    orbitalDustCoreRing1Health: -1,
    orbitalDustCoreRing2Health: -1,
    orbitalDustCoreRing3Health: -1,
    orbitalDustCorePulseRadius: 0,
    orbitalDustCorePulseActiveFlag: 0,
    orbitalDustCorePulseHitPlayerFlag: 0,
    orbitalDustCoreShieldFlashTicks: 0,
    orbitalDustCoreCorePulseTicks: 0,
    isDustBlockMimicFlag: 0,
    isDustBlockMimicLargeFlag: 0,
    dustBlockMimicState: 0,
    dustBlockMimicStateTicks: 0,
    dustBlockMimicSlotIndex: -1,
    dustBlockMimicSpawnXWorld: positionXWorld,
    dustBlockMimicSpawnYWorld: positionYWorld,
    dustBlockMimicBobPhaseRad: 0,
    dustBlockMimicAttackCooldownTicks: 0,
    dustBlockMimicLungeDirXWorld: 1,
    dustBlockMimicLungeDirYWorld: 0,
    dustBlockMimicLungeDistCovered: 0,
    dustBlockMimicLungeHitPlayerFlag: 0,
    dustBlockMimicHitFlashTicks: 0,
    isDustWeaverArchitectFlag: 0,
    isDustWeaverArchitectLargeFlag: 0,
    dustWeaverArchitectState: 0,
    dustWeaverArchitectStateTicks: 0,
    dustWeaverArchitectSlotIndex: -1,
    dustWeaverArchitectSpawnXWorld: positionXWorld,
    dustWeaverArchitectSpawnYWorld: positionYWorld,
    dustWeaverArchitectBobPhaseRad: 0,
    dustWeaverArchitectAttackCooldownTicks: 0,
    dustWeaverArchitectBuildSiteXWorld: 0,
    dustWeaverArchitectBuildSiteYWorld: 0,
    dustWeaverArchitectBuildPatternIndex: 0,
    dustWeaverArchitectHitFlashTicks: 0,
    dustWeaverArchitectRangePressureTicks: 0,
    dustWeaverArchitectNailCooldownTicks: 0,
    isVoidSingularityFlag: 0,
    isVoidSingularityPairFlag: 0,
    voidSingularityState: 0,
    voidSingularityStateTicks: 0,
    voidSingularitySlotIndex: -1,
    voidSingularitySpawnXWorld: positionXWorld,
    voidSingularitySpawnYWorld: positionYWorld,
    voidSingularityBobPhaseRad: 0,
    voidSingularityAbsorbedEnergy: 0,
    voidSingularityPulseRadius: 0,
    voidSingularityPulseActiveFlag: 0,
    voidSingularityPulseHitPlayerFlag: 0,
    voidSingularityHitFlashTicks: 0,
    voidSingularityPairAngleRad: 0,
    voidSingularityWholeCharge: 0,
    voidSingularityWholeState: 0,
    voidSingularityWholeStateTicks: 0,
    isGridBlockEnemyFlag: 0,
    gridBlockSizeIndex: 0,
    gridBlockSpeedIndex: 0,
    gridBlockGridX: 0,
    gridBlockGridY: 0,
    gridBlockTargetGridX: 0,
    gridBlockTargetGridY: 0,
    gridBlockMoveTicks: 0,
    gridBlockRepathCooldownTicks: 0,
    gridBlockNextDirX: 0,
    gridBlockNextDirY: 0,
    gridBlockGlintPhase: 0,
    gridBlockHitFlashTicks: 0,
    gridBlockPrevHealthPoints: 0,
    gridBlockAiState: 0,
    gridBlockChargeDirX: 0,
    gridBlockChargeDirY: 0,
    gridBlockChargeSpeedWorld: 0,
    gridBlockRecoverTicks: 0,
    isGridSnakeEnemyFlag: 0,
    gridSnakeLength: 0,
    gridSnakeGridX: 0,
    gridSnakeGridY: 0,
    gridSnakeTargetGridX: 0,
    gridSnakeTargetGridY: 0,
    gridSnakeMoveTicks: 0,
    gridSnakeRepathCooldownTicks: 0,
    gridSnakeNextDirX: 0,
    gridSnakeNextDirY: 0,
    gridSnakeSegmentGridX: [],
    gridSnakeSegmentGridY: [],
    gridSnakePhase: 0,
    gridSnakePrevHealthPoints: 0,
    isDustLeechFlag: 0,
    dustLeechState: 0,
    dustLeechStateTicks: 0,
    dustLeechSlotIndex: -1,
    dustLeechSpawnXWorld: positionXWorld,
    dustLeechSpawnYWorld: positionYWorld,
    dustLeechBobPhaseRad: 0,
    dustLeechSiphonCharge: 0,
    dustLeechAttackCooldownTicks: 0,
    dustLeechHitFlashTicks: 0,
    isDustEchoFlag: 0,
    dustEchoState: 0,
    dustEchoStateTicks: 0,
    dustEchoLifetimeTicks: 0,
    dustEchoOwnerEntityId: -1,
    dustEchoSlotIndex: -1,
    dustEchoLungeDirXWorld: 1,
    dustEchoLungeDirYWorld: 0,
    dustEchoLungeDistCovered: 0,
    dustEchoLungeHitPlayerFlag: 0,
    dustEchoLungeCooldownTicks: 0,
    dustEchoHitFlashTicks: 0,
  };
}
