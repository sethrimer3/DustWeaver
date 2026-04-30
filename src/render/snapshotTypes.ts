/**
 * snapshotTypes.ts — Public read-only snapshot interfaces for the render layer.
 *
 * These types represent the sim/render boundary: the renderer reads only
 * these readonly views and never modifies WorldState directly.
 *
 * Extracted from snapshot.ts to keep the implementation file focused on
 * the allocation logic (createSnapshot, createReusableSnapshot, etc.).
 */

export interface ParticleSnapshot {
  readonly positionXWorld:    Float32Array;
  readonly positionYWorld:    Float32Array;
  readonly velocityXWorld:    Float32Array;
  readonly velocityYWorld:    Float32Array;
  readonly isAliveFlag:       Uint8Array;
  readonly kindBuffer:        Uint8Array;
  readonly ownerEntityId:     Int32Array;
  /** Current age in ticks — used by renderer to compute normalizedAge. */
  readonly ageTicks:          Float32Array;
  /** Max lifetime in ticks — used with ageTicks for normalizedAge. */
  readonly lifetimeTicks:     Float32Array;
  /**
   * Per-particle disturbance level in [0, 1].
   * Non-zero only for Fluid background particles; drives their alpha.
   */
  readonly disturbanceFactor: Float32Array;
  /**
   * Behavior mode for each particle (matches sim/particles/state.ts).
   * 0 = orbit, 1 = attack (offensive), 2 = shield.
   * Used by the renderer to keep offensive particles at their full 4×4 size.
   */
  readonly behaviorMode:      Uint8Array;
  readonly particleCount:     number;
}

