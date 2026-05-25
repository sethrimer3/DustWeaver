/**
 * voidEdgeRenderer.ts — Noisy black-void edge overlay for room boundaries.
 *
 * When a room's `voidEdgeStyle` is not `'off'`, this renderer draws a
 * deterministic pixel-art noise mask along the four exposed room edges,
 * making the hard rectangular black cutoff look like organic cave darkness.
 *
 * Design constraints:
 *  - Visual only — no collision or room geometry is modified.
 *  - Anchored to room/world coordinates, not camera.  Stable during movement.
 *  - Deterministic per room and edge coordinate.
 *  - Pixel-art crisp: no blur, sub-pixel, or smoothing effects.
 *  - Transition openings are suppressed so the gradient passage is not obscured.
 *  - Bite depth: 0–MAX_BITE_DEPTH virtual pixels inward from each edge.
 *  - Edge profiles are cached and recomputed only when the room/style changes.
 *
 * Phase 1 — `'noisyEdge'`:
 *   Black intrusion strips drawn on all four exposed room edges.
 *
 * Phase 2 — `'exteriorFill'`:
 *   A dark cave-wall continuation band outside the room is drawn first,
 *   then the noisy edge mask is applied on top.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { RoomDef, VoidEdgeStyle } from '../levels/roomDef';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum bite depth in virtual pixels (world units). */
const MAX_BITE_DEPTH = 5;

/**
 * Width of exterior fill band in blocks (Phase 2 only).
 * A dark cave-wall strip this deep is drawn outside each room edge.
 */
const EXTERIOR_FILL_DEPTH_BLOCKS = 5;

/** CSS colour used for the exterior fill band (Phase 2). */
const EXTERIOR_FILL_COLOR = '#100c08';

/**
 * Number of pixels of suppression margin around a transition opening.
 * The noisy bite is zeroed within this many virtual pixels of the opening
 * edges so the transition passage gradient is not obscured.
 */
const TRANSITION_MARGIN_PX = 6;

// ── Hash helpers ──────────────────────────────────────────────────────────────

