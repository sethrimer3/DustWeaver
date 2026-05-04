/**
 * Environmental hazard and critter sub-state for WorldState.
 *
 * All fields related to spikes, springboards, water zones, lava zones,
 * breakable blocks, crumble blocks, bounce pads, dust boost jars, firefly
 * jars, fireflies, dust piles, grasshoppers, square-stampede trail buffers,
 * and bee-swarm bee position buffers live here.
 *
 * WorldState extends this interface; consumers always work through WorldState
 * and never need to import HazardWorldState directly.
 */

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

export interface HazardWorldState {
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
}

/** Returns the default-initialised hazard/critter state for use in createWorldState(). */
export function createHazardWorldState(): HazardWorldState {
  return {
    spikeCount:                    0,
    spikeXWorld:                   new Float32Array(MAX_SPIKES),
    spikeYWorld:                   new Float32Array(MAX_SPIKES),
    spikeDirection:                new Uint8Array(MAX_SPIKES),
    spikeInvulnTicks:              0,
    springboardCount:              0,
    springboardXWorld:             new Float32Array(MAX_SPRINGBOARDS),
    springboardYWorld:             new Float32Array(MAX_SPRINGBOARDS),
    springboardAnimTicks:          new Uint8Array(MAX_SPRINGBOARDS),
    waterZoneCount:                0,
    waterZoneXWorld:               new Float32Array(MAX_WATER_ZONES),
    waterZoneYWorld:               new Float32Array(MAX_WATER_ZONES),
    waterZoneWWorld:               new Float32Array(MAX_WATER_ZONES),
    waterZoneHWorld:               new Float32Array(MAX_WATER_ZONES),
    lavaZoneCount:                 0,
    lavaZoneXWorld:                new Float32Array(MAX_LAVA_ZONES),
    lavaZoneYWorld:                new Float32Array(MAX_LAVA_ZONES),
    lavaZoneWWorld:                new Float32Array(MAX_LAVA_ZONES),
    lavaZoneHWorld:                new Float32Array(MAX_LAVA_ZONES),
    lavaInvulnTicks:               0,
    breakableBlockCount:           0,
    breakableBlockXWorld:          new Float32Array(MAX_BREAKABLE_BLOCKS),
    breakableBlockYWorld:          new Float32Array(MAX_BREAKABLE_BLOCKS),
    isBreakableBlockActiveFlag:    new Uint8Array(MAX_BREAKABLE_BLOCKS),
    breakableBlockWallIndex:       new Int8Array(MAX_BREAKABLE_BLOCKS),
    crumbleBlockCount:             0,
    crumbleBlockXWorld:            new Float32Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockYWorld:            new Float32Array(MAX_CRUMBLE_BLOCKS),
    isCrumbleBlockActiveFlag:      new Uint8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockHitsRemaining:     new Uint8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockHitCooldownTicks:  new Uint8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockWallIndex:         new Int8Array(MAX_CRUMBLE_BLOCKS),
    crumbleBlockVariant:           new Uint8Array(MAX_CRUMBLE_BLOCKS),
    bouncePadCount:                0,
    bouncePadXWorld:               new Float32Array(MAX_BOUNCE_PADS),
    bouncePadYWorld:               new Float32Array(MAX_BOUNCE_PADS),
    bouncePadWWorld:               new Float32Array(MAX_BOUNCE_PADS),
    bouncePadHWorld:               new Float32Array(MAX_BOUNCE_PADS),
    bouncePadSpeedFactorIndex:     new Uint8Array(MAX_BOUNCE_PADS),
    bouncePadRampOrientationIndex: new Uint8Array(MAX_BOUNCE_PADS).fill(255),
    dustBoostJarCount:             0,
    dustBoostJarXWorld:            new Float32Array(MAX_DUST_BOOST_JARS),
    dustBoostJarYWorld:            new Float32Array(MAX_DUST_BOOST_JARS),
    isDustBoostJarActiveFlag:      new Uint8Array(MAX_DUST_BOOST_JARS),
    dustBoostJarKind:              new Uint8Array(MAX_DUST_BOOST_JARS),
    dustBoostJarDustCount:         new Uint8Array(MAX_DUST_BOOST_JARS),
    fireflyJarCount:               0,
    fireflyJarXWorld:              new Float32Array(MAX_FIREFLY_JARS),
    fireflyJarYWorld:              new Float32Array(MAX_FIREFLY_JARS),
    isFireflyJarActiveFlag:        new Uint8Array(MAX_FIREFLY_JARS),
    fireflyCount:                  0,
    fireflyXWorld:                 new Float32Array(MAX_FIREFLIES),
    fireflyYWorld:                 new Float32Array(MAX_FIREFLIES),
    fireflyVelXWorld:              new Float32Array(MAX_FIREFLIES),
    fireflyVelYWorld:              new Float32Array(MAX_FIREFLIES),
    isPlayerInWaterFlag:           0,
    dustPileCount:                 0,
    dustPileXWorld:                new Float32Array(MAX_DUST_PILES),
    dustPileYWorld:                new Float32Array(MAX_DUST_PILES),
    dustPileDustCount:             new Uint8Array(MAX_DUST_PILES),
    isDustPileActiveFlag:          new Uint8Array(MAX_DUST_PILES),
    grasshopperCount:              0,
    grasshopperXWorld:             new Float32Array(MAX_GRASSHOPPERS),
    grasshopperYWorld:             new Float32Array(MAX_GRASSHOPPERS),
    grasshopperVelXWorld:          new Float32Array(MAX_GRASSHOPPERS),
    grasshopperVelYWorld:          new Float32Array(MAX_GRASSHOPPERS),
    grasshopperHopTimerTicks:      new Float32Array(MAX_GRASSHOPPERS),
    isGrasshopperAliveFlag:        new Uint8Array(MAX_GRASSHOPPERS),
    squareStampedeTrailStride:     SQUARE_STAMPEDE_TRAIL_COUNT,
    squareStampedeTrailXWorld:     new Float32Array(MAX_SQUARE_STAMPEDE * SQUARE_STAMPEDE_TRAIL_COUNT),
    squareStampedeTrailYWorld:     new Float32Array(MAX_SQUARE_STAMPEDE * SQUARE_STAMPEDE_TRAIL_COUNT),
    squareStampedeTrailHead:       new Uint8Array(MAX_SQUARE_STAMPEDE),
    squareStampedeTrailCount:      new Uint8Array(MAX_SQUARE_STAMPEDE),
    beeSwarmBeeXWorld:             new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeeYWorld:             new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeeVelXWorld:          new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeeVelYWorld:          new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
    beeSwarmBeePhaseRad:           new Float32Array(MAX_BEE_SWARMS * BEES_PER_SWARM),
  };
}
