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

test('official game owns and forwards one persistent campaign session', () => {
  const gameSource = fs.readFileSync(path.join(__dirname, '..', 'game.ts'), 'utf8');
  const screenSource = fs.readFileSync(path.join(__dirname, '..', 'screens', 'gameScreen.ts'), 'utf8');
  assert.match(gameSource, /const officialCampaignSession = createOfficialCampaignSession\(/);
  assert.match(gameSource, /\}, progress, officialCampaignSession, undefined, campaignSpawnOverride/);
  assert.match(screenSource, /createEditorController\([\s\S]*campaignSession \?\? null\)/);
});
