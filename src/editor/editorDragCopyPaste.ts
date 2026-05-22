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
  EditorLightSource, EditorSunbeam, EditorWaterZone, EditorLavaZone, EditorCrumbleBlock, EditorBouncePad,
  EditorGrasshopperArea, EditorFireflyArea, EditorFallingBlock,
  EditorDustContainer, EditorDustContainerPiece, EditorDustBoostJar, EditorDustSwarm, EditorLambdaAnchor,
  SelectedElement, allocateUid, EditorRoomData, EditorGuideDustPath,
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
    } else if (el.type === 'dustContainer') {
      const c = (s.roomData.dustContainers ?? []).find(c2 => c2.uid === el.uid);
      if (c) positions.set(key, { xBlock: c.xBlock, yBlock: c.yBlock });
    } else if (el.type === 'dustContainerPiece') {
      const c = (s.roomData.dustContainerPieces ?? []).find(c2 => c2.uid === el.uid);
      if (c) positions.set(key, { xBlock: c.xBlock, yBlock: c.yBlock });
    } else if (el.type === 'dustBoostJar') {
      const j = (s.roomData.dustBoostJars ?? []).find(j2 => j2.uid === el.uid);
      if (j) positions.set(key, { xBlock: j.xBlock, yBlock: j.yBlock });
    } else if (el.type === 'dustSwarm') {
      const sw = (s.roomData.dustSwarms ?? []).find(sw2 => sw2.uid === el.uid);
      if (sw) positions.set(key, { xBlock: sw.xBlock, yBlock: sw.yBlock });
    } else if (el.type === 'lambdaAnchor') {
      const a = (s.roomData.lambdaAnchors ?? []).find(a2 => a2.uid === el.uid);
      if (a) positions.set(key, { xBlock: a.xBlock, yBlock: a.yBlock });
    } else if (el.type === 'dustPile') {
      const p = s.roomData.dustPiles.find(p2 => p2.uid === el.uid);
      if (p) positions.set(key, { xBlock: p.xBlock, yBlock: p.yBlock });
    } else if (el.type === 'decoration') {
      const d = (s.roomData.decorations ?? []).find(d2 => d2.uid === el.uid);
      if (d) positions.set(key, { xBlock: d.xBlock, yBlock: d.yBlock });
    } else if (el.type === 'lightSource') {
      const l = (s.roomData.lightSources ?? []).find(l2 => l2.uid === el.uid);
      if (l) positions.set(key, { xBlock: l.xBlock, yBlock: l.yBlock });
    } else if (el.type === 'sunbeam') {
      const sb = (s.roomData.sunbeams ?? []).find(sb2 => sb2.uid === el.uid);
      if (sb) positions.set(key, { xBlock: sb.xBlock, yBlock: sb.yBlock });
    } else if (el.type === 'waterZone') {
      const z = (s.roomData.waterZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) positions.set(key, { xBlock: z.xBlock, yBlock: z.yBlock });
    } else if (el.type === 'lavaZone') {
      const z = (s.roomData.lavaZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) positions.set(key, { xBlock: z.xBlock, yBlock: z.yBlock });
    } else if (el.type === 'crumbleBlock') {
      const b = (s.roomData.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) positions.set(key, { xBlock: b.xBlock, yBlock: b.yBlock });
    } else if (el.type === 'bouncePad') {
      const b = (s.roomData.bouncePads ?? []).find(b2 => b2.uid === el.uid);
      if (b) positions.set(key, { xBlock: b.xBlock, yBlock: b.yBlock });
    } else if (el.type === 'fallingBlock') {
      const fb = (s.roomData.fallingBlocks ?? []).find(fb2 => fb2.uid === el.uid);
      if (fb) positions.set(key, { xBlock: fb.xBlock, yBlock: fb.yBlock });
    } else if (el.type === 'grasshopperArea') {
      const a = s.roomData.grasshopperAreas.find(x => x.uid === el.uid);
      if (a) positions.set(key, { xBlock: a.xBlock, yBlock: a.yBlock });
    } else if (el.type === 'fireflyArea') {
      const a = (s.roomData.fireflyAreas ?? []).find(x => x.uid === el.uid);
      if (a) positions.set(key, { xBlock: a.xBlock, yBlock: a.yBlock });
    } else if (el.type === 'playerSpawn') {
      positions.set(0, { xBlock: s.roomData.playerSpawnBlock[0], yBlock: s.roomData.playerSpawnBlock[1] });
    } else if (el.type === 'transition') {
      const tr = s.roomData.transitions.find(t2 => t2.uid === el.uid);
      if (tr) {
        positions.set(key, { xBlock: tr.xBlock, yBlock: tr.yBlock });
      }
    } else if (el.type === 'guideDustPath') {
      // Store each control point individually; key = uid * 10000 + pointIndex
      const p = (s.roomData.guideDustPaths ?? []).find(p2 => p2.uid === el.uid);
      if (p) {
        for (let i = 0; i < p.points.length; i++) {
          positions.set(el.uid * 10000 + i, { xBlock: p.points[i].xBlock, yBlock: p.points[i].yBlock });
        }
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
    } else if (el.type === 'dustContainer') {
      const c = (s.roomData.dustContainers ?? []).find(c2 => c2.uid === el.uid);
      if (c) { c.xBlock = orig.xBlock + deltaX; c.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'dustContainerPiece') {
      const c = (s.roomData.dustContainerPieces ?? []).find(c2 => c2.uid === el.uid);
      if (c) { c.xBlock = orig.xBlock + deltaX; c.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'dustBoostJar') {
      const j = (s.roomData.dustBoostJars ?? []).find(j2 => j2.uid === el.uid);
      if (j) { j.xBlock = orig.xBlock + deltaX; j.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'dustSwarm') {
      const sw = (s.roomData.dustSwarms ?? []).find(sw2 => sw2.uid === el.uid);
      if (sw) { sw.xBlock = orig.xBlock + deltaX; sw.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'lambdaAnchor') {
      const a = (s.roomData.lambdaAnchors ?? []).find(a2 => a2.uid === el.uid);
      if (a) { a.xBlock = orig.xBlock + deltaX; a.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'dustPile') {
      const p = s.roomData.dustPiles.find(p2 => p2.uid === el.uid);
      if (p) { p.xBlock = orig.xBlock + deltaX; p.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'decoration') {
      const d = (s.roomData.decorations ?? []).find(d2 => d2.uid === el.uid);
      if (d) { d.xBlock = orig.xBlock + deltaX; d.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'lightSource') {
      const l = (s.roomData.lightSources ?? []).find(l2 => l2.uid === el.uid);
      if (l) { l.xBlock = orig.xBlock + deltaX; l.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'sunbeam') {
      const sb = (s.roomData.sunbeams ?? []).find(sb2 => sb2.uid === el.uid);
      if (sb) { sb.xBlock = orig.xBlock + deltaX; sb.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'waterZone') {
      const z = (s.roomData.waterZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) { z.xBlock = orig.xBlock + deltaX; z.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'lavaZone') {
      const z = (s.roomData.lavaZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) { z.xBlock = orig.xBlock + deltaX; z.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'crumbleBlock') {
      const b = (s.roomData.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) { b.xBlock = orig.xBlock + deltaX; b.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'bouncePad') {
      const b = (s.roomData.bouncePads ?? []).find(b2 => b2.uid === el.uid);
      if (b) { b.xBlock = orig.xBlock + deltaX; b.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'fallingBlock') {
      const fb = (s.roomData.fallingBlocks ?? []).find(fb2 => fb2.uid === el.uid);
      if (fb) { fb.xBlock = orig.xBlock + deltaX; fb.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'grasshopperArea') {
      const a = s.roomData.grasshopperAreas.find(x => x.uid === el.uid);
      if (a && orig) { a.xBlock = orig.xBlock + deltaX; a.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'fireflyArea') {
      const a = (s.roomData.fireflyAreas ?? []).find(x => x.uid === el.uid);
      if (a && orig) { a.xBlock = orig.xBlock + deltaX; a.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'playerSpawn') {
      s.roomData.playerSpawnBlock[0] = orig.xBlock + deltaX;
      s.roomData.playerSpawnBlock[1] = orig.yBlock + deltaY;
    } else if (el.type === 'transition') {
      const tr = s.roomData.transitions.find(t2 => t2.uid === el.uid);
      if (tr) {
        const isHoriz = tr.direction === 'left' || tr.direction === 'right';
        const gw = tr.gradientWidthBlocks ?? 3;
        const zoneW = isHoriz ? gw : tr.openingSizeBlocks;
        const zoneH = isHoriz ? tr.openingSizeBlocks : gw;
        const room = s.roomData;
        const newX = Math.min(Math.max(0, orig.xBlock + deltaX), room.widthBlocks  - zoneW);
        const newY = Math.min(Math.max(0, orig.yBlock + deltaY), room.heightBlocks - zoneH);
        tr.xBlock = newX;
        tr.yBlock = newY;
        // Keep legacy positionBlock in sync
        tr.positionBlock = isHoriz ? newY : newX;
      }
    } else if (el.type === 'guideDustPath') {
      const p = (s.roomData.guideDustPaths ?? []).find(p2 => p2.uid === el.uid);
      if (p) {
        for (let i = 0; i < p.points.length; i++) {
          const ptOrig = positions.get(el.uid * 10000 + i);
          if (ptOrig) {
            p.points[i].xBlock = ptOrig.xBlock + deltaX;
            p.points[i].yBlock = ptOrig.yBlock + deltaY;
          }
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
    dustContainers: EditorDustContainer[];
    dustContainerPieces: EditorDustContainerPiece[];
    dustBoostJars: EditorDustBoostJar[];
    dustSwarms: EditorDustSwarm[];
    lambdaAnchors: EditorLambdaAnchor[];
    dustPiles: EditorDustPile[];
    decorations: EditorDecoration[];
    lightSources: EditorLightSource[];
    sunbeams: EditorSunbeam[];
    waterZones: EditorWaterZone[];
    lavaZones: EditorLavaZone[];
    crumbleBlocks: EditorCrumbleBlock[];
    bouncePads: EditorBouncePad[];
    grasshopperAreas: EditorGrasshopperArea[];
    fireflyAreas: EditorFireflyArea[];
    fallingBlocks: EditorFallingBlock[];
    guideDustPaths: EditorGuideDustPath[];
  } = {
    walls: [], enemies: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [],
    dustSwarms: [],
    lambdaAnchors: [],
    dustPiles: [],
    decorations: [], lightSources: [], sunbeams: [], waterZones: [], lavaZones: [], crumbleBlocks: [],
    bouncePads: [], grasshopperAreas: [], fireflyAreas: [], fallingBlocks: [], guideDustPaths: [],
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
    } else if (el.type === 'dustContainer') {
      const c = (room.dustContainers ?? []).find(c2 => c2.uid === el.uid);
      if (c) data.dustContainers.push({ ...c });
    } else if (el.type === 'dustContainerPiece') {
      const c = (room.dustContainerPieces ?? []).find(c2 => c2.uid === el.uid);
      if (c) data.dustContainerPieces.push({ ...c });
    } else if (el.type === 'dustBoostJar') {
      const j = (room.dustBoostJars ?? []).find(j2 => j2.uid === el.uid);
      if (j) data.dustBoostJars.push({ ...j });
    } else if (el.type === 'dustSwarm') {
      const sw = (room.dustSwarms ?? []).find(sw2 => sw2.uid === el.uid);
      if (sw) data.dustSwarms.push({ ...sw });
    } else if (el.type === 'lambdaAnchor') {
      const a = (room.lambdaAnchors ?? []).find(a2 => a2.uid === el.uid);
      if (a) data.lambdaAnchors.push({ ...a });
    } else if (el.type === 'dustPile') {
      const p = room.dustPiles.find(p2 => p2.uid === el.uid);
      if (p) data.dustPiles.push({ ...p });
    } else if (el.type === 'decoration') {
      const d = (room.decorations ?? []).find(d2 => d2.uid === el.uid);
      if (d) data.decorations.push({ ...d });
    } else if (el.type === 'lightSource') {
      const l = (room.lightSources ?? []).find(l2 => l2.uid === el.uid);
      if (l) data.lightSources.push({ ...l });
    } else if (el.type === 'sunbeam') {
      const sb = (room.sunbeams ?? []).find(sb2 => sb2.uid === el.uid);
      if (sb) data.sunbeams.push({ ...sb });
    } else if (el.type === 'waterZone') {
      const z = (room.waterZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) data.waterZones.push({ ...z });
    } else if (el.type === 'lavaZone') {
      const z = (room.lavaZones ?? []).find(z2 => z2.uid === el.uid);
      if (z) data.lavaZones.push({ ...z });
    } else if (el.type === 'crumbleBlock') {
      const b = (room.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) data.crumbleBlocks.push({ ...b });
    } else if (el.type === 'bouncePad') {
      const b = (room.bouncePads ?? []).find(b2 => b2.uid === el.uid);
      if (b) data.bouncePads.push({ ...b });
    } else if (el.type === 'fallingBlock') {
      const fb = (room.fallingBlocks ?? []).find(fb2 => fb2.uid === el.uid);
      if (fb) data.fallingBlocks.push({ ...fb });
    } else if (el.type === 'grasshopperArea') {
      const a = room.grasshopperAreas.find(a2 => a2.uid === el.uid);
      if (a) data.grasshopperAreas.push({ ...a });
    } else if (el.type === 'fireflyArea') {
      const a = (room.fireflyAreas ?? []).find(a2 => a2.uid === el.uid);
      if (a) data.fireflyAreas.push({ ...a });
    } else if (el.type === 'guideDustPath') {
      const p = (room.guideDustPaths ?? []).find(p2 => p2.uid === el.uid);
      if (p) data.guideDustPaths.push({ ...p, points: p.points.map(pt => ({ ...pt })) });
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
    dustContainers?: EditorDustContainer[];
    dustContainerPieces?: EditorDustContainerPiece[];
    dustBoostJars?: EditorDustBoostJar[];
    dustSwarms?: EditorDustSwarm[];
    lambdaAnchors?: EditorLambdaAnchor[];
    dustPiles: EditorDustPile[];
    decorations?: EditorDecoration[];
    lightSources?: EditorLightSource[];
    sunbeams?: EditorSunbeam[];
    waterZones?: EditorWaterZone[];
    lavaZones?: EditorLavaZone[];
    crumbleBlocks?: EditorCrumbleBlock[];
    bouncePads?: EditorBouncePad[];
    grasshopperAreas?: EditorGrasshopperArea[];
    fireflyAreas?: EditorFireflyArea[];
    fallingBlocks?: EditorFallingBlock[];
    guideDustPaths?: EditorGuideDustPath[];
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
    ...(data.saveTombs ?? []), ...(data.skillTombs ?? []),
    ...(data.dustContainers ?? []), ...(data.dustContainerPieces ?? []), ...(data.dustBoostJars ?? []),
    ...(data.dustSwarms ?? []),
    ...(data.lambdaAnchors ?? []),
    ...(data.dustPiles ?? []),
    ...(data.decorations ?? []), ...(data.lightSources ?? []), ...(data.sunbeams ?? []),
    ...(data.waterZones ?? []), ...(data.lavaZones ?? []), ...(data.crumbleBlocks ?? []),
    ...(data.bouncePads ?? []), ...(data.grasshopperAreas ?? []), ...(data.fireflyAreas ?? []),
    ...(data.fallingBlocks ?? []),
    // For guide paths, collect all control points for proper bounding-box offset
    ...(data.guideDustPaths ?? []).flatMap(p => p.points),
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
  for (const c of (data.dustContainers ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.dustContainers) s.roomData.dustContainers = [];
    s.roomData.dustContainers.push({
      ...c,
      uid: newUid,
      xBlock: c.xBlock - minX + offsetX,
      yBlock: c.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'dustContainer', uid: newUid });
  }
  for (const c of (data.dustContainerPieces ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.dustContainerPieces) s.roomData.dustContainerPieces = [];
    s.roomData.dustContainerPieces.push({
      ...c,
      uid: newUid,
      xBlock: c.xBlock - minX + offsetX,
      yBlock: c.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'dustContainerPiece', uid: newUid });
  }
  for (const j of (data.dustBoostJars ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.dustBoostJars) s.roomData.dustBoostJars = [];
    s.roomData.dustBoostJars.push({
      ...j,
      uid: newUid,
      xBlock: j.xBlock - minX + offsetX,
      yBlock: j.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'dustBoostJar', uid: newUid });
  }
  for (const sw of (data.dustSwarms ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.dustSwarms) s.roomData.dustSwarms = [];
    s.roomData.dustSwarms.push({
      ...sw,
      uid: newUid,
      xBlock: sw.xBlock - minX + offsetX,
      yBlock: sw.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'dustSwarm', uid: newUid });
  }
  for (const a of (data.lambdaAnchors ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.lambdaAnchors) s.roomData.lambdaAnchors = [];
    s.roomData.lambdaAnchors.push({
      ...a,
      uid: newUid,
      xBlock: a.xBlock - minX + offsetX,
      yBlock: a.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'lambdaAnchor', uid: newUid });
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
  for (const sb of (data.sunbeams ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.sunbeams) s.roomData.sunbeams = [];
    s.roomData.sunbeams.push({
      ...sb,
      uid: newUid,
      xBlock: sb.xBlock - minX + offsetX,
      yBlock: sb.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'sunbeam', uid: newUid });
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
  for (const b of (data.bouncePads ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.bouncePads) s.roomData.bouncePads = [];
    s.roomData.bouncePads.push({
      ...b,
      uid: newUid,
      xBlock: b.xBlock - minX + offsetX,
      yBlock: b.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'bouncePad', uid: newUid });
  }
  for (const a of (data.grasshopperAreas ?? [])) {
    const newUid = allocateUid(s);
    s.roomData.grasshopperAreas.push({
      ...a,
      uid: newUid,
      xBlock: a.xBlock - minX + offsetX,
      yBlock: a.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'grasshopperArea', uid: newUid });
  }
  for (const a of (data.fireflyAreas ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.fireflyAreas) s.roomData.fireflyAreas = [];
    s.roomData.fireflyAreas.push({
      ...a,
      uid: newUid,
      xBlock: a.xBlock - minX + offsetX,
      yBlock: a.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'fireflyArea', uid: newUid });
  }
  for (const fb of (data.fallingBlocks ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.fallingBlocks) s.roomData.fallingBlocks = [];
    s.roomData.fallingBlocks.push({
      ...fb,
      uid: newUid,
      xBlock: fb.xBlock - minX + offsetX,
      yBlock: fb.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'fallingBlock', uid: newUid });
  }
  s.selectedElements = newElements;
  // Append guide dust paths with new UIDs and offset all control points
  for (const p of (data.guideDustPaths ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.guideDustPaths) s.roomData.guideDustPaths = [];
    s.roomData.guideDustPaths.push({
      ...p,
      uid: newUid,
      points: p.points.map(pt => ({
        xBlock: pt.xBlock - minX + offsetX,
        yBlock: pt.yBlock - minY + offsetY,
      })),
    });
    newElements.push({ type: 'guideDustPath', uid: newUid });
  }
  s.selectedElements = newElements;
}
