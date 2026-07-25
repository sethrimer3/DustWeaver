import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorRoomDataToJson } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { SavedCampaignV1 } from '../levels/campaignSchema';
import type { RoomDef } from '../levels/roomDef';
import { createOfficialCampaignSession } from '../editor/officialCampaignSession';
import { buildAuthoritativeCampaignExport } from '../editor/editableCampaignSession';
import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';
import {
  createLinkedRoomTransaction,
  linkTransitionTransaction,
  clearTargetRoomTransitionOnDiscard,
  type RoomRegistryOps,
} from '../editor/visualMapRoomPersistenceCoordinator';

// ── Fake, in-memory RoomRegistryOps ──────────────────────────────────────────
//
// visualMapRoomPersistenceCoordinator.ts is DOM/Vite-free by design (see its
// file header) precisely so it can be exercised with real production logic
// here — the real `../levels/rooms` module still can't be imported under
// plain `node --test` (transitively reads import.meta.env.BASE_URL), but the
// registry surface is now injected, so a small in-memory stand-in exactly
// reproducing its mutation semantics is enough to test the coordinator
// itself for real.

function createFakeRegistry(): RoomRegistryOps & { readonly store: Map<string, RoomDef> } {
  const store = new Map<string, RoomDef>();
  return {
    store,
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    register: (room) => { store.set(room.id, room); },
    unregister: (id) => { store.delete(id); },
    setNameOverride: (id, name) => { const r = store.get(id); if (r) r.name = name; },
    setWorldOverride: (id, worldId) => { const r = store.get(id); if (r) r.worldNumber = worldId; },
    setMapPosition: (id, mapX, mapY) => { const r = store.get(id); if (r) { r.mapX = mapX; r.mapY = mapY; } },
    setTransitionLink: (id, idx, targetRoomId, targetSpawnBlock) => {
      const r = store.get(id);
      const t = r?.transitions[idx] as { targetRoomId: string; targetSpawnBlock: readonly [number, number] } | undefined;
      if (!r || !t) return false;
      t.targetRoomId = targetRoomId;
      t.targetSpawnBlock = [targetSpawnBlock[0], targetSpawnBlock[1]];
      return true;
    },
  };
}

// The session's initial store payload and the fake registry's RoomDef must
// describe the SAME transition (mirroring how ROOM_REGISTRY and the
// campaign store stay in sync in production) — otherwise
// syncExistingRoomTransition would load a store-hydrated room whose
// transitions don't match what the registry validated against. Matches
// makeSourceRoomDef's default transition shape below.
function editorRoom(id: string, mapX = 0, withTransition = true): EditorRoomData {
  return {
    id, name: id, worldNumber: 1, mapX, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT',
    songId: '_continue', widthBlocks: 30, heightBlocks: 20,
    playerSpawnBlock: [2, 2],
    interiorWalls: [], enemies: [], saveTombs: [], skillTombs: [],
    transitions: withTransition ? [{
      uid: 900, direction: 'right', xBlock: 27, yBlock: 8, openingSizeBlocks: 3,
      targetRoomId: '', targetSpawnBlock: [0, 0], positionBlock: 8,
    }] : [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
  } as unknown as EditorRoomData;
}

function makeSourceRoomDef(id: string, opts: { withUnlinkedTransition?: boolean } = {}): RoomDef {
  return roomJsonDefToRoomDef({
    id, name: id, worldNumber: 1, widthBlocks: 30, heightBlocks: 20,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], skillTombs: [],
    transitions: opts.withUnlinkedTransition === false ? [] : [{
      direction: 'right', positionBlock: 8, openingSizeBlocks: 3,
      targetRoomId: '', targetSpawnBlock: [0, 0], xBlock: 27, yBlock: 8, gradientWidthBlocks: 3,
    }],
  });
}

function makeUnregisteredLinkedRoomDef(id: string, sourceRoomId: string): RoomDef {
  return roomJsonDefToRoomDef({
    id, name: 'Linked Room', worldNumber: 1, widthBlocks: 40, heightBlocks: 30,
    playerSpawnBlock: [20, 15], interiorWalls: [], enemies: [], skillTombs: [],
    transitions: [{
      direction: 'left', positionBlock: 8, openingSizeBlocks: 3,
      targetRoomId: sourceRoomId, targetSpawnBlock: [0, 0], xBlock: 0, yBlock: 8, gradientWidthBlocks: 3,
    }],
  });
}

