import { ParticleBuffers, createParticleBuffers, MAX_PARTICLES } from './particles/state';
import { ClusterState } from './clusters/state';
import { RngState, createRng } from './rng';
import { GrappleWorldState, createGrappleWorldState } from './worldGrappleState';
import { HazardWorldState, createHazardWorldState } from './worldHazardState';

// Re-export constants from sub-state files so existing imports from world.ts still work.
export { MAX_GRAPPLE_WRAP_POINTS } from './worldGrappleState';
export {
  MAX_SPIKES, MAX_SPRINGBOARDS, MAX_WATER_ZONES, MAX_LAVA_ZONES,
  MAX_BREAKABLE_BLOCKS, MAX_CRUMBLE_BLOCKS, MAX_BOUNCE_PADS,
  MAX_DUST_BOOST_JARS, MAX_FIREFLY_JARS, MAX_FIREFLIES, FIREFLIES_PER_JAR,
  MAX_DUST_PILES, MAX_GRASSHOPPERS, GRASSHOPPER_INITIAL_TIMER_MAX_TICKS,
  MAX_SQUARE_STAMPEDE, SQUARE_STAMPEDE_TRAIL_COUNT, MAX_BEE_SWARMS, BEES_PER_SWARM,
} from './worldHazardState';

/** Maximum number of axis-aligned wall rectangles supported per world. */
export const MAX_WALLS = 2000;
/** Maximum number of ropes per room. */
export const MAX_ROPES = 16;
/** Maximum number of Verlet segments per rope (includes anchors). */
export const MAX_ROPE_SEGMENTS = 32;

/** Maximum number of logical mote slots (equals PARTICLE_COUNT_PER_CLUSTER). */
export const MAX_MOTE_SLOTS = 20;
/** Maximum simultaneous arrows in flight or stuck. */
export const MAX_ARROWS = 8;

export interface WorldState extends ParticleBuffers, GrappleWorldState, HazardWorldState {
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
  /**
   * 1 if the corresponding wall is a bounce pad.
   * The collision resolver reflects cluster velocity instead of zeroing it.
   */
  wallIsBouncePadFlag: Uint8Array;
  /**
   * Bounce pad speed-factor index for this wall:
   *   0 = 50 % restitution (dim glowing core)
   *   1 = 100 % restitution (bright glowing core)
   * Only meaningful when wallIsBouncePadFlag[wi] === 1.
   */
  wallBouncePadSpeedFactorIndex: Uint8Array;

  // ── Ropes ──────────────────────────────────────────────────────────────────
  /** Number of ropes in the current room. */
  ropeCount: number;
  /** Number of Verlet segments per rope (includes both anchors). */
  ropeSegmentCount: Uint8Array;
  /** World X of each rope's fixed top anchor. */
  ropeAnchorAXWorld: Float32Array;
  /** World Y of each rope's fixed top anchor. */
  ropeAnchorAYWorld: Float32Array;
  /** World X of each rope's bottom anchor. */
  ropeAnchorBXWorld: Float32Array;
  /** World Y of each rope's bottom anchor. */
  ropeAnchorBYWorld: Float32Array;
  /** 1 if each rope's bottom anchor is also fixed (both ends pinned). */
  ropeIsAnchorBFixedFlag: Uint8Array;
  /**
   * Destructibility index: 0=indestructible, 1=playerOnly, 2=any.
   */
  ropeDestructibilityIndex: Uint8Array;
  /**
   * Per-rope collision and visual half-thickness in world units.
   * Derived from thicknessIndex at load time: 0→4, 1→8, 2→12 world units.
   */
  ropeHalfThickWorld: Float32Array;
  /**
   * Verlet positions for each segment, laid flat as [rope0seg0, rope0seg1, ..., rope1seg0, ...].
   * Index = ropeIndex * MAX_ROPE_SEGMENTS + segIndex.
   */
  ropeSegPosXWorld: Float32Array;
  /** Y positions parallel to ropeSegPosXWorld. */
  ropeSegPosYWorld: Float32Array;
  /** Previous X positions for Verlet integration. */
  ropeSegPrevXWorld: Float32Array;
  /** Previous Y positions for Verlet integration. */
  ropeSegPrevYWorld: Float32Array;
  /** Rest length between adjacent segments (world units) — one value per rope. */
  ropeSegRestLenWorld: Float32Array;
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

