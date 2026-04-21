/**
 * Room definition types for the Metroidvania-style interconnected world.
 *
 * All positions and sizes are in **block units**.
 * The game screen converts them to world units at load time.
 *
 * Block size constants (world units):
 *   BLOCK_SIZE_SMALL  =  8  →  8×8 virtual px (32×32 physical @ 4×)
 *
 * Medium and large block tiers are temporarily disabled and aliased to
 * the small block size so all terrain generation runs on an 8×8 tileset.
 *
 * At zoom 1.0 with the 480×270 virtual canvas:
 *   33.75 small blocks fit vertically  (270 ÷ 8 = 33.75)
 *   60    small blocks fit horizontally (480 ÷ 8 = 60)
 *
 * Player hitbox constants (standing):
 *   PLAYER_WIDTH_WORLD       =  7  (full width,  sprite x 6–13)
 *   PLAYER_HEIGHT_WORLD      = 20  (full height, sprite y 4–24)
 *   PLAYER_HALF_WIDTH_WORLD  =  3.5
 *   PLAYER_HALF_HEIGHT_WORLD = 10
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomSongId } from '../audio/musicManager';

// ── Block theme and background types ─────────────────────────────────────────

/**
 * Visual theme for block sprites in a room.
 * Controls which sprite set is used by the block renderer.
 */
export type BlockTheme = 'blackRock' | 'brownRock' | 'dirt';

/** Maps a BlockTheme string to a compact numeric index for typed arrays. */
export function blockThemeToIndex(theme: BlockTheme): number {
  switch (theme) {
    case 'blackRock': return 0;
    case 'brownRock': return 1;
    case 'dirt':      return 2;
  }
}

/** Maps a numeric theme index back to a BlockTheme string. */
export function indexToBlockTheme(index: number): BlockTheme {
  switch (index) {
    case 1:  return 'brownRock';
    case 2:  return 'dirt';
    default: return 'blackRock';
  }
}

/** Sentinel value: wall uses room-level default theme. */
export const WALL_THEME_DEFAULT_INDEX = 255;

/**
 * Background visual identifier for a room.
 * Controls the parallax background image (or effect) shown behind the level.
 */
export type BackgroundId =
  | 'brownRock'
  | 'world1'
  | 'world2'
  | 'world3'
  | 'crystallineCracks'
  | 'thero_prologue'
  | 'thero_ch1'
  | 'thero_ch2'
  | 'thero_ch3'
  | 'thero_ch4'
  | 'thero_ch5'
  | 'thero_ch6';

/**
 * Lighting model used when shading block tiles in a room.
 * - DEFAULT:  distance-to-open-air in any direction (intended behavior)
 * - Above:    legacy top-down depth shading effect
 * - DarkRoom: fully dark room; only explicit light sources illuminate it.
 *             Block-level tinting is skipped; the darkness overlay in the
 *             render pipeline covers the entire room and is pierced by
 *             radial light gradients at glowing decorations and the player.
 */
export type LightingEffect = 'DEFAULT' | 'Above' | 'DarkRoom';

/** Small block size in world units (8×8 virtual px, 32×32 physical px @ 4×). */
export const BLOCK_SIZE_SMALL  = 8;

/**
 * Medium block tier is disabled for now; kept as an alias for compatibility.
 * All world generation should treat this as an 8×8 small tile.
 */
export const BLOCK_SIZE_MEDIUM = BLOCK_SIZE_SMALL;

/**
 * Large block tier is disabled for now; kept as an alias for compatibility.
 * All world generation should treat this as an 8×8 small tile.
 */
export const BLOCK_SIZE_LARGE  = BLOCK_SIZE_SMALL;

// ── Player size constants ─────────────────────────────────────────────────────

/** Player full width in world units (sprite x 6–13 = 7 px). */
export const PLAYER_WIDTH_WORLD = 7;

/** Player full height in world units (sprite y 4–24 = 20 px). */
export const PLAYER_HEIGHT_WORLD = 20;

/** Player half-width in world units. */
export const PLAYER_HALF_WIDTH_WORLD = 3.5;

/** Player half-height in world units. */
export const PLAYER_HALF_HEIGHT_WORLD = 10;

