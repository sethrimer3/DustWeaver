/**
 * snapshotTypes.ts — Public read-only snapshot interfaces for the render layer.
 *
 * These types represent the sim/render boundary: the renderer reads only
 * these readonly views and never modifies WorldState directly.
 *
 * Extracted from snapshot.ts to keep the implementation file focused on
 * the allocation logic (createSnapshot, createReusableSnapshot, etc.).
 *
 * ClusterSnapshot has been moved to clusterSnapshotTypes.ts and is
 * re-exported here for backward compatibility.
 */

export type { ClusterSnapshot } from './clusterSnapshotTypes';
import type { ClusterSnapshot } from './clusterSnapshotTypes';

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
  /**
   * Behavior mode for each particle (matches sim/particles/state.ts).
   * 0 = orbit, 1 = attack (offensive), 2 = shield.
   * Used by the renderer to keep offensive particles at their full 4×4 size.
   */
  readonly behaviorMode:      Uint8Array;
  /**
   * Per-particle mote slot state: 0 = available (normal render), 1 = depleted.
   * Non-zero for player mote particles whose logical slot is currently depleted.
   * Zero for all non-mote and non-player particles.
   * Renderers apply a reduced alpha (0.25×) to depleted-slot particles as a
   * "spent" visual cue.  Populated each frame by scanning world.moteSlotParticleIndex
   * and world.moteSlotState — O(MAX_MOTE_SLOTS) per frame.
   */
  readonly particleMoteSlotState: Uint8Array;
  /**
   * Per-particle noise seed (Uint32) — stable throughout each particle's
   * lifetime and reset on respawn.  Used by the Pixel-Locked Prismatic Dust
   * renderer as a stable per-particle colour-tone identifier so all particles
   * don't brighten/shift in sync.
   */
  readonly noiseTickSeed:     Uint32Array;
  readonly particleCount:     number;
}


export interface WallSnapshot {
  readonly count:   number;
  readonly xWorld:  Float32Array;
  readonly yWorld:  Float32Array;
  readonly wWorld:  Float32Array;
  readonly hWorld:  Float32Array;
  readonly isPlatformFlag: Uint8Array;
  /** 0=top, 1=bottom, 2=left, 3=right. Only meaningful when isPlatformFlag=1. */
  readonly platformEdge: Uint8Array;
  /** Per-wall theme index: 0=blackRock, 1=brownRock, 2=dirt.  Uses room default when 255. */
  readonly themeIndex: Uint8Array;
  /** 1 if the wall is an invisible collision boundary (not rendered). */
  readonly isInvisibleFlag: Uint8Array;
  /** Ramp orientation: 255=not a ramp, 0=rises right(/), 1=rises left(\), 2=ceiling⌐, 3=ceiling¬. */
  readonly rampOrientationIndex: Uint8Array;
  /** 1 if the wall is a half-width pillar (4 px wide). */
  readonly isPillarHalfWidthFlag: Uint8Array;
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
  readonly isGrappleZipActiveFlag: 0 | 1;
  /** 1 when the player has arrived at a top-surface grapple anchor and is sticking. */
  readonly isGrappleStuckFlag: 0 | 1;
  /** World-space X of the grapple anchor point (only valid when isGrappleActiveFlag=1). */
  readonly grappleAnchorXWorld:  number;
  /** World-space Y of the grapple anchor point (only valid when isGrappleActiveFlag=1). */
  readonly grappleAnchorYWorld:  number;
  /**
   * Outward surface normal at the anchor (unit axis vector, 0,0 when not on a wall).
   * Set by fireGrapple and the miss-chain attachment path.  Used by debug rendering.
   */
  readonly grappleAnchorNormalXWorld: number;
  readonly grappleAnchorNormalYWorld: number;
  // ── Debug grapple collision fields ───────────────────────────────────────────
  /** Sweep ray origin from the last grapple fire (for debug overlay). */
  readonly grappleDebugSweepFromXWorld: number;
  readonly grappleDebugSweepFromYWorld: number;
  /** Sweep ray endpoint (full cast distance, before hit clamping). */
  readonly grappleDebugSweepToXWorld:   number;
  readonly grappleDebugSweepToYWorld:   number;
  /** Raw raycast hit point before surface-epsilon offset. */
  readonly grappleDebugRawHitXWorld:    number;
  readonly grappleDebugRawHitYWorld:    number;
  /** 1 if debug data is valid (written by last grapple fire). */
  readonly isGrappleDebugActiveFlag:    0 | 1;
  /** Remaining ticks for grapple attach burst visual effect. */
  readonly grappleAttachFxTicks: number;
  readonly grappleAttachFxXWorld: number;
  readonly grappleAttachFxYWorld: number;
  /**
   * Ticks remaining in the proximity-bounce sprite window.
   * While > 0 the player renders the jumping sprite rotated toward the
   * wall/ceiling that triggered the bounce.
   */
  readonly grappleProximityBounceTicksLeft: number;
  /**
   * Canvas rotation angle (radians) for the proximity-bounce jumping sprite.
   * -π/2 = left-wall, +π/2 = right-wall, π = ceiling.
   */
  readonly grappleProximityBounceRotationAngleRad: number;
  readonly grappleFailBeamTicksLeft: number;
  readonly grappleFailBeamTotalTicks: number;
  readonly grappleFailBeamStartXWorld: number;
  readonly grappleFailBeamStartYWorld: number;
  readonly grappleFailBeamEndXWorld: number;
  readonly grappleFailBeamEndYWorld: number;

