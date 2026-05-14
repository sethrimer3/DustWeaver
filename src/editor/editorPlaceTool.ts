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
  EditorDialogueTrigger,
} from './editorState';
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
} from './editorHitTest';
import { getBrushCells } from './editorBrush';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';

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
      wBlock: item.defaultWidthBlocks ?? 1,
      hBlock: item.defaultHeightBlocks ?? 1,
    };
  }
  if (item.id === 'dialogue_trigger') {
    return { wBlock: 4, hBlock: 4 };
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
 * Places the currently selected palette item at the cursor location,
 * respecting the active brush mode for tile-like items.
 */
export function placeAtCursor(state: EditorState): void {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return;

  // Brush painting: tile-like items support multi-cell brushes.
  const isBrushable =
    item.category === 'blocks' ||
    item.category === 'liquids' ||
    (item.category === 'lighting' && item.isAmbientLightBlockerItem === 1);

  if (isBrushable && state.brushMode !== 'single') {
    const cells = getBrushCells(
      state.brushMode,
      state.cursorBlockX,
      state.cursorBlockY,
      state.brushRectStartBlockX,
      state.brushRectStartBlockY,
    );
    for (const cell of cells) {
      placeAt(state, cell.x, cell.y);
    }
    return;
  }

  placeAt(state, state.cursorBlockX, state.cursorBlockY);
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
      if (!room.waterZones) room.waterZones = [];
      // Dedup: skip if an identical zone already exists at this position+size.
      const alreadyWater = room.waterZones.some(
        z => z.xBlock === bx && z.yBlock === by && z.wBlock === wBlock && z.hBlock === hBlock,
      );
      if (alreadyWater) return;
      room.waterZones.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    } else if (item.id === 'lava_zone') {
      if (!room.lavaZones) room.lavaZones = [];
      const alreadyLava = room.lavaZones.some(
        z => z.xBlock === bx && z.yBlock === by && z.wBlock === wBlock && z.hBlock === hBlock,
      );
      if (alreadyLava) return;
      room.lavaZones.push({ uid: allocateUid(state), xBlock: bx, yBlock: by, wBlock, hBlock });
    }
    markLiquidBodiesDirty();
    return;
  }

  if (item.category === 'blocks') {
    const wBlock = getPlacementWidth(item, state.placementRotationSteps);
    const hBlock = getPlacementHeight(item, state.placementRotationSteps);
    const isPlatformFlag: 0 | 1 = item.isPlatformItem === 1 ? 1 : 0;

    let rampOrientation: 0 | 1 | 2 | 3 | undefined;
    if (item.isRampItem === 1) {
      const base = state.placementRotationSteps % 4;
      rampOrientation = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
    }

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

    if (item.isCrumbleBlockItem === 1) {
      const crumbleW = getPlacementWidth(item, state.placementRotationSteps);
      const crumbleH = getPlacementHeight(item, state.placementRotationSteps);

      let crumbleRamp: 0 | 1 | 2 | 3 | undefined;
      if (item.isRampItem === 1) {
        const base = state.placementRotationSteps % 4;
        crumbleRamp = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
      }

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

      if (!room.crumbleBlocks) room.crumbleBlocks = [];
      room.crumbleBlocks.push({
        uid: allocateUid(state),
        xBlock: bx,
        yBlock: by,
        wBlock: crumbleW,
        hBlock: crumbleH,
        rampOrientation: crumbleRamp,
        variant: state.pendingCrumbleVariant,
        blockTheme: state.selectedBlockTheme,
      });
      return;
    }

    // ── Falling block tiles ──────────────────────────────────────────────────
    if (item.isFallingBlockItem === 1) {
      const variant = item.fallingBlockVariant ?? 'tough';
      if (!rectFitsInsideRoom(room, bx, by, 1, 1)) return;
      if (isFallingBlockAt(room, bx, by)) return;
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

    // ── Background blocks (visual-only, no collision) ────────────────────────
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
        blockTheme: state.selectedBlockTheme,
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
      blockTheme: state.selectedBlockTheme,
      rampOrientation,
      isPillarHalfWidthFlag,
    });
  } else if (placeEnemyAtCursor(state, room, item, bx, by)) {
    // Enemy or grasshopper area was placed — handled by editorEnemyPlacer
  } else if (item.id === 'player_spawn') {
    room.playerSpawnBlock = [bx, by];
  } else if (item.id === 'room_transition') {
    const directionMap: ('right' | 'down' | 'left' | 'up')[] = ['right', 'down', 'left', 'up'];
    const direction = directionMap[state.placementRotationSteps % 4];
    const isHoriz = direction === 'left' || direction === 'right';

    const DEFAULT_WIDTH  = 6;
    const DEFAULT_GRADIENT = 0;

    const openingSizeBlocks = isHoriz
      ? Math.max(1, Math.min(DEFAULT_WIDTH, room.heightBlocks - 2))
      : Math.max(1, Math.min(DEFAULT_WIDTH, room.widthBlocks  - 2));

    const gw = DEFAULT_GRADIENT;
    const zoneW = isHoriz ? gw : openingSizeBlocks;
    const zoneH = isHoriz ? openingSizeBlocks : gw;
    const xBlock = Math.min(Math.max(0, bx), room.widthBlocks  - zoneW);
    const yBlock = Math.min(Math.max(0, by), room.heightBlocks - zoneH);

    const positionBlock = isHoriz ? yBlock : xBlock;

    room.transitions.push({
      uid: allocateUid(state),
      direction,
      xBlock,
      yBlock,
      openingSizeBlocks,
      gradientWidthBlocks: DEFAULT_GRADIENT,
      targetRoomId: '',
      targetSpawnBlock: [3, 3],
      positionBlock,
    });
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
  }
}
