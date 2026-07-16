/**
 * roomElementDefs.ts — Room element (hazard, collectible, decoration, dialogue) type definitions.
 *
 * Extracted from roomDef.ts. Contains all room element interface and type
 * definitions except for RoomEnemyDef, RoomWallDef, RoomTransitionDef, and
 * RoomDef itself (which remain in roomDef.ts).
 *
 * All positions and sizes are in **block units**.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { BlockTheme } from './blockTheme';

// ── Hazard types ──────────────────────────────────────────────────────────────

/** Direction a spike faces (the pointy end). */
export type SpikeDirection = 'up' | 'down' | 'left' | 'right';

/** Footprint size of a spike, in blocks. Defaults to `'1x1'` when omitted. */
export type SpikeSize = '1x1' | '2x2';

/** A spike tile placed in the room. */
export interface RoomSpikeDef {
  xBlock: number;
  yBlock: number;
  /** Direction the spike points (the dangerous end). */
  direction: SpikeDirection;
  /** Footprint size in blocks. Defaults to `'1x1'` when omitted. */
  size?: SpikeSize;
  /** Block theme the spike's sprite is cut from. Defaults to the room's active theme when omitted. */
  blockTheme?: BlockTheme;
}

/** A springboard tile that bounces the player upward. */
export interface RoomSpringboardDef {
  xBlock: number;
  yBlock: number;
}

/** An axis-aligned rectangular zone (water or lava). */
export interface RoomZoneDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

/** A breakable block that shatters when the player hits it with high momentum. */
export interface RoomBreakableBlockDef {
  xBlock: number;
  yBlock: number;
  /**
   * Phase 2B: logical placement group id. Cells sharing the same
   * `groupId` (and the same room) belong to one multi-cell breakable
   * placement (e.g. all 4 cells of a 2x2 fragile custom block) and are
   * destroyed atomically as a unit when any one cell is struck. Omitted
   * (undefined) for ordinary single-cell breakable blocks — identical to
   * pre-Phase-2B behavior. Group ids only need to be unique within a room.
   */
  groupId?: number;
  /**
   * Phase 2B hardening: the wall theme this breakable cell's wall should use
   * (defaults to the standard 'blackRock' wall when omitted, matching every
   * pre-Phase-2B breakable block). Lets a fragile custom block that also
   * selects the `slippery` friction preset actually get the ice-surface wall
   * on its breakable-pathway wall — previously this combination silently
   * lost its friction preset because gameRoomHazards.ts hardcoded the
   * default theme for every breakable-block wall.
   */
  blockTheme?: 'blackRock' | 'ice';
  /**
   * Phase 2C: the resolved material-response preset for this breakable cell,
   * threaded from the originating custom block's `properties.materialResponse`
   * (see resolveMaterialResponse in customBlockProperties.ts). Omitted (defaults
   * to 'stone' at hazard-load time) for pre-Phase-2C data. Purely a break-sound
   * and break-particle selector — it never adds executable content or asset
   * paths to room JSON.
   */
  materialResponse?: 'stone' | 'wood' | 'metal';
  /**
   * Phase 2E: the resolved break-resistance tier for this breakable cell,
   * threaded from the originating custom block's `properties.breakResistance`.
   * Omitted (defaults to 'standard' — byte-identical to the pre-Phase-2E
   * global momentum threshold — at hazard-load time) for pre-Phase-2E data
   * and for built-in (non-custom-block) breakable blocks. All cells sharing
   * one `groupId` always carry the same tier — it is resolved once per
   * placement, not per cell.
   */
  breakResistance?: 'weak' | 'standard' | 'reinforced';
  /**
   * Phase 2F: the resolved wind-transmission tier for this breakable cell,
   * threaded from the originating custom block's `properties.windResponse`
   * when it is 'dampen' or 'block' (never 'passThrough' — see
   * isEligibleForWindTransmission in customBlockProperties.ts). Used ONLY to
   * invalidate this cell's native-pixel wind-mask region when it is destroyed
   * (see destroyBreakableBlockCell in sim/hazards.ts) — the initial mask
   * itself is built once at room-load time from `RoomDef.windTransmissionBlocks`,
   * independently of this per-cell field. Omitted for pre-Phase-2F data and
   * for built-in (non-custom-block) breakable blocks, matching every other
   * per-cell optional field above.
   */
  windResponse?: 'dampen' | 'block';
  /**
   * Phase 2G: the resolved liquid-interaction tier for this breakable cell,
   * threaded from the originating custom block's `properties.liquidInteraction`
   * when it is 'seal' or 'drain' (never 'none' — see
   * isEligibleForLiquidInteraction in customBlockProperties.ts). Used ONLY to
   * invalidate this cell's native-pixel liquid-mask region when it is
   * destroyed (see destroyBreakableBlockCell in sim/hazards.ts) — the initial
   * mask itself is built once at room-load time from
   * `RoomDef.liquidInteractionBlocks`, independently of this per-cell field.
   * Omitted for pre-Phase-2G data and for built-in (non-custom-block)
   * breakable blocks, matching every other per-cell optional field above.
   */
  liquidInteraction?: 'seal' | 'drain';
}

