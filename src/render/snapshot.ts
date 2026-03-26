import { WorldState } from '../sim/world';
import { ClusterState } from '../sim/clusters/state';
import { INFLUENCE_RADIUS_WORLD } from '../sim/clusters/binding';
import { DASH_COOLDOWN_TICKS } from '../sim/clusters/enemyAi';

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
  };
}
