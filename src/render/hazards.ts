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

  // ── Water zones (depth-gradient fill + 3-wave surface + caustics + foam) ─
  for (let i = 0; i < world.waterZoneCount; i++) {
    const x = world.waterZoneXWorld[i] * zoom + offsetXPx;
    const y = world.waterZoneYWorld[i] * zoom + offsetYPx;
    const w = world.waterZoneWWorld[i] * zoom;
    const h = world.waterZoneHWorld[i] * zoom;

    // Three overlapping surface waves with different frequencies and phases
    const wave1 = Math.sin(tick * 0.08 + i * 1.3) * 1.5 * zoom;
    const wave2 = Math.sin(tick * 0.05 + i * 0.7 + 1.0) * 0.8 * zoom;
    const wave3 = Math.sin(tick * 0.12 + i * 2.1 + 2.5) * 0.5 * zoom;
    const surfaceOffsetPx = wave1 + wave2 + wave3;

    const surfaceY = y + surfaceOffsetPx;

    // Depth gradient: lighter cyan at top fading to deeper blue at bottom
    const grad = ctx.createLinearGradient(0, surfaceY, 0, y + h);
    grad.addColorStop(0.0, 'rgba(100,190,255,0.35)');
    grad.addColorStop(0.4, 'rgba(40,120,220,0.45)');
    grad.addColorStop(1.0, 'rgba(10,60,160,0.60)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, surfaceY, w, h - surfaceOffsetPx);

    // Animated caustic dots — scattered bright flecks simulating light refraction
    const causticSeed = tick * 0.04 + i * 17.3;
    ctx.fillStyle = 'rgba(160,220,255,0.18)';
    for (let c = 0; c < 6; c++) {
      const cx = x + ((Math.sin(causticSeed + c * 2.3) * 0.5 + 0.5)) * w;
      const cy = surfaceY + 3 * zoom + ((Math.cos(causticSeed * 0.7 + c * 1.9) * 0.5 + 0.5)) * (h * 0.6);
      const cr = (0.6 + Math.sin(causticSeed + c) * 0.4) * zoom;
      ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }

    // Foam line at the surface
    ctx.strokeStyle = 'rgba(200,240,255,0.55)';
    ctx.lineWidth = zoom * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, surfaceY);
    // Slightly wavy foam edge using a second small wave
    for (let fx = 0; fx <= w; fx += zoom * 2) {
      const foamY = surfaceY + Math.sin(tick * 0.15 + fx * 0.05 + i) * 0.4 * zoom;
      ctx.lineTo(x + fx, foamY);
    }
    ctx.stroke();

    // Secondary, dimmer wave line slightly below the surface
    ctx.strokeStyle = 'rgba(80,160,255,0.30)';
    ctx.lineWidth = zoom * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, surfaceY + 2 * zoom);
    ctx.lineTo(x + w, surfaceY + 2 * zoom);
    ctx.stroke();
  }

  // ── Lava zones (pulsing glow + depth gradient + hot-spot dots) ────────
  for (let i = 0; i < world.lavaZoneCount; i++) {
    const x = world.lavaZoneXWorld[i] * zoom + offsetXPx;
    const y = world.lavaZoneYWorld[i] * zoom + offsetYPx;
    const w = world.lavaZoneWWorld[i] * zoom;
    const h = world.lavaZoneHWorld[i] * zoom;

    // Pulsing base glow with slight per-zone phase offset
    const pulse = 0.30 + Math.sin(tick * 0.06 + i * 2.1) * 0.08;

    // Depth gradient: bright orange at surface, deep red at bottom
    const lavaGrad = ctx.createLinearGradient(0, y, 0, y + h);
    lavaGrad.addColorStop(0.0, `rgba(255,120,20,${pulse})`);
    lavaGrad.addColorStop(0.5, `rgba(220,50,5,${pulse * 0.9})`);
    lavaGrad.addColorStop(1.0, `rgba(140,20,0,${pulse * 1.2})`);
    ctx.fillStyle = lavaGrad;
    ctx.fillRect(x, y, w, h);

    // Hot-spot dots — bright orange blobs drifting up from the depths
    const hotSeed = tick * 0.03 + i * 11.7;
    for (let d = 0; d < 5; d++) {
      const dotX = x + ((Math.sin(hotSeed * 0.8 + d * 3.1) * 0.5 + 0.5)) * w;
      // Dots rise slowly and wrap at the top
      const rawY = ((hotSeed * 0.4 + d * 0.7) % 1.0);
      const dotY = y + h - rawY * h * 1.2;
      if (dotY < y) continue;
      const dotR = (0.8 + Math.sin(hotSeed + d * 2.7) * 0.4) * zoom;
      const dotAlpha = 0.25 + Math.sin(hotSeed * 1.3 + d) * 0.12;
      ctx.fillStyle = `rgba(255,160,40,${dotAlpha})`;
      ctx.fillRect(dotX - dotR, dotY - dotR, dotR * 2, dotR * 2);
    }

    // Animated surface shimmer — two overlapping waves
    const shim1 = Math.sin(tick * 0.10 + i * 3.0) * 1.2 * zoom;
    const shim2 = Math.sin(tick * 0.07 + i * 1.4 + 1.8) * 0.6 * zoom;
    const shimY = shim1 + shim2;

    ctx.strokeStyle = 'rgba(255,160,30,0.65)';
    ctx.lineWidth = zoom * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y + shimY);
    ctx.lineTo(x + w, y + shimY);
    ctx.stroke();

    // Secondary crust line
    ctx.strokeStyle = 'rgba(200,60,0,0.40)';
    ctx.lineWidth = zoom * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y + shimY + 2 * zoom);
    ctx.lineTo(x + w, y + shimY + 2 * zoom);
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

  // ── Crumble blocks (fragile appearance — sandy fill + cracks based on damage) ──
  for (let i = 0; i < world.crumbleBlockCount; i++) {
    if (world.isCrumbleBlockActiveFlag[i] === 0) continue;

    const bx = world.crumbleBlockXWorld[i];
    const by = world.crumbleBlockYWorld[i];
    const sx = (bx - BLOCK_HALF) * zoom + offsetXPx;
    const sy = (by - BLOCK_HALF) * zoom + offsetYPx;
    const sz = BLOCK_SIZE_MEDIUM * zoom;

    const isCracked = world.crumbleBlockHitsRemaining[i] <= 1;

    // Fill: sandy tan when intact, darker and more jagged when cracked
    ctx.fillStyle = isCracked ? 'rgba(160,130,80,0.75)' : 'rgba(210,190,140,0.65)';
    ctx.fillRect(sx, sy, sz, sz);

    if (isCracked) {
      // Heavy crack lines when damaged
      ctx.strokeStyle = 'rgba(80,50,20,0.85)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      // Main diagonal crack
      ctx.moveTo(sx + sz * 0.2, sy + sz * 0.1);
      ctx.lineTo(sx + sz * 0.5, sy + sz * 0.45);
      ctx.lineTo(sx + sz * 0.8, sy + sz * 0.9);
      // Secondary crack branch
      ctx.moveTo(sx + sz * 0.5, sy + sz * 0.45);
      ctx.lineTo(sx + sz * 0.75, sy + sz * 0.3);
      ctx.stroke();
    } else {
      // Light hairline cracks when intact (shows fragility)
      ctx.strokeStyle = 'rgba(140,100,50,0.50)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx + sz * 0.3, sy + sz * 0.2);
      ctx.lineTo(sx + sz * 0.5, sy + sz * 0.5);
      ctx.lineTo(sx + sz * 0.7, sy + sz * 0.3);
      ctx.stroke();
    }

    // Thin border
    ctx.strokeStyle = isCracked ? 'rgba(100,70,30,0.60)' : 'rgba(160,120,60,0.45)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
  }

  // ── Bounce pads (reflective blocks with animated glowing core) ──────────
  for (let i = 0; i < world.bouncePadCount; i++) {
    const bpX = world.bouncePadXWorld[i];
    const bpY = world.bouncePadYWorld[i];
    const bpW = world.bouncePadWWorld[i];
    const bpH = world.bouncePadHWorld[i];
    const sfIdx = world.bouncePadSpeedFactorIndex[i];
    const rampOri = world.bouncePadRampOrientationIndex[i];

    const px = bpX * zoom + offsetXPx;
    const py = bpY * zoom + offsetYPx;
    const pw = bpW * zoom;
    const ph = bpH * zoom;

    // ── Draw block body / ramp shape ─────────────────────────────────────
    ctx.fillStyle = sfIdx === 1 ? 'rgba(80,40,10,0.85)' : 'rgba(60,30,8,0.80)';
    ctx.strokeStyle = sfIdx === 1 ? 'rgba(255,140,30,0.75)' : 'rgba(200,80,10,0.55)';
    ctx.lineWidth = zoom * 0.8;

    if (rampOri === 255 || rampOri === undefined) {
      // Solid rectangle
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeRect(px, py, pw, ph);
    } else {
      // Ramp triangle
      ctx.beginPath();
      switch (rampOri) {
        case 0: ctx.moveTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px + pw, py); break;
        case 1: ctx.moveTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px, py);       break;
        case 2: ctx.moveTo(px, py);       ctx.lineTo(px + pw, py);       ctx.lineTo(px + pw, py + ph); break;
        case 3: ctx.moveTo(px, py);       ctx.lineTo(px + pw, py);       ctx.lineTo(px, py + ph);       break;
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // ── Glowing core — each pixel cycles at its own speed through orange palette ─
    // Dim (sfIdx=0): 2×2 pixel core;  Bright (sfIdx=1): 4×4 pixel core.
    const corePixels = sfIdx === 1 ? 4 : 2;
    const pixWorld = 1.0; // 1 world unit = 1 virtual pixel
    const pixPx = pixWorld * zoom;

    // Center the core inside the block
    const coreCenterXWorld = bpX + bpW * 0.5;
    const coreCenterYWorld = bpY + bpH * 0.5;
    const coreStartXWorld = coreCenterXWorld - corePixels * 0.5 * pixWorld;
    const coreStartYWorld = coreCenterYWorld - corePixels * 0.5 * pixWorld;

    for (let cy2 = 0; cy2 < corePixels; cy2++) {
      for (let cx2 = 0; cx2 < corePixels; cx2++) {
        // Each pixel gets a unique phase seed derived from its position + bounce pad index
        const pixSeed = i * 37 + cy2 * 11 + cx2 * 7;
        // Three cadence tiers (0.03, 0.07, 0.13) chosen by pixel seed
        const cadenceTier = pixSeed % 3;
        const freq = cadenceTier === 0 ? 0.03 : cadenceTier === 1 ? 0.07 : 0.13;
        const phase = (pixSeed * 1.61803) % (Math.PI * 2);
        // t oscillates 0..1
        const t2 = (Math.sin(tick * freq + phase) * 0.5 + 0.5);

        // Interpolate between dark red (#8B0000) and warm yellow (#FFD040) through orange
        let r: number;
        let g: number;
        let b: number;
        if (t2 < 0.5) {
          // dark red → orange: r stays near 200-255, g goes 0→120, b stays 0
          const s = t2 * 2.0;
          r = Math.round(140 + s * 115);   // 140 → 255
          g = Math.round(s * 100);          // 0 → 100
          b = 0;
        } else {
          // orange → warm yellow: r stays 255, g goes 100→208, b 0→64
          const s = (t2 - 0.5) * 2.0;
          r = 255;
          g = Math.round(100 + s * 108);   // 100 → 208
          b = Math.round(s * 40);           // 0 → 40
        }
        const alpha = sfIdx === 1 ? (0.75 + t2 * 0.25) : (0.55 + t2 * 0.30);

        const cxPx = (coreStartXWorld + cx2 * pixWorld) * zoom + offsetXPx;
        const cyPx = (coreStartYWorld + cy2 * pixWorld) * zoom + offsetYPx;
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
        ctx.fillRect(cxPx, cyPx, pixPx, pixPx);

        // Extra bloom glow for bright pads
        if (sfIdx === 1) {
          const glowAlpha = (t2 * 0.25).toFixed(2);
          ctx.fillStyle = `rgba(${r},${g},${b},${glowAlpha})`;
          ctx.fillRect(cxPx - pixPx * 0.5, cyPx - pixPx * 0.5, pixPx * 2, pixPx * 2);
        }
      }
    }
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
