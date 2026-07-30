/**
 * Editor place tool — handles placeAtCursor() and placement preview helpers.
 *
 * Extracted from editorTools.ts to keep the tools module focused on
 * select/delete/multi-select logic.
 */

/** Segments per block-length for auto-calculating rope segment count. */
const ROPE_SEGMENTS_PER_BLOCK = 1.5;

import {
  EditorState, EditorTool, allocateUid,
  PaletteItem, DecorationKind, EditorBouncePad, EditorKineticBlock, EditorSunbeam, EditorFallingBlock,
  EditorGrappleCarryBlock, EditorPhantasmalTile,
  EditorDialogueTrigger, EditorGuideDustPath,
} from './editorState';
import { toNamespacedId } from '../levels/customBlocks';
import { createDefaultLight } from '../render/lighting/lightingTypes';
import { placeEnemyAtCursor } from './editorEnemyPlacer';
import { MAX_ROPE_SEGMENTS } from '../sim/world';
import { MIN_ROPE_LENGTH_BLOCKS, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  wallsOverlap,
  isInsideRoom,
  rectFitsInsideRoom,
  isFallingBlockAt,
  rectOverlapsFallingBlocks,
  rectOverlapsSolidEditorObject,
  ropeLineCrossesWall,
  findFloorBlockRow,
  findCeilingBlockRow,
  canPlaceGrappleCarryBlockAt,
  canPlacePhantasmalTileAt,
  canPlacePixelMaterialAt,
  isCellCoveredByWaterZone,
  isCellCoveredByLavaZone,
  isCellCoveredByTimeStopField,
} from './editorHitTest';
import {
  getBrushCells, getFillBrushCells, type FillKind,
  computeSingleTransitionPlacement, computeFillTransitionPlacement, computeRectTransitionPlacement,
} from './editorBrush';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import {
  canPlaceOnLayer, getPlacementTargetLayer, isLayerVisible, isAnyLayerSoloed,
  type PlacementBlockReason,
} from './editorLayers';
import { anchorForMaterial } from './editorPixelMaterialTool';
import { bumpSelectionRevision } from './editorSelectionCache';

// ── Placement dimension helpers ───────────────────────────────────────────────

function getPlacementWidth(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  // Stairs keep their authored bounding box: their four orientations are axis
  // mirrors of one mask, not rotations, so the box never transposes.
  if (item.isStairsItem === 1 || item.isSmoothRampItem === 1) return w;
  return (rotSteps % 2 === 0) ? w : h;
}

function getPlacementHeight(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  if (item.isStairsItem === 1 || item.isSmoothRampItem === 1) return h;
  return (rotSteps % 2 === 0) ? h : w;
}

/**
 * Returns the placement preview dimensions for the current palette item.
 */
export function getPlacementPreview(state: EditorState): { wBlock: number; hBlock: number } | null {
  if (state.activeTool !== EditorTool.Place || state.selectedPaletteItem === null) return null;
  const item = state.selectedPaletteItem;
  if (item.category === 'liquids') {
    return {
      wBlock: item.defaultWidthBlocks ?? 1,
      hBlock: item.defaultHeightBlocks ?? 1,
    };
  }
  if (item.id === 'dialogue_trigger') {
    return { wBlock: 4, hBlock: 4 };
  }
  if (item.isCustomBlockItem === 1) {
    return {
      wBlock: item.customBlockTileWidth ?? 1,
      hBlock: item.customBlockTileHeight ?? 1,
    };
  }
  if (item.category !== 'blocks' && item.category !== 'specialBlocks') {
    return { wBlock: 1, hBlock: 1 };
  }
  return {
    wBlock: getPlacementWidth(item, state.placementRotationSteps),
    hBlock: getPlacementHeight(item, state.placementRotationSteps),
  };
}

// ── Place tool ───────────────────────────────────────────────────────────────

/**
 * Places the currently selected palette item at the cursor location,
 * respecting the active brush mode for tile-like items. Enforces the
 * shared layer-mutation policy (hidden/locked/solo-excluded/select-only-
 * excluded) INSIDE this function, using the actual destination layer for
 * the selected palette item + pending placement modifier (not merely "the
 * active layer" in the general sense) — every brush mode (single, fill,
 * rect, 3x3, 5x5) routes through this same check since they all funnel
 * through this one entry point.
 *
 * Returns `true` if at least one element was actually placed, `false` if
 * the placement was blocked or was a no-op (nothing to do / everything
 * rejected) — callers should skip history/dirty work when this returns
 * `false`. Blocked placement returns before allocating any UIDs or
 * touching room data.
 */
export function placeAtCursor(state: EditorState): boolean {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return false;
  const targetLayer = getPlacementTargetLayer(state);
  if (targetLayer === null || !canPlaceOnLayer(state, targetLayer)) return false;

  const uidBefore = state.nextUid;

  // Brush painting: tile-like items support multi-cell brushes.
  const isBrushable =
    item.category === 'blocks' ||
    item.category === 'specialBlocks' ||
    item.category === 'liquids' ||
    item.isTimeStopFieldItem === 1 ||
    (item.category === 'lighting' && item.isAmbientLightBlockerItem === 1);

  if (isBrushable && state.brushMode === 'fill') {
    let fillKind: FillKind = 'tile';
    if (item.category === 'liquids') {
      fillKind = item.id === 'lava_zone' ? 'lava' : 'water';
    } else if (item.isTimeStopFieldItem === 1) {
      fillKind = 'timeStop';
    }
    const cells = getFillBrushCells(room, state.cursorBlockX, state.cursorBlockY, fillKind);
    for (const cell of cells) {
      placeAt(state, cell.x, cell.y);
    }
    return state.nextUid !== uidBefore;
  }

  if (isBrushable && state.brushMode !== 'single') {
    const itemWBlock = getPlacementWidth(item, state.placementRotationSteps);
    const itemHBlock = getPlacementHeight(item, state.placementRotationSteps);
    const cells = getBrushCells(
      state.brushMode,
      state.cursorBlockX,
      state.cursorBlockY,
      state.brushRectStartBlockX,
      state.brushRectStartBlockY,
      itemWBlock,
      itemHBlock,
    );
    for (const cell of cells) {
      placeAt(state, cell.x, cell.y);
    }
    return state.nextUid !== uidBefore;
  }

  placeAt(state, state.cursorBlockX, state.cursorBlockY);
  return state.nextUid !== uidBefore;
}

/** Result of a whole-operation brush preflight — see `evaluateBrushOperation`. */
export type BrushOperationResult = {
  validCount: number;
  blockedCount: number;
  /** Null whenever at least one cell is valid (`validCount > 0`). */
  reason: PlacementBlockReason | null;
};

/**
 * Side-effect-free, operation-level placement preflight. Evaluates the SAME
 * set of effective cells `placeAtCursor` would actually touch for the current
 * brush mode (single / 3x3 / 5x5 / rect / fill / pixel-material) and reports
 * how many would succeed vs. be blocked — without allocating any UID or
 * mutating `state.roomData`.
 *
 * Policy: the whole operation is only blocked when `validCount === 0` (no
 * destination cell can succeed). A brush with partial occupancy (e.g. a 3x3
 * with one occupied center cell) is allowed — `placeAtCursor` already places
 * only the cells that succeed. Layer restrictions (hidden/locked/solo-
 * excluded/select-only-excluded) block the entire operation regardless of
 * cell validity. Rect-brush anchor-pending (first click, no drag yet) is
 * always allowed since it only records an anchor and mutates nothing.
 */
