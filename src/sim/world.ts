import { ParticleBuffers, createParticleBuffers, MAX_PARTICLES } from './particles/state';
import { ClusterState } from './clusters/state';
import { RngState, createRng } from './rng';

/** Maximum number of axis-aligned wall rectangles supported per world. */
export const MAX_WALLS = 64;

export interface WorldState extends ParticleBuffers {
  tick: number;
  dtMs: number;
  particleCount: number;
  clusters: ClusterState[];
  /** Deterministic PRNG used for in-sim events (particle respawn, spawning). */
  rng: RngState;
  /** Width of the playable world area in world units (used for Fluid respawn bounds). */
  worldWidthWorld: number;
  /** Height of the playable world area in world units (used for Fluid respawn bounds). */
  worldHeightWorld: number;

  // ---- Wall / obstacle geometry ------------------------------------------
  /** Number of active wall rectangles in the wall buffers. */
  wallCount: number;
  /** Left edge X of each wall (world units). */
  wallXWorld: Float32Array;
  /** Top edge Y of each wall (world units). */
  wallYWorld: Float32Array;
  /** Width of each wall (world units). */
  wallWWorld: Float32Array;
  /** Height of each wall (world units). */
  wallHWorld: Float32Array;

  // ---- Player combat state ------------------------------------------------
  /** Set to 1 for exactly one tick to trigger attack launch. */
  playerAttackTriggeredFlag: 0 | 1;
  /** Normalized attack direction (world units, set when attack is triggered). */
  playerAttackDirXWorld: number;
  playerAttackDirYWorld: number;
  /** 1 while the player is holding block; particles form a shield each tick. */
  isPlayerBlockingFlag: 0 | 1;
  /** Normalized block direction (updated each tick while blocking). */
  playerBlockDirXWorld: number;
  playerBlockDirYWorld: number;

  // ---- Player dash --------------------------------------------------------
  /** Set to 1 for one tick to trigger a player dash. */
  playerDashTriggeredFlag: 0 | 1;
  /** Normalized direction of the dash (set alongside playerDashTriggeredFlag). */
  playerDashDirXWorld: number;
  playerDashDirYWorld: number;

  // ---- Player movement input (set each frame by game screen) --------------
  /**
   * Normalized movement input direction for this tick.
   * Set by the game screen before tick(); cleared by applyClusterMovement().
   * Zero when no movement input is provided.
   */
  playerMoveInputDxWorld: number;
  playerMoveInputDyWorld: number;
}

export function createWorldState(dtMs: number, rngSeed = 42): WorldState {
  return {
    tick: 0,
    dtMs,
    particleCount: 0,
    clusters: [],
    rng: createRng(rngSeed),
    worldWidthWorld: 800,
    worldHeightWorld: 600,
    wallCount: 0,
    wallXWorld: new Float32Array(MAX_WALLS),
    wallYWorld: new Float32Array(MAX_WALLS),
    wallWWorld: new Float32Array(MAX_WALLS),
    wallHWorld: new Float32Array(MAX_WALLS),
    playerAttackTriggeredFlag: 0,
    playerAttackDirXWorld: 1.0,
    playerAttackDirYWorld: 0.0,
    isPlayerBlockingFlag: 0,
    playerBlockDirXWorld: 1.0,
    playerBlockDirYWorld: 0.0,
    playerDashTriggeredFlag: 0,
    playerDashDirXWorld: 1.0,
    playerDashDirYWorld: 0.0,
    playerMoveInputDxWorld: 0.0,
    playerMoveInputDyWorld: 0.0,
    ...createParticleBuffers(),
  };
}

export { MAX_PARTICLES };
