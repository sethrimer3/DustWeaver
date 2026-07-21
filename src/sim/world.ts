import { ParticleBuffers, createParticleBuffers, MAX_PARTICLES } from './particles/state';
import { ClusterState } from './clusters/state';
import { RngState, createRng } from './rng';
import { GrappleWorldState, createGrappleWorldState } from './worldGrappleState';
import { HazardWorldState, createHazardWorldState, MAX_WATER_ZONES } from './worldHazardState';
import { type CombatMode, DEFAULT_COMBAT_MODE } from './combatMode';
import { PixelMaterialSystem } from './pixelMaterials/pixelMaterialSystem';
import { NATIVE_WIDTH_PX, NATIVE_HEIGHT_PX } from './pixelMaterials/pixelMaterialTypes';
import { createChallengeModeState, type ChallengeModeState } from './challengeMode';
import type { RuntimeGate } from './gates/gateState';
import { createShieldWeaveState, type ShieldWeaveState } from './stormweave/shieldWeave';
import { createSecondaryWeaveGestureState, type SecondaryWeaveGestureState } from '../input/secondaryWeaveGesture';

// Re-export constants from sub-state files so existing imports from world.ts still work.
export { MAX_GRAPPLE_WRAP_POINTS } from './worldGrappleState';
export {
  MAX_SPIKES, MAX_SPRINGBOARDS, MAX_WATER_ZONES, MAX_LAVA_ZONES,
  MAX_BREAKABLE_BLOCKS, MAX_BREAK_EVENTS, MAX_CONTACT_DAMAGE_BLOCKS, MAX_CRUMBLE_BLOCKS, MAX_BOUNCE_PADS,
  MAX_DUST_BOOST_JARS, MAX_FIREFLY_JARS, MAX_FIREFLIES, FIREFLIES_PER_JAR,
  MAX_DUST_PILES, MAX_GRASSHOPPERS, GRASSHOPPER_INITIAL_TIMER_MAX_TICKS,
  MAX_SQUARE_STAMPEDE, SQUARE_STAMPEDE_TRAIL_COUNT, MAX_SLIME_SNAILS, SLIME_SNAIL_TRAIL_COUNT, MAX_BEE_SWARMS, BEES_PER_SWARM,
  MAX_DUST_CONSTELLATIONS, MAX_MOTES_PER_CONSTELLATION,
  MAX_ORBITAL_DUST_CORES, MAX_RINGS_PER_ODC, MAX_MOTES_PER_RING_ODC, MOTES_PER_ODC_SLOT,
  MAX_DUST_BLOCK_MIMICS, MAX_MOTES_PER_DBM,
  MAX_DUST_WEAVER_ARCHITECTS, MAX_MOTES_PER_DWA, MAX_ARCHITECT_BLOCKS, MAX_NAILS_PER_DWA,
  MAX_VOID_SINGULARITIES, MAX_MOTES_PER_VS, MAX_PROJS_PER_VSP,
  MAX_DUST_LEECHES, MAX_DUST_ECHOES, MAX_MOTES_PER_DL, MAX_MOTES_PER_DE,
  MAX_CW_FIRE_DUST, MAX_CW_PROJECTILES, MAX_CW_SMOKE, MAX_CW_TELEGRAPHS,
  MAX_PHANTASMAL_BLOCKS, MAX_PHANTASMAL_SHOCKWAVES, MAX_PHANTASMAL_SPIKES,
  MAX_VOID_LASERS, MAX_VOID_LASER_DUST,
  MAX_ICE_SPIKES,
  MAX_KINETIC_BLOCKS, MAX_GRAPPLE_CARRY_BLOCKS, MAX_PHANTASMAL_TILES,
  MAX_CUSTOM_BLOCK_WIND_VENTS,
} from './worldHazardState';

/** Maximum number of axis-aligned wall rectangles supported per world. */
export const MAX_WALLS = 6000;
/** Maximum number of cracked-block shatter events recorded in a single tick. */
export const MAX_SHATTER_EVENTS = 16;
/** Maximum number of simultaneously fading web strands. */
export const MAX_FADING_WEBS = 24;
/** Maximum number of ropes per room. */
export const MAX_ROPES = 16;
/** Maximum number of Verlet segments per rope (includes anchors). */
export const MAX_ROPE_SEGMENTS = 32;

