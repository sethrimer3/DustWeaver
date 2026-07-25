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
  EditorLightSource, EditorSunbeam, EditorWaterZone, EditorLavaZone, EditorTimeStopField, EditorCrumbleBlock, EditorSpike, EditorBouncePad,
  EditorGrasshopperArea, EditorFireflyArea, EditorFallingBlock,
  EditorDustContainer, EditorDustContainerPiece, EditorDustBoostJar, EditorDustSwarm, EditorLambdaAnchor,
  EditorFireflyJar, EditorSpringboard, EditorBreakableBlock,
  SelectedElement, allocateUid, EditorRoomData, EditorGuideDustPath,
  EditorChallengeRect, EditorChallengeTotem, EditorGate,
  EditorZipMoveBlock,
} from './editorState';
import { canAddLimitedEnemy } from './editorEnemyCapacity';
import { canMutateElement, canPlaceOnLayer, getLayerForElementType, type LayerId } from './editorLayers';
import type { SelectedElementType } from './editorElementTypes';
import { bumpSelectionRevision } from './editorSelectionCache';

// ── Drag-to-move helpers ──────────────────────────────────────────────────────

/**
 * Snapshots the current block positions of all selected elements into
 * `positions` so that `moveSelectedElements` can apply relative deltas.
 * Transitions are stored as (depth, positionBlock) mapped to (xBlock, yBlock).
 */
