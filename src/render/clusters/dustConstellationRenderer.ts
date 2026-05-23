/**
 * Dust Constellation Sentinel — rendering.
 *
 * Draws motes as pixel-locked filled rectangles with simple fake-glow via
 * larger translucent rectangles.  Telegraph lines and active beams use
 * strokeStyle with appropriate widths and alpha.
 *
 * All rendering works on the virtual (low-resolution) canvas and uses pixel-
 * snapped coordinates where practical.
 */

import type { WorldSnapshot, ClusterSnapshot } from '../snapshot';
import { getConstellationPattern } from '../../sim/clusters/dustConstellationAi';
import {
  DC_STATE_TELEGRAPH,
  DC_STATE_BEAM_FIRE,
  DC_STATE_RECOVER,
} from '../../sim/clusters/dustConstellationAi';
import {
  DC_BEAM_WIDTH_PX,
  DC_BEAM_GLOW_WIDTH_PX,
  DC_MOTE_RADIUS_WORLD,
  DC_TELEGRAPH_DURATION_TICKS,
  DC_BEAM_SEGMENT_DURATION_TICKS,
  DC_RECOVER_DURATION_TICKS,
  DC_ACTIVATION_RANGE_WORLD,
  DC_DEBUG_ENABLED,
} from '../../sim/clusters/dustConstellationConfig';
import { MAX_MOTES_PER_CONSTELLATION } from '../../sim/world';

// ── Colour palette ────────────────────────────────────────────────────────────
const MOTE_CORE_COLOR      = '#d8eeff';
const MOTE_GLOW_COLOR      = 'rgba(160,200,255,0.35)';
const TELEGRAPH_LINE_COLOR = 'rgba(180,220,255,0.5)';
const TELEGRAPH_LINE_GLOW  = 'rgba(120,180,255,0.18)';
const BEAM_CORE_COLOR      = 'rgba(220,240,255,0.95)';
const BEAM_GLOW_COLOR      = 'rgba(100,160,255,0.35)';
const DEBUG_RANGE_COLOR    = 'rgba(100,200,255,0.12)';
const DEBUG_TEXT_COLOR     = 'rgba(200,230,255,0.9)';
const STATE_NAMES = ['idle', 'gather', 'telegraph', 'beam_fire', 'recover'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _worldToScreenX(wx: number, offsetXPx: number, scalePx: number): number {
  return Math.round(wx * scalePx + offsetXPx);
}

function _worldToScreenY(wy: number, offsetYPx: number, scalePx: number): number {
  return Math.round(wy * scalePx + offsetYPx);
}

// ── Public render entry ───────────────────────────────────────────────────────

/**
 * Called once per frame from gameRender.ts after the main cluster pass.
 * Iterates all constellation clusters in the snapshot and draws them.
 */
export function renderDustConstellations(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  isDebugMode: boolean,
): void {
  ctx.save();

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isDustConstellationFlag !== 1) continue;
    _renderOneConstellation(ctx, cluster, snapshot, offsetXPx, offsetYPx, scalePx, isDebugMode);
  }

  ctx.restore();
}

