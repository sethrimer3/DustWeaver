import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData } from '../editor/editorState';
import {
  EDITOR_HISTORY_BYTE_BUDGET,
  capturePendingSnapshot,
  commitPendingSnapshot,
  createEditorHistory,
  isHistoryDirty,
  markHistorySaved,
  redo,
  undo,
} from '../editor/editorHistory';
import { runRoomFieldMutation } from '../editor/editorRoomMutation';
import {
  beginPaintTransaction,
  cancelPaintTransaction,
  finishPaintTransaction,
} from '../editor/editorPaintHistoryCoordinator';

function room(): EditorRoomData {
  return {
    id: 'r', name: 'Room', worldNumber: 1, mapX: 0, mapY: 0,
    widthBlocks: 10, heightBlocks: 10, blockTheme: 'blackRock',
    backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    playerSpawnBlock: [1, 1], interiorWalls: [], enemies: [], transitions: [],
  } as unknown as EditorRoomData;
}

test('Phase 7.1: room metadata controls create and coalesce history', () => {
  const data = room();
  const history = createEditorHistory();
  for (const value of [0.2, 0.4, 0.6]) {
    assert.notEqual(runRoomFieldMutation(history, data, 'directionalBias', r => {
      r.directionalBias = value;
    }), 'rejected-oversized');
  }
  assert.equal(history.undoStack.length, 1);
  assert.equal(isHistoryDirty(history), true);
  assert.equal(undo(history, data)?.roomData.directionalBias, undefined);
});

test('Phase 7.1: oversized rejected mutation remains dirty until saved', () => {
  const data = room();
  const history = createEditorHistory();
  const pending = capturePendingSnapshot(data);
  data.name = 'x'.repeat(EDITOR_HISTORY_BYTE_BUDGET + 1);
  assert.equal(commitPendingSnapshot(history, pending), 'rejected-oversized');
  assert.equal(isHistoryDirty(history), true);
  assert.equal(undo(history, data), null);
  assert.equal(isHistoryDirty(history), true);
  markHistorySaved(history);
  assert.equal(isHistoryDirty(history), false);
});

test('Phase 7.1: failed coalescing preserves the prior entry atomically', () => {
  const data = room();
  const history = createEditorHistory();
  let pending = capturePendingSnapshot(data, undefined, undefined, false, 'Property:room.name');
  data.name = 'small';
  assert.equal(commitPendingSnapshot(history, pending), 'committed');
  const previous = history.undoStack[0];
  const bytes = history.estimatedBytes;
  pending = capturePendingSnapshot(data, undefined, undefined, false, 'Property:room.name');
  data.name = 'x'.repeat(EDITOR_HISTORY_BYTE_BUDGET + 1);
  assert.equal(commitPendingSnapshot(history, pending), 'rejected-oversized');
  assert.equal(history.undoStack[0], previous);
  assert.equal(history.estimatedBytes, bytes);
  assert.equal(history.redoStack.length, 0);
});

test('Phase 7.1: campaign-spawn no-op preserves redo', () => {
  let data = room();
  const history = createEditorHistory();
  const spawn = { roomId: 'r', xBlock: 2, yBlock: 3 };
  let pending = capturePendingSnapshot(data);
  data.name = 'changed';
  commitPendingSnapshot(history, pending);
  data = undo(history, data)!.roomData;
  const redoCount = history.redoStack.length;
  pending = capturePendingSnapshot(data, spawn, 'r', true, 'Campaign spawn');
  assert.equal(commitPendingSnapshot(history, pending, { ...spawn }, 'r'), 'noop');
  assert.equal(history.redoStack.length, redoCount);
  assert.ok(redo(history, data));
});

test('Phase 7.1: pixel-material drag is one entry and undo restores the whole stroke', () => {
  let data = room();
  data.pixelMaterials = [];
  const history = createEditorHistory();
  const tx = beginPaintTransaction(data);
  for (let x = 1; x <= 4; x++) data.pixelMaterials.push({ uid: x, xPixel: x, yPixel: 2, materialId: 1 } as never);
  assert.equal(finishPaintTransaction(history, tx), 'committed');
  assert.equal(history.undoStack.length, 1);
  data = undo(history, data)!.roomData;
  assert.deepEqual(data.pixelMaterials, []);
});

test('Phase 7.1: block drag and right-drag erase each produce one entry', () => {
  for (const erase of [false, true]) {
    const data = room();
    data.interiorWalls = erase
      ? [{ uid: 1, xBlock: 1, yBlock: 1 }, { uid: 2, xBlock: 2, yBlock: 1 }] as never
      : [];
    const history = createEditorHistory();
    const tx = beginPaintTransaction(data);
    if (erase) data.interiorWalls.splice(0);
    else data.interiorWalls.push(
      { uid: 1, xBlock: 1, yBlock: 1 } as never,
      { uid: 2, xBlock: 2, yBlock: 1 } as never,
    );
    assert.equal(finishPaintTransaction(history, tx), 'committed');
    assert.equal(history.undoStack.length, 1);
  }
});

test('Phase 7.1: initial paint no-op followed by a valid cell remains undoable', () => {
  let data = room();
  const history = createEditorHistory();
  const tx = beginPaintTransaction(data);
  // Initial occupied/blocked cell intentionally performs no mutation.
  data.interiorWalls.push({ uid: 7, xBlock: 2, yBlock: 1 } as never);
  assert.equal(finishPaintTransaction(history, tx), 'committed');
  data = undo(history, data)!.roomData;
  assert.deepEqual(data.interiorWalls, []);
});

test('Phase 7.1: cancelled paint restores every touched cell', () => {
  const data = room();
  data.pixelMaterials = [{ uid: 1, xPixel: 1, yPixel: 1, materialId: 1 }] as never;
  const before = structuredClone(data);
  const tx = beginPaintTransaction(data);
  data.pixelMaterials.splice(0);
  data.pixelMaterials.push({ uid: 2, xPixel: 8, yPixel: 8, materialId: 2 } as never);
  assert.deepEqual(cancelPaintTransaction(tx).room, before);
});
