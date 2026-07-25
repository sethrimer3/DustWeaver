import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import campaignExport from '../../electron/campaignExport.cjs';
import { editorRoomDataToJson } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { SavedCampaignV1 } from '../levels/campaignSchema';
import { createOfficialCampaignSession } from '../editor/officialCampaignSession';
import {
  loadPersistedCampaignRoom,
  persistCreatedCampaignRoom,
  persistSavedCampaignRoom,
} from '../editor/campaignRoomPersistence';
import { buildAuthoritativeCampaignExport } from '../editor/editableCampaignSession';
import { roomDefToEditorRoomData } from '../editor/editorRoomBuilder';
import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';
import type { RoomJsonTransition } from '../editor/roomJsonSchema';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';

// The real `../levels/rooms` module (ROOM_REGISTRY, registerRoom,
// setRoomTransitionLink) transitively imports packedCampaignLoader.ts, which
// reads `import.meta.env.BASE_URL` at module scope — unavailable under the
// plain `node --test` runner (no Vite). The two helpers below are Node-safe
// stand-ins that reproduce their exact mutation semantics for this test.

/** Mirrors setRoomTransitionLink(roomId, transitionIndex, ...): mutates the
 * given room's transition target in place, exactly like the production
 * ROOM_REGISTRY-backed version the visual-map dialogs call. */
function testSetRoomTransitionLink(
  room: RoomDef,
  transitionIndex: number,
  targetRoomId: string,
  targetSpawnBlock: readonly [number, number],
): void {
  const transition = room.transitions[transitionIndex] as {
    targetRoomId: string;
    targetSpawnBlock: readonly [number, number];
  };
  transition.targetRoomId = targetRoomId;
  transition.targetSpawnBlock = [targetSpawnBlock[0], targetSpawnBlock[1]];
}

/** Mirrors computeSpawnBlockForMapLink from editorVisualMapLinkPrompt.ts. */
function testComputeSpawnBlockForMapLink(
  room: RoomDef,
  transition: RoomTransitionDef,
): readonly [number, number] {
  const SPAWN_INSET_BLOCKS = 3;
  const openingCenterY = (transition.yBlock ?? transition.positionBlock) + Math.floor(transition.openingSizeBlocks / 2);
  const openingCenterX = (transition.xBlock ?? transition.positionBlock) + Math.floor(transition.openingSizeBlocks / 2);
  if (transition.direction === 'left') return [SPAWN_INSET_BLOCKS, openingCenterY];
  if (transition.direction === 'right') return [room.widthBlocks - SPAWN_INSET_BLOCKS - 1, openingCenterY];
  if (transition.direction === 'up') return [openingCenterX, SPAWN_INSET_BLOCKS];
  return [openingCenterX, room.heightBlocks - SPAWN_INSET_BLOCKS - 1];
}

function editorRoom(id: string): EditorRoomData {
  return {
    id, name: id, worldNumber: 1, mapX: id === 'start' ? 0 : 1, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT',
    songId: '_continue', widthBlocks: 30, heightBlocks: 20,
    playerSpawnBlock: [2, 2],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
  } as unknown as EditorRoomData;
}

