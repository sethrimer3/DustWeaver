import { WorldState } from '../sim/world';
import { ClusterState } from '../sim/clusters/state';
import { INFLUENCE_RADIUS_WORLD } from '../sim/clusters/binding';
import { DASH_COOLDOWN_TICKS } from '../sim/clusters/dashConstants';

// Re-export public snapshot interfaces from their dedicated types module so
// that all existing `import { ... } from './snapshot'` callers continue to
// work without modification.
export type { ParticleSnapshot, ClusterSnapshot, WallSnapshot, WorldSnapshot } from './snapshotTypes';
import type { ClusterSnapshot, WorldSnapshot } from './snapshotTypes';

// ── Reusable allocation-free snapshot ─────────────────────────────────────

/**
 * Maximum number of cluster slots pre-allocated in a ReusableWorldSnapshot
 * pool.  Rooms should never exceed this; if they do the pool grows lazily.
 */
const MAX_REUSABLE_CLUSTERS = 64;

/** Mutable version of ClusterSnapshot for use only within this module. */
type _MutableCluster = { -readonly [K in keyof ClusterSnapshot]: ClusterSnapshot[K] };

/**
 * Internal mutable backing accessed only through the snapshot module
 * functions.  External callers see only the readonly WorldSnapshot view.
 */
interface _ReusableBacking {
  tick: number;
  /** Sub-object whose typed-array fields are fixed references; only particleCount changes. */
  readonly particles: { particleCount: number };
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
  grappleAttachFxTicks: number;
  grappleAttachFxXWorld: number;
  grappleAttachFxYWorld: number;
  grappleProximityBounceTicksLeft: number;
  grappleProximityBounceRotationAngleRad: number;
  isPlayerBlockingFlag: 0 | 1;
  hasGrappleChargeFlag: 0 | 1;
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
  ropeCount: number;
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

/** Returns a zeroed-out cluster object ready for pool use. */
function _makeEmptyCluster(): _MutableCluster {
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
    isGrappleHunterFlag: 0,
    grappleHunterState: 0,
    grappleHunterChainStartIndex: -1,
    grappleHunterTipXWorld: 0,
    grappleHunterTipYWorld: 0,
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
    isGoldenMimicFlag: 0,
    isGoldenMimicYFlippedFlag: 0,
    goldenMimicState: 0,
    goldenMimicFadeAlpha: 1.0,
    isBeeSwarmFlag: 0,
    beeSwarmSlotIndex: -1,
    beeSwarmState: 0,
    beeSwarmOrbitAngleRad: 0,
    renderPositionXWorld: 0,
    renderPositionYWorld: 0,
  };
}

