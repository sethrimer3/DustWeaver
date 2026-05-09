/**
 * liquidRenderer.ts — Liquid Body Renderer and Simulation Pass.
 *
 * Implements cohesive liquid rendering using the LiquidBodyCache:
 *  - Adjacent same-type liquid tiles merge into a single "liquid body".
 *  - Interior tiles render as cheap filled rectangles with no per-tile
 *    animation (greedy-meshed batches).
 *  - Only exposed top edges receive the wave-surface animation.
 *  - Sparse rising bubbles are emitted per body (not per tile).
 *  - Lava sparks emit only from exposed edges, not from interior tiles.
 *
 * Coordinate note: WorldState positions are in world units (1 wu = 1 virtual
 * pixel at zoom 1.0). All drawing uses (world × zoom + offset) transform.
 *
 * Randomness note: Math.random() is acceptable here — all effects are
 * purely cosmetic render-layer state with no gameplay impact. This is an
 * intentional exception to the sim-layer seeded-RNG rule (see DECISIONS.md
 * §Randomness).
 */

import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  getLiquidBodies,
  tickLiquidBubbles,
  LIQUID_EDGE_WAVE_AMPLITUDE,
  LIQUID_EDGE_WAVE_SPEED,
  LIQUID_EDGE_WAVE_SPATIAL_FREQ,
  type LiquidBody,
  type LiquidBubble,
} from './liquidBodyCache';

// ── Lava spark particles ──────────────────────────────────────────────────────

/** Maximum active lava sparks. */
const MAX_SPARKS = 256;
/** Spark gravity (world units per tick²). */
const SPARK_GRAVITY = 0.10;
/** Spark lifetime in ticks. */
const SPARK_LIFETIME_TICKS = 28;
/** Emission probability per exposed-edge-block per tick. */
const SPARK_EMIT_PROB = 0.055;
/** Maximum initial spark speed (world units per tick). */
const SPARK_SPEED_MAX = 1.4;

// ── Wave rendering constants ──────────────────────────────────────────────────

/**
 * Number of taper world units from the edge of a top-edge run over which the
 * wave amplitude fades to zero. Prevents wave "spikes" at run endpoints.
 */
const WAVE_TAPER_WORLD = BLOCK_SIZE_MEDIUM * 0.8;

// ── Lava spark pool ───────────────────────────────────────────────────────────

interface LavaSpark {
  xWorld: number;
  yWorld: number;
  vxWorld: number;
  vyWorld: number;
  ageTicks: number;
}

const _sparks: LavaSpark[] = [];

// ── Main render functions ─────────────────────────────────────────────────────

/**
 * Renders all water liquid bodies.
 * Each body is drawn as merged fill rectangles with wave animation only on
 * exposed top-edge runs. Sparse rising bubbles are drawn per body.
 */
export function renderWaterZones(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  tickLiquidBubbles(tick);
  const bodies = getLiquidBodies(world);

  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    if (body.kind !== 'water') continue;
    renderWaterBody(ctx, body, bi, offsetXPx, offsetYPx, zoom, tick);
  }
}

/**
 * Renders all lava liquid bodies.
 * Interior is a warm glowing gradient; exposed edges get shimmer and sparks.
 */
export function renderLavaZones(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  tickLavaSparks(tick);
  const bodies = getLiquidBodies(world);

  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    if (body.kind !== 'lava') continue;
    renderLavaBody(ctx, body, bi, offsetXPx, offsetYPx, zoom, tick);
  }

  drawLavaSparks(ctx, offsetXPx, offsetYPx, zoom);
}

// ── Water body renderer ───────────────────────────────────────────────────────

