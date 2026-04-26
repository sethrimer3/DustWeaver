/**
 * Zoom-dependent sketch renderer for the Skill Tomb world map.
 *
 * When the map is zoomed out, rooms are drawn as organic, hand-sketched
 * silhouettes instead of individual block tiles.  The transition between the
 * two rendering modes is governed by a smoothstep blend over the zoom range
 * [ZOOM_SKETCH_FULL, ZOOM_DETAIL_FULL].
 *
 * Key design decisions:
 *  - Contours are computed once per room and cached; they never regenerate
 *    per frame.
 *  - All jitter is deterministic: derived from the room ID hash and the point
 *    index — never from Math.random().
 *  - The sketch pass is separate from (and drawn beneath) the detail pass, so
 *    both can be composited with individual alpha values during the transition.
 */

import type { RoomDef } from '../levels/roomDef';

// ── LOD thresholds (exported for use in the map renderer) ────────────────────

/** Map zoom below which the sketch silhouette is fully opaque (detail fully hidden). */
export const ZOOM_SKETCH_FULL = 3;

/** Map zoom above which the detail block tiles are fully opaque (sketch hidden). */
export const ZOOM_DETAIL_FULL = 5;

// ── Sketch visual constants ───────────────────────────────────────────────────

/** Number of sketch strokes drawn per contour (layered for pencil-like look). */
const STROKE_COUNT = 3;

/** Base alpha for the first stroke; each additional stroke is slightly dimmer. */
const STROKE_ALPHA_BASE = 0.55;

/** Alpha step reduction per subsequent stroke. */
const STROKE_ALPHA_STEP = 0.10;

/** Line width in canvas pixels for the first stroke. */
const STROKE_LINE_WIDTH_PX = 2.2;

/** Line width reduction per subsequent stroke. */
const STROKE_LINE_WIDTH_STEP = 0.35;

/** Max jitter offset in canvas pixels (constant visual size across zoom levels). */
const JITTER_PX = 3.5;

/** Alpha for the interior fill of a sketch room silhouette. */
const SKETCH_FILL_ALPHA = 0.07;

/** Stroke color (RGB) for the currently-active room. */
const STROKE_RGB_CURRENT = '180, 130, 60';

/** Stroke color (RGB) for non-active explored rooms. */
const STROKE_RGB_OTHER = '105, 100, 92';

/** Fill color (RGB) for the currently-active room. */
const FILL_RGB_CURRENT = '180, 130, 60';

/** Fill color (RGB) for non-active explored rooms. */
const FILL_RGB_OTHER = '90, 85, 78';

/**
 * Sample interval when walking the column-scan to build the contour.
 * One contour vertex is emitted for every CONTOUR_STEP_BLOCKS columns.
 */
const CONTOUR_STEP_BLOCKS = 2;

/**
 * Index offset used when generating stroke-level jitter noise.
 * Must be large enough to be disjoint from per-point indices (max room size
 * is several hundred blocks, so 0xffff is safely out of range).
 */
const STROKE_JITTER_INDEX_OFFSET = 0xffff;

/**
 * Starting noise channel for per-stroke, per-point jitter.
 * Channels 0–1 are reserved for the interior fill (see drawRoomSketch fill
 * pass); channels starting here are used for the stroke passes.
 */
const POINT_JITTER_CHANNEL_BASE = 10;

// ── Deterministic noise ───────────────────────────────────────────────────────

/** FNV-1a hash of a room ID string — used as the per-room noise seed. */
function hashRoomId(roomId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Returns a deterministic noise value in [-0.5, 0.5] for the given inputs.
 * Uses a multiply-shift hash mix so the values are well-distributed and
 * stable across frames.
 */
function deterministicNoise(roomHash: number, pointIndex: number, channel: number): number {
  let h = (roomHash + Math.imul(pointIndex, 0x9e3779b9) + Math.imul(channel, 0x6b43a9b5)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 15), 0xd762a71f);
  h ^= h >>> 17;
  return ((h >>> 0) / 0xffffffff) - 0.5;
}

// ── Contour data ──────────────────────────────────────────────────────────────

