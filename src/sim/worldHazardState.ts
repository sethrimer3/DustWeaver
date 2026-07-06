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
/** Maximum number of water zones per room (raised to 6000 to support large liquid pools). */
export const MAX_WATER_ZONES = 6000;
/** Maximum number of lava zones per room (raised to 6000 to support large liquid pools). */
export const MAX_LAVA_ZONES = 6000;
/** Maximum number of breakable blocks per room. */
export const MAX_BREAKABLE_BLOCKS = 32;
/** Maximum number of crumble blocks per room. */
export const MAX_CRUMBLE_BLOCKS = 32;
/** Maximum number of bounce pads per room. */
export const MAX_BOUNCE_PADS = 64;

import { MAX_KINETIC_BLOCKS } from './kineticBlocks/kineticBlockTypes';
export { MAX_KINETIC_BLOCKS } from './kineticBlocks/kineticBlockTypes';
import {
  MAX_ORBITAL_DUST_CORES,
  MOTES_PER_ODC_SLOT,
} from './clusters/orbitalDustCoreConfig';
import {
  MAX_DUST_BLOCK_MIMICS,
  MAX_MOTES_PER_DBM,
} from './clusters/dustBlockMimicConfig';
import {
  MAX_DUST_WEAVER_ARCHITECTS,
  MAX_MOTES_PER_DWA,
  MAX_ARCHITECT_BLOCKS,
  MAX_NAILS_PER_DWA,
} from './clusters/dustWeaverArchitectConfig';
import {
  MAX_VOID_SINGULARITIES,
  MAX_MOTES_PER_VS,
  MAX_PROJS_PER_VSP,
} from './clusters/voidSingularityConfig';
import {
  MAX_DUST_LEECHES,
  MAX_DUST_ECHOES,
  MAX_MOTES_PER_DL,
  MAX_MOTES_PER_DE,
} from './clusters/dustLeechConfig';
import {
  MAX_CW_FIRE_DUST,
  MAX_CW_PROJECTILES,
  MAX_CW_SMOKE,
  MAX_CW_TELEGRAPHS,
} from './clusters/crimsonWizardConfig';
import {
  MAX_PHANTASMAL_BLOCKS,
  MAX_PHANTASMAL_SHOCKWAVES,
  MAX_PHANTASMAL_SPIKES,
  MAX_VOID_LASERS,
  MAX_VOID_LASER_DUST,
  MAX_VOID_SPHERES,
} from './clusters/heraldConfig';
import { MAX_ICE_SPIKES } from './clusters/iceWizardConfig';
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

/** Maximum number of Dust Constellation Sentinel enemies per room. */
export const MAX_DUST_CONSTELLATIONS = 6;
/** Maximum motes per constellation instance (matches the large variant mote count). */
export const MAX_MOTES_PER_CONSTELLATION = 10;

// Orbital Dust Core capacity constants are imported from config and re-exported here
// so all consumers can import from worldHazardState / world.ts as usual.
export {
  MAX_ORBITAL_DUST_CORES,
  MAX_RINGS_PER_ODC,
  MAX_MOTES_PER_RING_ODC,
  MOTES_PER_ODC_SLOT,
} from './clusters/orbitalDustCoreConfig';

export {
  MAX_DUST_BLOCK_MIMICS,
  MAX_MOTES_PER_DBM,
} from './clusters/dustBlockMimicConfig';

export {
  MAX_DUST_WEAVER_ARCHITECTS,
  MAX_MOTES_PER_DWA,
  MAX_ARCHITECT_BLOCKS,
  MAX_NAILS_PER_DWA,
} from './clusters/dustWeaverArchitectConfig';

export {
  MAX_VOID_SINGULARITIES,
  MAX_MOTES_PER_VS,
  MAX_PROJS_PER_VSP,
} from './clusters/voidSingularityConfig';

