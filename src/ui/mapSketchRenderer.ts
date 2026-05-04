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
 *  - Sketch outlines are generated from exposed solid-tile boundaries:
 *    for every solid tile, each neighbor that is empty or out-of-bounds
 *    contributes an edge segment.  These segments are chained into closed
 *    polylines, so interior islands, platforms, and holes all produce their
 *    own outline — not just the crude outer cave envelope.
 *  - Multiple contours per room are fully supported; the single-contour
 *    scanline-envelope approach has been replaced.
 *  - All jitter is deterministic: derived from the room ID hash, contour
 *    index, and point index — never from Math.random().
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
function deterministicNoise(seed: number, pointIndex: number, channel: number): number {
  let h = (seed + Math.imul(pointIndex, 0x9e3779b9) + Math.imul(channel, 0x6b43a9b5)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 15), 0xd762a71f);
  h ^= h >>> 17;
  return ((h >>> 0) / 0xffffffff) - 0.5;
}

// ── Contour data ──────────────────────────────────────────────────────────────

/**
 * Immutable contours for a single room, cached after first build.
 *
 * Each contour is one closed polyline tracing the boundary between solid and
 * empty tiles.  The sketch outline is generated from exposed solid-tile
 * boundaries, not from a top/bottom scanline envelope, so interior platforms,
 * islands, and holes each contribute their own outline loop.
 */
interface ContourData {
  /**
   * Each element is one closed contour loop.
   * Stored as interleaved [x, y] pairs in room-local block (vertex) units.
   * Vertices lie on tile corners (integer positions 0..widthBlocks / heightBlocks)
   * after collinear simplification to corner-only points.
   */
  readonly contours: readonly Float32Array[];
}

/** Per-room contour cache — rooms are static, so this never needs invalidation. */
const contourCache = new Map<string, ContourData>();

/**
 * Builds and caches silhouette contours for a room.
 *
 * Algorithm:
 * 1. Rasterize all non-invisible walls into a boolean solid grid.
 * 2. For each solid tile, inspect its four axis-aligned neighbors.
 *    If a neighbor is out of bounds or empty, emit the corresponding tile edge
 *    as a directed segment.  This produces outlines around all exposed wall
 *    boundaries, including interior platforms, islands, and holes — not just
 *    a crude outer cave envelope.
 * 3. Chain directed segments into closed polylines via a directed adjacency
 *    graph.  Multiple disjoint contours per room are fully supported.
 * 4. Remove collinear intermediate vertices (consecutive points sharing the
 *    same x or y coordinate) so only corner vertices are retained.  This
 *    keeps point counts small without losing shape information.
 * 5. Store the resulting Float32Array contours in the cache.
 *
 * The sketch outline is generated from exposed solid-tile boundaries,
 * NOT from a top/bottom (or left/right) scanline envelope.  This ensures
 * that interior geometry — platforms, islands, disconnected wall masses —
 * is always visible in the zoomed-out map view.
 */
