/**
 * Dust Weaver Architect — rendering.
 *
 * The Architect is a dust-core hovering enemy.  It renders as:
 *   • A central glowing core that pulses when building.
 *   • Several orbiting dust motes whose angles are tracked in dwaMoteAngleRad[].
 *   • During Telegraph state: motes stretch toward the build site and a faint
 *     block outline flickers at the target positions.
 *   • Architect Blocks: dusty block shapes with cracks/seams that crumble visually.
 *
 * All rendering targets the virtual (low-res) canvas.  Pixel-snap critical edges.
 */

import type { WorldSnapshot } from '../snapshot';
import {
  DWA_STATE_TELEGRAPH,
  DWA_STATE_BUILD,
  DWA_STATE_DYING,
  DWA_BLOCK_STATE_FORMING,
  DWA_BLOCK_STATE_CRUMBLE,
} from '../../sim/clusters/dustWeaverArchitectAi';
import {
  DWA_SMALL_MOTE_COUNT,
  DWA_LARGE_MOTE_COUNT,
  DWA_HALF_W,
  DWA_MOTE_ORBIT_RADIUS_WORLD,
  DWA_BOB_AMPLITUDE_WORLD,
  DWA_TELEGRAPH_DURATION_TICKS,
  DWA_BUILD_DURATION_TICKS,
  DWA_DEATH_DURATION_TICKS,
  DWA_BLOCK_HALF_W,
  DWA_BLOCK_HALF_H,
  DWA_BLOCK_CRUMBLE_TICKS,
  DWA_ACTIVATION_RANGE_WORLD,
  DWA_LEASH_RADIUS_WORLD,
  DWA_PATTERNS,
  MAX_MOTES_PER_DWA,
  DWA_HIT_FLASH_TICKS,
} from '../../sim/clusters/dustWeaverArchitectConfig';
import { MAX_DUST_WEAVER_ARCHITECTS, MAX_ARCHITECT_BLOCKS } from '../../sim/world';

// ── Colour palette ─────────────────────────────────────────────────────────────
const CORE_CENTER        = '#d8c8f8';
const CORE_INNER         = '#8060d0';
const CORE_GLOW          = 'rgba(180,120,255,0.35)';
const CORE_PULSE_GLOW    = 'rgba(220,160,255,0.55)';
const MOTE_COLOR         = '#c0a0e8';
const MOTE_GLOW          = 'rgba(180,120,240,0.28)';
const MOTE_STRETCH_COLOR = '#e8d0ff';
const BLOCK_FILL         = '#483c5c';
const BLOCK_EDGE_DARK    = '#2a2038';
const BLOCK_EDGE_LIGHT   = '#7060a0';
const BLOCK_SEAM         = 'rgba(180,120,255,0.40)';
const BLOCK_CRACK        = 'rgba(220,160,255,0.60)';
const BLOCK_DAMAGED_GLOW = 'rgba(255,100,80,0.30)';
const BLOCK_CRUMBLE_GLOW = 'rgba(200,100,60,0.40)';
const CORE_HIT_FLASH     = 'rgba(255,230,255,'; // alpha suffix appended at runtime
const NAIL_HEAD          = '#f0e0ff';
const NAIL_GLOW          = 'rgba(220,160,255,0.55)';
const DBG_RANGE_COLOR    = 'rgba(160,100,240,0.08)';
const DBG_LEASH_COLOR    = 'rgba(120,80,200,0.15)';
const DBG_TEXT_COLOR     = 'rgba(220,180,255,0.9)';
const DBG_BLOCK_BOX      = 'rgba(255,200,100,0.45)';

// ── Helpers ───────────────────────────────────────────────────────────────────

function _sx(wx: number, ox: number, scale: number): number {
  return Math.round((wx - ox) * scale);
}
function _sy(wy: number, oy: number, scale: number): number {
  return Math.round((wy - oy) * scale);
}
function _sw(ww: number, scale: number): number {
  return Math.max(1, Math.round(ww * scale));
}