/**
 * Phase 2F: a solid custom-block placement that dampens or blocks
 * pixel-material wind transmission (sand/water/sandstone wind — see
 * PixelMaterialSystem.applyWindForce and sim/pixelMaterials/customBlockWindMask.ts).
 * Registered ONCE PER PLACEMENT (not per cell, unlike RoomBreakableBlockDef/
 * RoomContactDamageBlockDef) — the wind mask is a static native-pixel region
 * marked at room-load time from the placement's full footprint, not a
 * per-tick runtime detection array, so there is no need to decompose a 2x2
 * placement into 4 cell entries sharing a group id. Present for BOTH fragile
 * and indestructible solid blocks — breakability is unrelated to whether a
 * block modifies wind transmission.
 */
export interface RoomWindTransmissionBlockDef {
  /** Left edge of the placement's footprint (block units). */
  xBlock: number;
  /** Top edge of the placement's footprint (block units). */
  yBlock: number;
  /** Footprint width (block units) — 1 or 2. */
  wBlock: number;
  /** Footprint height (block units) — 1 or 2. */
  hBlock: number;
  /** Which engine-owned wind-transmission tier this placement applies. */
  tier: 'dampen' | 'block';
}

/**
 * Phase 2G: a custom-block placement that seals or drains pixel-material
 * liquid (currently water — see PixelMaterialSystem.stepLiquidParticle and
 * sim/pixelMaterials/customBlockLiquidMask.ts). Registered ONCE PER PLACEMENT
 * (not per cell), mirroring RoomWindTransmissionBlockDef — the liquid mask is
 * a static native-pixel region marked at room-load time from the placement's
 * full footprint. UNLIKE RoomWindTransmissionBlockDef, this is present for
 * ANY collision preset (solid, one-way, or non-solid) — liquid interaction
 * has no solid-collision requirement (see isEligibleForLiquidInteraction).
 */
export interface RoomLiquidInteractionBlockDef {
  /** Left edge of the placement's footprint (block units). */
  xBlock: number;
  /** Top edge of the placement's footprint (block units). */
  yBlock: number;
  /** Footprint width (block units) — 1 or 2. */
  wBlock: number;
  /** Footprint height (block units) — 1 or 2. */
  hBlock: number;
  /** Which engine-owned liquid-interaction tier this placement applies. */
  tier: 'seal' | 'drain';
}

/**
 * Phase 2D: a solid custom-block cell that damages the player on contact.
 * Independent of `RoomBreakableBlockDef` — a placement may appear in neither,
 * either, or both arrays (a fragile+damaging block appears in both). Purely a
 * damage-tier selector: never a raw damage number, callback, or asset path.
 */
