/**
 * liquidRenderer.ts — Neighbor-aware rendering for water and lava zones.
 *
 * Features:
 *  • Rounded corners where a liquid cell is NOT blocked by a wall or another
 *    liquid zone orthogonally (i.e. an exposed corner gets a radius arc).
 *  • Smooth sine-wave surface on exposed top edges that tapers to zero where
 *    corners are rounded.
 *  • Lava-only spark particles: gravity-affected embers that pop from any
 *    exposed edge (top, bottom, or sides) with a short lifetime.
 *
 * Coordinate note: WorldState stores positions in world units (1 wu = 1 virtual
 * pixel at zoom 1.0).  All drawing uses the standard (world × zoom + offset)
 * transform already established by renderHazards.
 *
 * Randomness note: Math.random() is used for lava spark emission.  Sparks are
 * purely cosmetic render-layer particles with no effect on gameplay, collision,
 * or simulation state.  Non-deterministic emission is intentional — it avoids
 * sparks firing in lock-step and looks more natural.  This is an explicit
 * exception to the sim-layer seeded-RNG rule (see DECISIONS.md §Randomness).
 */

import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

// ── Corner radius ─────────────────────────────────────────────────────────────

/** Corner arc radius in world units for a fully free corner. */
const CORNER_RADIUS_WORLD = BLOCK_SIZE_MEDIUM * 0.4;

// ── Wave parameters ───────────────────────────────────────────────────────────

/** Peak-to-peak wave amplitude on an exposed top surface (world units). */
const WAVE_AMPLITUDE_WORLD = 0.55;
/** Wave speed (radians per tick, drives the sine frequency). */
const WAVE_FREQ = 0.065;
/** Spatial wave frequency (radians per world unit). */
const WAVE_SPATIAL_FREQ = 0.32;
/** Taper width near rounded corners (world units): wave amplitude fades to 0 here. */
const WAVE_TAPER_WORLD = BLOCK_SIZE_MEDIUM * 0.8;

// ── Lava spark particles ──────────────────────────────────────────────────────

/** Maximum active sparks (shared across all lava zones per frame). */
const MAX_SPARKS = 256;
/** Spark gravity acceleration (world units per tick²). */
const SPARK_GRAVITY = 0.10;
/** Spark lifetime in ticks. */
const SPARK_LIFETIME_TICKS = 28;
/** Emission probability per exposed-edge-block per tick. */
const SPARK_EMIT_PROB = 0.055;
/** Maximum initial speed (world units per tick). */
const SPARK_SPEED_MAX = 1.4;

interface LavaSpark {
  xWorld: number;
  yWorld: number;
  vxWorld: number;
  vyWorld: number;
  ageTicks: number;
}

// Module-level spark pool — purely cosmetic render state.
const sparks: LavaSpark[] = [];

// ── Neighbour check helpers ───────────────────────────────────────────────────

/**
 * Returns true if the axis-aligned rectangle [rx, ry, rw, rh] is blocked
 * in the given orthogonal direction by a wall or another liquid zone.
 *
 * "Blocked in direction d" means there is a wall AABB (or zone) whose face
 * in direction d touches or overlaps the zone edge in that direction.
 *
 * direction: 0=left, 1=right, 2=up, 3=down
 */
