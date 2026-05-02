/**
 * Editor tools — Select, Place, Delete logic.
 * Operates on EditorRoomData and modifies it in place.
 */

/** Segments per block-length for auto-calculating rope segment count. */
const ROPE_SEGMENTS_PER_BLOCK = 1.5;

import {
  EditorState, EditorTool, EditorRoomData, EditorWall,
  EditorTransition, SelectedElement, allocateUid,
  PaletteItem, DecorationKind, EditorBouncePad, EditorSunbeam,
} from './editorState';
import { placeEnemyAtCursor } from './editorEnemyPlacer';
import { MAX_ROPE_SEGMENTS } from '../sim/world';
import { MIN_ROPE_LENGTH_BLOCKS } from '../levels/roomDef';

// ── Hit testing helpers ──────────────────────────────────────────────────────

function hitTestZone(zone: { xBlock: number; yBlock: number; wBlock: number; hBlock: number }, bx: number, by: number): boolean {
  return bx >= zone.xBlock && bx < zone.xBlock + zone.wBlock && by >= zone.yBlock && by < zone.yBlock + zone.hBlock;
}

function hitTestWall(w: EditorWall, bx: number, by: number): boolean {
  return bx >= w.xBlock && bx < w.xBlock + w.wBlock && by >= w.yBlock && by < w.yBlock + w.hBlock;
}

function hitTestPoint(xBlock: number, yBlock: number, bx: number, by: number): boolean {
  return Math.abs(bx - xBlock) < 1.5 && Math.abs(by - yBlock) < 1.5;
}

/**
 * Returns true if the straight line from (ax, ay) to (bx, by) in block
 * coordinates intersects any solid interior wall in the room.
 *
 * Uses a segment-vs-AABB test: project the segment onto each wall's bounding
 * box using the separating-axis theorem in 2D.
 */
export function ropeLineCrossesWall(
  room: EditorRoomData,
  axBlock: number,
  ayBlock: number,
  bxBlock: number,
  byBlock: number,
): boolean {
  for (const w of room.interiorWalls) {
    // Wall AABB in block space
    const wl = w.xBlock;
    const wr = w.xBlock + w.wBlock;
    const wt = w.yBlock;
    const wb = w.yBlock + w.hBlock;

    // Segment direction
    const sdx = bxBlock - axBlock;
    const sdy = byBlock - ayBlock;

    // We use the parametric clipping approach (Liang-Barsky for AABB).
    // Segment: P = A + t*(B-A),  t in [0,1].
    // For AABB [wl,wr] x [wt,wb]: find t intervals where P is inside.
    let t0 = 0.0;
    let t1 = 1.0;

    // X axis
    if (Math.abs(sdx) < 1e-9) {
      // Parallel to X — outside if start X is outside wall X range
      if (axBlock < wl || axBlock > wr) continue;
    } else {
      const invDx = 1.0 / sdx;
      let tNear = (wl - axBlock) * invDx;
      let tFar  = (wr - axBlock) * invDx;
      if (tNear > tFar) { const tmp = tNear; tNear = tFar; tFar = tmp; }
      t0 = Math.max(t0, tNear);
      t1 = Math.min(t1, tFar);
      if (t0 > t1) continue;
    }

    // Y axis
    if (Math.abs(sdy) < 1e-9) {
      if (ayBlock < wt || ayBlock > wb) continue;
    } else {
      const invDy = 1.0 / sdy;
      let tNear = (wt - ayBlock) * invDy;
      let tFar  = (wb - ayBlock) * invDy;
      if (tNear > tFar) { const tmp = tNear; tNear = tFar; tFar = tmp; }
      t0 = Math.max(t0, tNear);
      t1 = Math.min(t1, tFar);
      if (t0 > t1) continue;
    }

    // Overlap found in [t0, t1] — segment crosses this wall
    return true;
  }

  // Also check room boundary: rope cannot extend outside the room
  const roomLeft  = 0;
  const roomRight = room.widthBlocks;
  const roomTop   = 0;
  const roomBot   = room.heightBlocks;
  if (
    axBlock < roomLeft || axBlock > roomRight || ayBlock < roomTop || ayBlock > roomBot ||
    bxBlock < roomLeft || bxBlock > roomRight || byBlock < roomTop || byBlock > roomBot
  ) {
    return true;
  }

  return false;
}

