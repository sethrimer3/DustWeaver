/**
 * wallTileDrawHelpers.ts — Stateless drawing primitives for wall tile rendering.
 *
 * Contains:
 *  • TileSpec + 16-entry neighbor-mask lookup table (_TILE_TABLE)
 *  • _drawFallbackTile  — solid-colour placeholder while sprites load
 *  • _drawVertexOverlays — concave inner-corner overlays (world 1+ legacy)
 *  • _drawPlatformLine  — thin horizontal/vertical platform edge line
 *  • _drawRampTriangle  — solid triangle with hypotenuse stroke (ramp fallback)
 *
 * None of these functions reference module-level renderer state; they are
 * pure drawing utilities that take all required data as parameters.
 */

import type { TileVariant } from './blockSpriteSets';
import { isSpriteReady } from './blockSpriteSets';
import { isWallOccupied } from './blockWallLayoutCache';

// ── Tile-spec lookup table ───────────────────────────────────────────────────

export interface TileSpec {
  readonly variant:     TileVariant;
  /** Canvas rotation in radians applied around the tile centre. */
  readonly rotationRad: number;
}

// Neighbor mask bit assignments: bit0=N, bit1=E, bit2=S, bit3=W
export const TILE_MASK_N = 1;
export const TILE_MASK_E = 2;
export const TILE_MASK_S = 4;
export const TILE_MASK_W = 8;
const _HALF_PI = Math.PI * 0.5;
const _PI      = Math.PI;

/**
 * 16-entry lookup table indexed by 4-bit neighbor mask.
 *
 * Sprite default orientations (rotation 0):
 *  - end:    cap opening faces north (south neighbor is connected)
 *  - corner: SW corner exposed (N+E solid, NE open → rotate 0 for S+W)
 *  - edge:   south face exposed (N+E+W solid)
 */
export const TILE_TABLE: readonly TileSpec[] = ((): TileSpec[] => {
  const t: TileSpec[] = new Array(16);

  const set = (mask: number, variant: TileVariant, rotationRad: number): void => {
    t[mask] = { variant, rotationRad };
  };

  // 0 neighbors — isolated
  set(0,                                     'single', 0);

  // 1 neighbor — end cap; default opening faces south (S is connected),
  // rotate to face the connected side.
  set(TILE_MASK_S,                           'end', 0);           // S solid → no rotation
  set(TILE_MASK_N,                           'end', _PI);          // N solid → 180°
  set(TILE_MASK_E,                           'end', -_HALF_PI);   // E solid → -90°
  set(TILE_MASK_W,                           'end', _HALF_PI);    // W solid → +90°

  // 2 opposite neighbors — treat as interior (tunnel)
  set(TILE_MASK_N | TILE_MASK_S,             'block', 0);
  set(TILE_MASK_E | TILE_MASK_W,             'block', 0);

  // 2 adjacent neighbors — corner; default: S+W solid, NE exposed
  set(TILE_MASK_S | TILE_MASK_W,             'corner', 0);
  set(TILE_MASK_N | TILE_MASK_E,             'corner', _PI);
  set(TILE_MASK_S | TILE_MASK_E,             'corner', -_HALF_PI);
  set(TILE_MASK_N | TILE_MASK_W,             'corner', _HALF_PI);

  // 3 neighbors — edge; default sprite faces NORTH, so we add π to orient correctly.
  set(TILE_MASK_N | TILE_MASK_E | TILE_MASK_W, 'edge', _PI);          // S exposed
  set(TILE_MASK_N | TILE_MASK_E | TILE_MASK_S, 'edge', -_HALF_PI);    // W exposed
  set(TILE_MASK_N | TILE_MASK_S | TILE_MASK_W, 'edge', _HALF_PI);     // E exposed
  set(TILE_MASK_E | TILE_MASK_S | TILE_MASK_W, 'edge', 0);            // N exposed

  // 4 neighbors — fully surrounded
  set(TILE_MASK_N | TILE_MASK_E | TILE_MASK_S | TILE_MASK_W, 'block', 0);

  return t;
})();

// ── Solid-colour fallback ─────────────────────────────────────────────────────

/** Draws a single tile as a solid-colour rectangle (used when sprites are loading). */
export function drawFallbackTile(
  ctx:         CanvasRenderingContext2D,
  tileX:       number,
  tileY:       number,
  tileSizePx:  number,
): void {
  const rx = Math.round(tileX);
  const ry = Math.round(tileY);
  const roundedSizePx = Math.round(tileSizePx);
  ctx.fillStyle = '#1a2535';
  ctx.fillRect(rx, ry, roundedSizePx, roundedSizePx);

  ctx.fillStyle = 'rgba(80,120,180,0.18)';
  ctx.fillRect(rx, ry, roundedSizePx, 2);
  ctx.fillRect(rx, ry, 2, roundedSizePx);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(rx, ry + roundedSizePx - 2, roundedSizePx, 2);
  ctx.fillRect(rx + roundedSizePx - 2, ry, 2, roundedSizePx);
}

// ── Vertex overlay ────────────────────────────────────────────────────────────

