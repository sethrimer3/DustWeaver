/**
 * Dust Block Mimic — rendering.
 *
 * Dormant state renders as a block-like rectangle with crack lines and subtle
 * dust leak dots.  Active states render pixel-locked mote positions read from
 * the world snapshot arrays.  All rendering targets the virtual (low-res) canvas.
 */

import type { WorldSnapshot } from '../snapshot';
import {
  DBM_STATE_DORMANT,
  DBM_STATE_WAKE,
  DBM_STATE_BURST,
  DBM_STATE_TELEGRAPH,
  DBM_STATE_ATTACK,
  DBM_STATE_DYING,
} from '../../sim/clusters/dustBlockMimicAi';
import {
  DBM_SMALL_BLOCK_HALF_W,
  DBM_SMALL_BLOCK_HALF_H,
  DBM_LARGE_BLOCK_HALF_W,
  DBM_LARGE_BLOCK_HALF_H,
  DBM_SMALL_MOTE_COUNT,
  DBM_LARGE_MOTE_COUNT,
  DBM_ACTIVE_HITBOX_RADIUS,
  DBM_ACTIVATION_RANGE_WORLD,
  DBM_WAKE_DURATION_TICKS,
  DBM_DEATH_DURATION_TICKS,
  DBM_SHARD_RUSH_HIT_HALF_W,
  DBM_SHARD_RUSH_HIT_HALF_H,
  MAX_MOTES_PER_DBM,
} from '../../sim/clusters/dustBlockMimicConfig';
import { MAX_DUST_BLOCK_MIMICS } from '../../sim/world';

// ── Colour palette ────────────────────────────────────────────────────────────
const BLOCK_FILL          = '#504840';     // neutral dust-stone
const BLOCK_EDGE_DARK     = '#302820';
const BLOCK_EDGE_LIGHT    = '#706050';
const CRACK_DORMANT       = 'rgba(100,80,60,0.55)';
const CRACK_WAKE          = 'rgba(220,180,80,0.85)';
const LEAK_COLOR          = 'rgba(170,140,90,0.45)';
const MOTE_CORE           = '#d0b878';
const MOTE_GLOW           = 'rgba(210,170,80,0.30)';
const MOTE_ATTACK         = '#f0c840';
const MOTE_ATTACK_GLOW    = 'rgba(255,200,60,0.40)';
const MOTE_HIT_FLASH      = '#ffffff';
const SWARM_CORE_COLOR    = 'rgba(210,160,60,0.75)';
const SWARM_CORE_GLOW     = 'rgba(200,140,40,0.28)';
const DBG_RANGE_COLOR     = 'rgba(200,160,80,0.10)';
const DBG_BOX_COLOR       = 'rgba(200,120,60,0.50)';
const DBG_TEXT_COLOR      = 'rgba(240,210,140,0.9)';

