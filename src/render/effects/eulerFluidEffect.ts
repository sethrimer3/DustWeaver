/**
 * EulerFluidEffect
 *
 * Ported from Thero_Idle_TD EulerFluidEffect.js.
 * 210 tracer particles advect through an analytical 2D velocity field
 * composed of a path-channel current, CW/CCW vortices, and tower obstacles.
 *
 * Standalone version: generates a simple default path across the 480×270
 * virtual canvas (left-centre → right-centre) without external game data.
 * Blue-to-violet trail palette at ~20% opacity.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';
import { clamp as clampN } from '../../utils/math';

// ─── Simulation tuning ───────────────────────────────────────────────────────

const PARTICLE_COUNT          = 210;
const TRAIL_LENGTH            = 28;
const TRAIL_HEAD_ALPHA        = 0.22;
const TRAIL_LINE_WIDTH_PX     = 1.3;
const PATH_SIGMA_PX           = 38;
const PATH_SPEED_PX_S         = 50;
const MIND_GAMMA              = 2500;
const SHADOW_GAMMA            = 2000;
const VORTEX_CORE_PX          = 20;
const MAX_SPEED_PX_S          = 90;
const RESPAWN_SLOW_THRESHOLD  = 4;
const RESPAWN_OOB_MARGIN_PX   = 80;
const RESIZE_THRESHOLD_FRACTION = 0.08;

const PATH_TWO_SIGMA_SQ = 2 * PATH_SIGMA_PX * PATH_SIGMA_PX;

const HUES         = [190, 210, 232, 252, 272, 292, 314];
const ALPHA_BUCKETS = 5;

// Pre-allocated draw batches for trail segments (flat [x1,y1,x2,y2,…] arrays)
const drawBatches: number[][][] = HUES.map(() =>
  Array.from({ length: ALPHA_BUCKETS }, () => []),
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PathSegment {
  x0: number; y0: number;
  dx: number; dy: number;
  nx: number; ny: number;
  lenSq: number;
}

interface TrailPoint { x: number; y: number; }

interface Particle {
  x: number;
  y: number;
  trail: TrailPoint[];
  hueIdx: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSegments(pts: { x: number; y: number }[]): PathSegment[] {
  const segs: PathSegment[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const x0 = pts[i].x;
    const y0 = pts[i].y;
    const dx = pts[i + 1].x - x0;
    const dy = pts[i + 1].y - y0;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) continue;
    const len = Math.sqrt(lenSq);
    segs.push({ x0, y0, dx, dy, nx: dx / len, ny: dy / len, lenSq });
  }
  return segs;
}

function sampleVelocity(
  x: number,
  y: number,
  segs: PathSegment[],
  mindGate: { x: number; y: number } | null,
  shadowGate: { x: number; y: number } | null,
): { vx: number; vy: number } {
  let vx = 0; let vy = 0;
  const coreSq = VORTEX_CORE_PX * VORTEX_CORE_PX;

  for (const s of segs) {
    const rx  = x - s.x0;
    const ry  = y - s.y0;
    const t   = clampN((rx * s.dx + ry * s.dy) / s.lenSq, 0, 1);
    const cpx = s.x0 + t * s.dx;
    const cpy = s.y0 + t * s.dy;
    const dSq = (x - cpx) * (x - cpx) + (y - cpy) * (y - cpy);
    const w   = Math.exp(-dSq / PATH_TWO_SIGMA_SQ);
    vx += s.nx * PATH_SPEED_PX_S * w;
    vy += s.ny * PATH_SPEED_PX_S * w;
  }

  if (mindGate) {
    const dx = x - mindGate.x; const dy = y - mindGate.y;
    const r2 = dx * dx + dy * dy + coreSq;
    vx +=  MIND_GAMMA * dy / r2;
    vy += -MIND_GAMMA * dx / r2;
    vx -= MIND_GAMMA * 0.12 * dx / r2;
    vy -= MIND_GAMMA * 0.12 * dy / r2;
  }

  if (shadowGate) {
    const dx = x - shadowGate.x; const dy = y - shadowGate.y;
    const r2 = dx * dx + dy * dy + coreSq;
    vx += -SHADOW_GAMMA * dy / r2;
    vy +=  SHADOW_GAMMA * dx / r2;
    vx += SHADOW_GAMMA * 0.12 * dx / r2;
    vy += SHADOW_GAMMA * 0.12 * dy / r2;
  }

  const spd = Math.sqrt(vx * vx + vy * vy);
  if (spd > MAX_SPEED_PX_S) {
    const inv = MAX_SPEED_PX_S / spd;
    vx *= inv; vy *= inv;
  }

  return { vx, vy };
}

function spawnParticle(
  widthPx: number,
  heightPx: number,
  shadowGate: { x: number; y: number } | null,
  index: number,
): Particle {
  const hueIdx = index % HUES.length;
  let x: number; let y: number;
  if (shadowGate && Math.random() < 0.55) {
    const angleRad = Math.random() * Math.PI * 2;
    const dist     = 15 + Math.random() * 80;
    x = shadowGate.x + Math.cos(angleRad) * dist;
    y = shadowGate.y + Math.sin(angleRad) * dist;
  } else {
    x = Math.random() * widthPx;
    y = Math.random() * heightPx;
  }
  return { x, y, trail: [], hueIdx };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createEulerFluidEffect(): TheroBackgroundEffect {
  let particles: Particle[] = [];
  let lastTs: number | null = null;

  let segs:       PathSegment[]             = [];
  let mindGate:   { x: number; y: number } | null = null;
  let shadowGate: { x: number; y: number } | null = null;

  let vpW = 0;
  let vpH = 0;

  /** Build a simple straight path from left-centre to right-centre. */
  function buildDefaultPath(widthPx: number, heightPx: number): void {
    const midY  = heightPx * 0.5;
    const pts   = [
      { x: 0,                     y: midY },
      { x: widthPx * 0.25,        y: midY * 0.6 },
      { x: widthPx * 0.5,         y: midY },
      { x: widthPx * 0.75,        y: midY * 1.4 },
      { x: widthPx,               y: midY },
    ];
    segs       = buildSegments(pts);
    shadowGate = { x: pts[0].x,              y: pts[0].y };
    mindGate   = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
  }

  function initParticles(widthPx: number, heightPx: number): void {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = spawnParticle(widthPx, heightPx, shadowGate, i);
      p.trail.push({ x: p.x, y: p.y });
      particles.push(p);
    }
  }

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    const isSizeChanged = (Math.abs(widthPx - vpW) > vpW * RESIZE_THRESHOLD_FRACTION + 1) ||
                          (Math.abs(heightPx - vpH) > vpH * RESIZE_THRESHOLD_FRACTION + 1);
    if (isSizeChanged) {
      vpW = widthPx;
      vpH = heightPx;
      buildDefaultPath(widthPx, heightPx);
    }

    const dtSec = lastTs === null ? 0.016 : Math.min((nowMs - lastTs) / 1000, 0.1);
    lastTs = nowMs;

    if (!particles.length || isSizeChanged) initParticles(vpW, vpH);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const { vx, vy } = sampleVelocity(p.x, p.y, segs, mindGate, shadowGate);

      p.x += vx * dtSec;
      p.y += vy * dtSec;

      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > TRAIL_LENGTH) p.trail.shift();

      const spd = Math.sqrt(vx * vx + vy * vy);
      const isOob = p.x < -RESPAWN_OOB_MARGIN_PX || p.x > vpW + RESPAWN_OOB_MARGIN_PX ||
                    p.y < -RESPAWN_OOB_MARGIN_PX || p.y > vpH + RESPAWN_OOB_MARGIN_PX;
      if (isOob || spd < RESPAWN_SLOW_THRESHOLD) {
        particles[i] = spawnParticle(vpW, vpH, shadowGate, i);
      }
    }
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!vpW || !vpH || !particles.length) return;

    for (let h = 0; h < HUES.length; h++) {
      for (let b = 0; b < ALPHA_BUCKETS; b++) {
        drawBatches[h][b].length = 0;
      }
    }

    for (const p of particles) {
      const trail = p.trail;
      const n     = trail.length;
      if (n < 2) continue;
      for (let j = 1; j < n; j++) {
        const bkt = Math.min(Math.floor((j / n) * ALPHA_BUCKETS), ALPHA_BUCKETS - 1);
        const arr = drawBatches[p.hueIdx][bkt];
        arr.push(trail[j - 1].x, trail[j - 1].y, trail[j].x, trail[j].y);
      }
    }

    ctx.save();
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.lineWidth = TRAIL_LINE_WIDTH_PX;

    for (let h = 0; h < HUES.length; h++) {
      for (let b = 0; b < ALPHA_BUCKETS; b++) {
        const arr = drawBatches[h][b];
        if (!arr.length) continue;
        const alpha = ((b + 1) / ALPHA_BUCKETS) * TRAIL_HEAD_ALPHA;
        ctx.strokeStyle = `hsla(${HUES[h]},82%,66%,${alpha.toFixed(3)})`;
        ctx.beginPath();
        for (let k = 0; k < arr.length; k += 4) {
          ctx.moveTo(arr[k], arr[k + 1]);
          ctx.lineTo(arr[k + 2], arr[k + 3]);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function reset(): void {
    particles   = [];
    lastTs      = null;
    segs        = [];
    mindGate    = null;
    shadowGate  = null;
    vpW = 0;
    vpH = 0;
  }

  return { update, draw, reset };
}
