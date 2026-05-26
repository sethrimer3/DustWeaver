import { WorldState } from '../sim/world';
import { MAX_PARTICLES } from '../sim/particles/state';
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
  /** Sub-object whose typed-array fields are fixed references; only particleCount changes. */
  readonly particles: { particleCount: number; particleMoteSlotState: Uint8Array };
  clusters: _MutableCluster[];
  /** Sub-object whose typed-array fields are fixed references; only count changes. */
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
  characterId: string;
  grasshopperCount: number;
  squareStampedeTrailXWorld: Float32Array;
  squareStampedeTrailYWorld: Float32Array;
  squareStampedeTrailHead: Uint8Array;
  squareStampedeTrailCount: Uint8Array;
  squareStampedeTrailStride: number;
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
  // Arrow Weave scalar fields updated each frame
  isArrowWeaveLoadingFlag: 0 | 1;
  arrowWeaveCurrentMoteCount: number;
  playerWeaveAimDirXWorld: number;
  playerWeaveAimDirYWorld: number;
  arrowCount: number;
  // Shield Sword Weave scalar fields updated each frame
  playerSecondaryWeaveId: string;
  swordWeaveStateEnum: number;
  swordWeaveStateTicksElapsed: number;
  swordWeaveAngleRad: number;
  swordWeaveSlashStartAngleRad: number;
  swordWeaveSlashEndAngleRad: number;
  swordWeaveHandAnchorXWorld: number;
  swordWeaveHandAnchorYWorld: number;
  swordWeaveLengthRatio: number;
  moteGrappleDisplayRadiusWorld: number;
  isMoteSourceOrbitFlag: 0 | 1;
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
      particleMoteSlotState: new Uint8Array(MAX_PARTICLES),
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
    // Arrow Weave — typed-array fields are shared views (always up-to-date);
    // scalar fields are updated in updateSnapshotInPlace.
    isArrowWeaveLoadingFlag:    world.isArrowWeaveLoadingFlag,
    arrowWeaveCurrentMoteCount: world.arrowWeaveCurrentMoteCount,
    playerWeaveAimDirXWorld:    world.playerWeaveAimDirXWorld,
    playerWeaveAimDirYWorld:    world.playerWeaveAimDirYWorld,
    arrowCount:                 world.arrowCount,
    arrowXWorld:                world.arrowXWorld,
    arrowYWorld:                world.arrowYWorld,
    arrowDirXWorld:             world.arrowDirXWorld,
    arrowDirYWorld:             world.arrowDirYWorld,
    arrowMoteCount:             world.arrowMoteCount,
    isArrowStuckFlag:           world.isArrowStuckFlag,
    isArrowHitEnemyFlag:        world.isArrowHitEnemyFlag,
    arrowLifetimeTicksLeft:     world.arrowLifetimeTicksLeft,
    // Shield Sword Weave
    playerSecondaryWeaveId:        world.playerSecondaryWeaveId,
    swordWeaveStateEnum:           world.swordWeaveStateEnum,
    swordWeaveStateTicksElapsed:   world.swordWeaveStateTicksElapsed,
    swordWeaveAngleRad:            world.swordWeaveAngleRad,
    swordWeaveSlashStartAngleRad:  world.swordWeaveSlashStartAngleRad,
    swordWeaveSlashEndAngleRad:    world.swordWeaveSlashEndAngleRad,
    swordWeaveHandAnchorXWorld:    world.swordWeaveHandAnchorXWorld,
    swordWeaveHandAnchorYWorld:    world.swordWeaveHandAnchorYWorld,
    swordWeaveLengthRatio:         world.swordWeaveLengthRatio,
    // Ordered Mote Queue display
    moteGrappleDisplayRadiusWorld: world.moteGrappleDisplayRadiusWorld,
    isMoteSourceOrbitFlag:         world.isMoteSourceOrbitFlag,
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

  // Populate per-particle mote slot state from the logical mote queue.
  // O(MAX_MOTE_SLOTS): zero-fill then mark each slot's linked particle.
  b.particles.particleMoteSlotState.fill(0);
  const slotCount           = world.moteSlotCount;
  const moteSlotPIdx        = world.moteSlotParticleIndex;
  const moteSlotState       = world.moteSlotState;
  for (let s = 0; s < slotCount; s++) {
    const pidx = moteSlotPIdx[s];
    if (pidx >= 0 && moteSlotState[s] !== 0) {
      b.particles.particleMoteSlotState[pidx] = 1;
    }
  }

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
  b.grasshopperCount          = world.grasshopperCount;

  // Arrow Weave scalar fields (typed-array fields are shared views, no update needed)
  b.isArrowWeaveLoadingFlag    = world.isArrowWeaveLoadingFlag;
  b.arrowWeaveCurrentMoteCount = world.arrowWeaveCurrentMoteCount;
  b.playerWeaveAimDirXWorld    = world.playerWeaveAimDirXWorld;
  b.playerWeaveAimDirYWorld    = world.playerWeaveAimDirYWorld;
  b.arrowCount                 = world.arrowCount;

  // Shield Sword Weave scalar fields
  b.playerSecondaryWeaveId        = world.playerSecondaryWeaveId;
  b.swordWeaveStateEnum           = world.swordWeaveStateEnum;
  b.swordWeaveStateTicksElapsed   = world.swordWeaveStateTicksElapsed;
  b.swordWeaveAngleRad            = world.swordWeaveAngleRad;
  b.swordWeaveSlashStartAngleRad  = world.swordWeaveSlashStartAngleRad;
  b.swordWeaveSlashEndAngleRad    = world.swordWeaveSlashEndAngleRad;
  b.swordWeaveHandAnchorXWorld    = world.swordWeaveHandAnchorXWorld;
  b.swordWeaveHandAnchorYWorld    = world.swordWeaveHandAnchorYWorld;
  b.swordWeaveLengthRatio         = world.swordWeaveLengthRatio;

  // Ordered Mote Queue display
  b.moteGrappleDisplayRadiusWorld = world.moteGrappleDisplayRadiusWorld;
  b.isMoteSourceOrbitFlag         = world.isMoteSourceOrbitFlag;
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
 * Resets the reusable snapshot after a room load that changes the cluster
 * set.  Ensures the cluster array is properly sized and all slots are
 * populated from the current world state.
 */
export function resetReusableSnapshot(snap: ReusableWorldSnapshot, world: WorldState): void {
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