function hitTestTransition(t: EditorTransition, bx: number, by: number, roomData: EditorRoomData): boolean {
  const DEPTH = 6;
  if (t.direction === 'left' || t.direction === 'right') {
    const zoneX = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'left' ? 0 : roomData.widthBlocks - DEPTH);
    return bx >= zoneX && bx < zoneX + DEPTH
      && by >= t.positionBlock && by < t.positionBlock + t.openingSizeBlocks;
  } else {
    const zoneY = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'up' ? 0 : roomData.heightBlocks - DEPTH);
    return by >= zoneY && by < zoneY + DEPTH
      && bx >= t.positionBlock && bx < t.positionBlock + t.openingSizeBlocks;
  }
}

/** Returns true if two wall rectangles (in block coordinates) overlap. */
function wallsOverlap(a: EditorWall, bx: number, by: number, bw: number, bh: number): boolean {
  return a.xBlock < bx + bw &&
         a.xBlock + a.wBlock > bx &&
         a.yBlock < by + bh &&
         a.yBlock + a.hBlock > by;
}


function isInsideRoom(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  return xBlock >= 0 && yBlock >= 0 && xBlock < room.widthBlocks && yBlock < room.heightBlocks;
}

function rectFitsInsideRoom(room: EditorRoomData, xBlock: number, yBlock: number, wBlock: number, hBlock: number): boolean {
  return xBlock >= 0 && yBlock >= 0 &&
    xBlock + wBlock <= room.widthBlocks &&
    yBlock + hBlock <= room.heightBlocks;
}

// ── Select tool ──────────────────────────────────────────────────────────────

/**
 * Attempts to select an element at the given block coordinates.
 * Returns the selected element or null.
 */
