import { ParticleBuffers, createParticleBuffers, MAX_PARTICLES } from './particles/state';
import { ClusterState } from './clusters/state';
import { RngState, createRng } from './rng';

/** Maximum number of axis-aligned wall rectangles supported per world. */
export const MAX_WALLS = 2000;

/** Maximum number of spike hazards per room. */
export const MAX_SPIKES = 32;
/** Maximum number of springboards per room. */
export const MAX_SPRINGBOARDS = 16;
/** Maximum number of water zones per room. */
export const MAX_WATER_ZONES = 8;
/** Maximum number of lava zones per room. */
export const MAX_LAVA_ZONES = 8;
/** Maximum number of breakable blocks per room. */
export const MAX_BREAKABLE_BLOCKS = 32;
/** Maximum number of dust boost jars per room. */
export const MAX_DUST_BOOST_JARS = 16;
/** Maximum number of firefly jars per room. */
export const MAX_FIREFLY_JARS = 16;
/** Maximum number of active fireflies at once. */
export const MAX_FIREFLIES = 32;
/** Number of fireflies spawned from each broken firefly jar. */
export const FIREFLIES_PER_JAR = 4;
/** Maximum number of dust piles per room. */
export const MAX_DUST_PILES = 32;

/** Maximum number of grasshopper critters per room. */
export const MAX_GRASSHOPPERS = 32;
/**
 * Max ticks for the initial staggered hop timer (so grasshoppers don't all
 * hop on tick 0).
 */