  // ---- Skid debris visual flags (read by renderer) ------------------------
  /** 1 while the player is skidding and debris should be spawned. */
  isPlayerSkiddingFlag: 0 | 1;
  /** X position of the skid debris origin (bottom-front corner or player center on landing). */
  skidDebrisXWorld: number;
  /** Y position of the skid debris origin (bottom edge). */
  skidDebrisYWorld: number;
  /** 1 for a single tick to force a skid-debris burst from an initial wall jump. */
  wallJumpSkidDebrisBurstFlag: 0 | 1;
  /**
   * Scale factor for skid debris when landing from high horizontal speed.
   * 0 = normal skidding.  >0 = high-speed landing skid; proportional to how far
   * above the landing-skid threshold the horizontal speed is.
   * Renderer multiplies spawn rate, spread, and velocity variance by (1 + factor).
   * Set per tick in applyClusterMovement; read by skidDebrisRenderer.
   */
  playerLandingSkidSpeedFactor: number;

  // ── Arrow Weave loading state ──────────────────────────────────────────────
  /** 1 while the player is holding the arrow weave button and loading an arrow. */
  isArrowWeaveLoadingFlag: 0 | 1;
  /** World tick when loading began (-1 = not loading). */
  arrowWeaveLoadStartTick: number;
  /** Current loaded mote count (0, 2, 3, or 4). */
  arrowWeaveCurrentMoteCount: number;

  // ── Arrow Weave flight buffer (MAX_ARROWS slots) ───────────────────────────
  /** Number of allocated arrow slots (may include expired entries with lifetime ≤ 0). */
  arrowCount: number;
  /** Tip X position of each arrow (world units). */
  arrowXWorld: Float32Array;
  /** Tip Y position of each arrow (world units). */
  arrowYWorld: Float32Array;
  /** X velocity of each arrow (world units/s). */
  arrowVelXWorld: Float32Array;
  /** Y velocity of each arrow (world units/s). */
  arrowVelYWorld: Float32Array;
  /** Normalized X component of the arrow's travel direction. */
  arrowDirXWorld: Float32Array;
  /** Normalized Y component of the arrow's travel direction. */
  arrowDirYWorld: Float32Array;
  /** Number of motes in this arrow (2, 3, or 4). */
  arrowMoteCount: Uint8Array;
  /** 1 when the arrow is stuck in terrain; 0 while in flight. */
  isArrowStuckFlag: Uint8Array;
  /**
   * 1 when the arrow hit an enemy while in flight and is playing its hit
   * sequence.  The arrow is invisible in this state and removed when done.
   */
  isArrowHitEnemyFlag: Uint8Array;
  /** Countdown ticks until this arrow slot is freed (0 = expired). */
  arrowLifetimeTicksLeft: Float32Array;
  /** Number of motes remaining to hit in the current hit sequence. */
  arrowHitSequenceMotesLeft: Uint8Array;
  /** Ticks until the next mote in the hit sequence fires. */
  arrowHitSequenceDelayTicks: Float32Array;
  /** Index into world.clusters of the enemy currently being hit (-1 = none). */
  arrowHitTargetClusterIndex: Int32Array;
  /** Ticks before this stuck arrow can begin a new hit sequence (invulnerability). */
  arrowDamageCooldownTicks: Float32Array;

  // ── Shield Sword Weave state ───────────────────────────────────────────────
  /**
   * Current sword state machine value.  See sim/weaves/swordWeave.ts for the
   * SWORD_STATE_* constants.  Drives both behavior and rendering.
   */
  swordWeaveStateEnum: number;
  /** Ticks elapsed in the current sword state. */
  swordWeaveStateTicksElapsed: number;
  /** Current sword angle (radians) in world space, measured from the hand anchor. */
  swordWeaveAngleRad: number;
  /**
   * Index of the enemy cluster currently being targeted by the auto-swing,
   * or -1 if no target is locked.
   */
  swordWeaveTargetClusterIndex: number;
  /** Sword angle (radians) at the start of the current slash. */
  swordWeaveSlashStartAngleRad: number;
  /** Sword angle (radians) at the end of the current slash. */
  swordWeaveSlashEndAngleRad: number;
  /** World X of the sword's hand anchor, recomputed each tick the sword is active. */
  swordWeaveHandAnchorXWorld: number;
  /** World Y of the sword's hand anchor, recomputed each tick the sword is active. */
  swordWeaveHandAnchorYWorld: number;
  /**
   * Current sword length ratio in [0, 1].
   *
   * Computed each tick as `min(MAX_SWORD_BLADE_MOTES, availableMoteCount) / MAX_SWORD_BLADE_MOTES`.
   * 1.0 = full sword (enough motes for all blade segments).
   * 0.5 = half sword (half the blade segments present).
   * 0.0 = no sword (zero available motes — sword cannot attack).
   *
   * Propagated to WorldSnapshot for the renderer to scale the blade.
   */
  swordWeaveLengthRatio: number;

