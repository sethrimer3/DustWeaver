/**
 * Renders environmental hazards onto the virtual canvas.
 *
 * All coordinates are world-space, transformed by camera offset + zoom.
 * Drawing order: water/lava zones (background) → breakable blocks →
 *   springboards → spikes → jars → fireflies (foreground).
 *
 * Liquid zone rendering is delegated to liquidRenderer.ts, which handles
 * neighbor-aware rounded corners, sine-wave surfaces, and lava sparks.
 */

import { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  SPIKE_DIR_UP,
  SPIKE_DIR_DOWN,
  SPIKE_DIR_LEFT,
  SPIKE_DIR_RIGHT,
} from '../sim/hazards';
import { renderWaterZones, renderLavaZones } from './liquidRenderer';
import { renderIceMoteAuraOverlay } from './iceMoteAuraRenderer';
import { isScreenRectVisible } from './viewportCull';
import { SPIKE_TEMPLATE_VARIATIONS } from './walls/blockSpriteCatalog';
import { getProceduralSprite, hashTilePosition, OPEN_AIR_ALL_SIDES } from './walls/proceduralBlockSprite';
import { getFolderThemeBaseUrl } from './walls/folderBlockThemes';
import { getActiveFolderBlockThemeId, getActiveWorldNumberForSprites } from './walls/blockSpriteRenderer';

const BLOCK_HALF = BLOCK_SIZE_MEDIUM * 0.5;

/**
 * Rotation step (90° CW) to reorient an upward-facing spike template mask to
 * match the placed spike direction. Templates in ASSETS/SPRITES/BLOCKS/
 * block_templates/{1x1,2x2} spike/ face up by default.
 */
function _spikeDirRotStep(dir: number): number {
  switch (dir) {
    case SPIKE_DIR_RIGHT: return 1;
    case SPIKE_DIR_DOWN:  return 2;
    case SPIKE_DIR_LEFT:  return 3;
    default:              return 0; // SPIKE_DIR_UP
  }
}

/**
 * Draws a spike using the active room's block theme, cut out via a
 * deterministically-chosen variation template mask (same "cutout" technique
 * used for ramp/platform block shapes — see proceduralBlockSprite.ts).
 *
 * @returns `true` if the themed sprite was drawn; `false` when no folder-based
 *   theme is active or the sprite/template images have not finished loading
 *   yet, so the caller can fall back to the flat-triangle draw.
 */