export interface ClusterSnapshot {
  readonly entityId:              number;
  readonly positionXWorld:        number;
  readonly positionYWorld:        number;
  /** Horizontal velocity (world units/sec), used for high-speed VFX. */
  readonly velocityXWorld:        number;
  /** Vertical velocity (world units/sec), used for high-speed VFX. */
  readonly velocityYWorld:        number;
  readonly isAliveFlag:           0 | 1;
  readonly isPlayerFlag:          0 | 1;
  readonly healthPoints:          number;
  readonly maxHealthPoints:       number;
  /** Radius (world units) of this cluster's particle influence ring. */
  readonly influenceRadiusWorld:  number;
  /** Ticks until dash is available again (0 = ready). */
  readonly dashCooldownTicks:     number;
  /** Max dash cooldown ticks (used to compute recharge progress bar). */
  readonly maxDashCooldownTicks:  number;
  /** Counts down after dash recharges — drives the golden ring animation. */
  readonly dashRechargeAnimTicks: number;
  /** Half-width of the cluster box (world units). Used by renderer to draw a box. */
  readonly halfWidthWorld:        number;
  /** Half-height of the cluster box (world units). Used by renderer to draw a box. */
  readonly halfHeightWorld:       number;
  /** 1 if this cluster is a flying eye, rendered as concentric diamond outlines. */
  readonly isFlyingEyeFlag:       0 | 1;
  /** Angle (radians) the eye is currently looking — used to offset inner diamonds. */
  readonly flyingEyeFacingAngleRad: number;
  /** Primary element kind of this flying eye (ParticleKind value). Drives eye colour. */
  readonly flyingEyeElementKind:  number;
  /** 1 if this cluster is a rolling ground enemy, rendered with a rotating sprite. */
  readonly isRollingEnemyFlag:    0 | 1;
  /** Which enemy sprite to render (1–6), corresponding to enemy (N).png. */
  readonly rollingEnemySpriteIndex: number;
  /** Accumulated roll angle (radians) used to rotate the enemy sprite. */
  readonly rollingEnemyRollAngleRad: number;
  /** 1 when the player is facing left (sprites face right by default). */
  readonly isFacingLeftFlag: 0 | 1;
  /** 1 while the player is sprinting. */
  readonly isSprintingFlag: 0 | 1;
  /** 1 while the player is crouching. */
  readonly isCrouchingFlag: 0 | 1;
  /** 1 when the cluster is resting on a surface (floor or platform top). */
  readonly isGroundedFlag: 0 | 1;
  /** 1 while the player is performing a controlled wall slide. */
  readonly isWallSlidingFlag: 0 | 1;
  /**
   * Current idle animation state:
   *  0 = standing, 1 = idle1, 2 = idle2, 3 = idleBlink
   */
  readonly playerIdleAnimState: number;
  /** 1 if this cluster is a rock elemental. */
  readonly isRockElementalFlag: 0 | 1;
  /** Current rock elemental state (0-6). */
  readonly rockElementalState: number;
  /** Activation lerp progress [0,1]. */
  readonly rockElementalActivationProgress: number;
  /** Current orbit angle (radians) for dust positioning. */
  readonly rockElementalOrbitAngleRad: number;
  /** Number of orbiting dust particles. */
  readonly rockElementalDustCount: number;
  /** 1 if this cluster is the Radiant Tether boss. */
  readonly isRadiantTetherFlag: 0 | 1;
  /** Current Radiant Tether state (0-6). */
  readonly radiantTetherState: number;
  /** Ticks elapsed in the current Radiant Tether state. */
  readonly radiantTetherStateTicks: number;
  /** Base angle (radians) for evenly-spaced chain/telegraph directions. */
  readonly radiantTetherBaseAngleRad: number;
  /** Current number of active chains. */
  readonly radiantTetherChainCount: number;
  /** 1 if this cluster is a grapple hunter. */
  readonly isGrappleHunterFlag: 0 | 1;
  /** Current grapple hunter state (0-4). */
  readonly grappleHunterState: number;
  /** Start index for grapple hunter chain particles (-1 if none). */
  readonly grappleHunterChainStartIndex: number;
  /** X of grapple chain tip (world units). */
  readonly grappleHunterTipXWorld: number;
  /** Y of grapple chain tip (world units). */
  readonly grappleHunterTipYWorld: number;
  /**
   * Ticks remaining of invulnerability after taking damage.
   * Non-zero while the player cannot be damaged again.
   */
  readonly invulnerabilityTicks: number;
  /**
   * Ticks remaining in the hurt visual feedback window.
   * Non-zero while the player sprite should show damage tint / flash.
   */
  readonly hurtTicks: number;
  /** 1 if this cluster is a slime enemy. */
  readonly isSlimeFlag: 0 | 1;
  /** 1 if this cluster is a large dust slime enemy. */
  readonly isLargeSlimeFlag: 0 | 1;
  /** Accumulated orbit angle (radians) for large slime dust visual. */
  readonly largeSlimeDustOrbitAngleRad: number;
  /** 1 if this cluster is a wheel enemy. */
  readonly isWheelEnemyFlag: 0 | 1;
  /** Accumulated roll angle (radians) for wheel enemy spoke renderer. */
  readonly wheelRollAngleRad: number;
  /** 1 if this cluster is a golden beetle — crawls on surfaces, flies when agitated. */
  readonly isBeetleFlag: 0 | 1;
  /**
   * Current beetle AI state:
   *  0=crawl_toward, 1=crawl_away, 2=idle, 3=fly_away, 4=fly_toward
   */
  readonly beetleAiState: number;
  /** X component of the surface normal the beetle is attached to (0 when flying). */
  readonly beetleSurfaceNormalXWorld: number;
  /** Y component of the surface normal (−1=floor, +1=ceiling, ±0 with X for walls). */
  readonly beetleSurfaceNormalYWorld: number;
  /** 1 while the beetle is airborne (flying states). */
  readonly beetleIsFlightModeFlag: 0 | 1;
  /** 1 if this cluster is a bubble enemy (water or ice). */
  readonly isBubbleEnemyFlag: 0 | 1;
  /** 1 for the ice variant, 0 for the water variant. */
  readonly isIceBubbleFlag: 0 | 1;
  /** 0 = alive/drifting, 1 = popped. */
  readonly bubbleState: number;
  /** Current orbit rotation angle (radians). */
  readonly bubbleOrbitAngleRad: number;
  /** 1 if this cluster is a square stampede enemy. */
  readonly isSquareStampedeFlag: 0 | 1;
  /**
   * Index into the WorldSnapshot trail ring-buffer arrays.
   * -1 when not assigned.
   */
  readonly squareStampedeSlotIndex: number;
  /** Original full-health half-size (world units) — constant after spawn. */
  readonly squareStampedeBaseHalfSizeWorld: number;
  /** 1 if this cluster is a golden mimic enemy. */
  readonly isGoldenMimicFlag: 0 | 1;
  /** 1 for the XY-flipped variant of the golden mimic. */
  readonly isGoldenMimicYFlippedFlag: 0 | 1;
  /**
   * Current mimic state: 0=active, 1=heap.
   * Used by renderer to select heap vs. active visual mode.
   */
  readonly goldenMimicState: number;
  /**
   * Fade alpha for the heap state, in [1.0, 0.0].
   * Applied as globalAlpha by the renderer during the fade-out.
   */
  readonly goldenMimicFadeAlpha: number;
  /** 1 if this cluster is a bee swarm. */
  readonly isBeeSwarmFlag: 0 | 1;
  /**
   * Index into the WorldSnapshot bee-position arrays (0..MAX_BEE_SWARMS-1).
   * -1 when not assigned.
   */
  readonly beeSwarmSlotIndex: number;
  /**
   * Current bee-swarm AI state: 0=swarming, 1=charging.
   * Used by renderer to tint bees differently when charging.
   */
  readonly beeSwarmState: number;
  /** Global orbit angle (radians) — used by the renderer for swarm animation. */
  readonly beeSwarmOrbitAngleRad: number;
  /**
   * Render-interpolated X position (world units).
   * Linearly blended between the previous tick's position and the current tick's
   * position using the frame's sub-tick alpha, so sprites animate smoothly at
   * any refresh rate instead of snapping discretely each physics tick.
   */
  readonly renderPositionXWorld: number;
  /**
   * Render-interpolated Y position (world units).
   * See `renderPositionXWorld` for details.
   */
  readonly renderPositionYWorld: number;
}