export interface RoomContactDamageBlockDef {
  xBlock: number;
  yBlock: number;
  /** Which engine-owned contact-damage tier this cell applies. */
  tier: 'low' | 'high';
  /**
   * Logical placement group id, analogous to `RoomBreakableBlockDef.groupId`.
   * Cells sharing the same `groupId` belong to one multi-cell (2x2) damaging
   * placement and must be treated as a single logical damage owner — struck
   * once per simulation update regardless of how many of its cells the player
   * overlaps. Omitted (undefined) for ordinary single-cell (1x1) placements.
   * This id space is independent of `RoomBreakableBlockDef.groupId` — a
   * fragile+damaging 2x2 block gets its own damage groupId separate from its
   * breakable groupId, since the two arrays are unrelated and compared only
   * against their own entries.
   */
  groupId?: number;
}

/**
 * Which elemental substance a crumble block is specifically weak to.
 * - `'normal'`    — standard crumble block (no elemental weakness).
 * - `'fire'`      — weak to fire.
 * - `'water'`     — weak to water.
 * - `'void'`      — weak to void energy.
 * - `'ice'`       — weak to ice.
 * - `'lightning'` — weak to lightning.
 * - `'poison'`    — weak to poison.
 * - `'shadow'`    — weak to shadow.
 * - `'nature'`    — weak to nature.
 */
export type CrumbleVariant =
  | 'normal'
  | 'fire'
  | 'water'
  | 'void'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'shadow'
  | 'nature';

/** A crumble block that collapses as soon as the player touches it. */
export interface RoomCrumbleBlockDef {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
  /**
   * Ramp orientation (0-3). Undefined or absent = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** Which elemental type this crumble block is weak to. Defaults to `'normal'`. */
  variant?: CrumbleVariant;
  /** Per-block theme override. When set, overrides the room-level default. */
  blockTheme?: BlockTheme;
}

/** A bounce pad that reflects the player's velocity on contact.
 *
 * speedFactorIndex:
 *   0 = 50 % restitution (dim 2×2-pixel glowing core)
 *   1 = 100 % restitution (bright 4×4-pixel glowing core)
 *
 * The player cannot grapple to it, jump off it, or wall-jump off it.
 */
export interface RoomBouncePadDef {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
  /**
   * Ramp orientation (0-3). Undefined or absent = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** 0 = 50 % bounce (dim core), 1 = 100 % bounce (bright core). Default 0. */
  speedFactorIndex?: 0 | 1;
}

/**
 * A kinetic block: imparts a fixed directional velocity boost of
 * KINETIC_BLOCK_BOOST_SPEED_WORLD to the player on contact.
 * Unlike bounce pads, kinetic blocks set an absolute velocity rather
 * than reflecting the incoming velocity.
 */
export interface RoomKineticBlockDef {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
}

/** A 1x1 movable block that can be carried through grapple tension. */
export interface RoomGrappleCarryBlockDef {
  xBlock: number;
  yBlock: number;
}

/** A 1x1 ghost tile: player/grapple ignore it, carried physics blocks collide. */
export interface RoomPhantasmalTileDef {
  xBlock: number;
  yBlock: number;
}

// ── Rope types ────────────────────────────────────────────────────────────────

/**
 * How the rope can be destroyed.
 * - 'indestructible' — cannot be destroyed.
 * - 'playerOnly'     — destroyed only by player dust particles.
 * - 'any'            — destroyed by any dust particle contact.
 */
export type RopeDestructibility = 'indestructible' | 'playerOnly' | 'any';

/** Default number of rope segments when not explicitly specified. */
export const DEFAULT_ROPE_SEGMENT_COUNT = 8;

/** Minimum distance between rope anchors (in block units) for placement to be valid. */
export const MIN_ROPE_LENGTH_BLOCKS = 0.5;

/**
 * Pre-computed half-thickness (world units) for each rope thickness index.
 * Index 0 = 8 px wide  (half = 4),
 * Index 1 = 16 px wide (half = 8),
 * Index 2 = 24 px wide (half = 12).
 */
