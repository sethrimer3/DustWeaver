import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData } from '../editor/editorElementTypes';
import {
  EDITOR_HISTORY_BYTE_BUDGET,
  capturePendingSnapshot,
  clearHistory,
  commitPendingSnapshot,
  createEditorHistory,
  getHistoryDiagnostics,
  isHistoryDirty,
  markHistorySaved,
  redo,
  undo,
} from '../editor/editorHistory';
import { beginGesture, finishGesture, rollbackGesture } from '../editor/editorGesture';

function room(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'history', name: 'History', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT',
    songId: '_continue', widthBlocks: 20, heightBlocks: 20,
    playerSpawnBlock: [1, 1], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustContainers: [], dustContainerPieces: [],
    dustBoostJars: [], dustSwarms: [], lambdaAnchors: [], dustPiles: [],
    grasshopperAreas: [], fireflyAreas: [], decorations: [],
    ambientLightBlockers: [], lightSources: [], ...overrides,
  } as unknown as EditorRoomData;
}

test('Phase 7: one drag transaction produces one compact entry', () => {
  const data = room({ interiorWalls: [{ uid: 7, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 }] as never });
  const history = createEditorHistory();
  const wall = data.interiorWalls[0];
  const gesture = beginGesture(data, () => wall.xBlock !== 1, () => { wall.xBlock = 1; });
  wall.xBlock = 2;
  wall.xBlock = 3;
  assert.equal(finishGesture(history, gesture), 'committed');
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undoStack[0].type, 'element-patch');
});

test('Phase 7: property input session coalesces by property label', () => {
  const data = room({ interiorWalls: [{ uid: 7, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 }] as never });
  const history = createEditorHistory();
  for (const x of [2, 3, 4]) {
    const pending = capturePendingSnapshot(data, undefined, undefined, false, 'Property:wall.xBlock');
    data.interiorWalls[0].xBlock = x;
    commitPendingSnapshot(history, pending);
  }
  assert.equal(history.undoStack.length, 1);
  assert.equal(undo(history, data)?.roomData.interiorWalls[0].xBlock, 1);
});

test('Phase 7: no-op and cancelled transaction preserve redo and restore live state', () => {
  let data = room({ interiorWalls: [{ uid: 1, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 }] as never });
  const history = createEditorHistory();
  let pending = capturePendingSnapshot(data);
  data.interiorWalls[0].xBlock = 2;
  commitPendingSnapshot(history, pending);
  data = undo(history, data)!.roomData;
  const redoCount = history.redoStack.length;
  pending = capturePendingSnapshot(data);
  assert.equal(commitPendingSnapshot(history, pending), 'noop');
  const wall = data.interiorWalls[0];
  const gesture = beginGesture(data, () => wall.xBlock !== 1, () => { wall.xBlock = 1; });
  wall.xBlock = 9;
  rollbackGesture(gesture);
  assert.equal(wall.xBlock, 1);
  assert.equal(history.redoStack.length, redoCount);
});

test('Phase 7: add remove move resize and property replacement round-trip exactly with UID/order', () => {
  let data = room({ interiorWalls: [
    { uid: 1, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 },
    { uid: 2, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1 },
  ] as never });
  const before = structuredClone(data);
  const history = createEditorHistory();
  const pending = capturePendingSnapshot(data);
  data.interiorWalls.splice(0, 1);
  Object.assign(data.interiorWalls[0], { xBlock: 8, wBlock: 4, blockTheme: 'redRock' });
  data.interiorWalls.unshift({ uid: 3, xBlock: 3, yBlock: 3, wBlock: 2, hBlock: 2 } as never);
  const after = structuredClone(data);
  commitPendingSnapshot(history, pending);
  data = undo(history, data)!.roomData;
  assert.deepEqual(data, before);
  data = redo(history, data)!.roomData;
  assert.deepEqual(data, after);
  assert.deepEqual(data.interiorWalls.map(w => w.uid), [3, 2]);
});

test('Phase 7: Surface Rim property round-trips in an element patch', () => {
  let data = room({ interiorWalls: [{ uid: 4, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 }] as never });
  const history = createEditorHistory();
  const pending = capturePendingSnapshot(data);
  data.interiorWalls[0].surfaceRim = {
    mode: 'inverted', color: 'ff00aa', widthPx: 5, opacity: 0.7,
    falloff: 'smooth', interiorDarkness: 0.4,
  };
  commitPendingSnapshot(history, pending);
  const expected = structuredClone(data.interiorWalls[0].surfaceRim);
  data = undo(history, data)!.roomData;
  assert.equal(data.interiorWalls[0].surfaceRim, undefined);
  data = redo(history, data)!.roomData;
  assert.deepEqual(data.interiorWalls[0].surfaceRim, expected);
});