/** Maximum number of logical mote slots (equals PARTICLE_COUNT_PER_CLUSTER). */
export const MAX_MOTE_SLOTS = 20;
/** Fixed trail-sample history capacity per mote slot for the dust-switch trail effect. */
export const DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT = 6;
/** Maximum simultaneous arrows in flight or stuck (legacy WEAVE_ARROW path). */
export const MAX_ARROWS = 8;

/** Maximum real motes that sweep the Sword Weave crescent slash. */
export const MAX_SWORD_SLASH_MOTES = 8;

/** Maximum real motes assembled into a single Bow Weave arrow (center + 4). */
export const MAX_BOW_ARROW_MOTES = 5;
/** Minimum real motes for a valid Bow Weave arrow (center + 2). */
export const MIN_BOW_ARROW_MOTES = 3;

/** Number of positions stored in the momentum trail circular buffer. */
export const MOMENTUM_TRAIL_MAX_POINTS = 8;

export interface WorldState extends ParticleBuffers, GrappleWorldState, HazardWorldState {
  /** Directional Shield Weave collision state, derived from canonical player life. */
  shieldWeave: ShieldWeaveState;
  /**
   * Physical-gesture state of the secondary action button (RMB / equivalent),
   * shared by Sword/Shield/Bow Weaves. Owns press/hold/release detection and
   * aim capture only — see src/input/secondaryWeaveGesture.ts. Updated once
   * per rendered frame by gameCommandProcessor.ts, before the sim tick runs
   * applyPlayerWeaveCombat(). Not yet consumed by weaveCombat.ts (stage 3).
   */
  secondaryWeaveGesture: SecondaryWeaveGestureState;
  secondaryWeaveHandledCancellationId: number;
  /** Temporary, instance-local state for the currently loaded room's challenge elements. */
  challengeMode: ChallengeModeState;
  gates: RuntimeGate[];
  /** Active combat mode. 'momentum' = speed-based; 'legacy' = dust/weave. */
  combatMode: CombatMode;

  /**
   * Identity tag: the `RoomDef.id` this world's static geometry (walls,
   * bgWallGrid, hazards) was built for.  Set whenever a room's world is
   * built/loaded (main load path and resident builds) and checked before a
   * resident hot-swap so a world built for one room can never be activated
   * under another room's id.  Empty string = not yet tagged.
   *
   * This is a defensive integrity check, not gameplay state — a mismatch
   * indicates a caching / build-scheduling bug (see the resident hot-swap in
   * gameScreen.ts) and triggers a safe full-reload fallback.
   */
  builtForRoomId: string;

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
  /** Per-wall sound hardness index: 0=soft, 1=normal, 2=hard. */
  wallSoundHardnessIndex: Uint8Array;
  /** 1 if the corresponding wall is invisible (collision-only boundary, not rendered). */
  wallIsInvisibleFlag: Uint8Array;
  /**
   * Shape orientation index, shared by ramps and stairs:
   *   0-3 = legacy ramp   — 0=rises right(/), 1=rises left(\), 2=ceiling(⌐), 3=ceiling(¬)
   *   4-7 = stairs        — same four orientations, offset by 4
   *   255 = plain rectangular wall (treat as full AABB)
   *
   * Discriminate with `isRampOrientationIndex` / `isStairsOrientationIndex` /
   * `isPlainRectOrientationIndex` from `levels/stairsGeometry.ts`. A bare
   * `!== 255` test means "this wall is not a plain rectangle" and is correct
   * only where both shapes should be excluded.
   *
   * The name is retained (rather than renamed to `wallShapeOrientationIndex`)
   * because it is mirrored verbatim into serialized baked wall templates.
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

  /**
   * 1 if the corresponding wall uses the 'ice' block theme.
   * Set at room load time from wallThemeIndex; used by the collision resolver
   * to flag ice landings and by the grapple system to reject attachment.
   */
  wallIsIceFlag: Uint8Array;

  /**
   * 1 if the corresponding wall uses the 'ultraIceBlock' theme.
   * Ultra ice locks the player's lateral velocity on contact and prevents
   * grapple recharge from ground landings.  Grapple attachment is also rejected
   * (same bounce behaviour as regular ice).
   */
  wallIsUltraIceFlag: Uint8Array;

