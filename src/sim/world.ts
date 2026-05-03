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
/** Maximum number of crumble blocks per room. */
export const MAX_CRUMBLE_BLOCKS = 32;
/** Maximum number of bounce pads per room. */
export const MAX_BOUNCE_PADS = 64;
/** Maximum number of ropes per room. */
export const MAX_ROPES = 16;
/** Maximum number of Verlet segments per rope (includes anchors). */
export const MAX_ROPE_SEGMENTS = 32;
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

/** Maximum number of square-stampede enemies per room. */
export const MAX_SQUARE_STAMPEDE = 8;
/**
 * Number of trail ring-buffer slots per square-stampede enemy.
 * Each slot stores one past position; 19 slots → 19 ghost trail copies.
 */
export const SQUARE_STAMPEDE_TRAIL_COUNT = 19;

/** Maximum number of bee-swarm enemies per room. */
export const MAX_BEE_SWARMS = 4;
/** Number of bees in a single bee-swarm cluster. */
export const BEES_PER_SWARM = 10;

/** Maximum number of logical mote slots (equals PARTICLE_COUNT_PER_CLUSTER). */
export const MAX_MOTE_SLOTS = 20;
/** Maximum simultaneous arrows in flight or stuck. */
export const MAX_ARROWS = 8;

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

  // ── Bounce pads ────────────────────────────────────────────────────────────
  /** Number of bounce pads loaded in the current room. */
  bouncePadCount: number;
  /** Left edge X of each bounce pad (world units). */
  bouncePadXWorld: Float32Array;
  /** Top edge Y of each bounce pad (world units). */
  bouncePadYWorld: Float32Array;
  /** Width of each bounce pad (world units). */
  bouncePadWWorld: Float32Array;
  /** Height of each bounce pad (world units). */
  bouncePadHWorld: Float32Array;
  /** Speed-factor index: 0=50%, 1=100%. */
  bouncePadSpeedFactorIndex: Uint8Array;
  /** Ramp orientation: 255=not a ramp, 0-3=ramp. */
  bouncePadRampOrientationIndex: Uint8Array;

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
   * Index of the room rope the player's grapple is currently attached to.
   * -1 when the grapple is not attached to a rope.
   */
  grappleRopeIndex: number;
  /**
   * Float segment index (e.g. 2.7 = 70 % between segment 2 and segment 3) along
   * the attached rope.  Only meaningful when grappleRopeIndex >= 0.
   */
  grappleRopeAttachSegF: number;

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

  // ---- Grapple zip mechanics -----------------------------------------------
  /**
   * 1 when the player has activated a zip (double-tap down while grappled).
   * The player zips quickly toward the anchor; upon arrival momentum stops.
   * Works on any surface (floor, wall, ceiling); activated by double-tap down.
   */
  isGrappleZipActiveFlag: 0 | 1;
  /** 1 when the player has arrived at the zip target and is sticking. */
  isGrappleStuckFlag: 0 | 1;
  /**
   * Ticks since the player came to a complete stop while grapple-stuck.
   * Used for zip-jump detection: if the player jumps within GRAPPLE_ZIP_JUMP_WINDOW_TICKS
   * of stopping they receive a high-velocity zip-jump in the surface normal direction.
   * 0 while still decelerating.
   */
  grappleStuckStoppedTickCount: number;
  /**
   * Normalized X component of the surface normal at the zip target (direction from
   * anchor toward the player's arrival position).  Set when zip is activated.
   * Used to determine zip-jump direction and arrival target position.
   */
  grappleZipNormalXWorld: number;
  /**
   * Normalized Y component of the surface normal at the zip target.
   * Positive Y = pointing downward (ceiling zip), negative Y = pointing upward (floor zip).
   */
  grappleZipNormalYWorld: number;

  // ---- Down double-tap tracking (for zip activation) -----------------------
  /**
   * Set to 1 for one tick when the down key (S / ArrowDown) is first pressed.
   * Preserved across tick() while grapple is active, like playerJumpTriggeredFlag.
   * Consumed by applyGrappleClusterConstraint for double-tap zip detection.
   */
  playerDownTriggeredFlag: 0 | 1;
  /**
   * World tick number on which the down key was last pressed.
   * Used to detect a double-tap: two presses within GRAPPLE_ZIP_DOUBLE_TAP_WINDOW_TICKS.
   * 0 before any down press.
   */
  playerDownLastPressTick: number;

  // ---- Grapple proximity bounce sprite state --------------------------------
  /**
   * Ticks remaining in the post-proximity-bounce sprite window.
   * While > 0 the player renders the jumping sprite rotated toward the
   * wall/ceiling they bounced off.  Counts down each tick; 0 = inactive.
   */
  grappleProximityBounceTicksLeft: number;
  /**
   * Canvas rotation angle (radians) to apply to the jumping sprite during the
   * proximity bounce sprite window.  0 = no rotation (floor bounce, unused),
   * -π/2 = left-wall bounce, +π/2 = right-wall bounce, π = ceiling bounce.
   */
  grappleProximityBounceRotationAngleRad: number;

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

  // ── Crumble blocks ─────────────────────────────────────────────────────────
  /** Number of crumble blocks (active + broken). */
  crumbleBlockCount: number;
  /** Center X of each crumble block (world units). */
  crumbleBlockXWorld: Float32Array;
  /** Center Y of each crumble block (world units). */
  crumbleBlockYWorld: Float32Array;
  /** 1 if block is still intact, 0 if broken. */
  isCrumbleBlockActiveFlag: Uint8Array;
  /**
   * Hits remaining: 2 = undamaged, 1 = cracked, 0 = destroyed.
   * Starts at 2; any dust particle contact decrements it once per cooldown.
   */
  crumbleBlockHitsRemaining: Uint8Array;
  /**
   * Ticks until this block can be hit again (debounce / hit cooldown).
   * 0 = can be hit now; set to CRUMBLE_HIT_COOLDOWN_TICKS on hit.
   */
  crumbleBlockHitCooldownTicks: Uint8Array;
  /**
   * Wall index in the wall arrays that corresponds to each crumble block.
   * -1 if no corresponding wall.
   */
  crumbleBlockWallIndex: Int8Array;
  /**
   * Packed elemental variant index for each crumble block.
   * Maps to CrumbleVariant: 0=normal, 1=fire, 2=water, 3=void, 4=ice, 5=lightning, 6=poison, 7=shadow, 8=nature.
   */
  crumbleBlockVariant: Uint8Array;

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

  // ── Square Stampede trail ring buffers ─────────────────────────────────────
  /**
   * X positions of trail ring buffer, flattened as [slot * stride + head].
   * Length = MAX_SQUARE_STAMPEDE * SQUARE_STAMPEDE_TRAIL_COUNT.
   */
  squareStampedeTrailXWorld: Float32Array;
  /** Y positions of trail ring buffer. Same layout as squareStampedeTrailXWorld. */
  squareStampedeTrailYWorld: Float32Array;
  /** Write-head index (0..stride-1) per slot. */
  squareStampedeTrailHead: Uint8Array;
  /** Number of valid entries filled so far (0..stride) per slot. */
  squareStampedeTrailCount: Uint8Array;
  /** Number of entries per slot (= SQUARE_STAMPEDE_TRAIL_COUNT). Read-only after init. */
  squareStampedeTrailStride: number;

  // ── Bee-swarm individual bee position buffers ────────────────────────────────
  /**
   * X position of each bee (world units).
   * Layout: [swarmSlot * BEES_PER_SWARM + beeIndex].
   * Total length = MAX_BEE_SWARMS * BEES_PER_SWARM.
   */
  beeSwarmBeeXWorld: Float32Array;
  /** Y position of each bee (world units). Same layout as beeSwarmBeeXWorld. */
  beeSwarmBeeYWorld: Float32Array;
  /** X velocity of each bee (world units/s). Same layout as beeSwarmBeeXWorld. */
  beeSwarmBeeVelXWorld: Float32Array;
  /** Y velocity of each bee (world units/s). Same layout as beeSwarmBeeXWorld. */
  beeSwarmBeeVelYWorld: Float32Array;
  /**
   * Per-bee Lissajous phase offset (radians).
   * Assigned at spawn time to spread bees around the orbit ring.
   */
  beeSwarmBeePhaseRad: Float32Array;

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

  // ── Phase 9: Grapple out-of-range tension ──────────────────────────────────
  /**
   * Number of consecutive ticks the attached grapple rope has exceeded the
   * current effective grapple range.  0 while the rope length is within range.
   *
   * When this reaches `GRAPPLE_OUT_OF_RANGE_BREAK_TICKS` (45) the grapple
   * breaks automatically.  Reset to 0 in `releaseGrapple`.
   */
  grappleOutOfRangeTicks: number;
  /**
   * Visual tension factor in [0, 1].
   *
   * 0 = rope within range (no tension).
   * Ramps from 0 → 1 as grappleOutOfRangeTicks approaches the break threshold.
   * 1 = rope breaks next tick.
   *
   * Used by the influence circle renderer to pulse/flicker the ring as a
   * "rope under tension" warning.  Reset to 0 in `releaseGrapple`.
   */
  grappleTensionFactor: number;

  // ── Phase 10: Grapple surface-anchor state ─────────────────────────────────
  /**
   * Outward surface normal at the current grapple anchor (unit axis vector).
   *
   * Set when the grapple attaches to a wall face via `fireGrapple`. Points
   * away from the wall toward the player at the moment of attachment.
   *
   * 0,0 when not attached to a wall (rope grapple or not active).
   *
   * Used by debug rendering and surface-aware validation: the anchor is a
   * surface-contact point; validate it by checking the referenced wall still
   * exists, NOT by testing whether the point is inside solid geometry.
   */
  grappleAnchorNormalXWorld: number;
  grappleAnchorNormalYWorld: number;

  // ── Debug: grapple collision visualization ──────────────────────────────────
  /**
   * Stores the last grapple sweep segment (from/to) and raw hit point so the
   * debug overlay can visualise the continuous collision detection path.
   * Written by fireGrapple; reset each fire.
   * These fields are only consumed by the renderer and have no physics effect.
   */
  grappleDebugSweepFromXWorld: number;
  grappleDebugSweepFromYWorld: number;
  grappleDebugSweepToXWorld:   number;
  grappleDebugSweepToYWorld:   number;
  /** Raw raycast hit point before the surface-epsilon offset is applied. */
  grappleDebugRawHitXWorld: number;
  grappleDebugRawHitYWorld: number;
  /**
   * 1 for one frame after a grapple fire so the renderer knows the debug data
   * is fresh.  Not ticked down; cleared lazily when grapple releases.
   */
  isGrappleDebugActiveFlag: 0 | 1;

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
    bouncePadCount: 0,
    bouncePadXWorld: new Float32Array(MAX_BOUNCE_PADS),
    bouncePadYWorld: new Float32Array(MAX_BOUNCE_PADS),
    bouncePadWWorld: new Float32Array(MAX_BOUNCE_PADS),
    bouncePadHWorld: new Float32Array(MAX_BOUNCE_PADS),
    bouncePadSpeedFactorIndex: new Uint8Array(MAX_BOUNCE_PADS),
    bouncePadRampOrientationIndex: new Uint8Array(MAX_BOUNCE_PADS).fill(255),
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
    grappleRopeIndex:       -1,
    grappleRopeAttachSegF:  0.0,
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
    isGrappleZipActiveFlag: 0,
    isGrappleStuckFlag: 0,
    grappleStuckStoppedTickCount: 0,
    grappleZipNormalXWorld: 0.0,
    grappleZipNormalYWorld: -1.0,
    playerDownTriggeredFlag: 0,
    playerDownLastPressTick: 0,
    grappleProximityBounceTicksLeft: 0,
    grappleProximityBounceRotationAngleRad: 0,
    isGrappleMissActiveFlag: 0,
    isGrappleRetractingFlag: 0,
    grappleMissDirXWorld: 0.0,
    grappleMissDirYWorld: 0.0,
    grappleMissTickCount: 0,
    isPlayerSkiddingFlag: 0,
    skidDebrisXWorld: 0.0,
    skidDebrisYWorld: 0.0,
    wallJumpSkidDebrisBurstFlag: 0,
    playerLandingSkidSpeedFactor: 0.0,
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
    crumbleBlockCount: 0,
    crumbleBlockXWorld: new Float32Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockYWorld: new Float32Array(MAX_CRUMBLE_BLOCKS),
    isCrumbleBlockActiveFlag: new Uint8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockHitsRemaining: new Uint8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockHitCooldownTicks: new Uint8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockWallIndex: new Int8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockVariant: new Uint8Array(MAX_CRUMBLE_BLOCKS),
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
    // ── Square Stampede trail ─────────────────────────────────────────
    squareStampedeTrailStride: SQUARE_STAMPEDE_TRAIL_COUNT,
    squareStampedeTrailXWorld: new Float32Array(MAX_SQUARE_STAMPEDE * SQUARE_STAMPEDE_TRAIL_COUNT),
    squareStampedeTrailYWorld: new Float32Array(MAX_SQUARE_STAMPEDE * SQUARE_STAMPEDE_TRAIL_COUNT),
    squareStampedeTrailHead: new Uint8Array(MAX_SQUARE_STAMPEDE),
    squareStampedeTrailCount: new Uint8Array(MAX_SQUARE_STAMPEDE),
    // ── Bee-swarm bee position buffers ────────────────────────────────
    beeSwarmBeeXWorld:    new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeeYWorld:    new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeeVelXWorld: new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeeVelYWorld: new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeePhaseRad:  new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
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
    // Phase 9: grapple tension initialised clear.
    grappleOutOfRangeTicks:        0,
    grappleTensionFactor:          0,
    // Phase 10: grapple surface-anchor normal and debug state initialised clear.
    grappleAnchorNormalXWorld:     0.0,
    grappleAnchorNormalYWorld:     0.0,
    grappleDebugSweepFromXWorld:   0.0,
    grappleDebugSweepFromYWorld:   0.0,
    grappleDebugSweepToXWorld:     0.0,
    grappleDebugSweepToYWorld:     0.0,
    grappleDebugRawHitXWorld:      0.0,
    grappleDebugRawHitYWorld:      0.0,
    isGrappleDebugActiveFlag:      0,
    // ── Falling blocks ────────────────────────────────────────────────────
    fallingBlockGroups:            [],
    playerPrevVelocityYWorld:      0,
    ...createParticleBuffers(),
  };
}

export { MAX_PARTICLES };
