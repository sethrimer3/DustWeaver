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

  // ---- Player Weave combat state ------------------------------------------
  /** ID of the equipped primary Weave. */
  playerPrimaryWeaveId: string;
  /** ID of the equipped secondary Weave. */
  playerSecondaryWeaveId: string;
  /** Set to 1 for one tick when the primary Weave should activate. */
  playerPrimaryWeaveTriggeredFlag: 0 | 1;
  /** Set to 1 for one tick when the secondary Weave should activate. */
  playerSecondaryWeaveTriggeredFlag: 0 | 1;
  /** 1 while the primary sustained Weave is actively held. */
  isPlayerPrimaryWeaveActiveFlag: 0 | 1;
  /** 1 while the secondary sustained Weave is actively held. */
  isPlayerSecondaryWeaveActiveFlag: 0 | 1;
  /** Set to 1 for one tick when the primary Weave input is released. */
  playerPrimaryWeaveEndFlag: 0 | 1;
  /** Set to 1 for one tick when the secondary Weave input is released. */
  playerSecondaryWeaveEndFlag: 0 | 1;
  /** Normalized aim direction for weave activation (world units). */
  playerWeaveAimDirXWorld: number;
  playerWeaveAimDirYWorld: number;

  // ---- Player dash --------------------------------------------------------
  /** Set to 1 for one tick to trigger a player dash. */
  playerDashTriggeredFlag: 0 | 1;
  /** Normalized direction of the dash (set alongside playerDashTriggeredFlag). */
  playerDashDirXWorld: number;
  playerDashDirYWorld: number;

  // ---- Player movement input (set each frame by game screen) --------------
  /**
   * Normalized horizontal movement input for this tick.
   * Set by the game screen before tick(); cleared by applyClusterMovement().
   * Zero when no movement input is provided.
   */
  playerMoveInputDxWorld: number;
  playerMoveInputDyWorld: number;
  /** 1 while the sprint key (Shift) is held down. */
  playerSprintHeldFlag: 0 | 1;
  /** 1 while the crouch key (S / ArrowDown) is held and player is on the ground. */
  playerCrouchHeldFlag: 0 | 1;
  /** Selected character identifier ('knight', 'demonFox', or 'princess'). */
  characterId: string;

  // ---- Player jump (set each frame by game screen) ------------------------
  /** Set to 1 for one tick to trigger a player jump (cleared by applyClusterMovement). */
  playerJumpTriggeredFlag: 0 | 1;
  /** 1 while the jump key is physically held down — used for variable-height jump cut. */
  playerJumpHeldFlag: 0 | 1;

  // ---- Grapple hook -------------------------------------------------------
  /** 1 while the player's grapple hook is attached to an anchor point. */
  isGrappleActiveFlag: 0 | 1;
  /** World-space X coordinate of the grapple anchor point. */
  grappleAnchorXWorld: number;
  /** World-space Y coordinate of the grapple anchor point. */
  grappleAnchorYWorld: number;
  /**
   * Fixed rope length (world units) set at fire time.
   * The player is constrained to stay within this distance of the anchor.
   */
  grappleLengthWorld: number;
  /**
   * Total amount of rope pulled in during the current grapple session (world units).
   * Accumulates while the jump button is held; grapple breaks when this exceeds
   * GRAPPLE_MAX_PULL_IN_WORLD.  Reset to 0 on each new grapple fire.
   */
  grapplePullInAmountWorld: number;
  /** Remaining ticks for the grapple attach sparkle burst effect. */
  grappleAttachFxTicks: number;
  /** World-space effect center for grapple attach burst. */
  grappleAttachFxXWorld: number;
  grappleAttachFxYWorld: number;
  /**
   * Start index in the particle buffer of the GRAPPLE_SEGMENT_COUNT chain particles.
   * -1 if not yet allocated. These slots are reserved by the game screen at startup.
   */
  grappleParticleStartIndex: number;
  /**
   * Number of consecutive ticks the jump button has been held while the grapple
   * is active.  Used for tap-vs-hold detection:
   *   • ≤ GRAPPLE_JUMP_TAP_THRESHOLD_TICKS on release → tap → release grapple
   *   • > threshold while held → hold → retract rope
   * Reset to 0 on grapple fire / release.
   */
  grappleJumpHeldTickCount: number;

  // ---- Grapple miss state (limp chain) ------------------------------------
  /** 1 while the grapple chain is in "miss" mode (extended to full length, falling limp). */
  isGrappleMissActiveFlag: 0 | 1;
  /** Direction X the grapple was fired in (normalized). */
  grappleMissDirXWorld: number;
  /** Direction Y the grapple was fired in (normalized). */
  grappleMissDirYWorld: number;
  /** Ticks since the grapple miss started. */
  grappleMissTickCount: number;

  // ---- Skid debris visual flag (read by renderer) -------------------------
  /** 1 while the player is skidding and debris should be spawned. */
  isPlayerSkiddingFlag: 0 | 1;
  /** X position of the skid debris origin (bottom-front corner). */
  skidDebrisXWorld: number;
  /** Y position of the skid debris origin (bottom edge). */
  skidDebrisYWorld: number;
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
    // Weave combat state
    playerPrimaryWeaveId: 'spire',
    playerSecondaryWeaveId: 'aegis',
    playerPrimaryWeaveTriggeredFlag: 0,
    playerSecondaryWeaveTriggeredFlag: 0,
    isPlayerPrimaryWeaveActiveFlag: 0,
    isPlayerSecondaryWeaveActiveFlag: 0,
    playerPrimaryWeaveEndFlag: 0,
    playerSecondaryWeaveEndFlag: 0,
    playerWeaveAimDirXWorld: 1.0,
    playerWeaveAimDirYWorld: 0.0,
    playerDashTriggeredFlag: 0,
    playerDashDirXWorld: 1.0,
    playerDashDirYWorld: 0.0,
    playerMoveInputDxWorld: 0.0,
    playerMoveInputDyWorld: 0.0,
    playerSprintHeldFlag: 0,
    playerCrouchHeldFlag: 0,
    characterId: 'knight',
    playerJumpTriggeredFlag: 0,
    playerJumpHeldFlag: 0,
    isGrappleActiveFlag: 0,
    grappleAnchorXWorld: 0.0,
    grappleAnchorYWorld: 0.0,
    grappleLengthWorld: 0.0,
    grapplePullInAmountWorld: 0.0,
    grappleAttachFxTicks: 0,
    grappleAttachFxXWorld: 0.0,
    grappleAttachFxYWorld: 0.0,
    grappleParticleStartIndex: -1,
    grappleJumpHeldTickCount: 0,
    isGrappleMissActiveFlag: 0,
    grappleMissDirXWorld: 0.0,
    grappleMissDirYWorld: 0.0,
    grappleMissTickCount: 0,
    isPlayerSkiddingFlag: 0,
    skidDebrisXWorld: 0.0,
    skidDebrisYWorld: 0.0,
    ...createParticleBuffers(),
  };
}

export { MAX_PARTICLES };