  // ── Ice grapple bounce FX ─────────────────────────────────────────────────
  /** Ticks remaining for the ice-bounce reflected-ray effect. 0 = inactive. */
  readonly grappleIceBounceTicksLeft: number;
  /** Total ticks for the ice bounce effect. */
  readonly grappleIceBounceTicksTotal: number;
  /** World-space X of the ice surface hit point. */
  readonly grappleIceBounceStartXWorld: number;
  /** World-space Y of the ice surface hit point. */
  readonly grappleIceBounceStartYWorld: number;
  /** World-space X of the end of the reflected ray. */
  readonly grappleIceBounceEndXWorld: number;
  /** World-space Y of the end of the reflected ray. */
  readonly grappleIceBounceEndYWorld: number;

  readonly grappleEmptyFxTicksLeft: number;
  readonly grappleEmptyFxTotalTicks: number;
  readonly grappleEmptyFxXWorld: number;
  readonly grappleEmptyFxYWorld: number;

  // ── Zip impact FX ─────────────────────────────────────────────────────────
  /** Ticks remaining for the zip impact shockwave + dust plume. 0 = inactive. */
  readonly zipImpactFxTicksLeft: number;
  /** Total ticks of the zip impact FX (for progress / alpha calculation). */
  readonly zipImpactFxTotalTicks: number;
  /** World-space X center of the zip impact FX. */
  readonly zipImpactFxXWorld: number;
  /** World-space Y center of the zip impact FX. */
  readonly zipImpactFxYWorld: number;
  /**
   * Scale factor: 1.0 = normal completion ring; ZIP_JUMP_FX_SCALE (1.35) = timed zip-jump ring.
   */
  readonly zipImpactFxScale: number;
  /** Surface normal X at the impact point — used to orient the dust plume direction. */
  readonly zipImpactFxNormalXWorld: number;
  /** Surface normal Y at the impact point. */
  readonly zipImpactFxNormalYWorld: number;
  /**
   * 1 while the zip-jump timing window is open (player can still earn the
   * high-velocity zip-jump bonus).  Used by the renderer to drive the starburst
   * animation only while the window is active.
   */
  readonly isZipJumpWindowOpenFlag: 0 | 1;