  // ── Ordered Mote Queue ─────────────────────────────────────────────────────
  /**
   * Number of active logical mote slots for the player.
   * 0 when the player has no dust containers or loadout configured.
   */
  moteSlotCount: number;
  /**
   * ParticleKind per slot (MAX_MOTE_SLOTS entries).
   * Reflects the dust kind of each mote at queue initialisation time.
   */
  moteSlotKind: Uint8Array;
  /**
   * State per slot: 0 = available, 1 = depleted (MAX_MOTE_SLOTS entries).
   * Use MOTE_STATE_AVAILABLE / MOTE_STATE_DEPLETED from orderedMoteQueue.ts.
   */
  moteSlotState: Uint8Array;
  /**
   * Ticks remaining on the depletion cooldown (MAX_MOTE_SLOTS entries).
   * 0 while the slot is available.
   */
  moteSlotCooldownTicksLeft: Uint16Array;
  /**
   * Index into the world particle buffer for each slot's linked particle.
   * -1 for unlinked slots (MAX_MOTE_SLOTS entries).
   */
  moteSlotParticleIndex: Int16Array;
  /**
   * Phase 13: ticks remaining on the mote-regeneration flash animation
   * (MAX_MOTE_SLOTS entries, Uint8 — max 255 ticks).
   * Set to MOTE_REGEN_FLASH_TICKS when a slot transitions DEPLETED → AVAILABLE.
   * Ticked down each tick; read by the HUD mote dot row for a brief white flash.
   */
  moteRegenFlashTicksLeft: Uint8Array;
  /**
   * Smoothed display radius (world units) for the grapple influence circle.
   * Lerps toward getEffectiveGrappleRangeWorld() each tick so the circle
   * grows and shrinks visually with a small lag.
   */
  moteGrappleDisplayRadiusWorld: number;

  // ── Phase 8: Storm / Inventory source flag ─────────────────────────────────
  /**
   * 1 when the player's primary weave is Storm (motes orbit passively).
   * 0 when Storm is not equipped (motes materialize from inventory space).
   *
   * Set once at loadout apply time (gameScreen.ts) and again whenever the
   * loadout changes.  Not recomputed every tick.
   *
   * Propagated to WorldSnapshot so renderers can choose the appropriate
   * mote-source visual style without importing sim helpers.
   */
  isMoteSourceOrbitFlag: 0 | 1;

  // ── Falling blocks ──────────────────────────────────────────────────────────
  /**
   * Runtime list of falling block groups for the current room.
   * Each group is a set of orthogonally-connected same-variant tiles that fall
   * together as a single rigid body when triggered.
   * Managed by fallingBlockSim.ts; populated by loadRoomFallingBlocks().
   */
  fallingBlockGroups: import('./fallingBlocks/fallingBlockTypes').FallingBlockGroup[];