function renderWaterBody(
  ctx: CanvasRenderingContext2D,
  body: LiquidBody,
  bodyIndex: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  const { mergedRects, topEdgeRuns, bubbles, minYWorld, maxYWorld } = body;

  // ── Interior fill: draw each merged rectangle as one fillRect call ──────
  // Use a gradient spanning the full body height for visual depth.
  const bodyTopPx  = minYWorld * zoom + offsetYPx;
  const bodyBotPx  = maxYWorld * zoom + offsetYPx;
  const bodyHeightPx = bodyBotPx - bodyTopPx;

  const grad = ctx.createLinearGradient(0, bodyTopPx, 0, bodyBotPx);
  grad.addColorStop(0.0, 'rgba(100,190,255,0.35)');
  grad.addColorStop(0.4, 'rgba(40,120,220,0.45)');
  grad.addColorStop(1.0, 'rgba(10,60,160,0.60)');
  ctx.fillStyle = grad;

  for (let ri = 0; ri < mergedRects.length; ri++) {
    const rect = mergedRects[ri];
    const sx = rect.xWorld * zoom + offsetXPx;
    const sy = rect.yWorld * zoom + offsetYPx;
    const sw = rect.wWorld * zoom;
    const sh = rect.hWorld * zoom;
    ctx.fillRect(sx, sy, sw, sh);
  }

  // ── Caustic shimmer dots (one lightweight pass across the body area) ──────
  if (bodyHeightPx > 0) {
    const causticSeed = tick * 0.04 + bodyIndex * 17.3;
    const bodyLeftPx  = body.minXWorld * zoom + offsetXPx;
    const bodyWidthPx = (body.maxXWorld - body.minXWorld) * zoom;
    ctx.fillStyle = 'rgba(160,220,255,0.18)';
    for (let c = 0; c < 6; c++) {
      const cx = bodyLeftPx + ((Math.sin(causticSeed + c * 2.3) * 0.5 + 0.5)) * bodyWidthPx;
      const cy = bodyTopPx + 3 * zoom + ((Math.cos(causticSeed * 0.7 + c * 1.9) * 0.5 + 0.5)) * (bodyHeightPx * 0.6);
      const cr = (0.6 + Math.sin(causticSeed + c) * 0.4) * zoom;
      ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }
  }

  // ── Wave animation only on exposed top-edge runs ─────────────────────────
  const wAmpPx = LIQUID_EDGE_WAVE_AMPLITUDE * zoom;
  const phaseBase  = tick * LIQUID_EDGE_WAVE_SPEED + bodyIndex * 1.7;
  const phaseBase2 = tick * LIQUID_EDGE_WAVE_SPEED * 0.7 + bodyIndex * 2.9 + 1.2;

  for (let ri = 0; ri < topEdgeRuns.length; ri++) {
    const run = topEdgeRuns[ri];
    const rx  = run.xWorld * zoom + offsetXPx;
    const ry  = run.yWorld * zoom + offsetYPx;
    const rw  = run.wWorld * zoom;

    // Wave fill: draw the wave polyline as a closed path with interior fill
    ctx.fillStyle = 'rgba(40,120,220,0.45)';
    ctx.beginPath();
    drawWavePath(ctx, rx, ry, rw, phaseBase, phaseBase2, wAmpPx, WAVE_TAPER_WORLD * zoom);
    ctx.fill();

    // Foam line on top of the wave
    ctx.strokeStyle = 'rgba(200,240,255,0.55)';
    ctx.lineWidth = zoom * 0.8;
    ctx.beginPath();
    drawWaveLine(ctx, rx, ry, rw, phaseBase, phaseBase2, wAmpPx, WAVE_TAPER_WORLD * zoom);
    ctx.stroke();

    // Sub-surface line (static)
    ctx.strokeStyle = 'rgba(80,160,255,0.30)';
    ctx.lineWidth = zoom * 0.5;
    ctx.beginPath();
    ctx.moveTo(rx, ry + 2 * zoom);
    ctx.lineTo(rx + rw, ry + 2 * zoom);
    ctx.stroke();
  }

  // ── Rising bubbles ────────────────────────────────────────────────────────
  drawBubbles(ctx, bubbles, offsetXPx, offsetYPx, zoom, 'water');
}

// ── Lava body renderer ────────────────────────────────────────────────────────