export interface WallSnapshot {
  readonly count:   number;
  readonly xWorld:  Float32Array;
  readonly yWorld:  Float32Array;
  readonly wWorld:  Float32Array;
  readonly hWorld:  Float32Array;
  readonly isPlatformFlag: Uint8Array;
  /** 0=top, 1=bottom, 2=left, 3=right. Only meaningful when isPlatformFlag=1. */
  readonly platformEdge: Uint8Array;
  /** Per-wall theme index: 0=blackRock, 1=brownRock, 2=dirt.  Uses room default when 255. */
  readonly themeIndex: Uint8Array;
  /** 1 if the wall is an invisible collision boundary (not rendered). */
  readonly isInvisibleFlag: Uint8Array;
  /** Ramp orientation: 255=not a ramp, 0=rises right(/), 1=rises left(\), 2=ceiling⌐, 3=ceiling¬. */
  readonly rampOrientationIndex: Uint8Array;
  /** 1 if the wall is a half-width pillar (4 px wide). */
  readonly isPillarHalfWidthFlag: Uint8Array;
}

export interface WorldSnapshot {
  readonly tick:     number;
  readonly particles: ParticleSnapshot;
  readonly clusters:  readonly ClusterSnapshot[];
  readonly walls:     WallSnapshot;
  /** 1 while the player's grapple hook is attached; 0 otherwise. */
  readonly isGrappleActiveFlag:  0 | 1;
  /** 1 while a fired grapple is in-flight/missed and simulating limp chain links. */
  readonly isGrappleMissActiveFlag: 0 | 1;
  /** Start index in particle buffers for grapple chain links (or -1 if unavailable). */
  readonly grappleParticleStartIndex: number;
  /** 1 when the grapple is attached to the top surface of a wall block. */
  readonly isGrappleTopSurfaceFlag: 0 | 1;
  /** 1 when the player has arrived at a top-surface grapple anchor and is sticking. */
  readonly isGrappleStuckFlag: 0 | 1;
  /** World-space X of the grapple anchor point (only valid when isGrappleActiveFlag=1). */
  readonly grappleAnchorXWorld:  number;
  /** World-space Y of the grapple anchor point (only valid when isGrappleActiveFlag=1). */
  readonly grappleAnchorYWorld:  number;
  /** Remaining ticks for grapple attach burst visual effect. */
  readonly grappleAttachFxTicks: number;
  readonly grappleAttachFxXWorld: number;
  readonly grappleAttachFxYWorld: number;
  /** 1 while the player is holding block or a sustained weave — used to drive player sprite rotation speed. */
  readonly isPlayerBlockingFlag: 0 | 1;
  /** 1 when the player has a grapple charge available (grapple hook is equipped). */
  readonly hasGrappleChargeFlag: 0 | 1;
  /** 1 while the player has any sustained Weave active (primary or secondary). */
  readonly isPlayerWeaveActiveFlag: 0 | 1;
  /** Selected character identifier ('knight', 'demonFox', 'princess', or 'outcast'). */
  readonly characterId: string;
  /** Number of active grasshoppers. */
  readonly grasshopperCount: number;
  /** X positions of grasshoppers (world units). */
  readonly grasshopperXWorld: Float32Array;
  /** Y positions of grasshoppers (world units). */
  readonly grasshopperYWorld: Float32Array;
  /** Per-grasshopper alive flags. */
  readonly isGrasshopperAliveFlag: Uint8Array;