test('official editor wiring preserves a connected room across playtest, reopen, export, cache, and reload', async () => {
  const start = editorRoom('start');
  const unloaded = editorRoom('unloaded');
  unloaded.mapX = 9;
  const campaign = {
    v: 1, kind: 'DustWeaverCampaign',
    campaign: { id: 'TEST_CAMPAIGN', title: 'Test', initialRoomId: 'start' },
    metadata: { version: 1 },
    worldMap: {
      worlds: [{ id: 1, name: 'World 1', order: 0 }],
      rooms: [
        { id: 'start', name: 'start', worldId: 1, mapX: 0, mapY: 0 },
        { id: 'unloaded', name: 'unloaded', worldId: 1, mapX: 9, mapY: 0 },
      ],
    },
    rooms: [
      dehydrateRoom(editorRoomDataToJson(start)),
      dehydrateRoom(editorRoomDataToJson(unloaded)),
    ],
  } as SavedCampaignV1;
  // Official-game startup creates this once; every editor reopening receives
  // the same object through startGameScreen.
  const session = createOfficialCampaignSession(campaign);
  const pendingRoomEdits = new Map<string, EditorRoomData>();

  const connected = editorRoom('connected');
  connected.transitions.push({
    uid: 11, direction: 'left', xBlock: 0, yBlock: 8, openingSizeBlocks: 3,
    targetRoomId: 'start', targetSpawnBlock: [28, 8], positionBlock: 8,
  } as never);
  start.transitions.push({
    uid: 12, direction: 'right', xBlock: 29, yBlock: 8, openingSizeBlocks: 3,
    targetRoomId: 'connected', targetSpawnBlock: [1, 8], positionBlock: 8,
  } as never);

  assert.equal(
    persistCreatedCampaignRoom(session, pendingRoomEdits, connected),
    'campaign-store',
  );
  // Subsequent body edit and both transition edits use the same production
  // save boundary as Save / room switch / playtest.
  connected.interiorWalls.push({ uid: 10, xBlock: 5, yBlock: 6, wBlock: 2, hBlock: 1 } as never);
  persistSavedCampaignRoom(session, pendingRoomEdits, connected);
  persistSavedCampaignRoom(session, pendingRoomEdits, start);

  // Editor close clears only its legacy local map. The authoritative room is
  // still present and the next editor instance loads it through the store.
  pendingRoomEdits.clear();
  assert.ok(session.campaignStore?.rawRoomsById.has('connected'));
  const reopened = loadPersistedCampaignRoom(session, pendingRoomEdits, 'connected', 1);
  assert.equal(reopened?.source, 'campaign-store');
  assert.equal(reopened?.roomData.interiorWalls.length, 1);
  assert.equal(reopened?.roomData.transitions[0]?.targetRoomId, 'start');

  const registry = new Map([
    ['start', { id: 'start', name: 'start', worldNumber: 1, mapX: 0, mapY: 0 }],
    ['connected', { id: 'connected', name: 'connected', worldNumber: 1, mapX: 1, mapY: 0 }],
  ]);
  const exported = buildAuthoritativeCampaignExport(
    session,
    registry,
    new Map([[1, 'World 1']]),
    new Map([[1, 0]]),
  );
  const campaignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-connected-room-'));
  const roomIdFirstIndex = new Map(exported.rooms.map((room, index) => [room.id, index]));
  const result = await campaignExport.exportCampaignToDisk({
    campaign: exported, campaignMeta: exported.campaign, campaignId: exported.campaign.id,
    rooms: exported.rooms, roomIdFirstIndex, isOfficialCampaign: false, campaignDir,
  });
  assert.equal(result.ok, true);

  const packed = JSON.parse(fs.readFileSync(path.join(campaignDir, 'TEST_CAMPAIGN.dwcampaign.json'), 'utf8')) as SavedCampaignV1;
  const reloadedSession = createOfficialCampaignSession(packed);
  const reloaded = loadPersistedCampaignRoom(reloadedSession, new Map(), 'connected', 1);
  assert.equal(reloaded?.roomData.interiorWalls.length, 1);
  assert.equal(reloaded?.roomData.transitions[0]?.targetRoomId, 'start');
  assert.ok(packed.worldMap.rooms.some(room => room.id === 'connected'));
  assert.ok(packed.worldMap.rooms.some(room => room.id === 'unloaded'));
  assert.ok(packed.rooms.some(room => room.id === 'unloaded'));
  assert.ok(packed.rooms.find(room => room.id === 'start')?.transitions?.some(t => t.to === 'connected'));
  assert.ok(packed.rooms.find(room => room.id === 'connected')?.transitions?.some(t => t.to === 'start'));
  const manifest = JSON.parse(fs.readFileSync(path.join(campaignDir, 'ROOMS', 'manifest.json'), 'utf8')) as {
    rooms: Record<string, unknown>;
  };
  assert.ok('connected' in manifest.rooms);
  assert.ok(fs.existsSync(path.join(campaignDir, 'ROOMS', 'connected_room.json')));
});

