/**
 * Orbital Dust Core — rendering.
 *
 * Draws motes as pixel-locked filled rectangles with fake glow via larger
 * translucent rects.  Core is drawn as a bright filled circle scaled by how
 * many rings remain.  Gravity Pulse is drawn as an expanding arc with alpha
 * fade.  All rendering targets the virtual (low-resolution) canvas.
 */

import type { WorldSnapshot, ClusterSnapshot } from '../snapshot';
import {
  ODC_STATE_CHARGE,
  ODC_STATE_PULSE,
  ODC_STATE_DYING,
} from '../../sim/clusters/orbitalDustCoreAi';
import {
  ODC_SMALL_RING_COUNT,
  ODC_LARGE_RING_COUNT,
  ODC_SMALL_MOTES_PER_RING,
  ODC_LARGE_MOTES_PER_RING,
  ODC_SMALL_RING_RADII,
  ODC_LARGE_RING_RADII,
  ODC_MOTE_RADIUS_WORLD,
  ODC_CORE_RADIUS_OCCLUDED_WORLD,
  ODC_CORE_RADIUS_VULNERABLE_WORLD,
  ODC_CORE_VULNERABLE_PULSE_FREQ,
  ODC_PULSE_THICKNESS_WORLD,
  ODC_ACTIVATION_RANGE_WORLD,
  ODC_RING_HIT_BAND_THICKNESS_WORLD,
  ODC_CORE_HIT_RADIUS_WORLD,
  ODC_DEBUG_ENABLED,
  MAX_MOTES_PER_RING_ODC,
} from '../../sim/clusters/orbitalDustCoreConfig';
import { MOTES_PER_ODC_SLOT } from '../../sim/world';

// ── Colour palette ────────────────────────────────────────────────────────────
// Outer (slower) motes are warmer/dimmer; inner motes are cooler/brighter.
const RING_CORE_COLORS: readonly string[] = [
  '#c8a060', // ring 0 (outermost) — warm amber
  '#d4b880', // ring 1
  '#c8d8f0', // ring 2
  '#d8f0ff', // ring 3 (innermost) — cool bright
];
const RING_GLOW_COLORS: readonly string[] = [
  'rgba(200,140,60,0.28)',
  'rgba(210,170,90,0.28)',
  'rgba(160,200,240,0.28)',
  'rgba(180,230,255,0.30)',
];
const CORE_PROTECTED_COLOR   = '#5060a0';
const CORE_PROTECTED_GLOW    = 'rgba(80,100,180,0.22)';
const CORE_VULNERABLE_COLOR  = '#ffe8a0';
const CORE_VULNERABLE_GLOW   = 'rgba(255,230,80,0.38)';
const PULSE_RING_COLOR       = 'rgba(200,160,255,0.55)';
const PULSE_RING_GLOW_COLOR  = 'rgba(150,100,220,0.22)';
const SHIELD_FLASH_COLOR     = 'rgba(100,130,255,0.55)';
const COLLAPSE_FLASH_COLOR   = 'rgba(255,240,180,0.55)';
const DEBUG_RANGE_COLOR      = 'rgba(200,160,80,0.12)';
const DEBUG_TEXT_COLOR       = 'rgba(240,210,140,0.9)';
const STATE_NAMES            = ['idle', 'active', 'charge', 'pulse', 'recover', 'dying'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _wx(w: number, ox: number, s: number): number { return Math.round(w * s + ox); }
function _wy(w: number, oy: number, s: number): number { return Math.round(w * s + oy); }

function _ringCount(isLarge: number): number {
  return isLarge === 1 ? ODC_LARGE_RING_COUNT : ODC_SMALL_RING_COUNT;
}
function _motesPerRing(isLarge: number): readonly number[] {
  return isLarge === 1 ? ODC_LARGE_MOTES_PER_RING : ODC_SMALL_MOTES_PER_RING;
}
function _ringRadii(isLarge: number): readonly number[] {
  return isLarge === 1 ? ODC_LARGE_RING_RADII : ODC_SMALL_RING_RADII;
}
function _moteIdx(slot: number, ring: number, mote: number): number {
  return slot * MOTES_PER_ODC_SLOT + ring * MAX_MOTES_PER_RING_ODC + mote;
}
function _getRingHealth(cluster: ClusterSnapshot, ring: number): number {
  if (ring === 0) return cluster.orbitalDustCoreRing0Health;
  if (ring === 1) return cluster.orbitalDustCoreRing1Health;
  if (ring === 2) return cluster.orbitalDustCoreRing2Health;
  if (ring === 3) return cluster.orbitalDustCoreRing3Health;
  return -1;
}

// ── Public render entry ───────────────────────────────────────────────────────

/**
 * Called once per frame from gameRender.ts after the main cluster pass.
 */
export function renderOrbitalDustCores(
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
    if (cluster.isOrbitalDustCoreFlag !== 1) continue;
    _renderOne(ctx, cluster, snapshot, offsetXPx, offsetYPx, scalePx, isDebugMode);
  }
  ctx.restore();
}