function isSideBlocked(
  rx: number, ry: number, rw: number, rh: number,
  direction: 0 | 1 | 2 | 3,
  world: WorldState,
  skipZoneIndex: number,
  isLava: boolean,
): boolean {
  // `touchEpsilon`: zones/walls within this world-unit distance count as touching.
  const touchEpsilon = 0.5;

  // Wall check: iterate world walls
  const wc = world.wallCount;
  const wx = world.wallXWorld;
  const wy = world.wallYWorld;
  const ww = world.wallWWorld;
  const wh = world.wallHWorld;

  // Overlap test helper: does zone overlap (or touch) a wall on the queried axis?
  for (let i = 0; i < wc; i++) {
    const wRight = wx[i] + ww[i];
    const wBottom = wy[i] + wh[i];

    // Quick broad-phase: the wall's opposite-axis range must overlap the zone's
    if (direction === 0 || direction === 1) {
      // Checking left/right: wall's y range must overlap zone's y range
      if (wBottom <= ry + touchEpsilon || wy[i] >= ry + rh - touchEpsilon) continue;
    } else {
      // Checking up/down: wall's x range must overlap zone's x range
      if (wRight <= rx + touchEpsilon || wx[i] >= rx + rw - touchEpsilon) continue;
    }

    switch (direction) {
      case 0: if (Math.abs(wRight - rx) <= touchEpsilon) return true; break;           // left
      case 1: if (Math.abs(wx[i] - (rx + rw)) <= touchEpsilon) return true; break;    // right
      case 2: if (Math.abs(wBottom - ry) <= touchEpsilon) return true; break;          // up
      case 3: if (Math.abs(wy[i] - (ry + rh)) <= touchEpsilon) return true; break;    // down
    }
  }

  // Liquid zone check: other water or lava zones adjacent on same side
  const checkZones = (
    count: number,
    zx: Float32Array, zy: Float32Array, zw: Float32Array, zh: Float32Array,
  ) => {
    for (let i = 0; i < count; i++) {
      if (isLava && i === skipZoneIndex) continue; // skip self (only needed when isLava matches)
      const zRight  = zx[i] + zw[i];
      const zBottom = zy[i] + zh[i];
      if (direction === 0 || direction === 1) {
        if (zBottom <= ry + touchEpsilon || zy[i] >= ry + rh - touchEpsilon) continue;
      } else {
        if (zRight <= rx + touchEpsilon || zx[i] >= rx + rw - touchEpsilon) continue;
      }
      switch (direction) {
        case 0: if (Math.abs(zRight - rx) <= touchEpsilon) return true; break;
        case 1: if (Math.abs(zx[i] - (rx + rw)) <= touchEpsilon) return true; break;
        case 2: if (Math.abs(zBottom - ry) <= touchEpsilon) return true; break;
        case 3: if (Math.abs(zy[i] - (ry + rh)) <= touchEpsilon) return true; break;
      }
    }
    return false;
  };

  if (checkZones(world.waterZoneCount, world.waterZoneXWorld, world.waterZoneYWorld, world.waterZoneWWorld, world.waterZoneHWorld)) return true;
  if (checkZones(world.lavaZoneCount, world.lavaZoneXWorld, world.lavaZoneYWorld, world.lavaZoneWWorld, world.lavaZoneHWorld)) return true;

  return false;
}

// ── Rounded-rect + wave path builder ─────────────────────────────────────────

/**
 * Builds a canvas path for a liquid zone rectangle with:
 *  - Rounded corners on exposed (non-blocked) corners.
 *  - A sine-wave displacement on the top edge that tapers to 0 near rounded corners.
 *
 * @param ctx       Canvas context (path not stroked/filled here).
 * @param x         Screen X of zone top-left (pixels).
 * @param y         Screen Y of zone top-left (pixels).
 * @param w         Width in screen pixels.
 * @param h         Height in screen pixels.
 * @param r         Corner arc radius in screen pixels.
 * @param blockedL  Left side blocked?
 * @param blockedR  Right side blocked?
 * @param blockedU  Top blocked?
 * @param blockedD  Bottom blocked?
 * @param tick      Current game tick for wave animation.
 * @param zoneIdx   Zone index for per-zone wave phase offset.
 * @param wAmp      Wave amplitude in screen pixels (0 if blocked top).
 * @param zoom      Current zoom factor.
 */
function buildLiquidPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number,
  blockedL: boolean, blockedR: boolean, blockedU: boolean, blockedD: boolean,
  tick: number, zoneIdx: number, wAmp: number,
): void {
  // Effective radii per corner (zero if both adjacent sides are blocked)
  const rTL = (!blockedL && !blockedU) ? r : 0;
  const rTR = (!blockedR && !blockedU) ? r : 0;
  const rBR = (!blockedR && !blockedD) ? r : 0;
  const rBL = (!blockedL && !blockedD) ? r : 0;

  const phaseX = tick * WAVE_FREQ + zoneIdx * 1.7;
  const phaseX2 = tick * WAVE_FREQ * 0.7 + zoneIdx * 2.9 + 1.2;

  ctx.beginPath();

  // ── Top edge (left → right, with optional wave) ──────────────────────────
  // Start after TL arc end point
  const topY = y;
  const startX = x + rTL;
  ctx.moveTo(startX, topY);

  if (wAmp > 0 && !blockedU) {
    // Stepped polyline with wave amplitude tapering near corners
    const steps = Math.max(2, Math.floor(w / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;                      // 0..1 left→right
      const px = x + t * w;
      const distFromLeft  = t * w;
      const distFromRight = (1 - t) * w;
      const taperFromLeft  = blockedL ? 1 : Math.min(1, distFromLeft  / WAVE_TAPER_WORLD);
      const taperFromRight = blockedR ? 1 : Math.min(1, distFromRight / WAVE_TAPER_WORLD);
      // Also taper where the corner arc exists
      const leftCornerTaper  = Math.min(1, distFromLeft  / (rTL + 1));
      const rightCornerTaper = Math.min(1, distFromRight / (rTR + 1));
      const taper = Math.min(taperFromLeft, taperFromRight, leftCornerTaper, rightCornerTaper);
      const wave  = (Math.sin(phaseX + px * WAVE_SPATIAL_FREQ) * 0.65
                   + Math.sin(phaseX2 + px * WAVE_SPATIAL_FREQ * 0.6) * 0.35)
                   * wAmp * taper;
      ctx.lineTo(px, topY + wave);
    }
  } else {
    ctx.lineTo(x + w - rTR, topY);
  }

  // ── TR corner ────────────────────────────────────────────────────────────
  if (rTR > 0) {
    ctx.arcTo(x + w, topY, x + w, topY + rTR, rTR);
  } else {
    ctx.lineTo(x + w, topY);
  }

  // ── Right edge ───────────────────────────────────────────────────────────
  ctx.lineTo(x + w, y + h - rBR);

  // ── BR corner ────────────────────────────────────────────────────────────
  if (rBR > 0) {
    ctx.arcTo(x + w, y + h, x + w - rBR, y + h, rBR);
  } else {
    ctx.lineTo(x + w, y + h);
  }

  // ── Bottom edge ───────────────────────────────────────────────────────────
  ctx.lineTo(x + rBL, y + h);

  // ── BL corner ────────────────────────────────────────────────────────────
  if (rBL > 0) {
    ctx.arcTo(x, y + h, x, y + h - rBL, rBL);
  } else {
    ctx.lineTo(x, y + h);
  }

  // ── Left edge ─────────────────────────────────────────────────────────────
  ctx.lineTo(x, topY + rTL);

  // ── TL corner ────────────────────────────────────────────────────────────
  if (rTL > 0) {
    ctx.arcTo(x, topY, x + rTL, topY, rTL);
  } else {
    ctx.lineTo(x, topY);
  }

  if (wAmp > 0 && !blockedU) {
    // Ensure we close back at the wave start point (already drawn with lineTo steps)
    ctx.closePath();
  } else {
    ctx.closePath();
  }
}

// ── Spark emitter ─────────────────────────────────────────────────────────────

/**
 * Emits new lava sparks from exposed edges of a lava zone.
 * Each call may add 0–several sparks depending on exposed edge length.
 *
 * NOTE: Math.random() is used deliberately here. Lava sparks are purely
 * cosmetic render-layer particles with no impact on gameplay, collision, or
 * simulation state. They do NOT need deterministic seeding — in fact,
 * non-deterministic randomness here prevents all sparks from firing in sync
 * during replays, which looks more natural. This is an intentional exception
 * to the sim-layer RNG rule (see DECISIONS.md §Randomness).
 */
function emitLavaSparks(
  rx: number, ry: number, rw: number, rh: number,
  blockedL: boolean, blockedR: boolean, blockedU: boolean, blockedD: boolean,
): void {
  const blockW = BLOCK_SIZE_MEDIUM;
  // Collect exposed edges: each unit of edge has SPARK_EMIT_PROB chance
  const emitEdge = (
    isHoriz: boolean,
    edgeOffset: number,
    edgeStart: number,
    edgeLen: number,
    dirSign: 1 | -1,
  ) => {
    // Number of cells along this edge
    const cells = Math.max(1, Math.round(edgeLen / blockW));
    for (let c = 0; c < cells; c++) {
      if (Math.random() > SPARK_EMIT_PROB) continue;
      if (sparks.length >= MAX_SPARKS) return;
      const t = (c + Math.random()) / cells;
      const px = isHoriz ? (edgeStart + t * edgeLen) : edgeOffset;
      const py = isHoriz ? edgeOffset : (edgeStart + t * edgeLen);
      // Velocity: perpendicular outward + random tangential component
      const speed = (0.3 + Math.random() * (SPARK_SPEED_MAX - 0.3));
      const vPerp = dirSign * speed * (0.5 + Math.random() * 0.5);
      const vTang = (Math.random() - 0.5) * speed * 0.6;
      sparks.push({
        xWorld: px,
        yWorld: py,
        vxWorld: isHoriz ? vTang : vPerp,
        vyWorld: isHoriz ? vPerp : vTang,
        ageTicks: 0,
      });
    }
  };

  if (!blockedU) emitEdge(true,  ry,      rx, rw,  -1); // top — emit upward
  if (!blockedD) emitEdge(true,  ry + rh, rx, rw,   1); // bottom — emit downward
  if (!blockedL) emitEdge(false, rx,      ry, rh,  -1); // left — emit leftward
  if (!blockedR) emitEdge(false, rx + rw, ry, rh,   1); // right — emit rightward
}

// ── Main render functions ─────────────────────────────────────────────────────

/**
 * Renders all water zones with neighbor-aware rounded corners and wave edges.
 */
export function renderWaterZones(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  const r = CORNER_RADIUS_WORLD * zoom;

  for (let i = 0; i < world.waterZoneCount; i++) {
    const rxW = world.waterZoneXWorld[i];
    const ryW = world.waterZoneYWorld[i];
    const rwW = world.waterZoneWWorld[i];
    const rhW = world.waterZoneHWorld[i];

    const x = rxW * zoom + offsetXPx;
    const y = ryW * zoom + offsetYPx;
    const w = rwW * zoom;
    const h = rhW * zoom;

    // Neighbour checks
    const bL = isSideBlocked(rxW, ryW, rwW, rhW, 0, world, i, false);
    const bR = isSideBlocked(rxW, ryW, rwW, rhW, 1, world, i, false);
    const bU = isSideBlocked(rxW, ryW, rwW, rhW, 2, world, i, false);
    const bD = isSideBlocked(rxW, ryW, rwW, rhW, 3, world, i, false);

    const wAmp = bU ? 0 : WAVE_AMPLITUDE_WORLD * zoom;

    // ── Body fill ─────────────────────────────────────────────────────────
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0.0, 'rgba(100,190,255,0.35)');
    grad.addColorStop(0.4, 'rgba(40,120,220,0.45)');
    grad.addColorStop(1.0, 'rgba(10,60,160,0.60)');
    ctx.fillStyle = grad;
    buildLiquidPath(ctx, x, y, w, h, r, bL, bR, bU, bD, tick, i, wAmp);
    ctx.fill();

    // ── Caustic dots ─────────────────────────────────────────────────────
    const causticSeed = tick * 0.04 + i * 17.3;
    ctx.fillStyle = 'rgba(160,220,255,0.18)';
    for (let c = 0; c < 6; c++) {
      const cx2 = x + ((Math.sin(causticSeed + c * 2.3) * 0.5 + 0.5)) * w;
      const cy2 = y + 3 * zoom + ((Math.cos(causticSeed * 0.7 + c * 1.9) * 0.5 + 0.5)) * (h * 0.6);
      const cr = (0.6 + Math.sin(causticSeed + c) * 0.4) * zoom;
      ctx.fillRect(cx2 - cr, cy2 - cr, cr * 2, cr * 2);
    }

    // ── Foam line on exposed top surface ─────────────────────────────────
    if (!bU) {
      const phaseX = tick * WAVE_FREQ + i * 1.7;
      const phaseX2 = tick * WAVE_FREQ * 0.7 + i * 2.9 + 1.2;
      ctx.strokeStyle = 'rgba(200,240,255,0.55)';
      ctx.lineWidth = zoom * 0.8;
      ctx.beginPath();
      const steps = Math.max(2, Math.floor(w / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = x + t * w;
        const distL = Math.min(1, (t * w) / WAVE_TAPER_WORLD);
        const distR = Math.min(1, ((1 - t) * w) / WAVE_TAPER_WORLD);
        const cTL = Math.min(1, (t * w) / (r + 1));
        const cTR = Math.min(1, ((1 - t) * w) / (r + 1));
        const taper = Math.min(distL, distR, cTL, cTR);
        const wave = (Math.sin(phaseX + px * WAVE_SPATIAL_FREQ) * 0.65
                    + Math.sin(phaseX2 + px * WAVE_SPATIAL_FREQ * 0.6) * 0.35)
                   * wAmp * taper;
        if (s === 0) ctx.moveTo(px, y + wave);
        else ctx.lineTo(px, y + wave);
      }
      ctx.stroke();

      // Secondary sub-surface wave
      ctx.strokeStyle = 'rgba(80,160,255,0.30)';
      ctx.lineWidth = zoom * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + r, y + 2 * zoom);
      ctx.lineTo(x + w - r, y + 2 * zoom);
      ctx.stroke();
    }
  }
}