function _drawThemedSpike(
  ctx: CanvasRenderingContext2D,
  spikeWorldX: number,
  spikeWorldY: number,
  screenCx: number,
  screenCy: number,
  screenHalf: number,
  sizeBlocks: number,
  dir: number,
): boolean {
  const themeId = getActiveFolderBlockThemeId();
  if (themeId === null) return false;

  const seed = getActiveWorldNumberForSprites();
  const colTopLeft = Math.round(spikeWorldX / BLOCK_SIZE_MEDIUM - sizeBlocks * 0.5);
  const rowTopLeft = Math.round(spikeWorldY / BLOCK_SIZE_MEDIUM - sizeBlocks * 0.5);

  const baseUrl = getFolderThemeBaseUrl(themeId, colTopLeft, rowTopLeft, seed);
  if (baseUrl === null) return false;

  const variations = sizeBlocks >= 2 ? SPIKE_TEMPLATE_VARIATIONS['2x2 spike'] : SPIKE_TEMPLATE_VARIATIONS['1x1 spike'];
  const variantHash = hashTilePosition(colTopLeft, rowTopLeft, seed);
  const templateUrl = variations[variantHash % variations.length];

  const dimPx = sizeBlocks * BLOCK_SIZE_MEDIUM;
  const sprite = getProceduralSprite(
    baseUrl, templateUrl, dimPx, dimPx,
    /* flipX */ false, /* flipY */ false, _spikeDirRotStep(dir),
    OPEN_AIR_ALL_SIDES,
    colTopLeft * BLOCK_SIZE_MEDIUM, rowTopLeft * BLOCK_SIZE_MEDIUM,
    seed, colTopLeft, rowTopLeft,
  );
  if (sprite === null) return false;

  ctx.drawImage(
    sprite,
    Math.round(screenCx - screenHalf), Math.round(screenCy - screenHalf),
    Math.round(screenHalf * 2), Math.round(screenHalf * 2),
  );
  return true;
}

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
  vpW = 480,
  vpH = 270,
): void {
  ctx.save();

  // ── Water zones (neighbor-aware rounded corners + wave surface) ──────────
  renderWaterZones(ctx, world, offsetXPx, offsetYPx, zoom, tick, vpW, vpH);

  // ── Ice Mote aura — frost overlay on temporarily frozen water zones ────────
  renderIceMoteAuraOverlay(ctx, world, offsetXPx, offsetYPx, zoom, vpW, vpH);

  // ── Lava zones (neighbor-aware rounded corners + wave + spark particles) ─
  renderLavaZones(ctx, world, offsetXPx, offsetYPx, zoom, tick, vpW, vpH);

  // ── Breakable blocks (cracked appearance) ──────────────────────────────
  for (let i = 0; i < world.breakableBlockCount; i++) {
    if (world.isBreakableBlockActiveFlag[i] === 0) continue;

    const bx = world.breakableBlockXWorld[i];
    const by = world.breakableBlockYWorld[i];
    const sx = (bx - BLOCK_HALF) * zoom + offsetXPx;
    const sy = (by - BLOCK_HALF) * zoom + offsetYPx;
    const sz = BLOCK_SIZE_MEDIUM * zoom;

    if (!isScreenRectVisible(sx, sy, sz, sz, vpW, vpH)) continue;

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

    if (!isScreenRectVisible(sx, sy, sz, sz, vpW, vpH)) continue;

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

    if (!isScreenRectVisible(px, py, pw, ph, vpW, vpH)) continue;

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

  // ── Kinetic blocks (pulsing blue glow) ────────────────────────────────────
  for (let i = 0; i < world.kineticBlockCount; i++) {
    const kx = world.kineticBlockXWorld[i];
    const ky = world.kineticBlockYWorld[i];
    const kw = world.kineticBlockWWorld[i];
    const kh = world.kineticBlockHWorld[i];
    const phase = world.kineticBlockAnimPhase[i];
    const t = (phase / 255) * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(t);

    const bx = kx * zoom + offsetXPx;
    const by = ky * zoom + offsetYPx;
    const bw = kw * zoom;
    const bh = kh * zoom;

    // Block body: deep blue
    ctx.fillStyle = '#1a1a5e';
    ctx.fillRect(bx, by, bw, bh);

    // Pulsing blue border
    const glowAlpha = (0.5 + 0.5 * pulse).toFixed(2);
    ctx.strokeStyle = `rgba(80,140,255,${glowAlpha})`;
    ctx.lineWidth = zoom;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    // Decorative upward arrow — purely visual, actual launch direction depends on contact face
    const cx = bx + bw * 0.5;
    const cy = by + bh * 0.5;
    const arrowLen = Math.min(bw, bh) * 0.35;
    ctx.strokeStyle = `rgba(150,200,255,${glowAlpha})`;
    ctx.lineWidth = zoom;
    ctx.beginPath();
    ctx.moveTo(cx, cy + arrowLen);
    ctx.lineTo(cx, cy - arrowLen);
    ctx.lineTo(cx - arrowLen * 0.4, cy - arrowLen * 0.5);
    ctx.moveTo(cx, cy - arrowLen);
    ctx.lineTo(cx + arrowLen * 0.4, cy - arrowLen * 0.5);
    ctx.stroke();
  }

  // ── Springboards (metallic platform with spring coil) ──────────────────
  for (let i = 0; i < world.springboardCount; i++) {
    const sbx = world.springboardXWorld[i];
    const sby = world.springboardYWorld[i];
    const sbHalfW = BLOCK_HALF;
    const sbHalfH = BLOCK_SIZE_MEDIUM * 0.25;

    const sx = (sbx - sbHalfW) * zoom + offsetXPx;
    const sy = (sby - sbHalfH) * zoom + offsetYPx;
    const sw = BLOCK_SIZE_MEDIUM * zoom;
    const sh = BLOCK_SIZE_MEDIUM * 0.5 * zoom;
    if (!isScreenRectVisible(sx - 2, sy - 2, sw + 4, sh + 4, vpW, vpH)) continue;

    // Animation: compress when just triggered
    const animProgress = world.springboardAnimTicks[i] / 12;
    const compressY = animProgress * 2.0 * zoom;
    const drawSy = sy + compressY;
    const drawSh = sh - compressY;

    // Platform top
    ctx.fillStyle = '#cc8800';
    ctx.fillRect(sx, drawSy, sw, Math.max(1, drawSh * 0.4));

    // Spring coil body
    ctx.fillStyle = '#886600';
    ctx.fillRect(sx + sw * 0.3, drawSy + drawSh * 0.4, sw * 0.4, Math.max(1, drawSh * 0.6));

    // Coil lines
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 0.7;
    const coilTop = drawSy + drawSh * 0.4;
    const coilBot = drawSy + drawSh;
    const coilH = coilBot - coilTop;
    for (let c = 0; c < 3; c++) {
      const cy2 = coilTop + (c + 0.5) * coilH / 3;
      ctx.beginPath();
      ctx.moveTo(sx + sw * 0.3, cy2);
      ctx.lineTo(sx + sw * 0.7, cy2);
      ctx.stroke();
    }
  }

  // ── Spikes (themed cutout, falls back to a flat triangle) ──────────────
  for (let i = 0; i < world.spikeCount; i++) {
    const spx = world.spikeXWorld[i];
    const spy = world.spikeYWorld[i];
    const dir = world.spikeDirection[i];
    const sizeBlocks = world.spikeSizeBlocks[i] || 1;
    const half = sizeBlocks * BLOCK_HALF * zoom;

    const cx = spx * zoom + offsetXPx;
    const cy = spy * zoom + offsetYPx;

    if (!isScreenRectVisible(cx - half - 1, cy - half - 1, half * 2 + 2, half * 2 + 2, vpW, vpH)) continue;

    const drawn = _drawThemedSpike(ctx, spx, spy, cx, cy, half, sizeBlocks, dir);
    if (drawn) continue;

    // ── Fallback: flat triangle (theme not yet resolvable — e.g. legacy
    // per-world sprite rooms with no explicit folder-based blockTheme) ──────
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

    if (!isScreenRectVisible(jx - jarW, jy - jarH, jarW * 2, jarH * 1.5, vpW, vpH)) continue;

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

    if (!isScreenRectVisible(jx - jarW, jy - jarH, jarW * 2, jarH * 1.5, vpW, vpH)) continue;

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

    if (!isScreenRectVisible(fx - 4 * zoom, fy - 4 * zoom, 8 * zoom, 8 * zoom, vpW, vpH)) continue;

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