function _moteCount(isLarge: 0 | 1): number {
  return isLarge === 1 ? DWA_LARGE_MOTE_COUNT : DWA_SMALL_MOTE_COUNT;
}

// ── Core ───────────────────────────────────────────────────────────────────────

function _drawCore(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, scale: number,
  isPulsing: boolean,
  isDying: boolean,
  dyingT: number,
  hitFlashT: number,  // 0–1; 1 = just hit, decays toward 0
): void {
  const r  = Math.max(1, Math.round(DWA_HALF_W * 0.45 * scale));
  const r2 = Math.max(1, Math.round(DWA_HALF_W * 0.22 * scale));

  if (isDying) {
    // Shrink core during death.
    const shrink = Math.max(0.05, 1 - dyingT);
    const dr = Math.round(r * shrink);
    const dr2 = Math.round(r2 * shrink);
    ctx.fillStyle = CORE_GLOW;
    ctx.beginPath();
    ctx.arc(sx, sy, dr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CORE_INNER;
    ctx.beginPath();
    ctx.arc(sx, sy, dr2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Outer glow.
  ctx.fillStyle = isPulsing ? CORE_PULSE_GLOW : CORE_GLOW;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();

  // Inner core dot.
  ctx.fillStyle = CORE_INNER;
  ctx.beginPath();
  ctx.arc(sx, sy, r2, 0, Math.PI * 2);
  ctx.fill();

  // Bright centre pixel.
  ctx.fillStyle = CORE_CENTER;
  ctx.fillRect(sx - 1, sy - 1, 2, 2);

  // Hit flash overlay — a brief bright pulse over the entire core.
  // hitFlashT decays from 1→0 over DWA_HIT_FLASH_TICKS ticks.
  if (hitFlashT > 0) {
    const alpha = hitFlashT * 0.75;
    const fr    = Math.round(r * (1 + hitFlashT * 0.35));  // slightly expanded ring
    ctx.fillStyle = `${CORE_HIT_FLASH}${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, fr, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Motes ──────────────────────────────────────────────────────────────────────

function _drawMotes(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  slot: number,
  moteCount: number,
  sx: number, sy: number,
  scale: number,
  buildSiteScreenX: number, buildSiteScreenY: number,
  stretchT: number,  // 0=orbit, 1=fully stretched toward build site
): void {
  const base = slot * MAX_MOTES_PER_DWA;
  for (let m = 0; m < moteCount; m++) {
    const mi = base + m;
    const angle = snapshot.dwaMoteAngleRad[mi];
    const pulse = snapshot.dwaMotePulsePhaseRad[mi];
    const baseOrbitR = DWA_MOTE_ORBIT_RADIUS_WORLD * scale;
    const orbitR = baseOrbitR + Math.sin(pulse) * 1.5;

    // Base orbit position.
    const orbitX = sx + Math.cos(angle) * orbitR;
    const orbitY = sy + Math.sin(angle) * orbitR;

    // During telegraph: stretch motes toward build site.
    const mx = orbitX + (buildSiteScreenX - orbitX) * stretchT * 0.6;
    const my = orbitY + (buildSiteScreenY - orbitY) * stretchT * 0.6;

    // Glow.
    ctx.fillStyle = stretchT > 0 ? 'rgba(220,160,255,0.22)' : MOTE_GLOW;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(2, 2.5 * scale), 0, Math.PI * 2);
    ctx.fill();

    // Core dot.
    ctx.fillStyle = stretchT > 0.5 ? MOTE_STRETCH_COLOR : MOTE_COLOR;
    ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2);
  }

  // Dust trail lines during telegraph.
  if (stretchT > 0.2) {
    ctx.strokeStyle = `rgba(180,120,255,${(stretchT * 0.4).toFixed(2)})`;
    ctx.lineWidth   = 1;
    for (let m = 0; m < moteCount; m++) {
      const mi = base + m;
      const angle = snapshot.dwaMoteAngleRad[mi];
      const orbitX = sx + Math.cos(angle) * DWA_MOTE_ORBIT_RADIUS_WORLD * scale;
      const orbitY = sy + Math.sin(angle) * DWA_MOTE_ORBIT_RADIUS_WORLD * scale;
      ctx.beginPath();
      ctx.moveTo(Math.round(orbitX), Math.round(orbitY));
      ctx.lineTo(Math.round(buildSiteScreenX), Math.round(buildSiteScreenY));
      ctx.stroke();
    }
  }
}

// ── Telegraph outline ─────────────────────────────────────────────────────────

function _drawTelegraphOutline(
  ctx: CanvasRenderingContext2D,
  bsX: number, bsY: number,
  patternIdx: number,
  ox: number, oy: number, scale: number,
  alpha: number,
): void {
  const pattern = DWA_PATTERNS[patternIdx] ?? DWA_PATTERNS[0];
  const bw = Math.max(1, Math.round(DWA_BLOCK_HALF_W * 2 * scale));
  const bh = Math.max(1, Math.round(DWA_BLOCK_HALF_H * 2 * scale));
  ctx.strokeStyle = `rgba(200,160,255,${(alpha * 0.65).toFixed(2)})`;
  ctx.fillStyle   = `rgba(140,80,220,${(alpha * 0.12).toFixed(2)})`;
  ctx.lineWidth   = 1;
  for (const [dxBlocks, dyBlocks] of pattern) {
    const blockCX = bsX + dxBlocks * (DWA_BLOCK_HALF_W * 2);
    const blockCY = bsY + dyBlocks * (DWA_BLOCK_HALF_H * 2);
    const bsx = _sx(blockCX - DWA_BLOCK_HALF_W, ox, scale);
    const bsy = _sy(blockCY - DWA_BLOCK_HALF_H, oy, scale);
    ctx.fillRect(bsx, bsy, bw, bh);
    ctx.strokeRect(bsx + 0.5, bsy + 0.5, bw - 1, bh - 1);
  }
}

// ── Architect Block ───────────────────────────────────────────────────────────

function _drawArchitectBlock(
  ctx: CanvasRenderingContext2D,
  bi: number,
  snapshot: WorldSnapshot,
  ox: number, oy: number, scale: number,
): void {
  const bx   = snapshot.architectBlockXWorld[bi];
  const by   = snapshot.architectBlockYWorld[bi];
  const bst  = snapshot.architectBlockState[bi];
  const hp   = snapshot.architectBlockHealth[bi];
  const maxHp = snapshot.architectBlockMaxHealth[bi];
  const hpT  = maxHp > 0 ? hp / maxHp : 1;
  const formT  = snapshot.architectBlockFormTicks[bi];
  const crumbleT = snapshot.architectBlockCrumbleTicks[bi];

  const bsx = _sx(bx - DWA_BLOCK_HALF_W, ox, scale);
  const bsy = _sy(by - DWA_BLOCK_HALF_H, oy, scale);
  const bw  = _sw(DWA_BLOCK_HALF_W * 2, scale);
  const bh  = _sw(DWA_BLOCK_HALF_H * 2, scale);

  if (bst === DWA_BLOCK_STATE_FORMING) {
    // Fade in from dust.
    const maxFormT = 12; // approximate - actual DWA_BLOCK_FORM_TICKS
    const formProgress = Math.max(0, 1 - formT / maxFormT);
    ctx.globalAlpha = Math.min(1, formProgress);
    ctx.fillStyle = BLOCK_FILL;
    ctx.fillRect(bsx, bsy, bw, bh);
    ctx.strokeStyle = BLOCK_SEAM;
    ctx.lineWidth = 1;
    ctx.strokeRect(bsx + 0.5, bsy + 0.5, bw - 1, bh - 1);
    ctx.globalAlpha = 1;
    return;
  }

  if (bst === DWA_BLOCK_STATE_CRUMBLE) {
    // Fade out with crumble.
    const crumbleProgress = crumbleT / DWA_BLOCK_CRUMBLE_TICKS;
    ctx.globalAlpha = Math.max(0, crumbleProgress * 0.9);
    ctx.fillStyle = BLOCK_FILL;
    ctx.fillRect(bsx, bsy, bw, bh);
    // Damaged look during crumble.
    ctx.strokeStyle = BLOCK_CRACK;
    ctx.lineWidth = 1;
    ctx.strokeRect(bsx + 0.5, bsy + 0.5, bw - 1, bh - 1);
    if (scale >= 1) {
      ctx.fillStyle = BLOCK_CRUMBLE_GLOW;
      ctx.fillRect(bsx, bsy, bw, bh);
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Active block.
  // Base fill.
  ctx.fillStyle = BLOCK_FILL;
  ctx.fillRect(bsx, bsy, bw, bh);

  // Dark edge (bottom + right).
  ctx.fillStyle = BLOCK_EDGE_DARK;
  ctx.fillRect(bsx, bsy + bh - 1, bw, 1);
  ctx.fillRect(bsx + bw - 1, bsy, 1, bh);

  // Light edge (top + left).
  ctx.fillStyle = BLOCK_EDGE_LIGHT;
  ctx.fillRect(bsx, bsy, bw, 1);
  ctx.fillRect(bsx, bsy, 1, bh);

  // Glowing seam in the middle.
  if (scale >= 1) {
    ctx.strokeStyle = BLOCK_SEAM;
    ctx.lineWidth = 1;
    ctx.strokeRect(bsx + 1.5, bsy + 1.5, bw - 3, bh - 3);
  }

  // Cracks based on HP.
  if (hpT < 0.7) {
    ctx.strokeStyle = BLOCK_CRACK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Diagonal crack.
    ctx.moveTo(bsx + Math.round(bw * 0.3), bsy + Math.round(bh * 0.1));
    ctx.lineTo(bsx + Math.round(bw * 0.6), bsy + Math.round(bh * 0.5));
    ctx.stroke();
  }
  if (hpT < 0.35) {
    ctx.strokeStyle = BLOCK_CRACK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bsx + Math.round(bw * 0.6), bsy + Math.round(bh * 0.4));
    ctx.lineTo(bsx + Math.round(bw * 0.2), bsy + Math.round(bh * 0.8));
    ctx.stroke();
    // Damage glow overlay.
    ctx.fillStyle = BLOCK_DAMAGED_GLOW;
    ctx.fillRect(bsx, bsy, bw, bh);
  }
}

// ── Per-Architect render ──────────────────────────────────────────────────────

function _renderArchitect(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  ci: number,
  ox: number, oy: number, scale: number,
  isDebugMode: boolean,
): void {
  const cluster = snapshot.clusters[ci];
  const slot    = cluster.dustWeaverArchitectSlotIndex;
  if (slot < 0 || slot >= MAX_DUST_WEAVER_ARCHITECTS) return;

  const isLarge   = cluster.isDustWeaverArchitectLargeFlag;
  const moteCount = _moteCount(isLarge);
  const state     = cluster.dustWeaverArchitectState;
  const stTicks   = cluster.dustWeaverArchitectStateTicks;
  const bobPhase  = cluster.dustWeaverArchitectBobPhaseRad;

  // Visual bob offset (renderer-side only).
  const bobOffset = Math.sin(bobPhase) * DWA_BOB_AMPLITUDE_WORLD * scale;

  const worldX = cluster.positionXWorld;
  const worldY = cluster.positionYWorld;
  const centerSX = _sx(worldX, ox, scale);
  const centerSY = _sy(worldY, oy, scale) + Math.round(bobOffset);

  // Build-site screen coords for telegraph.
  const bsX = cluster.dustWeaverArchitectBuildSiteXWorld;
  const bsY = cluster.dustWeaverArchitectBuildSiteYWorld;
  const buildSiteSX = _sx(bsX, ox, scale);
  const buildSiteSY = _sy(bsY, oy, scale);

  // Telegraph / stretch factor.
  let stretchT = 0;
  let telegraphAlpha = 0;
  if (state === DWA_STATE_TELEGRAPH) {
    stretchT = Math.min(1, stTicks / DWA_TELEGRAPH_DURATION_TICKS);
    telegraphAlpha = stretchT;
  } else if (state === DWA_STATE_BUILD) {
    stretchT = Math.max(0, 1 - stTicks / DWA_BUILD_DURATION_TICKS);
    telegraphAlpha = 0;
  }

  // Death state.
  const isDying = state === DWA_STATE_DYING;
  const dyingT  = isDying
    ? Math.min(1, stTicks / Math.max(1, DWA_DEATH_DURATION_TICKS))
    : 0;

  // Telegraph outline at build site.
  if (telegraphAlpha > 0) {
    _drawTelegraphOutline(
      ctx, bsX, bsY, cluster.dustWeaverArchitectBuildPatternIndex,
      ox, oy, scale, telegraphAlpha,
    );
  }

  // Motes.
  _drawMotes(
    ctx, snapshot, slot, moteCount,
    centerSX, centerSY, scale,
    buildSiteSX, buildSiteSY, stretchT,
  );

  // Core.
  const isPulsing = state === DWA_STATE_BUILD || state === DWA_STATE_TELEGRAPH;
  const hitFlashT = cluster.dustWeaverArchitectHitFlashTicks / DWA_HIT_FLASH_TICKS;
  _drawCore(ctx, centerSX, centerSY, scale, isPulsing, isDying, dyingT, hitFlashT);

  // Debug overlay.
  if (isDebugMode) {
    ctx.save();
    // Activation range.
    ctx.strokeStyle = DBG_RANGE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(_sx(worldX, ox, scale), _sy(worldY, oy, scale), DWA_ACTIVATION_RANGE_WORLD * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Leash radius.
    ctx.strokeStyle = DBG_LEASH_COLOR;
    ctx.beginPath();
    ctx.arc(
      _sx(cluster.dustWeaverArchitectSpawnXWorld, ox, scale),
      _sy(cluster.dustWeaverArchitectSpawnYWorld, oy, scale),
      DWA_LEASH_RADIUS_WORLD * scale, 0, Math.PI * 2,
    );
    ctx.stroke();

    // Build site cross.
    if (state === DWA_STATE_TELEGRAPH || state === DWA_STATE_BUILD) {
      ctx.strokeStyle = 'rgba(255,200,100,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(buildSiteSX - 4, buildSiteSY);
      ctx.lineTo(buildSiteSX + 4, buildSiteSY);
      ctx.moveTo(buildSiteSX, buildSiteSY - 4);
      ctx.lineTo(buildSiteSX, buildSiteSY + 4);
      ctx.stroke();
    }

    // State label and nail/pressure info.
    const stateNames = ['idle','telegraph','build','recover','dying'];
    ctx.fillStyle = DBG_TEXT_COLOR;
    ctx.font = '8px monospace';
    ctx.fillText(
      `DWA[${slot}] ${stateNames[state] ?? state} t=${stTicks}`,
      centerSX + 6, centerSY - 14,
    );
    // Owned block count.
    let ownedBlocks = 0;
    for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
      if (snapshot.isArchitectBlockAliveFlag[bi] === 1 && snapshot.architectBlockOwnerSlot[bi] === slot) {
        ownedBlocks++;
      }
    }
    ctx.fillText(
      `blks=${ownedBlocks} nail_cd=${cluster.dustWeaverArchitectNailCooldownTicks} rng_p=${cluster.dustWeaverArchitectRangePressureTicks}`,
      centerSX + 6, centerSY - 5,
    );
    ctx.restore();
  }
}

// ── Dust Nail rendering ────────────────────────────────────────────────────────

function _drawDustNails(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  ox: number, oy: number, scale: number,
  isDebugMode: boolean,
): void {
  const total = snapshot.isDwaNailAliveFlag.length;
  for (let idx = 0; idx < total; idx++) {
    if (snapshot.isDwaNailAliveFlag[idx] === 0) continue;
    const nx = _sx(snapshot.dwaNailXWorld[idx], ox, scale);
    const ny = _sy(snapshot.dwaNailYWorld[idx], oy, scale);

    // Glow halo.
    ctx.fillStyle = NAIL_GLOW;
    ctx.beginPath();
    ctx.arc(nx, ny, 3, 0, Math.PI * 2);
    ctx.fill();

    // Nail head (bright 2×2 pixel dot).
    ctx.fillStyle = NAIL_HEAD;
    ctx.fillRect(nx - 1, ny - 1, 2, 2);

    if (isDebugMode) {
      ctx.strokeStyle = 'rgba(255,160,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(nx, ny, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderDustWeaverArchitects(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
  isDebugMode: boolean,
): void {
  // Draw Architect Bodies.
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isDustWeaverArchitectFlag !== 1) continue;
    if (cluster.isAliveFlag === 0 && cluster.dustWeaverArchitectState !== DWA_STATE_DYING) continue;
    _renderArchitect(ctx, snapshot, ci, ox, oy, scale, isDebugMode);
  }

  // Draw all active Architect Blocks.
  for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
    if (snapshot.isArchitectBlockAliveFlag[bi] === 0) continue;
    _drawArchitectBlock(ctx, bi, snapshot, ox, oy, scale);
  }

  // Draw Dust Nail projectiles.
  _drawDustNails(ctx, snapshot, ox, oy, scale, isDebugMode);

  // Debug block hitboxes and global count.
  if (isDebugMode) {
    let globalBlockCount = 0;
    for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
      if (snapshot.isArchitectBlockAliveFlag[bi] === 0) continue;
      globalBlockCount++;
      const bx = snapshot.architectBlockXWorld[bi];
      const by = snapshot.architectBlockYWorld[bi];
      const bsx = _sx(bx - DWA_BLOCK_HALF_W, ox, scale);
      const bsy = _sy(by - DWA_BLOCK_HALF_H, oy, scale);
      const bw  = _sw(DWA_BLOCK_HALF_W * 2, scale);
      const bh  = _sw(DWA_BLOCK_HALF_H * 2, scale);
      ctx.strokeStyle = DBG_BLOCK_BOX;
      ctx.lineWidth = 1;
      ctx.strokeRect(bsx + 0.5, bsy + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = DBG_TEXT_COLOR;
      ctx.font = '7px monospace';
      const lifeT = snapshot.architectBlockLifetimeTicks[bi];
      ctx.fillText(
        `hp=${snapshot.architectBlockHealth[bi]} lt=${lifeT} own=${snapshot.architectBlockOwnerSlot[bi]}`,
        bsx, bsy - 1,
      );
    }
    // Global block count HUD line (top-left of viewport area).
    ctx.fillStyle = DBG_TEXT_COLOR;
    ctx.font = '8px monospace';
    ctx.fillText(`DWA global blocks: ${globalBlockCount}/${MAX_ARCHITECT_BLOCKS}`, 2, 10);
    // Active nail count.
    let nailCount = 0;
    for (let idx = 0; idx < snapshot.isDwaNailAliveFlag.length; idx++) {
      if (snapshot.isDwaNailAliveFlag[idx] === 1) nailCount++;
    }
    if (nailCount > 0) {
      ctx.fillText(`DWA nails: ${nailCount}`, 2, 20);
    }
  }
}