export {
  MAX_DUST_LEECHES,
  MAX_DUST_ECHOES,
  MAX_MOTES_PER_DL,
  MAX_MOTES_PER_DE,
} from './clusters/dustLeechConfig';
export {
  MAX_CW_FIRE_DUST,
  MAX_CW_PROJECTILES,
  MAX_CW_SMOKE,
  MAX_CW_TELEGRAPHS,
} from './clusters/crimsonWizardConfig';
export {
  MAX_PHANTASMAL_BLOCKS,
  MAX_PHANTASMAL_SHOCKWAVES,
  MAX_PHANTASMAL_SPIKES,
  MAX_VOID_LASERS,
  MAX_VOID_LASER_DUST,
  MAX_VOID_SPHERES,
} from './clusters/heraldConfig';
export { MAX_ICE_SPIKES } from './clusters/iceWizardConfig';

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
  /**
   * Footprint size of each spike, in blocks (1 or 2). Determines both the
   * collision AABB and which template variation pool (`1x1 spike` vs
   * `2x2 spike`) is used for rendering.
   */
  spikeSizeBlocks: Uint8Array;
  /**
   * Per-spike block-theme override index (via `blockThemeToIndex`), or
   * `WALL_THEME_DEFAULT_INDEX` to use the room's active block theme.
   */
  spikeBlockThemeIndex: Uint8Array;
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

  // ── Kinetic blocks ─────────────────────────────────────────────────────────
  /** Number of kinetic blocks loaded in the current room. */
  kineticBlockCount: number;
  /** Left edge X of each kinetic block (world units). */
  kineticBlockXWorld: Float32Array;
  /** Top edge Y of each kinetic block (world units). */
  kineticBlockYWorld: Float32Array;
  /** Width of each kinetic block (world units). */
  kineticBlockWWorld: Float32Array;
  /** Height of each kinetic block (world units). */
  kineticBlockHWorld: Float32Array;
  /** Per-block animation phase [0..255], advanced each tick by tickKineticBlocks. */
  kineticBlockAnimPhase: Uint8Array;

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
  /** 1 if the player was in water on the previous tick (for entry-event detection). */
  isPlayerWasInWaterLastTickFlag: 0 | 1;
  /** Submersion ratio 0–1: 0 = just touching surface, 1 = fully submerged. */
  playerWaterSubmersionRatio: number;
  /** Speed magnitude (wu/s) the player had when they entered water this tick. 0 when not entering. */
  playerWaterEntrySpeedWorld: number;
  /**
   * Y coordinate (world units) of the liquid surface the player is currently in.
   * 0 when not in water. Used for debug display and depth factor computation.
   */
  playerBuoyancySurfaceYWorld: number;
  /**
   * Depth factor applied to buoyancy this tick [0–1].
   * Equals the submersion ratio — 0 near the surface, 1 when fully submerged.
   * 0 when not in water.
   */
  playerBuoyancyDepthFactor: number;

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

  // ── Dust Constellation Sentinel ─────────────────────────────────────────────
  /**
   * X world position of each mote.
   * Layout: [slotIndex * MAX_MOTES_PER_CONSTELLATION + moteIndex].
   * Total length = MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION.
   */
  constellationMoteXWorld: Float32Array;
  /** Y world position of each mote. Same layout as constellationMoteXWorld. */
  constellationMoteYWorld: Float32Array;
  /** X velocity of each mote (world units/s). Same layout. */
  constellationMoteVelXWorld: Float32Array;
  /** Y velocity of each mote (world units/s). Same layout. */
  constellationMoteVelYWorld: Float32Array;
  /** Formation target local X offset per mote. Set during gather/telegraph. */
  constellationMoteTargetLocalX: Float32Array;
  /** Formation target local Y offset per mote. */
  constellationMoteTargetLocalY: Float32Array;
  /** Per-mote brightness pulse phase (radians). */
  constellationMotePulsePhaseRad: Float32Array;

  // ── Orbital Dust Core ─────────────────────────────────────────────────────
  /**
   * Current orbit angle per mote (radians).
   * Layout: [slotIndex * MOTES_PER_ODC_SLOT + ringIndex * MAX_MOTES_PER_RING_ODC + moteIndex].
   * Total length = MAX_ORBITAL_DUST_CORES * MOTES_PER_ODC_SLOT.
   */
  odcMoteAngleRad: Float32Array;
  /** Current orbital radius per mote (world units). Same layout as odcMoteAngleRad. */
  odcMoteRadiusWorld: Float32Array;
  /** Target orbital radius per mote (world units). Same layout. */
  odcMoteTargetRadiusWorld: Float32Array;
  /** Alive flag per mote (1=alive, 0=dead). Same layout. */
  odcMoteAliveFlag: Uint8Array;
  /** Per-mote brightness pulse phase (radians). Same layout. */
  odcMotePulsePhaseRad: Float32Array;

  // ── Dust Block Mimic ─────────────────────────────────────────────────────
  /**
   * X world position of each mote.
   * Layout: [slotIndex * MAX_MOTES_PER_DBM + moteIndex].
   * Total length = MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM.
   */
  dbmMoteXWorld: Float32Array;
  /** Y world position of each mote. Same layout as dbmMoteXWorld. */
  dbmMoteYWorld: Float32Array;
  /** X velocity per mote (world units/tick). Same layout. */
  dbmMoteVelXWorld: Float32Array;
  /** Y velocity per mote (world units/tick). Same layout. */
  dbmMoteVelYWorld: Float32Array;
  /** Formation target local X offset per mote (relative to swarm centre). */
  dbmMoteTargetLocalX: Float32Array;
  /** Formation target local Y offset per mote. */
  dbmMoteTargetLocalY: Float32Array;
  /** Per-mote brightness pulse phase (radians). */
  dbmMotePulsePhaseRad: Float32Array;

  // ── Dust Weaver Architect mote arrays ────────────────────────────────────────
  /**
   * Orbit angle per mote (radians).
   * Layout: [slotIndex * MAX_MOTES_PER_DWA + moteIndex].
   * Total length = MAX_DUST_WEAVER_ARCHITECTS * MAX_MOTES_PER_DWA.
   */
  dwaMoteAngleRad: Float32Array;
  /** Per-mote brightness pulse phase (radians). Same layout as dwaMoteAngleRad. */
  dwaMotePulsePhaseRad: Float32Array;

  // ── Void Singularity mote arrays ─────────────────────────────────────────────
  /**
   * Inward-spiral mote angle per mote (radians).
   * Layout: [slotIndex * MAX_MOTES_PER_VS + moteIndex].
   * Total length = MAX_VOID_SINGULARITIES * MAX_MOTES_PER_VS.
   */
  vsMoteAngleRad: Float32Array;
  /** Per-mote orbital radius (world units). Same layout as vsMoteAngleRad. */
  vsMoteRadiusWorld: Float32Array;
  /** Per-mote brightness pulse phase (radians). Same layout as vsMoteAngleRad. */
  vsMotePulsePhaseRad: Float32Array;

  // ── Void Singularity Pair projectile arrays ───────────────────────────────────
  /**
   * X position of each white-hole projectile (world units).
   * Layout: [slotIndex * MAX_PROJS_PER_VSP + projIndex].
   * Total length = MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP.
   */
  vspProjXWorld: Float32Array;
  /** Y position of each white-hole projectile (world units). */
  vspProjYWorld: Float32Array;
  /** X velocity of each projectile (world units/tick). */
  vspProjVelXWorld: Float32Array;
  /** Y velocity of each projectile (world units/tick). */
  vspProjVelYWorld: Float32Array;
  /** Remaining lifetime ticks of each projectile. */
  vspProjLifetimeTicks: Float32Array;
  /** 1 if the projectile is alive, 0 if dead/inactive. */
  vspProjAliveFlag: Uint8Array;

  // ── Architect Blocks ─────────────────────────────────────────────────────────
  /** Number of active Architect Block slots (0..MAX_ARCHITECT_BLOCKS). */
  architectBlockCount: number;
  /** Center X of each Architect Block (world units). */
  architectBlockXWorld: Float32Array;
  /** Center Y of each Architect Block (world units). */
  architectBlockYWorld: Float32Array;
  /** Current health of each block. */
  architectBlockHealth: Uint8Array;
  /** Max health of each block (set at spawn; used for damage visualisation). */
  architectBlockMaxHealth: Uint8Array;
  /** Remaining lifetime ticks before the block begins crumbling. */
  architectBlockLifetimeTicks: Uint16Array;
  /** Grace ticks remaining (block cannot damage player while > 0). */
  architectBlockGraceTicks: Uint8Array;
  /** Forming ticks remaining (0 = fully formed). Counts down from DWA_BLOCK_FORM_TICKS. */
  architectBlockFormTicks: Uint8Array;
  /** Crumble ticks remaining (counting down; block removed when it hits 0 from crumble state). */
  architectBlockCrumbleTicks: Uint8Array;
  /**
   * Visual state: 0 = forming, 1 = active, 2 = crumbling.
   * Transitions: 0→1 when formTicks==0; 1→2 when lifetime==0 or health==0.
   */
  architectBlockState: Uint8Array;
  /** 1 if this block slot is in use. */
  isArchitectBlockAliveFlag: Uint8Array;
  /** Slot index of the owning Architect (-1 = none / orphaned). */
  architectBlockOwnerSlot: Int8Array;

  // ── Dust Nail projectiles ─────────────────────────────────────────────────────
  /**
   * X position of each Dust Nail projectile (world units).
   * Layout: [slotIndex * MAX_NAILS_PER_DWA + nailIndex].
   * Total length = MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA.
   */
  dwaNailXWorld: Float32Array;
  /** Y position of each Dust Nail (world units). Same layout as dwaNailXWorld. */
  dwaNailYWorld: Float32Array;
  /** X velocity of each Dust Nail (world units/tick). */
  dwaNailVelXWorld: Float32Array;
  /** Y velocity of each Dust Nail (world units/tick). */
  dwaNailVelYWorld: Float32Array;
  /** Remaining lifetime ticks of each Dust Nail. */
  dwaNailLifetimeTicks: Uint16Array;
  /** 1 if this nail slot is active. */
  isDwaNailAliveFlag: Uint8Array;

  // ── Dust Leech mote arrays ─────────────────────────────────────────────────
  /** Per-mote angle (radians). Length = MAX_DUST_LEECHES * MAX_MOTES_PER_DL. */
  dlMoteAngleRad: Float32Array;
  /** Per-mote pulse phase (radians). Same layout as dlMoteAngleRad. */
  dlMotePulsePhaseRad: Float32Array;

  // ── Dust Echo mote arrays ──────────────────────────────────────────────────
  /** Per-mote body offset X (world units). Length = MAX_DUST_ECHOES * MAX_MOTES_PER_DE. */
  deMoteOffsetXWorld: Float32Array;
  /** Per-mote body offset Y (world units). Same layout. */
  deMoteOffsetYWorld: Float32Array;
  /** Per-mote pulse phase (radians). Same layout. */
  deMotePulsePhaseRad: Float32Array;

  // Crimson Wizard fire/smoke/projectile buffers.
  cwFireDustXWorld: Float32Array;
  cwFireDustYWorld: Float32Array;
  cwFireDustVelXWorld: Float32Array;
  cwFireDustVelYWorld: Float32Array;
  cwFireDustAgeTicks: Uint16Array;
  cwFireDustLifetimeTicks: Uint16Array;
  cwFireDustColorIndex: Uint8Array;
  cwFireDustAliveFlag: Uint8Array;
  cwSmokeXWorld: Float32Array;
  cwSmokeYWorld: Float32Array;
  cwSmokeVelXWorld: Float32Array;
  cwSmokeVelYWorld: Float32Array;
  cwSmokeAgeTicks: Uint16Array;
  cwSmokeLifetimeTicks: Uint16Array;
  cwSmokeAliveFlag: Uint8Array;
  cwProjectileXWorld: Float32Array;
  cwProjectileYWorld: Float32Array;
  cwProjectileTargetXWorld: Float32Array;
  cwProjectileTargetYWorld: Float32Array;
  cwProjectileVelXWorld: Float32Array;
  cwProjectileVelYWorld: Float32Array;
  cwProjectileLifetimeTicks: Uint16Array;
  cwProjectileType: Uint8Array;
  cwProjectileAliveFlag: Uint8Array;
  cwProjectileHitFlag: Uint8Array;
  cwTelegraphXWorld: Float32Array;
  cwTelegraphYWorld: Float32Array;
  cwTelegraphHalfSizeWorld: Float32Array;
  cwTelegraphTicksLeft: Uint16Array;
  cwTelegraphMaxTicks: Uint16Array;
  cwTelegraphKind: Uint8Array;
  cwTelegraphAliveFlag: Uint8Array;

  // The Herald — Void Sphere projectile buffers (pass through walls/terrain).
  voidSphereXWorld: Float32Array;
  voidSphereYWorld: Float32Array;
  voidSphereVelXWorld: Float32Array;
  voidSphereVelYWorld: Float32Array;
  voidSphereAgeTicks: Uint16Array;
  voidSpherePulsePhaseRad: Float32Array;
  voidSphereAliveFlag: Uint8Array;

  // The Void Herald - Phantasmal Geometry buffers.
  phantasmalSpikeXWorld: Float32Array;
  phantasmalSpikeYWorld: Float32Array;
  /** Direction each spike points: 0=up, 1=down, 2=left, 3=right. */
  phantasmalSpikeDirection: Uint8Array;
  phantasmalSpikeAgeTicks: Uint16Array;
  phantasmalSpikeAliveFlag: Uint8Array;
  phantasmalBlockXWorld: Float32Array;
  phantasmalBlockYWorld: Float32Array;
  phantasmalBlockAgeTicks: Uint16Array;
  phantasmalBlockFlashTicks: Uint8Array;
  phantasmalBlockAliveFlag: Uint8Array;
  phantasmalShockwaveXWorld: Float32Array;
  phantasmalShockwaveYWorld: Float32Array;
  phantasmalShockwaveAgeTicks: Uint16Array;
  phantasmalShockwaveAliveFlag: Uint8Array;
  voidLaserStartXWorld: Float32Array;
  voidLaserStartYWorld: Float32Array;
  voidLaserEndXWorld: Float32Array;
  voidLaserEndYWorld: Float32Array;
  voidLaserVisibleStartXWorld: Float32Array;
  voidLaserVisibleStartYWorld: Float32Array;
  voidLaserVisibleEndXWorld: Float32Array;
  voidLaserVisibleEndYWorld: Float32Array;
  voidLaserAgeTicks: Uint16Array;
  /** 0=alive, 1=gold-safe dissipating, 2=purple-danger dissipating. */
  voidLaserDissipationKind: Uint8Array;
  voidLaserAliveFlag: Uint8Array;
  voidLaserDustXWorld: Float32Array;
  voidLaserDustYWorld: Float32Array;
  voidLaserDustVelXWorld: Float32Array;
  voidLaserDustVelYWorld: Float32Array;
  voidLaserDustAgeTicks: Uint16Array;
  /** 0=purple void dust, 1=gold deactivation dust. */
  voidLaserDustKind: Uint8Array;
  voidLaserDustAliveFlag: Uint8Array;

  // Ice Wizard transient floor spikes.
  iceSpikeXWorld: Float32Array;
  iceSpikeBaseYWorld: Float32Array;
  iceSpikeAgeTicks: Uint16Array;
  iceSpikeDelayTicks: Uint16Array;
  iceSpikeAliveFlag: Uint8Array;
  iceSpikeHitPlayerFlag: Uint8Array;
}