/** Immutable contour for a single room, cached after first build. */
interface ContourData {
  /**
   * Interleaved [x, y] pairs in room-local block units, forming a closed
   * polygon.  Length = pointCount * 2.
   */
  readonly points: Float32Array;
  /** Number of vertices in the contour. */
  readonly pointCount: number;
}

/** Per-room contour cache — rooms are static, so this never needs invalidation. */
const contourCache = new Map<string, ContourData>();

/**
 * Builds and caches the silhouette contour for a room.
 *
 * Algorithm (orientation-aware):
 * 1. Rasterise all (non-invisible) walls into a boolean solid grid.
 * 2a. If the room is wider than tall (or square): **column-scan** — find the
 *     topmost and bottommost empty cell per column, then walk L→R along the
 *     top edge and R→L along the bottom edge.
 * 2b. If the room is taller than wide: **row-scan** — find the leftmost and
 *     rightmost empty cell per row, then walk top→bottom along the left edge
 *     and bottom→top along the right edge.
 * 3. Sample every CONTOUR_STEP_BLOCKS steps and build a single closed polygon.
 *
 * Using the dominant axis ensures that rooms with a winding vertical corridor
 * (e.g. tall S-shaped rooms) sketch their sinuous left/right edges rather than
 * producing flat vertical lines.
 *
 * If every cell is solid (degenerate room) the full bounding box is used.
 */