function _renderOneConstellation(
  ctx: CanvasRenderingContext2D,
  cluster: ClusterSnapshot,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  isDebugMode: boolean,
): void {
  const slot = cluster.dustConstellationSlotIndex;
  if (slot < 0) return;

  const isLarge    = cluster.isDustConstellationLargeFlag;
  const state      = cluster.dustConstellationState;
  const stateTicks = cluster.dustConstellationStateTicks;
  const base       = slot * MAX_MOTES_PER_CONSTELLATION;

  const pat = getConstellationPattern(isLarge, cluster.dustConstellationPatternIndex);
  const moteCount = pat.moteCount;

  // ── Determine mote visibility / alpha based on state ─────────────────────
  let moteAlpha = 1.0;
  if (state === DC_STATE_RECOVER) {
    moteAlpha = Math.max(0.2, 1.0 - stateTicks / DC_RECOVER_DURATION_TICKS * 0.5);
  }

  // ── Draw telegraph lines (states 2+3) ─────────────────────────────────────
  if (state === DC_STATE_TELEGRAPH || state === DC_STATE_BEAM_FIRE) {
    // Pulse the telegraph alpha
    const pulseT = (state === DC_STATE_TELEGRAPH)
      ? stateTicks / DC_TELEGRAPH_DURATION_TICKS
      : 1.0;
    const linePulse = 0.4 + Math.sin(stateTicks * 0.25) * 0.15;
    const lineAlpha = Math.min(1.0, pulseT * 2.0) * linePulse;

    // Draw all beam-order segments as thin telegraphed lines
    ctx.globalAlpha = lineAlpha;
    for (let s = 0; s < pat.beamOrder.length - 1; s++) {
      const mA = pat.beamOrder[s];
      const mB = pat.beamOrder[s + 1];
      const ax = _worldToScreenX(snapshot.constellationMoteXWorld[base + mA], offsetXPx, scalePx);
      const ay = _worldToScreenY(snapshot.constellationMoteYWorld[base + mA], offsetYPx, scalePx);
      const bx = _worldToScreenX(snapshot.constellationMoteXWorld[base + mB], offsetXPx, scalePx);
      const by = _worldToScreenY(snapshot.constellationMoteYWorld[base + mB], offsetYPx, scalePx);

      // Outer glow
      ctx.strokeStyle = TELEGRAPH_LINE_GLOW;
      ctx.lineWidth = DC_BEAM_GLOW_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // Inner line
      ctx.strokeStyle = TELEGRAPH_LINE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  }

  // ── Draw active beam (state 3) ─────────────────────────────────────────────
  if (state === DC_STATE_BEAM_FIRE) {
    const activeBeam = cluster.dustConstellationActiveBeamIndex;
    if (activeBeam < pat.beamOrder.length - 1) {
      // Beam fade out near end of segment
      const beamFade = 1.0 - Math.max(0, stateTicks - DC_BEAM_SEGMENT_DURATION_TICKS * 0.7) /
        (DC_BEAM_SEGMENT_DURATION_TICKS * 0.3 + 0.001);
      const beamAlpha = Math.max(0.1, beamFade);

      const mA = pat.beamOrder[activeBeam];
      const mB = pat.beamOrder[activeBeam + 1];
      const ax = _worldToScreenX(snapshot.constellationMoteXWorld[base + mA], offsetXPx, scalePx);
      const ay = _worldToScreenY(snapshot.constellationMoteYWorld[base + mA], offsetYPx, scalePx);
      const bx = _worldToScreenX(snapshot.constellationMoteXWorld[base + mB], offsetXPx, scalePx);
      const by = _worldToScreenY(snapshot.constellationMoteYWorld[base + mB], offsetYPx, scalePx);

      ctx.globalAlpha = beamAlpha * 0.4;
      ctx.strokeStyle = BEAM_GLOW_COLOR;
      ctx.lineWidth = DC_BEAM_GLOW_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      ctx.globalAlpha = beamAlpha;
      ctx.strokeStyle = BEAM_CORE_COLOR;
      ctx.lineWidth = DC_BEAM_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      ctx.globalAlpha = 1.0;
    }
  }

  // ── Draw motes ────────────────────────────────────────────────────────────
  const moteRadiusPx = Math.max(1, Math.round(DC_MOTE_RADIUS_WORLD * scalePx));
  const glowRadiusPx = moteRadiusPx * 2 + 1;

  for (let m = 0; m < moteCount; m++) {
    const idx   = base + m;
    const mx    = _worldToScreenX(snapshot.constellationMoteXWorld[idx], offsetXPx, scalePx);
    const my    = _worldToScreenY(snapshot.constellationMoteYWorld[idx], offsetYPx, scalePx);
    const pulse = snapshot.constellationMotePulsePhaseRad[idx];
    const brightness = 0.7 + Math.sin(pulse) * 0.3;

    // Outer glow (larger translucent square)
    ctx.globalAlpha = moteAlpha * brightness * 0.3;
    ctx.fillStyle = MOTE_GLOW_COLOR;
    ctx.fillRect(mx - glowRadiusPx, my - glowRadiusPx, glowRadiusPx * 2, glowRadiusPx * 2);

    // Core pixel (crisp)
    ctx.globalAlpha = moteAlpha * brightness;
    ctx.fillStyle = MOTE_CORE_COLOR;
    const s = moteRadiusPx;
    ctx.fillRect(mx - s, my - s, s * 2, s * 2);
  }

  ctx.globalAlpha = 1.0;

  // ── Debug overlays ────────────────────────────────────────────────────────
  if (DC_DEBUG_ENABLED && isDebugMode) {
    const cx = _worldToScreenX(cluster.renderPositionXWorld, offsetXPx, scalePx);
    const cy = _worldToScreenY(cluster.renderPositionYWorld, offsetYPx, scalePx);

    // Activation range circle
    ctx.strokeStyle = DEBUG_RANGE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, DC_ACTIVATION_RANGE_WORLD * scalePx, 0, Math.PI * 2);
    ctx.stroke();

    // Centre cross
    ctx.strokeStyle = 'rgba(200,230,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
    ctx.stroke();

    // State name
    const stateName = STATE_NAMES[state] ?? `state_${state}`;
    ctx.fillStyle = DEBUG_TEXT_COLOR;
    ctx.font = '8px monospace';
    ctx.fillText(`DC:${stateName}(${stateTicks})`, cx + 6, cy - 4);

    // Beam hitboxes during beam_fire
    if (state === DC_STATE_BEAM_FIRE) {
      const activeBeam = cluster.dustConstellationActiveBeamIndex;
      if (activeBeam < pat.beamOrder.length - 1) {
        ctx.strokeStyle = 'rgba(255,100,100,0.6)';
        ctx.lineWidth = 2;
        const mA = pat.beamOrder[activeBeam];
        const mB = pat.beamOrder[activeBeam + 1];
        const ax = _worldToScreenX(snapshot.constellationMoteXWorld[base + mA], offsetXPx, scalePx);
        const ay = _worldToScreenY(snapshot.constellationMoteYWorld[base + mA], offsetYPx, scalePx);
        const bx = _worldToScreenX(snapshot.constellationMoteXWorld[base + mB], offsetXPx, scalePx);
        const by = _worldToScreenY(snapshot.constellationMoteYWorld[base + mB], offsetYPx, scalePx);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  }
}