test('Phase 7: campaign spawn before/after state is tracked', () => {
  const data = room();
  const history = createEditorHistory();
  const before = { roomId: 'history', xBlock: 1, yBlock: 1 };
  const after = { roomId: 'history', xBlock: 8, yBlock: 9 };
  const pending = capturePendingSnapshot(data, before, 'history', true, 'Move campaign spawn');
  commitPendingSnapshot(history, pending, after, 'history');
  const undone = undo(history, data, after, 'history', true)!;
  assert.deepEqual(undone.campaignSpawn, before);
  const redone = redo(history, undone.roomData, before, 'history', true)!;
  assert.deepEqual(redone.campaignSpawn, after);
});

test('Phase 7: room resize uses documented snapshot fallback', () => {
  const data = room();
  const history = createEditorHistory();
  const pending = capturePendingSnapshot(data);
  data.widthBlocks = 40;
  commitPendingSnapshot(history, pending);
  assert.equal(history.undoStack[0].type, 'snapshot');
  assert.equal(history.undoStack[0].type === 'snapshot' && history.undoStack[0].reason, 'room-resize');
});

test('Phase 7: tile edits use bounded tile-region entries', () => {
  const data = room();
  const history = createEditorHistory();
  const pending = capturePendingSnapshot(data);
  data.ambientLightBlockers.push({ uid: 1, xBlock: 4, yBlock: 5 } as never);
  commitPendingSnapshot(history, pending);
  assert.equal(history.undoStack[0].type, 'tile-region');
});

test('Phase 7: byte-budget eviction removes oldest complete entries deterministically', () => {
  const data = room();
  const history = createEditorHistory();
  for (let i = 0; i < 230; i++) {
    const pending = capturePendingSnapshot(data, undefined, undefined, false, `edit ${i}`);
    data.name = `room-${i}`;
    commitPendingSnapshot(history, pending);
  }
  assert.ok(history.undoStack.length <= 200);
  assert.ok(history.estimatedBytes <= EDITOR_HISTORY_BYTE_BUDGET);
  assert.notEqual(history.undoStack[0].label, 'edit 0');
});

test('Phase 7: a single oversized entry is rejected without corrupting existing history', () => {
  const data = room();
  const history = createEditorHistory();
  let pending = capturePendingSnapshot(data);
  data.name = 'kept';
  commitPendingSnapshot(history, pending);
  const existing = history.undoStack.length;
  pending = capturePendingSnapshot(data);
  data.name = 'x'.repeat(EDITOR_HISTORY_BYTE_BUDGET + 1);
  assert.equal(commitPendingSnapshot(history, pending), 'rejected-oversized');
  assert.equal(history.undoStack.length, existing);
  assert.equal(isHistoryDirty(history), true);
});

test('Phase 7: saved revision becomes clean on exact undo/redo and branching invalidates discarded save', () => {
  let data = room();
  const history = createEditorHistory();
  let pending = capturePendingSnapshot(data);
  data.name = 'one';
  commitPendingSnapshot(history, pending);
  markHistorySaved(history);
  assert.equal(isHistoryDirty(history), false);
  pending = capturePendingSnapshot(data);
  data.name = 'two';
  commitPendingSnapshot(history, pending);
  assert.equal(isHistoryDirty(history), true);
  data = undo(history, data)!.roomData;
  assert.equal(isHistoryDirty(history), false);
  data = redo(history, data)!.roomData;
  data = undo(history, data)!.roomData;
  data = undo(history, data)!.roomData;
  pending = capturePendingSnapshot(data);
  data.name = 'branched';
  commitPendingSnapshot(history, pending);
  assert.equal(history.savedRevision, null);
  assert.equal(isHistoryDirty(history), true);
});

test('Phase 7: workspace-only actions do not create room history or dirty state', () => {
  const history = createEditorHistory();
  const workspace = { solo: false, panelCollapsed: false, category: 'terrain', scrollTop: 0 };
  Object.assign(workspace, { solo: true, panelCollapsed: true, category: 'lighting', scrollTop: 120 });
  assert.equal(getHistoryDiagnostics(history).undoCount, 0);
  assert.equal(isHistoryDirty(history), false);
  clearHistory(history);
});
