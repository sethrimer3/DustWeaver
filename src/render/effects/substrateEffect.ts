/**
 * SubstrateEffect
 *
 * Ported from Thero_Idle_TD SubstrateEffect.js.
 * Crystalline crack lines grow with perpendicular branching and city-block
 * geometry, inspired by J. Tarbell's "Substrate" (2004).
 *
 * Adapted for the 480×270 virtual canvas with quality='medium' defaults.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';

// ─── Configurable parameters ──────────────────────────────────────────────────

const SEED_COUNT                    = 4;
const MAX_FRONTS                    = 35;
const GROWTH_SPEED_PX_S             = 50;
const BRANCH_PROBABILITY            = 0.60;
const PERPENDICULAR_TURN_PROBABILITY = 0.008;
const ARC_PROBABILITY               = 0.15;
const MAX_AGE_SEC                   = 120;
const GRAIN_DENSITY                 = 3;
const DEPOSITION_WIDTH_PX           = 30;
const EDGE_OPACITY                  = 0.70;
const INTERIOR_OPACITY              = 0.025;
const LINE_WIDTH_PX                 = 1.2;
const COMPOSITE_ALPHA               = 0.20;
const FADE_IN_MS                    = 3000;
const ARC_RATE_RANGE                = 0.012;
const GRID_EMPTY                    = -10001;

// Tail-erase parameters
const TRAIL_MAX_VISIBLE     = 60000;
const ERASE_RADIUS_PX       = 2.5;
const UNDRAW_SPEED_FACTOR   = 1.2;
const MINIMUM_TRAIL_FOR_BRANCH = 5;
const MAX_LINES_BEFORE_UNDRAW  = 80;

// Collision glow parameters
const COLLISION_GLOW_DURATION_MS  = 3000;
const COLLISION_GLOW_PEAK_MS      = 400;
const COLLISION_GLOW_TRAIL_LENGTH = 140;
const COLLISION_GLOW_MAX_ALPHA    = 0.30;
const COLLISION_GLOW_LINE_WIDTH   = 4.5;

// ─── Color palette ────────────────────────────────────────────────────────────

const PALETTE = [
  { r: 255, g: 255, b: 255 },
  { r: 248, g: 245, b: 238 },
  { r: 210, g: 210, b: 210 },
  { r: 190, g: 195, b: 200 },
  { r: 235, g: 225, b: 190 },
  { r: 215, g: 205, b: 180 },
];

function randomPaletteColor(): { r: number; g: number; b: number } {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function quantisedAngleRad(): number {
  const base = Math.floor(Math.random() * 4) * (Math.PI / 2);
  return base + (Math.random() - 0.5) * 0.15;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrailPoint { x: number; y: number; }

interface CollisionGlow {
  isActive: boolean;
  age: number;
  trailEndIdx: number;
}

interface GrowthFront {
  x: number;
  y: number;
  angle: number;
  speed: number;
  age: number;
  maxAge: number;
  colorR: number;
  colorG: number;
  colorB: number;
  edgeFillStyle: string;
  baseColorStyle: string;
  mode: 'straight' | 'arc';
  arcRate: number;
  isAlive: boolean;
  isGrowing: boolean;
  trail: TrailPoint[];
  undrawIndex: number;
  stoppedOrder: number;
  hasUndrawStarted: boolean;
  collisionGlow: CollisionGlow | null;
  lastGx: number;
  lastGy: number;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSubstrateEffect(): TheroBackgroundEffect {
  let offCanvas: HTMLCanvasElement | null  = null;
  let offCtx: CanvasRenderingContext2D | null = null;
  let cgrid: Float32Array | null = null;
  let canvasW = 0;
  let canvasH = 0;

  let fronts: GrowthFront[]    = [];
  let lastTs: number | null    = null;
  let compositeAlpha           = 0;
  let initStartMs: number | null = null;
  let nextStoppedOrder         = 0;
  let growingCount             = 0;

  // ── Front creation ────────────────────────────────────────────────────────

  function createFront(x: number, y: number, angle: number, mode: 'straight' | 'arc'): GrowthFront {
    const col = randomPaletteColor();
    return {
      x, y, angle,
      speed:           GROWTH_SPEED_PX_S * (0.7 + Math.random() * 0.6),
      age:             0,
      maxAge:          MAX_AGE_SEC * (0.5 + Math.random()),
      colorR:          col.r,
      colorG:          col.g,
      colorB:          col.b,
      edgeFillStyle:   `rgba(${col.r},${col.g},${col.b},${EDGE_OPACITY})`,
      baseColorStyle:  `rgb(${col.r},${col.g},${col.b})`,
      mode,
      arcRate:         (Math.random() - 0.5) * 2 * ARC_RATE_RANGE,
      isAlive:     true,
      isGrowing:   true,
      trail:           [],
      undrawIndex:     0,
      stoppedOrder:    -1,
      hasUndrawStarted: false,
      collisionGlow:   null,
      lastGx:          Math.round(x),
      lastGy:          Math.round(y),
    };
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  function init(w: number, h: number): void {
    canvasW = Math.ceil(w);
    canvasH = Math.ceil(h);

    nextStoppedOrder = 0;
    growingCount     = 0;

    offCanvas        = document.createElement('canvas');
    offCanvas.width  = canvasW;
    offCanvas.height = canvasH;
    offCtx           = offCanvas.getContext('2d')!;
    offCtx.clearRect(0, 0, canvasW, canvasH);

    cgrid = new Float32Array(canvasW * canvasH);
    cgrid.fill(GRID_EMPTY);

    fronts = [];
    for (let i = 0; i < SEED_COUNT; i++) spawnRandom();
  }

  // ── Spawning ──────────────────────────────────────────────────────────────

  function spawnRandom(): void {
    if (growingCount >= MAX_FRONTS) return;
    const x     = 10 + Math.random() * (canvasW - 20);
    const y     = 10 + Math.random() * (canvasH - 20);
    const angle = quantisedAngleRad();
    const mode  = Math.random() < ARC_PROBABILITY ? 'arc' : 'straight';
    fronts.push(createFront(x, y, angle, mode));
    growingCount++;
  }

  function spawnPerp(xi: number, yi: number, hitAngle: number): void {
    if (growingCount >= MAX_FRONTS) return;
    const perp = hitAngle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const ox   = xi + Math.cos(perp) * 2;
    const oy   = yi + Math.sin(perp) * 2;
    if (ox < 0 || ox >= canvasW || oy < 0 || oy >= canvasH) return;
    const mode = Math.random() < ARC_PROBABILITY ? 'arc' : 'straight';
    fronts.push(createFront(ox, oy, perp, mode));
    growingCount++;
  }

  // ── Off-screen canvas drawing ─────────────────────────────────────────────

  function drawEdgePixel(x: number, y: number, fillStyle: string): void {
    offCtx!.fillStyle   = fillStyle;
    offCtx!.globalAlpha = 0.70 + Math.random() * 0.30;
    offCtx!.fillRect(x - LINE_WIDTH_PX / 2, y - LINE_WIDTH_PX / 2, LINE_WIDTH_PX, LINE_WIDTH_PX);
    if (Math.random() < 0.35) {
      const gx = x + (Math.random() - 0.5) * LINE_WIDTH_PX * 2.5;
      const gy = y + (Math.random() - 0.5) * LINE_WIDTH_PX * 2.5;
      offCtx!.globalAlpha = 0.15 + Math.random() * 0.15;
      offCtx!.fillRect(gx, gy, 1, 1);
    }
    offCtx!.globalAlpha = 1;
  }

  function drawDeposition(cx: number, cy: number, angle: number, baseColorStyle: string): void {
    const px = -Math.sin(angle);
    const py =  Math.cos(angle);
    offCtx!.fillStyle = baseColorStyle;
    for (let i = 0; i < GRAIN_DENSITY; i++) {
      const t  = (Math.random() * 2 - 1) * DEPOSITION_WIDTH_PX;
      const gx = cx + px * t;
      const gy = cy + py * t;
      if (gx < 0 || gx >= canvasW || gy < 0 || gy >= canvasH) continue;
      const fade  = 1 - Math.abs(t) / DEPOSITION_WIDTH_PX;
      const alpha = INTERIOR_OPACITY * fade * fade * (0.3 + Math.random() * 0.7);
      offCtx!.globalAlpha = alpha;
      offCtx!.fillRect(gx, gy, 1, 1);
    }
    offCtx!.globalAlpha = 1;
  }

  // ── Growth step ───────────────────────────────────────────────────────────

  function stepFront(front: GrowthFront, steps: number, dtSec: number): void {
    if (!front.isGrowing) return;

    front.age += dtSec;
    if (front.age >= front.maxAge) {
      front.stoppedOrder = nextStoppedOrder++;
      front.isGrowing = false;
      growingCount = Math.max(0, growingCount - 1);
      return;
    }

    let dx = Math.cos(front.angle);
    let dy = Math.sin(front.angle);

    for (let s = 0; s < steps; s++) {
      if (front.mode === 'arc') {
        front.angle += front.arcRate;
        dx = Math.cos(front.angle);
        dy = Math.sin(front.angle);
      }

      if (front.mode === 'straight' && Math.random() < PERPENDICULAR_TURN_PROBABILITY) {
        front.angle += Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
        dx = Math.cos(front.angle);
        dy = Math.sin(front.angle);
      }

      front.x += dx;
      front.y += dy;

      const xi = Math.round(front.x);
      const yi = Math.round(front.y);

      if (xi < 0 || xi >= canvasW || yi < 0 || yi >= canvasH) {
        front.stoppedOrder = nextStoppedOrder++;
        front.isGrowing = false;
        growingCount = Math.max(0, growingCount - 1);
        return;
      }

      if (xi === front.lastGx && yi === front.lastGy) continue;
      front.lastGx = xi;
      front.lastGy = yi;

      const idx = yi * canvasW + xi;

      if (cgrid![idx] !== GRID_EMPTY) {
        front.stoppedOrder  = nextStoppedOrder++;
        front.isGrowing = false;
        growingCount = Math.max(0, growingCount - 1);
        front.collisionGlow = { isActive: true, age: 0, trailEndIdx: front.trail.length };

        if (front.trail.length >= MINIMUM_TRAIL_FOR_BRANCH) {
          if (Math.random() < BRANCH_PROBABILITY) spawnPerp(xi, yi, cgrid![idx]);
          if (Math.random() < BRANCH_PROBABILITY * 0.3) spawnPerp(xi, yi, cgrid![idx]);
        }
        return;
      }

      cgrid![idx] = front.angle;
      drawEdgePixel(front.x, front.y, front.edgeFillStyle);
      if (GRAIN_DENSITY > 0) drawDeposition(front.x, front.y, front.angle, front.baseColorStyle);
      front.trail.push({ x: front.x, y: front.y });
    }
  }

  // ── Tail-erase ────────────────────────────────────────────────────────────

  function undrawFront(front: GrowthFront, steps: number): void {
    if (!offCtx || front.undrawIndex >= front.trail.length) return;

    offCtx.save();
    offCtx.globalCompositeOperation = 'destination-out';
    offCtx.fillStyle = 'rgba(0,0,0,1)';

    const limit = Math.min(front.undrawIndex + steps, front.trail.length);
    offCtx.beginPath();
    for (let i = front.undrawIndex; i < limit; i++) {
      const pt = front.trail[i];
      offCtx.moveTo(pt.x + ERASE_RADIUS_PX, pt.y);
      offCtx.arc(pt.x, pt.y, ERASE_RADIUS_PX, 0, Math.PI * 2);
      const xi = Math.round(pt.x);
      const yi = Math.round(pt.y);
      if (xi >= 0 && xi < canvasW && yi >= 0 && yi < canvasH) {
        cgrid![yi * canvasW + xi] = GRID_EMPTY;
      }
    }
    offCtx.fill();
    offCtx.restore();

    front.undrawIndex = limit;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    const needsInit = !offCanvas || canvasW !== Math.ceil(widthPx) || canvasH !== Math.ceil(heightPx);
    if (needsInit) {
      init(widthPx, heightPx);
      compositeAlpha = 0;
      initStartMs    = nowMs;
      lastTs         = null;
    }

    if (initStartMs === null) initStartMs = nowMs;

    const dtSec = lastTs === null ? 0.016 : Math.min((nowMs - lastTs) / 1000, 0.1);
    lastTs = nowMs;

    compositeAlpha = Math.min(1, (nowMs - initStartMs) / FADE_IN_MS);

    for (const front of fronts) {
      if (!front.isAlive) continue;
      if (front.isGrowing) {
        const steps = Math.max(1, Math.round(front.speed * dtSec));
        stepFront(front, steps, dtSec);
      }
    }

    // Cap visible trail on growing fronts
    for (const front of fronts) {
      if (!front.isAlive || !front.isGrowing) continue;
      const visibleCount = front.trail.length - front.undrawIndex;
      if (visibleCount > TRAIL_MAX_VISIBLE) undrawFront(front, visibleCount - TRAIL_MAX_VISIBLE);
    }

    // Advance collision-glow age
    for (const front of fronts) {
      const glow = front.collisionGlow;
      if (!glow?.isActive) continue;
      glow.age += dtSec;
      if (glow.age >= COLLISION_GLOW_DURATION_MS / 1000) glow.isActive = false;
    }

    // Schedule oldest stopped fronts for undraw when count exceeds cap
    let persistentCount = 0;
    for (const front of fronts) {
      if (front.isAlive && !front.isGrowing && !front.hasUndrawStarted) persistentCount++;
    }
    if (persistentCount > MAX_LINES_BEFORE_UNDRAW) {
      const toStart = persistentCount - MAX_LINES_BEFORE_UNDRAW;
      const stopped = fronts
        .filter(f => f.isAlive && !f.isGrowing && !f.hasUndrawStarted && f.stoppedOrder >= 0)
        .sort((a, b) => a.stoppedOrder - b.stoppedOrder);
      for (let i = 0; i < Math.min(toStart, stopped.length); i++) {
        stopped[i].hasUndrawStarted = true;
      }
    }

    // Advance erase for fronts scheduled to undraw
    for (const front of fronts) {
      if (!front.isAlive || front.isGrowing || !front.hasUndrawStarted) continue;
      const visibleCount = front.trail.length - front.undrawIndex;
      if (visibleCount > 0) {
        const steps = Math.max(1, Math.round(front.speed * UNDRAW_SPEED_FACTOR * dtSec));
        undrawFront(front, steps);
      }
      if (front.undrawIndex >= front.trail.length) front.isAlive = false;
    }

    // Mark empty stopped fronts as dead
    for (const front of fronts) {
      if (!front.isAlive || front.isGrowing) continue;
      if (front.trail.length === 0) front.isAlive = false;
    }

    // Remove dead fronts
    for (let i = fronts.length - 1; i >= 0; i--) {
      if (!fronts[i].isAlive) fronts.splice(i, 1);
    }

    // Re-seed if growing front count dropped below threshold
    const needed = Math.max(0, SEED_COUNT - growingCount);
    for (let i = 0; i < needed; i++) spawnRandom();
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!offCanvas || compositeAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = compositeAlpha * COMPOSITE_ALPHA;
    ctx.drawImage(offCanvas, 0, 0);
    ctx.restore();

    // Collision glow overlays
    for (const front of fronts) {
      const glow = front.collisionGlow;
      if (!glow?.isActive) continue;

      const trail       = front.trail;
      const glowEndIdx  = Math.min(glow.trailEndIdx, trail.length) - 1;
      if (glowEndIdx < 0) continue;

      const glowStartIdx = Math.max(front.undrawIndex, glowEndIdx - COLLISION_GLOW_TRAIL_LENGTH + 1);
      if (glowStartIdx > glowEndIdx) continue;

      const startPt = trail[glowStartIdx];
      const endPt   = trail[glowEndIdx];
      if (!startPt || !endPt) continue;

      const duration = COLLISION_GLOW_DURATION_MS / 1000;
      const peakTime = COLLISION_GLOW_PEAK_MS      / 1000;
      let timeFade: number;
      if (glow.age < peakTime) {
        timeFade = glow.age / peakTime;
      } else {
        timeFade = 1 - (glow.age - peakTime) / (duration - peakTime);
      }
      timeFade = Math.max(0, Math.min(1, timeFade));

      const alpha = COLLISION_GLOW_MAX_ALPHA * timeFade * compositeAlpha;
      if (alpha <= 0.001) continue;

      const grad = ctx.createLinearGradient(startPt.x, startPt.y, endPt.x, endPt.y);
      grad.addColorStop(0, 'rgba(255,240,200,0)');
      grad.addColorStop(1, `rgba(255,240,200,${alpha.toFixed(3)})`);

      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth   = COLLISION_GLOW_LINE_WIDTH;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      for (let i = glowStartIdx + 1; i <= glowEndIdx; i++) {
        ctx.lineTo(trail[i].x, trail[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  function reset(): void {
    offCanvas         = null;
    offCtx            = null;
    cgrid             = null;
    fronts            = [];
    canvasW           = 0;
    canvasH           = 0;
    lastTs            = null;
    initStartMs       = null;
    compositeAlpha    = 0;
    nextStoppedOrder  = 0;
    growingCount      = 0;
  }

  return { update, draw, reset };
}
