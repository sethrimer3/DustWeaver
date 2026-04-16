/**
 * VermiculateEffect
 *
 * Ported from Thero_Idle_TD VermiculateEffect.js.
 * 14 tracers (orthogonal + circular) crawl across the 480×270 virtual canvas,
 * bounce off each other's trail segments, and register glowing contact zones.
 * Line bodies are invisible; only head dots (10%) and contact zones (15%)
 * are visible.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';
import { clamp } from '../../utils/math';

// ─── Constants ────────────────────────────────────────────────────────────────

const TRACER_COUNT          = 14;
const MAX_SEGMENTS          = 30;
const SPEED_PX_S            = 28;
const STEP_DISTANCE_PX      = 3.5;
const RIGHT_ANGLE_RAD       = Math.PI / 2;
const CIRCULAR_TURN_RATE    = 1.05;
const ORTHO_TURN_MIN_SEC    = 0.9;
const ORTHO_TURN_MAX_SEC    = 1.8;
const BOUNCE_COOLDOWN_SEC   = 0.09;
const LINE_OPACITY          = 0;
const HEAD_DOT_OPACITY      = 0.10;
const CONTACT_MAX_OPACITY   = 0.15;
const CONTACT_LIFETIME_SEC  = 1.1;
const LINE_WIDTH_PX         = 1.2;
const CONTACT_WIDTH_PX      = 2.2;
const HEAD_DOT_SIZE_PX      = 10;
const MIN_SEGMENT_LENGTH_SQ = 0.04;
const SELF_SKIP_SEGMENTS    = 2;
const TWO_PI                = Math.PI * 2;

const PALETTE = [
  { r: 255, g: 255, b: 255 },
  { r: 214, g: 224, b: 255 },
  { r: 255, g: 239, b: 214 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  x1: number; y1: number;
  x2: number; y2: number;
  dx: number; dy: number;
  tracerId: number;
  lengthSq: number;
}

interface PaletteColor { r: number; g: number; b: number; }

interface TracerStyles {
  line: string;
  contact: string;
}

interface Tracer {
  id: number;
  mode: 'orthogonal' | 'circular';
  color: PaletteColor;
  styles: TracerStyles;
  x: number;
  y: number;
  angle: number;
  segments: Segment[];
  turnTimer: number;
  curveDirection: number;
  bounceCooldown: number;
}

interface ContactHighlight {
  x: number;
  y: number;
  life: number;
  color: PaletteColor;
}

interface HitResult {
  x: number; y: number;
  normalX: number; normalY: number;
  t: number; u: number;
  otherTracer: Tracer;
  otherSegment: Segment;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickColor(): PaletteColor {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function randomOrthogonalAngleRad(): number {
  return Math.floor(Math.random() * 4) * RIGHT_ANGLE_RAD;
}

function randomOrthoTurnIntervalSec(): number {
  return ORTHO_TURN_MIN_SEC + Math.random() * (ORTHO_TURN_MAX_SEC - ORTHO_TURN_MIN_SEC);
}

function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a <= -Math.PI) a += TWO_PI;
  while (a >   Math.PI) a -= TWO_PI;
  return a;
}

function reflectAngleRad(angle: number, normalX: number, normalY: number): number {
  const dx   = Math.cos(angle);
  const dy   = Math.sin(angle);
  const dot  = dx * normalX + dy * normalY;
  const rx   = dx - 2 * dot * normalX;
  const ry   = dy - 2 * dot * normalY;
  return Math.atan2(ry, rx);
}

function createDotSprite(r: number, g: number, b: number, sizePx: number): HTMLCanvasElement {
  const offscreen = document.createElement('canvas');
  offscreen.width  = sizePx;
  offscreen.height = sizePx;
  const c      = offscreen.getContext('2d')!;
  const radius = sizePx / 2;
  const center = radius;

  const gradient = c.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0,    'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  gradient.addColorStop(1,    `rgba(${r},${g},${b},0)`);

  c.fillStyle = gradient;
  c.beginPath();
  c.arc(center, center, radius, 0, TWO_PI);
  c.fill();
  return offscreen;
}

function buildStyles(color: PaletteColor): TracerStyles {
  return {
    line:    `rgba(${color.r},${color.g},${color.b},${LINE_OPACITY.toFixed(3)})`,
    contact: `rgba(${color.r},${color.g},${color.b},${CONTACT_MAX_OPACITY.toFixed(3)})`,
  };
}

function createTracer(widthPx: number, heightPx: number, index: number): Tracer {
  const color = pickColor();
  const mode  = index % 2 === 0 ? 'orthogonal' : 'circular';
  const angle = mode === 'orthogonal' ? randomOrthogonalAngleRad() : Math.random() * TWO_PI;
  return {
    id:             index,
    mode,
    color,
    styles:         buildStyles(color),
    x:              Math.random() * widthPx,
    y:              Math.random() * heightPx,
    angle,
    segments:       [],
    turnTimer:      randomOrthoTurnIntervalSec(),
    curveDirection: Math.random() < 0.5 ? -1 : 1,
    bounceCooldown: 0,
  } as Tracer;
}

function createSegment(x1: number, y1: number, x2: number, y2: number, tracerId: number): Segment {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return { x1, y1, x2, y2, dx, dy, tracerId, lengthSq: dx * dx + dy * dy };
}

function getSegmentIntersection(a: Segment, b: Segment): { x: number; y: number; normalX: number; normalY: number; t: number; u: number } | null {
  const denom = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denom) < 0.000001) return null;

  const qpx = b.x1 - a.x1;
  const qpy = b.y1 - a.y1;
  const t   = (qpx * b.dy - qpy * b.dx) / denom;
  const u   = (qpx * a.dy - qpy * a.dx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  const ix       = a.x1 + a.dx * t;
  const iy       = a.y1 + a.dy * t;
  const segLen   = Math.hypot(b.dx, b.dy) || 1;
  const normalX  = -b.dy / segLen;
  const normalY  =  b.dx / segLen;
  return { x: ix, y: iy, normalX, normalY, t, u };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createVermiculateEffect(): TheroBackgroundEffect {
  let tracers: Tracer[]            = [];
  let contactHighlights: ContactHighlight[] = [];
  let lastTimestampMs: number | null = null;
  let viewWidthPx  = 0;
  let viewHeightPx = 0;
  let dotSprites: Map<string, HTMLCanvasElement> | null = null;

  function ensureDotSprites(): void {
    if (dotSprites) return;
    dotSprites = new Map();
    for (const color of PALETTE) {
      dotSprites.set(`${color.r},${color.g},${color.b}`, createDotSprite(color.r, color.g, color.b, HEAD_DOT_SIZE_PX));
    }
  }

  function initialize(widthPx: number, heightPx: number): void {
    tracers           = [];
    contactHighlights = [];
    for (let i = 0; i < TRACER_COUNT; i++) {
      tracers.push(createTracer(widthPx, heightPx, i));
    }
    lastTimestampMs = null;

    for (let step = 0; step < 90; step++) {
      simulate(0.025, widthPx, heightPx);
    }
  }

  function ageHighlights(dtSec: number): void {
    for (let i = contactHighlights.length - 1; i >= 0; i--) {
      contactHighlights[i].life -= dtSec;
      if (contactHighlights[i].life <= 0) contactHighlights.splice(i, 1);
    }
  }

  function registerContact(x: number, y: number, colorA: PaletteColor, colorB: PaletteColor): void {
    const blend: PaletteColor = {
      r: Math.round((colorA.r + colorB.r + 255) / 3),
      g: Math.round((colorA.g + colorB.g + 255) / 3),
      b: Math.round((colorA.b + colorB.b + 255) / 3),
    };
    contactHighlights.push({ x, y, life: CONTACT_LIFETIME_SEC, color: blend });
  }

  function detectSegmentHit(tracer: Tracer, segment: Segment): HitResult | null {
    for (const other of tracers) {
      const isSelf = other.id === tracer.id;
      const limit  = other.segments.length - (isSelf ? SELF_SKIP_SEGMENTS : 0);
      for (let i = 0; i < limit; i++) {
        const candidate = other.segments[i];
        if (!candidate || candidate.lengthSq < MIN_SEGMENT_LENGTH_SQ) continue;
        const hit = getSegmentIntersection(segment, candidate);
        if (!hit) continue;
        if (isSelf && hit.t < 0.08) continue;
        return { ...hit, otherTracer: other, otherSegment: candidate };
      }
    }
    return null;
  }

  function advanceTracer(tracer: Tracer, dtSec: number, widthPx: number, heightPx: number): void {
    tracer.bounceCooldown = Math.max(0, tracer.bounceCooldown - dtSec);

    if (tracer.mode === 'orthogonal') {
      tracer.turnTimer -= dtSec;
      if (tracer.turnTimer <= 0) {
        tracer.angle    += (Math.random() < 0.5 ? -1 : 1) * RIGHT_ANGLE_RAD;
        tracer.turnTimer = randomOrthoTurnIntervalSec();
      }
    } else {
      tracer.angle += tracer.curveDirection * CIRCULAR_TURN_RATE * dtSec;
    }

    const totalDistance = SPEED_PX_S * dtSec;
    const steps   = Math.max(1, Math.ceil(totalDistance / STEP_DISTANCE_PX));
    const microDt = dtSec / steps;

    for (let step = 0; step < steps; step++) {
      if (tracer.mode === 'circular') {
        tracer.angle += tracer.curveDirection * CIRCULAR_TURN_RATE * microDt;
      }

      const startX   = tracer.x;
      const startY   = tracer.y;
      const distance = SPEED_PX_S * microDt;
      const nextX    = startX + Math.cos(tracer.angle) * distance;
      const nextY    = startY + Math.sin(tracer.angle) * distance;
      const segment  = createSegment(startX, startY, nextX, nextY, tracer.id);
      if (segment.lengthSq < MIN_SEGMENT_LENGTH_SQ) { tracer.x = nextX; tracer.y = nextY; continue; }

      let hasBounced = false;
      if (tracer.bounceCooldown <= 0) {
        const hit = detectSegmentHit(tracer, segment);
        if (hit) {
          registerContact(hit.x, hit.y, tracer.color, hit.otherTracer.color);
          tracer.angle          = reflectAngleRad(tracer.angle, hit.normalX, hit.normalY);
          tracer.angle          = normalizeAngleRad(tracer.angle);
          tracer.bounceCooldown = BOUNCE_COOLDOWN_SEC;
          tracer.x              = hit.x + Math.cos(tracer.angle) * 1.4;
          tracer.y              = hit.y + Math.sin(tracer.angle) * 1.4;
          hasBounced            = true;
        }
      }

      if (hasBounced) continue;

      tracer.x = nextX;
      tracer.y = nextY;

      if (tracer.x <= 0 || tracer.x >= widthPx) {
        tracer.angle = reflectAngleRad(tracer.angle, tracer.x <= 0 ? 1 : -1, 0);
        tracer.x     = clamp(tracer.x, 0, widthPx);
      }
      if (tracer.y <= 0 || tracer.y >= heightPx) {
        tracer.angle = reflectAngleRad(tracer.angle, 0, tracer.y <= 0 ? 1 : -1);
        tracer.y     = clamp(tracer.y, 0, heightPx);
      }
      tracer.x = clamp(tracer.x, 0, widthPx);
      tracer.y = clamp(tracer.y, 0, heightPx);

      const committed = createSegment(startX, startY, tracer.x, tracer.y, tracer.id);
      if (committed.lengthSq >= MIN_SEGMENT_LENGTH_SQ) {
        tracer.segments.push(committed);
        if (tracer.segments.length > MAX_SEGMENTS) tracer.segments.shift();
      }
    }
  }

  function simulate(dtSec: number, widthPx: number, heightPx: number): void {
    ageHighlights(dtSec);
    for (const tracer of tracers) {
      advanceTracer(tracer, dtSec, widthPx, heightPx);
    }
  }

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    const isResized = !tracers.length || Math.abs(widthPx - viewWidthPx) > 50 || Math.abs(heightPx - viewHeightPx) > 50;
    viewWidthPx  = widthPx;
    viewHeightPx = heightPx;
    if (isResized) initialize(widthPx, heightPx);
    ensureDotSprites();

    const dtSec = lastTimestampMs === null ? 0.016 : Math.min((nowMs - lastTimestampMs) / 1000, 0.05);
    lastTimestampMs = nowMs;
    simulate(dtSec, widthPx, heightPx);
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!tracers.length) return;

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Invisible baseline lines (geometry only)
    for (const tracer of tracers) {
      if (!tracer.segments.length) continue;
      ctx.beginPath();
      ctx.lineWidth    = LINE_WIDTH_PX;
      ctx.strokeStyle  = tracer.styles.line;
      ctx.moveTo(tracer.segments[0].x1, tracer.segments[0].y1);
      for (const seg of tracer.segments) ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    // Contact highlight glow zones
    for (const highlight of contactHighlights) {
      const alpha    = CONTACT_MAX_OPACITY * clamp(highlight.life / CONTACT_LIFETIME_SEC, 0, 1);
      const gradient = ctx.createRadialGradient(highlight.x, highlight.y, 0, highlight.x, highlight.y, 18);
      gradient.addColorStop(0,    `rgba(${highlight.color.r},${highlight.color.g},${highlight.color.b},${alpha.toFixed(3)})`);
      gradient.addColorStop(0.55, `rgba(${highlight.color.r},${highlight.color.g},${highlight.color.b},${(alpha * 0.45).toFixed(3)})`);
      gradient.addColorStop(1,    `rgba(${highlight.color.r},${highlight.color.g},${highlight.color.b},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(highlight.x, highlight.y, 18, 0, TWO_PI);
      ctx.fill();
    }

    // Short visible fragments near contact points
    for (const tracer of tracers) {
      ctx.strokeStyle = tracer.styles.contact;
      ctx.lineWidth   = CONTACT_WIDTH_PX;
      for (const seg of tracer.segments) {
        for (const highlight of contactHighlights) {
          const minX = Math.min(seg.x1, seg.x2) - 8;
          const maxX = Math.max(seg.x1, seg.x2) + 8;
          const minY = Math.min(seg.y1, seg.y2) - 8;
          const maxY = Math.max(seg.y1, seg.y2) + 8;
          if (highlight.x < minX || highlight.x > maxX || highlight.y < minY || highlight.y > maxY) continue;
          ctx.globalAlpha = clamp(highlight.life / CONTACT_LIFETIME_SEC, 0, 1);
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // Head dots
    for (const tracer of tracers) {
      const key    = `${tracer.color.r},${tracer.color.g},${tracer.color.b}`;
      const sprite = dotSprites?.get(key);
      if (!sprite) continue;
      const half = HEAD_DOT_SIZE_PX / 2;
      ctx.save();
      ctx.globalAlpha = HEAD_DOT_OPACITY;
      ctx.drawImage(sprite, tracer.x - half, tracer.y - half);
      ctx.restore();
    }

    ctx.restore();
  }

  function reset(): void {
    tracers           = [];
    contactHighlights = [];
    lastTimestampMs   = null;
  }

  return { update, draw, reset };
}