export function evaluateBrushOperation(state: EditorState): BrushOperationResult {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null) return { validCount: 0, blockedCount: 0, reason: 'no-room' };
  if (item === null) return { validCount: 0, blockedCount: 0, reason: 'no-item' };

  const targetLayer = getPlacementTargetLayer(state);
  if (targetLayer === null) return { validCount: 0, blockedCount: 0, reason: 'no-item' };
  if (!canPlaceOnLayer(state, targetLayer)) {
    const layer = state.layers[targetLayer];
    let reason: PlacementBlockReason;
    if (!isLayerVisible(state, targetLayer)) {
      reason = isAnyLayerSoloed(state) && !layer.solo ? 'solo-excluded' : 'hidden';
    } else if (layer.locked) {
      reason = 'locked';
    } else {
      reason = 'select-only-excluded';
    }
    return { validCount: 0, blockedCount: 0, reason };
  }

  const isBrushable =
    item.category === 'blocks' ||
    item.category === 'specialBlocks' ||
    item.category === 'liquids' ||
    item.isTimeStopFieldItem === 1 ||
    (item.category === 'lighting' && item.isAmbientLightBlockerItem === 1);

  // Rect-brush first click: only an anchor gets recorded, nothing is placed
  // yet, so this is always a valid "operation" regardless of what's under
  // the cursor — mirrors the actual first-click behavior in placeAt/placeAtCursor.
  if (isBrushable && state.brushMode === 'rect' && state.brushRectStartBlockX === null) {
    return { validCount: 1, blockedCount: 0, reason: null };
  }

  let cells: { x: number; y: number }[];
  if (isBrushable && state.brushMode === 'fill') {
    let fillKind: FillKind = 'tile';
    if (item.category === 'liquids') {
      fillKind = item.id === 'lava_zone' ? 'lava' : 'water';
    } else if (item.isTimeStopFieldItem === 1) {
      fillKind = 'timeStop';
    }
    cells = getFillBrushCells(room, state.cursorBlockX, state.cursorBlockY, fillKind);
  } else if (isBrushable && state.brushMode !== 'single') {
    const itemWBlock = getPlacementWidth(item, state.placementRotationSteps);
    const itemHBlock = getPlacementHeight(item, state.placementRotationSteps);
    cells = getBrushCells(
      state.brushMode,
      state.cursorBlockX,
      state.cursorBlockY,
      state.brushRectStartBlockX,
      state.brushRectStartBlockY,
      itemWBlock,
      itemHBlock,
    );
  } else {
    cells = [{ x: state.cursorBlockX, y: state.cursorBlockY }];
  }

  let validCount = 0;
  let blockedCount = 0;
  let firstBlockReason: PlacementBlockReason = null;
  for (const cell of cells) {
    const result = wouldPlacementSucceedAt(state, cell.x, cell.y);
    if (result === true) {
      validCount++;
    } else {
      blockedCount++;
      if (firstBlockReason === null) {
        firstBlockReason = result === false ? 'invalid-location' : result;
      }
    }
  }

  return { validCount, blockedCount, reason: validCount > 0 ? null : firstBlockReason };
}

/**
 * Side-effect-free placement preflight: reports whether placing the current
 * palette item at (bx, by) would actually succeed, WITHOUT allocating a UID,
 * mutating `state.roomData`, or touching any pending-anchor/selection state.
 *
 * This mirrors the same occupancy/bounds guard clauses `placeAt` itself uses
 * for each item category — it deliberately does NOT reimplement the full
 * placement dispatcher (no object construction, no array pushes, no
 * `allocateUid` calls); it only re-runs the pure boolean checks that decide
 * whether `placeAt` would return early. Kept in the same module as `placeAt`
 * so the two can never drift out of sync on which checks apply to which item.
 *
 * Returns `true` when placement would succeed, `false` for a generic
 * invalid/out-of-bounds location, or one of the specific `PlacementBlockReason`
 * values ('occupied' | 'capacity') when the caller can usefully distinguish
 * why. Intended for `getPlacementStatus`'s `isValidLocation` callback — used
 * by the preview drawer, the controller's blocked-click toast, and (as a
 * final guard immediately before mutation) `placeAtCursor` itself.
 */