function buildRoomContour(room: RoomDef): ContourData {
  const cached = contourCache.get(room.id);
  if (cached !== undefined) return cached;

  const w = room.widthBlocks;
  const h = room.heightBlocks;

  // ── Step 1: Rasterize walls into a Uint8Array solid grid ─────────────────
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

  // ── Step 2: Build directed edge adjacency graph ───────────────────────────
  //
  // Vertices are tile corners at integer positions (0..w) × (0..h).
  // For each solid tile (gx, gy), inspect each of the 4 neighbors:
  //   - If the neighbor is out of bounds or empty, emit a directed edge along
  //     that tile face.  Direction: walking the edge, the solid tile is always
  //     on the left (clockwise winding around solid in Y-down screen space).
  //
  // This generates edges for every exposed solid-tile boundary, so
  // interior islands, platforms, and holes all get their own outline.
  const vertexStride = w + 1;
  // adjacency maps fromVertex → array of toVertex (outgoing directed edges)
  const adjacency = new Map<number, number[]>();

  function addEdge(x0: number, y0: number, x1: number, y1: number): void {
    const from = y0 * vertexStride + x0;
    const to   = y1 * vertexStride + x1;
    const arr = adjacency.get(from);
    if (arr !== undefined) arr.push(to);
    else adjacency.set(from, [to]);
  }

  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      if (solid[gy * w + gx] !== 1) continue;
      // Top edge: emit if top neighbor is empty or out of bounds
      if (gy === 0 || solid[(gy - 1) * w + gx] === 0)
        addEdge(gx, gy, gx + 1, gy);
      // Right edge: emit if right neighbor is empty or out of bounds
      if (gx === w - 1 || solid[gy * w + (gx + 1)] === 0)
        addEdge(gx + 1, gy, gx + 1, gy + 1);
      // Bottom edge: emit if bottom neighbor is empty or out of bounds
      if (gy === h - 1 || solid[(gy + 1) * w + gx] === 0)
        addEdge(gx + 1, gy + 1, gx, gy + 1);
      // Left edge: emit if left neighbor is empty or out of bounds
      if (gx === 0 || solid[gy * w + (gx - 1)] === 0)
        addEdge(gx, gy + 1, gx, gy);
    }
  }

  // ── Step 3: Trace closed contours ─────────────────────────────────────────
  //
  // Each directed edge is consumed exactly once via a per-vertex cursor index.
  // Starting from each unprocessed vertex (outer loop), follow outgoing edges
  // until the loop closes (returns to startVertex) or the chain terminates.
  // Multiple disjoint closed contours are each collected as a separate flat
  // [x, y, x, y, …] point list.
  //
  // A cursor Map (vertex → next unread edge index) is used instead of
  // Array.shift() to keep each edge access O(1).
  const rawContours: number[][] = [];
  // edgeCursor tracks the index of the next unconsumed outgoing edge per vertex.
  const edgeCursor = new Map<number, number>();

  for (const [startVertex, outEdges] of adjacency) {
    let startCursor = edgeCursor.get(startVertex) ?? 0;
    while (startCursor < outEdges.length) {
      const points: number[] = [];
      let cur = startVertex;

      for (;;) {
        const outs = adjacency.get(cur);
        if (outs === undefined) break;
        const cursor = edgeCursor.get(cur) ?? 0;
        if (cursor >= outs.length) break;
        // Advance cursor and consume edge at current position (O(1)).
        edgeCursor.set(cur, cursor + 1);
        const next = outs[cursor];
        const vx = cur % vertexStride;
        const vy = Math.floor(cur / vertexStride);
        points.push(vx, vy);
        cur = next;
        if (cur === startVertex) break; // closed the loop
      }

      if (points.length >= 6) {
        rawContours.push(points);
      }

      startCursor = edgeCursor.get(startVertex) ?? 0;
    }
  }

  // ── Degenerate case: no contours found ────────────────────────────────────
  // rawContours.length === 0 means the adjacency graph had no edges, which
  // implies no solid tiles exist in the room (any solid tile touching the room
  // boundary or an empty neighbor would emit at least one edge).
  if (rawContours.length === 0) {
    const result: ContourData = { contours: [] };
    contourCache.set(room.id, result);
    return result;
  }

  // ── Step 4: Simplify — remove collinear intermediate vertices ─────────────
  //
  // On an axis-aligned grid, three consecutive points are collinear when they
  // share the same x (vertical run) or the same y (horizontal run).  Removing
  // the middle point leaves only corner vertices, which:
  //   - Keeps point counts small (a 20-block horizontal wall → 2 vertices).
  //   - Gives the jitter a natural "per-corner" feel rather than ticking
  //     along every block boundary.
  const simplifiedContours: Float32Array[] = rawContours.map((pts) => {
    const n = pts.length / 2;
    if (n < 4) return new Float32Array(pts);
    const kept: number[] = [];
    for (let i = 0; i < n; i++) {
      const pi = (i + n - 1) % n;
      const ni = (i + 1) % n;
      const px = pts[pi * 2],  py = pts[pi * 2 + 1];
      const cx = pts[i  * 2],  cy = pts[i  * 2 + 1];
      const nx = pts[ni * 2],  ny = pts[ni * 2 + 1];
      // Retain vertex only when it is NOT collinear with both neighbors.
      if (!((px === cx && cx === nx) || (py === cy && cy === ny))) {
        kept.push(cx, cy);
      }
    }
    // If simplification collapses the contour below 3 vertices (a degenerate
    // case that cannot arise for valid closed tile polygons), return an empty
    // array so the ptCount < 3 guard in drawRoomSketch skips it cleanly.
    return new Float32Array(kept.length >= 6 ? kept : []);
  });

  const result: ContourData = { contours: simplifiedContours };
  contourCache.set(room.id, result);
  return result;
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

// ── Internal per-contour sketch draw ─────────────────────────────────────────

/**
 * Draws fill and multi-stroke sketch outline for one contour polyline.
 *
 * @param ctx          Canvas 2D rendering context.
 * @param pts          Interleaved [x, y] Float32Array in room-local block units.
 * @param ptCount      Number of vertices (pts.length / 2).
 * @param contourSeed  Deterministic noise seed for this contour (room hash XOR contour index mix).
 * @param mapXBlock    Room origin X in map-block coordinates.
 * @param mapYBlock    Room origin Y in map-block coordinates.
 * @param centerX      Canvas X of block-coordinate origin (including pan).
 * @param centerY      Canvas Y of block-coordinate origin (including pan).
 * @param cellSizePx   Pixels per block (= mapZoom).
 * @param alpha        Overall sketch opacity (0–1); controlled by LOD blend.
 * @param strokeRgb    CSS RGB string for stroke color.
 * @param fillRgb      CSS RGB string for fill color.
 */
