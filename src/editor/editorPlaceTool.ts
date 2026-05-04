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
  PaletteItem, DecorationKind, EditorBouncePad, EditorSunbeam, EditorFallingBlock,
} from './editorState';
import { placeEnemyAtCursor } from './editorEnemyPlacer';
import { MAX_ROPE_SEGMENTS } from '../sim/world';
import { MIN_ROPE_LENGTH_BLOCKS } from '../levels/roomDef';
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
} from './editorHitTest';

// ── Placement dimension helpers ───────────────────────────────────────────────

function getPlacementWidth(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  return (rotSteps % 2 === 0) ? w : h;
}

function getPlacementHeight(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
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
      wBlock: item.defaultWidthBlocks ?? 4,
      hBlock: item.defaultHeightBlocks ?? 4,
    };
  }
  if (item.category !== 'blocks') {
    return { wBlock: 1, hBlock: 1 };
  }
  return {
    wBlock: getPlacementWidth(item, state.placementRotationSteps),
    hBlock: getPlacementHeight(item, state.placementRotationSteps),
  };
}

// ── Place tool ───────────────────────────────────────────────────────────────

/**
 * Places the currently selected palette item at the cursor location.
 */
export function placeAtCursor(state: EditorState): void {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;

  if (!isInsideRoom(room, bx, by)) return;

  // ── Lighting layer ─────────────────────────────────────────────────────
  // Paint/place handlers for the ambientLightBlockers and local lightSources
  // authoring workflows. Ambient blockers are single-cell and idempotent:
  // clicking the same cell twice leaves it painted once.
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
      // Sensible editor defaults: warm white, full brightness, ~6-block radius.
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
  }

  // ── Liquids layer ──────────────────────────────────────────────────────
  if (item.category === 'liquids') {
    const wBlock = item.defaultWidthBlocks ?? 4;
    const hBlock = item.defaultHeightBlocks ?? 4;
    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    if (item.id === 'water_zone') {
      if (!room.waterZones) room.waterZones = [];
      room.waterZones.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    } else if (item.id === 'lava_zone') {
      if (!room.lavaZones) room.lavaZones = [];
      room.lavaZones.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    }
    return;
  }

  if (item.category === 'blocks') {
    const wBlock = getPlacementWidth(item, state.placementRotationSteps);
    const hBlock = getPlacementHeight(item, state.placementRotationSteps);
    const isPlatformFlag: 0 | 1 = item.isPlatformItem === 1 ? 1 : 0;

    // Compute ramp orientation from rotation steps and flip
    let rampOrientation: 0 | 1 | 2 | 3 | undefined;
    if (item.isRampItem === 1) {
      const base = state.placementRotationSteps % 4;
      // flipH toggles within pairs: 0↔1, 2↔3
      rampOrientation = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
    }

    // Compute platform edge from rotation steps
    // R=0→top(0), R=1→right(3), R=2→bottom(1), R=3→left(2)
    const platformEdgeMap: readonly (0 | 1 | 2 | 3)[] = [0, 3, 1, 2];
    const platformEdge: 0 | 1 | 2 | 3 = isPlatformFlag === 1
      ? platformEdgeMap[state.placementRotationSteps % 4]
      : 0;

    const isPillarHalfWidthFlag: 0 | 1 = item.isPillarHalfWidthItem === 1 ? 1 : 0;

    if (item.isBouncePadItem === 1) {
      const wBlock = getPlacementWidth(item, state.placementRotationSteps);
      const hBlock = getPlacementHeight(item, state.placementRotationSteps);
      let rampOrientation: 0 | 1 | 2 | 3 | undefined;
      if (item.isRampItem === 1) {
        const base = state.placementRotationSteps % 4;
        rampOrientation = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }
      if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
      const existingBouncePads = room.bouncePads ?? [];
      const overlapsBounce = existingBouncePads.some(b =>
        bx < b.xBlock + b.wBlock && bx + wBlock > b.xBlock &&
        by < b.yBlock + b.hBlock && by + hBlock > b.yBlock,
      );
      if (overlapsBounce) return;
      // Don't place over falling block tiles
      if (rectOverlapsFallingBlocks(room, bx, by, wBlock, hBlock)) return;
      if (!room.bouncePads) room.bouncePads = [];
      const bp: EditorBouncePad = {
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock,
        hBlock,
        rampOrientation,
        speedFactorIndex: item.bouncePadSpeedFactorIndex ?? 0,
      };
      room.bouncePads.push(bp);
      return;
    }

    if (item.isCrumbleBlockItem === 1) {
      const wBlock = getPlacementWidth(item, state.placementRotationSteps);
      const hBlock = getPlacementHeight(item, state.placementRotationSteps);

      let rampOrientation: 0 | 1 | 2 | 3 | undefined;
      if (item.isRampItem === 1) {
        const base = state.placementRotationSteps % 4;
        rampOrientation = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }

      if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;

      // Prevent overlapping crumble blocks or falling block tiles
      const crumbles = room.crumbleBlocks ?? [];
      const overlapsCrumble = crumbles.some(b => {
        const bw = b.wBlock ?? 1;
        const bh = b.hBlock ?? 1;
        return bx < b.xBlock + bw && bx + wBlock > b.xBlock &&
               by < b.yBlock + bh && by + hBlock > b.yBlock;
      });
      if (overlapsCrumble) return;
      if (rectOverlapsFallingBlocks(room, bx, by, wBlock, hBlock)) return;

      if (!room.crumbleBlocks) room.crumbleBlocks = [];
      room.crumbleBlocks.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock,
        hBlock,
        rampOrientation,
        variant: state.pendingCrumbleVariant,
        blockTheme: state.selectedBlockTheme,
      });
      return;
    }

    // ── Falling block tiles ──────────────────────────────────────────────────
    if (item.isFallingBlockItem === 1) {
      const variant = item.fallingBlockVariant ?? 'tough';
      if (!rectFitsInsideRoom(room, bx, by, 1, 1)) return;
      // Don't place if a falling block tile already occupies this cell
      if (isFallingBlockAt(room, bx, by)) return;
      // Don't place over solid objects (walls, crumble blocks, bounce pads)
      if (rectOverlapsSolidEditorObject(room, bx, by, 1, 1)) return;
      if (!room.fallingBlocks) room.fallingBlocks = [];
      const fb: EditorFallingBlock = {
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        variant,
      };
      room.fallingBlocks.push(fb);
      return;
    }

    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    // Prevent overlapping walls or falling block tiles
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
      blockTheme: state.selectedBlockTheme,
      rampOrientation,
      isPillarHalfWidthFlag,
    });
  } else if (placeEnemyAtCursor(state, room, item, bx, by)) {
    // Enemy or grasshopper area was placed — handled by editorEnemyPlacer
  } else if (item.id === 'player_spawn') {
    room.playerSpawnBlock = [bx, by];
  } else if (item.id === 'room_transition') {
    // Determine direction from the nearest room edge
    const distLeft   = bx;
    const distRight  = room.widthBlocks  - 1 - bx;
    const distTop    = by;
    const distBottom = room.heightBlocks - 1 - by;
    const minDist    = Math.min(distLeft, distRight, distTop, distBottom);
    const direction: 'left' | 'right' | 'up' | 'down' =
      minDist === distLeft   ? 'left'  :
      minDist === distRight  ? 'right' :
      minDist === distTop    ? 'up'    : 'down';

    const OPENING_SIZE = 6;
    const isHoriz = direction === 'left' || direction === 'right';

    const openingSizeBlocks = isHoriz
      ? Math.max(1, Math.min(OPENING_SIZE, room.heightBlocks - 2))
      : Math.max(1, Math.min(OPENING_SIZE, room.widthBlocks - 2));

    const positionBlock = isHoriz
      ? Math.min(Math.max(1, by - Math.floor(openingSizeBlocks / 2)), room.heightBlocks - 1 - openingSizeBlocks)
      : Math.min(Math.max(1, bx - Math.floor(openingSizeBlocks / 2)), room.widthBlocks - 1 - openingSizeBlocks);

    // Determine whether this is an interior transition (cursor not at the boundary edge)
    const ZONE_DEPTH = 6;
    const isEdge =
      (direction === 'left'  && bx <= ZONE_DEPTH)      ||
      (direction === 'right' && bx >= room.widthBlocks - ZONE_DEPTH) ||
      (direction === 'up'    && by <= ZONE_DEPTH)      ||
      (direction === 'down'  && by >= room.heightBlocks - ZONE_DEPTH);

    let depthBlock: number | undefined;
    if (!isEdge) {
      // Interior: anchor the zone so the cursor is at the entry side
      depthBlock = isHoriz
        ? Math.min(Math.max(0, bx), room.widthBlocks - ZONE_DEPTH)
        : Math.min(Math.max(0, by), room.heightBlocks - ZONE_DEPTH);
    }

    room.transitions.push({
      uid: allocateUid(state),
      direction,
      positionBlock,
      openingSizeBlocks,
      targetRoomId: '',
      targetSpawnBlock: [3, by + 2],
      depthBlock,
    });
  } else if (item.id === 'save_tomb') {
    room.saveTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'skill_tomb') {
    room.skillTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      weaveId: state.pendingSkillTombWeaveId,
    });
  } else if (item.isDustContainerItem === 1 || item.id === 'dust_container') {
    if (!room.dustContainers) room.dustContainers = [];
    room.dustContainers.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.isDustContainerPieceItem === 1 || item.id === 'dust_container_piece') {
    if (!room.dustContainerPieces) room.dustContainerPieces = [];
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
  } else if (item.id === 'dust_pile' || item.id === 'dust_pile_small' || item.id === 'dust_pile_medium' || item.id === 'dust_pile_large') {
    let dustCount: number;
    if (item.id === 'dust_pile_small') {
      dustCount = 3;  // small pile — tight cluster
    } else if (item.id === 'dust_pile_large') {
      dustCount = 8;  // large pile — wide scatter
    } else {
      dustCount = 5;  // medium pile (dust_pile / dust_pile_medium)
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
      // Vine: find the first solid block ABOVE the cursor, hang from its bottom.
      targetRow = findCeilingBlockRow(room, bx, by);
    } else {
      // Floor decorations: find the first solid block AT OR BELOW the cursor.
      targetRow = findFloorBlockRow(room, bx, by);
    }

    if (targetRow === null) return; // no valid surface — do not place

    // Avoid duplicate decoration at the same cell and kind.
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
          // Default: both anchors fixed — creates a bridge rope between two points.
          isAnchorBFixedFlag: 1,
          destructibility: 'indestructible',
          thicknessIndex: 0,
        });
      }
      state.pendingRopeAnchorXBlock = null;
      state.pendingRopeAnchorYBlock = null;
    }
  }
}
