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
  isCellCoveredByWaterZone,
  isCellCoveredByLavaZone,
} from './editorHitTest';
import { getBrushCells, getFillBrushCells, type FillKind } from './editorBrush';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';

// ── Placement dimension helpers ───────────────────────────────────────────────

function getPlacementWidth(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  // Stairs keep their authored bounding box: their four orientations are axis
  // mirrors of one mask, not rotations, so the box never transposes.
  if (item.isStairsItem === 1) return w;
  return (rotSteps % 2 === 0) ? w : h;
}

function getPlacementHeight(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  if (item.isStairsItem === 1) return h;
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
 * respecting the active brush mode for tile-like items.
 */
export function placeAtCursor(state: EditorState): void {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return;

  // Brush painting: tile-like items support multi-cell brushes.
  const isBrushable =
    item.category === 'blocks' ||
    item.category === 'specialBlocks' ||
    item.category === 'liquids' ||
    (item.category === 'lighting' && item.isAmbientLightBlockerItem === 1);

  if (isBrushable && state.brushMode === 'fill') {
    let fillKind: FillKind = 'tile';
    if (item.category === 'liquids') {
      fillKind = item.id === 'lava_zone' ? 'lava' : 'water';
    }
    const cells = getFillBrushCells(room, state.cursorBlockX, state.cursorBlockY, fillKind);
    for (const cell of cells) {
      placeAt(state, cell.x, cell.y);
    }
    return;
  }

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

  if (item.category === 'blocks' || item.category === 'specialBlocks') {
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

    if (item.isCrumbleBlockItem === 1 || (item.category === 'blocks' && state.pendingBlockPlacementModifier === 'cracked')) {
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
        blockTheme: placementBlockTheme,
      });
      return;
    }

    // ── Falling block tiles ──────────────────────────────────────────────────
    if (item.isFallingBlockItem === 1 || (
      item.category === 'blocks' &&
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
          };
          room.fallingBlocks.push(fb);
        }
      }
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
  }
}
