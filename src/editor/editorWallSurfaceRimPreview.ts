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
 * gameplay renderer.
 */

import type { EditorRoomData, EditorWall } from './editorElementTypes';
import { BLOCK_SIZE_SMALL, BLOCK_SIZE_MEDIUM, blockThemeToIndex, WALL_THEME_DEFAULT_INDEX } from '../levels/roomDef';
import { buildWallLayout, type CachedWallLayout } from '../render/walls/blockWallLayoutCache';
import type { WallSnapshot } from '../render/snapshotTypes';
import { hashSurfaceRimStyle, normalizeSurfaceRimStyle, type SurfaceRimStyle, internSurfaceRimStyle } from '../render/walls/surfaceRimStyle';
import { renderSurfaceEdgeOverlayPass } from '../render/walls/surfaceEdgeOverlay';
import { buildCompleteBoundaryWalls } from '../levels/roomBoundaryWalls';
import { wallShapeOrientationIndex } from '../levels/stairsGeometry';
import { editorPerfCounters } from './editorPerfCounters';
import type { EditorViewport } from './editorRendererHelpers';

/** Cheap per-wall signature — cheaper than a full WallSnapshot content hash, adequate for the small wall counts a single editor room has. */
function _signatureFor(walls: readonly EditorWall[], widthBlocks: number, heightBlocks: number, roomTheme: string | null): string {
  let s = `${widthBlocks}x${heightBlocks}|${roomTheme ?? ''}|${walls.length}`;
  for (const w of walls) {
    s += `|${w.xBlock},${w.yBlock},${w.wBlock},${w.hBlock},${w.isPlatformFlag},${w.platformEdge},` +
      `${w.rampOrientation ?? ''},${w.stairsOrientation ?? ''},${w.isPillarHalfWidthFlag},` +
      `${w.blockTheme ?? ''},` +
      `${w.surfaceRim ? hashSurfaceRimStyle(normalizeSurfaceRimStyle(w.surfaceRim)) : ''}`;
  }
  return s;
}

let _editorLayoutCache: { room: EditorRoomData | null; wallGeometryRevision: number; signature: string; layout: CachedWallLayout } | null = null;

export function resetEditorWallLayoutCache(): void {
  _editorLayoutCache = null;
}

/** Converts live editor room data directly into a WallSnapshot without full roomDef conversion or O(n²) wall merging. */
export function buildEditorWallSnapshot(room: EditorRoomData): WallSnapshot {
  const boundaryWalls = buildCompleteBoundaryWalls(room.widthBlocks, room.heightBlocks);
  const interiorWalls = room.interiorWalls;
  const count = boundaryWalls.length + interiorWalls.length;

  const xWorld = new Float32Array(count);
  const yWorld = new Float32Array(count);
  const wWorld = new Float32Array(count);
  const hWorld = new Float32Array(count);
  const isPlatformFlag = new Uint8Array(count);
  const platformEdge = new Uint8Array(count);
  const themeIndex = new Uint8Array(count);
  const isInvisibleFlag = new Uint8Array(count);
  const rampOrientationIndex = new Uint8Array(count);
  const isPillarHalfWidthFlag = new Uint8Array(count);
  const surfaceRimStyleIndex = new Uint16Array(count);
  const surfaceRimStyleTable: SurfaceRimStyle[] = [];

  for (let i = 0; i < count; i++) {
    const def = i < boundaryWalls.length ? boundaryWalls[i] : interiorWalls[i - boundaryWalls.length];
    const isHalfWidthPillar = def.isPillarHalfWidthFlag === 1;
    const rawWWorld = isHalfWidthPillar
      ? Math.max(BLOCK_SIZE_MEDIUM / 2, def.wBlock * (BLOCK_SIZE_MEDIUM / 2))
      : Math.max(BLOCK_SIZE_MEDIUM, def.wBlock * BLOCK_SIZE_MEDIUM);

    xWorld[i] = def.xBlock * BLOCK_SIZE_MEDIUM;
    yWorld[i] = def.yBlock * BLOCK_SIZE_MEDIUM;
    wWorld[i] = rawWWorld;
    hWorld[i] = Math.max(BLOCK_SIZE_MEDIUM, def.hBlock * BLOCK_SIZE_MEDIUM);
    isPlatformFlag[i] = def.isPlatformFlag === 1 ? 1 : 0;
    platformEdge[i] = def.platformEdge ?? 0;
    themeIndex[i] = def.blockTheme !== undefined ? blockThemeToIndex(def.blockTheme) : WALL_THEME_DEFAULT_INDEX;
    isInvisibleFlag[i] = 'isInvisibleFlag' in def && def.isInvisibleFlag === 1 ? 1 : 0;
    rampOrientationIndex[i] = wallShapeOrientationIndex(def);
    isPillarHalfWidthFlag[i] = isHalfWidthPillar ? 1 : 0;
    surfaceRimStyleIndex[i] = internSurfaceRimStyle(surfaceRimStyleTable, def.surfaceRim);
  }

  return {
    count,
    xWorld,
    yWorld,
    wWorld,
    hWorld,
    isPlatformFlag,
    platformEdge,
    themeIndex,
    isInvisibleFlag,
    rampOrientationIndex,
    isPillarHalfWidthFlag,
    surfaceRimStyleIndex,
    surfaceRimStyleTable,
  };
}

