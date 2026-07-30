/**
 * Regression coverage for the new-save Knight/Outcast persistence bug.
 *
 * A brand-new official-campaign save must have `characterId: 'outcast'` in
 * the very first record written to storage — not just in the in-memory
 * `PlayerProgress` after gameplay starts. Historically `createNewSaveSlot()`
 * persisted the 'knight' default before `game.ts` corrected it in memory,
 * so an abrupt quit before the next checkpoint left a save that rendered
 * the wrong sprite on reload.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
  setItem(key: string, value: string) { store.set(key, value); },
  removeItem(key: string) { store.delete(key); },
} as unknown as Storage;

import { createNewSaveSlot, loadSaveSlot, saveSaveSlot } from '../progression/saveSlots';
import { createDefaultProgress, createOfficialNewProfileProgress } from '../progression/playerProgress';

test('creating a normal new save produces persisted progress with characterId outcast', () => {
  const data = createNewSaveSlot(false);
  assert.equal(data.progress.characterId, 'outcast');
});

test('creating an Assist Mode save has assistMode true and characterId outcast', () => {
  const data = createNewSaveSlot(true);
  assert.equal(data.assistMode, true);
  assert.equal(data.progress.characterId, 'outcast');
});

test('serializing and immediately reloading a new save preserves outcast with no gameplay checkpoint', () => {
  store.clear();
  const data = createNewSaveSlot(false);
  // No checkpoint/gameplay mutation happens here — this mirrors the
  // save-slot-creation write that happens before game.ts ever runs.
  saveSaveSlot(1, data);
  const reloaded = loadSaveSlot(1);
  assert.notEqual(reloaded, null);
  assert.equal(reloaded!.progress.characterId, 'outcast');
});

test('a save that has already explored rooms with a legitimate non-outcast character is not overwritten', () => {
  store.clear();
  const data = createNewSaveSlot(false);
  data.progress.characterId = 'knight';
  data.progress.exploredRoomIds = ['lobby'];
  saveSaveSlot(2, data);
  const reloaded = loadSaveSlot(2);
  assert.notEqual(reloaded, null);
  assert.equal(reloaded!.progress.characterId, 'knight');
});

test('a legacy never-played save stuck on knight is migrated to outcast on load', () => {
  store.clear();
  const data = createNewSaveSlot(false);
  data.progress.characterId = 'knight';
  data.progress.exploredRoomIds = [];
  saveSaveSlot(0, data);
  const reloaded = loadSaveSlot(0);
  assert.notEqual(reloaded, null);
  assert.equal(reloaded!.progress.characterId, 'outcast');
});

test('createDefaultProgress still defaults to knight (used for generic/legacy contexts, not the official new-save path)', () => {
  assert.equal(createDefaultProgress().characterId, 'knight');
});

test('createOfficialNewProfileProgress is correct by construction', () => {
  assert.equal(createOfficialNewProfileProgress().characterId, 'outcast');
});
