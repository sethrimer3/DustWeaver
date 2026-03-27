import { DoorDef, WallDef } from './levelDef';

/** Canonical editor-friendly tile grid for authored level layout data. */
export const LEVEL_GRID_WIDTH_TILES = 32;
export const LEVEL_GRID_HEIGHT_TILES = 18;

/** Compact encoded rectangle: [xTiles, yTiles, wTiles, hTiles]. */
export type TileRect = readonly [number, number, number, number];
/** Compact encoded single-tile coordinate: [xTiles, yTiles]. */
export type TilePoint = readonly [number, number];

export interface TileLayoutDef {
  wallRectsTiles: readonly TileRect[];
  entryDoorTile: TilePoint;
  exitDoorTile: TilePoint;
  exitTarget: 'next' | 'menu';
}

const DOOR_WIDTH_TILES = 2;
const DOOR_HEIGHT_TILES = 3;

function toFractionX(tileX: number): number {
  return tileX / LEVEL_GRID_WIDTH_TILES;
}

function toFractionY(tileY: number): number {
  return tileY / LEVEL_GRID_HEIGHT_TILES;
}

/** Converts compact tile layout data into runtime wall/door fractional defs. */
export function decodeTileLayout(layout: TileLayoutDef): {
  walls: WallDef[];
  entryDoor: DoorDef;
  exitDoor: DoorDef;
} {
  const walls: WallDef[] = [];
  for (let i = 0; i < layout.wallRectsTiles.length; i++) {
    const rect = layout.wallRectsTiles[i];
    walls.push({
      xFraction: toFractionX(rect[0]),
      yFraction: toFractionY(rect[1]),
      wFraction: toFractionX(rect[2]),
      hFraction: toFractionY(rect[3]),
    });
  }

  return {
    walls,
    entryDoor: {
      xFraction: toFractionX(layout.entryDoorTile[0]),
      yFraction: toFractionY(layout.entryDoorTile[1]),
      wFraction: toFractionX(DOOR_WIDTH_TILES),
      hFraction: toFractionY(DOOR_HEIGHT_TILES),
      target: 'next',
    },
    exitDoor: {
      xFraction: toFractionX(layout.exitDoorTile[0]),
      yFraction: toFractionY(layout.exitDoorTile[1]),
      wFraction: toFractionX(DOOR_WIDTH_TILES),
      hFraction: toFractionY(DOOR_HEIGHT_TILES),
      target: layout.exitTarget,
    },
  };
}

/**
 * Builds a "big box" arena with deterministic floating jump-practice tiles.
 * Uses compact tile tuples for storage, suitable for future editor serialization.
 */
export function createBoxPracticeLayout(levelSeed: number, exitTarget: 'next' | 'menu'): TileLayoutDef {
  const wallRectsTiles: TileRect[] = [
    [2, 2, 1, 14],   // left wall
    [29, 2, 1, 14],  // right wall
    [2, 15, 28, 1],  // floor
    [2, 2, 28, 1],   // roof
  ];

  let seed = (levelSeed * 2654435761) >>> 0;
  for (let i = 0; i < 5; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const tx = 5 + (seed % 22);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const ty = 5 + (seed % 7);
    wallRectsTiles.push([tx, ty, 2, 1]);
  }

  return {
    wallRectsTiles,
    entryDoorTile: [4, 12],
    exitDoorTile: [26, 12],
    exitTarget,
  };
}
