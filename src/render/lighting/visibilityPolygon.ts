/**
 * visibilityPolygon.ts — Angular-sweep visibility polygon algorithm.
 *
 * Given a light origin and a list of axis-aligned wall segments, computes the
 * set of world-space points that form the visible polygon (shadow boundary).
 *
 * Performance rules (hot path — called once per casting light per frame):
 *   • Pre-allocated Float64Arrays; no per-call heap allocation.
 *   • No closures, no Array.map/filter inside sweep loop.
 *   • O(n log n) where n = number of occluder endpoints.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum number of visibility polygon vertices we can store. */
const MAX_VIS_POINTS = 512;
/** Maximum number of occluder wall segments supported per call. */
const MAX_SEGS = 2048;
const EPSILON = 1e-6;

// ── Public types ──────────────────────────────────────────────────────────────

/** A single axis-aligned wall segment (one edge of an AABB wall). */
export interface OccluderSegment {
  ax: number; ay: number;
  bx: number; by: number;
}

/** Result of a visibility polygon computation. */
export interface VisibilityResult {
  /** Interleaved [x0, y0, x1, y1, …] world-space vertices of the polygon. */
  readonly points: Float64Array;
  /** Number of valid (x, y) pairs in `points`. */
  pointCount: number;
}

// ── Pre-allocated scratch buffers ─────────────────────────────────────────────

const _anglesRaw    = new Float64Array(MAX_SEGS * 4); // up to 2 endpoints × 2 delta angles
const _anglesSorted = new Float64Array(MAX_SEGS * 4);
const _visPoints    = new Float64Array(MAX_VIS_POINTS * 2);
/** Pre-allocated 2-element scratch buffer for ray-segment intersection output. */
const _hitOut       = new Float64Array(2);

