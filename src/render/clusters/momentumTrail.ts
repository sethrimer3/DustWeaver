/**
 * momentumTrail.ts — Golden high-speed trail for the momentum-combat
 * invulnerability state.
 *
 * Purely a render-side visual (like PlayerCloak / PhantomCloakExtension) —
 * it does not touch sim state.  Activation reuses the SAME threshold as the
 * sim (cluster.isHighVelocityAttacking, gated on
 * MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED); this file only controls length,
 * taper, colour, and fade behaviour once that flag is set.
 *
 * Approach:
 *   • A ring buffer records recent world-space anchor positions every frame.
 *   • update() computes a smoothed target trail length from current total
 *     speed above the activation threshold, and a fade alpha that rises
 *     quickly on activation and decays slowly after dropping below threshold.
 *   • render() walks the history backward by arc length, resamples it into
 *     N evenly-spaced points, and builds a tapered polygon strip (width and
 *     alpha both shrink toward the tail, reaching a sharp point) drawn as
 *     three layered translucent passes (outer glow, mid gold, bright core)
 *     for a warm, luminous "golden cloak" comet-tail look.
 */

import type { GraphicsQuality } from '../../ui/renderSettings';
import {
  MOMENTUM_TRAIL_ACTIVATION_SPEED_WORLD_PER_SEC,
  MOMENTUM_TRAIL_SPEED_RANGE_WORLD_PER_SEC,
  MOMENTUM_TRAIL_MIN_LENGTH_WORLD,
  MOMENTUM_TRAIL_MAX_LENGTH_WORLD,
  MOMENTUM_TRAIL_GROW_RATE_PER_SEC,
  MOMENTUM_TRAIL_SHRINK_RATE_PER_SEC,
  MOMENTUM_TRAIL_FADE_OUT_DURATION_SEC,
  MOMENTUM_TRAIL_FADE_IN_DURATION_SEC,
  MOMENTUM_TRAIL_MAX_HALF_WIDTH_WORLD,
  MOMENTUM_TRAIL_HISTORY_CAPACITY,
  MOMENTUM_TRAIL_SEGMENTS_LOW,
  MOMENTUM_TRAIL_SEGMENTS_MED,
  MOMENTUM_TRAIL_SEGMENTS_HIGH,
  MOMENTUM_TRAIL_OUTER_ALPHA,
  MOMENTUM_TRAIL_MID_ALPHA,
  MOMENTUM_TRAIL_CORE_ALPHA,
  MOMENTUM_TRAIL_OUTER_COLOR,
  MOMENTUM_TRAIL_MID_COLOR,
  MOMENTUM_TRAIL_CORE_COLOR,
  MOMENTUM_TRAIL_SHIMMER_SPEED_RAD_PER_SEC,
  MOMENTUM_TRAIL_SHIMMER_AMOUNT,
} from './momentumTrailConfig';

/** Minimal player state needed by the trail each frame. */
export interface MomentumTrailPlayerState {
  /** World-space anchor X (render-interpolated), e.g. sprite center. */
  anchorXWorld: number;
  /** World-space anchor Y (render-interpolated), e.g. sprite center. */
  anchorYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  /** Mirrors cluster.isHighVelocityAttacking — the sim's momentum-combat flag. */
  isHighVelocityAttacking: 0 | 1;
}

function segmentCountForQuality(quality: GraphicsQuality): number {
  if (quality === 'low') return MOMENTUM_TRAIL_SEGMENTS_LOW;
  if (quality === 'high') return MOMENTUM_TRAIL_SEGMENTS_HIGH;
  return MOMENTUM_TRAIL_SEGMENTS_MED;
}

const MAX_RESAMPLE_POINTS = MOMENTUM_TRAIL_SEGMENTS_HIGH + 1;

export class MomentumTrail {
  private readonly historyXWorld = new Float32Array(MOMENTUM_TRAIL_HISTORY_CAPACITY);
  private readonly historyYWorld = new Float32Array(MOMENTUM_TRAIL_HISTORY_CAPACITY);
  private historyCount = 0;
  private historyWriteIndex = 0;
  private isInitialisedFlag = false;

  private smoothedLengthWorld = 0;
  private fadeAlpha = 0;
  private shimmerPhase = 0;

  // Reused scratch buffers for resampled points (avoid per-frame allocation).
  private readonly resampledXWorld = new Float32Array(MAX_RESAMPLE_POINTS);
  private readonly resampledYWorld = new Float32Array(MAX_RESAMPLE_POINTS);
  private resampledCount = 0;