export const GRASSHOPPER_INITIAL_TIMER_MAX_TICKS = 60;

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
  /**
   * 1 if the corresponding wall is a one-way platform — only collides from
   * the specified edge; the player can pass through from the other direction.
   */
  wallIsPlatformFlag: Uint8Array;
  /**
   * Which edge of the platform is the one-way surface.
   * 0=top, 1=bottom, 2=left, 3=right.  Irrelevant when wallIsPlatformFlag=0.
   */
  wallPlatformEdge: Uint8Array;
  /** Per-wall theme index: 0=blackRock, 1=brownRock, 2=dirt.  255=use room default. */
  wallThemeIndex: Uint8Array;
  /** 1 if the corresponding wall is invisible (collision-only boundary, not rendered). */
  wallIsInvisibleFlag: Uint8Array;
  /**
   * Ramp orientation index. 255 = not a ramp (treat as full AABB).
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  wallRampOrientationIndex: Uint8Array;
  /**
   * 1 if the corresponding wall is a half-width pillar (4 px wide).
   * Only meaningful for 1×2 pillar walls.
   */
  wallIsPillarHalfWidthFlag: Uint8Array;

  // ---- Player combat state ------------------------------------------------
  /**
   * World tick on which the most recent blocked hit (0-damage enemy attack)
   * occurred.  Initialised to -1 (no event yet).  Written by forces.ts;
   * read by the renderer to spawn BLOCKED combat text.
   */
  lastPlayerBlockedTick: number;

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
  /** Selected character identifier ('knight', 'demonFox', 'princess', or 'outcast'). */
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

  /**
   * 1 when the player has a grapple charge available; 0 when spent.
   * Resets to 1 when the player touches the ground or grapples onto a top surface.
   * Prevents firing a second grapple until recharged.
   */
  hasGrappleChargeFlag: 0 | 1;

  // ---- Grapple top-surface mechanics ---------------------------------------
  /** 1 when the active grapple is attached to the top surface of a wall block. */
  isGrappleTopSurfaceFlag: 0 | 1;
  /** 1 when the player has arrived at a top-surface grapple anchor and is sticking. */
  isGrappleStuckFlag: 0 | 1;
  /**
   * Ticks since the player came to a complete stop while grapple-stuck.
   * Used for super-jump detection: if the player jumps within 10 ticks
   * of stopping, they receive 100% extra vertical jump height.
   * 0 while still decelerating.
   */
  grappleStuckStoppedTickCount: number;

  // ---- Grapple miss state (limp chain) ------------------------------------
  /** 1 while the grapple chain is in "miss" mode (extended to full length, falling limp). */
  isGrappleMissActiveFlag: 0 | 1;
  /** 1 while the grapple chain is retracting back to the player and cannot attach. */
  isGrappleRetractingFlag: 0 | 1;
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
  /** 1 for a single tick to force a skid-debris burst from an initial wall jump. */
  wallJumpSkidDebrisBurstFlag: 0 | 1;

  // ---- Environmental hazards -----------------------------------------------

  // ── Spikes ─────────────────────────────────────────────────────────────────
  /** Number of active spikes. */
  spikeCount: number;
  /** Center X of each spike (world units). */
  spikeXWorld: Float32Array;
  /** Center Y of each spike (world units). */
  spikeYWorld: Float32Array;
  /**
   * Direction each spike points: 0=up, 1=down, 2=left, 3=right.
   * Encoded as Uint8 for hot-path reads.
   */
  spikeDirection: Uint8Array;
  /** Invulnerability cooldown ticks after spike damage. */
  spikeInvulnTicks: number;

  // ── Springboards ───────────────────────────────────────────────────────────
  /** Number of active springboards. */
  springboardCount: number;
  /** Center X of each springboard (world units). */
  springboardXWorld: Float32Array;
  /** Center Y of each springboard (world units). */
  springboardYWorld: Float32Array;
  /** Animation timer per springboard (ticks remaining in bounce anim). */
  springboardAnimTicks: Uint8Array;

  // ── Water zones ────────────────────────────────────────────────────────────
  /** Number of active water zones. */
  waterZoneCount: number;
  /** Left edge X of each water zone (world units). */
  waterZoneXWorld: Float32Array;
  /** Top edge Y of each water zone (world units). */
  waterZoneYWorld: Float32Array;
  /** Width of each water zone (world units). */
  waterZoneWWorld: Float32Array;
  /** Height of each water zone (world units). */
  waterZoneHWorld: Float32Array;

  // ── Lava zones ─────────────────────────────────────────────────────────────
  /** Number of active lava zones. */
  lavaZoneCount: number;
  /** Left edge X of each lava zone (world units). */
  lavaZoneXWorld: Float32Array;
  /** Top edge Y of each lava zone (world units). */
  lavaZoneYWorld: Float32Array;
  /** Width of each lava zone (world units). */
  lavaZoneWWorld: Float32Array;
  /** Height of each lava zone (world units). */
  lavaZoneHWorld: Float32Array;
  /** Invulnerability cooldown ticks after lava damage. */
  lavaInvulnTicks: number;

  // ── Breakable blocks ───────────────────────────────────────────────────────
  /** Number of breakable blocks (active + broken). */
  breakableBlockCount: number;
  /** Center X of each breakable block (world units). */
  breakableBlockXWorld: Float32Array;
  /** Center Y of each breakable block (world units). */
  breakableBlockYWorld: Float32Array;
  /** 1 if block is still intact, 0 if broken. */
  isBreakableBlockActiveFlag: Uint8Array;
  /**
   * Wall index in the wall arrays that corresponds to each breakable block.
   * -1 if no corresponding wall (should not happen in practice).
   */
  breakableBlockWallIndex: Int8Array;

  // ── Dust boost jars ────────────────────────────────────────────────────────
  /** Number of dust boost jars (active + broken). */
  dustBoostJarCount: number;
  /** Center X of each dust boost jar (world units). */
  dustBoostJarXWorld: Float32Array;
  /** Center Y of each dust boost jar (world units). */
  dustBoostJarYWorld: Float32Array;
  /** 1 if jar is still intact, 0 if broken. */
  isDustBoostJarActiveFlag: Uint8Array;
  /** Particle kind granted by each jar. */
  dustBoostJarKind: Uint8Array;
  /** Particle count granted by each jar. */
  dustBoostJarDustCount: Uint8Array;

  // ── Firefly jars ───────────────────────────────────────────────────────────
  /** Number of firefly jars (active + broken). */
  fireflyJarCount: number;
  /** Center X of each firefly jar (world units). */
  fireflyJarXWorld: Float32Array;
  /** Center Y of each firefly jar (world units). */
  fireflyJarYWorld: Float32Array;
  /** 1 if jar is still intact, 0 if broken. */
  isFireflyJarActiveFlag: Uint8Array;

  // ── Fireflies ──────────────────────────────────────────────────────────────
  /** Number of active fireflies. */
  fireflyCount: number;
  /** X position of each firefly (world units). */
  fireflyXWorld: Float32Array;
  /** Y position of each firefly (world units). */
  fireflyYWorld: Float32Array;
  /** X velocity of each firefly (world units/s). */
  fireflyVelXWorld: Float32Array;
  /** Y velocity of each firefly (world units/s). */
  fireflyVelYWorld: Float32Array;

  /** 1 while the player cluster is inside a water zone this tick. */
  isPlayerInWaterFlag: 0 | 1;

  // ── Dust piles ────────────────────────────────────────────────────────────
  /** Number of dust piles loaded in the current room. */
  dustPileCount: number;
  /** Center X of each dust pile (world units). */
  dustPileXWorld: Float32Array;
  /** Center Y of each dust pile (world units). */
  dustPileYWorld: Float32Array;
  /** Particle count per dust pile. */
  dustPileDustCount: Uint8Array;
  /** 1 if the dust pile is still active (not yet fully claimed). */
  isDustPileActiveFlag: Uint8Array;

  // ── Grasshopper critters ───────────────────────────────────────────────────
  /** Number of alive grasshoppers in the current room. */
  grasshopperCount: number;
  /** X position (world units) of each grasshopper. */
  grasshopperXWorld: Float32Array;
  /** Y position (world units) of each grasshopper. */
  grasshopperYWorld: Float32Array;
  /** X velocity (world units/s). */
  grasshopperVelXWorld: Float32Array;
  /** Y velocity (world units/s). */
  grasshopperVelYWorld: Float32Array;
  /** Countdown ticks until next hop. */
  grasshopperHopTimerTicks: Float32Array;
  /** 1 if this grasshopper slot is alive. */
  isGrasshopperAliveFlag: Uint8Array;
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
    wallIsPlatformFlag: new Uint8Array(MAX_WALLS),
    wallPlatformEdge: new Uint8Array(MAX_WALLS),
    wallThemeIndex: new Uint8Array(MAX_WALLS),
    wallIsInvisibleFlag: new Uint8Array(MAX_WALLS),
    wallRampOrientationIndex: new Uint8Array(MAX_WALLS).fill(255),
    wallIsPillarHalfWidthFlag: new Uint8Array(MAX_WALLS),
    lastPlayerBlockedTick: -1,
    playerAttackTriggeredFlag: 0,
    playerAttackDirXWorld: 1.0,
    playerAttackDirYWorld: 0.0,
    isPlayerBlockingFlag: 0,
    playerBlockDirXWorld: 1.0,
    playerBlockDirYWorld: 0.0,
    // Weave combat state
    playerPrimaryWeaveId: 'storm',
    playerSecondaryWeaveId: 'shield',
    playerPrimaryWeaveTriggeredFlag: 0,
    playerSecondaryWeaveTriggeredFlag: 0,
    isPlayerPrimaryWeaveActiveFlag: 0,
    isPlayerSecondaryWeaveActiveFlag: 0,
    playerPrimaryWeaveEndFlag: 0,
    playerSecondaryWeaveEndFlag: 0,
    playerWeaveAimDirXWorld: 1.0,
    playerWeaveAimDirYWorld: 0.0,
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
    hasGrappleChargeFlag: 1,
    isGrappleTopSurfaceFlag: 0,
    isGrappleStuckFlag: 0,
    grappleStuckStoppedTickCount: 0,
    isGrappleMissActiveFlag: 0,
    isGrappleRetractingFlag: 0,
    grappleMissDirXWorld: 0.0,
    grappleMissDirYWorld: 0.0,
    grappleMissTickCount: 0,
    isPlayerSkiddingFlag: 0,
    skidDebrisXWorld: 0.0,
    skidDebrisYWorld: 0.0,
    wallJumpSkidDebrisBurstFlag: 0,
    // ── Environmental hazards ─────────────────────────────────────────
    spikeCount: 0,
    spikeXWorld: new Float32Array(MAX_SPIKES),
    spikeYWorld: new Float32Array(MAX_SPIKES),
    spikeDirection: new Uint8Array(MAX_SPIKES),
    spikeInvulnTicks: 0,
    springboardCount: 0,
    springboardXWorld: new Float32Array(MAX_SPRINGBOARDS),
    springboardYWorld: new Float32Array(MAX_SPRINGBOARDS),
    springboardAnimTicks: new Uint8Array(MAX_SPRINGBOARDS),
    waterZoneCount: 0,
    waterZoneXWorld: new Float32Array(MAX_WATER_ZONES),
    waterZoneYWorld: new Float32Array(MAX_WATER_ZONES),
    waterZoneWWorld: new Float32Array(MAX_WATER_ZONES),
    waterZoneHWorld: new Float32Array(MAX_WATER_ZONES),
    lavaZoneCount: 0,
    lavaZoneXWorld: new Float32Array(MAX_LAVA_ZONES),
    lavaZoneYWorld: new Float32Array(MAX_LAVA_ZONES),
    lavaZoneWWorld: new Float32Array(MAX_LAVA_ZONES),
    lavaZoneHWorld: new Float32Array(MAX_LAVA_ZONES),
    lavaInvulnTicks: 0,
    breakableBlockCount: 0,
    breakableBlockXWorld: new Float32Array(MAX_BREAKABLE_BLOCKS),
    breakableBlockYWorld: new Float32Array(MAX_BREAKABLE_BLOCKS),
    isBreakableBlockActiveFlag: new Uint8Array(MAX_BREAKABLE_BLOCKS),
    breakableBlockWallIndex: new Int8Array(MAX_BREAKABLE_BLOCKS),
    dustBoostJarCount: 0,
    dustBoostJarXWorld: new Float32Array(MAX_DUST_BOOST_JARS),
    dustBoostJarYWorld: new Float32Array(MAX_DUST_BOOST_JARS),
    isDustBoostJarActiveFlag: new Uint8Array(MAX_DUST_BOOST_JARS),
    dustBoostJarKind: new Uint8Array(MAX_DUST_BOOST_JARS),
    dustBoostJarDustCount: new Uint8Array(MAX_DUST_BOOST_JARS),
    fireflyJarCount: 0,
    fireflyJarXWorld: new Float32Array(MAX_FIREFLY_JARS),
    fireflyJarYWorld: new Float32Array(MAX_FIREFLY_JARS),
    isFireflyJarActiveFlag: new Uint8Array(MAX_FIREFLY_JARS),
    fireflyCount: 0,
    fireflyXWorld: new Float32Array(MAX_FIREFLIES),
    fireflyYWorld: new Float32Array(MAX_FIREFLIES),
    fireflyVelXWorld: new Float32Array(MAX_FIREFLIES),
    fireflyVelYWorld: new Float32Array(MAX_FIREFLIES),
    isPlayerInWaterFlag: 0,
    // ── Dust piles ───────────────────────────────────────────────────
    dustPileCount: 0,
    dustPileXWorld: new Float32Array(MAX_DUST_PILES),
    dustPileYWorld: new Float32Array(MAX_DUST_PILES),
    dustPileDustCount: new Uint8Array(MAX_DUST_PILES),
    isDustPileActiveFlag: new Uint8Array(MAX_DUST_PILES),
    grasshopperCount: 0,
    grasshopperXWorld: new Float32Array(MAX_GRASSHOPPERS),
    grasshopperYWorld: new Float32Array(MAX_GRASSHOPPERS),
    grasshopperVelXWorld: new Float32Array(MAX_GRASSHOPPERS),
    grasshopperVelYWorld: new Float32Array(MAX_GRASSHOPPERS),
    grasshopperHopTimerTicks: new Float32Array(MAX_GRASSHOPPERS),
    isGrasshopperAliveFlag: new Uint8Array(MAX_GRASSHOPPERS),
    ...createParticleBuffers(),
  };
}

export { MAX_PARTICLES };
