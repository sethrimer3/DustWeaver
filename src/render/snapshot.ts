import { WorldState } from '../sim/world';
import type { SecondaryWeaveGesturePhase } from '../input/secondaryWeaveGesture';
import { _MutableCluster, _makeEmptyCluster, _fillCluster } from './snapshotClusterInit';

// Re-export public snapshot interfaces from their dedicated types module so
// that all existing `import { ... } from './snapshot'` callers continue to
// work without modification.
export type { ParticleSnapshot, ClusterSnapshot, WallSnapshot, WorldSnapshot } from './snapshotTypes';
import type { WorldSnapshot } from './snapshotTypes';

// ── Reusable allocation-free snapshot ─────────────────────────────────────

/**
 * Maximum number of cluster slots pre-allocated in a ReusableWorldSnapshot
 * pool.  Rooms should never exceed this; if they do the pool grows lazily.
 */
const MAX_REUSABLE_CLUSTERS = 64;

/**
 * Internal mutable backing accessed only through the snapshot module
 * functions.  External callers see only the readonly WorldSnapshot view.
 */
interface _ReusableBacking {
  tick: number;
  /** Sub-object whose typed-array fields are refreshed on every room transition via refreshSnapshotWorldArrayRefs(). */
  readonly particles: { particleCount: number };
  clusters: _MutableCluster[];
  /** Sub-object whose typed-array fields are refreshed on every room transition via refreshSnapshotWorldArrayRefs(). */
  readonly walls: { count: number };
  isGrappleActiveFlag: 0 | 1;
  isGrappleMissActiveFlag: 0 | 1;
  grappleParticleStartIndex: number;
  isGrappleZipActiveFlag: 0 | 1;
  isGrappleStuckFlag: 0 | 1;
  grappleAnchorXWorld: number;
  grappleAnchorYWorld: number;
  /** Outward surface normal at the anchor — 0,0 when not on a wall surface. */
  grappleAnchorNormalXWorld: number;
  grappleAnchorNormalYWorld: number;
  // Debug grapple collision visualization fields
  grappleDebugSweepFromXWorld: number;
  grappleDebugSweepFromYWorld: number;
  grappleDebugSweepToXWorld:   number;
  grappleDebugSweepToYWorld:   number;
  grappleDebugRawHitXWorld:    number;
  grappleDebugRawHitYWorld:    number;
  isGrappleDebugActiveFlag:    0 | 1;
  grappleAttachFxTicks: number;
  grappleAttachFxXWorld: number;
  grappleAttachFxYWorld: number;
  grappleProximityBounceTicksLeft: number;
  grappleProximityBounceRotationAngleRad: number;
  grappleFailBeamTicksLeft: number;
  grappleFailBeamTotalTicks: number;
  grappleFailBeamStartXWorld: number;
  grappleFailBeamStartYWorld: number;
  grappleFailBeamEndXWorld: number;
  grappleFailBeamEndYWorld: number;
  grappleIceBounceTicksLeft: number;
  grappleIceBounceTicksTotal: number;
  grappleIceBounceStartXWorld: number;
  grappleIceBounceStartYWorld: number;
  grappleIceBounceEndXWorld: number;
  grappleIceBounceEndYWorld: number;
  grappleEmptyFxTicksLeft: number;
  grappleEmptyFxTotalTicks: number;
  grappleEmptyFxXWorld: number;
  grappleEmptyFxYWorld: number;
  zipImpactFxTicksLeft: number;
  zipImpactFxTotalTicks: number;
  zipImpactFxXWorld: number;
  zipImpactFxYWorld: number;
  zipImpactFxScale: number;
  zipImpactFxNormalXWorld: number;
  zipImpactFxNormalYWorld: number;
  isZipJumpWindowOpenFlag: 0 | 1;
  isPlayerBlockingFlag: 0 | 1;
  hasGrappleChargeFlag: 0 | 1;
  /** Ticks remaining for the golden recharge-ring VFX (> 0 = ring active). */
  grappleRechargeRingTicksLeft: number;
  /** Total duration of the recharge-ring VFX in ticks. */
  grappleRechargeRingTotalTicks: number;
  isPlayerWeaveActiveFlag: 0 | 1;
  selectedDustKind: number;
  hasBowWeaveUnlockedFlag: 0 | 1;
  secondaryWeaveGesturePhase: SecondaryWeaveGesturePhase;
  secondaryWeaveGestureHoldAimXWorld: number;
  secondaryWeaveGestureHoldAimYWorld: number;
  bowArrowPhase: number;
  bowArrowDirXWorld: number;
  bowArrowDirYWorld: number;
  hasSwordWeaveUnlockedFlag: 0 | 1;
  newSwordActiveFlag: number;
  newSwordToShieldTransition01: number;
  newSwordReachWorld: number;
  newSwordHandAnchorXWorld: number;
  newSwordHandAnchorYWorld: number;
  newSwordCurrentAngleRad: number;
  characterId: string;
  grasshopperCount: number;
  squareStampedeTrailXWorld: Float32Array;
  squareStampedeTrailYWorld: Float32Array;
  squareStampedeTrailHead: Uint8Array;
  squareStampedeTrailCount: Uint8Array;
  squareStampedeTrailStride: number;
  slimeSnailTrailCol: Int16Array;
  slimeSnailTrailRow: Int16Array;
  slimeSnailTrailSideIndex: Uint8Array;
  slimeSnailTrailRemainingTicks: Uint16Array;
  slimeSnailTrailVisualSeed: Uint32Array;
  slimeSnailTrailHead: Uint8Array;
  slimeSnailTrailCount: Uint8Array;
  slimeSnailTrailStride: number;
  needleProjectileXWorld:Float32Array;needleProjectileYWorld:Float32Array;needleProjectileVelXWorld:Float32Array;needleProjectileVelYWorld:Float32Array;needleProjectileAliveFlag:Uint8Array;
  beeSwarmBeeXWorld: Float32Array;
  beeSwarmBeeYWorld: Float32Array;
  beeSwarmBeeVelXWorld: Float32Array;
  beeSwarmBeeVelYWorld: Float32Array;
  constellationMoteXWorld: Float32Array;
  constellationMoteYWorld: Float32Array;
  constellationMoteVelXWorld: Float32Array;
  constellationMoteVelYWorld: Float32Array;
  constellationMoteTargetLocalX: Float32Array;
  constellationMoteTargetLocalY: Float32Array;
  constellationMotePulsePhaseRad: Float32Array;
  odcMoteAngleRad: Float32Array;
  odcMoteRadiusWorld: Float32Array;
  odcMoteAliveFlag: Uint8Array;
  odcMotePulsePhaseRad: Float32Array;
  cwFireDustAliveFlag: Uint8Array;
  cwSmokeAliveFlag: Uint8Array;
  cwProjectileAliveFlag: Uint8Array;
  cwTelegraphAliveFlag: Uint8Array;
  voidSphereAliveFlag: Uint8Array;
  phantasmalSpikeAliveFlag: Uint8Array;
  phantasmalBlockAliveFlag: Uint8Array;
  phantasmalShockwaveAliveFlag: Uint8Array;
  voidLaserAliveFlag: Uint8Array;
  voidLaserDustAliveFlag: Uint8Array;
  iceSpikeAliveFlag: Uint8Array;
  playerWeaveAimDirXWorld: number;
  playerWeaveAimDirYWorld: number;
  grappleDisplayRadiusWorld: number;
  grappleTensionFactor: number;
  isGrappleWrappingEnabled: 0 | 1;
  grappleWrapPointCount: number;
  ropeCount: number;
  webSpiderFadingWebActiveCount: number;
  /** @internal Pre-allocated cluster objects — not part of the public API. */
  readonly _clusterPool: _MutableCluster[];
}