const STATE_NAMES = ['dormant','wake','burst','active','telegraph','attack','recover','dying'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function _halfW(isLarge: 0 | 1): number {
  return isLarge === 1 ? DBM_LARGE_BLOCK_HALF_W : DBM_SMALL_BLOCK_HALF_W;
}

function _halfH(isLarge: 0 | 1): number {
  return isLarge === 1 ? DBM_LARGE_BLOCK_HALF_H : DBM_SMALL_BLOCK_HALF_H;
}

function _moteCount(isLarge: 0 | 1): number {
  return isLarge === 1 ? DBM_LARGE_MOTE_COUNT : DBM_SMALL_MOTE_COUNT;
}

/** Convert world → screen coordinates. */
function _sx(wx: number, ox: number, scale: number): number {
  return Math.round((wx - ox) * scale);
}
function _sy(wy: number, oy: number, scale: number): number {
  return Math.round((wy - oy) * scale);
}

/** Draw a simple bevelled block face. */
function _drawBlock(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, sw: number, sh: number,
  fillColor: string,
): void {
  ctx.fillStyle = fillColor;
  ctx.fillRect(sx, sy, sw, sh);
  // Dark bottom/right edges
  ctx.fillStyle = BLOCK_EDGE_DARK;
  ctx.fillRect(sx, sy + sh - 1, sw, 1);
  ctx.fillRect(sx + sw - 1, sy, 1, sh);
  // Light top/left edges
  ctx.fillStyle = BLOCK_EDGE_LIGHT;
  ctx.fillRect(sx, sy, sw, 1);
  ctx.fillRect(sx, sy, 1, sh);
}

/** Draw crack lines across the block face. */
function _drawCracks(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, sw: number, sh: number,
  color: string,
  seed: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // 3 deterministic cracks derived from seed
  for (let i = 0; i < 3; i++) {
    const h1 = Math.imul(seed + i * 1234, 0x9e3779b9) >>> 0;
    const h2 = Math.imul(h1 + 0xdeadbeef, 0x85ebca6b) >>> 0;
    const h3 = Math.imul(h2 + 0x12345678, 0xc2b2ae35) >>> 0;
    const x0 = sx + (h1 % sw);
    const y0 = sy + (h2 % sh);
    const x1 = sx + (h3 % sw);
    const y1 = sy + ((h1 ^ h3) % sh);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

/** Draw tiny leaking dust motes around block edges. */
function _drawDustLeaks(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, sw: number, sh: number,
  tick: number,
  seed: number,
): void {
  ctx.fillStyle = LEAK_COLOR;
  for (let i = 0; i < 5; i++) {
    const h = Math.imul(seed + i * 7919 + tick * 31, 0x9e3779b9) >>> 0;
    const edge = h % 4;
    let ex: number;
    let ey: number;
    if (edge === 0) { ex = sx + (h >>> 2) % sw; ey = sy - 1; }
    else if (edge === 1) { ex = sx + (h >>> 2) % sw; ey = sy + sh; }
    else if (edge === 2) { ex = sx - 1; ey = sy + (h >>> 2) % sh; }
    else               { ex = sx + sw; ey = sy + (h >>> 2) % sh; }
    const alpha = (Math.sin((tick * 0.2 + i * 1.3) % (Math.PI * 2)) * 0.3 + 0.5) * 0.6;
    ctx.globalAlpha = alpha;
    ctx.fillRect(ex, ey, 1, 1);
  }
  ctx.globalAlpha = 1.0;
}

/** Draw one mote pixel-locked with a glow halo. */
function _drawMote(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  scale: number,
  coreColor: string,
  glowColor: string,
  pulsePhase: number,
  isAttack: boolean,
  isHitFlash: boolean,
): void {
  const br = 0.75 + Math.sin(pulsePhase) * 0.25;
  const glowRadius = Math.round((isAttack ? 4 : 3) * scale * br);
  if (glowRadius >= 1) {
    ctx.fillStyle = glowColor;
    ctx.globalAlpha = 0.5 * br;
    ctx.fillRect(sx - glowRadius, sy - glowRadius, glowRadius * 2, glowRadius * 2);
    ctx.globalAlpha = 1.0;
  }
  const coreSize = Math.max(1, Math.round((isAttack ? 2 : 1.5) * scale));
  ctx.fillStyle = isHitFlash ? MOTE_HIT_FLASH : coreColor;
  ctx.fillRect(sx - (coreSize >> 1), sy - (coreSize >> 1), coreSize, coreSize);
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export function renderDustBlockMimics(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
  isDebugMode: boolean,
): void {
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isDustBlockMimicFlag !== 1) continue;

    const slot = cluster.dustBlockMimicSlotIndex;
    if (slot < 0 || slot >= MAX_DUST_BLOCK_MIMICS) continue;

    const isLarge = cluster.isDustBlockMimicLargeFlag;
    const state = cluster.dustBlockMimicState;
    const stateTicks = cluster.dustBlockMimicStateTicks;
    const isAlive = cluster.isAliveFlag === 1;

    const cx = cluster.renderPositionXWorld;
    const cy = cluster.renderPositionYWorld;
    const sx = _sx(cx, ox, scale);
    const sy = _sy(cy, oy, scale);

    const hw = _halfW(isLarge);
    const hh = _halfH(isLarge);
    const sw = Math.max(1, Math.round(hw * 2 * scale));
    const sh = Math.max(1, Math.round(hh * 2 * scale));
    const bx = sx - (sw >> 1);
    const by = sy - (sh >> 1);
    const blockSeed = (slot * 17 + (isLarge ? 999 : 0)) | 0;

    // ── Dormant ────────────────────────────────────────────────────────────
    if (state === DBM_STATE_DORMANT) {
      _drawBlock(ctx, bx, by, sw, sh, BLOCK_FILL);
      _drawCracks(ctx, bx, by, sw, sh, CRACK_DORMANT, blockSeed);
      const tick = snapshot.tick;
      if ((tick >> 2) % 4 === 0) {
        _drawDustLeaks(ctx, bx, by, sw, sh, tick, blockSeed);
      }
      // tiny idle pulse
      const pulseAlpha = Math.sin(snapshot.tick * 0.07) * 0.08 + 0.08;
      ctx.fillStyle = MOTE_GLOW;
      ctx.globalAlpha = pulseAlpha;
      ctx.fillRect(bx - 1, by - 1, sw + 2, sh + 2);
      ctx.globalAlpha = 1.0;

      if (isDebugMode) {
        ctx.strokeStyle = DBG_BOX_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, sw, sh);
        const rangeR = Math.round(DBM_ACTIVATION_RANGE_WORLD * scale);
        ctx.strokeStyle = DBG_RANGE_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, rangeR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = DBG_TEXT_COLOR;
        ctx.font = '6px monospace';
        ctx.fillText('dormant', sx - 14, by - 4);
      }
      continue;
    }

    // ── Wake ───────────────────────────────────────────────────────────────
    if (state === DBM_STATE_WAKE) {
      const progress = stateTicks / DBM_WAKE_DURATION_TICKS;
      const crackBrightness = progress;
      const crackColor = crackBrightness > 0.4 ? CRACK_WAKE : CRACK_DORMANT;
      _drawBlock(ctx, bx, by, sw, sh, BLOCK_FILL);
      _drawCracks(ctx, bx, by, sw, sh, crackColor, blockSeed);
      // Bright glow growing during wake
      ctx.fillStyle = 'rgba(210,170,80,0.30)';
      ctx.globalAlpha = progress * 0.6;
      ctx.fillRect(bx - 2, by - 2, sw + 4, sh + 4);
      ctx.globalAlpha = 1.0;
      _drawDustLeaks(ctx, bx, by, sw, sh, snapshot.tick, blockSeed + snapshot.tick);
      continue;
    }

    // ── Block-shaped phases (burst: show crumbling block + first motes) ────
    if (state === DBM_STATE_BURST) {
      const progress = Math.min(1.0, stateTicks / 15);
      ctx.fillStyle = BLOCK_FILL;
      ctx.globalAlpha = 1.0 - progress;
      const crumbleSw = Math.round(sw * (1.0 - progress * 0.5));
      const crumbleSh = Math.round(sh * (1.0 - progress * 0.5));
      ctx.fillRect(sx - (crumbleSw >> 1), sy - (crumbleSh >> 1), crumbleSw, crumbleSh);
      ctx.globalAlpha = 1.0;
    }

    // ── Draw motes (burst + active + telegraph + attack + recover + dying) ──
    if (state >= DBM_STATE_BURST) {
      const base = slot * MAX_MOTES_PER_DBM;
      const moteCount = _moteCount(isLarge);
      const isAttack = state === DBM_STATE_TELEGRAPH || state === DBM_STATE_ATTACK;
      const isHitFlash = cluster.dustBlockMimicHitFlashTicks > 0;
      const dying = state === DBM_STATE_DYING || !isAlive;

      // Fade out during death
      let globalAlpha = 1.0;
      if (dying) {
        const deathProgress = Math.min(1.0, stateTicks / DBM_DEATH_DURATION_TICKS);
        globalAlpha = 1.0 - deathProgress;
        if (globalAlpha <= 0) continue;
      }

      // Draw swarm centre core
      if (!dying) {
        const coreR = Math.max(2, Math.round(DBM_ACTIVE_HITBOX_RADIUS * 0.4 * scale));
        ctx.globalAlpha = globalAlpha * 0.55;
        ctx.fillStyle = SWARM_CORE_GLOW;
        ctx.fillRect(sx - coreR * 2, sy - coreR * 2, coreR * 4, coreR * 4);
        ctx.globalAlpha = globalAlpha;
        ctx.fillStyle = SWARM_CORE_COLOR;
        ctx.fillRect(sx - coreR, sy - coreR, coreR * 2, coreR * 2);
        ctx.globalAlpha = 1.0;
      }

      // Draw each mote
      for (let m = 0; m < moteCount; m++) {
        const idx = base + m;
        const mx = snapshot.dbmMoteXWorld[idx];
        const my = snapshot.dbmMoteYWorld[idx];
        const pulse = snapshot.dbmMotePulsePhaseRad[idx];
        const msx = _sx(mx, ox, scale);
        const msy = _sy(my, oy, scale);
        ctx.globalAlpha = globalAlpha;
        _drawMote(
          ctx, msx, msy, scale,
          isAttack ? MOTE_ATTACK : MOTE_CORE,
          isAttack ? MOTE_ATTACK_GLOW : MOTE_GLOW,
          pulse, isAttack, isHitFlash,
        );
        ctx.globalAlpha = 1.0;
      }

      // Debug overlays for active states
      if (isDebugMode) {
        const hitR = Math.round(DBM_ACTIVE_HITBOX_RADIUS * scale);
        ctx.strokeStyle = 'rgba(255,180,60,0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, hitR, 0, Math.PI * 2);
        ctx.stroke();

        if (state === DBM_STATE_ATTACK) {
          const lx = cluster.dustBlockMimicLungeDirXWorld;
          const ly = cluster.dustBlockMimicLungeDirYWorld;
          const rushW = Math.round(DBM_SHARD_RUSH_HIT_HALF_W * scale);
          const rushH = Math.round(DBM_SHARD_RUSH_HIT_HALF_H * scale);
          ctx.save();
          ctx.translate(sx, sy);
          const angle = Math.atan2(ly, lx);
          ctx.rotate(angle - Math.PI / 2);
          ctx.strokeStyle = 'rgba(255,60,60,0.7)';
          ctx.strokeRect(-rushW, -rushH, rushW * 2, rushH * 2);
          ctx.restore();
        }

        const stateName = STATE_NAMES[state] ?? `${state}`;
        ctx.fillStyle = DBG_TEXT_COLOR;
        ctx.font = '6px monospace';
        ctx.fillText(stateName, sx - 12, sy - hitR - 4);

        // Mote target positions
        const moteCount2 = _moteCount(isLarge);
        for (let m = 0; m < moteCount2; m++) {
          const idx = base + m;
          const ttx = _sx(cx + snapshot.dbmMoteTargetLocalX[idx], ox, scale);
          const tty = _sy(cy + snapshot.dbmMoteTargetLocalY[idx], oy, scale);
          ctx.fillStyle = 'rgba(100,200,255,0.5)';
          ctx.fillRect(ttx, tty, 1, 1);
        }
      }
    }
  }
}
