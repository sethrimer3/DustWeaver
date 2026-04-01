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
  readonly particleCount:     number;
}

export interface ClusterSnapshot {
  readonly entityId:              number;
  readonly positionXWorld:        number;
  readonly positionYWorld:        number;
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
}

export interface WallSnapshot {
  readonly count:   number;
  readonly xWorld:  Float32Array;
  readonly yWorld:  Float32Array;
  readonly wWorld:  Float32Array;
  readonly hWorld:  Float32Array;
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
  /** 1 while the player has any sustained Weave active (primary or secondary). */
  readonly isPlayerWeaveActiveFlag: 0 | 1;
  /** Selected character identifier ('knight', 'demonFox', or 'princess'). */
  readonly characterId: string;
}

export function createSnapshot(world: WorldState): WorldSnapshot {
  const clusterSnapshots: ClusterSnapshot[] = [];
  for (let i = 0; i < world.clusters.length; i++) {
    const c: ClusterState = world.clusters[i];
    clusterSnapshots.push({
      entityId:              c.entityId,
      positionXWorld:        c.positionXWorld,
      positionYWorld:        c.positionYWorld,
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
      particleCount:     world.particleCount,
    },
    clusters: clusterSnapshots,
    walls: {
      count:  world.wallCount,
      xWorld: world.wallXWorld,
      yWorld: world.wallYWorld,
      wWorld: world.wallWWorld,
      hWorld: world.wallHWorld,
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
    isPlayerWeaveActiveFlag: (world.isPlayerPrimaryWeaveActiveFlag === 1 || world.isPlayerSecondaryWeaveActiveFlag === 1) ? 1 : 0,
    characterId: world.characterId,
  };
}