export function wouldPlacementSucceedAt(
  state: EditorState,
  bx: number,
  by: number,
): boolean | PlacementBlockReason {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return false;

  // ── Pixel-material tool ──────────────────────────────────────────────────
  // Uses native-pixel coordinates (state.cursorWorldX/Y), not the block
  // coordinates this function otherwise takes — the pixel-material tool's
  // own preview/placement path (drawPlacementPreview, placePixelMaterialAt)
  // always operates in pixel space, never block space.
  if (item.isPixelMaterialItem === 1) {
    const anchor = anchorForMaterial(Math.floor(state.cursorWorldX), Math.floor(state.cursorWorldY), item.pixelMaterialId ?? 1);
    return canPlacePixelMaterialAt(room, anchor.x, anchor.y, item.pixelMaterialId ?? 1) ? true : 'occupied';
  }

  if (!isInsideRoom(room, bx, by)) return false;

  // ── Lighting layer ─────────────────────────────────────────────────────
  if (item.category === 'lighting') {
    if (item.isAmbientLightBlockerItem === 1) {
      const xFloor = Math.floor(bx);
      const yFloor = Math.floor(by);
      const already = (room.ambientLightBlockers ?? []).some(
        b => b.xBlock === xFloor && b.yBlock === yFloor,
      );
      return already ? 'occupied' : true;
    }
    // Light sources, sunbeams, and scene lights have no dedup/occupancy rule
    // — any in-bounds cell is valid.
    return true;
  }

  // ── Liquids layer ──────────────────────────────────────────────────────
  if (item.category === 'liquids') {
    const wBlock = item.defaultWidthBlocks ?? 1;
    const hBlock = item.defaultHeightBlocks ?? 1;
    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return false;
    if (isCellCoveredByWaterZone(room, bx, by) || isCellCoveredByLavaZone(room, bx, by)) return 'occupied';
    return true;
  }

  // ── TimeStop Field layer ────────────────────────────────────────────────
  if (item.isTimeStopFieldItem === 1) {
    const wBlock = item.defaultWidthBlocks ?? 1;
    const hBlock = item.defaultHeightBlocks ?? 1;
    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return false;
    if (isCellCoveredByTimeStopField(room, bx, by)) return 'occupied';
    return true;
  }

  const isNonWallSpecialBlock = item.id === 'springboard' || item.id === 'breakable_block_1x1' || item.id === 'breakable_block_2x2';

  if (!isNonWallSpecialBlock && (item.category === 'blocks' || item.category === 'specialBlocks')) {
    const wBlock = getPlacementWidth(item, state.placementRotationSteps);
    const hBlock = getPlacementHeight(item, state.placementRotationSteps);

    if (item.isBouncePadItem === 1) {
      const bounceW = getPlacementWidth(item, state.placementRotationSteps);
      const bounceH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, bounceW, bounceH)) return false;
      const existingBouncePads = room.bouncePads ?? [];
      const overlapsBounce = existingBouncePads.some(b =>
        bx < b.xBlock + b.wBlock && bx + bounceW > b.xBlock &&
        by < b.yBlock + b.hBlock && by + bounceH > b.yBlock,
      );
      if (overlapsBounce) return 'occupied';
      if (rectOverlapsFallingBlocks(room, bx, by, bounceW, bounceH)) return 'occupied';
      return true;
    }

    if (item.isKineticBlockItem === 1) {
      const kbW = getPlacementWidth(item, state.placementRotationSteps);
      const kbH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, kbW, kbH)) return false;
      const existingKineticBlocks = room.kineticBlocks ?? [];
      const overlapsKinetic = existingKineticBlocks.some(kb =>
        bx < kb.xBlock + kb.wBlock && bx + kbW > kb.xBlock &&
        by < kb.yBlock + kb.hBlock && by + kbH > kb.yBlock,
      );
      if (overlapsKinetic) return 'occupied';
      if (rectOverlapsFallingBlocks(room, bx, by, kbW, kbH)) return 'occupied';
      return true;
    }

    if (item.isGrappleCarryBlockItem === 1) {
      return canPlaceGrappleCarryBlockAt(room, bx, by) ? true : 'occupied';
    }

    if (item.isPhantasmalTileItem === 1) {
      return canPlacePhantasmalTileAt(room, bx, by) ? true : 'occupied';
    }

    // Crumble ("Cracked") modifier: checked BEFORE the plain isSpikeItem
    // branch below so that placing a spike palette item while the Cracked
    // modifier is active creates a crumble spike (EditorCrumbleBlock with
    // spikeDirection/spikeSize — see handleCrumbleModifierToggle's inverse
    // conversion) instead of silently placing an ordinary, unbreakable spike.
    if (item.isCrumbleBlockItem === 1 || (item.category === 'blocks' && item.isPlatformItem !== 1 && item.isLaserItem !== 1 &&
      (state.pendingBlockPlacementModifier === 'cracked' || state.pendingBlockPlacementModifier === 'secret'))) {
      const crumbleW = getPlacementWidth(item, state.placementRotationSteps);
      const crumbleH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, crumbleW, crumbleH)) return false;
      const crumbles = room.crumbleBlocks ?? [];
      const overlapsCrumble = crumbles.some(b => {
        const bw = b.wBlock ?? 1;
        const bh = b.hBlock ?? 1;
        return bx < b.xBlock + bw && bx + crumbleW > b.xBlock &&
               by < b.yBlock + bh && by + crumbleH > b.yBlock;
      });
      if (overlapsCrumble) return 'occupied';
      if (rectOverlapsFallingBlocks(room, bx, by, crumbleW, crumbleH)) return 'occupied';
      if (item.isSpikeItem === 1) {
        const spikeSizeBlocks = (item.spikeSize ?? '1x1') === '2x2' ? 2 : 1;
        const overlapsSpike = (room.spikes ?? []).some(sp => {
          const spSize = sp.size === '2x2' ? 2 : 1;
          return bx < sp.xBlock + spSize && bx + spikeSizeBlocks > sp.xBlock &&
                 by < sp.yBlock + spSize && by + spikeSizeBlocks > sp.yBlock;
        });
        if (overlapsSpike) return 'occupied';
      }
      return true;
    }

    if (item.isSpikeItem === 1) {
      const spikeSize = item.spikeSize ?? '1x1';
      const spikeW = getPlacementWidth(item, state.placementRotationSteps);
      const spikeH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, spikeW, spikeH)) return false;
      const spikes = room.spikes ?? [];
      const spikeSizeBlocks = spikeSize === '2x2' ? 2 : 1;
      const overlapsSpike = spikes.some(sp => {
        const spSize = sp.size === '2x2' ? 2 : 1;
        return bx < sp.xBlock + spSize && bx + spikeSizeBlocks > sp.xBlock &&
               by < sp.yBlock + spSize && by + spikeSizeBlocks > sp.yBlock;
      });
      if (overlapsSpike) return 'occupied';
      if (rectOverlapsFallingBlocks(room, bx, by, spikeW, spikeH)) return 'occupied';
      return true;
    }

    if (item.isLaserItem === 1) {
      if (!rectFitsInsideRoom(room, bx, by, 1, 1)) return false;
      const overlapsLaser = (room.lasers ?? []).some(l => l.xBlock === bx && l.yBlock === by);
      if (overlapsLaser) return 'occupied';
      if (rectOverlapsFallingBlocks(room, bx, by, 1, 1)) return 'occupied';
      return true;
    }

    // Falling modifier is only representable for plain rectangular blocks —
    // EditorFallingBlock has no ramp/stairs/pillar/spike shape fields (each
    // tile is always a plain square), so stairs/smooth-ramp/half-pillar/spike
    // palette items never reach this branch even if a falling modifier is
    // pending (the Block Modifier panel hides those checkboxes for such
    // items — see editorUI.ts's supportsFallingModifier).
    if (item.isFallingBlockItem === 1 || (
      item.category === 'blocks' &&
      item.isPlatformItem !== 1 &&
      item.isStairsItem !== 1 && item.isSmoothRampItem !== 1 &&
      item.isPillarHalfWidthItem !== 1 && item.isSpikeItem !== 1 && item.isLaserItem !== 1 &&
      (state.pendingBlockPlacementModifier === 'tough' || state.pendingBlockPlacementModifier === 'sensitive' || state.pendingBlockPlacementModifier === 'crumbling')
    )) {
      const fallingW = getPlacementWidth(item, state.placementRotationSteps);
      const fallingH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, fallingW, fallingH)) return false;
      if (rectOverlapsSolidEditorObject(room, bx, by, fallingW, fallingH)) return 'occupied';
      for (let yOffset = 0; yOffset < fallingH; yOffset++) {
        for (let xOffset = 0; xOffset < fallingW; xOffset++) {
          if (isFallingBlockAt(room, bx + xOffset, by + yOffset)) return 'occupied';
        }
      }
      return true;
    }

    if (
      item.category === 'blocks' &&
      item.isBackgroundBlockItem !== 1 &&
      item.isPlatformItem !== 1 &&
      item.isRampItem !== 1 &&
      item.isStairsItem !== 1 &&
      item.isSmoothRampItem !== 1 &&
      state.pendingBlockPlacementModifier === 'background'
    ) {
      const bgW = getPlacementWidth(item, state.placementRotationSteps);
      const bgH = getPlacementHeight(item, state.placementRotationSteps);
      return rectFitsInsideRoom(room, bx, by, bgW, bgH);
    }

    if (item.isBackgroundBlockItem === 1) {
      const bgW = getPlacementWidth(item, state.placementRotationSteps);
      const bgH = getPlacementHeight(item, state.placementRotationSteps);
      return rectFitsInsideRoom(room, bx, by, bgW, bgH);
    }

    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return false;
    const overlaps = room.interiorWalls.some(w => wallsOverlap(w, bx, by, wBlock, hBlock));
    if (overlaps) return 'occupied';
    if (rectOverlapsFallingBlocks(room, bx, by, wBlock, hBlock)) return 'occupied';
    return true;
  }

  // ── Dedup-by-position "singleton per cell" objects ───────────────────────
  const dedupPointArrays: (readonly { xBlock: number; yBlock: number }[] | undefined)[] = [];
  if (item.id === 'challenge_totem') dedupPointArrays.push(room.challengeTotems);
  if (item.id === 'save_tomb') dedupPointArrays.push(room.saveTombs);
  if (item.id === 'skill_tomb') dedupPointArrays.push(room.skillTombs);
  if (item.isDustContainerItem === 1 || item.id === 'dust_container') dedupPointArrays.push(room.dustContainers);
  if (item.isDustContainerPieceItem === 1 || item.id === 'dust_container_piece') dedupPointArrays.push(room.dustContainerPieces);
  if (item.isDustSwarmItem === 1 || item.id === 'dust_swarm') dedupPointArrays.push(room.dustSwarms);
  if (item.isLambdaAnchorItem === 1 || item.id === 'lambda_anchor') dedupPointArrays.push(room.lambdaAnchors);
  if (item.id === 'firefly_jar') dedupPointArrays.push(room.fireflyJars);
  if (item.id === 'springboard') dedupPointArrays.push(room.springboards);
  if (item.id === 'breakable_block_1x1') dedupPointArrays.push(room.breakableBlocks);
  for (const arr of dedupPointArrays) {
    if ((arr ?? []).some(p => p.xBlock === bx && p.yBlock === by)) return 'occupied';
  }
  if (dedupPointArrays.length > 0) return true;

  if (item.id === 'breakable_block_2x2') {
    const cells: Array<[number, number]> = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]];
    for (const [cx, cy] of cells) {
      if (!isInsideRoom(room, cx, cy)) return false;
      if ((room.breakableBlocks ?? []).some(a => a.xBlock === cx && a.yBlock === cy)) return 'occupied';
    }
    return true;
  }

  if (item.id === 'decoration_mushroom' || item.id === 'decoration_glowgrass' || item.id === 'decoration_vine') {
    const isVine = item.id === 'decoration_vine';
    const targetRow = isVine
      ? findCeilingBlockRow(room, bx, by)
      : findFloorBlockRow(room, bx, by);
    if (targetRow === null) return false;
    const kind = item.id === 'decoration_mushroom' ? 'mushroom' : item.id === 'decoration_glowgrass' ? 'glowGrass' : 'vine';
    const alreadyPlaced = (room.decorations ?? []).some(d => d.xBlock === bx && d.yBlock === targetRow && d.kind === kind);
    return alreadyPlaced ? 'occupied' : true;
  }

  if (item.category === 'ropes') {
    // First click of a rope only sets a pending anchor — always "valid" as a
    // location (the second click is what can actually fail min-length/wall-
    // crossing checks, and this preflight has no way to know the anchor a
    // hypothetical second click would use without mutating state).
    if (state.pendingRopeAnchorXBlock === null) return true;
    const ax = state.pendingRopeAnchorXBlock;
    const ay = state.pendingRopeAnchorYBlock!;
    const dx = bx - ax;
    const dy = by - ay;
    const lenBlocks = Math.sqrt(dx * dx + dy * dy);
    if (lenBlocks <= MIN_ROPE_LENGTH_BLOCKS) return false;
    if (ropeLineCrossesWall(room, ax, ay, bx, by)) return false;
    return true;
  }

  if (item.isGuideDustPathItem === 1) {
    // Always valid — either starts a new path or extends the active one.
    return true;
  }

  if (item.isCustomBlockItem === 1 && item.customBlockId !== undefined) {
    const tw = item.customBlockTileWidth ?? 1;
    const th = item.customBlockTileHeight ?? 1;
    if (!rectFitsInsideRoom(room, bx, by, tw, th)) return false;
    for (const w of room.interiorWalls) {
      if (bx < w.xBlock + w.wBlock && bx + tw > w.xBlock &&
          by < w.yBlock + w.hBlock && by + th > w.yBlock) return 'occupied';
    }
    const existingPlacements = room.customBlockPlacements ?? [];
    for (const ep of existingPlacements) {
      if (bx < ep.xBlock + ep.tileWidth && bx + tw > ep.xBlock &&
          by < ep.yBlock + ep.tileHeight && by + th > ep.yBlock) return 'occupied';
    }
    return true;
  }

  if (item.zipMoveBlockVariant !== undefined) {
    const startX = state.brushMode === 'rect' ? state.brushRectStartBlockX : null;
    const startY = state.brushMode === 'rect' ? state.brushRectStartBlockY : null;
    const xBlock = startX === null ? bx : Math.min(startX, bx);
    const yBlock = startY === null ? by : Math.min(startY, by);
    const requestedW = startX === null ? 3 : Math.abs(bx - startX) + 1;
    const requestedH = startY === null ? 3 : Math.abs(by - startY) + 1;
    const wBlock = Math.min(Math.max(3, requestedW), room.widthBlocks - xBlock);
    const hBlock = Math.min(Math.max(3, requestedH), room.heightBlocks - yBlock);
    return wBlock >= 3 && hBlock >= 3;
  }

  if (item.id === 'challenge_field' || item.id.endsWith('_gate')) {
    const rectStartX = state.brushMode === 'rect' ? state.brushRectStartBlockX : null;
    const rectStartY = state.brushMode === 'rect' ? state.brushRectStartBlockY : null;
    const xBlock = rectStartX === null ? bx : Math.min(rectStartX, bx);
    const yBlock = rectStartY === null ? by : Math.min(rectStartY, by);
    const requestedW = rectStartX === null ? item.defaultWidthBlocks ?? 1 : Math.abs(bx - rectStartX) + 1;
    const requestedH = rectStartY === null ? item.defaultHeightBlocks ?? 1 : Math.abs(by - rectStartY) + 1;
    const wBlock = Math.min(requestedW, room.widthBlocks - xBlock);
    const hBlock = Math.min(requestedH, room.heightBlocks - yBlock);
    return wBlock >= 1 && hBlock >= 1;
  }

  // Enemies, player spawn, room transitions, campaign spawn (handled via its
  // own singleton modal flow in the controller), and grasshopper areas have
  // no occupancy rule beyond being in-bounds, which was already checked above.
  return true;
}

