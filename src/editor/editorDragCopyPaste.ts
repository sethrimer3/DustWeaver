/**
 * Editor drag-to-move and copy/paste helpers.
 *
 * These pure helpers operate only on EditorState and its sub-types — they hold
 * no closure state and are extracted here to keep editorController.ts focused
 * on lifecycle and input orchestration.
 */

import {
  EditorState,
  EditorWall, EditorEnemy, EditorSaveTomb, EditorSkillTomb, EditorDustPile, EditorDecoration,
  EditorLightSource, EditorWaterZone, EditorLavaZone, EditorCrumbleBlock,
  SelectedElement, allocateUid, EditorRoomData,
} from './editorState';

// ── Drag-to-move helpers ──────────────────────────────────────────────────────

/**
 * Snapshots the current block positions of all selected elements into
 * `positions` so that `moveSelectedElements` can apply relative deltas.
 * Transitions are stored as (depth, positionBlock) mapped to (xBlock, yBlock).
 */
export function storeDragStartPositions(
  s: EditorState,
  positions: Map<number, { xBlock: number; yBlock: number }>,
): void {
  positions.clear();
  if (!s.roomData) return;
  for (const el of s.selectedElements) {
    const key = el.type === 'playerSpawn' ? 0 : el.uid;
    if (el.type === 'wall') {
      const w = s.roomData.interiorWalls.find(w2 => w2.uid === el.uid);
      if (w) positions.set(key, { xBlock: w.xBlock, yBlock: w.yBlock });
    } else if (el.type === 'enemy') {
      const e = s.roomData.enemies.find(e2 => e2.uid === el.uid);
      if (e) positions.set(key, { xBlock: e.xBlock, yBlock: e.yBlock });
    } else if (el.type === 'saveTomb') {
      const t = s.roomData.saveTombs.find(t2 => t2.uid === el.uid);
      if (t) positions.set(key, { xBlock: t.xBlock, yBlock: t.yBlock });
    } else if (el.type === 'skillTomb') {
      const t = s.roomData.skillTombs.find(t2 => t2.uid === el.uid);
      if (t) positions.set(key, { xBlock: t.xBlock, yBlock: t.yBlock });
    } else if (el.type === 'dustPile') {
      const p = s.roomData.dustPiles.find(p2 => p2.uid === el.uid);
      if (p) positions.set(key, { xBlock: p.xBlock, yBlock: p.yBlock });
    } else if (el.type === 'decoration') {
      const d = (s.roomData.decorations ?? []).find(d2 => d2.uid === el.uid);
      if (d) positions.set(key, { xBlock: d.xBlock, yBlock: d.yBlock });
    } else if (el.type === 'lightSource') {
      const l = (s.roomData.lightSources ?? []).find(l2 => l2.uid === el.uid);
      if (l) positions.set(key, { xBlock: l.xBlock, yBlock: l.yBlock });
    } else if (el.type === 'waterZone') {
      const z = (s.roomData.waterZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) positions.set(key, { xBlock: z.xBlock, yBlock: z.yBlock });
    } else if (el.type === 'lavaZone') {
      const z = (s.roomData.lavaZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) positions.set(key, { xBlock: z.xBlock, yBlock: z.yBlock });
    } else if (el.type === 'crumbleBlock') {
      const b = (s.roomData.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) positions.set(key, { xBlock: b.xBlock, yBlock: b.yBlock });
    } else if (el.type === 'playerSpawn') {
      positions.set(0, { xBlock: s.roomData.playerSpawnBlock[0], yBlock: s.roomData.playerSpawnBlock[1] });
    } else if (el.type === 'transition') {
      const tr = s.roomData.transitions.find(t2 => t2.uid === el.uid);
      if (tr) {
        const isHoriz = tr.direction === 'left' || tr.direction === 'right';
        const edgeDepth = isHoriz
          ? (tr.direction === 'left' ? 0 : s.roomData.widthBlocks - 6)
          : (tr.direction === 'up' ? 0 : s.roomData.heightBlocks - 6);
        const depth = tr.depthBlock !== undefined ? tr.depthBlock : edgeDepth;
        // xBlock = depth for left/right, positionBlock for up/down
        // yBlock = positionBlock for left/right, depth for up/down
        positions.set(key, {
          xBlock: isHoriz ? depth : tr.positionBlock,
          yBlock: isHoriz ? tr.positionBlock : depth,
        });
      }
    }
  }
}

/**
 * Applies `(deltaX, deltaY)` block offsets to all selected elements using their
 * pre-drag positions from `positions` (populated by `storeDragStartPositions`).
 */