/**
 * Draws the vertex overlay sprite at each concave inner corner of a corner
 * tile.  A concave inner corner exists at a diagonal position when both
 * sharing cardinal neighbours are solid but the diagonal cell itself is air.
 *
 * @param vertexImg  The loaded vertex overlay image (caller must check readiness).
 */
export function drawVertexOverlays(
  ctx:         CanvasRenderingContext2D,
  vertexImg:   HTMLImageElement,
  occupied:    Set<string>,
  col:         number,
  row:         number,
  tileX:       number,
  tileY:       number,
  tileSizePx:  number,
  northSolid:  boolean,
  eastSolid:   boolean,
  southSolid:  boolean,
  westSolid:   boolean,
): void {
  if (!isSpriteReady(vertexImg)) return;

  const qSizePx = tileSizePx * 0.5;

  // Each diagonal corner: draw vertex overlay when both adjacent cardinals
  // are solid but the diagonal cell is air (concave inner corner).
  if (northSolid && eastSolid && !isWallOccupied(occupied, col + 1, row - 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX + tileSizePx), Math.round(tileY));
    ctx.rotate(_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && eastSolid && !isWallOccupied(occupied, col + 1, row + 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX + tileSizePx), Math.round(tileY + tileSizePx));
    ctx.rotate(_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && westSolid && !isWallOccupied(occupied, col - 1, row + 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX), Math.round(tileY + tileSizePx));
    ctx.rotate(-_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (northSolid && westSolid && !isWallOccupied(occupied, col - 1, row - 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX), Math.round(tileY));
    ctx.rotate(0);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
}

// ── Platform and ramp draw helpers ───────────────────────────────────────────

/** Draws a 3-pixel thick solid-color platform line at the specified edge. */
export function drawPlatformLine(
  ctx: CanvasRenderingContext2D,
  tileX: number, tileY: number,
  tileSizeScreen: number,
  platformEdge: number,
  scalePx: number,
): void {
  const LINE_PX = Math.max(1, Math.round(3 * scalePx));
  switch (platformEdge) {
    case 0: ctx.fillRect(tileX, tileY, tileSizeScreen, LINE_PX); break;
    case 1: ctx.fillRect(tileX, tileY + tileSizeScreen - LINE_PX, tileSizeScreen, LINE_PX); break;
    case 2: ctx.fillRect(tileX, tileY, LINE_PX, tileSizeScreen); break;
    case 3: ctx.fillRect(tileX + tileSizeScreen - LINE_PX, tileY, LINE_PX, tileSizeScreen); break;
  }
}

/**
 * Draws a ramp as a solid-color filled triangle with a hypotenuse edge stroke.
 * Used as fallback for non-blackRock themes and while procedural sprites load.
 */
export function drawRampTriangle(
  ctx: CanvasRenderingContext2D,
  wxPx: number, wyPx: number,
  wwPx: number, whPx: number,
  ori: number,
  fillColor: string,
  edgeColor: string,
  scalePx: number,
): void {
  const x0 = wxPx;        const y0 = wyPx;         // TL
  const x1 = wxPx + wwPx; const y1 = wyPx;         // TR
  const x2 = wxPx;        const y2 = wyPx + whPx;  // BL
  const x3 = wxPx + wwPx; const y3 = wyPx + whPx;  // BR

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  switch (ori) {
    case 0: ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x1, y1); break; // /
    case 1: ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x0, y0); break; // \
    case 2: ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); break; // ⌐
    case 3: ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x3, y3); break; // ¬
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = Math.max(1, scalePx);
  ctx.beginPath();
  switch (ori) {
    case 0: ctx.moveTo(x2, y2); ctx.lineTo(x1, y1); break;
    case 1: ctx.moveTo(x3, y3); ctx.lineTo(x0, y0); break;
    case 2: ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); break;
    case 3: ctx.moveTo(x0, y0); ctx.lineTo(x3, y3); break;
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

/**
 * Applies a closed triangular clip path to `ctx` matching the ramp triangle
 * for the given orientation.  Call `ctx.clip()` after this to restrict drawing
 * to the ramp shape.  The caller is responsible for `ctx.save()` / `ctx.restore()`.
 *
 * Orientation codes match `drawRampTriangle`:
 *   0 = rises right (/)      → BL → BR → TR
 *   1 = rises left  (\)      → BL → BR → TL
 *   2 = ceiling ramp (⌐)     → TL → TR → BL
 *   3 = ceiling ramp (¬)     → TL → TR → BR
 */
export function applyRampClipPath(
  ctx: CanvasRenderingContext2D,
  wxPx: number, wyPx: number,
  wwPx: number, whPx: number,
  ori: number,
): void {
  const x0 = wxPx;        const y0 = wyPx;
  const x1 = wxPx + wwPx; const y1 = wyPx;
  const x2 = wxPx;        const y2 = wyPx + whPx;
  const x3 = wxPx + wwPx; const y3 = wyPx + whPx;
  ctx.beginPath();
  switch (ori) {
    case 0: ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x1, y1); break; // /
    case 1: ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x0, y0); break; // \
    case 2: ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); break; // ⌐
    default: ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x3, y3); break; // ¬
  }
  ctx.closePath();
}
