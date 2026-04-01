/**
 * FloaterLatticeEffect
 *
 * Ported from Thero_Idle_TD BackgroundRenderer.js (drawFloaters section).
 * Renders faint circles connected by thin lines with background swimmers
 * orbiting beneath.  Standalone version that manages its own floater/swimmer
 * data without external game state.
 *
 * Adapted for the 480×270 virtual canvas.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';

// ─── Constants ────────────────────────────────────────────────────────────────

const FLOATER_COUNT  = 18;
const CONNECTION_COUNT = 20;
const SWIMMER_COUNT  = 8;
const TWO_PI         = Math.PI * 2;

/** Floater drift speed (virtual px / s). */
const FLOATER_SPEED_PX_S = 8;

/** Floater radius as a fraction of the shorter viewport dimension. */
const FLOATER_RADIUS_MIN_FRACTION = 0.015;
const FLOATER_RADIUS_MAX_FRACTION = 0.055;

/** Swimmer orbit speed (radians / s). */
const SWIMMER_ORBIT_SPEED_RAD_S = 0.35;

/** Swimmer orbit radius range (virtual px). */
const SWIMMER_ORBIT_RADIUS_MIN_PX = 20;
const SWIMMER_ORBIT_RADIUS_MAX_PX = 70;

/** Swimmer visibility pulsation frequency (Hz). */
const SWIMMER_PULSE_HZ = 0.18;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Floater {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radiusFraction: number;
  opacityBase: number;
  opacityPhase: number;
  opacityFreqHz: number;
}

interface Connection {
  fromIdx: number;
  toIdx: number;
  strength: number;
}

interface Swimmer {
  targetFloaterIndex: number;
  orbitCenterX: number;
  orbitCenterY: number;
  orbitRadiusPx: number;
  angleRad: number;
  speedRadS: number;
  sizeScale: number;
  x: number;
  y: number;
  visibility: number;
}

// ─── Swimmer sprite builder ───────────────────────────────────────────────────