// Reused result object — caller must consume before next call.
const _result: VisibilityResult = { points: _visPoints, pointCount: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function atan2Wrapped(dy: number, dx: number): number {
  return Math.atan2(dy, dx);
}

/**
 * Returns the intersection point of ray (ox, oy, angle) with segment (ax,ay)→(bx,by).
 * Writes result into out[outOffset] and out[outOffset+1].
 * Returns the ray-parameter t (distance ratio), or -1 if no intersection.
 */
function raySegmentIntersect(
  ox: number, oy: number,
  rdx: number, rdy: number,
  ax: number, ay: number, bx: number, by: number,
  out: Float64Array, outOffset: number,
): number {
  const sdx = bx - ax;
  const sdy = by - ay;
  const denom = rdx * sdy - rdy * sdx;
  if (Math.abs(denom) < EPSILON) return -1;
  const t = ((ax - ox) * sdy - (ay - oy) * sdx) / denom;
  const u = ((ax - ox) * rdy - (ay - oy) * rdx) / denom;
  if (t < 0 || u < 0 || u > 1) return -1;
  out[outOffset]     = ox + t * rdx;
  out[outOffset + 1] = oy + t * rdy;
  return t;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build occluder segments from a list of AABB walls, clipped to `radiusWorld`
 * around the light origin to reduce work.
 *
 * Each wall rectangle produces up to 4 axis-aligned edge segments, but we only
 * emit segments whose midpoint is inside the light radius.
 *
 * @param walls    Flat array [x, y, w, h, x, y, w, h, …] of wall AABBs in world units.
 * @param wallCount Number of walls (length of `walls` ÷ 4).
 * @param ox       Light origin X in world units.
 * @param oy       Light origin Y in world units.
 * @param radiusWorld Light radius in world units.
 * @param out      Output array (must be length ≥ wallCount * 4).
 * @returns Number of segments written into `out`.
 */
export function buildWallOccluders(
  walls: readonly { xWorld: number; yWorld: number; wWorld: number; hWorld: number; isPlatformFlag?: 0 | 1 }[],
  ox: number, oy: number, radiusWorld: number,
  out: OccluderSegment[],
): number {
  let count = 0;
  const r2 = radiusWorld * radiusWorld;
  for (let i = 0; i < walls.length && count < MAX_SEGS; i++) {
    const w = walls[i];
    // Skip platforms — they are one-sided and don't cast shadows.
    if (w.isPlatformFlag === 1) continue;

    const x0 = w.xWorld;
    const y0 = w.yWorld;
    const x1 = x0 + w.wWorld;
    const y1 = y0 + w.hWorld;

    // Cull walls entirely outside the light radius (cheap AABB check).
    const cx = Math.max(x0, Math.min(ox, x1));
    const cy = Math.max(y0, Math.min(oy, y1));
    const dx = ox - cx;
    const dy = oy - cy;
    if (dx * dx + dy * dy > r2) continue;

    // Emit the 4 edges (top, right, bottom, left).
    if (count < MAX_SEGS) { out[count] = out[count] ?? { ax: 0, ay: 0, bx: 0, by: 0 }; const s = out[count]; s.ax = x0; s.ay = y0; s.bx = x1; s.by = y0; count++; }
    if (count < MAX_SEGS) { out[count] = out[count] ?? { ax: 0, ay: 0, bx: 0, by: 0 }; const s = out[count]; s.ax = x1; s.ay = y0; s.bx = x1; s.by = y1; count++; }
    if (count < MAX_SEGS) { out[count] = out[count] ?? { ax: 0, ay: 0, bx: 0, by: 0 }; const s = out[count]; s.ax = x1; s.ay = y1; s.bx = x0; s.by = y1; count++; }
    if (count < MAX_SEGS) { out[count] = out[count] ?? { ax: 0, ay: 0, bx: 0, by: 0 }; const s = out[count]; s.ax = x0; s.ay = y1; s.bx = x0; s.by = y0; count++; }
  }
  return count;
}

/**
 * Angular-sweep visibility polygon.
 *
 * Casts rays toward every segment endpoint (and ±EPSILON neighbours) and
 * records the closest intersection to build the visible polygon.
 *
 * @param ox          Light origin X (world units).
 * @param oy          Light origin Y (world units).
 * @param radiusWorld Light radius (world units) — used as the fallback ray length.
 * @param segs        Occluder segments (produced by `buildWallOccluders`).
 * @param segCount    Number of valid entries in `segs`.
 * @returns           Shared `VisibilityResult` — consume before next call.
 */
export function computeVisibilityPolygon(
  ox: number, oy: number, radiusWorld: number,
  segs: OccluderSegment[], segCount: number,
): VisibilityResult {
  // Collect unique angles toward every segment endpoint.
  let angleCount = 0;
  for (let i = 0; i < segCount; i++) {
    const s = segs[i];
    const a1 = atan2Wrapped(s.ay - oy, s.ax - ox);
    const a2 = atan2Wrapped(s.by - oy, s.bx - ox);
    _anglesRaw[angleCount++] = a1 - EPSILON;
    _anglesRaw[angleCount++] = a1;
    _anglesRaw[angleCount++] = a2 - EPSILON;
    _anglesRaw[angleCount++] = a2;
  }
  // Also cast the 4 cardinal rays so we always get a full-circle fallback.
  _anglesRaw[angleCount++] = 0;
  _anglesRaw[angleCount++] = Math.PI / 2;
  _anglesRaw[angleCount++] = Math.PI;
  _anglesRaw[angleCount++] = -Math.PI / 2;

  // Copy and sort angles.
  for (let i = 0; i < angleCount; i++) _anglesSorted[i] = _anglesRaw[i];
  // Insertion sort is fast for small n; we expect ≤ ~500 angles.
  for (let i = 1; i < angleCount; i++) {
    const key = _anglesSorted[i];
    let j = i - 1;
    while (j >= 0 && _anglesSorted[j] > key) {
      _anglesSorted[j + 1] = _anglesSorted[j];
      j--;
    }
    _anglesSorted[j + 1] = key;
  }

  // Deduplicate.
  let uniqueCount = 0;
  for (let i = 0; i < angleCount; i++) {
    if (i === 0 || Math.abs(_anglesSorted[i] - _anglesSorted[i - 1]) > EPSILON * 0.1) {
      _anglesSorted[uniqueCount++] = _anglesSorted[i];
    }
  }

  // For each angle, find the nearest intersecting segment.
  let ptCount = 0;
  for (let i = 0; i < uniqueCount && ptCount < MAX_VIS_POINTS; i++) {
    const angle = _anglesSorted[i];
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);

    let minT = radiusWorld;
    let hx = ox + rdx * radiusWorld;
    let hy = oy + rdy * radiusWorld;

    for (let j = 0; j < segCount; j++) {
      const s = segs[j];
      const t = raySegmentIntersect(ox, oy, rdx, rdy, s.ax, s.ay, s.bx, s.by, _hitOut, 0);
      if (t >= 0 && t < minT) {
        minT = t;
        hx = _hitOut[0];
        hy = _hitOut[1];
      }
    }

    _visPoints[ptCount * 2]     = hx;
    _visPoints[ptCount * 2 + 1] = hy;
    ptCount++;
  }

  _result.pointCount = ptCount;
  return _result;
}