function _renderOne(
  ctx: CanvasRenderingContext2D,
  cluster: ClusterSnapshot,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  s: number,
  isDebugMode: boolean,
): void {
  const slot = cluster.orbitalDustCoreSlotIndex;
  if (slot < 0) return;

  const isLarge    = cluster.isOrbitalDustCoreLargeFlag;
  const state      = cluster.orbitalDustCoreState;
  const stateTicks = cluster.orbitalDustCoreStateTicks;
  const exposedRing = cluster.orbitalDustCoreExposedRing;
  const ringCount  = _ringCount(isLarge);
  const mprArr     = _motesPerRing(isLarge);
  const coreVulnerable = exposedRing >= ringCount;
  const cx = _wx(cluster.renderPositionXWorld, ox, s);
  const cy = _wy(cluster.renderPositionYWorld, oy, s);

  // Dying fade-out alpha
  let globalAlpha = 1.0;
  if (state === ODC_STATE_DYING) {
    globalAlpha = Math.max(0, 1.0 - stateTicks / 40);
  }

  // ── Draw motes (pixel-locked fillRect) ───────────────────────────────────
  const moteRadiusPx = Math.max(1, Math.round(ODC_MOTE_RADIUS_WORLD * s));
  const glowPx = moteRadiusPx * 2 + 1;

  for (let r = 0; r < ringCount; r++) {
    const mpr  = mprArr[r];
    const coreColor = RING_CORE_COLORS[Math.min(r, RING_CORE_COLORS.length - 1)];
    const glowColor = RING_GLOW_COLORS[Math.min(r, RING_GLOW_COLORS.length - 1)];

    for (let m = 0; m < mpr; m++) {
      const idx = _moteIdx(slot, r, m);
      if (snapshot.odcMoteAliveFlag[idx] === 0) continue;

      const angle = snapshot.odcMoteAngleRad[idx];
      const radius = snapshot.odcMoteRadiusWorld[idx];
      const pulse  = snapshot.odcMotePulsePhaseRad[idx];
      const brightness = 0.65 + Math.sin(pulse) * 0.35;

      // World position of this mote
      const mwx = cluster.renderPositionXWorld + Math.cos(angle) * radius;
      const mwy = cluster.renderPositionYWorld + Math.sin(angle) * radius;
      const mpx = _wx(mwx, ox, s);
      const mpy = _wy(mwy, oy, s);

      // Glow
      ctx.globalAlpha = globalAlpha * brightness * 0.28;
      ctx.fillStyle = glowColor;
      ctx.fillRect(mpx - glowPx, mpy - glowPx, glowPx * 2, glowPx * 2);

      // Core pixel
      ctx.globalAlpha = globalAlpha * brightness;
      ctx.fillStyle = coreColor;
      ctx.fillRect(mpx - moteRadiusPx, mpy - moteRadiusPx, moteRadiusPx * 2, moteRadiusPx * 2);
    }
  }

  ctx.globalAlpha = 1.0;

  // ── Draw core ─────────────────────────────────────────────────────────────
  {
    // Fraction of rings still alive (0..1) — controls how visible core is
    let ringsAliveCount = 0;
    for (let r = 0; r < ringCount; r++) {
      if (_getRingHealth(cluster, r) > 0) ringsAliveCount++;
    }
    const hiddenFraction = ringCount > 0 ? ringsAliveCount / ringCount : 0;

    // Core radius grows as rings are destroyed
    const coreR = ODC_CORE_RADIUS_OCCLUDED_WORLD
      + (ODC_CORE_RADIUS_VULNERABLE_WORLD - ODC_CORE_RADIUS_OCCLUDED_WORLD) * (1 - hiddenFraction);

    // Core pulse when vulnerable
    let corePulse = 0.0;
    if (coreVulnerable) {
      corePulse = Math.sin(stateTicks * ODC_CORE_VULNERABLE_PULSE_FREQ) * 0.4 + 0.6;
    } else if (state === ODC_STATE_CHARGE) {
      const chargeT = Math.min(1.0, stateTicks / 50);
      corePulse = chargeT * 0.5;
    }

    // Collapse pulse flash
    let collapseBoost = 0.0;
    if (cluster.orbitalDustCoreCorePulseTicks > 0) {
      collapseBoost = cluster.orbitalDustCoreCorePulseTicks / 30;
    }

    const coreAlpha = (coreVulnerable ? (0.7 + corePulse * 0.3) : (0.3 + hiddenFraction * 0.15 + collapseBoost * 0.4)) * globalAlpha;
    const coreColor = coreVulnerable ? CORE_VULNERABLE_COLOR : CORE_PROTECTED_COLOR;
    const coreGlowColor = coreVulnerable ? CORE_VULNERABLE_GLOW : CORE_PROTECTED_GLOW;
    const coreRadiusPx = Math.max(1, Math.round(coreR * s));
    const coreGlowPx   = coreRadiusPx * 3;

    // Glow
    ctx.globalAlpha = coreAlpha * 0.35;
    ctx.fillStyle = coreGlowColor;
    ctx.beginPath();
    ctx.arc(cx, cy, coreGlowPx, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.globalAlpha = coreAlpha;
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadiusPx, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1.0;

  // ── Shield flash ──────────────────────────────────────────────────────────
  if (cluster.orbitalDustCoreShieldFlashTicks > 0) {
    const flashAlpha = (cluster.orbitalDustCoreShieldFlashTicks / 25) * 0.55;
    const radii = _ringRadii(isLarge);
    const r = Math.min(exposedRing, radii.length - 1);
    const flashR = (radii[r] + 6) * s;
    ctx.globalAlpha = flashAlpha;
    ctx.strokeStyle = SHIELD_FLASH_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, flashR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // ── Collapse flash ────────────────────────────────────────────────────────
  if (cluster.orbitalDustCoreCorePulseTicks > 0) {
    const flashAlpha = (cluster.orbitalDustCoreCorePulseTicks / 30) * 0.4;
    ctx.globalAlpha = flashAlpha;
    ctx.strokeStyle = COLLAPSE_FLASH_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // ── Gravity pulse ring ────────────────────────────────────────────────────
  if (state === ODC_STATE_PULSE || cluster.orbitalDustCorePulseActiveFlag === 1) {
    const pr = cluster.orbitalDustCorePulseRadius * s;
    const innerR = Math.max(0, pr - ODC_PULSE_THICKNESS_WORLD * s);
    const fadeT = cluster.orbitalDustCorePulseActiveFlag === 1 ? 1.0 : 0.0;

    if (pr > 0) {
      // Glow outer ring
      ctx.globalAlpha = fadeT * 0.22;
      ctx.strokeStyle = PULSE_RING_GLOW_COLOR;
      ctx.lineWidth = ODC_PULSE_THICKNESS_WORLD * s * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();

      // Crisp inner ring edge
      ctx.globalAlpha = fadeT * 0.55;
      ctx.strokeStyle = PULSE_RING_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.stroke();

      // Leading edge bright
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1.0;
    }
  }

  // ── Charge telegraph ──────────────────────────────────────────────────────
  if (state === ODC_STATE_CHARGE) {
    const chargeT = Math.min(1.0, stateTicks / 50);
    const pulseFreq = Math.sin(stateTicks * 0.35) * 0.5 + 0.5;
    const chargeAlpha = chargeT * pulseFreq * 0.4;
    ctx.globalAlpha = chargeAlpha;
    ctx.strokeStyle = 'rgba(220,180,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 12 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // ── Debug overlays ────────────────────────────────────────────────────────
  if (ODC_DEBUG_ENABLED && isDebugMode) {
    const radii = _ringRadii(isLarge);

    // Activation range
    ctx.strokeStyle = DEBUG_RANGE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ODC_ACTIVATION_RANGE_WORLD * s, 0, Math.PI * 2);
    ctx.stroke();

    // Ring radii
    for (let r = 0; r < ringCount; r++) {
      const rr = (radii[r] + (exposedRing > 0 ? exposedRing * 8 : 0)) * s;
      const isExposed = r === exposedRing;
      ctx.strokeStyle = isExposed ? 'rgba(255,180,60,0.5)' : 'rgba(180,180,255,0.25)';
      ctx.lineWidth = isExposed ? 2 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();

      // Hit band inner/outer
      ctx.strokeStyle = 'rgba(255,100,100,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, (radii[r] - ODC_RING_HIT_BAND_THICKNESS_WORLD) * s), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, (radii[r] + ODC_RING_HIT_BAND_THICKNESS_WORLD) * s, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Core hit radius
    ctx.strokeStyle = coreVulnerable ? 'rgba(255,200,60,0.5)' : 'rgba(100,100,200,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ODC_CORE_HIT_RADIUS_WORLD * s, 0, Math.PI * 2);
    ctx.stroke();

    // Centre cross
    ctx.strokeStyle = 'rgba(240,200,120,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
    ctx.stroke();

    // State label
    const stateName = STATE_NAMES[state] ?? `s${state}`;
    ctx.fillStyle = DEBUG_TEXT_COLOR;
    ctx.font = '8px monospace';
    ctx.fillText(`ODC:${stateName}(${stateTicks}) exp=${exposedRing} vul=${coreVulnerable ? 1 : 0}`, cx + 7, cy - 4);
  }
}