  /**
   * 1 if the corresponding wall uses the 'rocketBlock' theme.
   * Jumping off a rocket block grants the player uncapped horizontal air
   * acceleration (Movement V2 rocket boost) until they next land.
   */
  wallIsRocketBlockFlag: Uint8Array;

  /**
   * 1 if the corresponding wall is a kinetic block (gives the player a
   * directional velocity boost on contact, rather than reflecting like a
   * bounce pad).
   */
  wallIsKineticBlockFlag: Uint8Array;
  /**
   * Index into the kinetic block arrays in HazardWorldState for this wall.
   * -1 if this wall is not a kinetic block.
   */
  wallKineticBlockIndex: Int16Array;
  /**
   * Index into the crumble block arrays in HazardWorldState for this wall.
   * -1 if this wall is not a crumble ("cracked") block. Used by the collision
   * resolver to detect momentum-speed impacts and trigger an instant shatter.
   */
  wallCrumbleBlockIndex: Int16Array;

  // ---- Cracked-block shatter events (visual-only, drained each tick) -----
  /** Number of shatter events recorded this tick. Reset to 0 at the start of applyHazards. */
  shatterEventCount: number;
  /** World-space center X of the destroyed block's footprint. */
  shatterEventXWorld: Float32Array;
  /** World-space center Y of the destroyed block's footprint. */
  shatterEventYWorld: Float32Array;
  /** World-space footprint width. */
  shatterEventWWorld: Float32Array;
  /** World-space footprint height. */
  shatterEventHWorld: Float32Array;
  /** World-space X of the point of impact (player position at moment of shatter). */
  shatterEventImpactXWorld: Float32Array;
  /** World-space Y of the point of impact. */
  shatterEventImpactYWorld: Float32Array;
  /** Impacted surface normal X (-1, 0, or 1) — burst is biased away from this. */
  shatterEventNormalX: Float32Array;
  /** Impacted surface normal Y (-1, 0, or 1). */
  shatterEventNormalY: Float32Array;
  /** Crumble block theme index at time of destruction (see wallThemeIndex). */
  shatterEventThemeIndex: Uint8Array;
  /** Crumble block variant index at time of destruction (see crumbleBlockVariant). */
  shatterEventVariantIndex: Uint8Array;
  /** Player horizontal speed (world units/sec) at the moment of shatter — used to scale particle energy/count. */
  shatterEventSpeedWorld: Float32Array;

  /** Width of background wall grid (in block units). */
  bgWallGridWidth: number;
  /** Height of background wall grid (in block units). */
  bgWallGridHeight: number;
  /** Background wall occupancy grid: 1 = has background wall at this block position. */
  bgWallGrid: Uint8Array;

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
  /** 1 when progression has authorized the equipped secondary weave. */
  canUsePlayerSecondaryWeaveFlag: 0 | 1;
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
  /**
   * Signed horizontal velocity (world units/s) latched when the player's
   * current direction-reversal skid began. Set per tick in
   * applyClusterMovement while isPlayerSkiddingFlag is due to a normal skid
   * (not a high-speed landing skid); read by skidDebrisRenderer to derive
   * speed-scaled particle spawn rate, velocity, and spread. Deliberately
   * distinct from playerLandingSkidSpeedFactor, which drives the separate
   * high-speed-landing debris effect.
   */
  playerSkidEntryVelocityXWorld: number;

  // ---- Weak wall jump cascade visual flags (read by renderer) ---------------
  /**
   * 1 for a single tick when a cascade of heavy debris particles should be spawned
   * from the wall the player just jumped off.  Only set on the 3rd+ consecutive
   * wall jump (wallJumpCountSinceReset > 2); reset at the start of each
   * applyClusterMovement call.
   */
  weakWallJumpCascadeFlag: 0 | 1;
  /** World-space X of the wall contact point for the cascade spawn origin. */
  weakWallJumpCascadeXWorld: number;
  /** World-space Y of the wall contact point for the cascade spawn origin. */
  weakWallJumpCascadeYWorld: number;
  /**
   * +1 if the wall was to the right of the player (right wall jump), –1 if to
   * the left (left wall jump).  Used by the renderer to orient the debris burst.
   */
  weakWallJumpCascadeWallSideX: number;

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