/**
 * Places the currently selected palette item at the given block coordinates.
 * Internal helper — use placeAtCursor() externally.
 */
function placeAt(state: EditorState, bx: number, by: number): void {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return;

  if (!isInsideRoom(room, bx, by)) return;

  // Authoritative preflight guard: re-run the exact same side-effect-free
  // checks the preview/toast layer used to decide this placement looked
  // valid. Keeps this function as the sole mutation authority — a caller
  // that skipped its own `getPlacementStatus` check (or a preflight that's
  // out of sync) still can't cause a mutation past this point.
  if (wouldPlacementSucceedAt(state, bx, by) !== true) return;

  // ── Lighting layer ─────────────────────────────────────────────────────
  if (item.category === 'lighting') {
    const xFloor = Math.floor(bx);
    const yFloor = Math.floor(by);
    if (item.isAmbientLightBlockerItem === 1) {
      const isDarkFlag: 0 | 1 = item.isDarkAmbientLightBlockerItem === 1 ? 1 : 0;
      const already = (room.ambientLightBlockers ?? []).some(
        b => b.xBlock === xFloor && b.yBlock === yFloor,
      );
      if (already) return;
      if (!room.ambientLightBlockers) room.ambientLightBlockers = [];
      room.ambientLightBlockers.push({
        uid: allocateUid(state),
        xBlock: xFloor,
        yBlock: yFloor,
        isDarkFlag,
      });
      return;
    }
    if (item.isLightSourceItem === 1) {
      if (!room.lightSources) room.lightSources = [];
      room.lightSources.push({
        uid: allocateUid(state),
        xBlock: xFloor,
        yBlock: yFloor,
        radiusBlocks: 6,
        colorR: 255,
        colorG: 230,
        colorB: 180,
        brightnessPct: 100,
        dustMoteCount: 0,
        dustMoteSpreadBlocks: 0,
      });
      return;
    }
    if (item.isSunbeamItem === 1) {
      if (!room.sunbeams) room.sunbeams = [];
      room.sunbeams.push({
        uid: allocateUid(state),
        xBlock: xFloor,
        yBlock: yFloor,
        angleRad: Math.PI / 4,
        widthBlocks: 3,
        lengthBlocks: 12,
        colorR: 255,
        colorG: 240,
        colorB: 200,
        intensityPct: 50,
      } as EditorSunbeam);
      return;
    }
    if (item.isSceneLightItem === 1) {
      if (!room.sceneLights) room.sceneLights = [];
      const lightDef = createDefaultLight(
        state.pendingSceneLightType,
        xFloor * BLOCK_SIZE_MEDIUM,
        yFloor * BLOCK_SIZE_MEDIUM,
      );
      room.sceneLights.push({ uid: allocateUid(state), ...lightDef });
      return;
    }
  }

  // ── Liquids layer ──────────────────────────────────────────────────────
  // Liquids are paintable 1×1 tiles (no gravity, no floor requirement).
  // Painting the same cell twice is idempotent — no duplicates created.
  if (item.category === 'liquids') {
    const wBlock = item.defaultWidthBlocks ?? 1;
    const hBlock = item.defaultHeightBlocks ?? 1;
    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    if (item.id === 'water_zone') {
      // No-op (not an error) if this cell is already covered by any existing
      // water zone (including a larger merged/hydrated rectangle, not just an
      // exact position+size match) — avoids duplicate/overlapping water. Also
      // a safe no-op over existing lava: replacing one liquid with another via
      // Fill/paint is not a supported editor feature.
      if (isCellCoveredByWaterZone(room, bx, by) || isCellCoveredByLavaZone(room, bx, by)) return;
      if (!room.waterZones) room.waterZones = [];
      room.waterZones.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    } else if (item.id === 'lava_zone') {
      if (isCellCoveredByLavaZone(room, bx, by) || isCellCoveredByWaterZone(room, bx, by)) return;
      if (!room.lavaZones) room.lavaZones = [];
      room.lavaZones.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    }
    markLiquidBodiesDirty();
    return;
  }

  // ── TimeStop Field layer ────────────────────────────────────────────────
  // Non-solid paintable 1×1 tiles, independent of the water/lava layer.
  // Painting the same cell twice is idempotent — no duplicates created.
  if (item.isTimeStopFieldItem === 1) {
    const wBlock = item.defaultWidthBlocks ?? 1;
    const hBlock = item.defaultHeightBlocks ?? 1;
    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    if (isCellCoveredByTimeStopField(room, bx, by)) return;
    if (!room.timeStopFields) room.timeStopFields = [];
    room.timeStopFields.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    return;
  }

  // Springboard / generic breakable blocks are `specialBlocks`-category items
  // for palette/preview purposes, but they are NOT wall-array entries at
  // runtime (unlike bounce pads, kinetic blocks, etc. handled inside the
  // block below) — they have their own dedicated branches further down.
  // Excluded here so they don't fall through to the generic wall push at the
  // end of this block.
  const isNonWallSpecialBlock = item.id === 'springboard' || item.id === 'breakable_block_1x1' || item.id === 'breakable_block_2x2';

  if (!isNonWallSpecialBlock && (item.category === 'blocks' || item.category === 'specialBlocks')) {
    const wBlock = getPlacementWidth(item, state.placementRotationSteps);
    const hBlock = getPlacementHeight(item, state.placementRotationSteps);
    const isPlatformFlag: 0 | 1 = item.isPlatformItem === 1 ? 1 : 0;
    const placementBlockTheme = item.blockThemeOverride ?? state.selectedBlockTheme;

    // Rotation cycles through the four orientations; flipH mirrors left/right
    // by toggling the low bit.  Stairs use the identical convention as ramps.
    const shapeOrientation = (
      state.placementFlipH
        ? ((state.placementRotationSteps % 4) ^ 1)
        : (state.placementRotationSteps % 4)
    ) as 0 | 1 | 2 | 3;

    let rampOrientation: 0 | 1 | 2 | 3 | undefined;
    if (item.isRampItem === 1) rampOrientation = shapeOrientation;

    let stairsOrientation: 0 | 1 | 2 | 3 | undefined;
    if (item.isStairsItem === 1) stairsOrientation = shapeOrientation;

    let smoothRampOrientation: 0 | 1 | 2 | 3 | undefined;
    if (item.isSmoothRampItem === 1) smoothRampOrientation = shapeOrientation;

    const platformEdgeMap: readonly (0 | 1 | 2 | 3)[] = [0, 3, 1, 2];
    const platformEdge: 0 | 1 | 2 | 3 = isPlatformFlag === 1
      ? platformEdgeMap[state.placementRotationSteps % 4]
      : 0;

    const isPillarHalfWidthFlag: 0 | 1 = item.isPillarHalfWidthItem === 1 ? 1 : 0;

    if (item.isBouncePadItem === 1) {
      const bounceW = getPlacementWidth(item, state.placementRotationSteps);
      const bounceH = getPlacementHeight(item, state.placementRotationSteps);
      let bounceRamp: 0 | 1 | 2 | 3 | undefined;
      if (item.isRampItem === 1) {
        const base = state.placementRotationSteps % 4;
        bounceRamp = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }
      if (!rectFitsInsideRoom(room, bx, by, bounceW, bounceH)) return;
      const existingBouncePads = room.bouncePads ?? [];
      const overlapsBounce = existingBouncePads.some(b =>
        bx < b.xBlock + b.wBlock && bx + bounceW > b.xBlock &&
        by < b.yBlock + b.hBlock && by + bounceH > b.yBlock,
      );
      if (overlapsBounce) return;
      if (rectOverlapsFallingBlocks(room, bx, by, bounceW, bounceH)) return;
      if (!room.bouncePads) room.bouncePads = [];
      const bp: EditorBouncePad = {
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock: bounceW,
        hBlock: bounceH,
        rampOrientation: bounceRamp,
        speedFactorIndex: item.bouncePadSpeedFactorIndex ?? 0,
      };
      room.bouncePads.push(bp);
      return;
    }

    if (item.isKineticBlockItem === 1) {
      const kbW = getPlacementWidth(item, state.placementRotationSteps);
      const kbH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, kbW, kbH)) return;
      const existingKineticBlocks = room.kineticBlocks ?? [];
      const overlapsKinetic = existingKineticBlocks.some(kb =>
        bx < kb.xBlock + kb.wBlock && bx + kbW > kb.xBlock &&
        by < kb.yBlock + kb.hBlock && by + kbH > kb.yBlock,
      );
      if (overlapsKinetic) return;
      if (rectOverlapsFallingBlocks(room, bx, by, kbW, kbH)) return;
      if (!room.kineticBlocks) room.kineticBlocks = [];
      const kb: EditorKineticBlock = {
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock: kbW,
        hBlock: kbH,
      };
      room.kineticBlocks.push(kb);
      return;
    }

    // ── Spikes ────────────────────────────────────────────────────────────────
    if (item.isGrappleCarryBlockItem === 1) {
      if (!canPlaceGrappleCarryBlockAt(room, bx, by)) return;
      if (!room.grappleCarryBlocks) room.grappleCarryBlocks = [];
      const block: EditorGrappleCarryBlock = {
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
      };
      room.grappleCarryBlocks.push(block);
      return;
    }

    if (item.isPhantasmalTileItem === 1) {
      if (!canPlacePhantasmalTileAt(room, bx, by)) return;
      if (!room.phantasmalTiles) room.phantasmalTiles = [];
      const tile: EditorPhantasmalTile = {
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
      };
      room.phantasmalTiles.push(tile);
      return;
    }

    // Crumble ("Cracked") modifier: checked BEFORE the plain isSpikeItem
    // branch below so that placing a spike palette item while the Cracked
    // modifier is active creates a crumble spike (with spikeDirection/
    // spikeSize set, mirroring handleCrumbleModifierToggle's inverse
    // conversion in editorPropertyChange.ts) instead of silently placing an
    // ordinary, unbreakable spike that ignores the active modifier.
    if (item.isCrumbleBlockItem === 1 || (item.category === 'blocks' && item.isPlatformItem !== 1 && item.isLaserItem !== 1 &&
      (state.pendingBlockPlacementModifier === 'cracked' || state.pendingBlockPlacementModifier === 'secret'))) {
      const crumbleW = getPlacementWidth(item, state.placementRotationSteps);
      const crumbleH = getPlacementHeight(item, state.placementRotationSteps);

      let crumbleRamp: 0 | 1 | 2 | 3 | undefined;
      if (item.isRampItem === 1) {
        const base = state.placementRotationSteps % 4;
        crumbleRamp = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }

      let crumbleStairs: 0 | 1 | 2 | 3 | undefined;
      if (item.isStairsItem === 1) {
        const base = state.placementRotationSteps % 4;
        crumbleStairs = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }

      let crumbleSmoothRamp: 0 | 1 | 2 | 3 | undefined;
      if (item.isSmoothRampItem === 1) {
        const base = state.placementRotationSteps % 4;
        crumbleSmoothRamp = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }

      const crumblePillar: 0 | 1 | undefined = item.isPillarHalfWidthItem === 1 ? 1 : undefined;

      // Direction follows the same 90°-CW rotation steps used for ramps/
      // platforms/plain spikes: 0=up, 1=right, 2=down, 3=left (see
      // _spikeDirRotStep in render/hazards.ts).
      const spikeDirections: readonly ('up' | 'right' | 'down' | 'left')[] = ['up', 'right', 'down', 'left'];
      const crumbleSpikeDirection = item.isSpikeItem === 1
        ? spikeDirections[state.placementRotationSteps % 4]
        : undefined;
      const crumbleSpikeSize = item.isSpikeItem === 1 ? (item.spikeSize ?? '1x1') : undefined;

      if (!rectFitsInsideRoom(room, bx, by, crumbleW, crumbleH)) return;

      const crumbles = room.crumbleBlocks ?? [];
      const overlapsCrumble = crumbles.some(b => {
        const bw = b.wBlock ?? 1;
        const bh = b.hBlock ?? 1;
        return bx < b.xBlock + bw && bx + crumbleW > b.xBlock &&
               by < b.yBlock + bh && by + crumbleH > b.yBlock;
      });
      if (overlapsCrumble) return;
      if (rectOverlapsFallingBlocks(room, bx, by, crumbleW, crumbleH)) return;
      if (item.isSpikeItem === 1) {
        const spikeSizeBlocks = crumbleSpikeSize === '2x2' ? 2 : 1;
        const overlapsSpike = (room.spikes ?? []).some(sp => {
          const spSize = sp.size === '2x2' ? 2 : 1;
          return bx < sp.xBlock + spSize && bx + spikeSizeBlocks > sp.xBlock &&
                 by < sp.yBlock + spSize && by + spikeSizeBlocks > sp.yBlock;
        });
        if (overlapsSpike) return;
      }

      if (!room.crumbleBlocks) room.crumbleBlocks = [];
      room.crumbleBlocks.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock: crumbleW,
        hBlock: crumbleH,
        rampOrientation: crumbleRamp,
        stairsOrientation: crumbleStairs,
        smoothRampOrientation: crumbleSmoothRamp,
        isPillarHalfWidthFlag: crumblePillar,
        variant: state.pendingCrumbleVariant,
        isSecretFlag: state.pendingBlockPlacementModifier === 'secret' ? 1 : undefined,
        blockTheme: placementBlockTheme,
        spikeDirection: crumbleSpikeDirection,
        spikeSize: crumbleSpikeSize,
      });
      return;
    }

    if (item.isSpikeItem === 1) {
      const spikeSize = item.spikeSize ?? '1x1';
      const spikeW = getPlacementWidth(item, state.placementRotationSteps);
      const spikeH = getPlacementHeight(item, state.placementRotationSteps);
      // Direction follows the same 90°-CW rotation steps used for ramps/platforms:
      // 0=up, 1=right, 2=down, 3=left (see _spikeDirRotStep in render/hazards.ts).
      const spikeDirections: readonly ('up' | 'right' | 'down' | 'left')[] = ['up', 'right', 'down', 'left'];
      const spikeDirection = spikeDirections[state.placementRotationSteps % 4];

      if (!rectFitsInsideRoom(room, bx, by, spikeW, spikeH)) return;
      const spikes = room.spikes ?? [];
      const spikeSizeBlocks = spikeSize === '2x2' ? 2 : 1;
      const overlapsSpike = spikes.some(sp => {
        const spSize = sp.size === '2x2' ? 2 : 1;
        return bx < sp.xBlock + spSize && bx + spikeSizeBlocks > sp.xBlock &&
               by < sp.yBlock + spSize && by + spikeSizeBlocks > sp.yBlock;
      });
      if (overlapsSpike) return;
      if (rectOverlapsFallingBlocks(room, bx, by, spikeW, spikeH)) return;

      if (!room.spikes) room.spikes = [];
      room.spikes.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        direction: spikeDirection,
        size: spikeSize,
        blockTheme: placementBlockTheme,
      });
      return;
    }

    if (item.isLaserItem === 1) {
      // Direction follows the same 90°-CW rotation steps used for spikes:
      // 0=up, 1=right, 2=down, 3=left.
      const laserDirections: readonly ('up' | 'right' | 'down' | 'left')[] = ['up', 'right', 'down', 'left'];
      const laserDirection = laserDirections[state.placementRotationSteps % 4];

      if (!rectFitsInsideRoom(room, bx, by, 1, 1)) return;
      const overlapsLaser = (room.lasers ?? []).some(l => l.xBlock === bx && l.yBlock === by);
      if (overlapsLaser) return;
      if (rectOverlapsFallingBlocks(room, bx, by, 1, 1)) return;

      if (!room.lasers) room.lasers = [];
      room.lasers.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        direction: laserDirection,
      });
      return;
    }

    // ── Falling block tiles ──────────────────────────────────────────────────
    // Falling modifier is only representable for plain rectangular blocks —
    // EditorFallingBlock has no ramp/stairs/pillar/spike shape fields (each
    // tile is always a plain square), so stairs/smooth-ramp/half-pillar/spike
    // palette items never reach this branch even with a falling modifier
    // pending (the Block Modifier panel hides those checkboxes for such
    // items — see editorUI.ts's supportsFallingModifier).
    if (item.isFallingBlockItem === 1 || (
      item.category === 'blocks' &&
      item.isPlatformItem !== 1 &&
      item.isStairsItem !== 1 && item.isSmoothRampItem !== 1 &&
      item.isPillarHalfWidthItem !== 1 && item.isSpikeItem !== 1 && item.isLaserItem !== 1 &&
      (state.pendingBlockPlacementModifier === 'tough' || state.pendingBlockPlacementModifier === 'sensitive' || state.pendingBlockPlacementModifier === 'crumbling')
    )) {
      const variant = item.fallingBlockVariant ?? (
        state.pendingBlockPlacementModifier === 'sensitive' || state.pendingBlockPlacementModifier === 'crumbling'
          ? state.pendingBlockPlacementModifier
          : 'tough'
      );
      const fallingW = getPlacementWidth(item, state.placementRotationSteps);
      const fallingH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, fallingW, fallingH)) return;
      if (rectOverlapsSolidEditorObject(room, bx, by, fallingW, fallingH)) return;
      for (let yOffset = 0; yOffset < fallingH; yOffset++) {
        for (let xOffset = 0; xOffset < fallingW; xOffset++) {
          if (isFallingBlockAt(room, bx + xOffset, by + yOffset)) return;
        }
      }
      if (!room.fallingBlocks) room.fallingBlocks = [];
      for (let yOffset = 0; yOffset < fallingH; yOffset++) {
        for (let xOffset = 0; xOffset < fallingW; xOffset++) {
          const fb: EditorFallingBlock = {
            uid: allocateUid(state),
            xBlock: bx + xOffset,
            yBlock: by + yOffset,
            variant,
            blockTheme: placementBlockTheme,
          };
          room.fallingBlocks.push(fb);
        }
      }
      return;
    }

    // ── Background modifier on ordinary blocks (visual-only, no collision) ───
    // "Background" is a block modifier (see editorUI.ts's Block Modifier
    // panel), not a standalone palette item any more. When active, placing an
    // ordinary 1×1/2×2 (non-platform, non-ramp, non-stairs) block creates a
    // visual-only background block using the currently selected block theme
    // and footprint instead of a collidable wall. Incompatible with
    // cracked/falling — those are mutually exclusive via
    // pendingBlockPlacementModifier already holding a single value.
    if (
      item.category === 'blocks' &&
      item.isBackgroundBlockItem !== 1 &&
      item.isPlatformItem !== 1 &&
      item.isRampItem !== 1 &&
      item.isStairsItem !== 1 &&
      item.isSmoothRampItem !== 1 &&
      state.pendingBlockPlacementModifier === 'background'
    ) {
      const bgW = getPlacementWidth(item, state.placementRotationSteps);
      const bgH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, bgW, bgH)) return;
      if (!room.backgroundBlocks) room.backgroundBlocks = [];
      room.backgroundBlocks.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock: bgW,
        hBlock: bgH,
        blockTheme: placementBlockTheme,
        isLightBlockingFlag: state.pendingBackgroundBlocksLight ? 1 : 0,
      });
      return;
    }

    // ── Background blocks (visual-only, no collision) ────────────────────────
    // Legacy path: no palette item sets isBackgroundBlockItem any more (see
    // editorPaletteItems.ts), but this branch is preserved so any code that
    // still constructs a PaletteItem with the flag (e.g. future migrations)
    // keeps working.
    if (item.isBackgroundBlockItem === 1) {
      const bgW = getPlacementWidth(item, state.placementRotationSteps);
      const bgH = getPlacementHeight(item, state.placementRotationSteps);
      if (!rectFitsInsideRoom(room, bx, by, bgW, bgH)) return;
      if (!room.backgroundBlocks) room.backgroundBlocks = [];
      room.backgroundBlocks.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock: bgW,
        hBlock: bgH,
        blockTheme: placementBlockTheme,
        isLightBlockingFlag: item.isLightBlockingBackgroundBlockItem === 1 ? 1 : 0,
      });
      return;
    }

    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    const overlaps = room.interiorWalls.some(w => wallsOverlap(w, bx, by, wBlock, hBlock));
    if (overlaps) return;
    if (rectOverlapsFallingBlocks(room, bx, by, wBlock, hBlock)) return;
    room.interiorWalls.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      wBlock,
      hBlock,
      isPlatformFlag,
      platformEdge,
      blockTheme: placementBlockTheme,
      rampOrientation,
      stairsOrientation,
      smoothRampOrientation,
      isPillarHalfWidthFlag,
    });
  } else if (placeEnemyAtCursor(state, room, item, bx, by)) {
    // Enemy or grasshopper area was placed — handled by editorEnemyPlacer
  } else if (item.id === 'player_spawn') {
    room.playerSpawnBlock = [bx, by];
  } else if (item.id === 'room_transition') {
    const directionMap: ('right' | 'down' | 'left' | 'up')[] = ['right', 'down', 'left', 'up'];
    const direction = directionMap[state.placementRotationSteps % 4];

    // Rect tool: two-click gesture using the shared brushRectStartBlockX/Y
    // anchor state (set by the controller on the first click, cleared after
    // placement). The inclusive bounding box between the anchor and this
    // (second-click) cell determines the transition's edge/direction,
    // opening, and depth — exactly one transition per gesture.
    let placement;
    if (state.brushMode === 'rect' && state.brushRectStartBlockX !== null && state.brushRectStartBlockY !== null) {
      placement = computeRectTransitionPlacement(room, state.brushRectStartBlockX, state.brushRectStartBlockY, bx, by);
    } else if (state.brushMode === 'fill') {
      placement = computeFillTransitionPlacement(room, bx, by, direction);
    } else {
      placement = computeSingleTransitionPlacement(room, bx, by, direction);
    }
    if (placement === null) return;

    room.transitions.push({
      uid: allocateUid(state),
      direction: placement.direction,
      xBlock: placement.xBlock,
      yBlock: placement.yBlock,
      openingSizeBlocks: placement.openingSizeBlocks,
      gradientWidthBlocks: placement.gradientWidthBlocks,
      targetRoomId: '',
      targetSpawnBlock: [3, 3],
      positionBlock: placement.positionBlock,
    });
  } else if (item.zipMoveBlockVariant !== undefined) {
    const startX = state.brushMode === 'rect' ? state.brushRectStartBlockX : null;
    const startY = state.brushMode === 'rect' ? state.brushRectStartBlockY : null;
    const xBlock = startX === null ? bx : Math.min(startX, bx);
    const yBlock = startY === null ? by : Math.min(startY, by);
    const requestedW = startX === null ? 3 : Math.abs(bx - startX) + 1;
    const requestedH = startY === null ? 3 : Math.abs(by - startY) + 1;
    const wBlock = Math.min(Math.max(3, requestedW), room.widthBlocks - xBlock);
    const hBlock = Math.min(Math.max(3, requestedH), room.heightBlocks - yBlock);
    if (wBlock < 3 || hBlock < 3) return;
    (room.zipMoveBlocks ??= []).push({
      uid: allocateUid(state), xBlock, yBlock, wBlock, hBlock, variant: item.zipMoveBlockVariant,
    });
  } else if (item.id === 'challenge_field' || item.id.endsWith('_gate')) {
    const rectStartX = state.brushMode === 'rect' ? state.brushRectStartBlockX : null;
    const rectStartY = state.brushMode === 'rect' ? state.brushRectStartBlockY : null;
    const xBlock = rectStartX === null ? bx : Math.min(rectStartX, bx);
    const yBlock = rectStartY === null ? by : Math.min(rectStartY, by);
    const requestedW = rectStartX === null ? item.defaultWidthBlocks ?? 1 : Math.abs(bx - rectStartX) + 1;
    const requestedH = rectStartY === null ? item.defaultHeightBlocks ?? 1 : Math.abs(by - rectStartY) + 1;
    const wBlock = Math.min(requestedW, room.widthBlocks - xBlock);
    const hBlock = Math.min(requestedH, room.heightBlocks - yBlock);
    if (wBlock < 1 || hBlock < 1) return;
    if (item.id === 'challenge_field') {
      (room.challengeFields ??= []).push({ uid: allocateUid(state), xBlock, yBlock, wBlock, hBlock });
    } else {
      const kind = item.id.slice(0, -5) as import('../levels/gateDefs').GateKind;
      (room.gates ??= []).push({
        schemaVersion: 1, uid: allocateUid(state), kind, xBlock, yBlock, wBlock, hBlock,
        openVisualMode: 'fadeAway', openPersistence: 'untilPlayerLeavesRoom',
        ...(kind === 'speed' ? { requiredSpeed: 180 } : {}),
      });
    }
  } else if (item.id === 'challenge_totem') {
    const target = (room.challengeTotems ??= []);
    if (target.some(t => t.xBlock === bx && t.yBlock === by)) return;
    target.push({ uid: allocateUid(state), xBlock: bx, yBlock: by });
  } else if (item.id === 'save_tomb') {
    // Dedup: no duplicate at same position.
    if (room.saveTombs.some(t => t.xBlock === bx && t.yBlock === by)) return;
    room.saveTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'dialogue_trigger') {
    if (!room.dialogueTriggers) room.dialogueTriggers = [];
    const newUid = allocateUid(state);
    const trigger: EditorDialogueTrigger = {
      uid: newUid,
      xBlock: bx,
      yBlock: by,
      wBlock: 4,
      hBlock: 4,
      conversationId: `conv_${newUid}`,
      conversationTitle: '',
      entries: [],
    };
    room.dialogueTriggers.push(trigger);
  } else if (item.id === 'skill_tomb') {
    // Dedup: no duplicate at same position.
    if (room.skillTombs.some(t => t.xBlock === bx && t.yBlock === by)) return;
    room.skillTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      weaveId: state.pendingSkillTombWeaveId,
    });
  } else if (item.isDustContainerItem === 1 || item.id === 'dust_container') {
    if (!room.dustContainers) room.dustContainers = [];
    // Dedup: no duplicate at same position.
    if (room.dustContainers.some(c => c.xBlock === bx && c.yBlock === by)) return;
    room.dustContainers.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.isDustContainerPieceItem === 1 || item.id === 'dust_container_piece') {
    if (!room.dustContainerPieces) room.dustContainerPieces = [];
    if (room.dustContainerPieces.some(c => c.xBlock === bx && c.yBlock === by)) return;
    room.dustContainerPieces.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.isDustBoostJarItem === 1 || item.id === 'dust_boost_jar') {
    if (!room.dustBoostJars) room.dustBoostJars = [];
    room.dustBoostJars.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      dustKind: state.pendingDustBoostJarKind,
      dustCount: state.pendingDustBoostJarCount,
    });
  } else if (item.isDustSwarmItem === 1 || item.id === 'dust_swarm') {
    if (!room.dustSwarms) room.dustSwarms = [];
    // Dedup: no duplicate at same position.
    if (room.dustSwarms.some(s => s.xBlock === bx && s.yBlock === by)) return;
    room.dustSwarms.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      dustKind: state.pendingDustSwarmKind,
      dustCount: state.pendingDustSwarmCount,
    });
  } else if (item.isLambdaAnchorItem === 1 || item.id === 'lambda_anchor') {
    if (!room.lambdaAnchors) room.lambdaAnchors = [];
    // Dedup: no duplicate at same position.
    if (room.lambdaAnchors.some(a => a.xBlock === bx && a.yBlock === by)) return;
    room.lambdaAnchors.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'firefly_jar') {
    if (!room.fireflyJars) room.fireflyJars = [];
    if (room.fireflyJars.some(a => a.xBlock === bx && a.yBlock === by)) return;
    room.fireflyJars.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'springboard') {
    if (!room.springboards) room.springboards = [];
    if (room.springboards.some(a => a.xBlock === bx && a.yBlock === by)) return;
    room.springboards.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'breakable_block_1x1') {
    if (!room.breakableBlocks) room.breakableBlocks = [];
    if (room.breakableBlocks.some(a => a.xBlock === bx && a.yBlock === by)) return;
    room.breakableBlocks.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'breakable_block_2x2') {
    if (!room.breakableBlocks) room.breakableBlocks = [];
    const groupId = allocateUid(state);
    const cells: Array<[number, number]> = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]];
    for (const [cx, cy] of cells) {
      if (room.breakableBlocks.some(a => a.xBlock === cx && a.yBlock === cy)) return;
    }
    for (const [cx, cy] of cells) {
      room.breakableBlocks.push({
        uid: allocateUid(state),
        xBlock: cx,
        yBlock: cy,
        groupId,
      });
    }
  } else if (item.id === 'dust_pile' || item.id === 'dust_pile_small' || item.id === 'dust_pile_medium' || item.id === 'dust_pile_large') {
    let dustCount: number;
    if (item.id === 'dust_pile_small') {
      dustCount = 3;
    } else if (item.id === 'dust_pile_large') {
      dustCount = 8;
    } else {
      dustCount = 5;
    }
    room.dustPiles.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      dustCount,
    });
  } else if (item.id === 'decoration_mushroom' || item.id === 'decoration_glowgrass' || item.id === 'decoration_vine') {
    const kind: DecorationKind =
      item.id === 'decoration_mushroom'  ? 'mushroom'  :
      item.id === 'decoration_glowgrass' ? 'glowGrass' : 'vine';

    let targetRow: number | null;
    if (kind === 'vine') {
      targetRow = findCeilingBlockRow(room, bx, by);
    } else {
      targetRow = findFloorBlockRow(room, bx, by);
    }

    if (targetRow === null) return;

    const alreadyPlaced = (room.decorations ?? []).some(
      d => d.xBlock === bx && d.yBlock === targetRow && d.kind === kind,
    );
    if (alreadyPlaced) return;

    if (!room.decorations) room.decorations = [];
    room.decorations.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: targetRow,
      kind,
    });
  } else if (item.category === 'ropes') {
    if (state.pendingRopeAnchorXBlock === null) {
      state.pendingRopeAnchorXBlock = bx;
      state.pendingRopeAnchorYBlock = by;
    } else {
      const ax = state.pendingRopeAnchorXBlock;
      const ay = state.pendingRopeAnchorYBlock!;
      const dx = bx - ax;
      const dy = by - ay;
      const lenBlocks = Math.sqrt(dx * dx + dy * dy);
      const isValid = lenBlocks > MIN_ROPE_LENGTH_BLOCKS
        && !ropeLineCrossesWall(room, ax, ay, bx, by);
      if (isValid) {
        if (!room.ropes) room.ropes = [];
        room.ropes.push({
          uid: allocateUid(state),
          anchorAXBlock: ax,
          anchorAYBlock: ay,
          anchorBXBlock: bx,
          anchorBYBlock: by,
          segmentCount: Math.max(2, Math.min(Math.round(lenBlocks * ROPE_SEGMENTS_PER_BLOCK), MAX_ROPE_SEGMENTS)),
          isAnchorBFixedFlag: 1,
          destructibility: 'indestructible',
          thicknessIndex: 0,
        });
      }
      state.pendingRopeAnchorXBlock = null;
      state.pendingRopeAnchorYBlock = null;
    }
  } else if (item.isGuideDustPathItem === 1) {
    if (!room.guideDustPaths) room.guideDustPaths = [];

    // If a guide dust path is currently selected and is still being extended,
    // append the new point to it. Otherwise start a fresh path.
    const activeSel = state.selectedElements.length === 1 ? state.selectedElements[0] : null;
    const activePath: EditorGuideDustPath | undefined =
      activeSel?.type === 'guideDustPath'
        ? room.guideDustPaths.find(p => p.uid === activeSel.uid)
        : undefined;

    if (activePath) {
      activePath.points.push({ xBlock: bx, yBlock: by, speed: 1.0 });
    } else {
      const newPath: EditorGuideDustPath = {
        uid: allocateUid(state),
        points: [
          { xBlock: bx, yBlock: by, speed: 1.0 },
          { xBlock: bx + 2, yBlock: by, speed: 1.0 },
        ],
        loop: false,
        visibleInGame: true,
        moteCount: 8,
        moteSpeedFactor: 1.0,
        opacityPct: 100,
      };
      room.guideDustPaths.push(newPath);
      state.selectedElements = [{ type: 'guideDustPath', uid: newPath.uid }];
      bumpSelectionRevision(state);
    }
  } else if (item.isCustomBlockItem === 1 && item.customBlockId !== undefined) {
    // ── Custom block placement ────────────────────────────────────────────────
    const blockId = item.customBlockId;
    const tw = item.customBlockTileWidth ?? 1;
    const th = item.customBlockTileHeight ?? 1;
    const bx = state.cursorBlockX;
    const by = state.cursorBlockY;

    // Check room bounds
    if (!rectFitsInsideRoom(room, bx, by, tw, th)) return;

    // Check overlap with existing walls / custom blocks
    for (const w of room.interiorWalls) {
      if (bx < w.xBlock + w.wBlock && bx + tw > w.xBlock &&
          by < w.yBlock + w.hBlock && by + th > w.yBlock) return;
    }
    const existingPlacements = room.customBlockPlacements ?? [];
    for (const ep of existingPlacements) {
      const etw = ep.tileWidth;
      const eth = ep.tileHeight;
      if (bx < ep.xBlock + etw && bx + tw > ep.xBlock &&
          by < ep.yBlock + eth && by + th > ep.yBlock) return;
    }

    const newPlacement = { uid: allocateUid(state), xBlock: bx, yBlock: by, blockId: toNamespacedId(blockId), tileWidth: tw, tileHeight: th };
    if (!room.customBlockPlacements) room.customBlockPlacements = [];
    room.customBlockPlacements.push(newPlacement);
    state.selectedElements = [{ type: 'customBlock', uid: newPlacement.uid }];
    bumpSelectionRevision(state);
  }
}