  /** Advance the trail simulation for one render frame. */
  update(dtSec: number, player: MomentumTrailPlayerState): void {
    const dt = Math.max(0, Math.min(dtSec, 0.1));

    if (!this.isInitialisedFlag) {
      this.historyXWorld.fill(player.anchorXWorld);
      this.historyYWorld.fill(player.anchorYWorld);
      this.historyCount = 1;
      this.historyWriteIndex = 0;
      this.isInitialisedFlag = true;
    } else {
      this.historyWriteIndex = (this.historyWriteIndex + 1) % MOMENTUM_TRAIL_HISTORY_CAPACITY;
      this.historyXWorld[this.historyWriteIndex] = player.anchorXWorld;
      this.historyYWorld[this.historyWriteIndex] = player.anchorYWorld;
      this.historyCount = Math.min(this.historyCount + 1, MOMENTUM_TRAIL_HISTORY_CAPACITY);
    }

    const isActive = player.isHighVelocityAttacking === 1;
    const speed = Math.hypot(player.velocityXWorld, player.velocityYWorld);
    const speedFactor = Math.max(0, Math.min(1,
      (speed - MOMENTUM_TRAIL_ACTIVATION_SPEED_WORLD_PER_SEC) / MOMENTUM_TRAIL_SPEED_RANGE_WORLD_PER_SEC,
    ));
    const targetLengthWorld = isActive
      ? MOMENTUM_TRAIL_MIN_LENGTH_WORLD + (MOMENTUM_TRAIL_MAX_LENGTH_WORLD - MOMENTUM_TRAIL_MIN_LENGTH_WORLD) * speedFactor
      : 0;

    const growing = targetLengthWorld > this.smoothedLengthWorld;
    const lengthRate = growing ? MOMENTUM_TRAIL_GROW_RATE_PER_SEC : MOMENTUM_TRAIL_SHRINK_RATE_PER_SEC;
    const lengthLerpT = 1 - Math.exp(-lengthRate * dt);
    this.smoothedLengthWorld += (targetLengthWorld - this.smoothedLengthWorld) * lengthLerpT;
    if (this.smoothedLengthWorld < 0.05) this.smoothedLengthWorld = 0;

    const targetFade = isActive ? 1 : 0;
    const fadeDurationSec = isActive ? MOMENTUM_TRAIL_FADE_IN_DURATION_SEC : MOMENTUM_TRAIL_FADE_OUT_DURATION_SEC;
    const fadeStep = dt / Math.max(fadeDurationSec, 0.001);
    if (targetFade > this.fadeAlpha) {
      this.fadeAlpha = Math.min(targetFade, this.fadeAlpha + fadeStep);
    } else {
      this.fadeAlpha = Math.max(targetFade, this.fadeAlpha - fadeStep);
    }

    this.shimmerPhase += dt * MOMENTUM_TRAIL_SHIMMER_SPEED_RAD_PER_SEC;
  }

  /** Reset trail state (e.g. on room transition) so it doesn't draw a cross-room streak. */
  reset(): void {
    this.isInitialisedFlag = false;
    this.historyCount = 0;
    this.historyWriteIndex = 0;
    this.smoothedLengthWorld = 0;
    this.fadeAlpha = 0;
    this.shimmerPhase = 0;
  }

  /**
   * Resample the ring-buffer history (walking backward from the newest point)
   * into `this.resampledXWorld/YWorld[0..resampledCount-1]` — evenly spaced by
   * arc length, from the head (current position) to as far back as
   * smoothedLengthWorld reaches (or history runs out).
   */
  private _resample(targetSegmentCount: number): void {
    this.resampledCount = 0;
    if (this.historyCount < 2 || this.smoothedLengthWorld <= 0) return;

    // Walk backward through the ring buffer accumulating arc length.
    // rawDist[k] = cumulative distance from the head to the k-th raw sample.
    const maxRaw = this.historyCount;
    const rawXWorld: number[] = [];
    const rawYWorld: number[] = [];
    const rawDist: number[] = [];
    let prevX = this.historyXWorld[this.historyWriteIndex];
    let prevY = this.historyYWorld[this.historyWriteIndex];
    rawXWorld.push(prevX);
    rawYWorld.push(prevY);
    rawDist.push(0);

    let cumulative = 0;
    for (let k = 1; k < maxRaw; k++) {
      const idx = (this.historyWriteIndex - k + MOMENTUM_TRAIL_HISTORY_CAPACITY * 2) % MOMENTUM_TRAIL_HISTORY_CAPACITY;
      const x = this.historyXWorld[idx];
      const y = this.historyYWorld[idx];
      const segDist = Math.hypot(x - prevX, y - prevY);
      cumulative += segDist;
      rawXWorld.push(x);
      rawYWorld.push(y);
      rawDist.push(cumulative);
      prevX = x;
      prevY = y;
      if (cumulative >= this.smoothedLengthWorld) break;
    }

    const totalLengthWorld = Math.min(this.smoothedLengthWorld, cumulative);
    if (totalLengthWorld <= 0) return;

    const pointCount = Math.min(targetSegmentCount + 1, MAX_RESAMPLE_POINTS);
    let rawIdx = 0;
    for (let i = 0; i < pointCount; i++) {
      const targetDist = (i / (pointCount - 1)) * totalLengthWorld;
      while (rawIdx < rawDist.length - 2 && rawDist[rawIdx + 1] < targetDist) rawIdx++;
      const d0 = rawDist[rawIdx];
      const d1 = rawDist[Math.min(rawIdx + 1, rawDist.length - 1)];
      const segLen = d1 - d0;
      const t = segLen > 0.0001 ? (targetDist - d0) / segLen : 0;
      const x0 = rawXWorld[rawIdx];
      const y0 = rawYWorld[rawIdx];
      const x1 = rawXWorld[Math.min(rawIdx + 1, rawXWorld.length - 1)];
      const y1 = rawYWorld[Math.min(rawIdx + 1, rawYWorld.length - 1)];
      this.resampledXWorld[i] = x0 + (x1 - x0) * t;
      this.resampledYWorld[i] = y0 + (y1 - y0) * t;
    }
    this.resampledCount = pointCount;
  }