  // ── Stage 3: independent Sword/Shield/Bow Weave unlock flags ───────────────
  // Set from PlayerProgress.unlockedActiveWeaves at room activation (see
  // gameLoadRoomPhases.ts applyPlayerWeaveWorldFields). These are independent
  // of `playerSecondaryWeaveId` (the legacy single-slot equip choice) — any
  // combination may be true simultaneously.
  hasSwordWeaveUnlockedFlag: 0 | 1;
  hasShieldWeaveUnlockedFlag: 0 | 1;
  hasBowWeaveUnlockedFlag: 0 | 1;

  // ── Independent Sword Weave (Stage 3) — press-driven single crescent swipe ─
  // See sim/weaves/secondaryWeaveCoordinator.ts and sim/weaves/swordWeave.ts.
  /** 1 while a swipe (from press through recovery) is in progress. */
  newSwordActiveFlag: 0 | 1;
  /** Gesture id (from secondaryWeaveGesture) this swipe belongs to; -1 = none. */
  newSwordGestureId: number;
  /** Ticks elapsed since the swipe started. */
  newSwordTicksElapsed: number;
  /** Press-time aim angle (radians); fixed for the whole swipe — no retarget. */
  newSwordAimAngleRad: number;
  /** Current sweep angle this tick (radians), interpolated across the swipe. */
  newSwordCurrentAngleRad: number;
  newSwordHandAnchorXWorld: number;
  newSwordHandAnchorYWorld: number;
  /** Reach (world units) computed from available motes at swipe start. */
  newSwordReachWorld: number;
  /**
   * 0..1 sub-phase progress exposed for Stage 5 rendering to interpolate the
   * sword→shield visual handoff. 0 = pure sword, 1 = fully handed off to
   * shield ownership of the same motes (sim only exposes discrete state; the
   * smooth interpolation itself belongs to the renderer).
   */
  newSwordToShieldTransition01: number;
  /** Rear staging angle (radians) the crescent sweep starts behind the aim. */
  newSwordStartAngleRad: number;
  /** Front terminating angle (radians) the crescent sweep ends in front of the aim. */
  newSwordEndAngleRad: number;
  /** Number of actual motes participating in the crescent slash (0..MAX_SWORD_SLASH_MOTES). */
  newSwordMoteCount: number;
  /** Participating particle indices, ordered leading→trailing along the blade. */
  newSwordMoteParticleIndex: Int32Array;
  /** Per-mote pre-swipe position, so the mote can "shoot" from orbit into rear staging. */
  newSwordMoteFromXWorld: Float32Array;
  newSwordMoteFromYWorld: Float32Array;
  /**
   * Per-mote position at the START of the current tick (before this tick's
   * `_driveSwordMotes` update), captured so swept-segment collision can test
   * the actual path each mote traveled this tick rather than an abstract
   * angular hitbox. Updated every tick the swipe is active.
   */
  newSwordMotePrevXWorld: Float32Array;
  newSwordMotePrevYWorld: Float32Array;