/**
 * Returns the current editor room's wall layout (rebuilding only when the
 * room or wallGeometryRevision changed since the last call) — completely independent
 * of the gameplay `blockWallLayoutCache.ts` singleton.
 */
export function getEditorWallLayout(room: EditorRoomData, wallGeometryRevision = -1): CachedWallLayout {
  if (
    _editorLayoutCache !== null &&
    _editorLayoutCache.room === room &&
    _editorLayoutCache.wallGeometryRevision === wallGeometryRevision &&
    wallGeometryRevision >= 0
  ) {
    return _editorLayoutCache.layout;
  }

  const signature = _signatureFor(room.interiorWalls, room.widthBlocks, room.heightBlocks, room.blockTheme);
  if (_editorLayoutCache !== null && _editorLayoutCache.signature === signature) {
    _editorLayoutCache.room = room;
    _editorLayoutCache.wallGeometryRevision = wallGeometryRevision;
    return _editorLayoutCache.layout;
  }

  editorPerfCounters.surfaceRimLayoutRebuilds++;
  const snapshot = buildEditorWallSnapshot(room);
  const layout = buildWallLayout(snapshot, BLOCK_SIZE_SMALL, room.widthBlocks, room.heightBlocks, signature);
  _editorLayoutCache = { room, wallGeometryRevision, signature, layout };
  return layout;
}

/**
 * Draws the Surface Rim overlay pass on the editor's own canvas, reading
 * live directly from `room.interiorWalls[].surfaceRim` (via `getEditorWallLayout`).
 * Passes visible bounds into renderSurfaceEdgeOverlayPass to prevent invisible-edge rendering.
 */
export function drawEditorSurfaceRimOverlay(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  viewport?: EditorViewport,
  wallGeometryRevision = -1,
): void {
  const layout = getEditorWallLayout(room, wallGeometryRevision);
  const filterColMinBlocks = viewport ? Math.max(0, viewport.minCol) : 0;
  const filterColMaxBlocks = viewport ? Math.min(room.widthBlocks - 1, viewport.maxCol) : room.widthBlocks - 1;
  const filterRowMinBlocks = viewport ? Math.max(0, viewport.minRow) : 0;
  const filterRowMaxBlocks = viewport ? Math.min(room.heightBlocks - 1, viewport.maxRow) : room.heightBlocks - 1;

  renderSurfaceEdgeOverlayPass(ctx, {
    surfaceExposureMap: layout.surfaceExposureMap,
    ambientDepths: null,
    isBlockTintEnabled: false,
    offsetXPx,
    offsetYPx,
    scalePx: zoom,
    blockSizePx: BLOCK_SIZE_SMALL,
    filterColMinBlocks,
    filterColMaxBlocks,
    filterRowMinBlocks,
    filterRowMaxBlocks,
    getStyleForTile: (col, row) => layout.tileSurfaceRim.get(`${col},${row}`) ?? null,
    customRimPixels: layout.customSurfaceRimPixels,
    customRimRenderData: layout.customSurfaceRimRenderData,
  });
}
