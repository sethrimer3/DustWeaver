import { WorldState } from '../sim/world';
import { ClusterState } from '../sim/clusters/state';

export interface ParticleSnapshot {
  readonly positionXWorld: Float32Array;
  readonly positionYWorld: Float32Array;
  readonly isAliveFlag: Uint8Array;
  readonly kindBuffer: Uint8Array;
  readonly ownerEntityId: Int32Array;
  readonly particleCount: number;
}

export interface ClusterSnapshot {
  readonly entityId: number;
  readonly positionXWorld: number;
  readonly positionYWorld: number;
  readonly isAliveFlag: 0 | 1;
  readonly isPlayerFlag: 0 | 1;
  readonly healthPoints: number;
  readonly maxHealthPoints: number;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly particles: ParticleSnapshot;
  readonly clusters: readonly ClusterSnapshot[];
}

export function createSnapshot(world: WorldState): WorldSnapshot {
  const clusterSnapshots: ClusterSnapshot[] = [];
  for (let i = 0; i < world.clusters.length; i++) {
    const c: ClusterState = world.clusters[i];
    clusterSnapshots.push({
      entityId: c.entityId,
      positionXWorld: c.positionXWorld,
      positionYWorld: c.positionYWorld,
      isAliveFlag: c.isAliveFlag,
      isPlayerFlag: c.isPlayerFlag,
      healthPoints: c.healthPoints,
      maxHealthPoints: c.maxHealthPoints,
    });
  }

  return {
    tick: world.tick,
    particles: {
      positionXWorld: world.positionXWorld,
      positionYWorld: world.positionYWorld,
      isAliveFlag: world.isAliveFlag,
      kindBuffer: world.kindBuffer,
      ownerEntityId: world.ownerEntityId,
      particleCount: world.particleCount,
    },
    clusters: clusterSnapshots,
  };
}
