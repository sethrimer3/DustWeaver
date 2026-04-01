/**
 * PrologueShapeEffect
 *
 * Ported from Thero_Idle_TD PrologueShapeEffect.js.
 * Six invisible shapes (3 circles + 3 squares) drift across the 480×270
 * virtual canvas.  Only where an EVEN number of shapes overlap does a faint
 * silver-white glow become visible (XOR compositing technique).
 *
 * Scaled down from Thero's large CSS-pixel viewport to the 480×270 virtual
 * canvas: radii are halved (38→19, 54→27, 76→38) and speeds are proportionally
 * reduced.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';

// ─── Shape dimensions (virtual pixels) ───────────────────────────────────────

const SMALL_CIRCLE_RADIUS_PX  = 19;
const MEDIUM_CIRCLE_RADIUS_PX = 27;
const LARGE_CIRCLE_RADIUS_PX  = 38;

const SQUARE_SIDES_PX = [38, 54, 62];

// ─── Motion constants ─────────────────────────────────────────────────────────

const MIN_SPEED_PX_S = 3;
const MAX_SPEED_PX_S = 8;

const NUDGE_INTERVAL_MS = 3500;
const NUDGE_AMOUNT_PX_S = 1.5;

const MIN_ROT_SPEED_RAD_S = 0.04;
const MAX_ROT_SPEED_RAD_S = 0.14;

// ─── Glow appearance ─────────────────────────────────────────────────────────

const GLOW_R     = 215;
const GLOW_G     = 228;
const GLOW_B     = 255;
const GLOW_ALPHA = 0.07;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CircleShape {
  type: 'circle';
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SquareShape {
  type: 'square';
  s: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotSpeed: number;
}

type Shape = CircleShape | SquareShape;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function addShapePath(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.type === 'circle') {
    ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
  } else {
    const hs  = shape.s * 0.5;
    const cos = Math.cos(shape.rotation);
    const sin = Math.sin(shape.rotation);
    const corners: [number, number][] = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]];
    const wx0 = shape.x + corners[0][0] * cos - corners[0][1] * sin;
    const wy0 = shape.y + corners[0][0] * sin + corners[0][1] * cos;
    ctx.moveTo(wx0, wy0);
    for (let k = 1; k < 4; k++) {
      const lx = corners[k][0];
      const ly = corners[k][1];
      ctx.lineTo(shape.x + lx * cos - ly * sin, shape.y + lx * sin + ly * cos);
    }
    ctx.closePath();
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPrologueShapeEffect(): TheroBackgroundEffect {
  const fillStyle = `rgba(${GLOW_R}, ${GLOW_G}, ${GLOW_B}, ${GLOW_ALPHA})`;

  let shapes: Shape[] | null = null;
  let lastTimestampMs: number | null = null;
  let lastNudgeMs = 0;

  let vpW = 0;
  let vpH = 0;

  let ocXor: HTMLCanvasElement | null    = null;
  let ctxXor: CanvasRenderingContext2D | null   = null;
  let ocUnion: HTMLCanvasElement | null  = null;
  let ctxUnion: CanvasRenderingContext2D | null = null;

  function ensureOffscreenCanvases(w: number, h: number): void {
    if (ocXor && ocXor.width === w && ocXor.height === h) return;

    ocXor        = document.createElement('canvas');
    ocXor.width  = w;
    ocXor.height = h;
    ctxXor       = ocXor.getContext('2d')!;

    ocUnion        = document.createElement('canvas');
    ocUnion.width  = w;
    ocUnion.height = h;
    ctxUnion       = ocUnion.getContext('2d')!;
  }

  function init(widthPx: number, heightPx: number): void {
    shapes = [];

    const randVelocity = (): { vx: number; vy: number } => {
      const speedPxS = MIN_SPEED_PX_S + Math.random() * (MAX_SPEED_PX_S - MIN_SPEED_PX_S);
      const angleRad = Math.random() * Math.PI * 2;
      return { vx: Math.cos(angleRad) * speedPxS, vy: Math.sin(angleRad) * speedPxS };
    };

    for (const r of [SMALL_CIRCLE_RADIUS_PX, MEDIUM_CIRCLE_RADIUS_PX, LARGE_CIRCLE_RADIUS_PX]) {
      const { vx, vy } = randVelocity();
      shapes.push({ type: 'circle', r, x: Math.random() * widthPx, y: Math.random() * heightPx, vx, vy });
    }

    for (const s of SQUARE_SIDES_PX) {
      const { vx, vy } = randVelocity();
      const rotSign = Math.random() < 0.5 ? 1 : -1;
      shapes.push({
        type:     'square',
        s,
        x:        Math.random() * widthPx,
        y:        Math.random() * heightPx,
        vx,
        vy,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: rotSign * (MIN_ROT_SPEED_RAD_S + Math.random() * (MAX_ROT_SPEED_RAD_S - MIN_ROT_SPEED_RAD_S)),
      });
    }
  }

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    const dimensionChanged = !shapes ||
      Math.abs(widthPx  - vpW) > 50 ||
      Math.abs(heightPx - vpH) > 50;

    if (dimensionChanged) {
      vpW = widthPx;
      vpH = heightPx;
      init(widthPx, heightPx);
      lastTimestampMs = nowMs;
      lastNudgeMs     = nowMs;
      return;
    }

    const dtMs = nowMs - (lastTimestampMs ?? nowMs);
    lastTimestampMs = nowMs;
    const dtSec = Math.min(dtMs / 1000, 0.1);

    if (nowMs - lastNudgeMs > NUDGE_INTERVAL_MS) {
      lastNudgeMs = nowMs;
      for (const shape of shapes!) {
        shape.vx += (Math.random() - 0.5) * NUDGE_AMOUNT_PX_S * 2;
        shape.vy += (Math.random() - 0.5) * NUDGE_AMOUNT_PX_S * 2;
        const speed = Math.hypot(shape.vx, shape.vy);
        if (speed > MAX_SPEED_PX_S) {
          const inv = MAX_SPEED_PX_S / speed;
          shape.vx *= inv;
          shape.vy *= inv;
        } else if (speed > 0 && speed < MIN_SPEED_PX_S) {
          const inv = MIN_SPEED_PX_S / speed;
          shape.vx *= inv;
          shape.vy *= inv;
        }
      }
    }

    for (const shape of shapes!) {
      shape.x += shape.vx * dtSec;
      shape.y += shape.vy * dtSec;

      const margin = shape.type === 'circle' ? shape.r : (shape as SquareShape).s * 0.85;
      if      (shape.x < -margin)            { shape.x += widthPx  + margin * 2; }
      else if (shape.x >  widthPx + margin)  { shape.x -= widthPx  + margin * 2; }
      if      (shape.y < -margin)            { shape.y += heightPx + margin * 2; }
      else if (shape.y >  heightPx + margin) { shape.y -= heightPx + margin * 2; }

      if (shape.type === 'square') {
        shape.rotation += shape.rotSpeed * dtSec;
      }
    }
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!shapes || !vpW || !vpH) return;

    ensureOffscreenCanvases(vpW, vpH);

    // Pass 1: XOR canvas — odd-overlap → opaque, even-overlap → transparent
    ctxXor!.globalCompositeOperation = 'source-over';
    ctxXor!.clearRect(0, 0, vpW, vpH);
    ctxXor!.globalCompositeOperation = 'xor';
    ctxXor!.fillStyle = 'rgba(255,255,255,1)';
    for (const shape of shapes) {
      ctxXor!.beginPath();
      addShapePath(ctxXor!, shape);
      ctxXor!.fill();
    }

    // Pass 2: Union canvas — all covered areas with glow colour
    ctxUnion!.globalCompositeOperation = 'source-over';
    ctxUnion!.clearRect(0, 0, vpW, vpH);
    ctxUnion!.fillStyle = fillStyle;
    for (const shape of shapes) {
      ctxUnion!.beginPath();
      addShapePath(ctxUnion!, shape);
      ctxUnion!.fill();
    }

    // Pass 3: Remove odd-overlap regions from union canvas
    ctxUnion!.globalCompositeOperation = 'destination-out';
    ctxUnion!.drawImage(ocXor!, 0, 0);

    // Blit result onto main canvas
    ctx.save();
    ctx.drawImage(ocUnion!, 0, 0);
    ctx.restore();
  }

  function reset(): void {
    shapes        = null;
    lastTimestampMs = null;
    lastNudgeMs   = 0;
    vpW           = 0;
    vpH           = 0;
    ocXor         = null;
    ctxXor        = null;
    ocUnion       = null;
    ctxUnion      = null;
  }

  return { update, draw, reset };
}