/** Copies all ClusterState fields into a pre-allocated _MutableCluster object. */
function _fillCluster(dst: _MutableCluster, src: ClusterState): void {
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
  dst.isGrappleHunterFlag             = src.isGrappleHunterFlag;
  dst.grappleHunterState              = src.grappleHunterState;
  dst.grappleHunterChainStartIndex    = src.grappleHunterChainStartIndex;
  dst.grappleHunterTipXWorld          = src.grappleHunterTipXWorld;
  dst.grappleHunterTipYWorld          = src.grappleHunterTipYWorld;
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
  dst.isGoldenMimicFlag               = src.isGoldenMimicFlag;
  dst.isGoldenMimicYFlippedFlag       = src.isGoldenMimicYFlippedFlag;
  dst.goldenMimicState                = src.goldenMimicState;
  dst.goldenMimicFadeAlpha            = src.goldenMimicFadeAlpha;
  dst.isBeeSwarmFlag                  = src.isBeeSwarmFlag;
  dst.beeSwarmSlotIndex               = src.beeSwarmSlotIndex;
  dst.beeSwarmState                   = src.beeSwarmState;
  dst.beeSwarmOrbitAngleRad           = src.beeSwarmOrbitAngleRad;
  // Render interpolation: initialised to the physics position by default.
  // updateSnapshotInPlace() overwrites these with the blended position when
  // prev-position buffers and an alpha are supplied.
  dst.renderPositionXWorld            = src.positionXWorld;
  dst.renderPositionYWorld            = src.positionYWorld;
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
    grappleAttachFxTicks:     world.grappleAttachFxTicks,
    grappleAttachFxXWorld:    world.grappleAttachFxXWorld,
    grappleAttachFxYWorld:    world.grappleAttachFxYWorld,
    grappleProximityBounceTicksLeft:        world.grappleProximityBounceTicksLeft,
    grappleProximityBounceRotationAngleRad: world.grappleProximityBounceRotationAngleRad,
    isPlayerBlockingFlag:     world.isPlayerBlockingFlag,
    hasGrappleChargeFlag:     world.hasGrappleChargeFlag,
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
    ropeCount:           world.ropeCount,
    ropeSegmentCount:    world.ropeSegmentCount,
    ropeSegPosXWorld:    world.ropeSegPosXWorld,
    ropeSegPosYWorld:    world.ropeSegPosYWorld,
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
  b.grappleAttachFxTicks      = world.grappleAttachFxTicks;
  b.grappleAttachFxXWorld     = world.grappleAttachFxXWorld;
  b.grappleAttachFxYWorld     = world.grappleAttachFxYWorld;
  b.grappleProximityBounceTicksLeft        = world.grappleProximityBounceTicksLeft;
  b.grappleProximityBounceRotationAngleRad = world.grappleProximityBounceRotationAngleRad;
  b.isPlayerBlockingFlag      = world.isPlayerBlockingFlag;
  b.hasGrappleChargeFlag      = world.hasGrappleChargeFlag;
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
  b.ropeCount = world.ropeCount;

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

export function createSnapshot(world: WorldState): WorldSnapshot {
  const clusterSnapshots: ClusterSnapshot[] = [];
  for (let i = 0; i < world.clusters.length; i++) {
    const c: ClusterState = world.clusters[i];
    clusterSnapshots.push({
      entityId:              c.entityId,
      positionXWorld:        c.positionXWorld,
      positionYWorld:        c.positionYWorld,
      velocityXWorld:        c.velocityXWorld,
      velocityYWorld:        c.velocityYWorld,
      isAliveFlag:           c.isAliveFlag,
      isPlayerFlag:          c.isPlayerFlag,
      healthPoints:          c.healthPoints,
      maxHealthPoints:       c.maxHealthPoints,
      influenceRadiusWorld:  INFLUENCE_RADIUS_WORLD,
      dashCooldownTicks:     c.dashCooldownTicks,
      maxDashCooldownTicks:  DASH_COOLDOWN_TICKS,
      dashRechargeAnimTicks: c.dashRechargeAnimTicks,
      halfWidthWorld:        c.halfWidthWorld,
      halfHeightWorld:       c.halfHeightWorld,
      isFlyingEyeFlag:          c.isFlyingEyeFlag,
      flyingEyeFacingAngleRad:  c.flyingEyeFacingAngleRad,
      flyingEyeElementKind:     c.flyingEyeElementKind,
      isRollingEnemyFlag:       c.isRollingEnemyFlag,
      rollingEnemySpriteIndex:  c.rollingEnemySpriteIndex,
      rollingEnemyRollAngleRad: c.rollingEnemyRollAngleRad,
      isFacingLeftFlag:          c.isFacingLeftFlag,
      isSprintingFlag:           c.isSprintingFlag,
      isCrouchingFlag:           c.isCrouchingFlag,
      isGroundedFlag:            c.isGroundedFlag,
      isWallSlidingFlag:         c.isWallSlidingFlag,
      playerIdleAnimState:       c.playerIdleAnimState,
      isRockElementalFlag:              c.isRockElementalFlag,
      rockElementalState:               c.rockElementalState,
      rockElementalActivationProgress:  c.rockElementalActivationProgress,
      rockElementalOrbitAngleRad:       c.rockElementalOrbitAngleRad,
      rockElementalDustCount:           c.rockElementalDustCount,
      isRadiantTetherFlag:              c.isRadiantTetherFlag,
      radiantTetherState:               c.radiantTetherState,
      radiantTetherStateTicks:          c.radiantTetherStateTicks,
      radiantTetherBaseAngleRad:        c.radiantTetherBaseAngleRad,
      radiantTetherChainCount:          c.radiantTetherChainCount,
      isGrappleHunterFlag:              c.isGrappleHunterFlag,
      grappleHunterState:               c.grappleHunterState,
      grappleHunterChainStartIndex:     c.grappleHunterChainStartIndex,
      grappleHunterTipXWorld:           c.grappleHunterTipXWorld,
      grappleHunterTipYWorld:           c.grappleHunterTipYWorld,
      invulnerabilityTicks:             c.invulnerabilityTicks,
      hurtTicks:                        c.hurtTicks,
      isSlimeFlag:                c.isSlimeFlag,
      isLargeSlimeFlag:           c.isLargeSlimeFlag,
      largeSlimeDustOrbitAngleRad: c.largeSlimeDustOrbitAngleRad,
      isWheelEnemyFlag:           c.isWheelEnemyFlag,
      wheelRollAngleRad:          c.wheelRollAngleRad,
      isBeetleFlag:                  c.isBeetleFlag,
      beetleAiState:                 c.beetleAiState,
      beetleSurfaceNormalXWorld:     c.beetleSurfaceNormalXWorld,
      beetleSurfaceNormalYWorld:     c.beetleSurfaceNormalYWorld,
      beetleIsFlightModeFlag:        c.beetleIsFlightModeFlag,
      isBubbleEnemyFlag:             c.isBubbleEnemyFlag,
      isIceBubbleFlag:               c.isIceBubbleFlag,
      bubbleState:                   c.bubbleState,
      bubbleOrbitAngleRad:           c.bubbleOrbitAngleRad,
      isSquareStampedeFlag:          c.isSquareStampedeFlag,
      squareStampedeSlotIndex:       c.squareStampedeSlotIndex,
      squareStampedeBaseHalfSizeWorld: c.squareStampedeBaseHalfSizeWorld,
      isGoldenMimicFlag:             c.isGoldenMimicFlag,
      isGoldenMimicYFlippedFlag:     c.isGoldenMimicYFlippedFlag,
      goldenMimicState:              c.goldenMimicState,
      goldenMimicFadeAlpha:          c.goldenMimicFadeAlpha,
      isBeeSwarmFlag:                c.isBeeSwarmFlag,
      beeSwarmSlotIndex:             c.beeSwarmSlotIndex,
      beeSwarmState:                 c.beeSwarmState,
      beeSwarmOrbitAngleRad:         c.beeSwarmOrbitAngleRad,
      renderPositionXWorld:          c.positionXWorld,
      renderPositionYWorld:          c.positionYWorld,
    });
  }

  return {
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
      particleCount:     world.particleCount,
    },
    clusters: clusterSnapshots,
    walls: {
      count:  world.wallCount,
      xWorld: world.wallXWorld,
      yWorld: world.wallYWorld,
      wWorld: world.wallWWorld,
      hWorld: world.wallHWorld,
      isPlatformFlag: world.wallIsPlatformFlag,
      platformEdge: world.wallPlatformEdge,
      themeIndex: world.wallThemeIndex,
      isInvisibleFlag: world.wallIsInvisibleFlag,
      rampOrientationIndex: world.wallRampOrientationIndex,
      isPillarHalfWidthFlag: world.wallIsPillarHalfWidthFlag,
    },
    isGrappleActiveFlag: world.isGrappleActiveFlag,
    isGrappleMissActiveFlag: world.isGrappleMissActiveFlag,
    grappleParticleStartIndex: world.grappleParticleStartIndex,
    isGrappleZipActiveFlag: world.isGrappleZipActiveFlag,
    isGrappleStuckFlag: world.isGrappleStuckFlag,
    grappleAnchorXWorld: world.grappleAnchorXWorld,
    grappleAnchorYWorld: world.grappleAnchorYWorld,
    grappleAttachFxTicks: world.grappleAttachFxTicks,
    grappleAttachFxXWorld: world.grappleAttachFxXWorld,
    grappleAttachFxYWorld: world.grappleAttachFxYWorld,
    grappleProximityBounceTicksLeft:        world.grappleProximityBounceTicksLeft,
    grappleProximityBounceRotationAngleRad: world.grappleProximityBounceRotationAngleRad,
    isPlayerBlockingFlag: world.isPlayerBlockingFlag,
    hasGrappleChargeFlag: world.hasGrappleChargeFlag,
    isPlayerWeaveActiveFlag: (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0,
    characterId: world.characterId,
    grasshopperCount:       world.grasshopperCount,
    grasshopperXWorld:      world.grasshopperXWorld,
    grasshopperYWorld:      world.grasshopperYWorld,
    isGrasshopperAliveFlag: world.isGrasshopperAliveFlag,
    squareStampedeTrailXWorld: world.squareStampedeTrailXWorld,
    squareStampedeTrailYWorld: world.squareStampedeTrailYWorld,
    squareStampedeTrailHead:   world.squareStampedeTrailHead,
    squareStampedeTrailCount:  world.squareStampedeTrailCount,
    squareStampedeTrailStride: world.squareStampedeTrailStride,
    beeSwarmBeeXWorld:         world.beeSwarmBeeXWorld,
    beeSwarmBeeYWorld:         world.beeSwarmBeeYWorld,
    beeSwarmBeeVelXWorld:      world.beeSwarmBeeVelXWorld,
    beeSwarmBeeVelYWorld:      world.beeSwarmBeeVelYWorld,
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
    ropeCount:           world.ropeCount,
    ropeSegmentCount:    world.ropeSegmentCount,
    ropeSegPosXWorld:    world.ropeSegPosXWorld,
    ropeSegPosYWorld:    world.ropeSegPosYWorld,
  };
}