  /**
   * Player's downward velocity from the END of the previous tick, before this
   * tick's collision resolution zeros it on landing.
   * Set at the start of tick() before applyClusterMovement runs.
   * Used by the tough falling block trigger to detect hard landings.
   */
  playerPrevVelocityYWorld: number;
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
    wallIsBouncePadFlag: new Uint8Array(MAX_WALLS),
    wallBouncePadSpeedFactorIndex: new Uint8Array(MAX_WALLS),
    ropeCount: 0,
    ropeSegmentCount:       new Uint8Array(MAX_ROPES),
    ropeAnchorAXWorld:      new Float32Array(MAX_ROPES),
    ropeAnchorAYWorld:      new Float32Array(MAX_ROPES),
    ropeAnchorBXWorld:      new Float32Array(MAX_ROPES),
    ropeAnchorBYWorld:      new Float32Array(MAX_ROPES),
    ropeIsAnchorBFixedFlag: new Uint8Array(MAX_ROPES),
    ropeDestructibilityIndex: new Uint8Array(MAX_ROPES),
    ropeHalfThickWorld:     new Float32Array(MAX_ROPES),
    ropeSegPosXWorld:       new Float32Array(MAX_ROPES * MAX_ROPE_SEGMENTS),
    ropeSegPosYWorld:       new Float32Array(MAX_ROPES * MAX_ROPE_SEGMENTS),
    ropeSegPrevXWorld:      new Float32Array(MAX_ROPES * MAX_ROPE_SEGMENTS),
    ropeSegPrevYWorld:      new Float32Array(MAX_ROPES * MAX_ROPE_SEGMENTS),
    ropeSegRestLenWorld:    new Float32Array(MAX_ROPES),
    lastPlayerBlockedTick: -1,
    playerAttackTriggeredFlag: 0,
    playerAttackDirXWorld: 1.0,
    playerAttackDirYWorld: 0.0,
    isPlayerBlockingFlag: 0,
    playerBlockDirXWorld: 1.0,
    playerBlockDirYWorld: 0.0,
    // Weave combat state
    playerPrimaryWeaveId: 'storm',
    playerSecondaryWeaveId: 'shield_sword',
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
    isPlayerSkiddingFlag: 0,
    skidDebrisXWorld: 0.0,
    skidDebrisYWorld: 0.0,
    wallJumpSkidDebrisBurstFlag: 0,
    playerLandingSkidSpeedFactor: 0.0,
    // ── Arrow Weave ───────────────────────────────────────────────────
    isArrowWeaveLoadingFlag:       0,
    arrowWeaveLoadStartTick:       -1,
    arrowWeaveCurrentMoteCount:    0,
    arrowCount:                    0,
    arrowXWorld:                   new Float32Array(MAX_ARROWS),
    arrowYWorld:                   new Float32Array(MAX_ARROWS),
    arrowVelXWorld:                new Float32Array(MAX_ARROWS),
    arrowVelYWorld:                new Float32Array(MAX_ARROWS),
    arrowDirXWorld:                new Float32Array(MAX_ARROWS),
    arrowDirYWorld:                new Float32Array(MAX_ARROWS),
    arrowMoteCount:                new Uint8Array(MAX_ARROWS),
    isArrowStuckFlag:              new Uint8Array(MAX_ARROWS),
    isArrowHitEnemyFlag:           new Uint8Array(MAX_ARROWS),
    arrowLifetimeTicksLeft:        new Float32Array(MAX_ARROWS),
    arrowHitSequenceMotesLeft:     new Uint8Array(MAX_ARROWS),
    arrowHitSequenceDelayTicks:    new Float32Array(MAX_ARROWS),
    arrowHitTargetClusterIndex:    new Int32Array(MAX_ARROWS).fill(-1),
    arrowDamageCooldownTicks:      new Float32Array(MAX_ARROWS),
    // ── Shield Sword Weave ────────────────────────────────────────────
    swordWeaveStateEnum:           0,
    swordWeaveStateTicksElapsed:   0,
    swordWeaveAngleRad:            0,
    swordWeaveTargetClusterIndex:  -1,
    swordWeaveSlashStartAngleRad:  0,
    swordWeaveSlashEndAngleRad:    0,
    swordWeaveHandAnchorXWorld:    0,
    swordWeaveHandAnchorYWorld:    0,
    swordWeaveLengthRatio:         1.0,
    // ── Ordered Mote Queue ────────────────────────────────────────────
    moteSlotCount:              0,
    moteSlotKind:               new Uint8Array(MAX_MOTE_SLOTS),
    moteSlotState:              new Uint8Array(MAX_MOTE_SLOTS),
    moteSlotCooldownTicksLeft:  new Uint16Array(MAX_MOTE_SLOTS),
    moteSlotParticleIndex:      new Int16Array(MAX_MOTE_SLOTS).fill(-1),
    moteRegenFlashTicksLeft:    new Uint8Array(MAX_MOTE_SLOTS),
    // Default to full grapple range (96 world units = INFLUENCE_RADIUS_WORLD).
    // initMoteQueueFromParticles() will correct this on the first room load.
    moteGrappleDisplayRadiusWorld: 96.0,
    // Default: Storm Weave is the starting primary, so motes orbit from the start.
    isMoteSourceOrbitFlag:         1,
    // ── Falling blocks ────────────────────────────────────────────────────
    fallingBlockGroups:            [],
    playerPrevVelocityYWorld:      0,
    ...createGrappleWorldState(),
    ...createHazardWorldState(),
    ...createParticleBuffers(),
  };
}

export { MAX_PARTICLES };