  /** 1 while the player is holding block or a sustained weave — used to drive player sprite rotation speed. */
  readonly isPlayerBlockingFlag: 0 | 1;
  /** 1 when the player has a grapple charge available (grapple hook is equipped). */
  readonly hasGrappleChargeFlag: 0 | 1;
  /** Ticks remaining for the golden recharge-ring VFX (> 0 = ring is active). */
  readonly grappleRechargeRingTicksLeft: number;
  /** Total duration of the recharge-ring VFX in ticks. */
  readonly grappleRechargeRingTotalTicks: number;
  /** 1 while the player has any sustained Weave active (primary or secondary). */
  readonly isPlayerWeaveActiveFlag: 0 | 1;
  /** Selected character identifier ('knight', 'demonFox', 'princess', or 'outcast'). */
  readonly characterId: string;
  /** Number of active grasshoppers. */
  readonly grasshopperCount: number;
  /** X positions of grasshoppers (world units). */
  readonly grasshopperXWorld: Float32Array;
  /** Y positions of grasshoppers (world units). */
  readonly grasshopperYWorld: Float32Array;
  /** Per-grasshopper alive flags. */
  readonly isGrasshopperAliveFlag: Uint8Array;

  // ── Square Stampede trail ring buffers ────────────────────────────────────
  /** Flattened trail X positions [slot * stride + ringIndex] (world units). */
  readonly squareStampedeTrailXWorld: Float32Array;
  /** Flattened trail Y positions. Same layout as squareStampedeTrailXWorld. */
  readonly squareStampedeTrailYWorld: Float32Array;
  /** Write-head per slot — points to the NEXT slot to be overwritten. */
  readonly squareStampedeTrailHead: Uint8Array;
  /** Number of valid trail entries per slot (0..stride). */
  readonly squareStampedeTrailCount: Uint8Array;
  /** Number of entries per slot (SQUARE_STAMPEDE_TRAIL_COUNT). */
  readonly squareStampedeTrailStride: number;

  // ── Bee-swarm individual bee position buffers ─────────────────────────────
  /**
   * X position of each bee (world units).
   * Layout: [swarmSlot * BEES_PER_SWARM + beeIndex].
   */
  readonly beeSwarmBeeXWorld: Float32Array;
  /** Y position of each bee (world units). Same layout as beeSwarmBeeXWorld. */
  readonly beeSwarmBeeYWorld: Float32Array;
  /** X velocity of each bee (world units/s). Same layout as beeSwarmBeeXWorld. */
  readonly beeSwarmBeeVelXWorld: Float32Array;
  /** Y velocity of each bee (world units/s). Same layout as beeSwarmBeeXWorld. */
  readonly beeSwarmBeeVelYWorld: Float32Array;

  // ── Dust Constellation Sentinel arrays ───────────────────────────────────
  readonly constellationMoteXWorld: Float32Array;
  readonly constellationMoteYWorld: Float32Array;
  readonly constellationMoteVelXWorld: Float32Array;
  readonly constellationMoteVelYWorld: Float32Array;
  readonly constellationMoteTargetLocalX: Float32Array;
  readonly constellationMoteTargetLocalY: Float32Array;
  readonly constellationMotePulsePhaseRad: Float32Array;

  // ── Orbital Dust Core mote arrays ─────────────────────────────────────────
  readonly odcMoteAngleRad: Float32Array;
  readonly odcMoteRadiusWorld: Float32Array;
  readonly odcMoteAliveFlag: Uint8Array;
  readonly odcMotePulsePhaseRad: Float32Array;

  // ── Dust Block Mimic mote arrays ──────────────────────────────────────────
  readonly dbmMoteXWorld: Float32Array;
  readonly dbmMoteYWorld: Float32Array;
  readonly dbmMoteVelXWorld: Float32Array;
  readonly dbmMoteVelYWorld: Float32Array;
  readonly dbmMoteTargetLocalX: Float32Array;
  readonly dbmMoteTargetLocalY: Float32Array;
  readonly dbmMotePulsePhaseRad: Float32Array;

  // ── Dust Weaver Architect world arrays ────────────────────────────────────
  readonly dwaMoteAngleRad: Float32Array;
  readonly dwaMotePulsePhaseRad: Float32Array;

  // ── Void Singularity mote arrays ──────────────────────────────────────────
  readonly vsMoteAngleRad: Float32Array;
  readonly vsMoteRadiusWorld: Float32Array;
  readonly vsMotePulsePhaseRad: Float32Array;