function buildRoomContour(room: RoomDef): ContourData {
  const cached = contourCache.get(room.id);
  if (cached !== undefined) return cached;

  const w = room.widthBlocks;
  const h = room.heightBlocks;

  // Rasterise walls into a Uint8Array solid grid.
  const solid = new Uint8Array(w * h);
  for (const wall of room.walls) {
    if (wall.isInvisibleFlag === 1) continue;
    const x0 = Math.max(0, wall.xBlock);
    const y0 = Math.max(0, wall.yBlock);
    const x1 = Math.min(w, wall.xBlock + wall.wBlock);
    const y1 = Math.min(h, wall.yBlock + wall.hBlock);
    for (let gy = y0; gy < y1; gy++) {
      for (let gx = x0; gx < x1; gx++) {
        solid[gy * w + gx] = 1;
      }
    }
  }

  // ── Tall rooms: row-scan (left/right edges per row) ───────────────────────
  if (h > w) {
    const leftEdge  = new Int16Array(h).fill(-1);
    const rightEdge = new Int16Array(h).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (solid[y * w + x] === 0) {
          if (leftEdge[y] === -1) leftEdge[y] = x;
          rightEdge[y] = x;
        }
      }
    }

    // Find the topmost and bottommost row with at least one empty cell.
    let rowMin = -1;
    let rowMax = -1;
    for (let y = 0; y < h; y++) {
      if (leftEdge[y] !== -1) {
        if (rowMin === -1) rowMin = y;
        rowMax = y;
      }
    }

    // Degenerate case: all solid — use full bounding box.
    if (rowMin === -1) {
      const pts = new Float32Array([0, 0, w, 0, w, h, 0, h]);
      const contour: ContourData = { points: pts, pointCount: 4 };
      contourCache.set(room.id, contour);
      return contour;
    }

    // Sample left/right edge vertices at CONTOUR_STEP_BLOCKS row intervals.
    // leftPoints/rightPoints are flat [x0,y0, x1,y1, …] arrays.
    const leftPoints:  number[] = [];
    const rightPoints: number[] = [];

    for (let y = rowMin; y <= rowMax; y += CONTOUR_STEP_BLOCKS) {
      const lx = leftEdge[y];
      const rx = rightEdge[y];
      if (lx === -1) continue; // skip all-solid rows within the range
      // lx is the left boundary of the leftmost empty cell;
      // rx + 1 is the right boundary of the rightmost empty cell (mirrors
      // the column-scan's use of "by + 1" for the bottom cell boundary).
      leftPoints.push(lx, y);
      rightPoints.push(rx + 1, y);
    }

    // Ensure the bottommost row is always included (rowMax is guaranteed
    // to have at least one empty cell by construction, so lx !== -1).
    const lastSampledY = rowMin + Math.floor((rowMax - rowMin) / CONTOUR_STEP_BLOCKS) * CONTOUR_STEP_BLOCKS;
    if (lastSampledY < rowMax) {
      const lx = leftEdge[rowMax];
      const rx = rightEdge[rowMax];
      leftPoints.push(lx, rowMax);
      rightPoints.push(rx + 1, rowMax);
    }

    // Build closed polygon: left edge top→bottom then right edge bottom→top.
    const leftPtCount  = leftPoints.length  / 2;
    const rightPtCount = rightPoints.length / 2;
    const pointCount   = leftPtCount + rightPtCount;
    const points = new Float32Array(pointCount * 2);
    let pi = 0;

    for (let i = 0; i < leftPoints.length; i++) {
      points[pi++] = leftPoints[i];
    }
    // Reverse the right edge so the polygon winds correctly.
    for (let i = rightPtCount - 1; i >= 0; i--) {
      points[pi++] = rightPoints[i * 2];
      points[pi++] = rightPoints[i * 2 + 1];
    }

    const contour: ContourData = { points, pointCount };
    contourCache.set(room.id, contour);
    return contour;
  }

  // ── Wide/square rooms: column-scan (top/bottom edges per column) ──────────

  const topEdge = new Int16Array(w).fill(-1);
  const botEdge = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (solid[y * w + x] === 0) {
        if (topEdge[x] === -1) topEdge[x] = y;
        botEdge[x] = y;
      }
    }
  }

  // Find the leftmost and rightmost column that has at least one empty cell.
  let colMin = -1;
  let colMax = -1;
  for (let x = 0; x < w; x++) {
    if (topEdge[x] !== -1) {
      if (colMin === -1) colMin = x;
      colMax = x;
    }
  }

  // Degenerate case: all solid — use full bounding box.
  if (colMin === -1) {
    const pts = new Float32Array([0, 0, w, 0, w, h, 0, h]);
    const contour: ContourData = { points: pts, pointCount: 4 };
    contourCache.set(room.id, contour);
    return contour;
  }

  // Sample contour vertices at CONTOUR_STEP_BLOCKS intervals.
  // topPoints/botPoints are flat [x0,y0, x1,y1, …] arrays.
  const topPoints: number[] = [];
  const botPoints: number[] = [];

  for (let x = colMin; x <= colMax; x += CONTOUR_STEP_BLOCKS) {
    let ty = topEdge[x];
    let by = botEdge[x];
    if (ty === -1) { ty = 0; by = h - 1; }
    topPoints.push(x, ty);
    botPoints.push(x, by + 1);
  }

  // Ensure the rightmost column is always included.
  const lastSampledX = colMin + Math.floor((colMax - colMin) / CONTOUR_STEP_BLOCKS) * CONTOUR_STEP_BLOCKS;
  if (lastSampledX < colMax) {
    let ty = topEdge[colMax];
    let by = botEdge[colMax];
    if (ty === -1) { ty = 0; by = h - 1; }
    topPoints.push(colMax, ty);
    botPoints.push(colMax, by + 1);
  }

  // Build closed polygon: top L→R then bottom R→L.
  const topPtCount = topPoints.length / 2;
  const botPtCount = botPoints.length / 2;
  const pointCount = topPtCount + botPtCount;
  const points = new Float32Array(pointCount * 2);
  let pi = 0;

  for (let i = 0; i < topPoints.length; i++) {
    points[pi++] = topPoints[i];
  }
  // Reverse the bottom edge so the polygon winds correctly.
  for (let i = botPtCount - 1; i >= 0; i--) {
    points[pi++] = botPoints[i * 2];
    points[pi++] = botPoints[i * 2 + 1];
  }

  const contour: ContourData = { points, pointCount };
  contourCache.set(room.id, contour);
  return contour;
}

// ── Smoothstep helper ─────────────────────────────────────────────────────────

