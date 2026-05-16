/**
 * lavaSparkSystem.ts — Lava spark particle pool, emitters, tick, and renderer.
 *
 * Extracted from liquidRenderer.ts so that the lava-spark physics simulation
 * and draw pass are self-contained and independent of the water/wave rendering
 * code.  The two constants SPARK_SPEED_MAX and SPARK_LIFETIME_TICKS are
 * exported so callers can compute viewport cull margins without re-deriving
 * the same values.
 *
 * Randomness: Math.random() is intentional here — all effects are purely
 * cosmetic render-layer state with no gameplay impact (see DECISIONS.md
 * §Randomness).
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { LiquidBody } from './liquidBodyCache';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum active lava sparks in the pool at once. */
const MAX_SPARKS = 256;

/** Gravity applied to each spark per tick (world units per tick²). */
const SPARK_GRAVITY = 0.10;

/** How many ticks a spark lives before being recycled. */
export const SPARK_LIFETIME_TICKS = 28;

/** Probability of emitting a spark per exposed-edge-block per tick. */
const SPARK_EMIT_PROB = 0.055;

/** Maximum initial spark speed (world units per tick). */
export const SPARK_SPEED_MAX = 1.4;

// ── Pool ──────────────────────────────────────────────────────────────────────

interface LavaSpark {
  xWorld: number;
  yWorld: number;
  vxWorld: number;
  vyWorld: number;
  ageTicks: number;
}

const _sparks: LavaSpark[] = [];

// ── Emitters ──────────────────────────────────────────────────────────────────

/**
 * Emit sparks from a single top-edge run of a lava body.
 */
export function emitLavaSparksFromRun(
  rxWorld: number,
  ryWorld: number,
  rwWorld: number,
): void {
  const blockW = BLOCK_SIZE_MEDIUM;
  const cells = Math.max(1, Math.round(rwWorld / blockW));
  for (let c = 0; c < cells; c++) {
    if (Math.random() > SPARK_EMIT_PROB) continue;
    if (_sparks.length >= MAX_SPARKS) return;
    const t = (c + Math.random()) / cells;
    const px = rxWorld + t * rwWorld;
    const speed = 0.3 + Math.random() * (SPARK_SPEED_MAX - 0.3);
    _sparks.push({
      xWorld: px,
      yWorld: ryWorld,
      vxWorld: (Math.random() - 0.5) * speed * 0.6,
      vyWorld: -speed * (0.5 + Math.random() * 0.5),
      ageTicks: 0,
    });
  }
}

/**
 * Emit sparks from exposed left/right edges of a lava body.
 * Checks each border tile to see if its horizontal sides are exposed.
 */
export function emitLavaEdgeSparks(body: LiquidBody, B: number): void {
  if (_sparks.length >= MAX_SPARKS) return;
  const { tileSet, minXWorld, maxXWorld, minYWorld, maxYWorld } = body;
  const minGX = Math.round(minXWorld / B);
  const maxGX = Math.round(maxXWorld / B) - 1;
  const minGY = Math.round(minYWorld / B);
  const maxGY = Math.round(maxYWorld / B) - 1;

  // Only check border tiles for performance.
  // Left edge
  for (let gy = minGY; gy <= maxGY; gy++) {
    const k = _encodeKeyLocal(minGX, gy);
    if (!tileSet.has(k)) continue;
    if (!tileSet.has(_encodeKeyLocal(minGX - 1, gy)) && Math.random() < SPARK_EMIT_PROB * 0.3) {
      if (_sparks.length >= MAX_SPARKS) return;
      _emitSideSparkAt(minGX * B, (gy + 0.5) * B, -1, 0);
    }
  }
  // Right edge
  for (let gy = minGY; gy <= maxGY; gy++) {
    const k = _encodeKeyLocal(maxGX, gy);
    if (!tileSet.has(k)) continue;
    if (!tileSet.has(_encodeKeyLocal(maxGX + 1, gy)) && Math.random() < SPARK_EMIT_PROB * 0.3) {
      if (_sparks.length >= MAX_SPARKS) return;
      _emitSideSparkAt((maxGX + 1) * B, (gy + 0.5) * B, 1, 0);
    }
  }
}

function _emitSideSparkAt(xWorld: number, yWorld: number, dirX: number, dirY: number): void {
  const speed = 0.3 + Math.random() * (SPARK_SPEED_MAX - 0.3);
  _sparks.push({
    xWorld,
    yWorld,
    vxWorld: dirX * speed * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * speed * 0.3,
    vyWorld: dirY * speed + (Math.random() - 0.5) * speed * 0.5,
    ageTicks: 0,
  });
}

// ── Tick & draw ───────────────────────────────────────────────────────────────

/** Advance all active sparks by one tick, recycling expired ones. */
export function tickLavaSparks(_tick: number): void {
  for (let i = _sparks.length - 1; i >= 0; i--) {
    const s = _sparks[i];
    s.ageTicks++;
    if (s.ageTicks >= SPARK_LIFETIME_TICKS) {
      _sparks[i] = _sparks[_sparks.length - 1];
      _sparks.pop();
      continue;
    }
    s.xWorld  += s.vxWorld;
    s.yWorld  += s.vyWorld;
    s.vyWorld += SPARK_GRAVITY;
    s.vxWorld *= 0.97;
  }
}

/** Draw all active lava sparks onto the canvas. */
export function drawLavaSparks(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (let i = 0; i < _sparks.length; i++) {
    const s    = _sparks[i];
    const life = 1 - s.ageTicks / SPARK_LIFETIME_TICKS;
    const r    = 255;
    const g    = Math.round(life * life * 200 + 30);
    const b    = Math.round(life * life * 100);
    const alpha = life * 0.9;
    const sz   = (0.8 + life * 1.2) * zoom;
    const px   = s.xWorld * zoom + offsetXPx;
    const py   = s.yWorld * zoom + offsetYPx;

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);

    if (life > 0.4) {
      const glowAlpha = life * 0.25;
      ctx.fillStyle = `rgba(${r},${g},${b},${glowAlpha.toFixed(2)})`;
      ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Local tile key encoder — matches the encoding used in liquidBodyCache.ts.
 * Maps grid coordinates in the range [-4096, 4095] to unique integer keys:
 * (gx + 4096) shifts gx to [0, 8191]; multiplying by 8192 leaves room for gy. */
function _encodeKeyLocal(gx: number, gy: number): number {
  return (gx + 4096) * 8192 + (gy + 4096);
}