function renderLavaBody(
  ctx: CanvasRenderingContext2D,
  body: LiquidBody,
  bodyIndex: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  const { mergedRects, topEdgeRuns, bubbles, minYWorld, maxYWorld, tileSet, minXWorld, maxXWorld } = body;

  // ── Interior fill ─────────────────────────────────────────────────────────
  const bodyTopPx  = minYWorld * zoom + offsetYPx;
  const bodyBotPx  = maxYWorld * zoom + offsetYPx;
  const bodyHeightPx = bodyBotPx - bodyTopPx;

  const pulse = 0.30 + Math.sin(tick * 0.06 + bodyIndex * 2.1) * 0.08;
  const lavaGrad = ctx.createLinearGradient(0, bodyTopPx, 0, bodyBotPx);
  lavaGrad.addColorStop(0.0, `rgba(255,120,20,${pulse.toFixed(2)})`);
  lavaGrad.addColorStop(0.5, `rgba(220,50,5,${(pulse * 0.9).toFixed(2)})`);
  lavaGrad.addColorStop(1.0, `rgba(140,20,0,${(pulse * 1.2).toFixed(2)})`);
  ctx.fillStyle = lavaGrad;

  for (let ri = 0; ri < mergedRects.length; ri++) {
    const rect = mergedRects[ri];
    const sx = rect.xWorld * zoom + offsetXPx;
    const sy = rect.yWorld * zoom + offsetYPx;
    const sw = rect.wWorld * zoom;
    const sh = rect.hWorld * zoom;
    ctx.fillRect(sx, sy, sw, sh);
  }

  // ── Hot-spot dots ─────────────────────────────────────────────────────────
  if (bodyHeightPx > 0) {
    const hotSeed = tick * 0.03 + bodyIndex * 11.7;
    const bodyLeftPx  = minXWorld * zoom + offsetXPx;
    const bodyWidthPx = (maxXWorld - minXWorld) * zoom;
    for (let d = 0; d < 5; d++) {
      const dotX = bodyLeftPx + ((Math.sin(hotSeed * 0.8 + d * 3.1) * 0.5 + 0.5)) * bodyWidthPx;
      const rawY = ((hotSeed * 0.4 + d * 0.7) % 1.0);
      const dotY = bodyTopPx + bodyHeightPx - rawY * bodyHeightPx * 1.2;
      if (dotY < bodyTopPx) continue;
      const dotR = (0.8 + Math.sin(hotSeed + d * 2.7) * 0.4) * zoom;
      const dotAlpha = 0.25 + Math.sin(hotSeed * 1.3 + d) * 0.12;
      ctx.fillStyle = `rgba(255,160,40,${dotAlpha.toFixed(2)})`;
      ctx.fillRect(dotX - dotR, dotY - dotR, dotR * 2, dotR * 2);
    }
  }

  // ── Wave shimmer only on exposed top-edge runs ────────────────────────────
  const wAmpPx = LIQUID_EDGE_WAVE_AMPLITUDE * zoom * 0.7;
  const phaseBase  = tick * 0.10 + bodyIndex * 3.0;
  const phaseBase2 = tick * 0.07 + bodyIndex * 1.4 + 1.8;

  for (let ri = 0; ri < topEdgeRuns.length; ri++) {
    const run = topEdgeRuns[ri];
    const rx  = run.xWorld * zoom + offsetXPx;
    const ry  = run.yWorld * zoom + offsetYPx;
    const rw  = run.wWorld * zoom;

    // Orange shimmer line
    ctx.strokeStyle = 'rgba(255,160,30,0.65)';
    ctx.lineWidth = zoom * 0.9;
    ctx.beginPath();
    drawWaveLine(ctx, rx, ry, rw, phaseBase, phaseBase2, wAmpPx, WAVE_TAPER_WORLD * zoom);
    ctx.stroke();

    // Crust line (static, sub-surface)
    ctx.strokeStyle = 'rgba(200,60,0,0.40)';
    ctx.lineWidth = zoom * 0.5;
    ctx.beginPath();
    ctx.moveTo(rx, ry + 2 * zoom);
    ctx.lineTo(rx + rw, ry + 2 * zoom);
    ctx.stroke();

    // Emit sparks only from exposed top edges
    emitLavaSparksFromRun(run.xWorld, run.yWorld, run.wWorld);
  }

  // ── Emit sparks from exposed left/right edges ─────────────────────────────
  const B = BLOCK_SIZE_MEDIUM;
  emitLavaEdgeSparks(body, B);

  // ── Rising bubbles (lava: smaller, faster, hotter colour) ────────────────
  drawBubbles(ctx, bubbles, offsetXPx, offsetYPx, zoom, 'lava');

  void tileSet;
}

// ── Wave path builders ────────────────────────────────────────────────────────

/**
 * Draws a wave polyline (moveTo + lineTo steps) suitable for ctx.stroke().
 * The wave amplitude tapers to zero at both ends of the run.
 */
function drawWaveLine(
  ctx: CanvasRenderingContext2D,
  rx: number, ry: number, rw: number,
  phase1: number, phase2: number,
  wAmpPx: number,
  taperWidthPx: number,
): void {
  const steps = Math.max(2, Math.floor(rw / 2));
  for (let s = 0; s <= steps; s++) {
    const t  = s / steps;
    const px = rx + t * rw;
    const taper = Math.min(
      Math.min(1, (t * rw) / (taperWidthPx + 0.001)),
      Math.min(1, ((1 - t) * rw) / (taperWidthPx + 0.001)),
    );
    const wave = (Math.sin(phase1 + px * LIQUID_EDGE_WAVE_SPATIAL_FREQ) * 0.65
                + Math.sin(phase2 + px * LIQUID_EDGE_WAVE_SPATIAL_FREQ * 0.6) * 0.35)
               * wAmpPx * taper;
    if (s === 0) ctx.moveTo(px, ry + wave);
    else         ctx.lineTo(px, ry + wave);
  }
}

/**
 * Draws a closed wave path suitable for ctx.fill() — draws the wave top edge
 * then a horizontal bottom edge back, closing the path as a thin filled strip.
 * Used to fill the wave crest area with the interior liquid colour.
 */