test('visual-map room creation and door-linking persist through the store-aware boundary', async () => {
  // Simulates the controller-side persistence boundary
  // (handleRoomCreatedFromVisualMap / handleRoomTransitionLinkedFromVisualMap
  // in editorController.ts) that the visual-map dialogs
  // (editorVisualMapDialogs.ts, editorVisualMapLinkPrompt.ts) now notify via
  // VisualMapCallbacks.onRoomCreated / onRoomTransitionLinked. This is a
  // Node-safe reproduction of the full data flow without any DOM.
  const start = editorRoom('vm_start');
  start.transitions.push({
    uid: 20, direction: 'right', xBlock: 27, yBlock: 8, openingSizeBlocks: 3,
    targetRoomId: '', targetSpawnBlock: [0, 0], positionBlock: 8,
  } as never);
  const campaign = {
    v: 1, kind: 'DustWeaverCampaign',
    campaign: { id: 'VM_TEST_CAMPAIGN', title: 'VM Test', initialRoomId: 'vm_start' },
    metadata: { version: 1 },
    worldMap: {
      worlds: [{ id: 1, name: 'World 1', order: 0 }],
      rooms: [{ id: 'vm_start', name: 'vm_start', worldId: 1, mapX: 0, mapY: 0 }],
    },
    rooms: [dehydrateRoom(editorRoomDataToJson(start))],
  } as SavedCampaignV1;
  const session = createOfficialCampaignSession(campaign);
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  let nextUid = 100;

  // Mirrors openVisualMap() registering the currently-edited room's RoomDef
  // (here just a local variable standing in for ROOM_REGISTRY) right before
  // the visual map opens.
  const startRoomDef = roomJsonDefToRoomDef({
    id: 'vm_start', name: 'vm_start', worldNumber: 1, widthBlocks: 30, heightBlocks: 20,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], skillTombs: [],
    transitions: [{
      direction: 'right', positionBlock: 8, openingSizeBlocks: 3,
      targetRoomId: '', targetSpawnBlock: [0, 0], xBlock: 27, yBlock: 8, gradientWidthBlocks: 3,
    }],
  });

  // ── Header "+ Add Room": showAddRoomDialog registers a blank room and
  // fires onRoomCreated -> persistCreatedCampaignRoom (store-backed, immediate).
  const addedRoomDef = roomJsonDefToRoomDef({
    id: 'vm_added', name: 'Added Room', worldNumber: 1, widthBlocks: 40, heightBlocks: 30,
    playerSpawnBlock: [20, 15], interiorWalls: [], enemies: [], skillTombs: [], transitions: [],
  });
  {
    const { data, nextUid: after } = roomDefToEditorRoomData(addedRoomDef, nextUid);
    nextUid = after;
    assert.equal(persistCreatedCampaignRoom(session, pendingRoomEdits, data), 'campaign-store');
  }
  // Immediately loadable — the core "double-click opens the new room" guarantee.
  const reloadedAdded = loadPersistedCampaignRoom(session, pendingRoomEdits, 'vm_added', 1);
  assert.equal(reloadedAdded?.source, 'campaign-store');
  assert.equal(reloadedAdded?.roomData.id, 'vm_added');

  // ── Double-click unlinked door -> "Create Linked Room": showCreateLinkedRoomDialog
  // registers a new linked room, links both transitions in ROOM_REGISTRY, then
  // fires onRoomCreated(newRoom) + onRoomTransitionLinked(sourceRoomId, ...).
  const linkedJsonTrans: RoomJsonTransition = {
    direction: 'left', positionBlock: 8, openingSizeBlocks: 3,
    targetRoomId: 'vm_start', targetSpawnBlock: [0, 0], xBlock: 0, yBlock: 8, gradientWidthBlocks: 3,
  };
  const linkedRoomDef = roomJsonDefToRoomDef({
    id: 'vm_linked', name: 'Linked Room', worldNumber: 1, widthBlocks: 40, heightBlocks: 30,
    playerSpawnBlock: [20, 15], interiorWalls: [], enemies: [], skillTombs: [],
    transitions: [linkedJsonTrans],
  });
  const sourceSpawn = testComputeSpawnBlockForMapLink(startRoomDef, startRoomDef.transitions[0]);
  const targetSpawn = testComputeSpawnBlockForMapLink(linkedRoomDef, linkedRoomDef.transitions[0]);
  testSetRoomTransitionLink(startRoomDef, 0, 'vm_linked', targetSpawn);
  testSetRoomTransitionLink(linkedRoomDef, 0, 'vm_start', sourceSpawn);

  // onRoomCreated(linkedRoomDef): setRoomTransitionLink mutates the RoomDef
  // instance stored in ROOM_REGISTRY in place, so the new room already
  // reflects the reciprocal link by the time it's persisted.
  {
    const { data, nextUid: after } = roomDefToEditorRoomData(linkedRoomDef, nextUid);
    nextUid = after;
    assert.equal(data.transitions[0]?.targetRoomId, 'vm_start');
    assert.equal(persistCreatedCampaignRoom(session, pendingRoomEdits, data), 'campaign-store');
  }
  // onRoomTransitionLinked('vm_start', 0, 'vm_linked', targetSpawn): vm_start
  // is an existing room that is not the currently-open editor room in this
  // scenario, so it's loaded, patched, and written straight back — the fix
  // for the previously-missing "source room" persistence half of the bug.
  {
    const loaded = loadPersistedCampaignRoom(session, pendingRoomEdits, 'vm_start', nextUid);
    assert.ok(loaded);
    const trans = loaded!.roomData.transitions[0];
    assert.ok(trans);
    trans!.targetRoomId = 'vm_linked';
    trans!.targetSpawnBlock = [targetSpawn[0], targetSpawn[1]];
    persistSavedCampaignRoom(session, pendingRoomEdits, loaded!.roomData);
  }

  // Both reciprocal links survive an immediate reload.
  const reloadedStart = loadPersistedCampaignRoom(session, pendingRoomEdits, 'vm_start', 1);
  assert.equal(reloadedStart?.roomData.transitions[0]?.targetRoomId, 'vm_linked');
  const reloadedLinked = loadPersistedCampaignRoom(session, pendingRoomEdits, 'vm_linked', 1);
  assert.equal(reloadedLinked?.roomData.transitions[0]?.targetRoomId, 'vm_start');

  // ── Authoritative export must contain exactly matching world-map / room
  // payload IDs, including both newly created rooms and the pre-existing
  // 'vm_start' room whose door was relinked — this is the exact scenario
  // that previously threw CampaignIntegrityError: world-map IDs without payloads.
  const registry = new Map([
    ['vm_start', { id: 'vm_start', name: 'vm_start', worldNumber: 1, mapX: 0, mapY: 0 }],
    ['vm_added', { id: 'vm_added', name: 'Added Room', worldNumber: 1, mapX: 40, mapY: 0 }],
    ['vm_linked', { id: 'vm_linked', name: 'Linked Room', worldNumber: 1, mapX: -40, mapY: 0 }],
  ]);
  const exported = buildAuthoritativeCampaignExport(
    session,
    registry,
    new Map([[1, 'World 1']]),
    new Map([[1, 0]]),
  );
  const exportedIds = new Set(exported.rooms.map(r => r.id));
  const mapIds = new Set(exported.worldMap.rooms.map(r => r.id));
  assert.deepEqual(exportedIds, mapIds);
  assert.ok(exportedIds.has('vm_added'));
  assert.ok(exportedIds.has('vm_linked'));
  assert.ok(exported.rooms.find(r => r.id === 'vm_start')?.transitions?.some(t => t.to === 'vm_linked'));
  assert.ok(exported.rooms.find(r => r.id === 'vm_linked')?.transitions?.some(t => t.to === 'vm_start'));

  const campaignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-visualmap-room-'));
  const roomIdFirstIndex = new Map(exported.rooms.map((room, index) => [room.id, index]));
  const result = await campaignExport.exportCampaignToDisk({
    campaign: exported, campaignMeta: exported.campaign, campaignId: exported.campaign.id,
    rooms: exported.rooms, roomIdFirstIndex, isOfficialCampaign: false, campaignDir,
  });
  assert.equal(result.ok, true);
  const packed = JSON.parse(
    fs.readFileSync(path.join(campaignDir, 'VM_TEST_CAMPAIGN.dwcampaign.json'), 'utf8'),
  ) as SavedCampaignV1;
  assert.ok(packed.rooms.some(r => r.id === 'vm_added'));
  assert.ok(packed.rooms.some(r => r.id === 'vm_linked'));
  assert.ok(packed.worldMap.rooms.some(r => r.id === 'vm_added'));
  assert.ok(packed.worldMap.rooms.some(r => r.id === 'vm_linked'));
});

test('official game owns and forwards one persistent campaign session', () => {
  const gameSource = fs.readFileSync(path.join(__dirname, '..', 'game.ts'), 'utf8');
  const screenSource = fs.readFileSync(path.join(__dirname, '..', 'screens', 'gameScreen.ts'), 'utf8');
  assert.match(gameSource, /const officialCampaignSession = createOfficialCampaignSession\(/);
  assert.match(gameSource, /\}, progress, officialCampaignSession, undefined, campaignSpawnOverride/);
  assert.match(screenSource, /createEditorController\([\s\S]*campaignSession \?\? null\)/);
});
