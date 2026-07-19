import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorHistory,
  pushSnapshot,
  undo,
  redo,
  clearHistory,
} from '../editor/editorHistory';
import type { EditorRoomData } from '../editor/editorState';
import type { CampaignSpawnData } from '../levels/campaignSchema';

/** Minimal fake room data — editorHistory only touches `.interiorWalls` for perf logging. */
function makeRoom(id: string): EditorRoomData {
  return { id, interiorWalls: [] } as unknown as EditorRoomData;
}

test('pushSnapshot + undo round-trips room data without campaign spawn tracking', () => {
  const history = createEditorHistory();
  const before = makeRoom('room-1');
  pushSnapshot(history, before);
  const after = makeRoom('room-1-mutated');
  const restored = undo(history, after);
  assert.ok(restored);
  assert.equal(restored!.roomData.id, 'room-1');
  assert.equal(restored!.campaignSpawnTracked, undefined);
});

test('undo with nothing on the stack returns null', () => {
  const history = createEditorHistory();
  const result = undo(history, makeRoom('r'));
  assert.equal(result, null);
});

test('redo with nothing on the stack returns null', () => {
  const history = createEditorHistory();
  const result = redo(history, makeRoom('r'));
  assert.equal(result, null);
});

test('undo then redo restores the post-mutation state', () => {
  const history = createEditorHistory();
  const original = makeRoom('original');
  pushSnapshot(history, original);
  const mutated = makeRoom('mutated');

  const undone = undo(history, mutated);
  assert.equal(undone!.roomData.id, 'original');

  const redone = redo(history, undone!.roomData);
  assert.equal(redone!.roomData.id, 'mutated');
});

test('a new pushSnapshot clears the redo stack', () => {
  const history = createEditorHistory();
  pushSnapshot(history, makeRoom('a'));
  undo(history, makeRoom('b'));
  assert.equal(history.redoStack.length, 1);
  pushSnapshot(history, makeRoom('c'));
  assert.equal(history.redoStack.length, 0);
});

test('campaign-spawn-tracked snapshot round-trips campaignSpawn and initialRoomId through undo', () => {
  const history = createEditorHistory();
  const room = makeRoom('r');
  const spawn: CampaignSpawnData = { roomId: 'r', xBlock: 3, yBlock: 4, startingHealth: 5 };
  pushSnapshot(history, room, spawn, 'r', true);

  // Simulate mutation: spawn moved to a new room.
  const newSpawn: CampaignSpawnData = { roomId: 'r2', xBlock: 1, yBlock: 1 };
  const restored = undo(history, room, newSpawn, 'r2', true);

  assert.ok(restored);
  assert.equal(restored!.campaignSpawnTracked, true);
  assert.deepEqual(restored!.campaignSpawn, spawn);
  assert.equal(restored!.initialRoomId, 'r');
});

test('campaign-spawn-tracked snapshot correctly restores "no campaign spawn" (undefined) on undo', () => {
  const history = createEditorHistory();
  const room = makeRoom('r');
  // Before mutation there was no campaign spawn at all.
  pushSnapshot(history, room, undefined, undefined, true);

  const newSpawn: CampaignSpawnData = { roomId: 'r', xBlock: 0, yBlock: 0 };
  const restored = undo(history, room, newSpawn, 'r', true);

  assert.ok(restored);
  assert.equal(restored!.campaignSpawnTracked, true);
  assert.equal(restored!.campaignSpawn, undefined);
});

test('undo followed by redo round-trips campaign spawn deletion transactionally', () => {
  const history = createEditorHistory();
  const room = makeRoom('r');
  const spawn: CampaignSpawnData = { roomId: 'r', xBlock: 2, yBlock: 2 };
  // Push snapshot capturing the spawn BEFORE deletion.
  pushSnapshot(history, room, spawn, 'r', true);
  // "Delete" happens — current spawn is now undefined.
  const undone = undo(history, room, undefined, 'r', true);
  assert.deepEqual(undone!.campaignSpawn, spawn);

  // Redo should bring back "no spawn".
  const redone = redo(history, room, undone!.campaignSpawn, undone!.initialRoomId, true);
  assert.equal(redone!.campaignSpawn, undefined);
});

test('untracked snapshots (plain room edits) leave campaignSpawnTracked falsy so callers skip spawn restoration', () => {
  const history = createEditorHistory();
  pushSnapshot(history, makeRoom('a')); // no campaign spawn args
  const restored = undo(history, makeRoom('b'));
  assert.ok(restored);
  assert.ok(!restored!.campaignSpawnTracked);
});

test('clearHistory empties both stacks', () => {
  const history = createEditorHistory();
  pushSnapshot(history, makeRoom('a'));
  undo(history, makeRoom('b'));
  assert.ok(history.redoStack.length > 0);
  clearHistory(history);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
});

test('pushSnapshot deep-clones room data (mutating original after push does not affect the snapshot)', () => {
  const history = createEditorHistory();
  const room = makeRoom('original') as unknown as { id: string; interiorWalls: unknown[] };
  pushSnapshot(history, room as unknown as EditorRoomData);
  room.id = 'mutated-after-push';
  const restored = undo(history, room as unknown as EditorRoomData);
  assert.equal(restored!.roomData.id, 'original');
});