function drawWavePath(
  ctx: CanvasRenderingContext2D,
  rx: number, ry: number, rw: number,
  phase1: number, phase2: number,
  wAmpPx: number,
  taperWidthPx: number,
): void {
  const steps = Math.max(2, Math.floor(rw / 2));
  for (let s = 0; s <= steps; s++) {
    const t  = s / steps;
    const px = rx + t * rw;
    const taper = Math.min(
      Math.min(1, (t * rw) / (taperWidthPx + 0.001)),
      Math.min(1, ((1 - t) * rw) / (taperWidthPx + 0.001)),
    );
    const wave = (Math.sin(phase1 + px * LIQUID_EDGE_WAVE_SPATIAL_FREQ) * 0.65
                + Math.sin(phase2 + px * LIQUID_EDGE_WAVE_SPATIAL_FREQ * 0.6) * 0.35)
               * wAmpPx * taper;
    if (s === 0) ctx.moveTo(px, ry + wave);
    else         ctx.lineTo(px, ry + wave);
  }
  // Close back along the straight bottom of the strip
  ctx.lineTo(rx + rw, ry);
  ctx.lineTo(rx, ry);
  ctx.closePath();
}

// ── Bubble rendering ──────────────────────────────────────────────────────────

function drawBubbles(
  ctx: CanvasRenderingContext2D,
  bubbles: readonly LiquidBubble[],
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  kind: 'water' | 'lava',
): void {
  if (bubbles.length === 0) return;

  for (let i = 0; i < bubbles.length; i++) {
    const bub = bubbles[i];
    const life = 1 - bub.ageTicks / bub.maxAgeTicks; // 1→0
    if (life <= 0) continue;

    const px = bub.xWorld * zoom + offsetXPx;
    const py = bub.yWorld * zoom + offsetYPx;
    const r  = (0.8 + life * 0.8) * zoom;

    // Inner fill — small circle
    ctx.fillStyle = kind === 'water'
      ? `rgba(180,230,255,${(life * 0.55).toFixed(2)})`
      : `rgba(255,180,60,${(life * 0.45).toFixed(2)})`;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);

    // Rim highlight
    ctx.fillStyle = kind === 'water'
      ? `rgba(220,240,255,${(life * 0.35).toFixed(2)})`
      : `rgba(255,220,80,${(life * 0.30).toFixed(2)})`;
    ctx.fillRect(px - r * 0.4, py - r * 0.7, r * 0.5, r * 0.4);
  }
}

// ── Lava spark emitters ───────────────────────────────────────────────────────

/**
 * Emit sparks from a single top-edge run of a lava body.
 */
function emitLavaSparksFromRun(
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
 * Emits sparks from exposed left/right/bottom edges of a lava body.
 * Checks each tile to see if its sides are exposed.
 */
function emitLavaEdgeSparks(body: LiquidBody, B: number): void {
  if (_sparks.length >= MAX_SPARKS) return;
  const { tileSet, minXWorld, maxXWorld, minYWorld, maxYWorld } = body;
  const minGX = Math.round(minXWorld / B);
  const maxGX = Math.round(maxXWorld / B) - 1;
  const minGY = Math.round(minYWorld / B);
  const maxGY = Math.round(maxYWorld / B) - 1;

  // Only check border tiles for performance
  // Left edge
  for (let gy = minGY; gy <= maxGY; gy++) {
    const k = encodeKeyLocal(minGX, gy);
    if (!tileSet.has(k)) continue;
    if (!tileSet.has(encodeKeyLocal(minGX - 1, gy)) && Math.random() < SPARK_EMIT_PROB * 0.3) {
      if (_sparks.length >= MAX_SPARKS) return;
      emitSideSparkAt(minGX * B, (gy + 0.5) * B, -1, 0);
    }
  }
  // Right edge
  for (let gy = minGY; gy <= maxGY; gy++) {
    const k = encodeKeyLocal(maxGX, gy);
    if (!tileSet.has(k)) continue;
    if (!tileSet.has(encodeKeyLocal(maxGX + 1, gy)) && Math.random() < SPARK_EMIT_PROB * 0.3) {
      if (_sparks.length >= MAX_SPARKS) return;
      emitSideSparkAt((maxGX + 1) * B, (gy + 0.5) * B, 1, 0);
    }
  }
}

function emitSideSparkAt(xWorld: number, yWorld: number, dirX: number, dirY: number): void {
  const speed = 0.3 + Math.random() * (SPARK_SPEED_MAX - 0.3);
  _sparks.push({
    xWorld,
    yWorld,
    vxWorld: dirX * speed * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * speed * 0.3,
    vyWorld: dirY * speed + (Math.random() - 0.5) * speed * 0.5,
    ageTicks: 0,
  });
}

// ── Spark tick + draw ─────────────────────────────────────────────────────────

function tickLavaSparks(_tick: number): void {
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

function drawLavaSparks(
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

// ── Local key encoder (matches liquidBodyCache.ts encoding) ───────────────────

function encodeKeyLocal(gx: number, gy: number): number {
  return (gx + 4096) * 8192 + (gy + 4096);
}
