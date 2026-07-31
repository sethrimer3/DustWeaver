/**
 * Room-resize helpers for the editor.
 *
 * Extracted from editorController.ts so that dimension-clamping and edge-resize
 * logic lives in a focused, testable module.
 *
 * Exports:
 *   - `clampZoneToDimensions`   – clamps a rect zone to fit within room bounds.
 *   - `applyRoomDimensionChange` – sets a room dimension and clamps all elements.
 *   - `applyEdgeResize`          – adds/removes one row/column from an edge with undo support.
 */

import type { EditorRoomData } from './editorState';
import type { EditorHistory } from './editorHistory';
import { capturePendingSnapshot, commitPendingSnapshot } from './editorHistory';
import type { RoomEdge } from './editorUI';
import { BLOCK_SIZE_SMALL, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { getMaterialFootprintSize } from '../sim/pixelMaterials/pixelMaterialTypes';
import type { CampaignSpawnData } from '../levels/campaignSchema';

/** Clamps a zone rect (with wBlock/hBlock) to fit within the given room dimensions. */
export function clampZoneToDimensions(
  z: { xBlock: number; yBlock: number; wBlock: number; hBlock: number },
  widthBlocks: number,
  heightBlocks: number,
): void {
  z.wBlock = Math.max(1, Math.min(z.wBlock, widthBlocks));
  z.hBlock = Math.max(1, Math.min(z.hBlock, heightBlocks));
  z.xBlock = Math.min(Math.max(0, z.xBlock), widthBlocks - z.wBlock);
  z.yBlock = Math.min(Math.max(0, z.yBlock), heightBlocks - z.hBlock);
}

/**
 * Sets the given room dimension and clamps all point/rect elements to the
 * new bounds so nothing is placed outside the room.
 *
 * Minimum room size is enforced at 10 in each axis.
 *
 * NOTE: this "slide into bounds" clamp is intentionally kept for the direct
 * width/height property-edit flow (`onRoomDimensionsChange`), where there is
 * no notion of "which edge changed" and no map-origin/coordinate-translation
 * semantics apply. Edge-driven resizes (`applyEdgeResize` below) use their
 * own shift + clip/remove logic instead, per the side-anchored invariant.
 */
export function applyRoomDimensionChange(
  roomData: EditorRoomData,
  prop: 'widthBlocks' | 'heightBlocks',
  value: number,
): void {
  const room = roomData;
  const clamped = Math.max(10, value);
  if (prop === 'widthBlocks') {
    room.widthBlocks = clamped;
  } else {
    room.heightBlocks = clamped;
  }

  const maxX = room.widthBlocks - 1;
  const maxY = room.heightBlocks - 1;

  // Keep spawn and point entities inside the new room bounds.
  room.playerSpawnBlock[0] = Math.min(Math.max(0, room.playerSpawnBlock[0]), maxX);
  room.playerSpawnBlock[1] = Math.min(Math.max(0, room.playerSpawnBlock[1]), maxY);

  for (const enemy of room.enemies) {
    enemy.xBlock = Math.min(Math.max(0, enemy.xBlock), maxX);
    enemy.yBlock = Math.min(Math.max(0, enemy.yBlock), maxY);
  }

  for (const tomb of room.saveTombs) {
    tomb.xBlock = Math.min(Math.max(0, tomb.xBlock), maxX);
    tomb.yBlock = Math.min(Math.max(0, tomb.yBlock), maxY);
  }

  for (const tomb of room.skillTombs) {
    tomb.xBlock = Math.min(Math.max(0, tomb.xBlock), maxX);
    tomb.yBlock = Math.min(Math.max(0, tomb.yBlock), maxY);
  }
  for (const totem of room.challengeTotems ?? []) {
    totem.xBlock = Math.min(Math.max(0, totem.xBlock), maxX);
    totem.yBlock = Math.min(Math.max(0, totem.yBlock), maxY);
  }
  for (const rect of [...(room.challengeFields ?? []), ...(room.challengeGates ?? []), ...(room.gates ?? [])]) {
    clampZoneToDimensions(rect, room.widthBlocks, room.heightBlocks);
  }

  for (const jar of (room.fireflyJars ?? [])) {
    jar.xBlock = Math.min(Math.max(0, jar.xBlock), maxX);
    jar.yBlock = Math.min(Math.max(0, jar.yBlock), maxY);
  }

  for (const sb of (room.springboards ?? [])) {
    sb.xBlock = Math.min(Math.max(0, sb.xBlock), maxX);
    sb.yBlock = Math.min(Math.max(0, sb.yBlock), maxY);
  }

  for (const bb of (room.breakableBlocks ?? [])) {
    bb.xBlock = Math.min(Math.max(0, bb.xBlock), maxX);
    bb.yBlock = Math.min(Math.max(0, bb.yBlock), maxY);
  }

  for (const pile of room.dustPiles) {
    pile.xBlock = Math.min(Math.max(0, pile.xBlock), maxX);
    pile.yBlock = Math.min(Math.max(0, pile.yBlock), maxY);
  }

  for (const deco of (room.decorations ?? [])) {
    deco.xBlock = Math.min(Math.max(0, deco.xBlock), maxX);
    deco.yBlock = Math.min(Math.max(0, deco.yBlock), maxY);
  }

  for (const light of (room.lightSources ?? [])) {
    light.xBlock = Math.min(Math.max(0, light.xBlock), maxX);
    light.yBlock = Math.min(Math.max(0, light.yBlock), maxY);
  }

  for (const z of (room.waterZones ?? [])) {
    clampZoneToDimensions(z, room.widthBlocks, room.heightBlocks);
  }

  for (const z of (room.lavaZones ?? [])) {
    clampZoneToDimensions(z, room.widthBlocks, room.heightBlocks);
  }

  for (const z of (room.poisonFields ?? [])) {
    clampZoneToDimensions(z, room.widthBlocks, room.heightBlocks);
  }

  for (const z of (room.timeStopFields ?? [])) {
    clampZoneToDimensions(z, room.widthBlocks, room.heightBlocks);
  }

  for (const b of (room.crumbleBlocks ?? [])) {
    clampZoneToDimensions(b, room.widthBlocks, room.heightBlocks);
  }

  for (const b of (room.bouncePads ?? [])) {
    clampZoneToDimensions(b, room.widthBlocks, room.heightBlocks);
  }

  for (const sp of (room.spikes ?? [])) {
    const spSize = sp.size === '2x2' ? 2 : 1;
    sp.xBlock = Math.min(Math.max(0, sp.xBlock), room.widthBlocks - spSize);
    sp.yBlock = Math.min(Math.max(0, sp.yBlock), room.heightBlocks - spSize);
  }

  for (const l of (room.lasers ?? [])) {
    l.xBlock = Math.min(Math.max(0, l.xBlock), room.widthBlocks - 1);
    l.yBlock = Math.min(Math.max(0, l.yBlock), room.heightBlocks - 1);
  }

  // Clamp falling block tiles — remove any that fall outside the room
  if (room.fallingBlocks) {
    room.fallingBlocks = room.fallingBlocks.filter(
      fb => fb.xBlock >= 0 && fb.xBlock < room.widthBlocks &&
            fb.yBlock >= 0 && fb.yBlock < room.heightBlocks,
    );
  }

  // Clip pixel-material particles — these are authored in NATIVE-PIXEL units
  // (not block units), so the bound is widthBlocks/heightBlocks * BLOCK_SIZE_SMALL.
  // Entries past the new edge are removed outright (no sensible "clamp into
  // bounds" behavior for individually-painted sand pixels — clamping would
  // silently pile every out-of-bounds grain onto the new edge column/row).
  if (room.pixelMaterials) {
    const widthPx = room.widthBlocks * BLOCK_SIZE_SMALL;
    const heightPx = room.heightBlocks * BLOCK_SIZE_SMALL;
    // Footprint-aware: a 2x2 particle is removed if ANY part of its footprint
    // (not just its anchor) would fall outside the new bounds.
    room.pixelMaterials = room.pixelMaterials.filter(p => {
      const size = getMaterialFootprintSize(p.material);
      return p.xPixel >= 0 && p.yPixel >= 0 &&
        p.xPixel + size <= widthPx && p.yPixel + size <= heightPx;
    });
  }

  // Clamp interior wall rectangles so they stay fully inside the room.
  for (const wall of room.interiorWalls) {
    wall.wBlock = Math.max(1, Math.min(wall.wBlock, room.widthBlocks));
    wall.hBlock = Math.max(1, Math.min(wall.hBlock, room.heightBlocks));
    wall.xBlock = Math.min(Math.max(0, wall.xBlock), room.widthBlocks - wall.wBlock);
    wall.yBlock = Math.min(Math.max(0, wall.yBlock), room.heightBlocks - wall.hBlock);
  }

  // Keep transitions valid for the updated room dimensions.
  for (const trans of room.transitions) {
    const isHoriz = trans.direction === 'left' || trans.direction === 'right';
    const gw = trans.gradientWidthBlocks ?? 3;
    if (isHoriz) {
      const maxOpening = Math.max(1, room.heightBlocks - 2);
      trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
      // Clamp zone y (opening start) to room bounds
      trans.yBlock = Math.min(Math.max(0, trans.yBlock), room.heightBlocks - trans.openingSizeBlocks);
      // Clamp zone x (gradient start) to room bounds
      trans.xBlock = Math.min(Math.max(0, trans.xBlock), room.widthBlocks - gw);
      // Keep legacy positionBlock in sync
      trans.positionBlock = trans.yBlock;
    } else {
      const maxOpening = Math.max(1, room.widthBlocks - 2);
      trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
      // Clamp zone x (opening start) to room bounds
      trans.xBlock = Math.min(Math.max(0, trans.xBlock), room.widthBlocks - trans.openingSizeBlocks);
      // Clamp zone y (gradient start) to room bounds
      trans.yBlock = Math.min(Math.max(0, trans.yBlock), room.heightBlocks - gw);
      // Keep legacy positionBlock in sync
      trans.positionBlock = trans.xBlock;
    }
  }
}

// ── Edge-resize: shift + clip/remove ──────────────────────────────────────────
//
// Invariant (see docs/Todo.md "Make Room Dimensions edge-resizing truly
// side-anchored and coordinate-complete"): resizing changes only the
// selected edge. Top/left operations move the map origin inversely
// (mapX -= clampedDelta / mapY -= clampedDelta) so the OPPOSITE edge stays
// fixed in absolute map-world space, and every surviving room-local spatial
// coordinate is translated by the same delta so its absolute position is
// unchanged. Bottom/right operations never shift the map origin or content.
// In both cases, geometry intersecting a shaved-off strip is removed or
// clipped according to its element type — never silently clamped/piled onto
// the new edge.

interface PointLike { xBlock: number; yBlock: number }
interface RectLike { xBlock: number; yBlock: number; wBlock: number; hBlock: number }

/** Shifts a point in-place by (dx, dy); returns false if it now falls (any part of its
 * footprint) outside [0, w) x [0, h) and should be removed. */
function shiftAndKeepPoint(p: PointLike, dx: number, dy: number, w: number, h: number, fw = 1, fh = 1): boolean {
  p.xBlock += dx;
  p.yBlock += dy;
  return p.xBlock >= 0 && p.yBlock >= 0 && p.xBlock + fw <= w && p.yBlock + fh <= h;
}

/** Shifts a rect in-place by (dx, dy) and clips it to [0, w) x [0, h). Returns false if the
 * rect is fully outside the new bounds (degenerate) and should be removed. */
function shiftAndClipRect(r: RectLike, dx: number, dy: number, w: number, h: number): boolean {
  r.xBlock += dx;
  r.yBlock += dy;
  if (r.xBlock < 0) { r.wBlock += r.xBlock; r.xBlock = 0; }
  if (r.yBlock < 0) { r.hBlock += r.yBlock; r.yBlock = 0; }
  if (r.xBlock + r.wBlock > w) r.wBlock = w - r.xBlock;
  if (r.yBlock + r.hBlock > h) r.hBlock = h - r.yBlock;
  return r.wBlock > 0 && r.hBlock > 0 && r.xBlock < w && r.yBlock < h;
}

function filterInPlace<T>(arr: T[] | undefined, keep: (item: T) => boolean): T[] {
  return (arr ?? []).filter(keep);
}

/**
 * Adds or removes one row/column from the given edge.
 *
 * Adding to top/left shifts all content (and the map origin). Adding to
 * bottom/right just extends. Removing from top/left shifts content the
 * other direction (and the map origin); removing from bottom/right clips
 * or removes geometry that no longer fits.
 * Minimum room size is 10×10.
 *
 * Pushes a single undo snapshot covering dimensions, map coordinates, and
 * every shifted/clipped/removed element (committed only after all mutation
 * is complete, so one undo/redo step restores everything atomically).
 *
 * `campaignSpawn`, if provided and its `roomId` matches this room, is
 * shifted/clamped in place like any other spatial element (campaign spawn
 * is owned by the campaign session, not `EditorRoomData`, so it must be
 * passed in explicitly by the caller).
 */
export function applyEdgeResize(
  roomData: EditorRoomData,
  history: EditorHistory,
  edge: RoomEdge,
  delta: -5 | -1 | 1 | 5,
  campaignSpawn?: CampaignSpawnData,
): void {
  const room = roomData;

  const isHorizontal = edge === 'left' || edge === 'right';
  const prop = isHorizontal ? 'widthBlocks' : 'heightBlocks';
  const currentSize = room[prop];
  // Clamp the requested delta so the room never drops below the minimum
  // size of 10, even for the ±5 bulk operation. This still applies as a
  // single atomic step (one undo entry, one shift), just with a smaller
  // effective delta near the floor.
  const clampedDelta = currentSize + delta < 10 ? 10 - currentSize : delta;
  const newSize = currentSize + clampedDelta;

  // Enforce minimum room size of 10 (also covers the delta === 0 case)
  if (newSize < 10 || clampedDelta === 0) return;

  const spawnTracked = campaignSpawn !== undefined;
  const spawnBelongsToRoom = spawnTracked && campaignSpawn!.roomId === room.id;
  const pending = capturePendingSnapshot(roomData, campaignSpawn, campaignSpawn?.roomId, spawnTracked, 'Room resize');

  room[prop] = newSize;
  const w = room.widthBlocks;
  const h = room.heightBlocks;

  const isNearEdge = edge === 'top' || edge === 'left';
  const shiftX = edge === 'left' ? clampedDelta : 0;
  const shiftY = edge === 'top' ? clampedDelta : 0;

  if (isNearEdge) {
    // Move the map origin inversely so the OPPOSITE edge stays fixed in
    // absolute map-world space.
    if (edge === 'left') room.mapX = (room.mapX ?? 0) - clampedDelta;
    else room.mapY = (room.mapY ?? 0) - clampedDelta;
  }

  // Player spawn: single non-deletable point — shift then clamp into bounds
  // (there is no sensible "remove" for the mandatory spawn point).
  room.playerSpawnBlock[0] = Math.min(Math.max(0, room.playerSpawnBlock[0] + shiftX), w - 1);
  room.playerSpawnBlock[1] = Math.min(Math.max(0, room.playerSpawnBlock[1] + shiftY), h - 1);

  // Campaign spawn (owned by the campaign session, not EditorRoomData):
  // same non-deletable-point treatment, only if it belongs to this room.
  if (spawnBelongsToRoom) {
    campaignSpawn!.xBlock = Math.min(Math.max(0, campaignSpawn!.xBlock + shiftX), w - 1);
    campaignSpawn!.yBlock = Math.min(Math.max(0, campaignSpawn!.yBlock + shiftY), h - 1);
  }

  // ── Simple point collections (removed if shifted outside new bounds) ──────
  for (const key of [
    'enemies', 'saveTombs', 'skillTombs', 'challengeTotems', 'dustContainers',
    'dustContainerPieces', 'dustBoostJars', 'dustSwarms', 'lambdaAnchors',
    'fireflyJars', 'springboards', 'lasers', 'breakableBlocks', 'dustPiles', 'decorations',
    'ambientLightBlockers', 'lightSources', 'fallingBlocks', 'phantasmalTiles',
    'grappleCarryBlocks',
  ] as const) {
    (room as unknown as Record<string, unknown>)[key] = filterInPlace(
      room[key] as unknown as PointLike[] | undefined,
      p => shiftAndKeepPoint(p, shiftX, shiftY, w, h),
    );
  }

  // Spikes: footprint-aware point (1x1 or 2x2).
  room.spikes = filterInPlace(room.spikes, sp =>
    shiftAndKeepPoint(sp, shiftX, shiftY, w, h, sp.size === '2x2' ? 2 : 1, sp.size === '2x2' ? 2 : 1));

  // ── Rect collections (clipped; removed if fully outside new bounds) ───────
  for (const key of [
    'interiorWalls', 'challengeFields', 'challengeGates', 'gates', 'waterZones',
    'lavaZones', 'timeStopFields', 'poisonFields', 'crumbleBlocks', 'bouncePads', 'kineticBlocks',
    'zipMoveBlocks', 'grasshopperAreas', 'fireflyAreas', 'backgroundBlocks',
    'dialogueTriggers',
  ] as const) {
    (room as unknown as Record<string, unknown>)[key] = filterInPlace(
      room[key] as unknown as RectLike[] | undefined,
      r => shiftAndClipRect(r, shiftX, shiftY, w, h),
    );
  }

  // Custom block placements: rect via tileWidth/tileHeight instead of wBlock/hBlock.
  room.customBlockPlacements = filterInPlace(room.customBlockPlacements, cb =>
    shiftAndKeepPoint(cb, shiftX, shiftY, w, h, cb.tileWidth, cb.tileHeight));

  // Pixel materials: native-pixel units, footprint-aware, scaled by BLOCK_SIZE_SMALL.
  if (room.pixelMaterials) {
    const shiftXPx = shiftX * BLOCK_SIZE_SMALL;
    const shiftYPx = shiftY * BLOCK_SIZE_SMALL;
    const widthPx = w * BLOCK_SIZE_SMALL;
    const heightPx = h * BLOCK_SIZE_SMALL;
    room.pixelMaterials = room.pixelMaterials.filter(p => {
      p.xPixel += shiftXPx;
      p.yPixel += shiftYPx;
      const size = getMaterialFootprintSize(p.material);
      return p.xPixel >= 0 && p.yPixel >= 0 &&
        p.xPixel + size <= widthPx && p.yPixel + size <= heightPx;
    });
  }

  // Scene lights: world-unit coordinates (xWorld/yWorld = xBlock/yBlock * BLOCK_SIZE_MEDIUM).
  if (room.sceneLights) {
    const shiftXWorld = shiftX * BLOCK_SIZE_MEDIUM;
    const shiftYWorld = shiftY * BLOCK_SIZE_MEDIUM;
    const widthWorld = w * BLOCK_SIZE_MEDIUM;
    const heightWorld = h * BLOCK_SIZE_MEDIUM;
    room.sceneLights = room.sceneLights.filter(sl => {
      sl.xWorld += shiftXWorld;
      sl.yWorld += shiftYWorld;
      return sl.xWorld >= 0 && sl.yWorld >= 0 && sl.xWorld < widthWorld && sl.yWorld < heightWorld;
    });
  }

  // Sunbeams: block-unit anchor point; no natural footprint/clip, remove if
  // shifted outside bounds.
  room.sunbeams = filterInPlace(room.sunbeams, sb => shiftAndKeepPoint(sb, shiftX, shiftY, w, h));

  // Ropes: two independent anchor points, no rect-clip semantics for a line
  // segment — remove the rope if either anchor now falls outside bounds.
  if (room.ropes) {
    room.ropes = room.ropes.filter(r => {
      r.anchorAXBlock += shiftX; r.anchorAYBlock += shiftY;
      r.anchorBXBlock += shiftX; r.anchorBYBlock += shiftY;
      return r.anchorAXBlock >= 0 && r.anchorAYBlock >= 0 && r.anchorAXBlock < w && r.anchorAYBlock < h &&
        r.anchorBXBlock >= 0 && r.anchorBYBlock >= 0 && r.anchorBXBlock < w && r.anchorBYBlock < h;
    });
  }

  // Guide-dust paths: multi-point splines with no natural per-point clip —
  // remove the whole path if any control point now falls outside bounds.
  if (room.guideDustPaths) {
    room.guideDustPaths = room.guideDustPaths.filter(path => {
      let allInside = true;
      for (const pt of path.points) {
        pt.xBlock += shiftX;
        pt.yBlock += shiftY;
        if (pt.xBlock < 0 || pt.yBlock < 0 || pt.xBlock >= w || pt.yBlock >= h) allInside = false;
      }
      return allInside;
    });
  }

  // Transitions: xBlock/yBlock meaning depends on direction (see EditorTransition
  // docstring) — only the axis that represents a genuine content-relative
  // position (not "depth into the boundary this transition is attached to")
  // shifts when that axis's edge is resized. This mirrors the original,
  // already-correct logic: a left/right-direction transition's yBlock is its
  // opening's y-start (content-relative — shifts with vertical resizes); its
  // xBlock is the gradient depth from its own boundary (pinned). Symmetric for
  // up/down-direction transitions.
  for (const trans of room.transitions) {
    if (edge === 'top' && (trans.direction === 'left' || trans.direction === 'right')) {
      trans.yBlock += shiftY;
      trans.positionBlock = trans.yBlock;
    }
    if (edge === 'left' && (trans.direction === 'up' || trans.direction === 'down')) {
      trans.xBlock += shiftX;
      trans.positionBlock = trans.xBlock;
    }
  }
  // Re-clamp transition geometry (opening size/position, gradient start) to
  // the new bounds. Transitions are boundary-attached, multi-field geometry
  // without a sensible "remove" — clamping their span/position to fit is the
  // correct per-type handling here (matches the pre-existing behavior this
  // task's regression report did NOT flag as broken).
  for (const trans of room.transitions) {
    const isHoriz = trans.direction === 'left' || trans.direction === 'right';
    const gw = trans.gradientWidthBlocks ?? 3;
    if (isHoriz) {
      const maxOpening = Math.max(1, h - 2);
      trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
      trans.yBlock = Math.min(Math.max(0, trans.yBlock), h - trans.openingSizeBlocks);
      trans.xBlock = Math.min(Math.max(0, trans.xBlock), w - gw);
      trans.positionBlock = trans.yBlock;
    } else {
      const maxOpening = Math.max(1, w - 2);
      trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
      trans.xBlock = Math.min(Math.max(0, trans.xBlock), w - trans.openingSizeBlocks);
      trans.yBlock = Math.min(Math.max(0, trans.yBlock), h - gw);
      trans.positionBlock = trans.xBlock;
    }
  }

  const commitResult = commitPendingSnapshot(history, pending, campaignSpawn, campaignSpawn?.roomId);
  if (commitResult === 'noop') return;
}
