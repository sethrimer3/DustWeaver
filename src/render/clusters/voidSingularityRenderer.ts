/**
 * Void Singularity — rendering.
 *
 * Renders both Void Singularity (single black-hole enemy) and
 * Void Singularity Pair (linked black hole + white hole).
 *
 * Visual components:
 *   Black hole: dark core, bright event-horizon rim, inward-spiral motes, faint halo.
 *   White hole: bright core, pale rim, outward motes, emitted projectiles, link arc.
 *
 * Targets the low-resolution virtual canvas.  Uses fillRect pixel-locked motes
 * and overlapping translucent circles for glow (no full-screen post-processing).
 */

import type { WorldSnapshot } from '../snapshot';
import {
  VS_STATE_DYING,
  VS_STATE_CHARGE_PULSE,
  VS_STATE_COLLAPSE_PULSE,
  VS_STATE_IDLE,
  VSP_WH_STATE_CHARGING,
  VSP_WH_STATE_ERUPTING,
} from '../../sim/clusters/voidSingularityAi';
import {
  VS_CORE_RADIUS_WORLD,
  VS_RIM_THICKNESS_WORLD,
  VS_HALO_RADIUS_WORLD,
  VS_MOTE_START_RADIUS_WORLD,
  VS_PULSE_THICKNESS_WORLD,
  VS_ACTIVATION_RANGE_WORLD,
  VS_PULL_RADIUS_WORLD,
  VS_ABSORPTION_RADIUS_WORLD,
  VSP_NODE_DISTANCE_WORLD,
  VSP_LINK_SEGMENT_COUNT,
  VSP_PROJ_VISUAL_RADIUS_WORLD,
  MAX_MOTES_PER_VS,
  MAX_PROJS_PER_VSP,
  VS_DEATH_DURATION_TICKS,
} from '../../sim/clusters/voidSingularityConfig';

// ── Colour palette ─────────────────────────────────────────────────────────────
// Black hole
const BH_CORE_FILL     = '#06000f';
const BH_RIM_COLOR     = 'rgba(140,80,220,0.90)';
const BH_RIM_BRIGHT    = 'rgba(200,140,255,0.95)';
const BH_HALO_COLOR    = 'rgba(50,15,90,0.18)';
const BH_MOTE_COLOR    = 'rgba(180,120,255,0.82)';
const BH_MOTE_DIM      = 'rgba(110,60,180,0.50)';
const BH_PULSE_COLOR   = 'rgba(180,100,255,0.75)';
const BH_PULSE_FADE    = 'rgba(120,60,200,0.30)';
// White hole
const WH_CORE_FILL     = '#fffce8';
const WH_RIM_COLOR     = 'rgba(255,240,180,0.90)';
const WH_HALO_COLOR    = 'rgba(255,250,210,0.18)';
const WH_PROJ_CORE     = '#fff8c0';
const WH_PROJ_GLOW     = 'rgba(255,240,100,0.55)';
// Debug
const DBG_RANGE        = 'rgba(150,80,220,0.07)';
const DBG_PULL         = 'rgba(100,50,180,0.10)';
const DBG_ABSORB       = 'rgba(60,20,120,0.20)';
const DBG_HITBOX       = 'rgba(255,100,255,0.45)';
const DBG_TEXT         = 'rgba(220,180,255,0.9)';
const DBG_PULSE_RING   = 'rgba(255,80,255,0.55)';
const DBG_WH_CENTER    = 'rgba(255,240,100,0.80)';

// ── Coordinate helpers ────────────────────────────────────────────────────────

function _sx(wx: number, ox: number, scale: number): number {
  return Math.round((wx + ox) * scale);
}
function _sy(wy: number, oy: number, scale: number): number {
  return Math.round((wy + oy) * scale);
}
function _sw(w: number, scale: number): number {
  return Math.max(1, Math.round(w * scale));
}

// ── Per-enemy rendering helpers ───────────────────────────────────────────────

