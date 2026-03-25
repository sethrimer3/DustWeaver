export interface SpatialGrid {
  cellSizeWorld: number;
  cells: Map<number, number[]>;
  queryResult: number[];
}

export function createSpatialGrid(cellSizeWorld: number): SpatialGrid {
  return {
    cellSizeWorld,
    cells: new Map(),
    queryResult: new Array(512),
  };
}

// Large primes chosen for spatial hash to minimize collision clustering
const HASH_PRIME_X = 73856093;
const HASH_PRIME_Y = 19349663;

function cellKey(cx: number, cy: number): number {
  const x = ((cx & 0xffff) >>> 0);
  const y = ((cy & 0xffff) >>> 0);
  return (x * HASH_PRIME_X ^ y * HASH_PRIME_Y) >>> 0;
}

export function clearGrid(grid: SpatialGrid): void {
  grid.cells.clear();
}

export function insertParticle(grid: SpatialGrid, particleIndex: number, px: number, py: number): void {
  const cx = Math.floor(px / grid.cellSizeWorld);
  const cy = Math.floor(py / grid.cellSizeWorld);
  const key = cellKey(cx, cy);
  let cell = grid.cells.get(key);
  if (cell === undefined) {
    cell = [];
    grid.cells.set(key, cell);
  }
  cell.push(particleIndex);
}

/** Returns count of results written into grid.queryResult */
export function queryNeighbors(
  grid: SpatialGrid,
  px: number,
  py: number,
  radiusWorld: number,
): number {
  let resultCount = 0;
  const cx0 = Math.floor((px - radiusWorld) / grid.cellSizeWorld);
  const cy0 = Math.floor((py - radiusWorld) / grid.cellSizeWorld);
  const cx1 = Math.floor((px + radiusWorld) / grid.cellSizeWorld);
  const cy1 = Math.floor((py + radiusWorld) / grid.cellSizeWorld);

  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const key = cellKey(cx, cy);
      const cell = grid.cells.get(key);
      if (cell === undefined) continue;
      for (let i = 0; i < cell.length; i++) {
        if (resultCount < grid.queryResult.length) {
          grid.queryResult[resultCount++] = cell[i];
        }
      }
    }
  }
  return resultCount;
}
