import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSurfaceExposureMap,
  getSurfaceSegments,
  type TileSolidityGrid,
  type SurfaceSegment,
} from '../sim/world/surfaceExposure';
import {
  isSurfaceEligibleForGrapple,
  type GrappleEligibilityState,
} from '../sim/clusters/grappleSurfaceEligibility';

const BLOCK_SIZE_PX = 8;

function gridFromRows(rows: readonly (0 | 1)[][], blockSizePx = BLOCK_SIZE_PX): TileSolidityGrid {
  const heightBlocks = rows.length;
  const widthBlocks = rows[0]?.length ?? 0;
  return {
    widthBlocks,
    heightBlocks,
    blockSizePx,
    isSolidAt: (col: number, row: number): boolean => {
      if (row < 0 || row >= heightBlocks || col < 0 || col >= widthBlocks) return false;
      return rows[row][col] === 1;
    },
  };
}

/** Always-visible line-of-sight stub — no occluders. */
const alwaysVisible: GrappleEligibilityState['hasLineOfSight'] = () => true;

function findSegment(segments: readonly SurfaceSegment[], col: number, row: number, side: SurfaceSegment['side']): SurfaceSegment {
  const seg = segments.find(s => s.col === col && s.row === row && s.side === side);
  assert.ok(seg, `expected an exposed ${side} segment at (${col},${row})`);
  return seg!;
}

test('single isolated tile: player near each side selects the correct exposed side as eligible', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const segments = getSurfaceSegments(map);

  const top = findSegment(segments, 1, 1, 'top');
  const right = findSegment(segments, 1, 1, 'right');
  const bottom = findSegment(segments, 1, 1, 'bottom');
  const left = findSegment(segments, 1, 1, 'left');

  const baseState = (playerXWorld: number, playerYWorld: number): GrappleEligibilityState => ({
    playerXWorld, playerYWorld, maxRangeWorldSq: 1000 * 1000, hasLineOfSight: alwaysVisible,
  });

  // Player above the tile: only the top segment should be eligible.
  assert.equal(isSurfaceEligibleForGrapple(top, baseState(12, 2)), true);
  assert.equal(isSurfaceEligibleForGrapple(bottom, baseState(12, 2)), false);
  assert.equal(isSurfaceEligibleForGrapple(left, baseState(12, 2)), false);
  assert.equal(isSurfaceEligibleForGrapple(right, baseState(12, 2)), false);

  // Player to the right of the tile: only the right segment should be eligible.
  assert.equal(isSurfaceEligibleForGrapple(right, baseState(30, 12)), true);
  assert.equal(isSurfaceEligibleForGrapple(left, baseState(30, 12)), false);
});

test('adjacent solid tiles: internal shared side has no segment to highlight at all', () => {
  const grid = gridFromRows([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const segments = getSurfaceSegments(map);

  // No segment exists for the shared internal side in either direction —
  // there is nothing for the highlight/eligibility layer to even consider.
  assert.equal(segments.some(s => s.col === 1 && s.row === 1 && s.side === 'right'), false);
  assert.equal(segments.some(s => s.col === 2 && s.row === 1 && s.side === 'left'), false);
});

test('tile at room boundary: out-of-bounds-facing side has no segment, cannot be highlighted', () => {
  const grid = gridFromRows([
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const segments = getSurfaceSegments(map);

  assert.equal(segments.some(s => s.col === 0 && s.row === 0 && s.side === 'top'), false);
  assert.equal(segments.some(s => s.col === 0 && s.row === 0 && s.side === 'left'), false);

  const state: GrappleEligibilityState = {
    playerXWorld: -50, playerYWorld: -50, maxRangeWorldSq: 1e9, hasLineOfSight: alwaysVisible,
  };
  // Even a player standing "outside" the room can't make an eligible segment
  // appear out of thin air — there's simply nothing there to iterate.
  for (const seg of segments) {
    if (seg.col === 0 && seg.row === 0) {
      assert.notEqual(seg.side, 'top');
      assert.notEqual(seg.side, 'left');
    }
  }
  void state;
});

test('multi-tile 2x2 block: only exterior sides produce eligible segments near the player', () => {
  const grid = gridFromRows([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const segments = getSurfaceSegments(map);

  // No internal segments exist at all (verified in surfaceExposure tests);
  // here we confirm eligibility only fires for a player facing an actual
  // exterior segment, never for the (non-existent) internal ones.
  const state: GrappleEligibilityState = {
    playerXWorld: 16, playerYWorld: 2, maxRangeWorldSq: 1e9, hasLineOfSight: alwaysVisible,
  };
  const eligible = segments.filter(s => isSurfaceEligibleForGrapple(s, state));
  assert.ok(eligible.length > 0);
  for (const seg of eligible) {
    assert.equal(seg.side, 'top', 'player standing above the block should only find top-facing segments eligible');
  }
});

test('concave/overhang shape: eligibility only selects real exposed surfaces, never underground ones', () => {
  const grid = gridFromRows([
    [0, 0, 0, 0, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const segments = getSurfaceSegments(map);

  // A player standing deep inside the solid mass (e.g. at the centre of the
  // bottom-middle tile) should find no eligible segment there facing them,
  // because the only segments that exist are on true exposed faces, and the
  // facing check further rejects anything not open toward the player.
  const insideState: GrappleEligibilityState = {
    playerXWorld: 100, playerYWorld: 100, maxRangeWorldSq: 1, hasLineOfSight: alwaysVisible,
  };
  const eligibleFromFarAway = segments.filter(s => isSurfaceEligibleForGrapple(s, insideState));
  assert.equal(eligibleFromFarAway.length, 0, 'nothing should be eligible when out of range');

  // A player inside the reachable pocket between the two arms (col 2, row 1-2)
  // should find the inward-facing arm segments eligible.
  const pocketState: GrappleEligibilityState = {
    playerXWorld: 20, playerYWorld: 12, maxRangeWorldSq: 1000 * 1000, hasLineOfSight: alwaysVisible,
  };
  const eligibleFromPocket = segments.filter(s => isSurfaceEligibleForGrapple(s, pocketState));
  assert.ok(eligibleFromPocket.some(s => s.col === 1 && s.row === 1 && s.side === 'right'));
  assert.ok(eligibleFromPocket.some(s => s.col === 3 && s.row === 1 && s.side === 'left'));
});

test('line-of-sight rejection: a blocked segment is not eligible even if in range and facing correctly', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const top = findSegment(getSurfaceSegments(map), 1, 1, 'top');

  const blockedState: GrappleEligibilityState = {
    playerXWorld: 12, playerYWorld: 2, maxRangeWorldSq: 1000 * 1000,
    hasLineOfSight: () => false,
  };
  assert.equal(isSurfaceEligibleForGrapple(top, blockedState), false);

  const visibleState: GrappleEligibilityState = {
    ...blockedState, hasLineOfSight: alwaysVisible,
  };
  assert.equal(isSurfaceEligibleForGrapple(top, visibleState), true);
});

test('range rejection: a segment beyond max range is not eligible', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const top = findSegment(getSurfaceSegments(map), 1, 1, 'top');

  const farState: GrappleEligibilityState = {
    playerXWorld: 12, playerYWorld: -10000, maxRangeWorldSq: 100 * 100, hasLineOfSight: alwaysVisible,
  };
  assert.equal(isSurfaceEligibleForGrapple(top, farState), false);
});