export function selectAtCursor(state: EditorState): SelectedElement | null {
  const room = state.roomData;
  if (room === null) return null;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;

  // Check transitions first (they occupy boundary edges)
  for (const t of room.transitions) {
    if (hitTestTransition(t, bx, by, room)) {
      return { type: 'transition', uid: t.uid };
    }
  }

  // Check enemies
  for (const e of room.enemies) {
    if (hitTestPoint(e.xBlock, e.yBlock, bx, by)) {
      return { type: 'enemy', uid: e.uid };
    }
  }

  // Check save tombs
  for (const s of room.saveTombs) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'saveTomb', uid: s.uid };
    }
  }

  // Check skill tombs
  for (const s of room.skillTombs) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'skillTomb', uid: s.uid };
    }
  }

  // Check dust containers
  for (const c of (room.dustContainers ?? [])) {
    if (hitTestPoint(c.xBlock, c.yBlock, bx, by)) {
      return { type: 'dustContainer', uid: c.uid };
    }
  }

  // Check dust container pieces
  for (const c of (room.dustContainerPieces ?? [])) {
    if (hitTestPoint(c.xBlock, c.yBlock, bx, by)) {
      return { type: 'dustContainerPiece', uid: c.uid };
    }
  }

  // Check dust boost jars
  for (const j of (room.dustBoostJars ?? [])) {
    if (hitTestPoint(j.xBlock, j.yBlock, bx, by)) {
      return { type: 'dustBoostJar', uid: j.uid };
    }
  }

  // Check dust piles
  for (const p of room.dustPiles) {
    if (hitTestPoint(p.xBlock, p.yBlock, bx, by)) {
      return { type: 'dustPile', uid: p.uid };
    }
  }

  // Check grasshopper areas
  for (const a of room.grasshopperAreas) {
    if (hitTestZone(a, bx, by)) {
      return { type: 'grasshopperArea', uid: a.uid };
    }
  }
  // Check firefly areas
  for (const a of (room.fireflyAreas ?? [])) {
    if (hitTestZone(a, bx, by)) {
      return { type: 'fireflyArea', uid: a.uid };
    }
  }

  // Check light sources (point selection at block centre).
  for (const ls of (room.lightSources ?? [])) {
    if (hitTestPoint(ls.xBlock, ls.yBlock, bx, by)) {
      return { type: 'lightSource', uid: ls.uid };
    }
  }

  // Check sunbeams (point selection at origin block).
  for (const sb of (room.sunbeams ?? [])) {
    if (hitTestPoint(sb.xBlock, sb.yBlock, bx, by)) {
      return { type: 'sunbeam', uid: sb.uid };
    }
  }

  // Check water zones
  for (const z of (room.waterZones ?? [])) {
    if (hitTestZone(z, bx, by)) {
      return { type: 'waterZone', uid: z.uid };
    }
  }

  // Check lava zones
  for (const z of (room.lavaZones ?? [])) {
    if (hitTestZone(z, bx, by)) {
      return { type: 'lavaZone', uid: z.uid };
    }
  }

  // Check crumble blocks
  for (const b of (room.crumbleBlocks ?? [])) {
    if (hitTestPoint(b.xBlock, b.yBlock, bx, by)) {
      return { type: 'crumbleBlock', uid: b.uid };
    }
  }

  // Check bounce pads
  for (const b of (room.bouncePads ?? [])) {
    if (hitTestZone({ xBlock: b.xBlock, yBlock: b.yBlock, wBlock: b.wBlock, hBlock: b.hBlock }, bx, by)) {
      return { type: 'bouncePad', uid: b.uid };
    }
  }

  // Check decorations
  for (const d of (room.decorations ?? [])) {
    if (hitTestPoint(d.xBlock, d.yBlock, bx, by)) {
      return { type: 'decoration', uid: d.uid };
    }
  }

  // Check player spawn
  if (hitTestPoint(room.playerSpawnBlock[0], room.playerSpawnBlock[1], bx, by)) {
    return { type: 'playerSpawn', uid: 0 };
  }

  // Check interior walls
  for (const w of room.interiorWalls) {
    if (hitTestWall(w, bx, by)) {
      return { type: 'wall', uid: w.uid };
    }
  }

  // Check ambient-light blockers last — they're single cells and shouldn't
  // block selection of things authored above them.
  const bxFloor = Math.floor(bx);
  const byFloor = Math.floor(by);
  for (const b of (room.ambientLightBlockers ?? [])) {
    if (b.xBlock === bxFloor && b.yBlock === byFloor) {
      return { type: 'ambientLightBlocker', uid: b.uid };
    }
  }

  return null;
}

// ── Surface scan helpers ─────────────────────────────────────────────────────

/**
 * Returns true if any solid interior wall (non-platform, non-ramp) occupies
 * the grid cell at (col, row).
 */
function isSolidWallAt(room: EditorRoomData, col: number, row: number): boolean {
  for (const w of room.interiorWalls) {
    if (w.isPlatformFlag === 1) continue;
    if (w.rampOrientation !== undefined) continue;
    if (col >= w.xBlock && col < w.xBlock + w.wBlock &&
        row >= w.yBlock && row < w.yBlock + w.hBlock) {
      return true;
    }
  }
  return false;
}

/**
 * Starting at (col, startRow) and searching DOWNWARD (increasing row),
 * returns the row of the first solid interior wall block, or null if none found.
 *
 * Used for placing floor decorations (mushrooms, glowGrass) that sit on the
 * TOP surface of the first solid ground block below the cursor.
 */