export const ROPE_THICKNESS_HALF_WORLD: readonly number[] = [4, 8, 12] as const;

/** A hanging rope between two world-space anchor points. */
export interface RoomRopeDef {
  /** X position of the fixed top anchor (block units). */
  anchorAXBlock: number;
  /** Y position of the fixed top anchor (block units). */
  anchorAYBlock: number;
  /** X position of the bottom anchor (block units). */
  anchorBXBlock: number;
  /** Y position of the bottom anchor (block units). */
  anchorBYBlock: number;
  /** Number of rope segments (default 8, clamped to MAX_ROPE_SEGMENTS at load). */
  segmentCount?: number;
  /**
   * Whether anchor B is also fixed.
   * true  = both ends pinned (bridge rope between two wall points).
   * false = only anchor A is pinned (dangling rope).
   * Defaults to true.
   */
  isAnchorBFixed?: boolean;
  /** How this rope can be destroyed. Defaults to 'indestructible'. */
  destructibility?: RopeDestructibility;
  /**
   * Visual and collision thickness index.
   * 0 = 8 px (thin),  1 = 16 px (medium),  2 = 24 px (thick).
   * Defaults to 0.
   */
  thicknessIndex?: 0 | 1 | 2;
}

// ── Collectible types ─────────────────────────────────────────────────────────

/** A jar that grants temporary dust particles when broken. */
export interface RoomDustBoostJarDef {
  xBlock: number;
  yBlock: number;
  /** Particle kind granted by the jar. */
  dustKind: ParticleKind;
  /** Number of temporary dust particles granted. */
  dustCount: number;
}

/** A jar that releases golden fireflies when broken. */
export interface RoomFireflyJarDef {
  xBlock: number;
  yBlock: number;
}

/**
 * A Lambda Anchor — a golden lambda (λ) glyph on a pole that acts as a
 * temporary recall point. First press F to link; press F again while linked
 * to teleport back to the anchor.
 */
export interface RoomLambdaAnchorDef {
  xBlock: number;
  yBlock: number;
}

/**
 * A collectable dust-type swarm placed in the world.
 * Appears as an animated sandstorm/swirl of particles of the chosen kind.
 * The player collects it by approaching within DUST_SWARM_COLLECT_RADIUS_WORLD
 * and pressing F, receiving `dustCount` particles of `dustKind`.
 */
export interface RoomDustSwarmDef {
  xBlock: number;
  yBlock: number;
  /** ParticleKind string name (e.g. 'Fire', 'Ice', 'Physical'). */
  dustKind: string;
  /** Number of dust particles granted on collection. */
  dustCount: number;
}

/** A pile of gold dust placed on the ground that can be attracted by the Storm Weave. */
export interface RoomDustPileDef {
  xBlock: number;
  yBlock: number;
  /** Number of dust particles in this pile (default: 5). */
  dustCount: number;
  /**
   * Full spread width (block units). The pile spawns with a triangle-distributed
   * random offset in the range ±(spreadBlocks / 2) blocks from the anchor position.
   * Default: 0 (no spread).
   */
  spreadBlocks?: number;
}

// ── Decorations ───────────────────────────────────────────────────────────────

/**
 * Visual kind for an editor-placed decoration.
 * - 'mushroom'  — glowing mushroom, sits on the TOP surface of a floor block.
 * - 'glowGrass' — glowing grass tuft, sits on the TOP surface of a floor block.
 * - 'vine'      — glowing vine, hangs from the BOTTOM surface of a ceiling block.
 */
export type DecorationKind = 'mushroom' | 'glowGrass' | 'vine';

/** An editor-placed decoration anchored to a specific block surface. */
export interface RoomDecorationDef {
  /** Block column of the anchor block. */
  xBlock: number;
  /** Block row of the anchor block. */
  yBlock: number;
  /** Visual kind of decoration. */
  kind: DecorationKind;
}

// ── Falling blocks ────────────────────────────────────────────────────────────