/**
 * Hermite interpolation between 0 and 1 over the range [edge0, edge1].
 * Returns 0 when x ≤ edge0, 1 when x ≥ edge1.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Public sketch draw call ───────────────────────────────────────────────────

/**
 * Draws the sketch-mode silhouette of one room.
 *
 * The silhouette is rendered as 2–3 layered strokes with deterministic per-point
 * jitter to produce a hand-drawn appearance.  A very faint interior fill
 * improves readability.
 *
 * @param ctx          Canvas 2D rendering context.
 * @param room         Room definition (used for contour building and ID hash).
 * @param mapXBlock    Room origin X in map-block coordinates.
 * @param mapYBlock    Room origin Y in map-block coordinates.
 * @param centerX      Canvas X of block-coordinate origin (including pan).
 * @param centerY      Canvas Y of block-coordinate origin (including pan).
 * @param cellSizePx   Pixels per block (= mapZoom).
 * @param alpha        Overall sketch opacity (0–1); controlled by LOD blend.
 * @param isCurrentRoom Whether this is the player's current room.
 */
export function drawRoomSketch(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  mapXBlock: number,
  mapYBlock: number,
  centerX: number,
  centerY: number,
  cellSizePx: number,
  alpha: number,
  isCurrentRoom: boolean,
): void {
  const contour = buildRoomContour(room);
  if (contour.pointCount < 3) return;

  const roomHash = hashRoomId(room.id);
  const strokeRgb = isCurrentRoom ? STROKE_RGB_CURRENT : STROKE_RGB_OTHER;
  const fillRgb   = isCurrentRoom ? FILL_RGB_CURRENT   : FILL_RGB_OTHER;

  // ── Interior fill (drawn first, beneath strokes) ──────────────────────────
  ctx.save();
  ctx.globalAlpha = alpha * SKETCH_FILL_ALPHA;
  ctx.fillStyle = `rgb(${fillRgb})`;
  ctx.beginPath();
  for (let i = 0; i < contour.pointCount; i++) {
    const bx = contour.points[i * 2];
    const by = contour.points[i * 2 + 1];
    const jx = deterministicNoise(roomHash, i, 0) * JITTER_PX;
    const jy = deterministicNoise(roomHash, i, 1) * JITTER_PX;
    const sx = centerX + (mapXBlock + bx) * cellSizePx + jx;
    const sy = centerY + (mapYBlock + by) * cellSizePx + jy;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ── Multi-stroke sketch outline ───────────────────────────────────────────
  for (let strokeIndex = 0; strokeIndex < STROKE_COUNT; strokeIndex++) {
    // Each stroke gets a stable whole-stroke offset for hand-drawn wobble.
    const strokeOffX = deterministicNoise(roomHash, STROKE_JITTER_INDEX_OFFSET + strokeIndex, strokeIndex * 2)     * JITTER_PX * 0.4;
    const strokeOffY = deterministicNoise(roomHash, STROKE_JITTER_INDEX_OFFSET + strokeIndex, strokeIndex * 2 + 1) * JITTER_PX * 0.4;

    // Per-stroke jitter channel seeds (different per stroke, stable per point).
    const chanX = POINT_JITTER_CHANNEL_BASE + strokeIndex * 2;
    const chanY = POINT_JITTER_CHANNEL_BASE + strokeIndex * 2 + 1;

    ctx.save();
    ctx.globalAlpha = alpha * (STROKE_ALPHA_BASE - strokeIndex * STROKE_ALPHA_STEP);
    ctx.strokeStyle = `rgb(${strokeRgb})`;
    ctx.lineWidth   = STROKE_LINE_WIDTH_PX - strokeIndex * STROKE_LINE_WIDTH_STEP;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    ctx.beginPath();
    for (let i = 0; i < contour.pointCount; i++) {
      const bx = contour.points[i * 2];
      const by = contour.points[i * 2 + 1];
      const jx = deterministicNoise(roomHash, i, chanX) * JITTER_PX + strokeOffX;
      const jy = deterministicNoise(roomHash, i, chanY) * JITTER_PX + strokeOffY;
      const sx = centerX + (mapXBlock + bx) * cellSizePx + jx;
      const sy = centerY + (mapYBlock + by) * cellSizePx + jy;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