function drawContour(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  ptCount: number,
  contourSeed: number,
  mapXBlock: number,
  mapYBlock: number,
  centerX: number,
  centerY: number,
  cellSizePx: number,
  alpha: number,
  strokeRgb: string,
  fillRgb: string,
): void {
  // Interior fill — drawn first, beneath strokes.
  ctx.save();
  ctx.globalAlpha = alpha * SKETCH_FILL_ALPHA;
  ctx.fillStyle = `rgb(${fillRgb})`;
  ctx.beginPath();
  for (let i = 0; i < ptCount; i++) {
    const bx = pts[i * 2];
    const by = pts[i * 2 + 1];
    const jx = deterministicNoise(contourSeed, i, 0) * JITTER_PX;
    const jy = deterministicNoise(contourSeed, i, 1) * JITTER_PX;
    const sx = centerX + (mapXBlock + bx) * cellSizePx + jx;
    const sy = centerY + (mapYBlock + by) * cellSizePx + jy;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Multi-stroke sketch outline — layered passes for a pencil-like look.
  for (let strokeIndex = 0; strokeIndex < STROKE_COUNT; strokeIndex++) {
    // Stable whole-stroke offset gives each pass a slightly different position.
    const strokeOffX = deterministicNoise(contourSeed, STROKE_JITTER_INDEX_OFFSET + strokeIndex, strokeIndex * 2)     * JITTER_PX * 0.4;
    const strokeOffY = deterministicNoise(contourSeed, STROKE_JITTER_INDEX_OFFSET + strokeIndex, strokeIndex * 2 + 1) * JITTER_PX * 0.4;

    // Per-stroke jitter channels (different per stroke, stable per point).
    const chanX = POINT_JITTER_CHANNEL_BASE + strokeIndex * 2;
    const chanY = POINT_JITTER_CHANNEL_BASE + strokeIndex * 2 + 1;

    ctx.save();
    ctx.globalAlpha = alpha * (STROKE_ALPHA_BASE - strokeIndex * STROKE_ALPHA_STEP);
    ctx.strokeStyle = `rgb(${strokeRgb})`;
    ctx.lineWidth   = STROKE_LINE_WIDTH_PX - strokeIndex * STROKE_LINE_WIDTH_STEP;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    ctx.beginPath();
    for (let i = 0; i < ptCount; i++) {
      const bx = pts[i * 2];
      const by = pts[i * 2 + 1];
      const jx = deterministicNoise(contourSeed, i, chanX) * JITTER_PX + strokeOffX;
      const jy = deterministicNoise(contourSeed, i, chanY) * JITTER_PX + strokeOffY;
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

// ── Public sketch draw call ───────────────────────────────────────────────────

/**
 * Draws the sketch-mode silhouette of one room.
 *
 * All contours for the room are drawn — outer cave boundary, interior
 * platforms, island masses, and hole boundaries alike.  Each contour is
 * rendered as fill + 2–3 layered strokes with deterministic per-point jitter
 * to produce a hand-drawn appearance.
 *
 * Jitter is seeded per contour using: roomHash XOR (contourIndex * prime),
 * plus the point index and channel, so the same room never flickers and
 * different contours within the same room have independent noise fields.
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
  const data = buildRoomContour(room);
  if (data.contours.length === 0) return;

  const roomHash  = hashRoomId(room.id);
  const strokeRgb = isCurrentRoom ? STROKE_RGB_CURRENT : STROKE_RGB_OTHER;
  const fillRgb   = isCurrentRoom ? FILL_RGB_CURRENT   : FILL_RGB_OTHER;

  // Draw every contour — outer boundary, interior islands, and hole boundaries
  // all get their own sketch outline.  Jitter seed is varied per contour so
  // each loop has independent noise (stable across frames, different per loop).
  for (let contourIndex = 0; contourIndex < data.contours.length; contourIndex++) {
    const pts = data.contours[contourIndex];
    const ptCount = pts.length / 2;
    if (ptCount < 3) continue;

    // Mix the contour index into the room hash so each contour has its own
    // stable noise field: same room + same contour index → same jitter.
    const contourSeed = (roomHash ^ Math.imul(contourIndex + 1, 0x9e3779b9)) | 0;

    drawContour(
      ctx, pts, ptCount, contourSeed,
      mapXBlock, mapYBlock, centerX, centerY,
      cellSizePx, alpha, strokeRgb, fillRgb,
    );
  }
}
