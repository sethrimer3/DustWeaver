/**
 * ultraIceSparkleRenderer.ts — Sparkling overlay for ultra-ice blocks.
 *
 * Draws animated bright sparkle dots over every wall tile whose theme is
 * 'ultraIceBlock'.  The sparkles are rendered directly onto the main canvas
 * each frame (not cached) so the animation is smooth and frame-accurate.
 *
 * Design:
 *   - Each 8×8-block cell within an ultra-ice wall rectangle hosts a small
 *     pool of potential sparkle points.
 *   - Each point has a deterministic phase derived from its grid position,
 *     so sparkles don't flicker randomly but instead pulsate smoothly and
 *     independently.
 *   - Colours cycle through bright white → pale cyan → bright white with a
 *     subtle blue tint for an icy, glittering look.
 */

import type { WallSnapshot } from '../snapshotTypes';
import { indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../../levels/blockTheme';
import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';

/** Block size in world units — matches BLOCK_SIZE_MEDIUM from roomDef. */
const BLOCK_PX = BLOCK_SIZE_MEDIUM;

/**
 * Number of sparkle candidates per block cell.
 * Each candidate has its own phase so only a fraction are visible at once.
 */
const SPARKLES_PER_CELL = 3;

/** Duration of one sparkle pulse cycle in milliseconds. */
const SPARKLE_CYCLE_MS = 1400;

/** Fraction of the cycle during which a sparkle is visible (0–1). */
const SPARKLE_DUTY = 0.35;

/** Maximum alpha for a sparkle at peak brightness. */
const SPARKLE_MAX_ALPHA = 0.85;

/**
 * A lightweight deterministic hash that maps two integers to a float in [0, 1).
 * Used to give each sparkle candidate a stable, unique phase offset.
 */
function _hash2(a: number, b: number): number {
  let x = (a * 2654435761) ^ (b * 2246822519);
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x);
  return (x >>> 0) / 0xFFFFFFFF;
}

/**
 * Draws sparkling pixel highlights over all ultra-ice walls visible in
 * `snapshot`.
 *
 * @param ctx        The 2D canvas context to draw into.
 * @param snapshot   Current world snapshot (walls array used for geometry/theme).
 * @param nowMs      Current wall-clock time in milliseconds (for animation).
 * @param offsetXPx  Camera X offset (world→screen translation, pixels).
 * @param offsetYPx  Camera Y offset.
 * @param scalePx    Zoom scale (world units → pixels).
 * @param vpWidth    Viewport width in pixels (for rough culling).
 * @param vpHeight   Viewport height in pixels (for rough culling).
 */
export function renderUltraIceSparkles(
  ctx: CanvasRenderingContext2D,
  snapshot: WallSnapshot,
  nowMs: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  vpWidth: number,
  vpHeight: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const spritePx = BLOCK_PX * scalePx; // screen size of one block cell

  for (let wi = 0; wi < snapshot.count; wi++) {
    const themeIdx = snapshot.themeIndex[wi];
    if (themeIdx === WALL_THEME_DEFAULT_INDEX) continue;
    const theme = indexToBlockTheme(themeIdx);
    if (theme !== 'ultraIceBlock') continue;

    // Screen-space bounds of this wall rectangle.
    const sx = snapshot.xWorld[wi] * scalePx + offsetXPx;
    const sy = snapshot.yWorld[wi] * scalePx + offsetYPx;
    const sw = snapshot.wWorld[wi] * scalePx;
    const sh = snapshot.hWorld[wi] * scalePx;

    // Rough viewport cull — skip walls entirely off-screen.
    if (sx + sw < 0 || sy + sh < 0 || sx > vpWidth || sy > vpHeight) continue;

    // Iterate block cells within this wall.
    const cellCols = Math.ceil(snapshot.wWorld[wi] / BLOCK_PX);
    const cellRows = Math.ceil(snapshot.hWorld[wi] / BLOCK_PX);

    for (let col = 0; col < cellCols; col++) {
      for (let row = 0; row < cellRows; row++) {
        // Top-left of this cell in screen space.
        const cellX = sx + col * spritePx;
        const cellY = sy + row * spritePx;

        // Wall index as part of seed to distinguish identical-looking cells
        // across different walls.
        const wallSeed = wi * 997;

        for (let k = 0; k < SPARKLES_PER_CELL; k++) {
          // Unique deterministic seed for this sparkle candidate.
          const seed = wallSeed + col * 37 + row * 13 + k * 7;

          // Sub-cell position (0–1 fractions within the cell).
          const fx = _hash2(seed, 0);
          const fy = _hash2(seed, 1);

          // Phase offset so each sparkle activates at a different time.
          const phaseOffset = _hash2(seed, 2) * SPARKLE_CYCLE_MS;
          const t = ((nowMs + phaseOffset) % SPARKLE_CYCLE_MS) / SPARKLE_CYCLE_MS;

          // Compute brightness: triangle wave with duty cycle SPARKLE_DUTY.
          let alpha = 0;
          if (t < SPARKLE_DUTY) {
            // Rise then fall within the duty window.
            const ht = SPARKLE_DUTY * 0.5;
            const dt = t < ht ? t / ht : (SPARKLE_DUTY - t) / ht;
            alpha = dt * SPARKLE_MAX_ALPHA;
          }
          if (alpha <= 0) continue;

          // Deterministic colour variation: blend from pure white to pale cyan.
          const colourVariation = _hash2(seed, 3);
          const r = Math.round(210 + colourVariation * 45);     // 210–255
          const g = Math.round(230 + colourVariation * 25);     // 230–255
          const b = 255;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = `rgb(${r},${g},${b})`;

          // Draw a 1×1 or 2×2 pixel dot depending on zoom level.
          const dotPx = scalePx >= 2 ? 2 : 1;
          const px = Math.round(cellX + fx * spritePx);
          const py = Math.round(cellY + fy * spritePx);
          ctx.fillRect(px, py, dotPx, dotPx);
        }
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