  // ── Independent Bow Weave (Stage 3) — actual-mote arrow assembly ───────────
  //
  // The bow no longer has a "draw strength" / charge tier or a separate queue
  // of phantom motes. Instead it loads the player's ACTUAL mote particles into
  // a straight arrow line (a center mote plus up to four additional real motes,
  // seated at the shield's canonical center — see shieldGeometry.ts) on a
  // fixed schedule measured from when the Shield Weave began, then fires them
  // together as a constant-speed straight projectile that damages the first
  // enemy it sweeps through, reflects off walls, or curves home at max
  // distance — all three resolutions hand the motes back to Storm.
  //
  // Phase: 0 = none, 1 = assembling (held), 2 = outbound (fired).
  bowArrowPhase: number;
  /** Gesture id this arrow belongs to. */
  bowArrowGestureId: number;
  /** World tick the Shield Weave began — origin of the 0.75/1.25/1.75 s schedule. */
  bowArrowShieldStartTick: number;
  /** Number of real motes currently in the arrow (includes the center mote), 0..MAX_BOW_ARROW_MOTES. */
  bowArrowCount: number;
  /**
   * Participating particle indices in center-out insertion order:
   * [0]=center, [1]=behind, [2]=front, [3]=further behind, [4]=further front.
   * The signed line offset for rank r is derived from this ordering.
   */
  bowArrowParticleIndex: Int32Array;
  /** Per-rank tick at which that mote began arcing into the line (−1 = unused). */
  bowArrowSlotStartTick: Int32Array;
  /**
   * Per-rank assembly state: 0 = unused, 1 = loading (still arcing in),
   * 2 = seated (tracking the line exactly, ready to fire). Only SEATED ranks
   * count toward the minimum fireable three-mote arrow — a mote is never
   * snapped straight into a fired arrow mid-arc (task section 6).
   */
  bowArrowRankState: Uint8Array;
  /**
   * 1 when the player released while fewer than the minimum three motes were
   * SEATED but enough are reserved (bowArrowCount >= MIN_BOW_ARROW_MOTES) that
   * seating will eventually finish — the arrow fires automatically, using the
   * aim captured at release time, the first tick enough motes finish seating.
   * Never set when bowArrowCount < MIN_BOW_ARROW_MOTES (that case cancels
   * immediately instead, since seating could never reach the minimum).
   */
  bowArrowReleaseLatchedFlag: 0 | 1;
  bowArrowLatchedAimXWorld: number;
  bowArrowLatchedAimYWorld: number;
  /** Per-rank arc-in start position (where the mote left its shield slot). */
  bowArrowArcFromXWorld: Float32Array;
  bowArrowArcFromYWorld: Float32Array;
  /** Per-rank quadratic-bezier control point (bulges away from the player, then curves back). */
  bowArrowArcCtrlXWorld: Float32Array;
  bowArrowArcCtrlYWorld: Float32Array;
  /** Current straight firing direction (unit). Updated with aim while assembling. */
  bowArrowDirXWorld: number;
  bowArrowDirYWorld: number;
  /** Outbound launch origin (arrow line center at fire time). */
  bowArrowOriginXWorld: number;
  bowArrowOriginYWorld: number;
  /** Accumulated outbound travel distance (pixels) — tracked by displacement, not time. */
  bowArrowTravelPx: number;
  /** Dust kind (ParticleKind) captured at fire time so a later switch cannot retag it. */
  bowArrowDustKind: number;
  /** Dust kind (ParticleKind) captured per legacy fired arrow, MAX_ARROWS entries. */
  arrowDustKind: Uint8Array;
  /** 1 while the independent (Stage 3) Shield Weave crescent currently owns the player's motes. */
  shieldWeaveIndependentActiveFlag: 0 | 1;

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

  // ── Dust Type Switch (dust selection wheel transformation) ────────────────
  // See sim/weaves/dustTypeSwitch.ts for the state machine that drives these
  // per-slot fields. Indexed by mote slot (MAX_MOTE_SLOTS entries), mirroring
  // the Ordered Mote Queue arrays above.
  /**
   * Per-slot switch phase: 0 = normal, 1 = recalling to player center,
   * 2 = transformed, returning to orbit. See DUST_SWITCH_PHASE_* in
   * dustTypeSwitch.ts.
   */
  dustSwitchPhase: Uint8Array;
  /** Dust kind this slot is switching to (valid while phase !== normal). */
  dustSwitchTargetKind: Uint8Array;
  /** Dust kind this slot switched from — used for the trail's pre-transform color. */
  dustSwitchSourceKind: Uint8Array;
  /** Ticks remaining in the post-transform "returning" grace period. */
  dustSwitchReturnTicksLeft: Uint8Array;
  /** Number of slots currently not in the normal phase — 0 means no switch in progress. */
  dustSwitchActiveSlotCount: number;
  /** Fixed-size per-slot trail sample history: world-space X (see dustTypeSwitch.ts). */
  dustSwitchTrailXWorld: Float32Array;
  /** Trail sample history: world-space Y. */
  dustSwitchTrailYWorld: Float32Array;
  /** Trail sample history: age in ticks since the sample was recorded. */
  dustSwitchTrailAgeTicks: Float32Array;
  /** Trail sample history: 0 = pre-transform (source color), 1 = post-transform (target color). */
  dustSwitchTrailIsPostTransformFlag: Uint8Array;
  /** Ring-buffer write cursor per slot. */
  dustSwitchTrailWriteIndex: Uint8Array;
  /** Number of valid trail samples currently stored per slot (≤ DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT). */
  dustSwitchTrailActiveCount: Uint8Array;

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
  /** Runtime zip-activated moving rectangles for the current room. */
  zipMoveBlocks: import('./zipMoveBlocks/zipMoveBlockTypes').ZipMoveBlockRuntime[];