  // ── Void Singularity Pair projectile arrays ───────────────────────────────
  readonly vspProjXWorld: Float32Array;
  readonly vspProjYWorld: Float32Array;
  readonly vspProjVelXWorld: Float32Array;
  readonly vspProjVelYWorld: Float32Array;
  readonly vspProjLifetimeTicks: Float32Array;
  readonly vspProjAliveFlag: Uint8Array;

  // ── Dust Leech mote arrays ─────────────────────────────────────────────────
  readonly dlMoteAngleRad: Float32Array;
  readonly dlMotePulsePhaseRad: Float32Array;

  // ── Dust Echo mote arrays ──────────────────────────────────────────────────
  readonly deMoteOffsetXWorld: Float32Array;
  readonly deMoteOffsetYWorld: Float32Array;
  readonly deMotePulsePhaseRad: Float32Array;
  readonly architectBlockCount: number;
  readonly architectBlockXWorld: Float32Array;
  readonly architectBlockYWorld: Float32Array;
  readonly architectBlockHealth: Uint8Array;
  readonly architectBlockMaxHealth: Uint8Array;
  readonly architectBlockLifetimeTicks: Uint16Array;
  readonly architectBlockGraceTicks: Uint8Array;
  readonly architectBlockFormTicks: Uint8Array;
  readonly architectBlockCrumbleTicks: Uint8Array;
  readonly architectBlockState: Uint8Array;
  readonly isArchitectBlockAliveFlag: Uint8Array;
  readonly architectBlockOwnerSlot: Int8Array;

  // ── Dust Nail projectiles ────────────────────────────────────────────────────
  readonly dwaNailXWorld: Float32Array;
  readonly dwaNailYWorld: Float32Array;
  readonly dwaNailVelXWorld: Float32Array;
  readonly dwaNailVelYWorld: Float32Array;
  readonly dwaNailLifetimeTicks: Uint16Array;
  readonly isDwaNailAliveFlag: Uint8Array;

  // ── Arrow Weave state ─────────────────────────────────────────────────────
  /** 1 while the player is loading an arrow (holding secondary weave button). */
  readonly isArrowWeaveLoadingFlag: 0 | 1;
  /** Current loaded mote count (0, 2, 3, or 4) for bow visual sizing. */
  readonly arrowWeaveCurrentMoteCount: number;
  /** Current aim direction X (world units, normalized) — for bow placement. */
  readonly playerWeaveAimDirXWorld: number;
  /** Current aim direction Y (world units, normalized) — for bow placement. */
  readonly playerWeaveAimDirYWorld: number;
  /** Number of allocated arrow slots (some may be expired with lifetime ≤ 0). */
  readonly arrowCount: number;
  /** Tip X position of each arrow (world units). Shared view into WorldState. */
  readonly arrowXWorld: Float32Array;
  /** Tip Y position of each arrow (world units). Shared view into WorldState. */
  readonly arrowYWorld: Float32Array;
  /** Normalized X travel direction of each arrow. Shared view into WorldState. */
  readonly arrowDirXWorld: Float32Array;
  /** Normalized Y travel direction of each arrow. Shared view into WorldState. */
  readonly arrowDirYWorld: Float32Array;
  /** Mote count per arrow (2, 3, or 4). Shared view into WorldState. */
  readonly arrowMoteCount: Uint8Array;
  /** 1 when the arrow is stuck in terrain; 0 while in flight. */
  readonly isArrowStuckFlag: Uint8Array;
  /** 1 when the arrow hit an enemy (invisible, playing hit sequence). */
  readonly isArrowHitEnemyFlag: Uint8Array;
  /** Remaining lifetime ticks per arrow (0 = expired). */
  readonly arrowLifetimeTicksLeft: Float32Array;