export function moveSelectedElements(
  s: EditorState,
  positions: Map<number, { xBlock: number; yBlock: number }>,
  deltaX: number,
  deltaY: number,
): void {
  if (!s.roomData) return;
  for (const el of s.selectedElements) {
    const key = el.type === 'playerSpawn' ? 0 : el.uid;
    const orig = positions.get(key);
    if (!orig) continue;
    if (el.type === 'wall') {
      const w = s.roomData.interiorWalls.find(w2 => w2.uid === el.uid);
      if (w) { w.xBlock = orig.xBlock + deltaX; w.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'enemy') {
      const e = s.roomData.enemies.find(e2 => e2.uid === el.uid);
      if (e) { e.xBlock = orig.xBlock + deltaX; e.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'saveTomb') {
      const t = s.roomData.saveTombs.find(t2 => t2.uid === el.uid);
      if (t) { t.xBlock = orig.xBlock + deltaX; t.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'skillTomb') {
      const t = s.roomData.skillTombs.find(t2 => t2.uid === el.uid);
      if (t) { t.xBlock = orig.xBlock + deltaX; t.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'dustPile') {
      const p = s.roomData.dustPiles.find(p2 => p2.uid === el.uid);
      if (p) { p.xBlock = orig.xBlock + deltaX; p.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'decoration') {
      const d = (s.roomData.decorations ?? []).find(d2 => d2.uid === el.uid);
      if (d) { d.xBlock = orig.xBlock + deltaX; d.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'lightSource') {
      const l = (s.roomData.lightSources ?? []).find(l2 => l2.uid === el.uid);
      if (l) { l.xBlock = orig.xBlock + deltaX; l.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'waterZone') {
      const z = (s.roomData.waterZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) { z.xBlock = orig.xBlock + deltaX; z.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'lavaZone') {
      const z = (s.roomData.lavaZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) { z.xBlock = orig.xBlock + deltaX; z.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'crumbleBlock') {
      const b = (s.roomData.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) { b.xBlock = orig.xBlock + deltaX; b.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'playerSpawn') {
      s.roomData.playerSpawnBlock[0] = orig.xBlock + deltaX;
      s.roomData.playerSpawnBlock[1] = orig.yBlock + deltaY;
    } else if (el.type === 'transition') {
      const tr = s.roomData.transitions.find(t2 => t2.uid === el.uid);
      if (tr) {
        const isHoriz = tr.direction === 'left' || tr.direction === 'right';
        const room = s.roomData;
        if (isHoriz) {
          // Y drag → positionBlock, X drag → depthBlock
          const maxPos = room.heightBlocks - 1 - tr.openingSizeBlocks;
          tr.positionBlock = Math.min(Math.max(0, orig.yBlock + deltaY), maxPos);
          const newDepth = orig.xBlock + deltaX;
          const maxDepth = room.widthBlocks - 6;
          tr.depthBlock = Math.min(Math.max(0, newDepth), maxDepth);
        } else {
          // X drag → positionBlock, Y drag → depthBlock
          const maxPos = room.widthBlocks - 1 - tr.openingSizeBlocks;
          tr.positionBlock = Math.min(Math.max(0, orig.xBlock + deltaX), maxPos);
          const newDepth = orig.yBlock + deltaY;
          const maxDepth = room.heightBlocks - 6;
          tr.depthBlock = Math.min(Math.max(0, newDepth), maxDepth);
        }
      }
    }
  }
}

// ── Copy/Paste helpers ────────────────────────────────────────────────────────

/**
 * Serialises the selected elements (by uid lookup in `room`) to a JSON string
 * suitable for storing in `EditorState.clipboard`.
 */
export function serializeSelectedElements(
  room: EditorRoomData,
  elements: SelectedElement[],
): string {
  const data: {
    walls: EditorWall[];
    enemies: EditorEnemy[];
    saveTombs: EditorSaveTomb[];
    skillTombs: EditorSkillTomb[];
    dustPiles: EditorDustPile[];
    decorations: EditorDecoration[];
    lightSources: EditorLightSource[];
    waterZones: EditorWaterZone[];
    lavaZones: EditorLavaZone[];
    crumbleBlocks: EditorCrumbleBlock[];
  } = {
    walls: [], enemies: [], saveTombs: [], skillTombs: [], dustPiles: [],
    decorations: [], lightSources: [], waterZones: [], lavaZones: [], crumbleBlocks: [],
  };
  for (const el of elements) {
    if (el.type === 'wall') {
      const w = room.interiorWalls.find(w2 => w2.uid === el.uid);
      if (w) data.walls.push({ ...w });
    } else if (el.type === 'enemy') {
      const e = room.enemies.find(e2 => e2.uid === el.uid);
      if (e) data.enemies.push({ ...e });
    } else if (el.type === 'saveTomb') {
      const t = room.saveTombs.find(t2 => t2.uid === el.uid);
      if (t) data.saveTombs.push({ ...t });
    } else if (el.type === 'skillTomb') {
      const t = room.skillTombs.find(t2 => t2.uid === el.uid);
      if (t) data.skillTombs.push({ ...t });
    } else if (el.type === 'dustPile') {
      const p = room.dustPiles.find(p2 => p2.uid === el.uid);
      if (p) data.dustPiles.push({ ...p });
    } else if (el.type === 'decoration') {
      const d = (room.decorations ?? []).find(d2 => d2.uid === el.uid);
      if (d) data.decorations.push({ ...d });
    } else if (el.type === 'lightSource') {
      const l = (room.lightSources ?? []).find(l2 => l2.uid === el.uid);
      if (l) data.lightSources.push({ ...l });
    } else if (el.type === 'waterZone') {
      const z = (room.waterZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) data.waterZones.push({ ...z });
    } else if (el.type === 'lavaZone') {
      const z = (room.lavaZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) data.lavaZones.push({ ...z });
    } else if (el.type === 'crumbleBlock') {
      const b = (room.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) data.crumbleBlocks.push({ ...b });
    }
  }
  return JSON.stringify(data);
}

/**
 * Parses `s.clipboard` and inserts all pasted elements at the cursor position,
 * assigning fresh UIDs and updating `s.selectedElements` to the pasted set.
 */
export function pasteFromClipboard(s: EditorState): void {
  if (!s.roomData || !s.clipboard) return;
  let data: {
    walls: EditorWall[];
    enemies: EditorEnemy[];
    saveTombs?: EditorSaveTomb[];
    skillTombs: EditorSkillTomb[];
    dustPiles: EditorDustPile[];
    decorations?: EditorDecoration[];
    lightSources?: EditorLightSource[];
    waterZones?: EditorWaterZone[];
    lavaZones?: EditorLavaZone[];
    crumbleBlocks?: EditorCrumbleBlock[];
  };
  try {
    data = JSON.parse(s.clipboard) as typeof data;
  } catch {
    return;
  }

  const newElements: SelectedElement[] = [];
  const offsetX = s.cursorBlockX;
  const offsetY = s.cursorBlockY;
  let minX = Infinity, minY = Infinity;
  const allEntities: Array<{ xBlock: number; yBlock: number }> = [
    ...data.walls, ...data.enemies,
    ...(data.saveTombs ?? []), ...(data.skillTombs ?? []), ...(data.dustPiles ?? []),
    ...(data.decorations ?? []), ...(data.lightSources ?? []),
    ...(data.waterZones ?? []), ...(data.lavaZones ?? []), ...(data.crumbleBlocks ?? []),
  ];
  for (const e of allEntities) { minX = Math.min(minX, e.xBlock); minY = Math.min(minY, e.yBlock); }
  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;

  for (const w of data.walls) {
    const newUid = allocateUid(s);
    s.roomData.interiorWalls.push({
      ...w,
      uid: newUid,
      xBlock: w.xBlock - minX + offsetX,
      yBlock: w.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'wall', uid: newUid });
  }
  for (const e of data.enemies) {
    const newUid = allocateUid(s);
    s.roomData.enemies.push({
      ...e,
      uid: newUid,
      xBlock: e.xBlock - minX + offsetX,
      yBlock: e.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'enemy', uid: newUid });
  }
  for (const t of (data.saveTombs ?? [])) {
    const newUid = allocateUid(s);
    s.roomData.saveTombs.push({
      ...t,
      uid: newUid,
      xBlock: t.xBlock - minX + offsetX,
      yBlock: t.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'saveTomb', uid: newUid });
  }
  for (const t of (data.skillTombs ?? [])) {
    const newUid = allocateUid(s);
    s.roomData.skillTombs.push({
      ...t,
      uid: newUid,
      xBlock: t.xBlock - minX + offsetX,
      yBlock: t.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'skillTomb', uid: newUid });
  }
  for (const p of (data.dustPiles ?? [])) {
    const newUid = allocateUid(s);
    s.roomData.dustPiles.push({
      ...p,
      uid: newUid,
      xBlock: p.xBlock - minX + offsetX,
      yBlock: p.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'dustPile', uid: newUid });
  }
  for (const d of (data.decorations ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.decorations) s.roomData.decorations = [];
    s.roomData.decorations.push({
      ...d,
      uid: newUid,
      xBlock: d.xBlock - minX + offsetX,
      yBlock: d.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'decoration', uid: newUid });
  }
  for (const l of (data.lightSources ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.lightSources) s.roomData.lightSources = [];
    s.roomData.lightSources.push({
      ...l,
      uid: newUid,
      xBlock: l.xBlock - minX + offsetX,
      yBlock: l.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'lightSource', uid: newUid });
  }
  for (const z of (data.waterZones ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.waterZones) s.roomData.waterZones = [];
    s.roomData.waterZones.push({
      ...z,
      uid: newUid,
      xBlock: z.xBlock - minX + offsetX,
      yBlock: z.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'waterZone', uid: newUid });
  }
  for (const z of (data.lavaZones ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.lavaZones) s.roomData.lavaZones = [];
    s.roomData.lavaZones.push({
      ...z,
      uid: newUid,
      xBlock: z.xBlock - minX + offsetX,
      yBlock: z.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'lavaZone', uid: newUid });
  }
  for (const b of (data.crumbleBlocks ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.crumbleBlocks) s.roomData.crumbleBlocks = [];
    s.roomData.crumbleBlocks.push({
      ...b,
      uid: newUid,
      xBlock: b.xBlock - minX + offsetX,
      yBlock: b.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'crumbleBlock', uid: newUid });
  }
  s.selectedElements = newElements;
}