function _drawBlackHole(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  state: number,
  stateTicks: number,
  pulseRadius: number,
  pulseActive: number,
  hitFlash: number,
  _bobPhase: number,
  slot: number,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
): void {
  const sx = _sx(cx, ox, scale);
  const sy = _sy(cy, oy, scale);

  // Charge pulse visual: compress core slightly
  const isCharging = state === VS_STATE_CHARGE_PULSE;
  const coreR = VS_CORE_RADIUS_WORLD * scale;
  const compressFactor = isCharging ? Math.max(0.6, 1.0 - (stateTicks / 70) * 0.4) : 1.0;
  const coreRS = Math.max(1, coreR * compressFactor);

  // Faint halo
  const haloR = _sw(VS_HALO_RADIUS_WORLD, scale);
  ctx.beginPath();
  ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
  ctx.fillStyle = BH_HALO_COLOR;
  ctx.fill();

  // Rim ring (event horizon)
  const rimR = coreRS + _sw(VS_RIM_THICKNESS_WORLD, scale);
  ctx.beginPath();
  ctx.arc(sx, sy, rimR, 0, Math.PI * 2);
  ctx.fillStyle = (isCharging || hitFlash > 0) ? BH_RIM_BRIGHT : BH_RIM_COLOR;
  ctx.fill();

  // Dark core
  ctx.beginPath();
  ctx.arc(sx, sy, coreRS, 0, Math.PI * 2);
  ctx.fillStyle = BH_CORE_FILL;
  ctx.fill();

  // Inward-spiral motes
  if (slot >= 0 && state !== VS_STATE_IDLE) {
    const moteBase = slot * MAX_MOTES_PER_VS;
    for (let m = 0; m < MAX_MOTES_PER_VS; m++) {
      const mi = moteBase + m;
      const angle  = snapshot.vsMoteAngleRad[mi];
      const radius = snapshot.vsMoteRadiusWorld[mi];
      const pulse  = snapshot.vsMotePulsePhaseRad[mi];
      const bright = 0.55 + 0.45 * Math.sin(pulse);
      const mx = cx + Math.cos(angle) * radius;
      const my = cy + Math.sin(angle) * radius;
      const msx = _sx(mx, ox, scale);
      const msy = _sy(my, oy, scale);
      const ms  = Math.max(1, Math.round(scale));
      ctx.fillStyle = bright > 0.75 ? BH_MOTE_COLOR : BH_MOTE_DIM;
      ctx.fillRect(msx - Math.floor(ms / 2), msy - Math.floor(ms / 2), ms, ms);
    }
  }

  // Collapse-pulse ring
  if (pulseActive === 1 && state === VS_STATE_COLLAPSE_PULSE) {
    const pr = pulseRadius * scale;
    const pt = Math.max(1, _sw(VS_PULSE_THICKNESS_WORLD * 0.5, scale));
    ctx.beginPath();
    ctx.arc(sx, sy, pr, 0, Math.PI * 2);
    ctx.strokeStyle = BH_PULSE_COLOR;
    ctx.lineWidth = pt;
    ctx.stroke();
    // Faint outer fade ring
    ctx.beginPath();
    ctx.arc(sx, sy, pr + pt, 0, Math.PI * 2);
    ctx.strokeStyle = BH_PULSE_FADE;
    ctx.lineWidth = Math.max(1, pt * 0.5);
    ctx.stroke();
  }
}

