/**
 * clusterSnapshotTypes.ts — Read-only snapshot interface for a single cluster entity.
 *
 * Extracted from snapshotTypes.ts so that per-cluster type definitions can be
 * read independently of the full WorldSnapshot.  snapshotTypes.ts re-exports
 * ClusterSnapshot for backward compatibility.
 */

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
  /** Current Radiant Tether state (0-3). */
  readonly radiantTetherState: number;
  /** Ticks elapsed in the current Radiant Tether state. */
  readonly radiantTetherStateTicks: number;
  /** Base angle (radians) for evenly-spaced chain directions. */
  readonly radiantTetherBaseAngleRad: number;
  /** Current number of active chains. */
  readonly radiantTetherChainCount: number;
  /** 1 if this cluster is the Radiant Web boss. */
  readonly isRadiantWebFlag: 0 | 1;
  /** Current Radiant Web state (0-6). */
  readonly radiantWebState: number;
  /** Ticks elapsed in the current Radiant Web state. */
  readonly radiantWebStateTicks: number;
  /** 1 if this cluster is the Crimson Wizard boss. */
  readonly isCrimsonWizardFlag: 0 | 1;
  readonly crimsonWizardState: number;
  readonly crimsonWizardStateTicks: number;
  readonly crimsonWizardFacingX: number;
  readonly crimsonWizardTelegraphTicks: number;
  /** 1 if this cluster is The Herald boss. */
  readonly isHeraldFlag: 0 | 1;
  readonly heraldState: number;
  readonly heraldStateTicks: number;
  readonly heraldFacingX: number;
  readonly isIceWizardFlag: 0 | 1;
  readonly iceWizardState: number;
  readonly iceWizardStateTicks: number;
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
  /** 1 if this cluster is a Big Wallback Snake. */
  readonly isWallSnakeFlag: 0 | 1;
  /** 1 if this cluster is a Needle Snake. */
  readonly isNeedleSnakeFlag: 0 | 1;
  /** Current snake AI state (0-4). */
  readonly snakeAiState: number;
  /** Ticks elapsed in the current snake AI state. */
  readonly snakeAiStateTicks: number;
  /** 1 while the snake is attached to a background wall. */
  readonly snakeIsOnWallFlag: 0 | 1;
  /** Current head direction X (normalized, world space). */
  readonly snakeHeadDirXWorld: number;
  /** Current head direction Y (normalized, world space). */
  readonly snakeHeadDirYWorld: number;
  /** Current slither phase (radians). */
  readonly snakeSlitherPhaseRad: number;
  /** 1 while the player is in momentum-combat high-velocity attack state. */
  readonly isHighVelocityAttacking: 0 | 1;
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
  /** 1 if this cluster is a slime snail — crawls along surfaces, leaving a slime trail. */
  readonly isSlimeSnailFlag: 0 | 1;
  readonly isShadowEnemyFlag: 0 | 1;
  readonly shadowStartupTicks: number;
  readonly shadowRephaseTicks: number;
  readonly shadowVisualPhaseRad: number;
  readonly isNeedleUrchinFlag: 0 | 1;
  readonly needleUrchinState: number;
  readonly needleUrchinStateTicks: number;
  readonly needleUrchinBurstPhaseRad: number;
  readonly needleUrchinShotFlashTicks: number;
  readonly needleUrchinHitFlashTicks: number;
  /** Starting/current surface side (0=top,1=right,2=bottom,3=left). */
  readonly slimeSnailSurfaceSideIndex: 0 | 1 | 2 | 3;
  /** Current body orientation in radians (follows movement tangent / corner arc). */
  readonly slimeSnailBodyAngleRad: number;
  /** 1=clockwise, 0=counterclockwise traversal. */
  readonly slimeSnailClockwiseFlag: 0 | 1;
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
  /** 1 if this cluster is a web spider — swings via web lines toward the player. */
  readonly isWebSpiderFlag: 0 | 1;
  /** Current web spider AI state (0=seek, 1=swinging, 2=cooldown). */
  readonly webSpiderState: number;
  /** World X of the web anchor (only valid when webSpiderState === 1). */
  readonly webSpiderAnchorXWorld: number;
  /** World Y of the web anchor. */
  readonly webSpiderAnchorYWorld: number;

  // ---- Dust Constellation Sentinel ----------------------------------------
  readonly isDustConstellationFlag: 0 | 1;
  readonly isDustConstellationLargeFlag: 0 | 1;
  readonly dustConstellationState: number;
  readonly dustConstellationStateTicks: number;
  readonly dustConstellationSlotIndex: number;
  readonly dustConstellationPatternIndex: number;
  readonly dustConstellationActiveBeamIndex: number;

  // ---- Orbital Dust Core --------------------------------------------------
  readonly isOrbitalDustCoreFlag: 0 | 1;
  readonly isOrbitalDustCoreLargeFlag: 0 | 1;
  readonly orbitalDustCoreState: number;
  readonly orbitalDustCoreStateTicks: number;
  readonly orbitalDustCoreSlotIndex: number;
  readonly orbitalDustCoreExposedRing: number;
  readonly orbitalDustCoreRing0Health: number;
  readonly orbitalDustCoreRing1Health: number;
  readonly orbitalDustCoreRing2Health: number;
  readonly orbitalDustCoreRing3Health: number;
  readonly orbitalDustCorePulseRadius: number;
  readonly orbitalDustCorePulseActiveFlag: 0 | 1;
  readonly orbitalDustCoreShieldFlashTicks: number;
  readonly orbitalDustCoreCorePulseTicks: number;

  // ---- Dust Block Mimic ----------------------------------------------------
  readonly isDustBlockMimicFlag: 0 | 1;
  readonly isDustBlockMimicLargeFlag: 0 | 1;
  readonly dustBlockMimicState: number;
  readonly dustBlockMimicStateTicks: number;
  readonly dustBlockMimicSlotIndex: number;
  readonly dustBlockMimicSpawnXWorld: number;
  readonly dustBlockMimicSpawnYWorld: number;
  readonly dustBlockMimicBobPhaseRad: number;
  readonly dustBlockMimicAttackCooldownTicks: number;
  readonly dustBlockMimicLungeDirXWorld: number;
  readonly dustBlockMimicLungeDirYWorld: number;
  readonly dustBlockMimicLungeDistCovered: number;
  readonly dustBlockMimicLungeHitPlayerFlag: 0 | 1;
  readonly dustBlockMimicHitFlashTicks: number;

  // ── Dust Weaver Architect ─────────────────────────────────────────────────
  readonly isDustWeaverArchitectFlag: 0 | 1;
  readonly isDustWeaverArchitectLargeFlag: 0 | 1;
  readonly dustWeaverArchitectState: number;
  readonly dustWeaverArchitectStateTicks: number;
  readonly dustWeaverArchitectSlotIndex: number;
  readonly dustWeaverArchitectSpawnXWorld: number;
  readonly dustWeaverArchitectSpawnYWorld: number;
  readonly dustWeaverArchitectBobPhaseRad: number;
  readonly dustWeaverArchitectAttackCooldownTicks: number;
  readonly dustWeaverArchitectBuildSiteXWorld: number;
  readonly dustWeaverArchitectBuildSiteYWorld: number;
  readonly dustWeaverArchitectBuildPatternIndex: number;
  readonly dustWeaverArchitectHitFlashTicks: number;
  readonly dustWeaverArchitectRangePressureTicks: number;
  readonly dustWeaverArchitectNailCooldownTicks: number;

  // ── Void Singularity ────────────────────────────────────────────────────────
  readonly isVoidSingularityFlag: 0 | 1;
  readonly isVoidSingularityPairFlag: 0 | 1;
  readonly voidSingularityState: number;
  readonly voidSingularityStateTicks: number;
  readonly voidSingularitySlotIndex: number;
  readonly voidSingularitySpawnXWorld: number;
  readonly voidSingularitySpawnYWorld: number;
  readonly voidSingularityBobPhaseRad: number;
  readonly voidSingularityAbsorbedEnergy: number;
  readonly voidSingularityPulseRadius: number;
  readonly voidSingularityPulseActiveFlag: 0 | 1;
  readonly voidSingularityPulseHitPlayerFlag: 0 | 1;
  readonly voidSingularityHitFlashTicks: number;
  readonly voidSingularityPairAngleRad: number;
  readonly voidSingularityWholeCharge: number;
  readonly voidSingularityWholeState: number;
  readonly voidSingularityWholeStateTicks: number;

  // ── Grid Block Enemy ─────────────────────────────────────────────────────
  readonly isGridBlockEnemyFlag: 0 | 1;
  readonly isMomentumTurretFlag: 0 | 1;
  readonly momentumTurretFacingIndex: 0 | 1 | 2 | 3;
  readonly momentumTurretTargetRadiusWorld: number;
  readonly momentumTurretHasLineOfSightFlag: 0 | 1;
  readonly momentumTurretFireGraceTicks: number;
  readonly momentumTurretCooldownTicks: number;
  readonly momentumTurretShotFlashTicks: number;
  readonly gridBlockSizeIndex: number;
  readonly gridBlockSpeedIndex: number;
  readonly gridBlockGlintPhase: number;
  readonly gridBlockHitFlashTicks: number;
  readonly isGridSnakeEnemyFlag: 0 | 1;
  readonly gridSnakeLength: number;
  readonly gridSnakeSegmentGridX: readonly number[];
  readonly gridSnakeSegmentGridY: readonly number[];
  readonly gridSnakePhase: number;

  // ── Dust Leech ────────────────────────────────────────────────────────────
  readonly isDustLeechFlag: 0 | 1;
  readonly dustLeechState: number;
  readonly dustLeechStateTicks: number;
  readonly dustLeechSlotIndex: number;
  readonly dustLeechSpawnXWorld: number;
  readonly dustLeechSpawnYWorld: number;
  readonly dustLeechBobPhaseRad: number;
  readonly dustLeechSiphonCharge: number;
  readonly dustLeechAttackCooldownTicks: number;
  readonly dustLeechHitFlashTicks: number;

  // ── Dust Echo ─────────────────────────────────────────────────────────────
  readonly isDustEchoFlag: 0 | 1;
  readonly dustEchoState: number;
  readonly dustEchoStateTicks: number;
  readonly dustEchoLifetimeTicks: number;
  readonly dustEchoOwnerEntityId: number;
  readonly dustEchoSlotIndex: number;
  readonly dustEchoLungeDirXWorld: number;
  readonly dustEchoLungeDirYWorld: number;
  readonly dustEchoLungeDistCovered: number;
  readonly dustEchoLungeHitPlayerFlag: 0 | 1;
  readonly dustEchoLungeCooldownTicks: number;
  readonly dustEchoHitFlashTicks: number;

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