function buildSwimmerSprite(baseSizePx: number): HTMLCanvasElement {
  const spriteRadius   = Math.ceil(baseSizePx * 3);
  const spriteDiameter = spriteRadius * 2;
  const offscreen      = document.createElement('canvas');
  offscreen.width      = spriteDiameter;
  offscreen.height     = spriteDiameter;
  const offCtx         = offscreen.getContext('2d')!;
  offCtx.filter        = `blur(${Math.max(1, baseSizePx * 0.8)}px)`;
  offCtx.fillStyle     = 'rgba(255, 255, 255, 1)';
  offCtx.beginPath();
  offCtx.arc(spriteRadius, spriteRadius, baseSizePx, 0, TWO_PI);
  offCtx.fill();
  offCtx.filter = 'none';
  return offscreen;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createFloaterLatticeEffect(): TheroBackgroundEffect {
  let floaters:    Floater[]    = [];
  let connections: Connection[] = [];
  let swimmers:    Swimmer[]    = [];

  let lastTs: number | null   = null;
  let vpW = 0;
  let vpH = 0;

  let swimmerSprite: HTMLCanvasElement | null = null;
  let swimmerSpriteKey = 0;

  function ensureSwimmerSprite(minDimPx: number): void {
    const baseSizePx = Math.max(1.2, minDimPx * 0.005);
    const key        = Math.round(baseSizePx * 10);
    if (swimmerSprite && swimmerSpriteKey === key) return;
    swimmerSprite    = buildSwimmerSprite(baseSizePx);
    swimmerSpriteKey = key;
  }

  function initialize(widthPx: number, heightPx: number): void {
    floaters    = [];
    connections = [];
    swimmers    = [];

    // Create floaters at random positions with gentle drift
    for (let i = 0; i < FLOATER_COUNT; i++) {
      const angleRad = Math.random() * TWO_PI;
      const speed    = FLOATER_SPEED_PX_S * (0.5 + Math.random());
      floaters.push({
        x:               Math.random() * widthPx,
        y:               Math.random() * heightPx,
        vx:              Math.cos(angleRad) * speed,
        vy:              Math.sin(angleRad) * speed,
        radiusFraction:  FLOATER_RADIUS_MIN_FRACTION + Math.random() * (FLOATER_RADIUS_MAX_FRACTION - FLOATER_RADIUS_MIN_FRACTION),
        opacityBase:     0.15 + Math.random() * 0.35,
        opacityPhase:    Math.random() * TWO_PI,
        opacityFreqHz:   0.08 + Math.random() * 0.12,
      });
    }

    // Create connections between random pairs of floaters
    for (let i = 0; i < CONNECTION_COUNT; i++) {
      const fromIdx = Math.floor(Math.random() * FLOATER_COUNT);
      let toIdx     = Math.floor(Math.random() * FLOATER_COUNT);
      if (toIdx === fromIdx) toIdx = (fromIdx + 1) % FLOATER_COUNT;
      connections.push({ fromIdx, toIdx, strength: 0.3 + Math.random() * 0.7 });
    }

    // Create swimmers orbiting random floaters
    for (let i = 0; i < SWIMMER_COUNT; i++) {
      const orbitIdx = Math.floor(Math.random() * FLOATER_COUNT);
      const f        = floaters[orbitIdx];
      const angleRad = Math.random() * TWO_PI;
      const orbitR   = SWIMMER_ORBIT_RADIUS_MIN_PX + Math.random() * (SWIMMER_ORBIT_RADIUS_MAX_PX - SWIMMER_ORBIT_RADIUS_MIN_PX);
      swimmers.push({
        targetFloaterIndex: orbitIdx,
        orbitCenterX:  f.x,
        orbitCenterY:  f.y,
        orbitRadiusPx: orbitR,
        angleRad,
        speedRadS:     SWIMMER_ORBIT_SPEED_RAD_S * (0.5 + Math.random()),
        sizeScale:     0.5 + Math.random() * 1.0,
        x:             f.x + Math.cos(angleRad) * orbitR,
        y:             f.y + Math.sin(angleRad) * orbitR,
        visibility:    Math.random(),
      });
    }
  }

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    const isResized = !floaters.length || Math.abs(widthPx - vpW) > 50 || Math.abs(heightPx - vpH) > 50;
    vpW = widthPx;
    vpH = heightPx;
    if (isResized) initialize(widthPx, heightPx);

    const dtSec = lastTs === null ? 0.016 : Math.min((nowMs - lastTs) / 1000, 0.1);
    lastTs = nowMs;

    const nowSec       = nowMs / 1000;
    const minDimPx     = Math.min(widthPx, heightPx);
    ensureSwimmerSprite(minDimPx);

    // Advance floaters with gentle drift and viewport wrapping
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      f.x += f.vx * dtSec;
      f.y += f.vy * dtSec;

      const margin = f.radiusFraction * minDimPx * 2;
      if      (f.x < -margin)           { f.x += widthPx  + margin * 2; }
      else if (f.x >  widthPx + margin) { f.x -= widthPx  + margin * 2; }
      if      (f.y < -margin)           { f.y += heightPx + margin * 2; }
      else if (f.y >  heightPx + margin){ f.y -= heightPx + margin * 2; }

      // Pulsating opacity
      floaters[i].opacityBase = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(nowSec * f.opacityFreqHz * TWO_PI + f.opacityPhase));
    }

    // Advance swimmers (orbit their floater)
    for (const sw of swimmers) {
      sw.angleRad  += sw.speedRadS * dtSec;
      const targetIdx = Math.min(sw.targetFloaterIndex, floaters.length - 1);
      const f = floaters[targetIdx];
      // Slowly drift orbit centre toward the target floater
      sw.orbitCenterX += (f.x - sw.orbitCenterX) * 0.002;
      sw.orbitCenterY += (f.y - sw.orbitCenterY) * 0.002;
      sw.x             = sw.orbitCenterX + Math.cos(sw.angleRad) * sw.orbitRadiusPx;
      sw.y             = sw.orbitCenterY + Math.sin(sw.angleRad) * sw.orbitRadiusPx;
      // Pulsate visibility
      sw.visibility    = 0.5 + 0.5 * Math.sin(nowSec * SWIMMER_PULSE_HZ * TWO_PI + sw.angleRad);
    }
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!floaters.length) return;

    const minDimPx      = Math.min(vpW, vpH);
    const connectionWidth = Math.max(0.4, minDimPx * 0.0014);

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Swimmer layer (drawn first, beneath lattice)
    if (swimmers.length && swimmerSprite) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const sw of swimmers) {
        const speedAlpha = Math.min(0.4, sw.visibility * 0.4);
        if (speedAlpha < 0.005) continue;
        const drawSize   = swimmerSprite.width * sw.sizeScale;
        const halfDraw   = drawSize * 0.5;
        ctx.globalAlpha  = speedAlpha;
        ctx.drawImage(swimmerSprite, sw.x - halfDraw, sw.y - halfDraw, drawSize, drawSize);
      }
      ctx.restore();
    }

    // Connection lines
    ctx.lineWidth = connectionWidth;
    for (const conn of connections) {
      const from = floaters[conn.fromIdx];
      const to   = floaters[conn.toIdx];
      if (!from || !to) continue;
      const alpha = Math.max(0, Math.min(1, conn.strength)) * 0.25;
      if (alpha <= 0) continue;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // Floater circles
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    for (const floater of floaters) {
      const opacity = Math.max(0, Math.min(1, floater.opacityBase));
      if (opacity <= 0) continue;
      const radius      = Math.max(2, floater.radiusFraction * minDimPx);
      const strokeWidth = Math.max(0.5, radius * 0.22);
      ctx.lineWidth    = strokeWidth;
      ctx.globalAlpha  = opacity * 0.25;
      ctx.beginPath();
      ctx.arc(floater.x, floater.y, radius, 0, TWO_PI);
      ctx.stroke();
    }

    ctx.restore();
  }

  function reset(): void {
    floaters    = [];
    connections = [];
    swimmers    = [];
    lastTs      = null;
    vpW         = 0;
    vpH         = 0;
  }

  return { update, draw, reset };
}
