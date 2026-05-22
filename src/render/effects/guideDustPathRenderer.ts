/**
 * GuideDustPathRenderer — golden dust mote particles traveling along
 * editor-authored Catmull-Rom spline paths.
 *
 * Each active path gets a pool of motes that travel along the path
 * indefinitely. Motes fade in and out over their traversal cycle.
 *
 * Usage:
 *   initFromRoom(room)                   — set up mote pools from a RoomDef
 *   update(dtMs)                         — advance mote positions
 *   render(ctx, ox, oy, zoom, vpW, vpH)  — draw onto a 2D canvas
 */

import type { RoomDef, RoomGuideDustPathPointDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

/** Maximum total motes across all paths. */
const MAX_MOTES = 512;
/** Base milliseconds for one full path traversal at speedFactor = 1.0. */
const BASE_CYCLE_MS = 6000;
/** Fill color for individual dust motes. */
const GUIDE_DUST_MOTE_COLOR = 'rgba(255, 200, 50, 1)';

/**
 * Evaluate a Catmull-Rom spline with clamped endpoints at normalized parameter
 * `t` in [0, 1). Returns {x, y} in world units.
 */
function catmullRomWorld(
  pts: readonly RoomGuideDustPathPointDef[],
  loop: boolean,
  t: number,
): { x: number; y: number } {
  const n = pts.length;
  const segCount = loop ? n : n - 1;
  const rawSeg = t * segCount;
  const segIndex = Math.min(Math.floor(rawSeg), segCount - 1);
  const localT = rawSeg - segIndex;

  const i1 = segIndex % n;
  const i2 = loop ? (segIndex + 1) % n : Math.min(n - 1, segIndex + 1);
  const i0 = loop ? (segIndex - 1 + n) % n : Math.max(0, segIndex - 1);
  const i3 = loop ? (segIndex + 2) % n : Math.min(n - 1, segIndex + 2);

  const bs = BLOCK_SIZE_SMALL;
  const x0 = pts[i0].xBlock * bs; const y0 = pts[i0].yBlock * bs;
  const x1 = pts[i1].xBlock * bs; const y1 = pts[i1].yBlock * bs;
  const x2 = pts[i2].xBlock * bs; const y2 = pts[i2].yBlock * bs;
  const x3 = pts[i3].xBlock * bs; const y3 = pts[i3].yBlock * bs;

  const t2 = localT * localT;
  const t3 = t2 * localT;

  const x = 0.5 * (
    (2 * x1) +
    (-x0 + x2) * localT +
    (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 +
    (-x0 + 3 * x1 - 3 * x2 + x3) * t3
  );
  const y = 0.5 * (
    (2 * y1) +
    (-y0 + y2) * localT +
    (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
    (-y0 + 3 * y1 - 3 * y2 + y3) * t3
  );

  return { x, y };
}

/** Mote path descriptor, created per active guide path in initFromRoom. */
interface MotePath {
  pts: readonly RoomGuideDustPathPointDef[];
  loop: boolean;
  /** Advance fraction per ms: 1 / (BASE_CYCLE_MS * speedFactor). */
  advancePerMs: number;
  /** Alpha multiplier from opacityPct (0–1). */
  baseAlpha: number;
  /** Index range in global mote arrays: [startIndex, startIndex + moteCount). */
  startIndex: number;
  moteCount: number;
}

export class GuideDustPathRenderer {
  // Pre-allocated per-mote typed arrays
  private readonly moteX = new Float32Array(MAX_MOTES);
  private readonly moteY = new Float32Array(MAX_MOTES);
  /** Normalized traversal position [0, 1). */
  private readonly moteT = new Float32Array(MAX_MOTES);
  /** Phase offset so motes are evenly distributed initially. */
  private readonly motePhase = new Float32Array(MAX_MOTES);
  /** Index of the MotePath that owns this mote. */
  private readonly motePathIndex = new Uint16Array(MAX_MOTES);

  private totalMoteCount = 0;
  private paths: MotePath[] = [];

  initFromRoom(room: RoomDef): void {
    this.paths = [];
    this.totalMoteCount = 0;

    const guidePaths = room.guideDustPaths ?? [];
    for (const gp of guidePaths) {
      if (!gp.visibleInGame) continue;
      if (gp.points.length < 2) continue;

      const start = this.totalMoteCount;
      const count = Math.min(gp.moteCount, MAX_MOTES - start);
      if (count <= 0) break;

      const pathIndex = this.paths.length;
      const advancePerMs = 1.0 / (BASE_CYCLE_MS * gp.moteSpeedFactor);
      const baseAlpha = gp.opacityPct / 100;

      this.paths.push({
        pts: gp.points,
        loop: gp.loop,
        advancePerMs,
        baseAlpha,
        startIndex: start,
        moteCount: count,
      });

      // Distribute motes evenly along the path
      for (let i = 0; i < count; i++) {
        const idx = start + i;
        const phase = i / count;
        this.motePhase[idx] = phase;
        this.moteT[idx] = phase;
        this.motePathIndex[idx] = pathIndex;
        const { x, y } = catmullRomWorld(gp.points, gp.loop, phase);
        this.moteX[idx] = x;
        this.moteY[idx] = y;
      }

      this.totalMoteCount += count;
    }
  }

  update(dtMs: number): void {
    for (let i = 0; i < this.totalMoteCount; i++) {
      const pi = this.motePathIndex[i];
      const path = this.paths[pi];
      let t = this.moteT[i] + path.advancePerMs * dtMs;
      // Wrap in [0, 1)
      t = t - Math.floor(t);
      this.moteT[i] = t;
      const { x, y } = catmullRomWorld(path.pts, path.loop, t);
      this.moteX[i] = x;
      this.moteY[i] = y;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    vpWidthPx: number,
    vpHeightPx: number,
  ): void {
    if (this.totalMoteCount === 0) return;

    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < this.totalMoteCount; i++) {
      const px = this.moteX[i] * zoom + offsetXPx;
      const py = this.moteY[i] * zoom + offsetYPx;
      // Frustum cull
      if (px < -8 || py < -8 || px > vpWidthPx + 8 || py > vpHeightPx + 8) continue;

      const pi = this.motePathIndex[i];
      const path = this.paths[pi];

      // Fade alpha using a sine wave keyed to traversal position relative to phase offset
      const t = this.moteT[i];
      const phase = this.motePhase[i];
      const rel = (t - phase + 1) % 1;
      const fadeAlpha = Math.sin(rel * Math.PI);
      const alpha = path.baseAlpha * fadeAlpha;
      if (alpha < 0.02) continue;

      const r = Math.max(1.5, 2.5 * zoom);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = GUIDE_DUST_MOTE_COLOR;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevComposite;
  }
}
