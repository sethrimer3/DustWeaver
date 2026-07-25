/**
 * Item F: persistence cadence guards.
 *
 * Ordinary editing must stay entirely in memory. Only an explicit Save /
 * Save & Test / export / room-switch-with-save may serialize (dehydrate) a
 * room, and each of those must do it exactly once.
 *
 * Two layers of coverage:
 *   1. Behavioral, against the real `createCampaignStore()` — markRoomDirty
 *      vs commitRoom, double-commit, room switching.
 *   2. Source-level guards over editorController.ts's commit topology, since
 *      the controller builds real DOM and cannot be imported under Node
 *      (same constraint as editorUIPhase5SourceGuards.test.ts).
 *
 * No campaign/room file schema is changed by these tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCampaignStore } from '../editor/campaignStore';
import type { SavedCampaignV1 } from '../levels/campaignSchema';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { editorRoomDataToJson } from '../editor/roomJson';
import type { EditorRoomData } from '../editor/editorElementTypes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readControllerSource(): string {
  return readFileSync(path.join(__dirname, '../editor/editorController.ts'), 'utf8');
}

/** A minimal but schema-valid saved room, produced through the real
 *  editor-data -> json -> dehydrate pipeline (no schema changes). */
function makeSavedRoom(id: string) {
  const data = {
    id, name: id, worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT',
    songId: '_continue', widthBlocks: 30, heightBlocks: 20,
    playerSpawnBlock: [2, 2],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
  } as unknown as EditorRoomData;
  return dehydrateRoom(editorRoomDataToJson(data));
}

function makeCampaign(roomIds: string[]): SavedCampaignV1 {
  return {
    v: 1,
    kind: 'DustWeaverCampaign',
    campaign: { id: 'TEST_CAMPAIGN', title: 'Test Campaign', initialRoomId: roomIds[0] },
    metadata: { version: 1 },
    worldMap: { rooms: [] },
    rooms: roomIds.map(makeSavedRoom),
  } as unknown as SavedCampaignV1;
}

// ── 1. Behavioral: markRoomDirty never serializes ─────────────────────────

test('markRoomDirty does NOT serialize/dehydrate the room', () => {
  const store = createCampaignStore(makeCampaign(['roomA']));
  const rawBefore = store.rawRoomsById.get('roomA');
  const { roomData } = store.getRoom('roomA', 1);

  // Simulate many ordinary edits (placement / drag / deletion / inspector).
  for (let i = 0; i < 200; i++) {
    roomData.interiorWalls.push({ uid: 100 + i, xBlock: i, yBlock: 0, wBlock: 1, hBlock: 1 } as never);
    store.markRoomDirty('roomA', roomData);
  }

  assert.equal(
    store.rawRoomsById.get('roomA'), rawBefore,
    'the serialized (raw) room object must be untouched — same reference, never re-dehydrated',
  );
  assert.ok(store.dirtyRoomIds.has('roomA'), 'the room is flagged dirty in memory only');
  assert.equal(store.hydratedRoomsById.get('roomA'), roomData, 'live working data is the hydrated copy');
});

test('commitRoom serializes exactly once and clears the dirty flag', () => {
  const store = createCampaignStore(makeCampaign(['roomA']));
  const rawBefore = store.rawRoomsById.get('roomA');
  const { roomData } = store.getRoom('roomA', 1);
  roomData.interiorWalls.push({ uid: 900, xBlock: 4, yBlock: 4, wBlock: 1, hBlock: 1 } as never);
  store.markRoomDirty('roomA', roomData);

  store.commitRoom('roomA', roomData);
  const rawAfter = store.rawRoomsById.get('roomA');
  assert.notEqual(rawAfter, rawBefore, 'commit replaces the serialized room');
  assert.equal(store.dirtyRoomIds.has('roomA'), false, 'commit clears the dirty flag');

  // A second commit with no intervening edit re-serializes but must not
  // corrupt or duplicate anything — and commitAllDirtyRooms must be a no-op.
  store.commitAllDirtyRooms();
  assert.equal(store.rawRoomsById.get('roomA'), rawAfter, 'no dirty rooms left to re-serialize');
});

test('discardRoomChanges (Cancel) drops the working copy without committing', () => {
  const store = createCampaignStore(makeCampaign(['roomA']));
  const rawBefore = store.rawRoomsById.get('roomA');
  const { roomData } = store.getRoom('roomA', 1);
  roomData.interiorWalls.push({ uid: 901, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 } as never);
  store.markRoomDirty('roomA', roomData);

  store.discardRoomChanges('roomA');
  assert.equal(store.rawRoomsById.get('roomA'), rawBefore, 'Cancel must not serialize anything');
  assert.equal(store.dirtyRoomIds.has('roomA'), false);
  assert.equal(store.hydratedRoomsById.has('roomA'), false, 'the edited working copy is dropped');

  // Re-opening the room re-hydrates from the untouched raw data.
  const reopened = store.getRoom('roomA', 1).roomData;
  assert.equal(reopened.interiorWalls.length, 0, 'discarded edits are gone');
});