/** An enemy cluster placed inside a room. */
export interface RoomEnemyDef {
  /** X position in block units. */
  xBlock: number;
  /** Y position in block units. */
  yBlock: number;
  /** Particle kinds composing this enemy. */
  kinds: ParticleKind[];
  /** Total particle count for this enemy. */
  particleCount: number;
  /** 1 if boss, 0 otherwise. */
  isBossFlag: 0 | 1;
  /**
   * 1 if this enemy is a flying eye — floats in the air, moves in 2D,
   * and is rendered as 4 concentric diamond outlines.
   */
  isFlyingEyeFlag?: 0 | 1;
  /**
   * 1 if this enemy is a rolling ground enemy — rolls toward the player,
   * rendered with a rotating sprite, and forms a crescent shield when blocking.
   */
  isRollingEnemyFlag?: 0 | 1;
  /**
   * Which enemy sprite to use (1–6), corresponding to SPRITES/enemies/universal/enemy (N).png.
   * Only meaningful when isRollingEnemyFlag === 1.
   */
  rollingEnemySpriteIndex?: number;
  /**
   * 1 if this enemy is a rock elemental — hovers near the ground, has
   * inactive/active states, orbits/fires brown-rock dust projectiles.
   */
  isRockElementalFlag?: 0 | 1;
  /**
   * 1 if this enemy is the Radiant Tether boss — floating sphere of light
   * with rotating laser telegraphs and anchored chains.
   */
  isRadiantTetherFlag?: 0 | 1;
  /** 1 if this enemy is a grapple hunter — ground enemy that fires slow grapple hooks at the player. */
  isGrappleHunterFlag?: 0 | 1;
  /** 1 if this enemy is a slime — hops toward the player. */
  isSlimeFlag?: 0 | 1;
  /** 1 if this enemy is a large dust slime — slower hops, orbiting dust, splits on death. */
  isLargeSlimeFlag?: 0 | 1;
  /** 1 if this enemy is a wheel enemy — rolls along surfaces toward the player. */
  isWheelEnemyFlag?: 0 | 1;
  /**
   * 1 if this enemy is a golden beetle — crawls on any surface (floor/wall/ceiling),
   * damages the player on contact, and flies away when agitated.
   */
  isBeetleFlag?: 0 | 1;
}

/** An axis-aligned wall rectangle inside a room (block units). */
export interface RoomWallDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /**
   * 1 if this wall is a one-way platform — the player can pass upward through
   * it but lands on top when falling down.  Platforms have no side collision.
   */
  isPlatformFlag?: 0 | 1;
  /**
   * Which edge of this platform block is the one-way surface.
   * Only meaningful when isPlatformFlag === 1.
   * 0 = top (default), 1 = bottom, 2 = left, 3 = right.
   */
  platformEdge?: 0 | 1 | 2 | 3;
  /** Per-wall block theme override.  When set, this wall renders with the
   *  specified theme instead of the room-level default. */
  blockTheme?: BlockTheme;
  /** 1 if this wall is an invisible collision boundary (not rendered). */
  isInvisibleFlag?: 0 | 1;
  /**
   * Ramp orientation. When set, this wall is a diagonal triangle (ramp) rather
   * than a full rectangle. The four orientations are:
   *   0 = ramp rises going right  ( / shape, hypotenuse from bottom-left to top-right )
   *   1 = ramp rises going left   ( \ shape, hypotenuse from bottom-right to top-left )
   *   2 = ceiling ramp going left ( ⌐ shape, upside-down /, hypotenuse top-left to bottom-right )
   *   3 = ceiling ramp going right( ¬ shape, upside-down \, hypotenuse top-right to bottom-left )
   * Omit (or set to undefined) for a normal rectangular wall.
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /**
   * 1 if this pillar wall is rendered and collides at half-block width (4 px).
   * Only meaningful for walls that are 1×2 blocks and serve as pillars.
   */
  isPillarHalfWidthFlag?: 0 | 1;
}

/** Direction a transition tunnel faces. */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/**
 * A passage connecting this room to an adjacent room.
 *
 * The tunnel is an opening in the room boundary walls.
 * Blocks line the top and bottom (or sides) of the opening to form
 * a corridor that extends a few blocks beyond the room edge.
 */
export interface RoomTransitionDef {
  /** Direction the player walks to leave through this tunnel. */
  direction: TransitionDirection;
  /** ID of the room this tunnel leads to. */
  targetRoomId: string;
  /**
   * For left/right tunnels: Y position (top of tunnel opening, block units).
   * For up/down tunnels: X position (left of tunnel opening, block units).
   */
  positionBlock: number;
  /** Size of the tunnel opening in blocks (height for L/R, width for U/D). */
  openingSizeBlocks: number;
  /**
   * Block coordinate where the player spawns in the target room.
   * [xBlock, yBlock]
   */
  targetSpawnBlock: readonly [number, number];
  /** Color used for the tunnel fade gradient. Defaults to black if unset. */
  fadeColor?: string;
  /**
   * Left edge (for left/right) or top edge (for up/down) of the 6-block-deep
   * transition zone, in block units. When undefined the transition is an edge
   * transition sitting against the room boundary; when defined it is an
   * interior transition that can be placed anywhere inside the room.
   */
  depthBlock?: number;
}