/**
 * The three falling block variants:
 * - 'tough'     — only triggers from strong downward force or downward grapple pull.
 * - 'sensitive' — triggers from almost any contact.
 * - 'crumbling' — like sensitive, but disappears after falling to top speed.
 */
export type FallingBlockVariant = 'tough' | 'sensitive' | 'crumbling';

/** An individual falling block tile placed by the editor. */
export interface RoomFallingBlockDef {
  /** Block column (X). */
  xBlock: number;
  /** Block row (Y). */
  yBlock: number;
  /** Which falling block variant this tile belongs to. */
  variant: FallingBlockVariant;
}

// ── Background blocks ─────────────────────────────────────────────────────────

/** A visual-only background block placed by the editor — no collision, drawn behind foreground walls. */
export interface RoomBackgroundBlockDef {
  /** Block column (X). */
  xBlock: number;
  /** Block row (Y). */
  yBlock: number;
  /** Width in blocks. */
  wBlock: number;
  /** Height in blocks. */
  hBlock: number;
  /** Override block theme for this specific block. Null = use room theme. */
  blockTheme: string | null;
  /** 1 if this background block should block ambient light. */
  isLightBlockingFlag: 0 | 1;
}

// ── Critter spawn areas ───────────────────────────────────────────────────────

/** A rectangular area where grasshopper critters spawn randomly. */
export interface RoomGrasshopperAreaDef {
  /** Left edge X (block units). */
  xBlock: number;
  /** Top edge Y (block units). */
  yBlock: number;
  /** Width (block units). */
  wBlock: number;
  /** Height (block units). */
  hBlock: number;
  /** Number of grasshoppers to spawn in this area. */
  count: number;
}

/** A rectangular area where fireflies spawn directly (free-roaming, not from jars). */
export interface RoomFireflyAreaDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  count: number;
}

// ── Dialogue trigger definitions ──────────────────────────────────────────────

/**
 * A single text box within a dialogue conversation.
 * Mirrors DialogueEntry in src/dialogue/dialogueTypes.ts — kept separate to
 * avoid coupling the levels layer to the dialogue/UI layer.
 */
export interface RoomDialogueEntryDef {
  text: string;
  portraitId: string;
  portraitSide: 'left' | 'right';
}

/**
 * A conversation — an ordered list of dialogue entries (max 99).
 * How dialogue triggers are stored: inline within RoomDialogueTriggerDef so that
 * each room JSON file is self-contained (no external conversation asset files).
 */
export interface RoomConversationDef {
  id: string;
  /** Optional speaker name shown above the text. */
  title?: string;
  entries: readonly RoomDialogueEntryDef[];
}

/**
 * A trigger zone placed in the room that starts a dialogue conversation
 * when the player enters (or activates) it.
 *
 * Retrigger rule: fires once per room visit. The set of triggered UIDs is
 * cleared when the player loads a new room, so the trigger fires again if
 * the player leaves and re-enters the room. This is intentional — it lets
 * designers repeat intro dialogues when revisiting an area without requiring
 * a separate "seen" persistence layer.
 */
export interface RoomDialogueTriggerDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  conversation: RoomConversationDef;
}


// ── Guide dust paths ──────────────────────────────────────────────────────────

/** A single control point on a guide dust path (block units). */
export interface RoomGuideDustPathPointDef {
  xBlock: number;
  yBlock: number;
  /** Travel speed at this control point (default 1.0). */
  speed: number;
}

/** An editor-authored Catmull-Rom spline that golden dust motes travel along in-game. */
export interface RoomGuideDustPathDef {
  points: readonly RoomGuideDustPathPointDef[];
  loop: boolean;
  /** Whether motes are rendered during normal gameplay. */
  visibleInGame: boolean;
  /** Number of motes travelling along this path (3–20). */
  moteCount: number;
  /** Speed multiplier relative to the 6-second default path-crossing time. */
  moteSpeedFactor: number;
  /** Overall opacity of the mote layer (0–100 %). */
  opacityPct: number;
}