/** Returns the default-initialised hazard/critter state for use in createWorldState(). */
export function createHazardWorldState(): HazardWorldState {
  return {
    spikeCount:                    0,
    spikeXWorld:                   new Float32Array(MAX_SPIKES),
    spikeYWorld:                   new Float32Array(MAX_SPIKES),
    spikeDirection:                new Uint8Array(MAX_SPIKES),
    spikeSizeBlocks:               new Uint8Array(MAX_SPIKES),
    spikeBlockThemeIndex:          new Uint8Array(MAX_SPIKES),
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
    kineticBlockCount:     0,
    kineticBlockXWorld:    new Float32Array(MAX_KINETIC_BLOCKS),
    kineticBlockYWorld:    new Float32Array(MAX_KINETIC_BLOCKS),
    kineticBlockWWorld:    new Float32Array(MAX_KINETIC_BLOCKS),
    kineticBlockHWorld:    new Float32Array(MAX_KINETIC_BLOCKS),
    kineticBlockAnimPhase: new Uint8Array(MAX_KINETIC_BLOCKS),
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
    isPlayerWasInWaterLastTickFlag: 0,
    playerWaterSubmersionRatio:    0,
    playerWaterEntrySpeedWorld:    0,
    playerBuoyancySurfaceYWorld:   0,
    playerBuoyancyDepthFactor:     0,
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
    constellationMoteXWorld:        new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    constellationMoteYWorld:        new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    constellationMoteVelXWorld:     new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    constellationMoteVelYWorld:     new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    constellationMoteTargetLocalX:  new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    constellationMoteTargetLocalY:  new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    constellationMotePulsePhaseRad: new Float32Array(MAX_DUST_CONSTELLATIONS * MAX_MOTES_PER_CONSTELLATION),
    odcMoteAngleRad:              new Float32Array(MAX_ORBITAL_DUST_CORES * MOTES_PER_ODC_SLOT),
    odcMoteRadiusWorld:           new Float32Array(MAX_ORBITAL_DUST_CORES * MOTES_PER_ODC_SLOT),
    odcMoteTargetRadiusWorld:     new Float32Array(MAX_ORBITAL_DUST_CORES * MOTES_PER_ODC_SLOT),
    odcMoteAliveFlag:             new Uint8Array(MAX_ORBITAL_DUST_CORES * MOTES_PER_ODC_SLOT),
    odcMotePulsePhaseRad:         new Float32Array(MAX_ORBITAL_DUST_CORES * MOTES_PER_ODC_SLOT),
    dbmMoteXWorld:                new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dbmMoteYWorld:                new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dbmMoteVelXWorld:             new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dbmMoteVelYWorld:             new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dbmMoteTargetLocalX:          new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dbmMoteTargetLocalY:          new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dbmMotePulsePhaseRad:         new Float32Array(MAX_DUST_BLOCK_MIMICS * MAX_MOTES_PER_DBM),
    dwaMoteAngleRad:              new Float32Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_MOTES_PER_DWA),
    dwaMotePulsePhaseRad:         new Float32Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_MOTES_PER_DWA),
    vsMoteAngleRad:               new Float32Array(MAX_VOID_SINGULARITIES * MAX_MOTES_PER_VS),
    vsMoteRadiusWorld:            new Float32Array(MAX_VOID_SINGULARITIES * MAX_MOTES_PER_VS),
    vsMotePulsePhaseRad:          new Float32Array(MAX_VOID_SINGULARITIES * MAX_MOTES_PER_VS),
    vspProjXWorld:                new Float32Array(MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP),
    vspProjYWorld:                new Float32Array(MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP),
    vspProjVelXWorld:             new Float32Array(MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP),
    vspProjVelYWorld:             new Float32Array(MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP),
    vspProjLifetimeTicks:         new Float32Array(MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP),
    vspProjAliveFlag:             new Uint8Array(MAX_VOID_SINGULARITIES * MAX_PROJS_PER_VSP),
    architectBlockCount:          0,
    architectBlockXWorld:         new Float32Array(MAX_ARCHITECT_BLOCKS),
    architectBlockYWorld:         new Float32Array(MAX_ARCHITECT_BLOCKS),
    architectBlockHealth:         new Uint8Array(MAX_ARCHITECT_BLOCKS),
    architectBlockMaxHealth:      new Uint8Array(MAX_ARCHITECT_BLOCKS),
    architectBlockLifetimeTicks:  new Uint16Array(MAX_ARCHITECT_BLOCKS),
    architectBlockGraceTicks:     new Uint8Array(MAX_ARCHITECT_BLOCKS),
    architectBlockFormTicks:      new Uint8Array(MAX_ARCHITECT_BLOCKS),
    architectBlockCrumbleTicks:   new Uint8Array(MAX_ARCHITECT_BLOCKS),
    architectBlockState:          new Uint8Array(MAX_ARCHITECT_BLOCKS),
    isArchitectBlockAliveFlag:    new Uint8Array(MAX_ARCHITECT_BLOCKS),
    architectBlockOwnerSlot:      new Int8Array(MAX_ARCHITECT_BLOCKS).fill(-1),
    dwaNailXWorld:                new Float32Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA),
    dwaNailYWorld:                new Float32Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA),
    dwaNailVelXWorld:             new Float32Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA),
    dwaNailVelYWorld:             new Float32Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA),
    dwaNailLifetimeTicks:         new Uint16Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA),
    isDwaNailAliveFlag:           new Uint8Array(MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA),
    dlMoteAngleRad:               new Float32Array(MAX_DUST_LEECHES * MAX_MOTES_PER_DL),
    dlMotePulsePhaseRad:          new Float32Array(MAX_DUST_LEECHES * MAX_MOTES_PER_DL),
    deMoteOffsetXWorld:           new Float32Array(MAX_DUST_ECHOES * MAX_MOTES_PER_DE),
    deMoteOffsetYWorld:           new Float32Array(MAX_DUST_ECHOES * MAX_MOTES_PER_DE),
    deMotePulsePhaseRad:          new Float32Array(MAX_DUST_ECHOES * MAX_MOTES_PER_DE),
    cwFireDustXWorld:             new Float32Array(MAX_CW_FIRE_DUST),
    cwFireDustYWorld:             new Float32Array(MAX_CW_FIRE_DUST),
    cwFireDustVelXWorld:          new Float32Array(MAX_CW_FIRE_DUST),
    cwFireDustVelYWorld:          new Float32Array(MAX_CW_FIRE_DUST),
    cwFireDustAgeTicks:           new Uint16Array(MAX_CW_FIRE_DUST),
    cwFireDustLifetimeTicks:      new Uint16Array(MAX_CW_FIRE_DUST),
    cwFireDustColorIndex:         new Uint8Array(MAX_CW_FIRE_DUST),
    cwFireDustAliveFlag:          new Uint8Array(MAX_CW_FIRE_DUST),
    cwSmokeXWorld:                new Float32Array(MAX_CW_SMOKE),
    cwSmokeYWorld:                new Float32Array(MAX_CW_SMOKE),
    cwSmokeVelXWorld:             new Float32Array(MAX_CW_SMOKE),
    cwSmokeVelYWorld:             new Float32Array(MAX_CW_SMOKE),
    cwSmokeAgeTicks:              new Uint16Array(MAX_CW_SMOKE),
    cwSmokeLifetimeTicks:         new Uint16Array(MAX_CW_SMOKE),
    cwSmokeAliveFlag:             new Uint8Array(MAX_CW_SMOKE),
    cwProjectileXWorld:           new Float32Array(MAX_CW_PROJECTILES),
    cwProjectileYWorld:           new Float32Array(MAX_CW_PROJECTILES),
    cwProjectileTargetXWorld:     new Float32Array(MAX_CW_PROJECTILES),
    cwProjectileTargetYWorld:     new Float32Array(MAX_CW_PROJECTILES),
    cwProjectileVelXWorld:        new Float32Array(MAX_CW_PROJECTILES),
    cwProjectileVelYWorld:        new Float32Array(MAX_CW_PROJECTILES),
    cwProjectileLifetimeTicks:    new Uint16Array(MAX_CW_PROJECTILES),
    cwProjectileType:             new Uint8Array(MAX_CW_PROJECTILES),
    cwProjectileAliveFlag:        new Uint8Array(MAX_CW_PROJECTILES),
    cwProjectileHitFlag:          new Uint8Array(MAX_CW_PROJECTILES),
    cwTelegraphXWorld:            new Float32Array(MAX_CW_TELEGRAPHS),
    cwTelegraphYWorld:            new Float32Array(MAX_CW_TELEGRAPHS),
    cwTelegraphHalfSizeWorld:     new Float32Array(MAX_CW_TELEGRAPHS),
    cwTelegraphTicksLeft:         new Uint16Array(MAX_CW_TELEGRAPHS),
    cwTelegraphMaxTicks:          new Uint16Array(MAX_CW_TELEGRAPHS),
    cwTelegraphKind:              new Uint8Array(MAX_CW_TELEGRAPHS),
    cwTelegraphAliveFlag:         new Uint8Array(MAX_CW_TELEGRAPHS),
    voidSphereXWorld:             new Float32Array(MAX_VOID_SPHERES),
    voidSphereYWorld:             new Float32Array(MAX_VOID_SPHERES),
    voidSphereVelXWorld:          new Float32Array(MAX_VOID_SPHERES),
    voidSphereVelYWorld:          new Float32Array(MAX_VOID_SPHERES),
    voidSphereAgeTicks:           new Uint16Array(MAX_VOID_SPHERES),
    voidSpherePulsePhaseRad:      new Float32Array(MAX_VOID_SPHERES),
    voidSphereAliveFlag:          new Uint8Array(MAX_VOID_SPHERES),
    phantasmalSpikeXWorld:        new Float32Array(MAX_PHANTASMAL_SPIKES),
    phantasmalSpikeYWorld:        new Float32Array(MAX_PHANTASMAL_SPIKES),
    phantasmalSpikeDirection:     new Uint8Array(MAX_PHANTASMAL_SPIKES),
    phantasmalSpikeAgeTicks:      new Uint16Array(MAX_PHANTASMAL_SPIKES),
    phantasmalSpikeAliveFlag:     new Uint8Array(MAX_PHANTASMAL_SPIKES),
    phantasmalBlockXWorld:        new Float32Array(MAX_PHANTASMAL_BLOCKS),
    phantasmalBlockYWorld:        new Float32Array(MAX_PHANTASMAL_BLOCKS),
    phantasmalBlockAgeTicks:      new Uint16Array(MAX_PHANTASMAL_BLOCKS),
    phantasmalBlockFlashTicks:    new Uint8Array(MAX_PHANTASMAL_BLOCKS),
    phantasmalBlockAliveFlag:     new Uint8Array(MAX_PHANTASMAL_BLOCKS),
    phantasmalShockwaveXWorld:    new Float32Array(MAX_PHANTASMAL_SHOCKWAVES),
    phantasmalShockwaveYWorld:    new Float32Array(MAX_PHANTASMAL_SHOCKWAVES),
    phantasmalShockwaveAgeTicks:  new Uint16Array(MAX_PHANTASMAL_SHOCKWAVES),
    phantasmalShockwaveAliveFlag: new Uint8Array(MAX_PHANTASMAL_SHOCKWAVES),
    voidLaserStartXWorld:         new Float32Array(MAX_VOID_LASERS),
    voidLaserStartYWorld:         new Float32Array(MAX_VOID_LASERS),
    voidLaserEndXWorld:           new Float32Array(MAX_VOID_LASERS),
    voidLaserEndYWorld:           new Float32Array(MAX_VOID_LASERS),
    voidLaserVisibleStartXWorld:  new Float32Array(MAX_VOID_LASERS),
    voidLaserVisibleStartYWorld:  new Float32Array(MAX_VOID_LASERS),
    voidLaserVisibleEndXWorld:    new Float32Array(MAX_VOID_LASERS),
    voidLaserVisibleEndYWorld:    new Float32Array(MAX_VOID_LASERS),
    voidLaserAgeTicks:            new Uint16Array(MAX_VOID_LASERS),
    voidLaserDissipationKind:     new Uint8Array(MAX_VOID_LASERS),
    voidLaserAliveFlag:           new Uint8Array(MAX_VOID_LASERS),
    voidLaserDustXWorld:          new Float32Array(MAX_VOID_LASER_DUST),
    voidLaserDustYWorld:          new Float32Array(MAX_VOID_LASER_DUST),
    voidLaserDustVelXWorld:       new Float32Array(MAX_VOID_LASER_DUST),
    voidLaserDustVelYWorld:       new Float32Array(MAX_VOID_LASER_DUST),
    voidLaserDustAgeTicks:        new Uint16Array(MAX_VOID_LASER_DUST),
    voidLaserDustKind:            new Uint8Array(MAX_VOID_LASER_DUST),
    voidLaserDustAliveFlag:       new Uint8Array(MAX_VOID_LASER_DUST),
    iceSpikeXWorld:               new Float32Array(MAX_ICE_SPIKES),
    iceSpikeBaseYWorld:           new Float32Array(MAX_ICE_SPIKES),
    iceSpikeAgeTicks:             new Uint16Array(MAX_ICE_SPIKES),
    iceSpikeDelayTicks:           new Uint16Array(MAX_ICE_SPIKES),
    iceSpikeAliveFlag:            new Uint8Array(MAX_ICE_SPIKES),
    iceSpikeHitPlayerFlag:        new Uint8Array(MAX_ICE_SPIKES),
  };
}