/**
 * Renders all lava zones with neighbor-aware rounded corners, wave edges,
 * hot-spot dots, and spark particles.
 */
export function renderLavaZones(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  const r = CORNER_RADIUS_WORLD * zoom;

  // Tick sparks forward before drawing this frame
  tickLavaSparks(tick);

  for (let i = 0; i < world.lavaZoneCount; i++) {
    const rxW = world.lavaZoneXWorld[i];
    const ryW = world.lavaZoneYWorld[i];
    const rwW = world.lavaZoneWWorld[i];
    const rhW = world.lavaZoneHWorld[i];

    const x = rxW * zoom + offsetXPx;
    const y = ryW * zoom + offsetYPx;
    const w = rwW * zoom;
    const h = rhW * zoom;

    // Neighbour checks
    const bL = isSideBlocked(rxW, ryW, rwW, rhW, 0, world, i, true);
    const bR = isSideBlocked(rxW, ryW, rwW, rhW, 1, world, i, true);
    const bU = isSideBlocked(rxW, ryW, rwW, rhW, 2, world, i, true);
    const bD = isSideBlocked(rxW, ryW, rwW, rhW, 3, world, i, true);

    const wAmp = bU ? 0 : WAVE_AMPLITUDE_WORLD * zoom * 0.7;

    // ── Body fill ─────────────────────────────────────────────────────────
    const pulse = 0.30 + Math.sin(tick * 0.06 + i * 2.1) * 0.08;
    const lavaGrad = ctx.createLinearGradient(0, y, 0, y + h);
    lavaGrad.addColorStop(0.0, `rgba(255,120,20,${pulse})`);
    lavaGrad.addColorStop(0.5, `rgba(220,50,5,${(pulse * 0.9).toFixed(2)})`);
    lavaGrad.addColorStop(1.0, `rgba(140,20,0,${(pulse * 1.2).toFixed(2)})`);
    ctx.fillStyle = lavaGrad;
    buildLiquidPath(ctx, x, y, w, h, r, bL, bR, bU, bD, tick, i, wAmp);
    ctx.fill();

    // ── Hot-spot dots ─────────────────────────────────────────────────────
    const hotSeed = tick * 0.03 + i * 11.7;
    for (let d = 0; d < 5; d++) {
      const dotX = x + ((Math.sin(hotSeed * 0.8 + d * 3.1) * 0.5 + 0.5)) * w;
      const rawY2 = ((hotSeed * 0.4 + d * 0.7) % 1.0);
      const dotY = y + h - rawY2 * h * 1.2;
      if (dotY < y) continue;
      const dotR = (0.8 + Math.sin(hotSeed + d * 2.7) * 0.4) * zoom;
      const dotAlpha = 0.25 + Math.sin(hotSeed * 1.3 + d) * 0.12;
      ctx.fillStyle = `rgba(255,160,40,${dotAlpha.toFixed(2)})`;
      ctx.fillRect(dotX - dotR, dotY - dotR, dotR * 2, dotR * 2);
    }

    // ── Surface shimmer on exposed top ────────────────────────────────────
    if (!bU) {
      const phaseX  = tick * 0.10 + i * 3.0;
      const phaseX2 = tick * 0.07 + i * 1.4 + 1.8;
      ctx.strokeStyle = 'rgba(255,160,30,0.65)';
      ctx.lineWidth = zoom * 0.9;
      ctx.beginPath();
      const steps = Math.max(2, Math.floor(w / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = x + t * w;
        const distL = Math.min(1, (t * w) / WAVE_TAPER_WORLD);
        const distR = Math.min(1, ((1 - t) * w) / WAVE_TAPER_WORLD);
        const taper = Math.min(distL, distR);
        const shimY = (Math.sin(phaseX + t * 4.0) * 1.2 + Math.sin(phaseX2 + t * 2.5) * 0.6)
                    * zoom * taper;
        if (s === 0) ctx.moveTo(px, y + shimY);
        else ctx.lineTo(px, y + shimY);
      }
      ctx.stroke();

      // Crust line
      ctx.strokeStyle = 'rgba(200,60,0,0.40)';
      ctx.lineWidth = zoom * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + r, y + 2 * zoom);
      ctx.lineTo(x + w - r, y + 2 * zoom);
      ctx.stroke();
    }

    // ── Emit sparks from exposed edges ───────────────────────────────────
    emitLavaSparks(rxW, ryW, rwW, rhW, bL, bR, bU, bD);
  }

  // ── Draw all active sparks ─────────────────────────────────────────────
  drawLavaSparks(ctx, offsetXPx, offsetYPx, zoom);
}