function makeSession(rooms: EditorRoomData[], initialRoomId: string): SavedCampaignV1 {
  return {
    v: 1, kind: 'DustWeaverCampaign',
    campaign: { id: 'COORD_TEST', title: 'Coordinator Test', initialRoomId },
    metadata: { version: 1 },
    worldMap: {
      worlds: [{ id: 1, name: 'World 1', order: 0 }],
      rooms: rooms.map(r => ({ id: r.id, name: r.id, worldId: 1, mapX: r.mapX, mapY: r.mapY })),
    },
    rooms: rooms.map(r => dehydrateRoom(editorRoomDataToJson(r))),
  } as SavedCampaignV1;
}

// ── createLinkedRoomTransaction ──────────────────────────────────────────────

test('createLinkedRoomTransaction: successful creation persists both reciprocal halves', () => {
  const registry = createFakeRegistry();
  const src = editorRoom('src');
  const session = createOfficialCampaignSession(makeSession([src], 'src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('src'));

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'src');
  const result = createLinkedRoomTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'src', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });

  assert.equal(result.ok, true);
  assert.ok(registry.store.has('linked'), 'new room registered');
  assert.equal(registry.store.get('src')!.transitions[0].targetRoomId, 'linked');
  assert.equal(registry.store.get('linked')!.transitions[0].targetRoomId, 'src');
  assert.ok(session.campaignStore!.rawRoomsById.has('linked'), 'new room persisted immediately');
  assert.ok(session.campaignStore!.rawRoomsById.get('src')!.transitions!.some(t => t.to === 'linked'),
    'source room (non-current) persisted immediately too');
});

test('createLinkedRoomTransaction: rejects when source transition is missing, mutates nothing', () => {
  const registry = createFakeRegistry();
  const session = createOfficialCampaignSession(makeSession([editorRoom('src')], 'src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('src', { withUnlinkedTransition: false }));

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'src');
  const result = createLinkedRoomTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'src', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });

  assert.equal(result.ok, false);
  assert.ok(!registry.store.has('linked'), 'new room never registered');
  assert.ok(!session.campaignStore!.rawRoomsById.has('linked'));
});

test('createLinkedRoomTransaction: rejects when source room is missing entirely', () => {
  const registry = createFakeRegistry();
  const session = createOfficialCampaignSession(makeSession([editorRoom('src')], 'src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  // Note: source room intentionally NOT registered in the fake registry.

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'ghost');
  const result = createLinkedRoomTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'ghost', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });

  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /not found/);
  assert.ok(!registry.store.has('linked'));
});

test('createLinkedRoomTransaction: persistence failure after registration rolls back registry AND persisted state', () => {
  const registry = createFakeRegistry();
  const src = editorRoom('src');
  const session = createOfficialCampaignSession(makeSession([src], 'src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('src'));
  const rawSrcBefore = session.campaignStore!.rawRoomsById.get('src');

  // Inject a persistence failure on the very first store write.
  const originalCommitRoom = session.campaignStore!.commitRoom;
  session.campaignStore!.commitRoom = () => { throw new Error('simulated disk failure'); };

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'src');
  const result = createLinkedRoomTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'src', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });

  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /simulated disk failure/);

  // Registry-only state: new room must be fully unregistered.
  assert.ok(!registry.store.has('linked'), 'new room unregistered after rollback');
  assert.equal(registry.store.get('src')!.transitions[0].targetRoomId, '',
    'source room transition restored to unlinked in the registry');

  // Payload-only state: nothing left behind in the store either.
  session.campaignStore!.commitRoom = originalCommitRoom;
  assert.ok(!session.campaignStore!.rawRoomsById.has('linked'), 'no orphaned new-room payload');
  assert.equal(session.campaignStore!.rawRoomsById.get('src'), rawSrcBefore,
    'source room payload untouched — no half-written link');

  // Export after failure+rollback must still be clean.
  const registryRooms = new Map([['src', { id: 'src', name: 'src', worldNumber: 1, mapX: 0, mapY: 0 }]]);
  const exported = buildAuthoritativeCampaignExport(session, registryRooms, new Map([[1, 'World 1']]), new Map([[1, 0]]));
  const exportedIds = new Set(exported.rooms.map(r => r.id));
  const mapIds = new Set(exported.worldMap.rooms.map(r => r.id));
  assert.deepEqual(exportedIds, mapIds, 'no world-map/payload mismatch after failure+rollback');
  assert.ok(!exportedIds.has('linked'));
});