/**
 * Nominal brand used to distinguish ReusableWorldSnapshot from a plain
 * WorldSnapshot so callers cannot accidentally pass an allocating snapshot
 * to the in-place update functions.
 */
declare const _reusableTag: unique symbol;

/**
 * An allocation-free snapshot handle that satisfies WorldSnapshot.
 * Created once via `createReusableSnapshot()`; updated each frame via
 * `updateSnapshotInPlace()`.
 *
 * ⚠ Safety invariant: never store or use this object across frame
 * boundaries.  It is valid only for the duration of the `renderFrame()`
 * call that consumed it — after the next `updateSnapshotInPlace()` all
 * previous field values are overwritten.
 */
export type ReusableWorldSnapshot = WorldSnapshot & { readonly [_reusableTag]: true };

/** @internal Cast to mutable backing — only valid within this module. */
function _asBacking(snap: ReusableWorldSnapshot): _ReusableBacking {
  return snap as unknown as _ReusableBacking;
}

/**
 * Allocates a ReusableWorldSnapshot backed by pre-allocated cluster objects.
 * Call once after `createWorldState()`.  Then call `resetReusableSnapshot()`
 * when the cluster set changes (on `loadRoom()`), and `updateSnapshotInPlace()`
 * every frame before rendering.
 */
