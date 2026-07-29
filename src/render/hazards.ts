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
import { BLOCK_SIZE_MEDIUM, indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../levels/roomDef';
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

/** Faint dark-red outline colour for placed spikes (matches the player's outline convention). */
const SPIKE_OUTLINE_COLOR: readonly [number, number, number] = [139, 0, 0];
/** Outline opacity (25%), applied via ctx.globalAlpha at draw time. */
const SPIKE_OUTLINE_ALPHA = 0.25;
/** 1 virtual pixel outline thickness, matching PLAYER_OUTLINE_THICKNESS_WORLD. */
const SPIKE_OUTLINE_THICKNESS_WORLD = 1;
/** 4-neighbour outline morphology keeps pixel-art corners cut off (mirrors characterSprites.ts). */
const _spikeOutlineNeighborOffsets: ReadonlyArray<readonly [number, number]> = [
            [0, -1],
  [-1,  0],          [1,  0],
            [0,  1],
];
/** Precomputed outer-edge outline masks keyed by the source spike sprite canvas. */
const _spikeOutlineMaskCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/**
 * Builds a faint dark-red outer-silhouette outline mask for a spike sprite,
 * using the same outer-edge-only, no-corners flood-fill technique as the
 * player's outline (characterSprites.ts:getOrCreateOuterOutlineMask), just
 * recoloured and drawn at 25% opacity instead of solid black.
 *
 * Excludes interior transparent holes (flood-fills only the transparency
 * region connected to the canvas border), so only the true outer silhouette
 * gets outlined — correct for the jagged/triangular spike cutout shapes.
 */
function _getOrCreateSpikeOutlineMask(sprite: HTMLCanvasElement): HTMLCanvasElement {
  const cached = _spikeOutlineMaskCache.get(sprite);
  if (cached !== undefined) return cached;

  const spriteWidthPx = sprite.width;
  const spriteHeightPx = sprite.height;
  const paddedWidthPx = spriteWidthPx + 2;
  const paddedHeightPx = spriteHeightPx + 2;
  const pixelCount = paddedWidthPx * paddedHeightPx;

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = paddedWidthPx;
  alphaCanvas.height = paddedHeightPx;
  const alphaCtx = alphaCanvas.getContext('2d');
  if (alphaCtx === null) {
    _spikeOutlineMaskCache.set(sprite, alphaCanvas);
    return alphaCanvas;
  }
  alphaCtx.clearRect(0, 0, paddedWidthPx, paddedHeightPx);
  alphaCtx.drawImage(sprite, 1, 1);
  const alphaData = alphaCtx.getImageData(0, 0, paddedWidthPx, paddedHeightPx).data;

  const isOpaqueFlag = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    isOpaqueFlag[pixelIndex] = alphaData[pixelIndex * 4 + 3] > 0 ? 1 : 0;
  }

  const isOutsideFlag = new Uint8Array(pixelCount);
  const queueX = new Int16Array(pixelCount);
  const queueY = new Int16Array(pixelCount);
  let queueReadIndex = 0;
  let queueWriteIndex = 0;

  const enqueueIfOutside = (xPx: number, yPx: number): void => {
    const idx = yPx * paddedWidthPx + xPx;
    if (isOpaqueFlag[idx] === 1 || isOutsideFlag[idx] === 1) return;
    isOutsideFlag[idx] = 1;
    queueX[queueWriteIndex] = xPx;
    queueY[queueWriteIndex] = yPx;
    queueWriteIndex++;
  };

  for (let xPx = 0; xPx < paddedWidthPx; xPx++) {
    enqueueIfOutside(xPx, 0);
    enqueueIfOutside(xPx, paddedHeightPx - 1);
  }
  for (let yPx = 1; yPx < paddedHeightPx - 1; yPx++) {
    enqueueIfOutside(0, yPx);
    enqueueIfOutside(paddedWidthPx - 1, yPx);
  }

  while (queueReadIndex < queueWriteIndex) {
    const xPx = queueX[queueReadIndex];
    const yPx = queueY[queueReadIndex];
    queueReadIndex++;

    if (xPx > 0) enqueueIfOutside(xPx - 1, yPx);
    if (xPx < paddedWidthPx - 1) enqueueIfOutside(xPx + 1, yPx);
    if (yPx > 0) enqueueIfOutside(xPx, yPx - 1);
    if (yPx < paddedHeightPx - 1) enqueueIfOutside(xPx, yPx + 1);
  }

  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = paddedWidthPx;
  outlineCanvas.height = paddedHeightPx;
  const outlineCtx = outlineCanvas.getContext('2d');
  if (outlineCtx === null) {
    _spikeOutlineMaskCache.set(sprite, outlineCanvas);
    return outlineCanvas;
  }

  const outlineImage = outlineCtx.createImageData(paddedWidthPx, paddedHeightPx);
  const outlinePixels = outlineImage.data;
  for (let yPx = 0; yPx < paddedHeightPx; yPx++) {
    for (let xPx = 0; xPx < paddedWidthPx; xPx++) {
      const idx = yPx * paddedWidthPx + xPx;
      if (isOutsideFlag[idx] === 0) continue;

      let hasOpaqueNeighbor = false;
      for (let n = 0; n < _spikeOutlineNeighborOffsets.length; n++) {
        const nx = xPx + _spikeOutlineNeighborOffsets[n][0];
        const ny = yPx + _spikeOutlineNeighborOffsets[n][1];
        if (nx < 0 || nx >= paddedWidthPx || ny < 0 || ny >= paddedHeightPx) continue;
        if (isOpaqueFlag[ny * paddedWidthPx + nx] === 1) {
          hasOpaqueNeighbor = true;
          break;
        }
      }
      if (!hasOpaqueNeighbor) continue;

      const dataIndex = idx * 4;
      outlinePixels[dataIndex] = SPIKE_OUTLINE_COLOR[0];
      outlinePixels[dataIndex + 1] = SPIKE_OUTLINE_COLOR[1];
      outlinePixels[dataIndex + 2] = SPIKE_OUTLINE_COLOR[2];
      outlinePixels[dataIndex + 3] = 255;
    }
  }
  outlineCtx.putImageData(outlineImage, 0, 0);
  _spikeOutlineMaskCache.set(sprite, outlineCanvas);
  return outlineCanvas;
}

