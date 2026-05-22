/**
 * GuideDustPathRenderer — golden dust mote particles traveling along
 * editor-authored Catmull-Rom spline paths.
 *
 * Motes travel at smoothly interpolated speeds between control points.
 * Each mote has a stable per-mote lateral/phase offset for an organic look.
 * Non-looping paths fade motes in near the start and out near the end.
 */

import type { RoomDef, RoomGuideDustPathPointDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

const MAX_MOTES = 512;
const BASE_CYCLE_MS = 6000;
const GUIDE_DUST_MOTE_COLOR = 'rgba(255, 200, 50, 1)';
/** Number of arc-length samples per segment for path precomputation. */
const SAMPLES_PER_SEG = 20;
/** Max per-mote lateral jitter in world units (blocks). */
const JITTER_BLOCKS = 0.6;

/** Evaluate Catmull-Rom spline at normalized parameter t in [0,1). */
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
  const x0 = pts[i0].xBlock * bs, y0 = pts[i0].yBlock * bs;
  const x1 = pts[i1].xBlock * bs, y1 = pts[i1].yBlock * bs;
  const x2 = pts[i2].xBlock * bs, y2 = pts[i2].yBlock * bs;
  const x3 = pts[i3].xBlock * bs, y3 = pts[i3].yBlock * bs;

  const t2 = localT * localT, t3 = t2 * localT;
  const x = 0.5 * ((2 * x1) + (-x0 + x2) * localT + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
  const y = 0.5 * ((2 * y1) + (-y0 + y2) * localT + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
  return { x, y };
}

/** Smoothstep interpolation for speed between adjacent control points. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Sample the path into arc-length segments + precompute speed at each sample.
 * Returns arrays: sampleT[], sampleLen[], sampleSpd[], totalLength.
 */
function precomputePath(
  pts: readonly RoomGuideDustPathPointDef[],
  loop: boolean,
): { sampleT: Float32Array; sampleLen: Float32Array; sampleSpd: Float32Array; totalLength: number } {
  const n = pts.length;
  const segCount = loop ? n : n - 1;
  const totalSamples = segCount * SAMPLES_PER_SEG + 1;

  const sampleT = new Float32Array(totalSamples);
  const sampleLen = new Float32Array(totalSamples);
  const sampleSpd = new Float32Array(totalSamples);

  let totalLength = 0;
  let prevX = 0, prevY = 0;

  for (let s = 0; s < totalSamples; s++) {
    const t = s / (totalSamples - 1);
    sampleT[s] = t;

    const { x, y } = catmullRomWorld(pts, loop, t);
    if (s > 0) {
      const dx = x - prevX, dy = y - prevY;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
    sampleLen[s] = totalLength;
    prevX = x; prevY = y;

    // Interpolate speed at this t using control point speeds
    const rawSeg = t * segCount;
    const segIdx = Math.min(Math.floor(rawSeg), segCount - 1);
    const localT = rawSeg - segIdx;
    const i1 = segIdx % n;
    const i2 = loop ? (segIdx + 1) % n : Math.min(n - 1, segIdx + 1);
    const spd1 = pts[i1].speed ?? 1.0;
    const spd2 = pts[i2].speed ?? 1.0;
    const blend = smoothstep(0, 1, localT);
    sampleSpd[s] = spd1 + (spd2 - spd1) * blend;
  }

  return { sampleT, sampleLen, sampleSpd, totalLength };
}

/** Mote path descriptor. */
interface MotePath {
  pts: readonly RoomGuideDustPathPointDef[];
  loop: boolean;
  /** Overall speed multiplier. */
  moteSpeedFactor: number;
  baseAlpha: number;
  startIndex: number;
  moteCount: number;
  /** Precomputed samples. */
  sampleT: Float32Array;
  sampleLen: Float32Array;
  sampleSpd: Float32Array;
  totalLength: number;
}

export class GuideDustPathRenderer {
  private readonly moteX = new Float32Array(MAX_MOTES);
  private readonly moteY = new Float32Array(MAX_MOTES);
  /** Arc-length position along path [0, totalLength). */
  private readonly moteLen = new Float32Array(MAX_MOTES);
  /** Stable per-mote phase for lateral jitter [0, 2π). */
  private readonly motePhase = new Float32Array(MAX_MOTES);
  /** Lateral jitter amplitude [-1, 1]. */
  private readonly moteLateralAmp = new Float32Array(MAX_MOTES);
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

      const { sampleT, sampleLen, sampleSpd, totalLength } = precomputePath(gp.points, gp.loop);

      const pathIndex = this.paths.length;
      this.paths.push({
        pts: gp.points,
        loop: gp.loop,
        moteSpeedFactor: gp.moteSpeedFactor,
        baseAlpha: gp.opacityPct / 100,
        startIndex: start,
        moteCount: count,
        sampleT,
        sampleLen,
        sampleSpd,
        totalLength,
      });

      // Distribute motes evenly along arc length
      for (let i = 0; i < count; i++) {
        const idx = start + i;
        const frac = i / count;
        this.moteLen[idx] = frac * totalLength;
        this.motePhase[idx] = (frac * 13.7 + idx * 0.31415) % (Math.PI * 2);
        this.moteLateralAmp[idx] = ((idx * 7919 + 1234) % 100) / 50 - 1.0; // [-1, 1]
        this.motePathIndex[idx] = pathIndex;
        const { x, y } = catmullRomWorld(gp.points, gp.loop, frac);
        this.moteX[idx] = x;
        this.moteY[idx] = y;
      }

      this.totalMoteCount += count;
    }
  }

  /**
   * Given an arc-length position in a path, find the parametric t via binary search.
   */
  private static arcLenToT(path: MotePath, len: number): number {
    const sampleLen = path.sampleLen;
    const n = sampleLen.length;
    if (len <= 0) return 0;
    if (len >= path.totalLength) return 1;

    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sampleLen[mid] <= len) lo = mid; else hi = mid;
    }
    const t0 = path.sampleT[lo], t1 = path.sampleT[hi];
    const l0 = sampleLen[lo], l1 = sampleLen[hi];
    const frac = l1 > l0 ? (len - l0) / (l1 - l0) : 0;
    return t0 + (t1 - t0) * frac;
  }

  /**
   * Get the interpolated speed at arc-length position.
   */
  private static speedAtLen(path: MotePath, len: number): number {
    const sampleLen = path.sampleLen;
    const n = sampleLen.length;
    if (n === 0) return 1.0;
    const clampedLen = Math.max(0, Math.min(path.totalLength, len));

    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sampleLen[mid] <= clampedLen) lo = mid; else hi = mid;
    }
    const l0 = sampleLen[lo], l1 = sampleLen[hi];
    const frac = l1 > l0 ? (clampedLen - l0) / (l1 - l0) : 0;
    return path.sampleSpd[lo] + (path.sampleSpd[hi] - path.sampleSpd[lo]) * frac;
  }

  update(dtMs: number): void {
    for (let i = 0; i < this.totalMoteCount; i++) {
      const pi = this.motePathIndex[i];
      const path = this.paths[pi];

      const spd = GuideDustPathRenderer.speedAtLen(path, this.moteLen[i]);
      const advance = (path.totalLength / BASE_CYCLE_MS) * path.moteSpeedFactor * spd * dtMs;

      let newLen = this.moteLen[i] + advance;
      if (newLen >= path.totalLength) {
        newLen = path.loop ? newLen % path.totalLength : 0;
      }
      this.moteLen[i] = newLen;

      const t = GuideDustPathRenderer.arcLenToT(path, newLen);
      const { x, y } = catmullRomWorld(path.pts, path.loop, t);

      // Lateral jitter: compute path tangent then offset perpendicularly
      const eps = 0.01;
      const tA = Math.max(0, t - eps);
      const tB = Math.min(1, t + eps);
      const pA = catmullRomWorld(path.pts, path.loop, tA);
      const pB = catmullRomWorld(path.pts, path.loop, tB);
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      const len2 = Math.sqrt(dx * dx + dy * dy);
      const nx = len2 > 0 ? -dy / len2 : 0;
      const ny = len2 > 0 ? dx / len2 : 0;

      const phase = this.motePhase[i] + newLen * 0.003;
      const jitterWorld = this.moteLateralAmp[i] * JITTER_BLOCKS * BLOCK_SIZE_SMALL * Math.sin(phase);

      this.moteX[i] = x + nx * jitterWorld;
      this.moteY[i] = y + ny * jitterWorld;
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
      if (px < -8 || py < -8 || px > vpWidthPx + 8 || py > vpHeightPx + 8) continue;

      const pi = this.motePathIndex[i];
      const path = this.paths[pi];
      const lenFrac = path.totalLength > 0 ? this.moteLen[i] / path.totalLength : 0;

      let fadeAlpha: number;
      if (path.loop) {
        fadeAlpha = 1.0;
      } else {
        // Fade in over first 15%, fade out over last 15%
        const FADE = 0.15;
        if (lenFrac < FADE) fadeAlpha = lenFrac / FADE;
        else if (lenFrac > 1 - FADE) fadeAlpha = (1 - lenFrac) / FADE;
        else fadeAlpha = 1.0;
      }

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
