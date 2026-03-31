/**
 * Renders environmental hazards onto the virtual canvas.
 *
 * All coordinates are world-space, transformed by camera offset + zoom.
 * Drawing order: water/lava zones (background) → breakable blocks →
 *   springboards → spikes → jars → fireflies (foreground).
 */

import { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  SPIKE_DIR_UP,
  SPIKE_DIR_DOWN,
  SPIKE_DIR_LEFT,
  SPIKE_DIR_RIGHT,
} from '../sim/hazards';

const BLOCK_HALF = BLOCK_SIZE_MEDIUM * 0.5;

/**
 * Renders all environmental hazards.
 */
export function renderHazards(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
): void {
  ctx.save();

  // ── Water zones (semi-transparent blue) ────────────────────────────────
  for (let i = 0; i < world.waterZoneCount; i++) {
    const x = world.waterZoneXWorld[i] * zoom + offsetXPx;
    const y = world.waterZoneYWorld[i] * zoom + offsetYPx;
    const w = world.waterZoneWWorld[i] * zoom;
    const h = world.waterZoneHWorld[i] * zoom;

    // Animated surface wave
    const waveOffsetPx = Math.sin(tick * 0.08 + i) * 1.5 * zoom;

    ctx.fillStyle = 'rgba(30,100,200,0.25)';
    ctx.fillRect(x, y + waveOffsetPx, w, h - waveOffsetPx);

    // Surface line
    ctx.strokeStyle = 'rgba(80,160,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + waveOffsetPx);
    ctx.lineTo(x + w, y + waveOffsetPx);
    ctx.stroke();
  }

  // ── Lava zones (semi-transparent red/orange) ───────────────────────────
  for (let i = 0; i < world.lavaZoneCount; i++) {
    const x = world.lavaZoneXWorld[i] * zoom + offsetXPx;
    const y = world.lavaZoneYWorld[i] * zoom + offsetYPx;
    const w = world.lavaZoneWWorld[i] * zoom;
    const h = world.lavaZoneHWorld[i] * zoom;

    // Animated glow
    const glowAlpha = 0.25 + Math.sin(tick * 0.06 + i * 2) * 0.08;
    ctx.fillStyle = `rgba(220,60,10,${glowAlpha})`;
    ctx.fillRect(x, y, w, h);

    // Surface shimmer
    ctx.strokeStyle = 'rgba(255,140,0,0.55)';
    ctx.lineWidth = 1;
    const waveOff = Math.sin(tick * 0.1 + i * 3) * 1.2 * zoom;
    ctx.beginPath();
    ctx.moveTo(x, y + waveOff);
    ctx.lineTo(x + w, y + waveOff);
    ctx.stroke();
  }

  // ── Breakable blocks (cracked appearance) ──────────────────────────────
  for (let i = 0; i < world.breakableBlockCount; i++) {
    if (world.isBreakableBlockActiveFlag[i] === 0) continue;

    const bx = world.breakableBlockXWorld[i];
    const by = world.breakableBlockYWorld[i];
    const sx = (bx - BLOCK_HALF) * zoom + offsetXPx;
    const sy = (by - BLOCK_HALF) * zoom + offsetYPx;
    const sz = BLOCK_SIZE_MEDIUM * zoom;

    // Block fill — slightly different shade to indicate breakability
    ctx.fillStyle = 'rgba(140,110,70,0.7)';
    ctx.fillRect(sx, sy, sz, sz);

    // Crack lines
    ctx.strokeStyle = 'rgba(60,40,20,0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    // Diagonal crack top-left to center
    ctx.moveTo(sx + sz * 0.2, sy + sz * 0.1);
    ctx.lineTo(sx + sz * 0.5, sy + sz * 0.5);
    // Center to bottom-right
    ctx.lineTo(sx + sz * 0.8, sy + sz * 0.9);
    ctx.stroke();
    ctx.beginPath();
    // Horizontal crack
    ctx.moveTo(sx + sz * 0.1, sy + sz * 0.55);
    ctx.lineTo(sx + sz * 0.5, sy + sz * 0.5);
    ctx.lineTo(sx + sz * 0.9, sy + sz * 0.45);
    ctx.stroke();

    // Border
    ctx.strokeStyle = 'rgba(100,80,50,0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
  }

  // ── Springboards (metallic platform with spring coil) ──────────────────
  for (let i = 0; i < world.springboardCount; i++) {
    const sbx = world.springboardXWorld[i];
    const sby = world.springboardYWorld[i];
    const sbHalfW = BLOCK_HALF;
    const sbHalfH = BLOCK_SIZE_MEDIUM * 0.25;

    // Animation: compress when just triggered
    const animProgress = world.springboardAnimTicks[i] / 12;
    const compressY = animProgress * 2.0 * zoom;

    const sx = (sbx - sbHalfW) * zoom + offsetXPx;
    const sy = (sby - sbHalfH) * zoom + offsetYPx + compressY;
    const sw = BLOCK_SIZE_MEDIUM * zoom;
    const sh = BLOCK_SIZE_MEDIUM * 0.5 * zoom - compressY;

    // Platform top
    ctx.fillStyle = '#cc8800';
    ctx.fillRect(sx, sy, sw, Math.max(1, sh * 0.4));

    // Spring coil body
    ctx.fillStyle = '#886600';
    ctx.fillRect(sx + sw * 0.3, sy + sh * 0.4, sw * 0.4, Math.max(1, sh * 0.6));

    // Coil lines
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 0.7;
    const coilTop = sy + sh * 0.4;
    const coilBot = sy + sh;
    const coilH = coilBot - coilTop;
    for (let c = 0; c < 3; c++) {
      const cy2 = coilTop + (c + 0.5) * coilH / 3;
      ctx.beginPath();
      ctx.moveTo(sx + sw * 0.3, cy2);
      ctx.lineTo(sx + sw * 0.7, cy2);
      ctx.stroke();
    }
  }

  // ── Spikes (triangular shapes) ─────────────────────────────────────────
  for (let i = 0; i < world.spikeCount; i++) {
    const spx = world.spikeXWorld[i];
    const spy = world.spikeYWorld[i];
    const dir = world.spikeDirection[i];
    const half = BLOCK_HALF * zoom;

    const cx = spx * zoom + offsetXPx;
    const cy = spy * zoom + offsetYPx;

    ctx.fillStyle = '#888888';
    ctx.beginPath();

    if (dir === SPIKE_DIR_UP) {
      // Triangle pointing up
      ctx.moveTo(cx, cy - half);           // tip
      ctx.lineTo(cx - half, cy + half);    // bottom-left
      ctx.lineTo(cx + half, cy + half);    // bottom-right
    } else if (dir === SPIKE_DIR_DOWN) {
      ctx.moveTo(cx, cy + half);
      ctx.lineTo(cx - half, cy - half);
      ctx.lineTo(cx + half, cy - half);
    } else if (dir === SPIKE_DIR_LEFT) {
      ctx.moveTo(cx - half, cy);
      ctx.lineTo(cx + half, cy - half);
      ctx.lineTo(cx + half, cy + half);
    } else if (dir === SPIKE_DIR_RIGHT) {
      ctx.moveTo(cx + half, cy);
      ctx.lineTo(cx - half, cy - half);
      ctx.lineTo(cx - half, cy + half);
    }

    ctx.closePath();
    ctx.fill();

    // Metallic highlight
    ctx.strokeStyle = 'rgba(200,200,200,0.4)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // ── Dust boost jars ────────────────────────────────────────────────────
  for (let i = 0; i < world.dustBoostJarCount; i++) {
    if (world.isDustBoostJarActiveFlag[i] === 0) continue;

    const jx = world.dustBoostJarXWorld[i] * zoom + offsetXPx;
    const jy = world.dustBoostJarYWorld[i] * zoom + offsetYPx;
    const jarW = 6 * zoom;
    const jarH = 8 * zoom;

    // Jar body
    ctx.fillStyle = 'rgba(180,140,80,0.8)';
    ctx.fillRect(jx - jarW * 0.5, jy - jarH * 0.3, jarW, jarH * 0.6);

    // Jar neck
    ctx.fillStyle = 'rgba(160,120,60,0.8)';
    ctx.fillRect(jx - jarW * 0.25, jy - jarH * 0.5, jarW * 0.5, jarH * 0.2);

    // Lid
    ctx.fillStyle = 'rgba(200,160,80,0.9)';
    ctx.fillRect(jx - jarW * 0.35, jy - jarH * 0.55, jarW * 0.7, jarH * 0.1);

    // Glow based on dust kind colour
    const glowPulse = 0.3 + Math.sin(tick * 0.05 + i) * 0.15;
    ctx.fillStyle = `rgba(255,120,30,${glowPulse})`;
    ctx.fillRect(jx - jarW * 0.3, jy - jarH * 0.1, jarW * 0.6, jarH * 0.3);
  }

  // ── Firefly jars ───────────────────────────────────────────────────────
  for (let i = 0; i < world.fireflyJarCount; i++) {
    if (world.isFireflyJarActiveFlag[i] === 0) continue;

    const jx = world.fireflyJarXWorld[i] * zoom + offsetXPx;
    const jy = world.fireflyJarYWorld[i] * zoom + offsetYPx;
    const jarW = 6 * zoom;
    const jarH = 8 * zoom;

    // Jar body (glass-like)
    ctx.fillStyle = 'rgba(100,160,180,0.4)';
    ctx.fillRect(jx - jarW * 0.5, jy - jarH * 0.3, jarW, jarH * 0.6);

    // Jar neck
    ctx.fillStyle = 'rgba(80,140,160,0.5)';
    ctx.fillRect(jx - jarW * 0.25, jy - jarH * 0.5, jarW * 0.5, jarH * 0.2);

    // Cork lid
    ctx.fillStyle = 'rgba(160,120,60,0.9)';
    ctx.fillRect(jx - jarW * 0.3, jy - jarH * 0.55, jarW * 0.6, jarH * 0.1);

    // Firefly glow inside jar
    const glowPulse = 0.4 + Math.sin(tick * 0.08 + i * 3) * 0.2;
    ctx.fillStyle = `rgba(255,215,0,${glowPulse})`;
    ctx.fillRect(jx - 1 * zoom, jy - 1 * zoom, 2 * zoom, 2 * zoom);
  }

  // ── Fireflies (2×2 golden pixels) ─────────────────────────────────────
  for (let i = 0; i < world.fireflyCount; i++) {
    const fx = world.fireflyXWorld[i] * zoom + offsetXPx;
    const fy = world.fireflyYWorld[i] * zoom + offsetYPx;

    // Glow halo
    const glowAlpha = 0.2 + Math.sin(tick * 0.12 + i * 5) * 0.1;
    ctx.fillStyle = `rgba(255,215,0,${glowAlpha})`;
    ctx.fillRect(fx - 2 * zoom, fy - 2 * zoom, 4 * zoom, 4 * zoom);

    // Core 2×2 pixel
    const coreAlpha = 0.8 + Math.sin(tick * 0.15 + i * 7) * 0.15;
    ctx.fillStyle = `rgba(255,230,50,${coreAlpha})`;
    ctx.fillRect(fx - zoom, fy - zoom, 2 * zoom, 2 * zoom);
  }

  ctx.restore();
}
