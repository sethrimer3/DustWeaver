/**
 * Canvas text helpers for localized strings.
 *
 * Canvas-rendered UI cannot rely on CSS font fallback the way DOM text can, and
 * translated strings vary a lot in width. These helpers keep pixel-art text
 * crisp (integer device positions, nearest-neighbour friendly) while handling
 * accented / non-Latin glyphs, wrapping, and last-resort truncation.
 *
 * Pure with respect to game state: nothing here reads or writes simulation,
 * room, or save data.
 */

import type { TranslationParams } from './types';
import type { TranslationKey } from './catalogs/en';
import { getTextDirection, getUiFontFamily, t } from './runtime';

/** Minimal 2D context surface used here — keeps this module Node-testable. */
export interface TextMeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * Builds a canvas `font` string using the active locale's fallback stack, so
 * glyphs missing from the display face are supplied by a system font instead of
 * rendering as tofu boxes.
 */
export function localizedCanvasFont(sizePx: number, weight?: string): string {
  const weightPart = weight === undefined ? '' : `${weight} `;
  return `${weightPart}${Math.max(1, Math.round(sizePx))}px ${getUiFontFamily()}`;
}

/**
 * Truncates `text` with an ellipsis so it fits `maxWidthPx`.
 * Returns the original string when it already fits. Never returns `undefined`.
 */
export function truncateToWidth(
  ctx: TextMeasureContext,
  text: string,
  maxWidthPx: number,
): string {
  if (maxWidthPx <= 0) return '';
  if (ctx.measureText(text).width <= maxWidthPx) return text;
  const ellipsis = '…';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidthPx) low = mid;
    else high = mid - 1;
  }
  return low <= 0 ? ellipsis : text.slice(0, low) + ellipsis;
}

/**
 * Word-wraps `text` to `maxWidthPx`. Words longer than the line budget are
 * hard-truncated rather than overflowing the panel.
 */
export function wrapToWidth(
  ctx: TextMeasureContext,
  text: string,
  maxWidthPx: number,
): string[] {
  if (maxWidthPx <= 0) return [text];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidthPx) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    line = ctx.measureText(word).width <= maxWidthPx
      ? word
      : truncateToWidth(ctx, word, maxWidthPx);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * Resolves the x position and canvas `textAlign` for a logical alignment,
 * honouring the active locale's direction. Callers pass `start`/`end` instead of
 * `left`/`right` so a future RTL locale mirrors automatically.
 */
export function resolveTextAnchor(
  align: 'start' | 'center' | 'end',
  startXPx: number,
  endXPx: number,
): { xPx: number; textAlign: 'left' | 'center' | 'right' } {
  if (align === 'center') {
    return { xPx: Math.round((startXPx + endXPx) * 0.5), textAlign: 'center' };
  }
  const isRtl = getTextDirection() === 'rtl';
  const wantsRightEdge = (align === 'start') === isRtl;
  return {
    xPx: Math.round(wantsRightEdge ? endXPx : startXPx),
    textAlign: wantsRightEdge ? 'right' : 'left',
  };
}

/**
 * Convenience: translate a key and return it ready for canvas drawing, already
 * truncated to the available width when one is supplied.
 */
export function tCanvas(
  ctx: TextMeasureContext,
  key: TranslationKey,
  options?: { params?: TranslationParams; maxWidthPx?: number },
): string {
  const text = t(key, options?.params);
  const maxWidthPx = options?.maxWidthPx;
  if (maxWidthPx === undefined) return text;
  return truncateToWidth(ctx, text, maxWidthPx);
}