function _drawWhiteHole(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  whState: number,
  slot: number,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
): void {
  const sx = _sx(cx, ox, scale);
  const sy = _sy(cy, oy, scale);

  const isCharging = whState === VSP_WH_STATE_CHARGING;
  const isErupting = whState === VSP_WH_STATE_ERUPTING;

  // Faint halo
  const haloR = _sw(VS_HALO_RADIUS_WORLD * 0.8, scale);
  ctx.beginPath();
  ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
  ctx.fillStyle = WH_HALO_COLOR;
  ctx.fill();

  // Rim
  const rimR = _sw(VS_CORE_RADIUS_WORLD + VS_RIM_THICKNESS_WORLD, scale);
  ctx.beginPath();
  ctx.arc(sx, sy, rimR, 0, Math.PI * 2);
  ctx.fillStyle = (isCharging || isErupting) ? 'rgba(255,250,200,0.95)' : WH_RIM_COLOR;
  ctx.fill();

  // Bright core
  const coreR = _sw(VS_CORE_RADIUS_WORLD, scale);
  ctx.beginPath();
  ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = WH_CORE_FILL;
  ctx.fill();

  // Outward-ray motes (static decorative rays, not slot-based)
  const rayCount = 6;
  for (let r = 0; r < rayCount; r++) {
    const angle = (r / rayCount) * Math.PI * 2;
    const rayLen = isCharging ? VS_MOTE_START_RADIUS_WORLD * 1.4 : VS_MOTE_START_RADIUS_WORLD;
    for (let d = coreR + _sw(4, scale); d < rayLen * scale; d += _sw(4, scale)) {
      const mx = sx + Math.round(Math.cos(angle) * d);
      const my = sy + Math.round(Math.sin(angle) * d);
      const fade = 1.0 - d / (rayLen * scale);
      if (fade < 0.15) continue;
      const ms = Math.max(1, Math.round(scale));
      ctx.fillStyle = `rgba(255,230,160,${(fade * 0.7).toFixed(2)})`;
      ctx.fillRect(mx - Math.floor(ms / 2), my - Math.floor(ms / 2), ms, ms);
    }
  }

  // Active projectiles
  if ((isErupting) && slot >= 0) {
    const projBase = slot * MAX_PROJS_PER_VSP;
    for (let p = 0; p < MAX_PROJS_PER_VSP; p++) {
      const idx = projBase + p;
      if (snapshot.vspProjAliveFlag[idx] === 0) continue;
      const px = snapshot.vspProjXWorld[idx];
      const py = snapshot.vspProjYWorld[idx];
      const psx = _sx(px, ox, scale);
      const psy = _sy(py, oy, scale);
      const pr = Math.max(1, _sw(VSP_PROJ_VISUAL_RADIUS_WORLD, scale));
      // Glow
      ctx.beginPath();
      ctx.arc(psx, psy, pr + _sw(2, scale), 0, Math.PI * 2);
      ctx.fillStyle = WH_PROJ_GLOW;
      ctx.fill();
      // Core
      ctx.beginPath();
      ctx.arc(psx, psy, pr, 0, Math.PI * 2);
      ctx.fillStyle = WH_PROJ_CORE;
      ctx.fill();
    }
  }
}

function _drawPairLink(
  ctx: CanvasRenderingContext2D,
  bhCX: number,
  bhCY: number,
  whCX: number,
  whCY: number,
  ox: number,
  oy: number,
  scale: number,
): void {
  // Draw a series of small motes along the link arc.
  for (let s = 1; s < VSP_LINK_SEGMENT_COUNT; s++) {
    const t = s / VSP_LINK_SEGMENT_COUNT;
    const lx = bhCX + (whCX - bhCX) * t;
    const ly = bhCY + (whCY - bhCY) * t;
    // Slightly wavy using sine offset
    const perpX = -(whCY - bhCY);
    const perpY =  (whCX - bhCX);
    const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) + 0.001;
    const wave = Math.sin(t * Math.PI) * 3.0;
    const mx = lx + (perpX / perpLen) * wave;
    const my = ly + (perpY / perpLen) * wave;
    const msx = _sx(mx, ox, scale);
    const msy = _sy(my, oy, scale);
    const ms = Math.max(1, Math.round(scale));
    const fade = (0.25 + 0.25 * Math.sin(t * Math.PI)).toFixed(2);
    ctx.fillStyle = `rgba(160,100,220,${fade})`;
    ctx.fillRect(msx - Math.floor(ms / 2), msy - Math.floor(ms / 2), ms, ms);
  }
}

// ── Main render function ──────────────────────────────────────────────────────