  // ── Square Stampede trail ring buffers ────────────────────────────────────
  /** Flattened trail X positions [slot * stride + ringIndex] (world units). */
  readonly squareStampedeTrailXWorld: Float32Array;
  /** Flattened trail Y positions. Same layout as squareStampedeTrailXWorld. */
  readonly squareStampedeTrailYWorld: Float32Array;
  /** Write-head per slot — points to the NEXT slot to be overwritten. */
  readonly squareStampedeTrailHead: Uint8Array;
  /** Number of valid trail entries per slot (0..stride). */
  readonly squareStampedeTrailCount: Uint8Array;
  /** Number of entries per slot (SQUARE_STAMPEDE_TRAIL_COUNT). */
  readonly squareStampedeTrailStride: number;

  // ── Bee-swarm individual bee position buffers ─────────────────────────────
  /**
   * X position of each bee (world units).
   * Layout: [swarmSlot * BEES_PER_SWARM + beeIndex].
   */
  readonly beeSwarmBeeXWorld: Float32Array;
  /** Y position of each bee (world units). Same layout as beeSwarmBeeXWorld. */
  readonly beeSwarmBeeYWorld: Float32Array;
  /** X velocity of each bee (world units/s). Same layout as beeSwarmBeeXWorld. */
  readonly beeSwarmBeeVelXWorld: Float32Array;
  /** Y velocity of each bee (world units/s). Same layout as beeSwarmBeeXWorld. */
  readonly beeSwarmBeeVelYWorld: Float32Array;

  // ── Arrow Weave state ─────────────────────────────────────────────────────
  /** 1 while the player is loading an arrow (holding secondary weave button). */
  readonly isArrowWeaveLoadingFlag: 0 | 1;
  /** Current loaded mote count (0, 2, 3, or 4) for bow visual sizing. */
  readonly arrowWeaveCurrentMoteCount: number;
  /** Current aim direction X (world units, normalized) — for bow placement. */
  readonly playerWeaveAimDirXWorld: number;
  /** Current aim direction Y (world units, normalized) — for bow placement. */
  readonly playerWeaveAimDirYWorld: number;
  /** Number of allocated arrow slots (some may be expired with lifetime ≤ 0). */
  readonly arrowCount: number;
  /** Tip X position of each arrow (world units). Shared view into WorldState. */
  readonly arrowXWorld: Float32Array;
  /** Tip Y position of each arrow (world units). Shared view into WorldState. */
  readonly arrowYWorld: Float32Array;
  /** Normalized X travel direction of each arrow. Shared view into WorldState. */
  readonly arrowDirXWorld: Float32Array;
  /** Normalized Y travel direction of each arrow. Shared view into WorldState. */
  readonly arrowDirYWorld: Float32Array;
  /** Mote count per arrow (2, 3, or 4). Shared view into WorldState. */
  readonly arrowMoteCount: Uint8Array;
  /** 1 when the arrow is stuck in terrain; 0 while in flight. */
  readonly isArrowStuckFlag: Uint8Array;
  /** 1 when the arrow hit an enemy (invisible, playing hit sequence). */
  readonly isArrowHitEnemyFlag: Uint8Array;
  /** Remaining lifetime ticks per arrow (0 = expired). */
  readonly arrowLifetimeTicksLeft: Float32Array;

  // ── Shield Sword Weave state ─────────────────────────────────────────────
  /** ID of the equipped secondary weave (e.g. 'arrow', 'shield_sword'). */
  readonly playerSecondaryWeaveId: string;
  /** Current sword state — see SWORD_STATE_* in sim/weaves/swordWeave.ts. */
  readonly swordWeaveStateEnum: number;
  /** Ticks elapsed in the current sword state. */
  readonly swordWeaveStateTicksElapsed: number;
  /** Current sword angle (radians) in world space. */
  readonly swordWeaveAngleRad: number;
  /** Slash sweep start angle (radians). */
  readonly swordWeaveSlashStartAngleRad: number;
  /** Slash sweep end angle (radians). */
  readonly swordWeaveSlashEndAngleRad: number;
  /** World X of the sword's hand anchor. */
  readonly swordWeaveHandAnchorXWorld: number;
  /** World Y of the sword's hand anchor. */
  readonly swordWeaveHandAnchorYWorld: number;
  /**
   * Current sword length ratio in [0, 1].
   * 1.0 = full blade (all motes available).  0 = no motes — sword cannot form.
   * Used by the renderer to scale the number of blade segments drawn and the
   * reach of the slash trail tip.
   */
  readonly swordWeaveLengthRatio: number;

  // ── Ordered Mote Queue display ────────────────────────────────────────────
  /**
   * Smoothed grapple influence circle radius (world units).
   * Lerps toward the effective grapple range each tick.
   * Used by grappleInfluenceRenderer to scale the influence circle so it
   * visually shrinks and grows as motes are depleted and regenerated.
   */
  readonly moteGrappleDisplayRadiusWorld: number;
}