/** Direction a spike faces (the pointy end). */
export type SpikeDirection = 'up' | 'down' | 'left' | 'right';

/** A spike tile placed in the room. */
export interface RoomSpikeDef {
  xBlock: number;
  yBlock: number;
  /** Direction the spike points (the dangerous end). */
  direction: SpikeDirection;
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
}

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

/** A pile of gold dust placed on the ground that can be attracted by the Storm Weave. */
export interface RoomDustPileDef {
  xBlock: number;
  yBlock: number;
  /** Number of dust particles in this pile (default: 5). */
  dustCount: number;
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

/** Full definition for a single room in the Metroidvania world. */
export interface RoomDef {
  /** Unique identifier for this room. */
  id: string;
  /** Display name shown on screen. */
  name: string;
  /** World number — determines block sprites and background colour. */
  worldNumber: number;
  /** X position on the visual world map (map world units). */
  mapX: number;
  /** Y position on the visual world map (map world units). */
  mapY: number;
  /**
   * Visual theme for block sprites.  When set, overrides the worldNumber-based
   * sprite selection.  Falls back to worldNumber if not set.
   */
  blockTheme?: BlockTheme;
  /**
   * Background visual ID.  When set, overrides the worldNumber-based background
   * image.  Falls back to worldNumber if not set.
   */
  backgroundId?: BackgroundId;
  /**
   * Block lighting model. Falls back to 'DEFAULT' when not set.
   */
  lightingEffect?: LightingEffect;
  /** Room width in blocks. */
  widthBlocks: number;
  /** Room height in blocks. */
  heightBlocks: number;
  /** Wall rectangles (block units, absolute within the room). */
  walls: readonly RoomWallDef[];
  /** Enemies placed in the room. */
  enemies: readonly RoomEnemyDef[];
  /** Default player spawn position (block units). */
  playerSpawnBlock: readonly [number, number];
  /** Transition tunnels connecting to other rooms. */
  transitions: readonly RoomTransitionDef[];
  /** Save tomb positions (block units) — where the player saves their progress. */
  saveTombs: readonly { xBlock: number; yBlock: number }[];
  /** Skill Tomb definitions (block units) — grant dust skills/weaves when interacted with. */
  skillTombs?: readonly { xBlock: number; yBlock: number; weaveId: string }[];
  /** Collectible skill book positions (block units). */
  skillBooks?: readonly { xBlock: number; yBlock: number }[];
  /**
   * Collectible dust container positions (block units).
   * Each pickup grants +4 dust particles to the player.
   */
  dustContainers?: readonly { xBlock: number; yBlock: number }[];

  // ── Environmental hazards ────────────────────────────────────────────────
  /** Spike tiles that damage the player on contact. */
  spikes?: readonly RoomSpikeDef[];
  /** Springboard tiles that bounce the player upward. */
  springboards?: readonly RoomSpringboardDef[];
  /** Water zones where the player floats (buoyancy). */
  waterZones?: readonly RoomZoneDef[];
  /** Lava zones that damage the player. */
  lavaZones?: readonly RoomZoneDef[];
  /** Breakable blocks that shatter from high-momentum player impact. */
  breakableBlocks?: readonly RoomBreakableBlockDef[];
  /** Jars that grant temporary dust particles when broken by the player. */
  dustBoostJars?: readonly RoomDustBoostJarDef[];
  /** Jars that release golden fireflies when broken by the player. */
  fireflyJars?: readonly RoomFireflyJarDef[];
  /** Piles of gold dust placed on the ground (attracted by Storm Weave). */
  dustPiles?: readonly RoomDustPileDef[];
  /** Grasshopper critter spawn zones. */
  grasshopperAreas?: readonly RoomGrasshopperAreaDef[];
  /** Editor-placed decorations (glowing mushrooms, grass tufts, vines). */
  decorations?: readonly RoomDecorationDef[];
  /**
   * Background music for this room.
   * '_continue' = keep playing the previous room's song (default / undefined).
   * '_silence'  = stop music when entering this room.
   * Any other value = switch to the named song when entering this room.
   * When undefined, treated as '_continue'.
   */
  songId?: RoomSongId;
}
