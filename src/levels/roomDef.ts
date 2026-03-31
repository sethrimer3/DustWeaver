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
 *   PLAYER_WIDTH_WORLD       = 14  (full width)
 *   PLAYER_HEIGHT_WORLD      = 20  (full height)
 *   PLAYER_HALF_WIDTH_WORLD  =  7
 *   PLAYER_HALF_HEIGHT_WORLD = 10
 */

import { ParticleKind } from '../sim/particles/kinds';

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

/** Player full width in world units. */
export const PLAYER_WIDTH_WORLD = 14;

/** Player full height in world units. */
export const PLAYER_HEIGHT_WORLD = 20;

/** Player half-width in world units. */
export const PLAYER_HALF_WIDTH_WORLD = 7;

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
}

/** An axis-aligned wall rectangle inside a room (block units). */
export interface RoomWallDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
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
}

/** Full definition for a single room in the Metroidvania world. */
export interface RoomDef {
  /** Unique identifier for this room. */
  id: string;
  /** Display name shown on screen. */
  name: string;
  /** World number — determines block sprites and background colour. */
  worldNumber: number;
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
  /** Skill tomb positions (block units). Empty array if none. */
  skillTombs: readonly { xBlock: number; yBlock: number }[];
}
