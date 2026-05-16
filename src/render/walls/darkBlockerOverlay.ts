/**
 * darkBlockerOverlay.ts — Dark Ambient-Light Blocker Overlay Renderer.
 *
 * Extracted from blockSpriteRenderer.ts to give the dark-blocker subsystem
 * its own focused module.
 *
 * Dark blockers are solid cells that hide secret areas by drawing an opaque
 * black rectangle over the room background before any wall sprites are drawn.
 * They are authored as `RoomAmbientLightBlockerDef` entries with `isDark: true`
 * in roomDef.ts and propagated into this module at room load time.
 *
 * Responsibilities:
 *  – Store the active set of dark-blocker tile keys.
 *  – Lazily rebuild a merged horizontal-span cache (once per set change).
 *  – Render the overlay via a tight fillRect loop with viewport culling.
 */

/** Active set of dark ambient-light blocker tile keys (`"col,row"`). */
let _activeDarkBlockerKeys: ReadonlySet<string> = new Set();

// ── Merged-span cache ─────────────────────────────────────────────────────────
//
// Pre-merges adjacent cells in the same row into horizontal spans so the
// overlay render loop issues far fewer fillRect calls (and skips string
// parsing entirely after the initial build).  Rebuilt once when the blocker
// set changes (typically once per room load).
//
// Each span is stored as three consecutive entries in _darkBlockerSpans:
//   [col, row, width]  (all in tile-grid units)

/** Packed [col, row, width] triplets for the merged horizontal spans. */
let _darkBlockerSpans = new Float32Array(0);
/** Number of valid [col, row, width] triplet entries in _darkBlockerSpans. */
let _darkBlockerSpanCount = 0;
/** True when _activeDarkBlockerKeys has changed and spans need rebuilding. */
let _darkBlockerSpansDirty = true;

function _rebuildDarkBlockerSpans(): void {
  _darkBlockerSpansDirty = false;
  const keys = _activeDarkBlockerKeys;
  if (keys.size === 0) {
    _darkBlockerSpanCount = 0;
    return;
  }

  // Group cells by row.
  const byRow = new Map<number, number[]>();
  for (const key of keys) {
    const ci  = key.indexOf(',');
    const col = parseInt(key.slice(0, ci), 10);
    const row = parseInt(key.slice(ci + 1), 10);
    let arr = byRow.get(row);
    if (arr === undefined) { arr = []; byRow.set(row, arr); }
    arr.push(col);
  }

  // For each row, sort columns and merge adjacent cells into horizontal spans.
  const spans: number[] = [];
  for (const [row, cols] of byRow) {
    cols.sort((a, b) => a - b);
    let start = cols[0];
    let len   = 1;
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === start + len) {
        len++;
      } else {
        spans.push(start, row, len);
        start = cols[i];
        len   = 1;
      }
    }
    spans.push(start, row, len);
  }

  // Pack into a pre-allocated typed array (grow if needed).
  const needed = spans.length;
  if (needed > _darkBlockerSpans.length) {
    _darkBlockerSpans = new Float32Array(needed + 64);
  }
  for (let i = 0; i < needed; i++) _darkBlockerSpans[i] = spans[i];
  _darkBlockerSpanCount = (needed / 3) | 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sets the active set of dark ambient-light blocker tile keys.
 * Dark blockers are rendered as solid black overlays over the room background
 * before the wall sprites are drawn.  Call this when entering a room (same
 * timing as {@link setActiveBlockLighting} in blockSpriteRenderer.ts).
 *
 * @param darkBlockerKeys  Set of `"col,row"` tile keys for dark blockers.
 *                         Pass `undefined` or an empty set to clear.
 */
export function setActiveDarkAmbientBlockers(darkBlockerKeys?: ReadonlySet<string>): void {
  _activeDarkBlockerKeys = darkBlockerKeys ?? new Set();
  // Rebuild merged spans lazily on next renderDarkAmbientBlockerOverlay call.
  _darkBlockerSpansDirty = true;
}

/**
 * Draws a solid black rectangle over every dark ambient-light blocker cell.
 * Uses pre-merged horizontal spans for efficiency and viewport-culls spans
 * that are fully outside the current camera view.
 *
 * @param ctx          Canvas 2D rendering context (virtual canvas).
 * @param offsetXPx    Camera X offset (world-to-screen translation, virtual px).
 * @param offsetYPx    Camera Y offset (world-to-screen translation, virtual px).
 * @param zoom         Camera zoom factor (virtual pixels per world unit).
 * @param blockSizePx  Block size in world units (typically BLOCK_SIZE_SMALL).
 * @param vpW          Viewport width in virtual pixels (default 480).
 * @param vpH          Viewport height in virtual pixels (default 270).
 */
export function renderDarkAmbientBlockerOverlay(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  blockSizePx: number,
  vpW = 480,
  vpH = 270,
): void {
  if (_activeDarkBlockerKeys.size === 0) return;
  if (_darkBlockerSpansDirty) _rebuildDarkBlockerSpans();
  if (_darkBlockerSpanCount === 0) return;

  const tileSizePx = blockSizePx * zoom;
  ctx.fillStyle = '#000000';

  for (let i = 0; i < _darkBlockerSpanCount; i++) {
    const col   = _darkBlockerSpans[i * 3];
    const row   = _darkBlockerSpans[i * 3 + 1];
    const width = _darkBlockerSpans[i * 3 + 2];
    const sx = Math.round(col   * tileSizePx + offsetXPx);
    const sy = Math.round(row   * tileSizePx + offsetYPx);
    const sw = Math.ceil(width  * tileSizePx);
    const sh = Math.ceil(tileSizePx);
    // Viewport cull: skip spans entirely off-screen.
    if (sx + sw <= 0 || sy + sh <= 0 || sx >= vpW || sy >= vpH) continue;
    ctx.fillRect(sx, sy, sw, sh);
  }
}