test('createLinkedRoomTransaction: current-room source is patched in memory (dirty), not committed, until Save', () => {
  const registry = createFakeRegistry();
  const src = editorRoom('src');
  const session = createOfficialCampaignSession(makeSession([src], 'src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('src'));

  const store = session.campaignStore!;
  const { roomData: currentRoomData } = store.getRoom('src', 1);
  const rawSrcBefore = store.rawRoomsById.get('src');

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'src');
  const result = createLinkedRoomTransaction({
    registry, session, pendingRoomEdits, currentRoomData, nextUid: 1,
    sourceRoomId: 'src', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sourcePatchedCurrentRoom, true);

  // Dirty-in-memory, not yet persisted (cadence rule for the current room).
  assert.equal(currentRoomData.transitions[0].targetRoomId, 'linked');
  assert.equal(store.rawRoomsById.get('src'), rawSrcBefore, 'no premature commit for the current room');
  assert.ok(store.dirtyRoomIds.has('src'));

  // Save boundary: persistSavedCampaignRoom-equivalent commit.
  store.commitRoom('src', currentRoomData);
  assert.ok(store.rawRoomsById.get('src')!.transitions!.some(t => t.to === 'linked'), 'save persists both sides');
  assert.ok(store.rawRoomsById.get('linked')!.transitions!.some(t => t.to === 'src'));

  const registryRooms = new Map([
    ['src', { id: 'src', name: 'src', worldNumber: 1, mapX: 0, mapY: 0 }],
    ['linked', { id: 'linked', name: 'Linked Room', worldNumber: 1, mapX: 40, mapY: 0 }],
  ]);
  const exported = buildAuthoritativeCampaignExport(session, registryRooms, new Map([[1, 'World 1']]), new Map([[1, 0]]));
  const exportedIds = new Set(exported.rooms.map(r => r.id));
  const mapIds = new Set(exported.worldMap.rooms.map(r => r.id));
  assert.deepEqual(exportedIds, mapIds);
});

test('createLinkedRoomTransaction + clearTargetRoomTransitionOnDiscard: Discard keeps the target room but clears both directions', () => {
  const registry = createFakeRegistry();
  const src = editorRoom('src');
  const session = createOfficialCampaignSession(makeSession([src], 'src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('src'));

  const store = session.campaignStore!;
  const { roomData: currentRoomData } = store.getRoom('src', 1);

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'src');
  const result = createLinkedRoomTransaction({
    registry, session, pendingRoomEdits, currentRoomData, nextUid: 1,
    sourceRoomId: 'src', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });
  assert.equal(result.ok, true);
  assert.ok(store.rawRoomsById.has('linked'), 'target room already persisted (immediate new-room path)');

  // Discard: source room's in-memory session is dropped...
  store.discardRoomChanges('src');
  assert.equal(store.rawRoomsById.get('src')!.transitions?.some(t => t.to === 'linked'), false,
    'source room never had the link committed');

  // ...and the target room's reciprocal transition is explicitly cleared,
  // NOT left as a dangling one-way link, and the target room is NOT deleted.
  const cleared = clearTargetRoomTransitionOnDiscard({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    targetRoomId: 'linked', targetTransIndex: 0,
  });
  assert.equal(cleared.ok, true);
  assert.ok(store.rawRoomsById.has('linked'), 'target room still exists — not deleted');
  assert.equal(registry.store.get('linked')!.transitions[0].targetRoomId, '', 'registry-level transition unlinked');
  assert.equal(store.rawRoomsById.get('linked')!.transitions?.some(t => t.to === 'src'), false,
    'persisted target room transition unlinked too');

  const registryRooms = new Map([
    ['src', { id: 'src', name: 'src', worldNumber: 1, mapX: 0, mapY: 0 }],
    ['linked', { id: 'linked', name: 'Linked Room', worldNumber: 1, mapX: 40, mapY: 0 }],
  ]);
  const exported = buildAuthoritativeCampaignExport(session, registryRooms, new Map([[1, 'World 1']]), new Map([[1, 0]]));
  const exportedIds = new Set(exported.rooms.map(r => r.id));
  const mapIds = new Set(exported.worldMap.rooms.map(r => r.id));
  assert.deepEqual(exportedIds, mapIds, 'no dangling transition targets, no world-map/payload mismatch after discard');
  assert.ok(exportedIds.has('linked'), 'linked room survives discard as a standalone room');
  // The transition slot itself is kept (matches how an ordinary unlinked
  // door is represented elsewhere) — only its target is cleared, so the
  // room is a normal unlinked room rather than one with a dangling target.
  assert.equal(exported.rooms.find(r => r.id === 'linked')?.transitions?.some(t => t.to === 'src'), false,
    'no dangling transition target back to the discarded source room');
});

test('createLinkedRoomTransaction: legacy no-CampaignStore session still works end-to-end', () => {
  const registry = createFakeRegistry();
  registry.register(makeSourceRoomDef('src'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();

  const newRoomDef = makeUnregisteredLinkedRoomDef('linked', 'src');
  const result = createLinkedRoomTransaction({
    registry, session: null, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'src', sourceTransIndex: 0, newRoomDef,
    newRoomName: 'Linked Room', newRoomWorldId: 1, mapX: 40, mapY: 0,
  });

  assert.equal(result.ok, true);
  assert.ok(pendingRoomEdits.has('linked'));
  assert.equal(pendingRoomEdits.get('src')?.transitions[0]?.targetRoomId, 'linked');
});

// ── linkTransitionTransaction ────────────────────────────────────────────────

test('linkTransitionTransaction: links two existing doors and persists both sides', () => {
  const registry = createFakeRegistry();
  const a = editorRoom('a');
  const b = editorRoom('b', 40);
  const session = createOfficialCampaignSession(makeSession([a, b], 'a'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('a'));
  registry.register(makeSourceRoomDef('b'));

  const result = linkTransitionTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'a', sourceTransIndex: 0, targetRoomId: 'b', targetTransIndex: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(registry.store.get('a')!.transitions[0].targetRoomId, 'b');
  assert.equal(registry.store.get('b')!.transitions[0].targetRoomId, 'a');
  assert.ok(session.campaignStore!.rawRoomsById.get('a')!.transitions!.some(t => t.to === 'b'));
  assert.ok(session.campaignStore!.rawRoomsById.get('b')!.transitions!.some(t => t.to === 'a'));
});

test('linkTransitionTransaction: rejects when target transition is missing, mutates nothing', () => {
  const registry = createFakeRegistry();
  const session = createOfficialCampaignSession(makeSession([editorRoom('a'), editorRoom('b', 40)], 'a'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('a'));
  registry.register(makeSourceRoomDef('b', { withUnlinkedTransition: false }));

  const result = linkTransitionTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'a', sourceTransIndex: 0, targetRoomId: 'b', targetTransIndex: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(registry.store.get('a')!.transitions[0].targetRoomId, '', 'source-side registry mutation never applied');
});

test('linkTransitionTransaction: persistence failure rolls back both registry sides', () => {
  const registry = createFakeRegistry();
  const a = editorRoom('a');
  const b = editorRoom('b', 40);
  const session = createOfficialCampaignSession(makeSession([a, b], 'a'));
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  registry.register(makeSourceRoomDef('a'));
  registry.register(makeSourceRoomDef('b'));

  let calls = 0;
  const originalCommitRoom = session.campaignStore!.commitRoom;
  session.campaignStore!.commitRoom = (roomId, roomData) => {
    calls++;
    if (calls === 2) throw new Error('simulated failure on second commit');
    originalCommitRoom(roomId, roomData);
  };

  const result = linkTransitionTransaction({
    registry, session, pendingRoomEdits, currentRoomData: null, nextUid: 1,
    sourceRoomId: 'a', sourceTransIndex: 0, targetRoomId: 'b', targetTransIndex: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(registry.store.get('a')!.transitions[0].targetRoomId, '', 'source side rolled back');
  assert.equal(registry.store.get('b')!.transitions[0].targetRoomId, '', 'target side rolled back');
  session.campaignStore!.commitRoom = originalCommitRoom;
  assert.equal(session.campaignStore!.rawRoomsById.get('a')!.transitions?.some(t => t.to === 'b'), false);
  assert.equal(session.campaignStore!.rawRoomsById.get('b')!.transitions?.some(t => t.to === 'a'), false);
});