  /**
   * Player's downward velocity from the END of the previous tick, before this
   * tick's collision resolution zeros it on landing.
   * Set at the start of tick() before applyClusterMovement runs.
   * Used by the tough falling block trigger to detect hard landings.
   */
  playerPrevVelocityYWorld: number;

  // ── Web Spider fading web ring buffer ─────────────────────────────────────
  /** Total capacity of the fading-web ring buffer. */
  webSpiderFadingWebMaxCount: number;
  /** Write-head index for the ring buffer (wraps at webSpiderFadingWebMaxCount). */
  webSpiderFadingWebWriteIndex: number;
  /** Number of slots that contain live fading webs (≤ webSpiderFadingWebMaxCount). */
  webSpiderFadingWebActiveCount: number;
  /** Spider X position when it detached (start of the visible strand). */
  webSpiderFadingWebFromXWorld: Float32Array;
  /** Spider Y position when it detached. */
  webSpiderFadingWebFromYWorld: Float32Array;
  /** Anchor X (end of the visible strand). */
  webSpiderFadingWebToXWorld: Float32Array;
  /** Anchor Y. */
  webSpiderFadingWebToYWorld: Float32Array;
  /** Remaining ticks until the web fully fades (counts down to 0). */
  webSpiderFadingWebRemainingTicks: Float32Array;
  /** Max ticks for this web (for alpha computation: remaining/max). */
  webSpiderFadingWebMaxTicks: Float32Array;

  // ── Momentum Combat trail ────────────────────────────────────────────────
  // TODO: Implement golden grapple trail visual in a dedicated renderer module.
  //        These buffers are allocated but not yet written or rendered; the
  //        structure is intentionally kept modular so the renderer can be added
  //        without changing WorldState.  Writer: tick when isHighVelocityAttacking;
  //        reader: renderer that draws a fading gold streak.
  /** Write-head index for the circular trail buffer. */
  momentumTrailWriteIndex: number;
  /** Number of valid entries currently in the trail (up to MOMENTUM_TRAIL_MAX_POINTS). */
  momentumTrailActiveCount: number;
  /** World-space X positions of recent player positions for the trail. */
  momentumTrailXWorld: Float32Array;
  /** World-space Y positions. */
  momentumTrailYWorld: Float32Array;
  /** Age in ticks of each trail position (for alpha fade). */
  momentumTrailAgeTicks: Uint8Array;

  // ── Ice Mote Freeze Aura ─────────────────────────────────────────────────
  /**
   * Per-zone frozen mask: 1 if this water zone is temporarily frozen by the
   * Ice Mote aura.  Frozen zones are excluded from buoyancy physics and liquid
   * rendering while a solid one-way-platform ice wall covers their area.
   * Managed by iceMoteAura.ts; reset to all-0 on each room load.
   */
  frozenWaterZoneMask: Uint8Array;

  /**
   * Pixel-scale falling-sand material simulation layer. Owns material
   * occupancy, active/sleep tracking, and its own fixed-step tick — a
   * separate simulation layer from the tile/collision/entity architecture.
   * Rebuilt (new instance + solid mask) whenever a room is loaded; see
   * `loadRoomPixelMaterials` in screens/gameRoomPixelMaterials.ts.
   */
  pixelMaterialSystem: PixelMaterialSystem;
}