export function storeDragStartPositions(
  s: EditorState,
  positions: Map<number | string, { xBlock: number; yBlock: number }>,
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
    } else if (el.type === 'zipMoveBlock') {
      const element = (s.roomData.zipMoveBlocks ?? []).find(candidate => candidate.uid === el.uid);
      if (element) positions.set(key, { xBlock: element.xBlock, yBlock: element.yBlock });
    } else if (el.type === 'challengeField' || el.type === 'challengeGate' || el.type === 'challengeTotem' || el.type === 'gate') {
      const elements = el.type === 'challengeField' ? s.roomData.challengeFields
        : el.type === 'challengeGate' ? s.roomData.challengeGates : el.type === 'gate' ? s.roomData.gates : s.roomData.challengeTotems;
      const element = (elements ?? []).find(candidate => candidate.uid === el.uid);
      if (element) positions.set(key, { xBlock: element.xBlock, yBlock: element.yBlock });
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
    } else if (el.type === 'fireflyJar') {
      const j = (s.roomData.fireflyJars ?? []).find(j2 => j2.uid === el.uid);
      if (j) positions.set(key, { xBlock: j.xBlock, yBlock: j.yBlock });
    } else if (el.type === 'springboard') {
      const sp = (s.roomData.springboards ?? []).find(sp2 => sp2.uid === el.uid);
      if (sp) positions.set(key, { xBlock: sp.xBlock, yBlock: sp.yBlock });
    } else if (el.type === 'breakableBlock') {
      const b = (s.roomData.breakableBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) positions.set(key, { xBlock: b.xBlock, yBlock: b.yBlock });
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
    } else if (el.type === 'timeStopField') {
      const z = (s.roomData.timeStopFields ?? []).find(z2 => z2.uid === el.uid);
      if (z) positions.set(key, { xBlock: z.xBlock, yBlock: z.yBlock });
    } else if (el.type === 'crumbleBlock') {
      const b = (s.roomData.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) positions.set(key, { xBlock: b.xBlock, yBlock: b.yBlock });
    } else if (el.type === 'bouncePad') {
      const b = (s.roomData.bouncePads ?? []).find(b2 => b2.uid === el.uid);
      if (b) positions.set(key, { xBlock: b.xBlock, yBlock: b.yBlock });
    } else if (el.type === 'spike') {
      const sp = (s.roomData.spikes ?? []).find(sp2 => sp2.uid === el.uid);
      if (sp) positions.set(key, { xBlock: sp.xBlock, yBlock: sp.yBlock });
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
      // Store each control point individually; key uses string template `${uid}:${i}`
      const p = (s.roomData.guideDustPaths ?? []).find(p2 => p2.uid === el.uid);
      if (p) {
        // Base entry: `moveSelectedElements` bails out early on any element
        // with no `positions` entry under its own key, so a path needs one
        // even though its geometry lives entirely in the point entries below.
        // (Without it, selected guide paths silently never moved.)
        positions.set(key, { xBlock: 0, yBlock: 0 });
        for (let i = 0; i < p.points.length; i++) {
          positions.set(`${el.uid}:${i}`, { xBlock: p.points[i].xBlock, yBlock: p.points[i].yBlock });
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
  positions: Map<number | string, { xBlock: number; yBlock: number }>,
  deltaX: number,
  deltaY: number,
): void {
  if (!s.roomData) return;
  for (const el of s.selectedElements) {
    // Permission check lives here, inside the mutation function itself, so a
    // controller-side gating bug can't move an element on a locked/hidden/
    // select-only-excluded layer (see editorLayers.ts `canMutateElement`).
    if (!canMutateElement(s, el)) continue;
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
    } else if (el.type === 'zipMoveBlock') {
      const element = (s.roomData.zipMoveBlocks ?? []).find(candidate => candidate.uid === el.uid);
      if (element) {
        element.xBlock = Math.max(0, Math.min(s.roomData.widthBlocks - element.wBlock, orig.xBlock + deltaX));
        element.yBlock = Math.max(0, Math.min(s.roomData.heightBlocks - element.hBlock, orig.yBlock + deltaY));
      }
    } else if (el.type === 'challengeField' || el.type === 'challengeGate' || el.type === 'challengeTotem' || el.type === 'gate') {
      const elements = el.type === 'challengeField' ? s.roomData.challengeFields
        : el.type === 'challengeGate' ? s.roomData.challengeGates : el.type === 'gate' ? s.roomData.gates : s.roomData.challengeTotems;
      const element = (elements ?? []).find(candidate => candidate.uid === el.uid);
      if (element) {
        const width = 'wBlock' in element ? Number(element.wBlock) : 1;
        const height = 'hBlock' in element ? Number(element.hBlock) : 1;
        element.xBlock = Math.max(0, Math.min(s.roomData.widthBlocks - width, orig.xBlock + deltaX));
        element.yBlock = Math.max(0, Math.min(s.roomData.heightBlocks - height, orig.yBlock + deltaY));
      }
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
    } else if (el.type === 'fireflyJar') {
      const j = (s.roomData.fireflyJars ?? []).find(j2 => j2.uid === el.uid);
      if (j) { j.xBlock = orig.xBlock + deltaX; j.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'springboard') {
      const sp = (s.roomData.springboards ?? []).find(sp2 => sp2.uid === el.uid);
      if (sp) { sp.xBlock = orig.xBlock + deltaX; sp.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'breakableBlock') {
      const b = (s.roomData.breakableBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) { b.xBlock = orig.xBlock + deltaX; b.yBlock = orig.yBlock + deltaY; }
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
    } else if (el.type === 'timeStopField') {
      const z = (s.roomData.timeStopFields ?? []).find(z2 => z2.uid === el.uid);
      if (z) { z.xBlock = orig.xBlock + deltaX; z.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'crumbleBlock') {
      const b = (s.roomData.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) { b.xBlock = orig.xBlock + deltaX; b.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'bouncePad') {
      const b = (s.roomData.bouncePads ?? []).find(b2 => b2.uid === el.uid);
      if (b) { b.xBlock = orig.xBlock + deltaX; b.yBlock = orig.yBlock + deltaY; }
    } else if (el.type === 'spike') {
      const sp = (s.roomData.spikes ?? []).find(sp2 => sp2.uid === el.uid);
      if (sp) { sp.xBlock = orig.xBlock + deltaX; sp.yBlock = orig.yBlock + deltaY; }
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
          const ptOrig = positions.get(`${el.uid}:${i}`);
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
    challengeFields: EditorChallengeRect[];
    challengeGates: EditorChallengeRect[];
    gates: EditorGate[];
    challengeTotems: EditorChallengeTotem[];
    zipMoveBlocks: EditorZipMoveBlock[];
    dustContainers: EditorDustContainer[];
    dustContainerPieces: EditorDustContainerPiece[];
    dustBoostJars: EditorDustBoostJar[];
    dustSwarms: EditorDustSwarm[];
    lambdaAnchors: EditorLambdaAnchor[];
    fireflyJars: EditorFireflyJar[];
    springboards: EditorSpringboard[];
    breakableBlocks: EditorBreakableBlock[];
    dustPiles: EditorDustPile[];
    decorations: EditorDecoration[];
    lightSources: EditorLightSource[];
    sunbeams: EditorSunbeam[];
    waterZones: EditorWaterZone[];
    lavaZones: EditorLavaZone[];
    timeStopFields: EditorTimeStopField[];
    crumbleBlocks: EditorCrumbleBlock[];
    spikes: EditorSpike[];
    bouncePads: EditorBouncePad[];
    grasshopperAreas: EditorGrasshopperArea[];
    fireflyAreas: EditorFireflyArea[];
    fallingBlocks: EditorFallingBlock[];
    guideDustPaths: EditorGuideDustPath[];
  } = {
    walls: [], enemies: [], saveTombs: [], skillTombs: [], challengeFields: [], challengeGates: [], gates: [], challengeTotems: [], zipMoveBlocks: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [],
    dustSwarms: [],
    lambdaAnchors: [],
    fireflyJars: [], springboards: [], breakableBlocks: [],
    dustPiles: [],
    decorations: [], lightSources: [], sunbeams: [], waterZones: [], lavaZones: [], timeStopFields: [], crumbleBlocks: [],
    spikes: [],
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
    } else if (el.type === 'zipMoveBlock') {
      const element = (room.zipMoveBlocks ?? []).find(candidate => candidate.uid === el.uid);
      if (element) data.zipMoveBlocks.push({ ...element });
    } else if (el.type === 'challengeField') {
      const element = (room.challengeFields ?? []).find(candidate => candidate.uid === el.uid);
      if (element) data.challengeFields.push({ ...element });
    } else if (el.type === 'challengeGate') {
      const element = (room.challengeGates ?? []).find(candidate => candidate.uid === el.uid);
      if (element) data.challengeGates.push({ ...element });
    } else if (el.type === 'gate') {
      const element = (room.gates ?? []).find(candidate => candidate.uid === el.uid);
      if (element) data.gates.push({ ...element });
    } else if (el.type === 'challengeTotem') {
      const element = (room.challengeTotems ?? []).find(candidate => candidate.uid === el.uid);
      if (element) data.challengeTotems.push({ ...element });
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
    } else if (el.type === 'fireflyJar') {
      const j = (room.fireflyJars ?? []).find(j2 => j2.uid === el.uid);
      if (j) data.fireflyJars.push({ ...j });
    } else if (el.type === 'springboard') {
      const sp = (room.springboards ?? []).find(sp2 => sp2.uid === el.uid);
      if (sp) data.springboards.push({ ...sp });
    } else if (el.type === 'breakableBlock') {
      const b = (room.breakableBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) data.breakableBlocks.push({ ...b });
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
    } else if (el.type === 'timeStopField') {
      const z = (room.timeStopFields ?? []).find(z2 => z2.uid === el.uid);
      if (z) data.timeStopFields.push({ ...z });
    } else if (el.type === 'crumbleBlock') {
      const b = (room.crumbleBlocks ?? []).find(b2 => b2.uid === el.uid);
      if (b) data.crumbleBlocks.push({ ...b });
    } else if (el.type === 'bouncePad') {
      const b = (room.bouncePads ?? []).find(b2 => b2.uid === el.uid);
      if (b) data.bouncePads.push({ ...b });
    } else if (el.type === 'spike') {
      const sp = (room.spikes ?? []).find(sp2 => sp2.uid === el.uid);
      if (sp) data.spikes.push({ ...sp });
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

/** Maps each clipboard array key to the `SelectedElementType` it holds, so
 *  paste can determine every layer represented in the clipboard before
 *  inserting anything. Kept in sync with `serializeSelectedElements`'s output
 *  shape and `pasteFromClipboard`'s parsed `data` shape below. */
const CLIPBOARD_KEY_TYPE: Readonly<Record<string, SelectedElementType>> = {
  walls: 'wall',
  enemies: 'enemy',
  saveTombs: 'saveTomb',
  skillTombs: 'skillTomb',
  challengeFields: 'challengeField',
  challengeGates: 'challengeGate',
  gates: 'gate',
  challengeTotems: 'challengeTotem',
  zipMoveBlocks: 'zipMoveBlock',
  dustContainers: 'dustContainer',
  dustContainerPieces: 'dustContainerPiece',
  dustBoostJars: 'dustBoostJar',
  dustSwarms: 'dustSwarm',
  lambdaAnchors: 'lambdaAnchor',
  fireflyJars: 'fireflyJar',
  springboards: 'springboard',
  breakableBlocks: 'breakableBlock',
  dustPiles: 'dustPile',
  decorations: 'decoration',
  lightSources: 'lightSource',
  sunbeams: 'sunbeam',
  waterZones: 'waterZone',
  lavaZones: 'lavaZone',
  timeStopFields: 'timeStopField',
  crumbleBlocks: 'crumbleBlock',
  spikes: 'spike',
  bouncePads: 'bouncePad',
  grasshopperAreas: 'grasshopperArea',
  fireflyAreas: 'fireflyArea',
  fallingBlocks: 'fallingBlock',
  guideDustPaths: 'guideDustPath',
};

/**
 * Determines every layer represented across the clipboard's parsed content
 * and checks whether all of them are currently editable. Used to enforce
 * all-or-nothing paste: if ANY represented layer is hidden/locked/solo-
 * excluded/select-only-excluded, the entire paste is blocked before any UID
 * is allocated or any element inserted.
 */
function areAllClipboardLayersEditable(
  s: EditorState,
  data: Record<string, unknown[] | undefined>,
): boolean {
  const layers = new Set<LayerId>();
  for (const [key, type] of Object.entries(CLIPBOARD_KEY_TYPE)) {
    const arr = data[key];
    if (arr && arr.length > 0) layers.add(getLayerForElementType(type));
  }
  for (const layerId of layers) {
    if (!canPlaceOnLayer(s, layerId)) return false;
  }
  return true;
}

/**
 * Parses `s.clipboard` and inserts all pasted elements at the cursor position,
 * assigning fresh UIDs and updating `s.selectedElements` to the pasted set.
 *
 * All-or-nothing: if any layer represented in the clipboard is currently
 * hidden/locked/solo-excluded/select-only-excluded, the ENTIRE paste is
 * blocked — no UID consumption, no selection change, no room mutation.
 * Returns `true` if the paste occurred, `false` if it was blocked or the
 * clipboard was empty/invalid.
 */
export function pasteFromClipboard(s: EditorState): boolean {
  if (!s.roomData || !s.clipboard) return false;
  let data: {
    walls: EditorWall[];
    enemies: EditorEnemy[];
    saveTombs?: EditorSaveTomb[];
    skillTombs: EditorSkillTomb[];
    challengeFields?: EditorChallengeRect[];
    challengeGates?: EditorChallengeRect[];
    gates?: EditorGate[];
    challengeTotems?: EditorChallengeTotem[];
    zipMoveBlocks?: EditorZipMoveBlock[];
    dustContainers?: EditorDustContainer[];
    dustContainerPieces?: EditorDustContainerPiece[];
    dustBoostJars?: EditorDustBoostJar[];
    dustSwarms?: EditorDustSwarm[];
    lambdaAnchors?: EditorLambdaAnchor[];
    fireflyJars?: EditorFireflyJar[];
    springboards?: EditorSpringboard[];
    breakableBlocks?: EditorBreakableBlock[];
    dustPiles: EditorDustPile[];
    decorations?: EditorDecoration[];
    lightSources?: EditorLightSource[];
    sunbeams?: EditorSunbeam[];
    waterZones?: EditorWaterZone[];
    lavaZones?: EditorLavaZone[];
    timeStopFields?: EditorTimeStopField[];
    crumbleBlocks?: EditorCrumbleBlock[];
    spikes?: EditorSpike[];
    bouncePads?: EditorBouncePad[];
    grasshopperAreas?: EditorGrasshopperArea[];
    fireflyAreas?: EditorFireflyArea[];
    fallingBlocks?: EditorFallingBlock[];
    guideDustPaths?: EditorGuideDustPath[];
  };
  try {
    data = JSON.parse(s.clipboard) as typeof data;
  } catch {
    return false;
  }

  if (!areAllClipboardLayersEditable(s, data as unknown as Record<string, unknown[] | undefined>)) {
    return false;
  }

  const newElements: SelectedElement[] = [];
  const offsetX = s.cursorBlockX;
  const offsetY = s.cursorBlockY;
  let minX = Infinity, minY = Infinity;
  const allEntities: Array<{ xBlock: number; yBlock: number }> = [
    ...data.walls, ...data.enemies,
    ...(data.saveTombs ?? []), ...(data.skillTombs ?? []),
    ...(data.challengeFields ?? []), ...(data.challengeGates ?? []), ...(data.gates ?? []), ...(data.challengeTotems ?? []), ...(data.zipMoveBlocks ?? []),
    ...(data.dustContainers ?? []), ...(data.dustContainerPieces ?? []), ...(data.dustBoostJars ?? []),
    ...(data.dustSwarms ?? []),
    ...(data.lambdaAnchors ?? []),
    ...(data.fireflyJars ?? []), ...(data.springboards ?? []), ...(data.breakableBlocks ?? []),
    ...(data.dustPiles ?? []),
    ...(data.decorations ?? []), ...(data.lightSources ?? []), ...(data.sunbeams ?? []),
    ...(data.waterZones ?? []), ...(data.lavaZones ?? []), ...(data.timeStopFields ?? []), ...(data.crumbleBlocks ?? []),
    ...(data.spikes ?? []),
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
    if (e.isShadowEnemyFlag === 1 && !canAddLimitedEnemy(s.roomData, 'shadow')) {
      continue;
    }
    if (e.isNeedleUrchinFlag === 1 && !canAddLimitedEnemy(s.roomData, 'needleUrchin')) {
      continue;
    }
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
  for (const [type, source] of [
    ['challengeField', data.challengeFields ?? []],
    ['challengeGate', data.challengeGates ?? []],
  ] as const) {
    const target = type === 'challengeField'
      ? (s.roomData.challengeFields ??= []) : (s.roomData.challengeGates ??= []);
    for (const element of source) {
      const newUid = allocateUid(s);
      target.push({ ...element, uid: newUid, xBlock: element.xBlock - minX + offsetX, yBlock: element.yBlock - minY + offsetY });
      newElements.push({ type, uid: newUid });
    }
  }
  for (const element of data.gates ?? []) {
    const newUid = allocateUid(s);
    (s.roomData.gates ??= []).push({ ...element, uid: newUid, xBlock: element.xBlock - minX + offsetX, yBlock: element.yBlock - minY + offsetY });
    newElements.push({ type: 'gate', uid: newUid });
  }
  for (const element of data.challengeTotems ?? []) {
    const newUid = allocateUid(s);
    (s.roomData.challengeTotems ??= []).push({ ...element, uid: newUid, xBlock: element.xBlock - minX + offsetX, yBlock: element.yBlock - minY + offsetY });
    newElements.push({ type: 'challengeTotem', uid: newUid });
  }
  for (const element of data.zipMoveBlocks ?? []) {
    const newUid = allocateUid(s);
    (s.roomData.zipMoveBlocks ??= []).push({ ...element, uid: newUid, xBlock: element.xBlock - minX + offsetX, yBlock: element.yBlock - minY + offsetY });
    newElements.push({ type: 'zipMoveBlock', uid: newUid });
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
  for (const j of (data.fireflyJars ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.fireflyJars) s.roomData.fireflyJars = [];
    s.roomData.fireflyJars.push({
      ...j,
      uid: newUid,
      xBlock: j.xBlock - minX + offsetX,
      yBlock: j.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'fireflyJar', uid: newUid });
  }
  for (const sp of (data.springboards ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.springboards) s.roomData.springboards = [];
    s.roomData.springboards.push({
      ...sp,
      uid: newUid,
      xBlock: sp.xBlock - minX + offsetX,
      yBlock: sp.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'springboard', uid: newUid });
  }
  {
    const groupIdRemap = new Map<number, number>();
    for (const b of (data.breakableBlocks ?? [])) {
      const newUid = allocateUid(s);
      if (!s.roomData.breakableBlocks) s.roomData.breakableBlocks = [];
      let newGroupId: number | undefined;
      if (b.groupId !== undefined) {
        if (!groupIdRemap.has(b.groupId)) groupIdRemap.set(b.groupId, allocateUid(s));
        newGroupId = groupIdRemap.get(b.groupId);
      }
      s.roomData.breakableBlocks.push({
        ...b,
        uid: newUid,
        groupId: newGroupId,
        xBlock: b.xBlock - minX + offsetX,
        yBlock: b.yBlock - minY + offsetY,
      });
      newElements.push({ type: 'breakableBlock', uid: newUid });
    }
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
  for (const z of (data.timeStopFields ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.timeStopFields) s.roomData.timeStopFields = [];
    s.roomData.timeStopFields.push({
      ...z,
      uid: newUid,
      xBlock: z.xBlock - minX + offsetX,
      yBlock: z.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'timeStopField', uid: newUid });
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
  for (const sp of (data.spikes ?? [])) {
    const newUid = allocateUid(s);
    if (!s.roomData.spikes) s.roomData.spikes = [];
    s.roomData.spikes.push({
      ...sp,
      uid: newUid,
      xBlock: sp.xBlock - minX + offsetX,
      yBlock: sp.yBlock - minY + offsetY,
    });
    newElements.push({ type: 'spike', uid: newUid });
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
  bumpSelectionRevision(s);
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
        speed: pt.speed ?? 1.0,
      })),
    });
    newElements.push({ type: 'guideDustPath', uid: newUid });
  }
  s.selectedElements = newElements;
  bumpSelectionRevision(s);
  return true;
}