/**
 * Draws a spike using its block theme (per-spike override or the active
 * room theme), cut out via a deterministically-chosen variation template
 * mask (same "cutout" technique used for ramp/platform block shapes — see
 * proceduralBlockSprite.ts), with a faint dark-red outer-silhouette outline.
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
  zoom: number,
  themeIndex: number,
): boolean {
  const themeId = themeIndex === WALL_THEME_DEFAULT_INDEX
    ? getActiveFolderBlockThemeId()
    : indexToBlockTheme(themeIndex);
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

  // Outline first (underneath), matching the player's outline draw order —
  // the 1px silhouette peeks out around the sprite's real edges.
  const outlineThicknessPx = SPIKE_OUTLINE_THICKNESS_WORLD * zoom;
  const outlineMask = _getOrCreateSpikeOutlineMask(sprite);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = SPIKE_OUTLINE_ALPHA;
  ctx.drawImage(
    outlineMask,
    Math.round(screenCx - screenHalf - outlineThicknessPx), Math.round(screenCy - screenHalf - outlineThicknessPx),
    Math.round(screenHalf * 2 + outlineThicknessPx * 2), Math.round(screenHalf * 2 + outlineThicknessPx * 2),
  );
  ctx.globalAlpha = prevAlpha;

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
  rippleEffectsEnabled = true,
): void {
  ctx.save();

  // ── Water zones (neighbor-aware rounded corners + wave surface) ──────────
  renderWaterZones(ctx, world, offsetXPx, offsetYPx, zoom, tick, vpW, vpH, rippleEffectsEnabled);

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

    const drawn = _drawThemedSpike(ctx, spx, spy, cx, cy, half, sizeBlocks, dir, zoom, world.spikeBlockThemeIndex[i]);
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

  // ── Lasers (pulsating red/orange/white glowing beam) ────────────────────
  // Draws the sim's per-tick trace result (world.laserIncomingEndXWorld/YWorld,
  // and — when world.laserHasReflectionFlag[i] is set — the outgoing reflected
  // segment plus a contact flash). Rendering never recomputes collision
  // geometry; it only consumes what applyHazards already resolved this tick.
  const drawLaserGlowSegment = (
    x0World: number, y0World: number, x1World: number, y1World: number, phase: number,
  ): void => {
    const sx0 = x0World * zoom + offsetXPx;
    const sy0 = y0World * zoom + offsetYPx;
    const sx1 = x1World * zoom + offsetXPx;
    const sy1 = y1World * zoom + offsetYPx;
    const rectX = Math.min(sx0, sx1);
    const rectY = Math.min(sy0, sy1);
    const rectW = Math.max(Math.abs(sx1 - sx0), 1);
    const rectH = Math.max(Math.abs(sy1 - sy0), 1);
    const glowPad = 8 * zoom;
    if (!isScreenRectVisible(rectX - glowPad, rectY - glowPad, rectW + glowPad * 2, rectH + glowPad * 2, vpW, vpH)) return;

    const pulse = 0.5 + 0.5 * Math.sin(tick * 0.09 + phase);
    const angleRad = Math.atan2(sy1 - sy0, sx1 - sx0);
    const midXPx = (sx0 + sx1) * 0.5;
    const midYPx = (sy0 + sy1) * 0.5;
    const halfLenPx = Math.hypot(sx1 - sx0, sy1 - sy0) * 0.5;
    const halfThickPx = 3 * zoom;

    ctx.save();
    ctx.translate(midXPx, midYPx);
    ctx.rotate(angleRad);

    // Outer soft glow, widest and dimmest.
    const outerHalfThickPx = halfThickPx * (2.2 + pulse * 0.6);
    const glowGradient = ctx.createLinearGradient(0, -outerHalfThickPx, 0, outerHalfThickPx);
    glowGradient.addColorStop(0,   `rgba(255,70,20,0)`);
    glowGradient.addColorStop(0.5, `rgba(255,120,30,${(0.35 + pulse * 0.25).toFixed(2)})`);
    glowGradient.addColorStop(1,   `rgba(255,70,20,0)`);
    ctx.fillStyle = glowGradient;
    ctx.fillRect(-halfLenPx, -outerHalfThickPx, halfLenPx * 2, outerHalfThickPx * 2);

    // Core beam: white-hot center fading to orange/red at the edges.
    const coreHalfThickPx = halfThickPx * (0.85 + pulse * 0.3);
    const coreGradient = ctx.createLinearGradient(0, -coreHalfThickPx, 0, coreHalfThickPx);
    coreGradient.addColorStop(0,    `rgba(180,20,0,${(0.7 + pulse * 0.2).toFixed(2)})`);
    coreGradient.addColorStop(0.35, `rgba(255,90,0,${(0.85 + pulse * 0.15).toFixed(2)})`);
    coreGradient.addColorStop(0.5,  `rgba(255,240,210,${(0.9 + pulse * 0.1).toFixed(2)})`);
    coreGradient.addColorStop(0.65, `rgba(255,90,0,${(0.85 + pulse * 0.15).toFixed(2)})`);
    coreGradient.addColorStop(1,    `rgba(180,20,0,${(0.7 + pulse * 0.2).toFixed(2)})`);
    ctx.fillStyle = coreGradient;
    ctx.fillRect(-halfLenPx, -coreHalfThickPx, halfLenPx * 2, coreHalfThickPx * 2);

    ctx.restore();
  };

  for (let i = 0; i < world.laserCount; i++) {
    const lx = world.laserXWorld[i];
    const ly = world.laserYWorld[i];
    const phase = i * 2.4;

    // Incoming leg: emitter origin to either the terrain hit or the shield
    // contact point (see traceLaserBeam).
    drawLaserGlowSegment(lx, ly, world.laserIncomingEndXWorld[i], world.laserIncomingEndYWorld[i], phase);

    if (world.laserHasReflectionFlag[i] === 1) {
      // Contact flash at the shield surface.
      const fx = world.laserContactXWorld[i] * zoom + offsetXPx;
      const fy = world.laserContactYWorld[i] * zoom + offsetYPx;
      const flashPulse = 0.6 + 0.4 * Math.sin(tick * 0.4 + phase);
      const flashRadiusPx = (4 + flashPulse * 3) * zoom;
      if (isScreenRectVisible(fx - flashRadiusPx, fy - flashRadiusPx, flashRadiusPx * 2, flashRadiusPx * 2, vpW, vpH)) {
        const flashGradient = ctx.createRadialGradient(fx, fy, 0, fx, fy, flashRadiusPx);
        flashGradient.addColorStop(0, `rgba(255,250,230,${(0.85 * flashPulse).toFixed(2)})`);
        flashGradient.addColorStop(0.6, `rgba(255,150,60,${(0.5 * flashPulse).toFixed(2)})`);
        flashGradient.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = flashGradient;
        ctx.beginPath();
        ctx.arc(fx, fy, flashRadiusPx, 0, Math.PI * 2);
        ctx.fill();
      }

      // Outgoing reflected leg.
      drawLaserGlowSegment(
        world.laserOutgoingStartXWorld[i], world.laserOutgoingStartYWorld[i],
        world.laserOutgoingEndXWorld[i], world.laserOutgoingEndYWorld[i],
        phase + 1.1,
      );
    }
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
