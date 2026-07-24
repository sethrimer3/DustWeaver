/**
 * editorWallSurfaceRimPreview.ts — Live Surface Rim preview for the editor's
 * own canvas.
 *
 * The editor draws walls itself (see editorOverlayDrawers.ts's
 * `drawEditorWalls`) rather than through the gameplay renderer
 * (blockSpriteRenderer.ts), so `renderSurfaceEdgeOverlayPass` never ran there
 * before this module. This wires it in.
 *
 * IMPORTANT: this deliberately does NOT call
 * `blockWallLayoutCache.ts`'s `getWallLayoutCache` — that function memoizes
 * into a single module-level `_cachedWallLayout` slot shared with the live
 * gameplay renderer, which already runs every frame underneath the editor
 * (see `renderEditorBackdrop` in gameScreenEditorBackdrop.ts). Calling
 * `getWallLayoutCache` again here with a *different* WallSnapshot (built from
 * in-progress `EditorRoomData`, not the loaded gameplay `WorldState`) would
 * thrash that singleton every frame — each call's differing signature would
 * invalidate the other's cached layout, forcing a full rebuild on every
 * alternating call.
 *
 * Instead this module builds an entirely independent `CachedWallLayout` via
 * `buildWallLayout` (the same pure computation, just not memoized into the
 * shared singleton) and keeps its own tiny local cache, keyed by a cheap
 * per-wall signature. Zero interference with the gameplay path.
 */

import type { EditorRoomData, EditorWall } from './editorElementTypes';
import { BLOCK_SIZE_SMALL, WALL_THEME_DEFAULT_INDEX } from '../levels/roomDef';
import { wallShapeOrientationIndex } from '../levels/stairsGeometry';
import { buildWallLayout, type CachedWallLayout } from '../render/walls/blockWallLayoutCache';
import type { WallSnapshot } from '../render/snapshotTypes';
import { internSurfaceRimStyle, type SurfaceRimStyle, SURFACE_RIM_STYLE_INDEX_DEFAULT } from '../render/walls/surfaceRimStyle';
import { renderSurfaceEdgeOverlayPass } from '../render/walls/surfaceEdgeOverlay';

/** Converts live editor wall data into a `WallSnapshot`, mirroring gameRoomWalls.ts's block-unit → world-px conversion. */
function _editorWallsToSnapshot(walls: readonly EditorWall[]): WallSnapshot {
  const count = walls.length;
  const xWorld = new Float32Array(count);
  const yWorld = new Float32Array(count);
  const wWorld = new Float32Array(count);
  const hWorld = new Float32Array(count);
  const isPlatformFlag = new Uint8Array(count);
  const platformEdge = new Uint8Array(count);
  const themeIndex = new Uint8Array(count).fill(WALL_THEME_DEFAULT_INDEX);
  const isInvisibleFlag = new Uint8Array(count);
  const rampOrientationIndex = new Uint8Array(count);
  const isPillarHalfWidthFlag = new Uint8Array(count);
  const surfaceRimStyleIndex = new Uint16Array(count).fill(SURFACE_RIM_STYLE_INDEX_DEFAULT);
  const rimStyleTable: SurfaceRimStyle[] = [];

  walls.forEach((w, i) => {
    xWorld[i] = w.xBlock * BLOCK_SIZE_SMALL;
    yWorld[i] = w.yBlock * BLOCK_SIZE_SMALL;
    wWorld[i] = Math.max(BLOCK_SIZE_SMALL, w.wBlock * BLOCK_SIZE_SMALL);
    hWorld[i] = Math.max(BLOCK_SIZE_SMALL, w.hBlock * BLOCK_SIZE_SMALL);
    isPlatformFlag[i] = w.isPlatformFlag;
    platformEdge[i] = w.platformEdge;
    rampOrientationIndex[i] = wallShapeOrientationIndex(w);
    isPillarHalfWidthFlag[i] = w.isPillarHalfWidthFlag;
    surfaceRimStyleIndex[i] = internSurfaceRimStyle(rimStyleTable, w.surfaceRim);
  });

  return {
    count, xWorld, yWorld, wWorld, hWorld,
    isPlatformFlag, platformEdge, themeIndex, isInvisibleFlag,
    rampOrientationIndex, isPillarHalfWidthFlag,
    surfaceRimStyleIndex, surfaceRimStyleTable: rimStyleTable,
  };
}

/** Cheap per-wall signature — cheaper than a full WallSnapshot content hash, adequate for the small wall counts a single editor room has. */
function _signatureFor(walls: readonly EditorWall[], widthBlocks: number, heightBlocks: number): string {
  let s = `${widthBlocks}x${heightBlocks}|${walls.length}`;
  for (const w of walls) {
    s += `|${w.xBlock},${w.yBlock},${w.wBlock},${w.hBlock},${w.isPlatformFlag},${w.platformEdge},` +
      `${w.rampOrientation ?? ''},${w.stairsOrientation ?? ''},${w.isPillarHalfWidthFlag},` +
      `${w.surfaceRim ? JSON.stringify(w.surfaceRim) : ''}`;
  }
  return s;
}

let _editorLayoutCache: { signature: string; layout: CachedWallLayout } | null = null;

/**
 * Returns the current editor room's wall layout (rebuilding only when the
 * wall list actually changed since the last call) — completely independent
 * of the gameplay `blockWallLayoutCache.ts` singleton.
 */
export function getEditorWallLayout(room: EditorRoomData): CachedWallLayout {
  const signature = _signatureFor(room.interiorWalls, room.widthBlocks, room.heightBlocks);
  if (_editorLayoutCache !== null && _editorLayoutCache.signature === signature) {
    return _editorLayoutCache.layout;
  }
  const snapshot = _editorWallsToSnapshot(room.interiorWalls);
  const layout = buildWallLayout(snapshot, BLOCK_SIZE_SMALL, room.widthBlocks, room.heightBlocks, signature);
  _editorLayoutCache = { signature, layout };
  return layout;
}

/**
 * Draws the Surface Rim overlay pass on the editor's own canvas, reading
 * live from `room.interiorWalls[].surfaceRim` (via `getEditorWallLayout`).
 * Call after the existing wall outline/grid drawing in `drawEditorWalls` so
 * the rim sits visually on top, matching the gameplay draw order.
 *
 * The editor has no chunk/viewport culling, so this always covers the full
 * room — editor rooms are small enough (single active room, not a scrolling
 * multi-chunk world) that this is not a performance concern.
 */
export function drawEditorSurfaceRimOverlay(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const layout = getEditorWallLayout(room);
  renderSurfaceEdgeOverlayPass(ctx, {
    surfaceExposureMap: layout.surfaceExposureMap,
    ambientDepths: null,
    isBlockTintEnabled: false,
    offsetXPx,
    offsetYPx,
    scalePx: zoom,
    blockSizePx: BLOCK_SIZE_SMALL,
    filterColMinBlocks: 0,
    filterColMaxBlocks: room.widthBlocks - 1,
    filterRowMinBlocks: 0,
    filterRowMaxBlocks: room.heightBlocks - 1,
    getStyleForTile: (col, row) => layout.tileSurfaceRim.get(`${col},${row}`) ?? null,
    interiorTileCoords: layout.occupiedTiles,
    getInteriorDistanceForTile: (col, row) => layout.interiorRimDistanceField.get(`${col},${row}`),
  });
}
