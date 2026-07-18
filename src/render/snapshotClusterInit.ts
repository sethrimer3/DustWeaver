import { ClusterState } from '../sim/clusters/state';
import { INFLUENCE_RADIUS_WORLD } from '../sim/clusters/binding';
import { DASH_COOLDOWN_TICKS } from '../sim/clusters/dashConstants';
import { MT_MAX_RING_RADIUS_WORLD } from '../sim/clusters/momentumTurretConfig';
import type { ClusterSnapshot } from './snapshotTypes';

/**
 * Mutable version of ClusterSnapshot for use only within the snapshot module.
 * Exported so snapshot.ts can reference it in _ReusableBacking without
 * re-deriving the mapped type.
 */
export type _MutableCluster = { -readonly [K in keyof ClusterSnapshot]: ClusterSnapshot[K] };

/** Returns a zeroed-out cluster object ready for pool use. */
export function _makeEmptyCluster(): _MutableCluster {
  return {
    entityId: 0,
    positionXWorld: 0,
    positionYWorld: 0,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isAliveFlag: 0,
    isPlayerFlag: 0,
    healthPoints: 0,
    maxHealthPoints: 1,
    influenceRadiusWorld: 0,
    dashCooldownTicks: 0,
    maxDashCooldownTicks: 1,
    dashRechargeAnimTicks: 0,
    halfWidthWorld: 0,
    halfHeightWorld: 0,
    isFlyingEyeFlag: 0,
    flyingEyeFacingAngleRad: 0,
    flyingEyeElementKind: 0,
    isRollingEnemyFlag: 0,
    rollingEnemySpriteIndex: 0,
    rollingEnemyRollAngleRad: 0,
    isFacingLeftFlag: 0,
    isSprintingFlag: 0,
    isCrouchingFlag: 0,
    isGroundedFlag: 0,
    isWallSlidingFlag: 0,
    playerIdleAnimState: 0,
    isRockElementalFlag: 0,
    rockElementalState: 0,
    rockElementalActivationProgress: 0,
    rockElementalOrbitAngleRad: 0,
    rockElementalDustCount: 0,
    isRadiantTetherFlag: 0,
    radiantTetherState: 0,
    radiantTetherStateTicks: 0,
    radiantTetherBaseAngleRad: 0,
    radiantTetherChainCount: 0,
    isRadiantWebFlag: 0,
    radiantWebState: 0,
    radiantWebStateTicks: 0,
    isCrimsonWizardFlag: 0,
    crimsonWizardState: 0,
    crimsonWizardStateTicks: 0,
    crimsonWizardFacingX: 1,
    crimsonWizardTelegraphTicks: 0,
    isHeraldFlag: 0,
    heraldState: 0,
    heraldStateTicks: 0,
    heraldFacingX: 1,
    isIceWizardFlag: 0,
    iceWizardState: 0,
    iceWizardStateTicks: 0,
    isGrappleHunterFlag: 0,
    grappleHunterState: 0,
    grappleHunterChainStartIndex: -1,
    grappleHunterTipXWorld: 0,
    grappleHunterTipYWorld: 0,
    isWallSnakeFlag: 0,
    isNeedleSnakeFlag: 0,
    snakeAiState: 0,
    snakeAiStateTicks: 0,
    snakeIsOnWallFlag: 0,
    snakeHeadDirXWorld: 1,
    snakeHeadDirYWorld: 0,
    snakeSlitherPhaseRad: 0,
    isHighVelocityAttacking: 0,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
    isSlimeFlag: 0,
    isLargeSlimeFlag: 0,
    largeSlimeDustOrbitAngleRad: 0,
    isWheelEnemyFlag: 0,
    wheelRollAngleRad: 0,
    isBeetleFlag: 0,
    beetleAiState: 0,
    beetleSurfaceNormalXWorld: 0,
    beetleSurfaceNormalYWorld: 0,
    beetleIsFlightModeFlag: 0,
    isBubbleEnemyFlag: 0,
    isIceBubbleFlag: 0,
    bubbleState: 0,
    bubbleOrbitAngleRad: 0,
    isSquareStampedeFlag: 0,
    squareStampedeSlotIndex: -1,
    squareStampedeBaseHalfSizeWorld: 0,
    isSlimeSnailFlag: 0,
    slimeSnailSurfaceSideIndex: 0,
    slimeSnailBodyAngleRad: 0,
    slimeSnailClockwiseFlag: 1,
    isGoldenMimicFlag: 0,
    isGoldenMimicYFlippedFlag: 0,
    goldenMimicState: 0,
    goldenMimicFadeAlpha: 1.0,
    isBeeSwarmFlag: 0,
    beeSwarmSlotIndex: -1,
    beeSwarmState: 0,
    beeSwarmOrbitAngleRad: 0,
    isWebSpiderFlag: 0,
    webSpiderState: 0,
    webSpiderAnchorXWorld: 0,
    webSpiderAnchorYWorld: 0,
    isDustConstellationFlag: 0,
    isDustConstellationLargeFlag: 0,
    dustConstellationState: 0,
    dustConstellationStateTicks: 0,
    dustConstellationSlotIndex: -1,
    dustConstellationPatternIndex: 0,
    dustConstellationActiveBeamIndex: 0,
    isOrbitalDustCoreFlag: 0,
    isOrbitalDustCoreLargeFlag: 0,
    orbitalDustCoreState: 0,
    orbitalDustCoreStateTicks: 0,
    orbitalDustCoreSlotIndex: -1,
    orbitalDustCoreExposedRing: 0,
    orbitalDustCoreRing0Health: -1,
    orbitalDustCoreRing1Health: -1,
    orbitalDustCoreRing2Health: -1,
    orbitalDustCoreRing3Health: -1,
    orbitalDustCorePulseRadius: 0,
    orbitalDustCorePulseActiveFlag: 0,
    orbitalDustCoreShieldFlashTicks: 0,
    orbitalDustCoreCorePulseTicks: 0,
    isDustBlockMimicFlag: 0,
    isDustBlockMimicLargeFlag: 0,
    dustBlockMimicState: 0,
    dustBlockMimicStateTicks: 0,
    dustBlockMimicSlotIndex: -1,
    dustBlockMimicSpawnXWorld: 0,
    dustBlockMimicSpawnYWorld: 0,
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
    dustWeaverArchitectSpawnXWorld: 0,
    dustWeaverArchitectSpawnYWorld: 0,
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
    voidSingularitySpawnXWorld: 0,
    voidSingularitySpawnYWorld: 0,
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
    isMomentumTurretFlag: 0,
    momentumTurretFacingIndex: 0,
    momentumTurretTargetRadiusWorld: MT_MAX_RING_RADIUS_WORLD,
    momentumTurretHasLineOfSightFlag: 0,
    momentumTurretFireGraceTicks: 0,
    momentumTurretCooldownTicks: 0,
    momentumTurretShotFlashTicks: 0,
    gridBlockSizeIndex: 0,
    gridBlockSpeedIndex: 0,
    gridBlockGlintPhase: 0,
    gridBlockHitFlashTicks: 0,
    isGridSnakeEnemyFlag: 0,
    gridSnakeLength: 0,
    gridSnakeSegmentGridX: [],
    gridSnakeSegmentGridY: [],
    gridSnakePhase: 0,
    isDustLeechFlag: 0,
    dustLeechState: 0,
    dustLeechStateTicks: 0,
    dustLeechSlotIndex: -1,
    dustLeechSpawnXWorld: 0,
    dustLeechSpawnYWorld: 0,
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
    renderPositionXWorld: 0,
    renderPositionYWorld: 0,
  };
}

