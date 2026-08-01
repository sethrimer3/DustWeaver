import { meshCellsToRectangles, type MeshCell } from '../../levels/rectangleMesher';

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
 *  – Lazily rebuild a merged 2D-rectangle cache (once per set change).
 *  – Render the overlay via a tight fillRect loop with viewport culling.
 *
 * Rectangle merging (phase 1 of the ambient-blocker rectangle-canonicalization
 * Todo item): this cache is rebuilt using the shared, deterministic
 * `meshCellsToRectangles` greedy mesher (`src/levels/rectangleMesher.ts`)
 * instead of a horizontal-only span merge, so large filled dark-blocker
 * regions collapse to far fewer fillRect calls (a full rectangular secret
 * room previously issued one fillRect per row; it now issues one fillRect
 * total). This is a runtime rendering optimization only — it does not touch
 * the editor's per-cell `EditorAmbientLightBlocker` authoring model, save
 * schema, UID/selection, or undo/redo. All dark-blocker cells passed in here
 * share a single behavior key ("dark"); the mesher's key-boundary guarantee
 * is exercised by the shared unit tests, not needed operationally here since
 * this module is only ever given already-filtered dark-blocker keys.
 */

/** Active set of dark ambient-light blocker tile keys (`"col,row"`). */
let _activeDarkBlockerKeys: ReadonlySet<string> = new Set();

/** Packed [col, row, width, height] quadruplets for the merged 2D rectangles. */
let _darkBlockerSpans = new Float32Array(0);
/** Number of valid [col, row, width, height] quadruplet entries in _darkBlockerSpans. */
let _darkBlockerSpanCount = 0;
/** True when _activeDarkBlockerKeys has changed and rectangles need rebuilding. */
let _darkBlockerSpansDirty = true;

const _DARK_KEY = 'dark';

function _rebuildDarkBlockerSpans(): void {
  _darkBlockerSpansDirty = false;
  const keys = _activeDarkBlockerKeys;
  if (keys.size === 0) {
    _darkBlockerSpanCount = 0;
    return;
  }

  const cells: MeshCell[] = [];
  for (const key of keys) {
    const ci  = key.indexOf(',');
    const col = parseInt(key.slice(0, ci), 10);
    const row = parseInt(key.slice(ci + 1), 10);
    cells.push({ x: col, y: row, key: _DARK_KEY });
  }

  const rects = meshCellsToRectangles(cells);

  // Pack into a pre-allocated typed array (grow if needed).
  const needed = rects.length * 4;
  if (needed > _darkBlockerSpans.length) {
    _darkBlockerSpans = new Float32Array(needed + 64);
  }
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    _darkBlockerSpans[i * 4]     = r.x;
    _darkBlockerSpans[i * 4 + 1] = r.y;
    _darkBlockerSpans[i * 4 + 2] = r.w;
    _darkBlockerSpans[i * 4 + 3] = r.h;
  }
  _darkBlockerSpanCount = rects.length;
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
 * Uses pre-merged 2D rectangles (via the shared `meshCellsToRectangles`
 * mesher) for efficiency and viewport-culls rectangles that are fully
 * outside the current camera view.
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
    const col    = _darkBlockerSpans[i * 4];
    const row    = _darkBlockerSpans[i * 4 + 1];
    const width  = _darkBlockerSpans[i * 4 + 2];
    const height = _darkBlockerSpans[i * 4 + 3];
    const sx = Math.round(col    * tileSizePx + offsetXPx);
    const sy = Math.round(row    * tileSizePx + offsetYPx);
    const sw = Math.ceil(width   * tileSizePx);
    const sh = Math.ceil(height  * tileSizePx);
    // Viewport cull: skip rectangles entirely off-screen.
    if (sx + sw <= 0 || sy + sh <= 0 || sx >= vpW || sy >= vpH) continue;
    ctx.fillRect(sx, sy, sw, sh);
  }
}
