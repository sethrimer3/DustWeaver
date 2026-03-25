import { ParticleBuffers, createParticleBuffers, MAX_PARTICLES } from './particles/state';
import { ClusterState } from './clusters/state';

export interface WorldState extends ParticleBuffers {
  tick: number;
  dtMs: number;
  particleCount: number;
  clusters: ClusterState[];
}

export function createWorldState(dtMs: number): WorldState {
  return {
    tick: 0,
    dtMs,
    particleCount: 0,
    clusters: [],
    ...createParticleBuffers(),
  };
}

export { MAX_PARTICLES };