  // ── Shield Sword Weave state ─────────────────────────────────────────────
  /** ID of the equipped secondary weave (e.g. 'arrow', 'shield_sword'). */
  readonly playerSecondaryWeaveId: string;
  /** Current sword state — see SWORD_STATE_* in sim/weaves/swordWeave.ts. */
  readonly swordWeaveStateEnum: number;
  /** Ticks elapsed in the current sword state. */
  readonly swordWeaveStateTicksElapsed: number;
  /** Current sword angle (radians) in world space. */
  readonly swordWeaveAngleRad: number;
  /** Slash sweep start angle (radians). */
  readonly swordWeaveSlashStartAngleRad: number;
  /** Slash sweep end angle (radians). */
  readonly swordWeaveSlashEndAngleRad: number;
  /** World X of the sword's hand anchor. */
  readonly swordWeaveHandAnchorXWorld: number;
  /** World Y of the sword's hand anchor. */
  readonly swordWeaveHandAnchorYWorld: number;
  /**
   * Current sword length ratio in [0, 1].
   * 1.0 = full blade (all motes available).  0 = no motes — sword cannot form.
   * Used by the renderer to scale the number of blade segments drawn and the
   * reach of the slash trail tip.
   */
  readonly swordWeaveLengthRatio: number;

  // ── Ordered Mote Queue display ────────────────────────────────────────────
  /**
   * Smoothed grapple influence circle radius (world units).
   * Lerps toward the effective grapple range each tick.
   * Used by grappleInfluenceRenderer to scale the influence circle so it
   * visually shrinks and grows as motes are depleted and regenerated.
   */
  readonly moteGrappleDisplayRadiusWorld: number;
  /**
   * Phase 8: 1 when the player's primary weave is Storm (motes orbit passively).
   * 0 when Storm is not the primary weave (motes come from inventory space).
   * Used by renderers to choose between orbit-fly and center-pop visual styles.
   */
  readonly isMoteSourceOrbitFlag: 0 | 1;
  /**
   * Phase 9: Grapple rope tension factor in [0, 1].
   * 0 = rope within effective range, no tension.
   * Ramps toward 1 as the rope has been out-of-range for longer.
   * 1 = rope at the break threshold — will snap next tick.
   * Used by grappleInfluenceRenderer to pulse the ring as a tension warning.
   */
  readonly grappleTensionFactor: number;
  // ── Grapple geometric wrapping (Phase 2) ─────────────────────────────────
  /**
   * 1 when geometric corner wrapping is enabled (debug/feature flag).
   * 0 = disabled (default) — wrapping code is entirely skipped.
   */
  readonly isGrappleWrappingEnabled: 0 | 1;
  /**
   * Number of active wrap corner points (0–MAX_GRAPPLE_WRAP_POINTS).
   * When > 0, the active swing anchor is the newest wrap point rather than
   * the main grapple anchor.
   */
  readonly grappleWrapPointCount: number;
  /** World-X of each wrap corner (shared view). Valid for indices 0..grappleWrapPointCount-1. */
  readonly grappleWrapPointXWorld: Float32Array;
  /** World-Y of each wrap corner (shared view). Valid for indices 0..grappleWrapPointCount-1. */
  readonly grappleWrapPointYWorld: Float32Array;
  // ── Ropes ────────────────────────────────────────────────────────────────
  /** Number of ropes in the current room. */
  readonly ropeCount: number;
  /** Number of segments per rope. Shared view into WorldState buffer. */
  readonly ropeSegmentCount: Uint8Array;
  /** Per-rope collision and visual half-thickness (world units). Shared view. */
  readonly ropeHalfThickWorld: Float32Array;
  /** Verlet node X positions (shared view). */
  readonly ropeSegPosXWorld: Float32Array;
  /** Verlet node Y positions (shared view). */
  readonly ropeSegPosYWorld: Float32Array;

  // ── Web Spider fading web ring buffer ─────────────────────────────────────
  readonly webSpiderFadingWebMaxCount: number;
  readonly webSpiderFadingWebActiveCount: number;
  readonly webSpiderFadingWebFromXWorld: Float32Array;
  readonly webSpiderFadingWebFromYWorld: Float32Array;
  readonly webSpiderFadingWebToXWorld: Float32Array;
  readonly webSpiderFadingWebToYWorld: Float32Array;
  readonly webSpiderFadingWebRemainingTicks: Float32Array;
  readonly webSpiderFadingWebMaxTicks: Float32Array;
}