export function createWorldState(dtMs: number, rngSeed = 42): WorldState {
  return {
    shieldWeave: createShieldWeaveState(),
    secondaryWeaveGesture: createSecondaryWeaveGestureState(),
    secondaryWeaveHandledCancellationId: 0,
    combatMode: DEFAULT_COMBAT_MODE,
    challengeMode: createChallengeModeState(),
    gates: [],
    builtForRoomId: '',
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
    wallSoundHardnessIndex: new Uint8Array(MAX_WALLS),
    wallIsInvisibleFlag: new Uint8Array(MAX_WALLS),
    wallRampOrientationIndex: new Uint8Array(MAX_WALLS).fill(255),
    wallIsPillarHalfWidthFlag: new Uint8Array(MAX_WALLS),
    wallIsBouncePadFlag: new Uint8Array(MAX_WALLS),
    wallBouncePadSpeedFactorIndex: new Uint8Array(MAX_WALLS),
    wallIsIceFlag: new Uint8Array(MAX_WALLS),
    wallIsUltraIceFlag: new Uint8Array(MAX_WALLS),
    wallIsRocketBlockFlag: new Uint8Array(MAX_WALLS),
    wallIsKineticBlockFlag:           new Uint8Array(MAX_WALLS),
    wallKineticBlockIndex:            new Int16Array(MAX_WALLS).fill(-1),
    wallCrumbleBlockIndex:            new Int16Array(MAX_WALLS).fill(-1),
    shatterEventCount: 0,
    shatterEventXWorld: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventYWorld: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventWWorld: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventHWorld: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventImpactXWorld: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventImpactYWorld: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventNormalX: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventNormalY: new Float32Array(MAX_SHATTER_EVENTS),
    shatterEventThemeIndex: new Uint8Array(MAX_SHATTER_EVENTS),
    shatterEventVariantIndex: new Uint8Array(MAX_SHATTER_EVENTS),
    shatterEventSpeedWorld: new Float32Array(MAX_SHATTER_EVENTS),
    bgWallGridWidth: 0,
    bgWallGridHeight: 0,
    bgWallGrid: new Uint8Array(0),
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
    playerSecondaryWeaveId: 'none',
    canUsePlayerSecondaryWeaveFlag: 0,
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
    playerCrouchHeldFlag: 0,
    characterId: 'knight',
    playerJumpTriggeredFlag: 0,
    playerJumpHeldFlag: 0,
    isPlayerSkiddingFlag: 0,
    skidDebrisXWorld: 0.0,
    skidDebrisYWorld: 0.0,
    wallJumpSkidDebrisBurstFlag: 0,
    playerLandingSkidSpeedFactor: 0.0,
    playerSkidEntryVelocityXWorld: 0.0,
    weakWallJumpCascadeFlag: 0,
    weakWallJumpCascadeXWorld: 0.0,
    weakWallJumpCascadeYWorld: 0.0,
    weakWallJumpCascadeWallSideX: 0,
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
    arrowDustKind:                 new Uint8Array(MAX_ARROWS),
    shieldWeaveIndependentActiveFlag: 0,
    // ── Stage 3: independent Sword/Shield/Bow unlock flags ─────────────
    hasSwordWeaveUnlockedFlag:     0,
    hasShieldWeaveUnlockedFlag:    0,
    hasBowWeaveUnlockedFlag:       0,
    // ── Independent Sword Weave ─────────────────────────────────────────
    newSwordActiveFlag:            0,
    newSwordGestureId:             -1,
    newSwordTicksElapsed:          0,
    newSwordAimAngleRad:           0,
    newSwordCurrentAngleRad:       0,
    newSwordHandAnchorXWorld:      0,
    newSwordHandAnchorYWorld:      0,
    newSwordReachWorld:            0,
    newSwordToShieldTransition01:  0,
    newSwordStartAngleRad:         0,
    newSwordEndAngleRad:           0,
    newSwordMoteCount:             0,
    newSwordMoteParticleIndex:     new Int32Array(MAX_SWORD_SLASH_MOTES).fill(-1),
    newSwordMoteFromXWorld:        new Float32Array(MAX_SWORD_SLASH_MOTES),
    newSwordMoteFromYWorld:        new Float32Array(MAX_SWORD_SLASH_MOTES),
    newSwordMotePrevXWorld:        new Float32Array(MAX_SWORD_SLASH_MOTES),
    newSwordMotePrevYWorld:        new Float32Array(MAX_SWORD_SLASH_MOTES),
    // ── Independent Bow Weave — actual-mote arrow ───────────────────────
    bowArrowPhase:                 0,
    bowArrowGestureId:             -1,
    bowArrowShieldStartTick:       -1,
    bowArrowCount:                 0,
    bowArrowParticleIndex:         new Int32Array(MAX_BOW_ARROW_MOTES).fill(-1),
    bowArrowSlotStartTick:         new Int32Array(MAX_BOW_ARROW_MOTES).fill(-1),
    bowArrowRankState:             new Uint8Array(MAX_BOW_ARROW_MOTES),
    bowArrowArcFromXWorld:         new Float32Array(MAX_BOW_ARROW_MOTES),
    bowArrowArcFromYWorld:         new Float32Array(MAX_BOW_ARROW_MOTES),
    bowArrowArcCtrlXWorld:         new Float32Array(MAX_BOW_ARROW_MOTES),
    bowArrowArcCtrlYWorld:         new Float32Array(MAX_BOW_ARROW_MOTES),
    bowArrowDirXWorld:             1,
    bowArrowDirYWorld:             0,
    bowArrowOriginXWorld:          0,
    bowArrowOriginYWorld:          0,
    bowArrowTravelPx:              0,
    bowArrowDustKind:              0,
    bowArrowReleaseLatchedFlag:    0,
    bowArrowLatchedAimXWorld:      0,
    bowArrowLatchedAimYWorld:      0,
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
    // ── Dust Type Switch ──────────────────────────────────────────────
    dustSwitchPhase:              new Uint8Array(MAX_MOTE_SLOTS),
    dustSwitchTargetKind:         new Uint8Array(MAX_MOTE_SLOTS),
    dustSwitchSourceKind:         new Uint8Array(MAX_MOTE_SLOTS),
    dustSwitchReturnTicksLeft:    new Uint8Array(MAX_MOTE_SLOTS),
    dustSwitchActiveSlotCount:    0,
    dustSwitchTrailXWorld:        new Float32Array(MAX_MOTE_SLOTS * DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT),
    dustSwitchTrailYWorld:        new Float32Array(MAX_MOTE_SLOTS * DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT),
    dustSwitchTrailAgeTicks:      new Float32Array(MAX_MOTE_SLOTS * DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT),
    dustSwitchTrailIsPostTransformFlag: new Uint8Array(MAX_MOTE_SLOTS * DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT),
    dustSwitchTrailWriteIndex:    new Uint8Array(MAX_MOTE_SLOTS),
    dustSwitchTrailActiveCount:   new Uint8Array(MAX_MOTE_SLOTS),
    // Default: Storm Weave is the starting primary, so motes orbit from the start.
    isMoteSourceOrbitFlag:         1,
    // ── Falling blocks ────────────────────────────────────────────────────
    fallingBlockGroups:            [],
    zipMoveBlocks:                  [],
    playerPrevVelocityYWorld:      0,
    // ── Web Spider fading web ring buffer ────────────────────────────────
    webSpiderFadingWebMaxCount:          MAX_FADING_WEBS,
    webSpiderFadingWebWriteIndex:        0,
    webSpiderFadingWebActiveCount:       0,
    webSpiderFadingWebFromXWorld:        new Float32Array(MAX_FADING_WEBS),
    webSpiderFadingWebFromYWorld:        new Float32Array(MAX_FADING_WEBS),
    webSpiderFadingWebToXWorld:          new Float32Array(MAX_FADING_WEBS),
    webSpiderFadingWebToYWorld:          new Float32Array(MAX_FADING_WEBS),
    webSpiderFadingWebRemainingTicks:    new Float32Array(MAX_FADING_WEBS),
    webSpiderFadingWebMaxTicks:          new Float32Array(MAX_FADING_WEBS),
    ...createGrappleWorldState(),
    ...createHazardWorldState(),
    ...createParticleBuffers(),
    frozenWaterZoneMask: new Uint8Array(MAX_WATER_ZONES),
    momentumTrailWriteIndex: 0,
    momentumTrailActiveCount: 0,
    momentumTrailXWorld: new Float32Array(MOMENTUM_TRAIL_MAX_POINTS),
    momentumTrailYWorld: new Float32Array(MOMENTUM_TRAIL_MAX_POINTS),
    momentumTrailAgeTicks: new Uint8Array(MOMENTUM_TRAIL_MAX_POINTS),
    pixelMaterialSystem: new PixelMaterialSystem(NATIVE_WIDTH_PX, NATIVE_HEIGHT_PX),
  };
}

export { MAX_PARTICLES };