export function findFloorBlockRow(room: EditorRoomData, col: number, startRow: number): number | null {
  for (let row = startRow; row < room.heightBlocks; row++) {
    if (isSolidWallAt(room, col, row)) return row;
  }
  return null;
}

/**
 * Starting at (col, startRow) and searching UPWARD (decreasing row),
 * returns the row of the first solid interior wall block, or null if none found.
 *
 * Used for placing vines that hang from the BOTTOM surface of the first solid
 * ceiling block above the cursor.
 */
export function findCeilingBlockRow(room: EditorRoomData, col: number, startRow: number): number | null {
  for (let row = startRow; row >= 0; row--) {
    if (isSolidWallAt(room, col, row)) return row;
  }
  return null;
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

      // Prevent overlapping crumble blocks (can't place on top of itself).
      const crumbles = room.crumbleBlocks ?? [];
      const overlapsCrumble = crumbles.some(b => {
        const bw = b.wBlock ?? 1;
        const bh = b.hBlock ?? 1;
        return bx < b.xBlock + bw && bx + wBlock > b.xBlock &&
               by < b.yBlock + bh && by + hBlock > b.yBlock;
      });
      if (overlapsCrumble) return;

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

    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    // Prevent overlapping walls
    const overlaps = room.interiorWalls.some(w => wallsOverlap(w, bx, by, wBlock, hBlock));
    if (overlaps) return;
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

// ── Delete tool ──────────────────────────────────────────────────────────────

/**
 * Deletes the element at the cursor location.
 */
export function deleteAtCursor(state: EditorState): void {
  const room = state.roomData;
  if (room === null) return;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;

  // Check transitions first
  for (let i = 0; i < room.transitions.length; i++) {
    if (hitTestTransition(room.transitions[i], bx, by, room)) {
      const removedUid = room.transitions[i].uid;
      room.transitions.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check enemies
  for (let i = 0; i < room.enemies.length; i++) {
    if (hitTestPoint(room.enemies[i].xBlock, room.enemies[i].yBlock, bx, by)) {
      const removedUid = room.enemies[i].uid;
      room.enemies.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check save tombs
  for (let i = 0; i < room.saveTombs.length; i++) {
    if (hitTestPoint(room.saveTombs[i].xBlock, room.saveTombs[i].yBlock, bx, by)) {
      const removedUid = room.saveTombs[i].uid;
      room.saveTombs.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check skill tombs
  for (let i = 0; i < room.skillTombs.length; i++) {
    if (hitTestPoint(room.skillTombs[i].xBlock, room.skillTombs[i].yBlock, bx, by)) {
      const removedUid = room.skillTombs[i].uid;
      room.skillTombs.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust containers
  const dustContainers = room.dustContainers ?? [];
  for (let i = 0; i < dustContainers.length; i++) {
    if (hitTestPoint(dustContainers[i].xBlock, dustContainers[i].yBlock, bx, by)) {
      const removedUid = dustContainers[i].uid;
      dustContainers.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust container pieces
  const dustContainerPieces = room.dustContainerPieces ?? [];
  for (let i = 0; i < dustContainerPieces.length; i++) {
    if (hitTestPoint(dustContainerPieces[i].xBlock, dustContainerPieces[i].yBlock, bx, by)) {
      const removedUid = dustContainerPieces[i].uid;
      dustContainerPieces.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust boost jars
  const dustBoostJars = room.dustBoostJars ?? [];
  for (let i = 0; i < dustBoostJars.length; i++) {
    if (hitTestPoint(dustBoostJars[i].xBlock, dustBoostJars[i].yBlock, bx, by)) {
      const removedUid = dustBoostJars[i].uid;
      dustBoostJars.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust piles
  for (let i = 0; i < room.dustPiles.length; i++) {
    if (hitTestPoint(room.dustPiles[i].xBlock, room.dustPiles[i].yBlock, bx, by)) {
      const removedUid = room.dustPiles[i].uid;
      room.dustPiles.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check grasshopper areas
  for (let i = 0; i < room.grasshopperAreas.length; i++) {
    if (hitTestZone(room.grasshopperAreas[i], bx, by)) {
      const removedUid = room.grasshopperAreas[i].uid;
      room.grasshopperAreas.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }
  // Check firefly areas
  const fireflyAreas = room.fireflyAreas ?? [];
  for (let i = 0; i < fireflyAreas.length; i++) {
    if (hitTestZone(fireflyAreas[i], bx, by)) {
      const removedUid = fireflyAreas[i].uid;
      fireflyAreas.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check decorations
  const decos = room.decorations ?? [];
  for (let i = 0; i < decos.length; i++) {
    if (hitTestPoint(decos[i].xBlock, decos[i].yBlock, bx, by)) {
      const removedUid = decos[i].uid;
      decos.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check walls
  for (let i = 0; i < room.interiorWalls.length; i++) {
    if (hitTestWall(room.interiorWalls[i], bx, by)) {
      const removedUid = room.interiorWalls[i].uid;
      room.interiorWalls.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check light sources (before blockers so the bigger icon wins).
  const lights = room.lightSources ?? [];
  for (let i = 0; i < lights.length; i++) {
    if (hitTestPoint(lights[i].xBlock, lights[i].yBlock, bx, by)) {
      const removedUid = lights[i].uid;
      lights.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check sunbeams.
  const sunbeams = room.sunbeams ?? [];
  for (let i = 0; i < sunbeams.length; i++) {
    if (hitTestPoint(sunbeams[i].xBlock, sunbeams[i].yBlock, bx, by)) {
      const removedUid = sunbeams[i].uid;
      sunbeams.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check ambient-light blockers (single-cell match).
  const blockers = room.ambientLightBlockers ?? [];
  const bxFloor = Math.floor(bx);
  const byFloor = Math.floor(by);
  for (let i = 0; i < blockers.length; i++) {
    if (blockers[i].xBlock === bxFloor && blockers[i].yBlock === byFloor) {
      const removedUid = blockers[i].uid;
      blockers.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check water zones
  const waterZones = room.waterZones ?? [];
  for (let i = 0; i < waterZones.length; i++) {
    if (hitTestZone(waterZones[i], bx, by)) {
      const removedUid = waterZones[i].uid;
      waterZones.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check lava zones
  const lavaZones = room.lavaZones ?? [];
  for (let i = 0; i < lavaZones.length; i++) {
    if (hitTestZone(lavaZones[i], bx, by)) {
      const removedUid = lavaZones[i].uid;
      lavaZones.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check crumble blocks
  const crumbleBlocks = room.crumbleBlocks ?? [];
  for (let i = 0; i < crumbleBlocks.length; i++) {
    if (hitTestPoint(crumbleBlocks[i].xBlock, crumbleBlocks[i].yBlock, bx, by)) {
      const removedUid = crumbleBlocks[i].uid;
      crumbleBlocks.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check bounce pads
  const bouncePads = room.bouncePads ?? [];
  for (let i = 0; i < bouncePads.length; i++) {
    if (hitTestZone({ xBlock: bouncePads[i].xBlock, yBlock: bouncePads[i].yBlock, wBlock: bouncePads[i].wBlock, hBlock: bouncePads[i].hBlock }, bx, by)) {
      const removedUid = bouncePads[i].uid;
      bouncePads.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }
}

// ── Rotation helpers ─────────────────────────────────────────────────────────

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

// ── Rotate selected element ──────────────────────────────────────────────────

/**
 * Rotates the currently selected wall by 90° (swaps width and height).
 */
export function rotateSelectedElement(state: EditorState): void {
  const sel = state.selectedElements[0] ?? null;
  if (sel === null || state.roomData === null) return;
  if (sel.type === 'wall') {
    const wall = state.roomData.interiorWalls.find(w => w.uid === sel.uid);
    if (wall) {
      const tmp = wall.wBlock;
      wall.wBlock = wall.hBlock;
      wall.hBlock = tmp;
    }
  }
}

// ── Multi-selection helpers ──────────────────────────────────────────────────

/**
 * Returns all elements whose block-space bounding box overlaps the given rect.
 */
export function getAllElementsInRect(
  room: EditorRoomData,
  x1: number, y1: number,
  x2: number, y2: number,
): SelectedElement[] {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const results: SelectedElement[] = [];

  for (const w of room.interiorWalls) {
    if (w.xBlock + w.wBlock > minX && w.xBlock < maxX + 1 &&
        w.yBlock + w.hBlock > minY && w.yBlock < maxY + 1) {
      results.push({ type: 'wall', uid: w.uid });
    }
  }
  for (const e of room.enemies) {
    if (e.xBlock >= minX && e.xBlock <= maxX && e.yBlock >= minY && e.yBlock <= maxY) {
      results.push({ type: 'enemy', uid: e.uid });
    }
  }
  for (const s of room.saveTombs) {
    if (s.xBlock >= minX && s.xBlock <= maxX && s.yBlock >= minY && s.yBlock <= maxY) {
      results.push({ type: 'saveTomb', uid: s.uid });
    }
  }
  for (const s of room.skillTombs) {
    if (s.xBlock >= minX && s.xBlock <= maxX && s.yBlock >= minY && s.yBlock <= maxY) {
      results.push({ type: 'skillTomb', uid: s.uid });
    }
  }
  for (const c of (room.dustContainers ?? [])) {
    if (c.xBlock >= minX && c.xBlock <= maxX && c.yBlock >= minY && c.yBlock <= maxY) {
      results.push({ type: 'dustContainer', uid: c.uid });
    }
  }
  for (const c of (room.dustContainerPieces ?? [])) {
    if (c.xBlock >= minX && c.xBlock <= maxX && c.yBlock >= minY && c.yBlock <= maxY) {
      results.push({ type: 'dustContainerPiece', uid: c.uid });
    }
  }
  for (const j of (room.dustBoostJars ?? [])) {
    if (j.xBlock >= minX && j.xBlock <= maxX && j.yBlock >= minY && j.yBlock <= maxY) {
      results.push({ type: 'dustBoostJar', uid: j.uid });
    }
  }
  for (const p of room.dustPiles) {
    if (p.xBlock >= minX && p.xBlock <= maxX && p.yBlock >= minY && p.yBlock <= maxY) {
      results.push({ type: 'dustPile', uid: p.uid });
    }
  }
  for (const a of room.grasshopperAreas) {
    if (a.xBlock + a.wBlock > minX && a.xBlock < maxX + 1 &&
        a.yBlock + a.hBlock > minY && a.yBlock < maxY + 1) {
      results.push({ type: 'grasshopperArea', uid: a.uid });
    }
  }
  for (const a of (room.fireflyAreas ?? [])) {
    if (a.xBlock + a.wBlock > minX && a.xBlock < maxX + 1 &&
        a.yBlock + a.hBlock > minY && a.yBlock < maxY + 1) {
      results.push({ type: 'fireflyArea', uid: a.uid });
    }
  }
  for (const d of (room.decorations ?? [])) {
    if (d.xBlock >= minX && d.xBlock <= maxX && d.yBlock >= minY && d.yBlock <= maxY) {
      results.push({ type: 'decoration', uid: d.uid });
    }
  }
  for (const ls of (room.lightSources ?? [])) {
    if (ls.xBlock >= minX && ls.xBlock <= maxX && ls.yBlock >= minY && ls.yBlock <= maxY) {
      results.push({ type: 'lightSource', uid: ls.uid });
    }
  }
  for (const sb of (room.sunbeams ?? [])) {
    if (sb.xBlock >= minX && sb.xBlock <= maxX && sb.yBlock >= minY && sb.yBlock <= maxY) {
      results.push({ type: 'sunbeam', uid: sb.uid });
    }
  }
  for (const b of (room.ambientLightBlockers ?? [])) {
    if (b.xBlock >= minX && b.xBlock <= maxX && b.yBlock >= minY && b.yBlock <= maxY) {
      results.push({ type: 'ambientLightBlocker', uid: b.uid });
    }
  }
  for (const z of (room.waterZones ?? [])) {
    if (z.xBlock + z.wBlock > minX && z.xBlock < maxX + 1 &&
        z.yBlock + z.hBlock > minY && z.yBlock < maxY + 1) {
      results.push({ type: 'waterZone', uid: z.uid });
    }
  }
  for (const z of (room.lavaZones ?? [])) {
    if (z.xBlock + z.wBlock > minX && z.xBlock < maxX + 1 &&
        z.yBlock + z.hBlock > minY && z.yBlock < maxY + 1) {
      results.push({ type: 'lavaZone', uid: z.uid });
    }
  }
  for (const b of (room.crumbleBlocks ?? [])) {
    if (b.xBlock >= minX && b.xBlock <= maxX && b.yBlock >= minY && b.yBlock <= maxY) {
      results.push({ type: 'crumbleBlock', uid: b.uid });
    }
  }
  for (const b of (room.bouncePads ?? [])) {
    if (b.xBlock + b.wBlock > minX && b.xBlock < maxX + 1 &&
        b.yBlock + b.hBlock > minY && b.yBlock < maxY + 1) {
      results.push({ type: 'bouncePad', uid: b.uid });
    }
  }
  if (room.playerSpawnBlock[0] >= minX && room.playerSpawnBlock[0] <= maxX &&
      room.playerSpawnBlock[1] >= minY && room.playerSpawnBlock[1] <= maxY) {
    results.push({ type: 'playerSpawn', uid: 0 });
  }
  for (const t of room.transitions) {
    if (hitTestTransitionRect(t, minX, minY, maxX, maxY, room)) {
      results.push({ type: 'transition', uid: t.uid });
    }
  }
  return results;
}

function hitTestTransitionRect(
  t: EditorTransition, minX: number, minY: number, maxX: number, maxY: number,
  room: EditorRoomData,
): boolean {
  const DEPTH = 6;
  let tx: number, ty: number, tw: number, th: number;
  if (t.direction === 'left' || t.direction === 'right') {
    const zoneX = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'left' ? 0 : room.widthBlocks - DEPTH);
    tx = zoneX; ty = t.positionBlock; tw = DEPTH; th = t.openingSizeBlocks;
  } else {
    const zoneY = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'up' ? 0 : room.heightBlocks - DEPTH);
    tx = t.positionBlock; ty = zoneY; tw = t.openingSizeBlocks; th = DEPTH;
  }
  return tx + tw > minX && tx < maxX + 1 && ty + th > minY && ty < maxY + 1;
}

/**
 * Returns the uid and anchor side of the first rope in room.ropes whose
 * anchor points are within `toleranceBlocks` of (bx, by), or null if none.
 */
export function hitTestRopeAnchor(
  room: EditorRoomData,
  bx: number,
  by: number,
  toleranceBlocks = 0.8,
): { uid: number; anchorSide: 'A' | 'B' } | null {
  const ropes = room.ropes ?? [];
  for (const rope of ropes) {
    const dax = rope.anchorAXBlock - bx;
    const day = rope.anchorAYBlock - by;
    if (Math.sqrt(dax * dax + day * day) <= toleranceBlocks) {
      return { uid: rope.uid, anchorSide: 'A' };
    }
    const dbx = rope.anchorBXBlock - bx;
    const dby = rope.anchorBYBlock - by;
    if (Math.sqrt(dbx * dbx + dby * dby) <= toleranceBlocks) {
      return { uid: rope.uid, anchorSide: 'B' };
    }
  }
  return null;
}
