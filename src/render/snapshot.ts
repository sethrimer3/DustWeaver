import { WorldState } from '../sim/world';
import { ClusterState } from '../sim/clusters/state';
import { INFLUENCE_RADIUS_WORLD } from '../sim/clusters/binding';
import { DASH_COOLDOWN_TICKS } from '../sim/clusters/dashConstants';

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
}

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
  isGrappleTopSurfaceFlag: 0 | 1;
  isGrappleStuckFlag: 0 | 1;
  grappleAnchorXWorld: number;
  grappleAnchorYWorld: number;
  grappleAttachFxTicks: number;
  grappleAttachFxXWorld: number;
  grappleAttachFxYWorld: number;
  isPlayerBlockingFlag: 0 | 1;
  hasGrappleChargeFlag: 0 | 1;
  isPlayerWeaveActiveFlag: 0 | 1;
  characterId: string;
  grasshopperCount: number;
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
    isGrappleTopSurfaceFlag:  world.isGrappleTopSurfaceFlag,
    isGrappleStuckFlag:       world.isGrappleStuckFlag,
    grappleAnchorXWorld:      world.grappleAnchorXWorld,
    grappleAnchorYWorld:      world.grappleAnchorYWorld,
    grappleAttachFxTicks:     world.grappleAttachFxTicks,
    grappleAttachFxXWorld:    world.grappleAttachFxXWorld,
    grappleAttachFxYWorld:    world.grappleAttachFxYWorld,
    isPlayerBlockingFlag:     world.isPlayerBlockingFlag,
    hasGrappleChargeFlag:     world.hasGrappleChargeFlag,
    isPlayerWeaveActiveFlag:  (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0,
    characterId:              world.characterId,
    grasshopperCount:         world.grasshopperCount,
    grasshopperXWorld:        world.grasshopperXWorld,
    grasshopperYWorld:        world.grasshopperYWorld,
    isGrasshopperAliveFlag:   world.isGrasshopperAliveFlag,
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
  b.isGrappleTopSurfaceFlag   = world.isGrappleTopSurfaceFlag;
  b.isGrappleStuckFlag        = world.isGrappleStuckFlag;
  b.grappleAnchorXWorld       = world.grappleAnchorXWorld;
  b.grappleAnchorYWorld       = world.grappleAnchorYWorld;
  b.grappleAttachFxTicks      = world.grappleAttachFxTicks;
  b.grappleAttachFxXWorld     = world.grappleAttachFxXWorld;
  b.grappleAttachFxYWorld     = world.grappleAttachFxYWorld;
  b.isPlayerBlockingFlag      = world.isPlayerBlockingFlag;
  b.hasGrappleChargeFlag      = world.hasGrappleChargeFlag;
  b.isPlayerWeaveActiveFlag   = (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0;
  b.grasshopperCount          = world.grasshopperCount;

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
    isGrappleTopSurfaceFlag: world.isGrappleTopSurfaceFlag,
    isGrappleStuckFlag: world.isGrappleStuckFlag,
    grappleAnchorXWorld: world.grappleAnchorXWorld,
    grappleAnchorYWorld: world.grappleAnchorYWorld,
    grappleAttachFxTicks: world.grappleAttachFxTicks,
    grappleAttachFxXWorld: world.grappleAttachFxXWorld,
    grappleAttachFxYWorld: world.grappleAttachFxYWorld,
    isPlayerBlockingFlag: world.isPlayerBlockingFlag,
    hasGrappleChargeFlag: world.hasGrappleChargeFlag,
    isPlayerWeaveActiveFlag: (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0,
    characterId: world.characterId,
    grasshopperCount:       world.grasshopperCount,
    grasshopperXWorld:      world.grasshopperXWorld,
    grasshopperYWorld:      world.grasshopperYWorld,
    isGrasshopperAliveFlag: world.isGrasshopperAliveFlag,
  };
}