  /**
   * Draw the tapered golden trail behind/around the player.
   * Should be called BEFORE the player body/cloak are drawn so the trail
   * reads as sitting behind the character.
   */
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    quality: GraphicsQuality,
  ): void {
    if (this.fadeAlpha <= 0.003 || this.smoothedLengthWorld <= 0.3) return;

    const segmentCount = segmentCountForQuality(quality);
    this._resample(segmentCount);
    if (this.resampledCount < 2) return;

    const n = this.resampledCount;
    const shimmerEnabled = quality !== 'low';

    // Screen-space points (computed once, reused across the 3 layers).
    const screenX: number[] = new Array(n);
    const screenY: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      screenX[i] = this.resampledXWorld[i] * scalePx + offsetXPx;
      screenY[i] = this.resampledYWorld[i] * scalePx + offsetYPx;
    }

    // Tangent-based perpendiculars for each point.
    const perpX: number[] = new Array(n);
    const perpY: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prevI = Math.max(0, i - 1);
      const nextI = Math.min(n - 1, i + 1);
      let tx = screenX[nextI] - screenX[prevI];
      let ty = screenY[nextI] - screenY[prevI];
      const len = Math.hypot(tx, ty);
      if (len > 0.0001) { tx /= len; ty /= len; } else { tx = 1; ty = 0; }
      perpX[i] = -ty;
      perpY[i] = tx;
    }

    const maxHalfWidthPx = MOMENTUM_TRAIL_MAX_HALF_WIDTH_WORLD * scalePx;

    const drawLayer = (widthScale: number, baseAlpha: number, color: string): void => {
      for (let i = 0; i < n - 1; i++) {
        const t0 = i / (n - 1);
        const t1 = (i + 1) / (n - 1);
        // (1-t)^1.6 taper with the final point forced to exactly 0 for a sharp point.
        const w0 = (i === 0 ? 1 : Math.pow(1 - t0, 1.6)) * maxHalfWidthPx * widthScale;
        const w1 = (i === n - 2 ? 0 : Math.pow(1 - t1, 1.6)) * maxHalfWidthPx * widthScale;

        let alpha = baseAlpha * Math.pow(1 - (t0 + t1) * 0.5, 1.1) * this.fadeAlpha;
        if (shimmerEnabled) {
          const shimmer = 1 - MOMENTUM_TRAIL_SHIMMER_AMOUNT * 0.5
            + MOMENTUM_TRAIL_SHIMMER_AMOUNT * 0.5 * Math.sin(this.shimmerPhase + i * 0.85);
          alpha *= shimmer;
        }
        if (alpha <= 0.004) continue;

        const lx0 = screenX[i] + perpX[i] * w0;
        const ly0 = screenY[i] + perpY[i] * w0;
        const rx0 = screenX[i] - perpX[i] * w0;
        const ry0 = screenY[i] - perpY[i] * w0;
        const lx1 = screenX[i + 1] + perpX[i + 1] * w1;
        const ly1 = screenY[i + 1] + perpY[i + 1] * w1;
        const rx1 = screenX[i + 1] - perpX[i + 1] * w1;
        const ry1 = screenY[i + 1] - perpY[i + 1] * w1;

        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = `rgba(${color},1)`;
        ctx.beginPath();
        ctx.moveTo(lx0, ly0);
        ctx.lineTo(lx1, ly1);
        ctx.lineTo(rx1, ry1);
        ctx.lineTo(rx0, ry0);
        ctx.closePath();
        ctx.fill();
      }
    };

    ctx.save();
    // Outer soft glow (widest, dimmest) → mid gold → bright inner core streak.
    drawLayer(1.0, MOMENTUM_TRAIL_OUTER_ALPHA, MOMENTUM_TRAIL_OUTER_COLOR);
    drawLayer(0.62, MOMENTUM_TRAIL_MID_ALPHA, MOMENTUM_TRAIL_MID_COLOR);
    drawLayer(0.28, MOMENTUM_TRAIL_CORE_ALPHA, MOMENTUM_TRAIL_CORE_COLOR);
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}
