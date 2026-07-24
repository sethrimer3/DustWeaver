/**
 * surfaceRimGameplayWiring.test.ts — Coverage for the gameplay-renderer wiring
 * that connects `WallSnapshot.surfaceRimStyleIndex`/`surfaceRimStyleTable`
 * (populated from `EditorWall.surfaceRim` at room load, mirroring
 * `themeIndex`) through `getWallLayoutCache`'s `tileSurfaceRim` map to
 * `renderSurfaceEdgeOverlayPass`'s `getStyleForTile` resolver.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { normalizeSurfaceRimStyle, SURFACE_RIM_STYLE_INDEX_DEFAULT, type SurfaceRimStyle } from '../render/walls/surfaceRimStyle';
import { buildRoomWallTemplate } from '../screens/gameRoomWalls';
import type { RoomDef, RoomWallDef } from '../levels/roomDef';

const BLOCK_SIZE = 8;

function makeWallSnapshot(
  rects: Array<{ x: number; y: number; w: number; h: number; rimIdx?: number }>,
  rimStyleTable: SurfaceRimStyle[] = [],
): WallSnapshot {
  const count = rects.length;
  const xWorld = new Float32Array(count);
  const yWorld = new Float32Array(count);
  const wWorld = new Float32Array(count);
  const hWorld = new Float32Array(count);
  const surfaceRimStyleIndex = new Uint16Array(count).fill(SURFACE_RIM_STYLE_INDEX_DEFAULT);
  rects.forEach((r, i) => {
    xWorld[i] = r.x; yWorld[i] = r.y; wWorld[i] = r.w; hWorld[i] = r.h;
    if (r.rimIdx !== undefined) surfaceRimStyleIndex[i] = r.rimIdx;
  });
  return {
    count, xWorld, yWorld, wWorld, hWorld,
    isPlatformFlag: new Uint8Array(count),
    platformEdge: new Uint8Array(count),
    themeIndex: new Uint8Array(count).fill(255),
    isInvisibleFlag: new Uint8Array(count),
    rampOrientationIndex: new Uint8Array(count).fill(255),
    isPillarHalfWidthFlag: new Uint8Array(count),
    surfaceRimStyleIndex,
    surfaceRimStyleTable: rimStyleTable,
  };
}

test('getWallLayoutCache: a wall with a non-default rim style populates tileSurfaceRim for every tile it covers', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff7a18', widthPx: 2, opacity: 0.5 });
  const snapshot = makeWallSnapshot([
    { x: 1 * BLOCK_SIZE, y: 1 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 1 * BLOCK_SIZE, rimIdx: 0 },
  ], [style]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  assert.equal(layout.tileSurfaceRim.get('1,1'), style);
  assert.equal(layout.tileSurfaceRim.get('2,1'), style);
});

test('getWallLayoutCache: a wall with SURFACE_RIM_STYLE_INDEX_DEFAULT produces no tileSurfaceRim entries', () => {
  const snapshot = makeWallSnapshot([{ x: 0, y: 0, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  assert.equal(layout.tileSurfaceRim.size, 0);
});

test('getWallLayoutCache: blocks with no custom style produce byte-identical layout to a snapshot with no rim fields set at all', () => {
  const plain = makeWallSnapshot([{ x: 8, y: 8, w: 8, h: 8 }]);
  const layoutA = getWallLayoutCache(plain, BLOCK_SIZE, 10, 10);
  assert.equal(layoutA.tileSurfaceRim.size, 0);
  assert.deepEqual(Array.from(layoutA.surfaceExposureMap.masks.keys()).sort(), ['1,1']);
});

test('rim edits invalidate the layout cache (signature changes) even when geometry is unchanged', () => {
  const styleA = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 2, opacity: 0.5 });
  const snapshotDefault = makeWallSnapshot([{ x: 0, y: 0, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const snapshotCustom = makeWallSnapshot([{ x: 0, y: 0, w: BLOCK_SIZE, h: BLOCK_SIZE, rimIdx: 0 }], [styleA]);

  const layoutDefault = getWallLayoutCache(snapshotDefault, BLOCK_SIZE, 10, 10);
  const layoutCustom = getWallLayoutCache(snapshotCustom, BLOCK_SIZE, 10, 10);

  assert.notEqual(layoutDefault.signature, layoutCustom.signature,
    'identical geometry with a different rim style index must produce a different cache signature');
});

// ── Wall-slot recycling (gameRoomWalls merge pass) ─────────────────────────────

test('buildRoomWallTemplate: two adjacent blocks with different rim styles are never merged into one AABB', () => {
  const styleA: RoomWallDef['surfaceRim'] = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 2, opacity: 0.4 });
  const styleB: RoomWallDef['surfaceRim'] = normalizeSurfaceRimStyle({ mode: 'solid', color: '00ff00', widthPx: 2, opacity: 0.4 });
  const room = {
    id: 'r', name: 'r', worldNumber: 1, widthBlocks: 20, heightBlocks: 20,
    playerSpawnBlock: [0, 0] as [number, number],
    walls: [
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, surfaceRim: styleA },
      { xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, surfaceRim: styleB },
    ] as RoomWallDef[],
    enemies: [], transitions: [],
  } as unknown as RoomDef;

  const tpl = buildRoomWallTemplate(room);
  assert.equal(tpl.wallCount, 2, 'walls with distinct rim styles must not merge, even though contiguous and same theme');
  assert.notEqual(tpl.rimStyleIndex[0], tpl.rimStyleIndex[1]);
});

test('buildRoomWallTemplate: two adjacent blocks with the SAME rim style still merge (rim style does not defeat merging)', () => {
  const style: RoomWallDef['surfaceRim'] = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 2, opacity: 0.4 });
  const room = {
    id: 'r', name: 'r', worldNumber: 1, widthBlocks: 20, heightBlocks: 20,
    playerSpawnBlock: [0, 0] as [number, number],
    walls: [
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, surfaceRim: style },
      { xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, surfaceRim: style },
    ] as RoomWallDef[],
    enemies: [], transitions: [],
  } as unknown as RoomDef;

  const tpl = buildRoomWallTemplate(room);
  assert.equal(tpl.wallCount, 1, 'identical rim styles must still merge into one AABB');
  assert.equal(tpl.rimStyleTable.length, 1, 'the single merged wall interns exactly one rim style');
});

test('buildRoomWallTemplate: identical custom styles on different walls are deduplicated into one rimStyleTable entry', () => {
  const styleA: RoomWallDef['surfaceRim'] = normalizeSurfaceRimStyle({ mode: 'gradient', color: '00ffff', widthPx: 4, opacity: 0.6, falloff: 'smooth' });
  const styleB: RoomWallDef['surfaceRim'] = normalizeSurfaceRimStyle({ mode: 'gradient', color: '00ffff', widthPx: 4, opacity: 0.6, falloff: 'smooth' });
  const room = {
    id: 'r', name: 'r', worldNumber: 1, widthBlocks: 20, heightBlocks: 20,
    playerSpawnBlock: [0, 0] as [number, number],
    walls: [
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, surfaceRim: styleA },
      { xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, surfaceRim: styleB },
    ] as RoomWallDef[],
    enemies: [], transitions: [],
  } as unknown as RoomDef;

  const tpl = buildRoomWallTemplate(room);
  assert.equal(tpl.wallCount, 2, 'non-adjacent walls never merge regardless of style');
  assert.equal(tpl.rimStyleTable.length, 1, 'identical styles on separate walls share one table entry');
  assert.equal(tpl.rimStyleIndex[0], tpl.rimStyleIndex[1]);
});

test('buildRoomWallTemplate: a wall with no surfaceRim gets SURFACE_RIM_STYLE_INDEX_DEFAULT and contributes nothing to rimStyleTable', () => {
  const room = {
    id: 'r', name: 'r', worldNumber: 1, widthBlocks: 20, heightBlocks: 20,
    playerSpawnBlock: [0, 0] as [number, number],
    walls: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1 }] as RoomWallDef[],
    enemies: [], transitions: [],
  } as unknown as RoomDef;

  const tpl = buildRoomWallTemplate(room);
  assert.equal(tpl.rimStyleIndex[0], SURFACE_RIM_STYLE_INDEX_DEFAULT);
  assert.equal(tpl.rimStyleTable.length, 0);
});