export function renderVoidSingularities(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
  isDebugMode: boolean,
): void {
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isVoidSingularityFlag !== 1) continue;
    if (cluster.isAliveFlag === 0 && cluster.voidSingularityState !== VS_STATE_DYING) continue;

    const cx   = cluster.renderPositionXWorld;
    const cy   = cluster.renderPositionYWorld;
    const slot = cluster.voidSingularitySlotIndex;
    const isPair = cluster.isVoidSingularityPairFlag === 1;

    // Death fade: reduce alpha as the enemy collapses.
    let deathAlpha = 1.0;
    if (cluster.voidSingularityState === VS_STATE_DYING) {
      // VS_DEATH_DURATION_TICKS = 55 ticks
      deathAlpha = Math.max(0, 1.0 - cluster.voidSingularityStateTicks / VS_DEATH_DURATION_TICKS);
    }
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * deathAlpha;

    // Draw pair link first (behind both nodes).
    if (isPair) {
      const whCX = cx + Math.cos(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
      const whCY = cy + Math.sin(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
      _drawPairLink(ctx, cx, cy, whCX, whCY, ox, oy, scale);
    }

    // Draw the black hole.
    _drawBlackHole(
      ctx, cx, cy,
      cluster.voidSingularityState,
      cluster.voidSingularityStateTicks,
      cluster.voidSingularityPulseRadius,
      cluster.voidSingularityPulseActiveFlag,
      cluster.voidSingularityHitFlashTicks,
      cluster.voidSingularityBobPhaseRad,      slot, snapshot, ox, oy, scale,
    );

    // Draw the white hole for pair variant.
    if (isPair) {
      const whCX = cx + Math.cos(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
      const whCY = cy + Math.sin(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
      _drawWhiteHole(
        ctx, whCX, whCY,
        cluster.voidSingularityWholeState,
        slot, snapshot, ox, oy, scale,
      );
    }

    ctx.globalAlpha = prevAlpha;

    // ── Debug overlays ────────────────────────────────────────────────────────
    if (isDebugMode) {
      const sx = _sx(cx, ox, scale);
      const sy = _sy(cy, oy, scale);

      // Activation range
      ctx.beginPath();
      ctx.arc(sx, sy, _sw(VS_ACTIVATION_RANGE_WORLD, scale), 0, Math.PI * 2);
      ctx.fillStyle = DBG_RANGE;
      ctx.fill();

      // Pull radius
      ctx.beginPath();
      ctx.arc(sx, sy, _sw(VS_PULL_RADIUS_WORLD, scale), 0, Math.PI * 2);
      ctx.fillStyle = DBG_PULL;
      ctx.fill();

      // Absorption radius
      ctx.beginPath();
      ctx.arc(sx, sy, _sw(VS_ABSORPTION_RADIUS_WORLD, scale), 0, Math.PI * 2);
      ctx.fillStyle = DBG_ABSORB;
      ctx.fill();

      // Hitbox
      const hw = _sw(8, scale);
      ctx.strokeStyle = DBG_HITBOX;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - hw, sy - hw, hw * 2, hw * 2);

      // Pulse ring debug
      if (cluster.voidSingularityPulseActiveFlag === 1) {
        ctx.beginPath();
        ctx.arc(sx, sy, cluster.voidSingularityPulseRadius * scale, 0, Math.PI * 2);
        ctx.strokeStyle = DBG_PULSE_RING;
        ctx.lineWidth   = Math.max(1, _sw(VS_PULSE_THICKNESS_WORLD, scale));
        ctx.stroke();
      }

      // State label
      const stateNames = ['Idle','Pull','Charge','Pulse','Recover','Dying'];
      const stateLabel = stateNames[cluster.voidSingularityState] ?? '?';
      ctx.font = `${Math.round(6 * scale)}px monospace`;
      ctx.fillStyle = DBG_TEXT;
      ctx.fillText(`VS:${stateLabel} E:${cluster.voidSingularityAbsorbedEnergy.toFixed(1)}`, sx + _sw(12, scale), sy - _sw(8, scale));

      // Pair debug
      if (isPair) {
        const whCX = cx + Math.cos(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
        const whCY = cy + Math.sin(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
        const whSX = _sx(whCX, ox, scale);
        const whSY = _sy(whCY, oy, scale);
        ctx.beginPath();
        ctx.arc(whSX, whSY, _sw(8, scale), 0, Math.PI * 2);
        ctx.strokeStyle = DBG_WH_CENTER;
        ctx.lineWidth = 1;
        ctx.stroke();
        const whStateNames = ['Idle','Charging','Erupting','Cooldown'];
        const whLabel = whStateNames[cluster.voidSingularityWholeState] ?? '?';
        ctx.fillStyle = DBG_TEXT;
        ctx.fillText(`WH:${whLabel} Ch:${cluster.voidSingularityWholeCharge.toFixed(1)}`, whSX + _sw(10, scale), whSY - _sw(8, scale));
      }
    }
  }
}