/** Fast 32-bit integer hash from three input values. */
function hashU32(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 0x9e3779b9) ^ Math.imul(b, 0x517cc1b7) ^ Math.imul(c, 0x3c6ef372)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** FNV-1a 32-bit string hash — derives a numeric seed from a room id string. */
function hashRoomId(id: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

/** Cubic smoothstep for smooth value-noise interpolation. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic bite depth (virtual pixels) at coordinate `coord` along the
 * given edge.  Uses two octaves of value noise for an organic low-frequency
 * shape.  Returns an integer in [0, MAX_BITE_DEPTH].
 *
 * @param roomSeed  Per-room seed derived from the room ID.
 * @param edgeId    0=top, 1=bottom, 2=left, 3=right.
 * @param coord     Integer virtual-pixel position along the edge.
 */
function computeBiteDepth(roomSeed: number, edgeId: number, coord: number): number {
  // Octave 1: period ~12 px (coarse humps)
  const base0 = (coord / 12) | 0;
  const frac0 = (coord - base0 * 12) / 12;
  const v00 = hashU32(roomSeed, edgeId * 7919, base0) / 0xFFFFFFFF;
  const v01 = hashU32(roomSeed, edgeId * 7919, base0 + 1) / 0xFFFFFFFF;
  const n0 = v00 + (v01 - v00) * smoothstep(frac0);

  // Octave 2: period ~5 px (fine pixel-art detail, 30% contribution)
  const base1 = (coord / 5) | 0;
  const frac1 = (coord - base1 * 5) / 5;
  const v10 = hashU32(roomSeed, edgeId * 1301 + 999, base1) / 0xFFFFFFFF;
  const v11 = hashU32(roomSeed, edgeId * 1301 + 999, base1 + 1) / 0xFFFFFFFF;
  const n1 = v10 + (v11 - v10) * smoothstep(frac1);

  const combined = n0 * 0.70 + n1 * 0.30;
  return Math.floor(combined * (MAX_BITE_DEPTH + 1)); // 0–5
}

// ── Profile cache ─────────────────────────────────────────────────────────────

interface EdgeProfiles {
  /** Bite depth for each virtual-pixel column along the top edge. */
  top: Uint8Array;
  /** Bite depth for each virtual-pixel column along the bottom edge. */
  bottom: Uint8Array;
  /** Bite depth for each virtual-pixel row along the left edge. */
  left: Uint8Array;
  /** Bite depth for each virtual-pixel row along the right edge. */
  right: Uint8Array;
}

let _cacheKey  = '';
let _cached: EdgeProfiles | null = null;

/**
 * Builds a string cache key from room identity, dimensions, and style.
 * Profiles are regenerated whenever any of these changes.
 */
function makeCacheKey(room: RoomDef, style: VoidEdgeStyle): string {
  return `${room.id}|${room.widthBlocks}|${room.heightBlocks}|${style}`;
}

/**
 * Returns the cached or freshly-computed edge bite profiles for the room.
 *
 * Transition openings (with a small margin) have their bite forced to 0 so
 * the passage gradient is not obscured.
 */
function getEdgeProfiles(room: RoomDef, style: VoidEdgeStyle): EdgeProfiles {
  const key = makeCacheKey(room, style);
  if (key === _cacheKey && _cached !== null) return _cached;

  const roomSeed = hashRoomId(room.id);
  const wPx = room.widthBlocks  * BLOCK_SIZE_SMALL; // virtual pixels wide
  const hPx = room.heightBlocks * BLOCK_SIZE_SMALL; // virtual pixels tall

  const top    = new Uint8Array(wPx);
  const bottom = new Uint8Array(wPx);
  const left   = new Uint8Array(hPx);
  const right  = new Uint8Array(hPx);

  // Fill raw noise
  for (let x = 0; x < wPx; x++) {
    top[x]    = computeBiteDepth(roomSeed, 0, x);
    bottom[x] = computeBiteDepth(roomSeed, 1, x);
  }
  for (let y = 0; y < hPx; y++) {
    left[y]  = computeBiteDepth(roomSeed, 2, y);
    right[y] = computeBiteDepth(roomSeed, 3, y);
  }

  // Zero out bite near transition openings so passage gradients are preserved.
  for (const t of room.transitions) {
    const margin = TRANSITION_MARGIN_PX;
    if (t.direction === 'up') {
      const lo = t.xBlock * BLOCK_SIZE_SMALL - margin;
      const hi = (t.xBlock + t.openingSizeBlocks) * BLOCK_SIZE_SMALL + margin;
      for (let x = Math.max(0, lo); x < Math.min(wPx, hi); x++) top[x] = 0;
    } else if (t.direction === 'down') {
      const lo = t.xBlock * BLOCK_SIZE_SMALL - margin;
      const hi = (t.xBlock + t.openingSizeBlocks) * BLOCK_SIZE_SMALL + margin;
      for (let x = Math.max(0, lo); x < Math.min(wPx, hi); x++) bottom[x] = 0;
    } else if (t.direction === 'left') {
      const lo = t.yBlock * BLOCK_SIZE_SMALL - margin;
      const hi = (t.yBlock + t.openingSizeBlocks) * BLOCK_SIZE_SMALL + margin;
      for (let y = Math.max(0, lo); y < Math.min(hPx, hi); y++) left[y] = 0;
    } else if (t.direction === 'right') {
      const lo = t.yBlock * BLOCK_SIZE_SMALL - margin;
      const hi = (t.yBlock + t.openingSizeBlocks) * BLOCK_SIZE_SMALL + margin;
      for (let y = Math.max(0, lo); y < Math.min(hPx, hi); y++) right[y] = 0;
    }
  }

  _cached   = { top, bottom, left, right };
  _cacheKey = key;
  return _cached;
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

/**
 * Draws a bite-depth profile as a series of black rectangles along one edge.
 *
 * Groups consecutive pixels with the same depth into a single fillRect call
 * for efficiency.
 *
 * @param ctx         Virtual canvas 2D context.
 * @param depths      Bite depths array (one entry per virtual pixel along the edge).
 * @param startScreenX  Screen X of the first virtual pixel (inclusive).
 * @param startScreenY  Screen Y of the room edge origin for this edge.
 * @param zoom          Virtual pixels per world unit.
 * @param horizontal    true = top/bottom edge (depths vary along X);
 *                      false = left/right edge (depths vary along Y).
 * @param inward        +1 = bite grows downward/rightward; -1 = upward/leftward.
 */
function drawBiteProfile(
  ctx: CanvasRenderingContext2D,
  depths: Uint8Array,
  startScreenX: number,
  startScreenY: number,
  zoom: number,
  horizontal: boolean,
  inward: 1 | -1,
): void {
  const n = depths.length;
  let i = 0;
  while (i < n) {
    const d = depths[i];
    if (d === 0) { i++; continue; }
    // Find run of same depth
    let j = i + 1;
    while (j < n && depths[j] === d) j++;
    // Render the run as a single rectangle
    const depthPx = d * zoom;
    if (horizontal) {
      // Top or bottom edge — rect spans columns [i, j) at depth d
      const rx = Math.floor(i * zoom + startScreenX);
      const rw = Math.ceil((j - i) * zoom);
      let ry: number;
      if (inward === 1) {
        // top edge: bite grows downward from startScreenY
        ry = Math.floor(startScreenY);
      } else {
        // bottom edge: bite grows upward from startScreenY
        ry = Math.ceil(startScreenY - depthPx);
      }
      ctx.fillRect(rx, ry, rw, Math.ceil(depthPx));
    } else {
      // Left or right edge — rect spans rows [i, j) at depth d
      const ry = Math.floor(i * zoom + startScreenY);
      const rh = Math.ceil((j - i) * zoom);
      let rx: number;
      if (inward === 1) {
        // left edge: bite grows rightward from startScreenX
        rx = Math.floor(startScreenX);
      } else {
        // right edge: bite grows leftward from startScreenX
        rx = Math.ceil(startScreenX - depthPx);
      }
      ctx.fillRect(rx, ry, Math.ceil(depthPx), rh);
    }
    i = j;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render the void edge overlay for a room.
 *
 * Must be called **after** `ctx.restore()` (room clip released) so the black
 * bites can cover room content near the edges without being clipped.
 *
 * Does nothing when `currentRoom.voidEdgeStyle` is `'off'` or undefined.
 *
 * @param ctx           Virtual canvas 2D context.
 * @param currentRoom   The current room definition.
 * @param ox            Room origin X in virtual pixels (screen space).
 * @param oy            Room origin Y in virtual pixels (screen space).
 * @param zoom          Virtual pixels per world unit.
 */
export function renderVoidEdge(
  ctx: CanvasRenderingContext2D,
  currentRoom: RoomDef,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const style = currentRoom.voidEdgeStyle;
  if (!style || style === 'off') return;

  const wWorld = currentRoom.widthBlocks  * BLOCK_SIZE_SMALL;
  const hWorld = currentRoom.heightBlocks * BLOCK_SIZE_SMALL;
  const roomScreenW = wWorld * zoom;
  const roomScreenH = hWorld * zoom;

  // ── Phase 2: Exterior fill band ─────────────────────────────────────────
  if (style === 'exteriorFill') {
    const fillDepthWorld = EXTERIOR_FILL_DEPTH_BLOCKS * BLOCK_SIZE_SMALL;
    const fillDepthPx    = fillDepthWorld * zoom;
    ctx.fillStyle = EXTERIOR_FILL_COLOR;
    // Top exterior band
    ctx.fillRect(Math.floor(ox), Math.floor(oy - fillDepthPx), Math.ceil(roomScreenW), Math.ceil(fillDepthPx));
    // Bottom exterior band
    ctx.fillRect(Math.floor(ox), Math.floor(oy + roomScreenH), Math.ceil(roomScreenW), Math.ceil(fillDepthPx));
    // Left exterior band (full height including corners)
    ctx.fillRect(Math.floor(ox - fillDepthPx), Math.floor(oy - fillDepthPx), Math.ceil(fillDepthPx), Math.ceil(roomScreenH + fillDepthPx * 2));
    // Right exterior band (full height including corners)
    ctx.fillRect(Math.floor(ox + roomScreenW), Math.floor(oy - fillDepthPx), Math.ceil(fillDepthPx), Math.ceil(roomScreenH + fillDepthPx * 2));
  }

  // ── Phase 1 & 2: Noisy black edge intrusion ──────────────────────────────
  const profiles = getEdgeProfiles(currentRoom, style);

  ctx.fillStyle = '#000000';

  // Top edge — bite grows downward from oy
  drawBiteProfile(ctx, profiles.top, ox, oy, zoom, true, 1);

  // Bottom edge — bite grows upward from oy + roomScreenH
  drawBiteProfile(ctx, profiles.bottom, ox, oy + roomScreenH, zoom, true, -1);

  // Left edge — bite grows rightward from ox
  drawBiteProfile(ctx, profiles.left, ox, oy, zoom, false, 1);

  // Right edge — bite grows leftward from ox + roomScreenW
  drawBiteProfile(ctx, profiles.right, ox + roomScreenW, oy, zoom, false, -1);
}