export function createReusableSnapshot(world: WorldState): ReusableWorldSnapshot {
  const clusterPool: _MutableCluster[] = [];
  for (let i = 0; i < MAX_REUSABLE_CLUSTERS; i++) {
    clusterPool.push(_makeEmptyCluster());
  }
  const clusters: _MutableCluster[] = [];

  // Build as a plain mutable object that satisfies WorldSnapshot structurally,
  // then brand it as ReusableWorldSnapshot.
  const backing = {
    tick: world.tick,
    particles: {
      positionXWorld:    world.positionXWorld,
      positionYWorld:    world.positionYWorld,
      velocityXWorld:    world.velocityXWorld,
      velocityYWorld:    world.velocityYWorld,
      isAliveFlag:       world.isAliveFlag,
      kindBuffer:        world.kindBuffer,
      ownerEntityId:     world.ownerEntityId,
      ageTicks:          world.ageTicks,
      lifetimeTicks:     world.lifetimeTicks,
      disturbanceFactor: world.disturbanceFactor,
      behaviorMode:      world.behaviorMode,
      noiseTickSeed:     world.noiseTickSeed,
      particleCount:     world.particleCount,
    },
    clusters,
    walls: {
      count:                world.wallCount,
      xWorld:               world.wallXWorld,
      yWorld:               world.wallYWorld,
      wWorld:               world.wallWWorld,
      hWorld:               world.wallHWorld,
      isPlatformFlag:       world.wallIsPlatformFlag,
      platformEdge:         world.wallPlatformEdge,
      themeIndex:           world.wallThemeIndex,
      isInvisibleFlag:      world.wallIsInvisibleFlag,
      rampOrientationIndex: world.wallRampOrientationIndex,
      isPillarHalfWidthFlag: world.wallIsPillarHalfWidthFlag,
      surfaceRimStyleIndex: world.wallSurfaceRimStyleIndex,
      surfaceRimStyleTable: world.wallSurfaceRimStyleTable,
    },
    isGrappleActiveFlag:      world.isGrappleActiveFlag,
    isGrappleMissActiveFlag:  world.isGrappleMissActiveFlag,
    grappleParticleStartIndex: world.grappleParticleStartIndex,
    isGrappleZipActiveFlag:  world.isGrappleZipActiveFlag,
    isGrappleStuckFlag:       world.isGrappleStuckFlag,
    grappleAnchorXWorld:      world.grappleAnchorXWorld,
    grappleAnchorYWorld:      world.grappleAnchorYWorld,
    grappleAnchorNormalXWorld: world.grappleAnchorNormalXWorld,
    grappleAnchorNormalYWorld: world.grappleAnchorNormalYWorld,
    grappleDebugSweepFromXWorld: world.grappleDebugSweepFromXWorld,
    grappleDebugSweepFromYWorld: world.grappleDebugSweepFromYWorld,
    grappleDebugSweepToXWorld:   world.grappleDebugSweepToXWorld,
    grappleDebugSweepToYWorld:   world.grappleDebugSweepToYWorld,
    grappleDebugRawHitXWorld:    world.grappleDebugRawHitXWorld,
    grappleDebugRawHitYWorld:    world.grappleDebugRawHitYWorld,
    isGrappleDebugActiveFlag:    world.isGrappleDebugActiveFlag,
    grappleAttachFxTicks:     world.grappleAttachFxTicks,
    grappleAttachFxXWorld:    world.grappleAttachFxXWorld,
    grappleAttachFxYWorld:    world.grappleAttachFxYWorld,
    grappleProximityBounceTicksLeft:        world.grappleProximityBounceTicksLeft,
    grappleProximityBounceRotationAngleRad: world.grappleProximityBounceRotationAngleRad,
    grappleFailBeamTicksLeft:       world.grappleFailBeamTicksLeft,
    grappleFailBeamTotalTicks:      world.grappleFailBeamTotalTicks,
    grappleFailBeamStartXWorld:     world.grappleFailBeamStartXWorld,
    grappleFailBeamStartYWorld:     world.grappleFailBeamStartYWorld,
    grappleFailBeamEndXWorld:       world.grappleFailBeamEndXWorld,
    grappleFailBeamEndYWorld:       world.grappleFailBeamEndYWorld,
    grappleIceBounceTicksLeft:      world.grappleIceBounceTicksLeft,
    grappleIceBounceTicksTotal:     world.grappleIceBounceTicksTotal,
    grappleIceBounceStartXWorld:    world.grappleIceBounceStartXWorld,
    grappleIceBounceStartYWorld:    world.grappleIceBounceStartYWorld,
    grappleIceBounceEndXWorld:      world.grappleIceBounceEndXWorld,
    grappleIceBounceEndYWorld:      world.grappleIceBounceEndYWorld,
    grappleEmptyFxTicksLeft:        world.grappleEmptyFxTicksLeft,
    grappleEmptyFxTotalTicks:       world.grappleEmptyFxTotalTicks,
    grappleEmptyFxXWorld:           world.grappleEmptyFxXWorld,
    grappleEmptyFxYWorld:           world.grappleEmptyFxYWorld,
    zipImpactFxTicksLeft:           world.zipImpactFxTicksLeft,
    zipImpactFxTotalTicks:          world.zipImpactFxTotalTicks,
    zipImpactFxXWorld:              world.zipImpactFxXWorld,
    zipImpactFxYWorld:              world.zipImpactFxYWorld,
    zipImpactFxScale:               world.zipImpactFxScale,
    zipImpactFxNormalXWorld:        world.zipImpactFxNormalXWorld,
    zipImpactFxNormalYWorld:        world.zipImpactFxNormalYWorld,
    isZipJumpWindowOpenFlag:        world.isZipJumpWindowOpenFlag,
    isPlayerBlockingFlag:     world.isPlayerBlockingFlag,
    hasGrappleChargeFlag:     world.hasGrappleChargeFlag,
    grappleRechargeRingTicksLeft:   world.grappleRechargeRingTicksLeft,
    grappleRechargeRingTotalTicks:  world.grappleRechargeRingTotalTicks,
    isPlayerWeaveActiveFlag:  (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0,
    selectedDustKind: world.selectedDustKind,
    hasBowWeaveUnlockedFlag: world.hasBowWeaveUnlockedFlag,
    secondaryWeaveGesturePhase: world.secondaryWeaveGesture.phase,
    secondaryWeaveGestureHoldAimXWorld: world.secondaryWeaveGesture.holdAimXWorld,
    secondaryWeaveGestureHoldAimYWorld: world.secondaryWeaveGesture.holdAimYWorld,
    bowArrowPhase: world.bowArrowPhase,
    bowArrowDirXWorld: world.bowArrowDirXWorld,
    bowArrowDirYWorld: world.bowArrowDirYWorld,
    hasSwordWeaveUnlockedFlag: world.hasSwordWeaveUnlockedFlag,
    newSwordActiveFlag: world.newSwordActiveFlag,
    newSwordToShieldTransition01: world.newSwordToShieldTransition01,
    newSwordReachWorld: world.newSwordReachWorld,
    newSwordHandAnchorXWorld: world.newSwordHandAnchorXWorld,
    newSwordHandAnchorYWorld: world.newSwordHandAnchorYWorld,
    newSwordCurrentAngleRad: world.newSwordCurrentAngleRad,
    characterId:              world.characterId,
    grasshopperCount:         world.grasshopperCount,
    grasshopperXWorld:        world.grasshopperXWorld,
    grasshopperYWorld:        world.grasshopperYWorld,
    isGrasshopperAliveFlag:   world.isGrasshopperAliveFlag,
    squareStampedeTrailXWorld: world.squareStampedeTrailXWorld,
    squareStampedeTrailYWorld: world.squareStampedeTrailYWorld,
    squareStampedeTrailHead:   world.squareStampedeTrailHead,
    squareStampedeTrailCount:  world.squareStampedeTrailCount,
    squareStampedeTrailStride: world.squareStampedeTrailStride,
    slimeSnailTrailCol:            world.slimeSnailTrailCol,
    slimeSnailTrailRow:            world.slimeSnailTrailRow,
    slimeSnailTrailSideIndex:      world.slimeSnailTrailSideIndex,
    slimeSnailTrailRemainingTicks: world.slimeSnailTrailRemainingTicks,
    slimeSnailTrailVisualSeed:     world.slimeSnailTrailVisualSeed,
    slimeSnailTrailHead:           world.slimeSnailTrailHead,
    slimeSnailTrailCount:          world.slimeSnailTrailCount,
    slimeSnailTrailStride:         world.slimeSnailTrailStride,
    needleProjectileXWorld:world.needleProjectileXWorld,needleProjectileYWorld:world.needleProjectileYWorld,needleProjectileVelXWorld:world.needleProjectileVelXWorld,needleProjectileVelYWorld:world.needleProjectileVelYWorld,needleProjectileAliveFlag:world.needleProjectileAliveFlag,
    beeSwarmBeeXWorld:         world.beeSwarmBeeXWorld,
    beeSwarmBeeYWorld:         world.beeSwarmBeeYWorld,
    beeSwarmBeeVelXWorld:      world.beeSwarmBeeVelXWorld,
    beeSwarmBeeVelYWorld:      world.beeSwarmBeeVelYWorld,
    constellationMoteXWorld:        world.constellationMoteXWorld,
    constellationMoteYWorld:        world.constellationMoteYWorld,
    constellationMoteVelXWorld:     world.constellationMoteVelXWorld,
    constellationMoteVelYWorld:     world.constellationMoteVelYWorld,
    constellationMoteTargetLocalX:  world.constellationMoteTargetLocalX,
    constellationMoteTargetLocalY:  world.constellationMoteTargetLocalY,
    constellationMotePulsePhaseRad: world.constellationMotePulsePhaseRad,
    odcMoteAngleRad:        world.odcMoteAngleRad,
    odcMoteRadiusWorld:     world.odcMoteRadiusWorld,
    odcMoteAliveFlag:       world.odcMoteAliveFlag,
    odcMotePulsePhaseRad:   world.odcMotePulsePhaseRad,
    dbmMoteXWorld:          world.dbmMoteXWorld,
    dbmMoteYWorld:          world.dbmMoteYWorld,
    dbmMoteVelXWorld:       world.dbmMoteVelXWorld,
    dbmMoteVelYWorld:       world.dbmMoteVelYWorld,
    dbmMoteTargetLocalX:    world.dbmMoteTargetLocalX,
    dbmMoteTargetLocalY:    world.dbmMoteTargetLocalY,
    dbmMotePulsePhaseRad:   world.dbmMotePulsePhaseRad,
    dwaMoteAngleRad:             world.dwaMoteAngleRad,
    dwaMotePulsePhaseRad:        world.dwaMotePulsePhaseRad,
    vsMoteAngleRad:              world.vsMoteAngleRad,
    vsMoteRadiusWorld:           world.vsMoteRadiusWorld,
    vsMotePulsePhaseRad:         world.vsMotePulsePhaseRad,
    dlMoteAngleRad:              world.dlMoteAngleRad,
    dlMotePulsePhaseRad:         world.dlMotePulsePhaseRad,
    deMoteOffsetXWorld:          world.deMoteOffsetXWorld,
    deMoteOffsetYWorld:          world.deMoteOffsetYWorld,
    deMotePulsePhaseRad:         world.deMotePulsePhaseRad,
    vspProjXWorld:               world.vspProjXWorld,
    vspProjYWorld:               world.vspProjYWorld,
    vspProjVelXWorld:            world.vspProjVelXWorld,
    vspProjVelYWorld:            world.vspProjVelYWorld,
    vspProjLifetimeTicks:        world.vspProjLifetimeTicks,
    vspProjAliveFlag:            world.vspProjAliveFlag,
    cwFireDustXWorld:            world.cwFireDustXWorld,
    cwFireDustYWorld:            world.cwFireDustYWorld,
    cwFireDustAgeTicks:          world.cwFireDustAgeTicks,
    cwFireDustLifetimeTicks:     world.cwFireDustLifetimeTicks,
    cwFireDustColorIndex:        world.cwFireDustColorIndex,
    cwFireDustAliveFlag:         world.cwFireDustAliveFlag,
    cwSmokeXWorld:               world.cwSmokeXWorld,
    cwSmokeYWorld:               world.cwSmokeYWorld,
    cwSmokeAgeTicks:             world.cwSmokeAgeTicks,
    cwSmokeLifetimeTicks:        world.cwSmokeLifetimeTicks,
    cwSmokeAliveFlag:            world.cwSmokeAliveFlag,
    cwProjectileXWorld:          world.cwProjectileXWorld,
    cwProjectileYWorld:          world.cwProjectileYWorld,
    cwProjectileType:            world.cwProjectileType,
    cwProjectileAliveFlag:       world.cwProjectileAliveFlag,
    cwTelegraphXWorld:           world.cwTelegraphXWorld,
    cwTelegraphYWorld:           world.cwTelegraphYWorld,
    cwTelegraphHalfSizeWorld:    world.cwTelegraphHalfSizeWorld,
    cwTelegraphTicksLeft:        world.cwTelegraphTicksLeft,
    cwTelegraphMaxTicks:         world.cwTelegraphMaxTicks,
    cwTelegraphKind:             world.cwTelegraphKind,
    cwTelegraphAliveFlag:        world.cwTelegraphAliveFlag,
    voidSphereXWorld:            world.voidSphereXWorld,
    voidSphereYWorld:            world.voidSphereYWorld,
    voidSpherePulsePhaseRad:     world.voidSpherePulsePhaseRad,
    voidSphereAliveFlag:         world.voidSphereAliveFlag,
    phantasmalSpikeXWorld:       world.phantasmalSpikeXWorld,
    phantasmalSpikeYWorld:       world.phantasmalSpikeYWorld,
    phantasmalSpikeDirection:    world.phantasmalSpikeDirection,
    phantasmalSpikeAgeTicks:     world.phantasmalSpikeAgeTicks,
    phantasmalSpikeAliveFlag:    world.phantasmalSpikeAliveFlag,
    phantasmalBlockXWorld:       world.phantasmalBlockXWorld,
    phantasmalBlockYWorld:       world.phantasmalBlockYWorld,
    phantasmalBlockAgeTicks:     world.phantasmalBlockAgeTicks,
    phantasmalBlockFlashTicks:   world.phantasmalBlockFlashTicks,
    phantasmalBlockAliveFlag:    world.phantasmalBlockAliveFlag,
    phantasmalShockwaveXWorld:   world.phantasmalShockwaveXWorld,
    phantasmalShockwaveYWorld:   world.phantasmalShockwaveYWorld,
    phantasmalShockwaveAgeTicks: world.phantasmalShockwaveAgeTicks,
    phantasmalShockwaveAliveFlag: world.phantasmalShockwaveAliveFlag,
    voidLaserStartXWorld:        world.voidLaserStartXWorld,
    voidLaserStartYWorld:        world.voidLaserStartYWorld,
    voidLaserEndXWorld:          world.voidLaserEndXWorld,
    voidLaserEndYWorld:          world.voidLaserEndYWorld,
    voidLaserVisibleStartXWorld: world.voidLaserVisibleStartXWorld,
    voidLaserVisibleStartYWorld: world.voidLaserVisibleStartYWorld,
    voidLaserVisibleEndXWorld:   world.voidLaserVisibleEndXWorld,
    voidLaserVisibleEndYWorld:   world.voidLaserVisibleEndYWorld,
    voidLaserAgeTicks:           world.voidLaserAgeTicks,
    voidLaserAliveFlag:          world.voidLaserAliveFlag,
    voidLaserDustXWorld:         world.voidLaserDustXWorld,
    voidLaserDustYWorld:         world.voidLaserDustYWorld,
    voidLaserDustAgeTicks:       world.voidLaserDustAgeTicks,
    voidLaserDustKind:           world.voidLaserDustKind,
    voidLaserDustAliveFlag:      world.voidLaserDustAliveFlag,
    iceSpikeXWorld:              world.iceSpikeXWorld,
    iceSpikeBaseYWorld:          world.iceSpikeBaseYWorld,
    iceSpikeAgeTicks:            world.iceSpikeAgeTicks,
    iceSpikeDelayTicks:          world.iceSpikeDelayTicks,
    iceSpikeAliveFlag:           world.iceSpikeAliveFlag,
    architectBlockCount:         world.architectBlockCount,
    architectBlockXWorld:        world.architectBlockXWorld,
    architectBlockYWorld:        world.architectBlockYWorld,
    architectBlockHealth:        world.architectBlockHealth,
    architectBlockMaxHealth:     world.architectBlockMaxHealth,
    architectBlockLifetimeTicks: world.architectBlockLifetimeTicks,
    architectBlockGraceTicks:    world.architectBlockGraceTicks,
    architectBlockFormTicks:     world.architectBlockFormTicks,
    architectBlockCrumbleTicks:  world.architectBlockCrumbleTicks,
    architectBlockState:         world.architectBlockState,
    isArchitectBlockAliveFlag:   world.isArchitectBlockAliveFlag,
    architectBlockOwnerSlot:     world.architectBlockOwnerSlot,
    // Dust Nail projectiles — shared typed-array views.
    dwaNailXWorld:               world.dwaNailXWorld,
    dwaNailYWorld:               world.dwaNailYWorld,
    dwaNailVelXWorld:            world.dwaNailVelXWorld,
    dwaNailVelYWorld:            world.dwaNailVelYWorld,
    dwaNailLifetimeTicks:        world.dwaNailLifetimeTicks,
    isDwaNailAliveFlag:          world.isDwaNailAliveFlag,
    playerWeaveAimDirXWorld:    world.playerWeaveAimDirXWorld,
    playerWeaveAimDirYWorld:    world.playerWeaveAimDirYWorld,
    // Grapple display
    grappleDisplayRadiusWorld: world.grappleDisplayRadiusWorld,
    grappleTensionFactor:          world.grappleTensionFactor,
    // Phase 2: geometric grapple wrapping (shared typed-array views)
    isGrappleWrappingEnabled:      world.isGrappleWrappingEnabled,
    grappleWrapPointCount:         world.grappleWrapPointCount,
    grappleWrapPointXWorld:        world.grappleWrapPointXWorld,
    grappleWrapPointYWorld:        world.grappleWrapPointYWorld,
    ropeCount:           world.ropeCount,
    ropeSegmentCount:    world.ropeSegmentCount,
    ropeHalfThickWorld:  world.ropeHalfThickWorld,
    ropeSegPosXWorld:    world.ropeSegPosXWorld,
    ropeSegPosYWorld:    world.ropeSegPosYWorld,
    // Web Spider fading web ring buffer — shared typed-array views
    webSpiderFadingWebMaxCount:        world.webSpiderFadingWebMaxCount,
    webSpiderFadingWebActiveCount:     world.webSpiderFadingWebActiveCount,
    webSpiderFadingWebFromXWorld:      world.webSpiderFadingWebFromXWorld,
    webSpiderFadingWebFromYWorld:      world.webSpiderFadingWebFromYWorld,
    webSpiderFadingWebToXWorld:        world.webSpiderFadingWebToXWorld,
    webSpiderFadingWebToYWorld:        world.webSpiderFadingWebToYWorld,
    webSpiderFadingWebRemainingTicks:  world.webSpiderFadingWebRemainingTicks,
    webSpiderFadingWebMaxTicks:        world.webSpiderFadingWebMaxTicks,
    _clusterPool:             clusterPool,
  };

  return backing as unknown as ReusableWorldSnapshot;
}

/**
 * Updates the reusable snapshot in-place from the current world state.
 * No heap allocations — all cluster objects are recycled from the pre-allocated
 * pool.  Call once per frame, immediately before `renderFrame()`.
 *
 * @param renderAlpha - Sub-tick interpolation factor in [0, 1].  0 = fully at
 *   the previous tick's position; 1 = fully at the current tick's position.
 *   Pass 1.0 (or omit) when no interpolation data is available.
 * @param prevPosX - Pre-allocated Float32Array of cluster X positions from the
 *   start of the current frame (before any tick ran).  Must be at least as long
 *   as `world.clusters.length`.  Omit to skip interpolation.
 * @param prevPosY - Matching Y buffer.  Omit to skip interpolation.
 *
 * ⚠ After this returns, the previous snapshot contents are overwritten.
 */
export function updateSnapshotInPlace(
  snap: ReusableWorldSnapshot,
  world: WorldState,
  renderAlpha = 1.0,
  prevPosX?: Float32Array,
  prevPosY?: Float32Array,
): void {
  const b = _asBacking(snap);

  b.tick = world.tick;
  b.particles.particleCount = world.particleCount;
  b.walls.count             = world.wallCount;

  b.isGrappleActiveFlag       = world.isGrappleActiveFlag;
  b.isGrappleMissActiveFlag   = world.isGrappleMissActiveFlag;
  b.grappleParticleStartIndex = world.grappleParticleStartIndex;
  b.isGrappleZipActiveFlag   = world.isGrappleZipActiveFlag;
  b.isGrappleStuckFlag        = world.isGrappleStuckFlag;
  b.grappleAnchorXWorld       = world.grappleAnchorXWorld;
  b.grappleAnchorYWorld       = world.grappleAnchorYWorld;
  b.grappleAnchorNormalXWorld = world.grappleAnchorNormalXWorld;
  b.grappleAnchorNormalYWorld = world.grappleAnchorNormalYWorld;
  b.grappleDebugSweepFromXWorld = world.grappleDebugSweepFromXWorld;
  b.grappleDebugSweepFromYWorld = world.grappleDebugSweepFromYWorld;
  b.grappleDebugSweepToXWorld   = world.grappleDebugSweepToXWorld;
  b.grappleDebugSweepToYWorld   = world.grappleDebugSweepToYWorld;
  b.grappleDebugRawHitXWorld    = world.grappleDebugRawHitXWorld;
  b.grappleDebugRawHitYWorld    = world.grappleDebugRawHitYWorld;
  b.isGrappleDebugActiveFlag    = world.isGrappleDebugActiveFlag;
  b.grappleAttachFxTicks      = world.grappleAttachFxTicks;
  b.grappleAttachFxXWorld     = world.grappleAttachFxXWorld;
  b.grappleAttachFxYWorld     = world.grappleAttachFxYWorld;
  b.grappleProximityBounceTicksLeft        = world.grappleProximityBounceTicksLeft;
  b.grappleProximityBounceRotationAngleRad = world.grappleProximityBounceRotationAngleRad;
  b.grappleFailBeamTicksLeft       = world.grappleFailBeamTicksLeft;
  b.grappleFailBeamTotalTicks      = world.grappleFailBeamTotalTicks;
  b.grappleFailBeamStartXWorld     = world.grappleFailBeamStartXWorld;
  b.grappleFailBeamStartYWorld     = world.grappleFailBeamStartYWorld;
  b.grappleFailBeamEndXWorld       = world.grappleFailBeamEndXWorld;
  b.grappleFailBeamEndYWorld       = world.grappleFailBeamEndYWorld;
  b.grappleIceBounceTicksLeft      = world.grappleIceBounceTicksLeft;
  b.grappleIceBounceTicksTotal     = world.grappleIceBounceTicksTotal;
  b.grappleIceBounceStartXWorld    = world.grappleIceBounceStartXWorld;
  b.grappleIceBounceStartYWorld    = world.grappleIceBounceStartYWorld;
  b.grappleIceBounceEndXWorld      = world.grappleIceBounceEndXWorld;
  b.grappleIceBounceEndYWorld      = world.grappleIceBounceEndYWorld;
  b.grappleEmptyFxTicksLeft        = world.grappleEmptyFxTicksLeft;
  b.grappleEmptyFxTotalTicks       = world.grappleEmptyFxTotalTicks;
  b.grappleEmptyFxXWorld           = world.grappleEmptyFxXWorld;
  b.grappleEmptyFxYWorld           = world.grappleEmptyFxYWorld;
  b.zipImpactFxTicksLeft           = world.zipImpactFxTicksLeft;
  b.zipImpactFxTotalTicks          = world.zipImpactFxTotalTicks;
  b.zipImpactFxXWorld              = world.zipImpactFxXWorld;
  b.zipImpactFxYWorld              = world.zipImpactFxYWorld;
  b.zipImpactFxScale               = world.zipImpactFxScale;
  b.zipImpactFxNormalXWorld        = world.zipImpactFxNormalXWorld;
  b.zipImpactFxNormalYWorld        = world.zipImpactFxNormalYWorld;
  b.isZipJumpWindowOpenFlag        = world.isZipJumpWindowOpenFlag;
  b.isPlayerBlockingFlag      = world.isPlayerBlockingFlag;
  b.hasGrappleChargeFlag      = world.hasGrappleChargeFlag;
  b.grappleRechargeRingTicksLeft  = world.grappleRechargeRingTicksLeft;
  b.grappleRechargeRingTotalTicks = world.grappleRechargeRingTotalTicks;
  b.isPlayerWeaveActiveFlag   = (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0;
  b.selectedDustKind = world.selectedDustKind;
  b.hasBowWeaveUnlockedFlag = world.hasBowWeaveUnlockedFlag;
  b.secondaryWeaveGesturePhase = world.secondaryWeaveGesture.phase;
  b.secondaryWeaveGestureHoldAimXWorld = world.secondaryWeaveGesture.holdAimXWorld;
  b.secondaryWeaveGestureHoldAimYWorld = world.secondaryWeaveGesture.holdAimYWorld;
  b.bowArrowPhase = world.bowArrowPhase;
  b.bowArrowDirXWorld = world.bowArrowDirXWorld;
  b.bowArrowDirYWorld = world.bowArrowDirYWorld;
  b.hasSwordWeaveUnlockedFlag = world.hasSwordWeaveUnlockedFlag;
  b.newSwordActiveFlag = world.newSwordActiveFlag;
  b.newSwordToShieldTransition01 = world.newSwordToShieldTransition01;
  b.newSwordReachWorld = world.newSwordReachWorld;
  b.newSwordHandAnchorXWorld = world.newSwordHandAnchorXWorld;
  b.newSwordHandAnchorYWorld = world.newSwordHandAnchorYWorld;
  b.newSwordCurrentAngleRad = world.newSwordCurrentAngleRad;
  b.grasshopperCount          = world.grasshopperCount;

  b.playerWeaveAimDirXWorld    = world.playerWeaveAimDirXWorld;
  b.playerWeaveAimDirYWorld    = world.playerWeaveAimDirYWorld;

  // Grapple display
  b.grappleDisplayRadiusWorld = world.grappleDisplayRadiusWorld;
  b.grappleTensionFactor          = world.grappleTensionFactor;
  // Phase 2: geometric wrapping (typed-array fields are shared views — no copy needed)
  b.isGrappleWrappingEnabled      = world.isGrappleWrappingEnabled;
  b.grappleWrapPointCount         = world.grappleWrapPointCount;
  b.ropeCount = world.ropeCount;
  b.webSpiderFadingWebActiveCount = world.webSpiderFadingWebActiveCount;

  const clusterCount = world.clusters.length;
  const pool = b._clusterPool;

  // Grow pool lazily if a room loaded more clusters than the initial capacity.
  while (pool.length < clusterCount) {
    pool.push(_makeEmptyCluster());
  }

  b.clusters.length = clusterCount;
  for (let i = 0; i < clusterCount; i++) {
    // Pool slot i is guaranteed to be populated by resetReusableSnapshot() on
    // every room load (which runs before the first renderFrame() call).
    // The lazy pool-growth above also ensures pool[i] always exists here.
    b.clusters[i] = pool[i];
    _fillCluster(b.clusters[i], world.clusters[i]);

    // Overwrite the render positions with the interpolated value when prev
    // buffers are supplied.  _fillCluster() already set them to the current
    // physics position as the no-interpolation fallback.
    if (prevPosX !== undefined && prevPosY !== undefined) {
      const prevPositionXWorld = prevPosX[i];
      const prevPositionYWorld = prevPosY[i];
      const currentPositionXWorld = world.clusters[i].positionXWorld;
      const currentPositionYWorld = world.clusters[i].positionYWorld;
      b.clusters[i].renderPositionXWorld = prevPositionXWorld + (currentPositionXWorld - prevPositionXWorld) * renderAlpha;
      b.clusters[i].renderPositionYWorld = prevPositionYWorld + (currentPositionYWorld - prevPositionYWorld) * renderAlpha;
    }
  }
}

/**
 * Re-points every typed-array field in the reusable snapshot at the new world's
 * buffers.  Must be called after a resident WorldState hot-swap (or any room
 * transition that replaces the active WorldState object) so that render and
 * interpolation code reads from the correct buffers rather than the previous
 * room's memory.
 *
 * `resetReusableSnapshot` calls this automatically, so callers do not need to
 * invoke it directly.
 */
export function refreshSnapshotWorldArrayRefs(
  snap: ReusableWorldSnapshot,
  world: WorldState,
): void {
  // Use a plain Record cast for the sub-objects and for backing fields that are
  // not exposed in _ReusableBacking (typed-array fields only present at runtime).
  const raw = snap as unknown as Record<string, unknown>;

  // ── Particles sub-object ─────────────────────────────────────────────────
  const p = (snap as unknown as { particles: Record<string, unknown> }).particles;
  p.positionXWorld    = world.positionXWorld;
  p.positionYWorld    = world.positionYWorld;
  p.velocityXWorld    = world.velocityXWorld;
  p.velocityYWorld    = world.velocityYWorld;
  p.isAliveFlag       = world.isAliveFlag;
  p.kindBuffer        = world.kindBuffer;
  p.ownerEntityId     = world.ownerEntityId;
  p.ageTicks          = world.ageTicks;
  p.lifetimeTicks     = world.lifetimeTicks;
  p.disturbanceFactor = world.disturbanceFactor;
  p.behaviorMode      = world.behaviorMode;
  p.noiseTickSeed     = world.noiseTickSeed;

  // ── Walls sub-object ─────────────────────────────────────────────────────
  const w = (snap as unknown as { walls: Record<string, unknown> }).walls;
  w.xWorld                = world.wallXWorld;
  w.yWorld                = world.wallYWorld;
  w.wWorld                = world.wallWWorld;
  w.hWorld                = world.wallHWorld;
  w.isPlatformFlag        = world.wallIsPlatformFlag;
  w.platformEdge          = world.wallPlatformEdge;
  w.themeIndex            = world.wallThemeIndex;
  w.isInvisibleFlag       = world.wallIsInvisibleFlag;
  w.rampOrientationIndex  = world.wallRampOrientationIndex;
  w.isPillarHalfWidthFlag = world.wallIsPillarHalfWidthFlag;
  w.surfaceRimStyleIndex  = world.wallSurfaceRimStyleIndex;
  w.surfaceRimStyleTable  = world.wallSurfaceRimStyleTable;

  // ── Top-level typed-array fields ─────────────────────────────────────────
  raw.grasshopperXWorld              = world.grasshopperXWorld;
  raw.grasshopperYWorld              = world.grasshopperYWorld;
  raw.isGrasshopperAliveFlag         = world.isGrasshopperAliveFlag;
  raw.squareStampedeTrailXWorld      = world.squareStampedeTrailXWorld;
  raw.squareStampedeTrailYWorld      = world.squareStampedeTrailYWorld;
  raw.squareStampedeTrailHead        = world.squareStampedeTrailHead;
  raw.squareStampedeTrailCount       = world.squareStampedeTrailCount;
  raw.slimeSnailTrailCol             = world.slimeSnailTrailCol;
  raw.slimeSnailTrailRow             = world.slimeSnailTrailRow;
  raw.slimeSnailTrailSideIndex       = world.slimeSnailTrailSideIndex;
  raw.slimeSnailTrailRemainingTicks  = world.slimeSnailTrailRemainingTicks;
  raw.slimeSnailTrailVisualSeed      = world.slimeSnailTrailVisualSeed;
  raw.slimeSnailTrailHead            = world.slimeSnailTrailHead;
  raw.slimeSnailTrailCount           = world.slimeSnailTrailCount;
  raw.needleProjectileXWorld=world.needleProjectileXWorld;raw.needleProjectileYWorld=world.needleProjectileYWorld;raw.needleProjectileVelXWorld=world.needleProjectileVelXWorld;raw.needleProjectileVelYWorld=world.needleProjectileVelYWorld;raw.needleProjectileAliveFlag=world.needleProjectileAliveFlag;
  raw.beeSwarmBeeXWorld              = world.beeSwarmBeeXWorld;
  raw.beeSwarmBeeYWorld              = world.beeSwarmBeeYWorld;
  raw.beeSwarmBeeVelXWorld           = world.beeSwarmBeeVelXWorld;
  raw.beeSwarmBeeVelYWorld           = world.beeSwarmBeeVelYWorld;
  raw.constellationMoteXWorld        = world.constellationMoteXWorld;
  raw.constellationMoteYWorld        = world.constellationMoteYWorld;
  raw.constellationMoteVelXWorld     = world.constellationMoteVelXWorld;
  raw.constellationMoteVelYWorld     = world.constellationMoteVelYWorld;
  raw.constellationMoteTargetLocalX  = world.constellationMoteTargetLocalX;
  raw.constellationMoteTargetLocalY  = world.constellationMoteTargetLocalY;
  raw.constellationMotePulsePhaseRad = world.constellationMotePulsePhaseRad;
  raw.odcMoteAngleRad                = world.odcMoteAngleRad;
  raw.odcMoteRadiusWorld             = world.odcMoteRadiusWorld;
  raw.odcMoteAliveFlag               = world.odcMoteAliveFlag;
  raw.odcMotePulsePhaseRad           = world.odcMotePulsePhaseRad;
  raw.dbmMoteXWorld                  = world.dbmMoteXWorld;
  raw.dbmMoteYWorld                  = world.dbmMoteYWorld;
  raw.dbmMoteVelXWorld               = world.dbmMoteVelXWorld;
  raw.dbmMoteVelYWorld               = world.dbmMoteVelYWorld;
  raw.dbmMoteTargetLocalX            = world.dbmMoteTargetLocalX;
  raw.dbmMoteTargetLocalY            = world.dbmMoteTargetLocalY;
  raw.dbmMotePulsePhaseRad           = world.dbmMotePulsePhaseRad;
  raw.dwaMoteAngleRad                = world.dwaMoteAngleRad;
  raw.dwaMotePulsePhaseRad           = world.dwaMotePulsePhaseRad;
  raw.vsMoteAngleRad                 = world.vsMoteAngleRad;
  raw.vsMoteRadiusWorld              = world.vsMoteRadiusWorld;
  raw.vsMotePulsePhaseRad            = world.vsMotePulsePhaseRad;
  raw.dlMoteAngleRad                 = world.dlMoteAngleRad;
  raw.dlMotePulsePhaseRad            = world.dlMotePulsePhaseRad;
  raw.deMoteOffsetXWorld             = world.deMoteOffsetXWorld;
  raw.deMoteOffsetYWorld             = world.deMoteOffsetYWorld;
  raw.deMotePulsePhaseRad            = world.deMotePulsePhaseRad;
  raw.vspProjXWorld                  = world.vspProjXWorld;
  raw.vspProjYWorld                  = world.vspProjYWorld;
  raw.vspProjVelXWorld               = world.vspProjVelXWorld;
  raw.vspProjVelYWorld               = world.vspProjVelYWorld;
  raw.vspProjLifetimeTicks           = world.vspProjLifetimeTicks;
  raw.vspProjAliveFlag               = world.vspProjAliveFlag;
  raw.cwFireDustXWorld               = world.cwFireDustXWorld;
  raw.cwFireDustYWorld               = world.cwFireDustYWorld;
  raw.cwFireDustAgeTicks             = world.cwFireDustAgeTicks;
  raw.cwFireDustLifetimeTicks        = world.cwFireDustLifetimeTicks;
  raw.cwFireDustColorIndex           = world.cwFireDustColorIndex;
  raw.cwFireDustAliveFlag            = world.cwFireDustAliveFlag;
  raw.cwSmokeXWorld                  = world.cwSmokeXWorld;
  raw.cwSmokeYWorld                  = world.cwSmokeYWorld;
  raw.cwSmokeAgeTicks                = world.cwSmokeAgeTicks;
  raw.cwSmokeLifetimeTicks           = world.cwSmokeLifetimeTicks;
  raw.cwSmokeAliveFlag               = world.cwSmokeAliveFlag;
  raw.cwProjectileXWorld             = world.cwProjectileXWorld;
  raw.cwProjectileYWorld             = world.cwProjectileYWorld;
  raw.cwProjectileType               = world.cwProjectileType;
  raw.cwProjectileAliveFlag          = world.cwProjectileAliveFlag;
  raw.cwTelegraphXWorld              = world.cwTelegraphXWorld;
  raw.cwTelegraphYWorld              = world.cwTelegraphYWorld;
  raw.cwTelegraphHalfSizeWorld       = world.cwTelegraphHalfSizeWorld;
  raw.cwTelegraphTicksLeft           = world.cwTelegraphTicksLeft;
  raw.cwTelegraphMaxTicks            = world.cwTelegraphMaxTicks;
  raw.cwTelegraphKind                = world.cwTelegraphKind;
  raw.cwTelegraphAliveFlag           = world.cwTelegraphAliveFlag;
  raw.voidSphereXWorld               = world.voidSphereXWorld;
  raw.voidSphereYWorld               = world.voidSphereYWorld;
  raw.voidSpherePulsePhaseRad        = world.voidSpherePulsePhaseRad;
  raw.voidSphereAliveFlag            = world.voidSphereAliveFlag;
  raw.phantasmalSpikeXWorld          = world.phantasmalSpikeXWorld;
  raw.phantasmalSpikeYWorld          = world.phantasmalSpikeYWorld;
  raw.phantasmalSpikeDirection       = world.phantasmalSpikeDirection;
  raw.phantasmalSpikeAgeTicks        = world.phantasmalSpikeAgeTicks;
  raw.phantasmalSpikeAliveFlag       = world.phantasmalSpikeAliveFlag;
  raw.phantasmalBlockXWorld          = world.phantasmalBlockXWorld;
  raw.phantasmalBlockYWorld          = world.phantasmalBlockYWorld;
  raw.phantasmalBlockAgeTicks        = world.phantasmalBlockAgeTicks;
  raw.phantasmalBlockFlashTicks      = world.phantasmalBlockFlashTicks;
  raw.phantasmalBlockAliveFlag       = world.phantasmalBlockAliveFlag;
  raw.phantasmalShockwaveXWorld      = world.phantasmalShockwaveXWorld;
  raw.phantasmalShockwaveYWorld      = world.phantasmalShockwaveYWorld;
  raw.phantasmalShockwaveAgeTicks    = world.phantasmalShockwaveAgeTicks;
  raw.phantasmalShockwaveAliveFlag   = world.phantasmalShockwaveAliveFlag;
  raw.voidLaserStartXWorld           = world.voidLaserStartXWorld;
  raw.voidLaserStartYWorld           = world.voidLaserStartYWorld;
  raw.voidLaserEndXWorld             = world.voidLaserEndXWorld;
  raw.voidLaserEndYWorld             = world.voidLaserEndYWorld;
  raw.voidLaserVisibleStartXWorld    = world.voidLaserVisibleStartXWorld;
  raw.voidLaserVisibleStartYWorld    = world.voidLaserVisibleStartYWorld;
  raw.voidLaserVisibleEndXWorld      = world.voidLaserVisibleEndXWorld;
  raw.voidLaserVisibleEndYWorld      = world.voidLaserVisibleEndYWorld;
  raw.voidLaserAgeTicks              = world.voidLaserAgeTicks;
  raw.voidLaserAliveFlag             = world.voidLaserAliveFlag;
  raw.voidLaserDustXWorld            = world.voidLaserDustXWorld;
  raw.voidLaserDustYWorld            = world.voidLaserDustYWorld;
  raw.voidLaserDustAgeTicks          = world.voidLaserDustAgeTicks;
  raw.voidLaserDustKind              = world.voidLaserDustKind;
  raw.voidLaserDustAliveFlag         = world.voidLaserDustAliveFlag;
  raw.iceSpikeXWorld                 = world.iceSpikeXWorld;
  raw.iceSpikeBaseYWorld             = world.iceSpikeBaseYWorld;
  raw.iceSpikeAgeTicks               = world.iceSpikeAgeTicks;
  raw.iceSpikeDelayTicks             = world.iceSpikeDelayTicks;
  raw.iceSpikeAliveFlag              = world.iceSpikeAliveFlag;
  raw.architectBlockXWorld           = world.architectBlockXWorld;
  raw.architectBlockYWorld           = world.architectBlockYWorld;
  raw.architectBlockHealth           = world.architectBlockHealth;
  raw.architectBlockMaxHealth        = world.architectBlockMaxHealth;
  raw.architectBlockLifetimeTicks    = world.architectBlockLifetimeTicks;
  raw.architectBlockGraceTicks       = world.architectBlockGraceTicks;
  raw.architectBlockFormTicks        = world.architectBlockFormTicks;
  raw.architectBlockCrumbleTicks     = world.architectBlockCrumbleTicks;
  raw.architectBlockState            = world.architectBlockState;
  raw.isArchitectBlockAliveFlag      = world.isArchitectBlockAliveFlag;
  raw.architectBlockOwnerSlot        = world.architectBlockOwnerSlot;
  raw.dwaNailXWorld                  = world.dwaNailXWorld;
  raw.dwaNailYWorld                  = world.dwaNailYWorld;
  raw.dwaNailVelXWorld               = world.dwaNailVelXWorld;
  raw.dwaNailVelYWorld               = world.dwaNailVelYWorld;
  raw.dwaNailLifetimeTicks           = world.dwaNailLifetimeTicks;
  raw.isDwaNailAliveFlag             = world.isDwaNailAliveFlag;
  raw.grappleWrapPointXWorld         = world.grappleWrapPointXWorld;
  raw.grappleWrapPointYWorld         = world.grappleWrapPointYWorld;
  raw.ropeSegmentCount               = world.ropeSegmentCount;
  raw.ropeHalfThickWorld             = world.ropeHalfThickWorld;
  raw.ropeSegPosXWorld               = world.ropeSegPosXWorld;
  raw.ropeSegPosYWorld               = world.ropeSegPosYWorld;
  raw.webSpiderFadingWebFromXWorld     = world.webSpiderFadingWebFromXWorld;
  raw.webSpiderFadingWebFromYWorld     = world.webSpiderFadingWebFromYWorld;
  raw.webSpiderFadingWebToXWorld       = world.webSpiderFadingWebToXWorld;
  raw.webSpiderFadingWebToYWorld       = world.webSpiderFadingWebToYWorld;
  raw.webSpiderFadingWebRemainingTicks = world.webSpiderFadingWebRemainingTicks;
  raw.webSpiderFadingWebMaxTicks       = world.webSpiderFadingWebMaxTicks;
}

/**
 * Resets the reusable snapshot after a room load that changes the cluster
 * set.  Ensures the cluster array is properly sized and all slots are
 * populated from the current world state.
 *
 * Also calls `refreshSnapshotWorldArrayRefs` to re-point every typed-array
 * field at the new world's buffers.  This is essential after a resident
 * WorldState hot-swap where `world` is a different object than the one passed
 * to `createReusableSnapshot`.
 */
export function resetReusableSnapshot(snap: ReusableWorldSnapshot, world: WorldState): void {
  refreshSnapshotWorldArrayRefs(snap, world);
  const b = _asBacking(snap);
  // Grow pool if this room has more clusters than any previous room.
  while (b._clusterPool.length < world.clusters.length) {
    b._clusterPool.push(_makeEmptyCluster());
  }
  // Reassign pool slots to the clusters array so all indices are defined.
  b.clusters.length = world.clusters.length;
  for (let i = 0; i < world.clusters.length; i++) {
    b.clusters[i] = b._clusterPool[i];
  }
  updateSnapshotInPlace(snap, world);
}

// Re-export the allocating (non-hot-path) snapshot factory from its dedicated
// module so existing `import { createSnapshot } from './snapshot'` callers
// continue to work without modification.
export { createSnapshot } from './snapshotAllocating';