/** Copies all ClusterState fields into a pre-allocated _MutableCluster object. */
export function _fillCluster(dst: _MutableCluster, src: ClusterState): void {
  dst.entityId                        = src.entityId;
  dst.positionXWorld                  = src.positionXWorld;
  dst.positionYWorld                  = src.positionYWorld;
  dst.velocityXWorld                  = src.velocityXWorld;
  dst.velocityYWorld                  = src.velocityYWorld;
  dst.isAliveFlag                     = src.isAliveFlag;
  dst.isPlayerFlag                    = src.isPlayerFlag;
  dst.healthPoints                    = src.healthPoints;
  dst.maxHealthPoints                 = src.maxHealthPoints;
  dst.influenceRadiusWorld            = INFLUENCE_RADIUS_WORLD;
  dst.dashCooldownTicks               = src.dashCooldownTicks;
  dst.maxDashCooldownTicks            = DASH_COOLDOWN_TICKS;
  dst.dashRechargeAnimTicks           = src.dashRechargeAnimTicks;
  dst.halfWidthWorld                  = src.halfWidthWorld;
  dst.halfHeightWorld                 = src.halfHeightWorld;
  dst.isFlyingEyeFlag                 = src.isFlyingEyeFlag;
  dst.flyingEyeFacingAngleRad         = src.flyingEyeFacingAngleRad;
  dst.flyingEyeElementKind            = src.flyingEyeElementKind;
  dst.isRollingEnemyFlag              = src.isRollingEnemyFlag;
  dst.rollingEnemySpriteIndex         = src.rollingEnemySpriteIndex;
  dst.rollingEnemyRollAngleRad        = src.rollingEnemyRollAngleRad;
  dst.isFacingLeftFlag                = src.isFacingLeftFlag;
  dst.isSprintingFlag                 = src.isSprintingFlag;
  dst.isCrouchingFlag                 = src.isCrouchingFlag;
  dst.isGroundedFlag                  = src.isGroundedFlag;
  dst.isWallSlidingFlag               = src.isWallSlidingFlag;
  dst.playerIdleAnimState             = src.playerIdleAnimState;
  dst.isRockElementalFlag             = src.isRockElementalFlag;
  dst.rockElementalState              = src.rockElementalState;
  dst.rockElementalActivationProgress = src.rockElementalActivationProgress;
  dst.rockElementalOrbitAngleRad      = src.rockElementalOrbitAngleRad;
  dst.rockElementalDustCount          = src.rockElementalDustCount;
  dst.isRadiantTetherFlag             = src.isRadiantTetherFlag;
  dst.radiantTetherState              = src.radiantTetherState;
  dst.radiantTetherStateTicks         = src.radiantTetherStateTicks;
  dst.radiantTetherBaseAngleRad       = src.radiantTetherBaseAngleRad;
  dst.radiantTetherChainCount         = src.radiantTetherChainCount;
  dst.isRadiantWebFlag                = src.isRadiantWebFlag;
  dst.radiantWebState                 = src.radiantWebState;
  dst.radiantWebStateTicks            = src.radiantWebStateTicks;
  dst.isCrimsonWizardFlag             = src.isCrimsonWizardFlag;
  dst.crimsonWizardState              = src.crimsonWizardState;
  dst.crimsonWizardStateTicks         = src.crimsonWizardStateTicks;
  dst.crimsonWizardFacingX            = src.crimsonWizardFacingX;
  dst.crimsonWizardTelegraphTicks     = src.crimsonWizardTelegraphTicks;
  dst.isHeraldFlag                    = src.isHeraldFlag;
  dst.heraldState                     = src.heraldState;
  dst.heraldStateTicks                = src.heraldStateTicks;
  dst.heraldFacingX                   = src.heraldFacingX;
  dst.isIceWizardFlag                 = src.isIceWizardFlag;
  dst.iceWizardState                  = src.iceWizardState;
  dst.iceWizardStateTicks             = src.iceWizardStateTicks;
  dst.isGrappleHunterFlag             = src.isGrappleHunterFlag;
  dst.grappleHunterState              = src.grappleHunterState;
  dst.grappleHunterChainStartIndex    = src.grappleHunterChainStartIndex;
  dst.grappleHunterTipXWorld          = src.grappleHunterTipXWorld;
  dst.grappleHunterTipYWorld          = src.grappleHunterTipYWorld;
  dst.isWallSnakeFlag                 = src.isWallSnakeFlag;
  dst.isNeedleSnakeFlag               = src.isNeedleSnakeFlag;
  dst.snakeAiState                    = src.snakeAiState;
  dst.snakeAiStateTicks               = src.snakeAiStateTicks;
  dst.snakeIsOnWallFlag               = src.snakeIsOnWallFlag;
  dst.snakeHeadDirXWorld              = src.snakeHeadDirXWorld;
  dst.snakeHeadDirYWorld              = src.snakeHeadDirYWorld;
  dst.snakeSlitherPhaseRad            = src.snakeSlitherPhaseRad;
  dst.isHighVelocityAttacking         = src.isHighVelocityAttacking;
  dst.invulnerabilityTicks            = src.invulnerabilityTicks;
  dst.hurtTicks                       = src.hurtTicks;
  dst.isSlimeFlag                     = src.isSlimeFlag;
  dst.isLargeSlimeFlag                = src.isLargeSlimeFlag;
  dst.largeSlimeDustOrbitAngleRad     = src.largeSlimeDustOrbitAngleRad;
  dst.isWheelEnemyFlag                = src.isWheelEnemyFlag;
  dst.wheelRollAngleRad               = src.wheelRollAngleRad;
  dst.isBeetleFlag                    = src.isBeetleFlag;
  dst.beetleAiState                   = src.beetleAiState;
  dst.beetleSurfaceNormalXWorld       = src.beetleSurfaceNormalXWorld;
  dst.beetleSurfaceNormalYWorld       = src.beetleSurfaceNormalYWorld;
  dst.beetleIsFlightModeFlag          = src.beetleIsFlightModeFlag;
  dst.isBubbleEnemyFlag               = src.isBubbleEnemyFlag;
  dst.isIceBubbleFlag                 = src.isIceBubbleFlag;
  dst.bubbleState                     = src.bubbleState;
  dst.bubbleOrbitAngleRad             = src.bubbleOrbitAngleRad;
  dst.isSquareStampedeFlag            = src.isSquareStampedeFlag;
  dst.squareStampedeSlotIndex         = src.squareStampedeSlotIndex;
  dst.squareStampedeBaseHalfSizeWorld = src.squareStampedeBaseHalfSizeWorld;
  dst.isSlimeSnailFlag                = src.isSlimeSnailFlag;
  dst.slimeSnailSurfaceSideIndex      = src.slimeSnailSurfaceSideIndex;
  dst.slimeSnailBodyAngleRad          = src.slimeSnailBodyAngleRad;
  dst.slimeSnailClockwiseFlag         = src.slimeSnailClockwiseFlag;
  dst.isGoldenMimicFlag               = src.isGoldenMimicFlag;
  dst.isGoldenMimicYFlippedFlag       = src.isGoldenMimicYFlippedFlag;
  dst.goldenMimicState                = src.goldenMimicState;
  dst.goldenMimicFadeAlpha            = src.goldenMimicFadeAlpha;
  dst.isBeeSwarmFlag                  = src.isBeeSwarmFlag;
  dst.beeSwarmSlotIndex               = src.beeSwarmSlotIndex;
  dst.beeSwarmState                   = src.beeSwarmState;
  dst.beeSwarmOrbitAngleRad           = src.beeSwarmOrbitAngleRad;
  dst.isWebSpiderFlag                 = src.isWebSpiderFlag;
  dst.webSpiderState                  = src.webSpiderState;
  dst.webSpiderAnchorXWorld           = src.webSpiderAnchorXWorld;
  dst.webSpiderAnchorYWorld           = src.webSpiderAnchorYWorld;
  dst.isDustConstellationFlag         = src.isDustConstellationFlag;
  dst.isDustConstellationLargeFlag    = src.isDustConstellationLargeFlag;
  dst.dustConstellationState          = src.dustConstellationState;
  dst.dustConstellationStateTicks     = src.dustConstellationStateTicks;
  dst.dustConstellationSlotIndex      = src.dustConstellationSlotIndex;
  dst.dustConstellationPatternIndex   = src.dustConstellationPatternIndex;
  dst.dustConstellationActiveBeamIndex = src.dustConstellationActiveBeamIndex;
  dst.isOrbitalDustCoreFlag           = src.isOrbitalDustCoreFlag;
  dst.isOrbitalDustCoreLargeFlag      = src.isOrbitalDustCoreLargeFlag;
  dst.orbitalDustCoreState            = src.orbitalDustCoreState;
  dst.orbitalDustCoreStateTicks       = src.orbitalDustCoreStateTicks;
  dst.orbitalDustCoreSlotIndex        = src.orbitalDustCoreSlotIndex;
  dst.orbitalDustCoreExposedRing      = src.orbitalDustCoreExposedRing;
  dst.orbitalDustCoreRing0Health      = src.orbitalDustCoreRing0Health;
  dst.orbitalDustCoreRing1Health      = src.orbitalDustCoreRing1Health;
  dst.orbitalDustCoreRing2Health      = src.orbitalDustCoreRing2Health;
  dst.orbitalDustCoreRing3Health      = src.orbitalDustCoreRing3Health;
  dst.orbitalDustCorePulseRadius      = src.orbitalDustCorePulseRadius;
  dst.orbitalDustCorePulseActiveFlag  = src.orbitalDustCorePulseActiveFlag;
  dst.orbitalDustCoreShieldFlashTicks = src.orbitalDustCoreShieldFlashTicks;
  dst.orbitalDustCoreCorePulseTicks   = src.orbitalDustCoreCorePulseTicks;
  dst.isDustBlockMimicFlag            = src.isDustBlockMimicFlag;
  dst.isDustBlockMimicLargeFlag       = src.isDustBlockMimicLargeFlag;
  dst.dustBlockMimicState             = src.dustBlockMimicState;
  dst.dustBlockMimicStateTicks        = src.dustBlockMimicStateTicks;
  dst.dustBlockMimicSlotIndex         = src.dustBlockMimicSlotIndex;
  dst.dustBlockMimicSpawnXWorld       = src.dustBlockMimicSpawnXWorld;
  dst.dustBlockMimicSpawnYWorld       = src.dustBlockMimicSpawnYWorld;
  dst.dustBlockMimicBobPhaseRad       = src.dustBlockMimicBobPhaseRad;
  dst.dustBlockMimicAttackCooldownTicks = src.dustBlockMimicAttackCooldownTicks;
  dst.dustBlockMimicLungeDirXWorld    = src.dustBlockMimicLungeDirXWorld;
  dst.dustBlockMimicLungeDirYWorld    = src.dustBlockMimicLungeDirYWorld;
  dst.dustBlockMimicLungeDistCovered  = src.dustBlockMimicLungeDistCovered;
  dst.dustBlockMimicLungeHitPlayerFlag = src.dustBlockMimicLungeHitPlayerFlag;
  dst.dustBlockMimicHitFlashTicks     = src.dustBlockMimicHitFlashTicks;
  dst.isDustWeaverArchitectFlag              = src.isDustWeaverArchitectFlag;
  dst.isDustWeaverArchitectLargeFlag         = src.isDustWeaverArchitectLargeFlag;
  dst.dustWeaverArchitectState               = src.dustWeaverArchitectState;
  dst.dustWeaverArchitectStateTicks          = src.dustWeaverArchitectStateTicks;
  dst.dustWeaverArchitectSlotIndex           = src.dustWeaverArchitectSlotIndex;
  dst.dustWeaverArchitectSpawnXWorld         = src.dustWeaverArchitectSpawnXWorld;
  dst.dustWeaverArchitectSpawnYWorld         = src.dustWeaverArchitectSpawnYWorld;
  dst.dustWeaverArchitectBobPhaseRad         = src.dustWeaverArchitectBobPhaseRad;
  dst.dustWeaverArchitectAttackCooldownTicks = src.dustWeaverArchitectAttackCooldownTicks;
  dst.dustWeaverArchitectBuildSiteXWorld     = src.dustWeaverArchitectBuildSiteXWorld;
  dst.dustWeaverArchitectBuildSiteYWorld     = src.dustWeaverArchitectBuildSiteYWorld;
  dst.dustWeaverArchitectBuildPatternIndex   = src.dustWeaverArchitectBuildPatternIndex;
  dst.dustWeaverArchitectHitFlashTicks       = src.dustWeaverArchitectHitFlashTicks;
  dst.dustWeaverArchitectRangePressureTicks  = src.dustWeaverArchitectRangePressureTicks;
  dst.dustWeaverArchitectNailCooldownTicks   = src.dustWeaverArchitectNailCooldownTicks;
  dst.isVoidSingularityFlag                  = src.isVoidSingularityFlag;
  dst.isVoidSingularityPairFlag              = src.isVoidSingularityPairFlag;
  dst.voidSingularityState                   = src.voidSingularityState;
  dst.voidSingularityStateTicks              = src.voidSingularityStateTicks;
  dst.voidSingularitySlotIndex               = src.voidSingularitySlotIndex;
  dst.voidSingularitySpawnXWorld             = src.voidSingularitySpawnXWorld;
  dst.voidSingularitySpawnYWorld             = src.voidSingularitySpawnYWorld;
  dst.voidSingularityBobPhaseRad             = src.voidSingularityBobPhaseRad;
  dst.voidSingularityAbsorbedEnergy          = src.voidSingularityAbsorbedEnergy;
  dst.voidSingularityPulseRadius             = src.voidSingularityPulseRadius;
  dst.voidSingularityPulseActiveFlag         = src.voidSingularityPulseActiveFlag;
  dst.voidSingularityPulseHitPlayerFlag      = src.voidSingularityPulseHitPlayerFlag;
  dst.voidSingularityHitFlashTicks           = src.voidSingularityHitFlashTicks;
  dst.voidSingularityPairAngleRad            = src.voidSingularityPairAngleRad;
  dst.voidSingularityWholeCharge             = src.voidSingularityWholeCharge;
  dst.voidSingularityWholeState              = src.voidSingularityWholeState;
  dst.voidSingularityWholeStateTicks         = src.voidSingularityWholeStateTicks;
  dst.isGridBlockEnemyFlag           = src.isGridBlockEnemyFlag;
  dst.isMomentumTurretFlag = src.isMomentumTurretFlag;
  dst.momentumTurretFacingIndex = src.momentumTurretFacingIndex;
  dst.momentumTurretTargetRadiusWorld = src.momentumTurretTargetRadiusWorld;
  dst.momentumTurretHasLineOfSightFlag = src.momentumTurretHasLineOfSightFlag;
  dst.momentumTurretFireGraceTicks = src.momentumTurretFireGraceTicks;
  dst.momentumTurretCooldownTicks = src.momentumTurretCooldownTicks;
  dst.momentumTurretShotFlashTicks = src.momentumTurretShotFlashTicks;
  dst.gridBlockSizeIndex             = src.gridBlockSizeIndex;
  dst.gridBlockSpeedIndex            = src.gridBlockSpeedIndex;
  dst.gridBlockGlintPhase            = src.gridBlockGlintPhase;
  dst.gridBlockHitFlashTicks         = src.gridBlockHitFlashTicks;
  dst.isGridSnakeEnemyFlag           = src.isGridSnakeEnemyFlag;
  dst.gridSnakeLength                = src.gridSnakeLength;
  dst.gridSnakeSegmentGridX          = src.gridSnakeSegmentGridX;
  dst.gridSnakeSegmentGridY          = src.gridSnakeSegmentGridY;
  dst.gridSnakePhase                 = src.gridSnakePhase;
  dst.isDustLeechFlag                = src.isDustLeechFlag;
  dst.dustLeechState                 = src.dustLeechState;
  dst.dustLeechStateTicks            = src.dustLeechStateTicks;
  dst.dustLeechSlotIndex             = src.dustLeechSlotIndex;
  dst.dustLeechSpawnXWorld           = src.dustLeechSpawnXWorld;
  dst.dustLeechSpawnYWorld           = src.dustLeechSpawnYWorld;
  dst.dustLeechBobPhaseRad           = src.dustLeechBobPhaseRad;
  dst.dustLeechSiphonCharge          = src.dustLeechSiphonCharge;
  dst.dustLeechAttackCooldownTicks   = src.dustLeechAttackCooldownTicks;
  dst.dustLeechHitFlashTicks         = src.dustLeechHitFlashTicks;
  dst.isDustEchoFlag                 = src.isDustEchoFlag;
  dst.dustEchoState                  = src.dustEchoState;
  dst.dustEchoStateTicks             = src.dustEchoStateTicks;
  dst.dustEchoLifetimeTicks          = src.dustEchoLifetimeTicks;
  dst.dustEchoOwnerEntityId          = src.dustEchoOwnerEntityId;
  dst.dustEchoSlotIndex              = src.dustEchoSlotIndex;
  dst.dustEchoLungeDirXWorld         = src.dustEchoLungeDirXWorld;
  dst.dustEchoLungeDirYWorld         = src.dustEchoLungeDirYWorld;
  dst.dustEchoLungeDistCovered       = src.dustEchoLungeDistCovered;
  dst.dustEchoLungeHitPlayerFlag     = src.dustEchoLungeHitPlayerFlag;
  dst.dustEchoLungeCooldownTicks     = src.dustEchoLungeCooldownTicks;
  dst.dustEchoHitFlashTicks          = src.dustEchoHitFlashTicks;
  // Render interpolation: initialised to the physics position by default.
  // updateSnapshotInPlace() overwrites these with the blended position when
  // prev-position buffers and an alpha are supplied.
  dst.renderPositionXWorld            = src.positionXWorld;
  dst.renderPositionYWorld            = src.positionYWorld;
}