test('room switching does not double-serialize', () => {
  const store = createCampaignStore(makeCampaign(['roomA', 'roomB']));
  const a = store.getRoom('roomA', 1).roomData;
  a.interiorWalls.push({ uid: 902, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1 } as never);
  store.markRoomDirty('roomA', a);

  // Switch to roomB with "save changes": exactly one commit for roomA.
  store.commitRoom('roomA', a);
  const rawAfterFirstCommit = store.rawRoomsById.get('roomA');
  store.setActiveRoomId('roomB');
  store.getRoom('roomB', 1);

  // Switching back must NOT re-serialize roomA (it is no longer dirty).
  store.setActiveRoomId('roomA');
  store.commitAllDirtyRooms();
  assert.equal(
    store.rawRoomsById.get('roomA'), rawAfterFirstCommit,
    'a clean room must not be re-serialized on switch-back',
  );
});

test('an unedited room is never serialized just by being opened', () => {
  const store = createCampaignStore(makeCampaign(['roomA']));
  const rawBefore = store.rawRoomsById.get('roomA');
  store.setActiveRoomId('roomA');
  store.getRoom('roomA', 1);
  store.getRoom('roomA', 1);
  store.commitAllDirtyRooms();
  assert.equal(store.rawRoomsById.get('roomA'), rawBefore);
  assert.equal(store.dirtyRoomIds.has('roomA'), false);
});

// ── 2. Source guards: the controller's commit topology ────────────────────

test('applyEdits() marks the room dirty but never commits it', () => {
  const source = readControllerSource();
  const applyEditsBody = source.slice(
    source.indexOf('function applyEdits('),
    source.indexOf('function runRoomFieldMutation('),
  );
  assert.ok(applyEditsBody.length > 0, 'applyEdits() body located');
  assert.ok(
    applyEditsBody.includes('campaignStore.markRoomDirty('),
    'ordinary edits mark the room dirty in memory',
  );
  assert.ok(
    !applyEditsBody.includes('commitRoom('),
    'ordinary placement/drag/deletion/inspector edits must never commit',
  );
  assert.ok(
    !applyEditsBody.includes('commitActiveRoomToCampaign('),
    'ordinary edits must not reach the commit path',
  );
});

test('commitRoom is only ever reached through commitActiveRoomToCampaign (plus the new-room bootstrap)', () => {
  const source = readControllerSource();
  const directCommits = source.match(/campaignStore\.commitRoom\(/g) ?? [];
  assert.equal(
    directCommits.length, 2,
    'expected exactly two direct commitRoom call sites: commitActiveRoomToCampaign, ' +
    'and the freshly-created-room bootstrap. A new one means a new serialization path.',
  );
});

test('commitActiveRoomToCampaign is a no-op unless the room is actually dirty', () => {
  const source = readControllerSource();
  const body = source.slice(
    source.indexOf('function commitActiveRoomToCampaign('),
    source.indexOf('function collectActiveSavedRoomsForDevChecks('),
  );
  assert.ok(/if \(!state\.roomData \|\| !isCurrentRoomDirty\) return false;/.test(body),
    'a clean room must never be re-serialized');
  assert.ok(body.includes('isCurrentRoomDirty = false;'), 'a commit clears the dirty flag');
  assert.ok(body.includes('markHistorySaved(history)'), 'a commit marks history saved');
});

test('Save commits once and leaves the editor open', () => {
  const source = readControllerSource();
  const body = source.slice(
    source.indexOf('function saveEdits('),
    source.indexOf('function confirmEdits('),
  );
  assert.equal((body.match(/commitActiveRoomToCampaign\(/g) ?? []).length, 1, 'exactly one commit');
  assert.ok(body.includes(`commitActiveRoomToCampaign('manual-save')`));
  assert.ok(!body.includes('closeEditor()'), 'Save must not close the editor');
  assert.ok(!body.includes('onLoadRoom('), 'Save must not activate the room at runtime');
});

test('Save & Test commits once, activates the room once, and closes to playtest', () => {
  const source = readControllerSource();
  const body = source.slice(
    source.indexOf('function confirmEdits('),
    source.indexOf('function cancelEdits('),
  );
  assert.equal((body.match(/saveEdits\(\)/g) ?? []).length, 1,
    'exactly one save (and therefore one commit)');
  assert.equal((body.match(/commitActiveRoomToCampaign\(/g) ?? []).length, 0,
    'the commit comes from saveEdits(), not a second direct call');
  assert.equal((body.match(/onLoadRoom\(/g) ?? []).length, 1, 'exactly one runtime activation');
  assert.ok(body.includes('closeEditor();'), 'Save & Test closes the editor to playtest');
});

test('Cancel discards without committing', () => {
  const source = readControllerSource();
  const body = source.slice(
    source.indexOf('function cancelEdits('),
    source.indexOf('function applyEdits('),
  );
  assert.ok(body.includes('discardCurrentRoomSessionChanges('), 'Cancel discards session changes');
  assert.equal((body.match(/commitActiveRoomToCampaign\(/g) ?? []).length, 0,
    'Cancel must never commit');
  assert.equal((body.match(/saveEdits\(\)/g) ?? []).length, 0, 'Cancel must never save');
  assert.ok(body.includes('closeEditor();'));
});

test('room switching commits at most once, and only on the explicit "save changes" branch', () => {
  const source = readControllerSource();
  const switchCommits = source.match(/commitActiveRoomToCampaign\('change-room'\)/g) ?? [];
  // Two entry points (world map and visual map), one commit each.
  assert.equal(switchCommits.length, 2);
  // Each sits inside a showSaveChangesDialog save-branch whose sibling
  // discard-branch calls discardCurrentRoomSessionChanges instead.
  const discardBranches = source.match(/discardCurrentRoomSessionChanges\(state\.roomData\)/g) ?? [];
  assert.ok(discardBranches.length >= 2, 'each switch offers a non-committing discard branch');
});
