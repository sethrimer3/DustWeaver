/**
 * Thero Effect Showcase Rooms
 *
 * Seven minimal enclosed rooms (one per ported Thero background effect).
 * Each room uses worldNumber=99 so the background renderer renders solid
 * black and hands off to the Thero effect manager for the visual overlay.
 *
 * Dimensions: 60 × 34 blocks = 480 × 272 world units (roughly one screen at zoom 1.0).
 * No enemies, no hazards. Player spawns at horizontal centre, 3 rows up.
 */

import { RoomDef } from './roomDef';

// ─── Shared room geometry ─────────────────────────────────────────────────────

const SHOWCASE_WIDTH_BLOCKS  = 60;
const SHOWCASE_HEIGHT_BLOCKS = 34;

/** Player spawns near the horizontal centre, a few rows above the floor. */
const SPAWN_X_BLOCK = Math.floor(SHOWCASE_WIDTH_BLOCKS  / 2);
const SPAWN_Y_BLOCK = SHOWCASE_HEIGHT_BLOCKS - 4;

/** Build simple four-wall boundary for a showcase room. */
function buildShowcaseBoundary(): RoomDef['walls'] {
  const w = SHOWCASE_WIDTH_BLOCKS;
  const h = SHOWCASE_HEIGHT_BLOCKS;
  return [
    { xBlock: 0,     yBlock: 0,     wBlock: w, hBlock: 1 }, // top
    { xBlock: 0,     yBlock: h - 1, wBlock: w, hBlock: 1 }, // bottom
    { xBlock: 0,     yBlock: 1,     wBlock: 1, hBlock: h - 2 }, // left
    { xBlock: w - 1, yBlock: 1,     wBlock: 1, hBlock: h - 2 }, // right
  ];
}

// ─── Prologue: XOR Glow Shapes ────────────────────────────────────────────────

export const ROOM_THERO_PROLOGUE: RoomDef = {
  id:          'thero_prologue',
  name:        'Prologue – Shape Glow',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Chapter 1: Vermiculate ───────────────────────────────────────────────────

export const ROOM_THERO_CH1: RoomDef = {
  id:          'thero_ch1',
  name:        'Chapter 1 – Vermiculate',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Chapter 2: Gravity Grid ──────────────────────────────────────────────────

export const ROOM_THERO_CH2: RoomDef = {
  id:          'thero_ch2',
  name:        'Chapter 2 – Gravity Grid',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Chapter 3: Euler Fluid ───────────────────────────────────────────────────

export const ROOM_THERO_CH3: RoomDef = {
  id:          'thero_ch3',
  name:        'Chapter 3 – Euler Fluid',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Chapter 4: Floater Lattice ───────────────────────────────────────────────

export const ROOM_THERO_CH4: RoomDef = {
  id:          'thero_ch4',
  name:        'Chapter 4 – Floater Lattice',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Chapter 5: Tetris Blocks ─────────────────────────────────────────────────

export const ROOM_THERO_CH5: RoomDef = {
  id:          'thero_ch5',
  name:        'Chapter 5 – Tetris Blocks',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Chapter 6: Substrate ─────────────────────────────────────────────────────

export const ROOM_THERO_CH6: RoomDef = {
  id:          'thero_ch6',
  name:        'Chapter 6 – Substrate',
  worldNumber: 99,
  widthBlocks:  SHOWCASE_WIDTH_BLOCKS,
  heightBlocks: SHOWCASE_HEIGHT_BLOCKS,
  walls:           buildShowcaseBoundary(),
  enemies:         [],
  playerSpawnBlock: [SPAWN_X_BLOCK, SPAWN_Y_BLOCK],
  transitions:     [],
  skillTombs:      [],
};

// ─── Exported array for registry registration ─────────────────────────────────

export const THERO_SHOWCASE_ROOMS: readonly RoomDef[] = [
  ROOM_THERO_PROLOGUE,
  ROOM_THERO_CH1,
  ROOM_THERO_CH2,
  ROOM_THERO_CH3,
  ROOM_THERO_CH4,
  ROOM_THERO_CH5,
  ROOM_THERO_CH6,
];