// ── Spark tick + draw ─────────────────────────────────────────────────────────

function tickLavaSparks(_tick: number): void {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.ageTicks += 1;
    if (s.ageTicks >= SPARK_LIFETIME_TICKS) {
      // Recycle: swap-remove
      sparks[i] = sparks[sparks.length - 1];
      sparks.pop();
      continue;
    }
    s.xWorld += s.vxWorld;
    s.yWorld += s.vyWorld;
    s.vyWorld += SPARK_GRAVITY; // gravity pulls sparks down
    // Slight drag
    s.vxWorld *= 0.97;
  }
}

function drawLavaSparks(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const s of sparks) {
    const life = 1 - s.ageTicks / SPARK_LIFETIME_TICKS; // 1→0
    // Colour: bright yellow-white when fresh, fading to red when old
    const r = 255;
    const g = Math.round(life * life * 200 + 30);
    const b = Math.round(life * life * 100);
    const alpha = life * 0.9;
    const sz = (0.8 + life * 1.2) * zoom; // shrinks as spark ages

    const px = s.xWorld * zoom + offsetXPx;
    const py = s.yWorld * zoom + offsetYPx;

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);

    // Glow halo
    if (life > 0.4) {
      const glowAlpha = life * 0.25;
      ctx.fillStyle = `rgba(255,${g},${b},${glowAlpha.toFixed(2)})`;
      ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
    }
  }
}
