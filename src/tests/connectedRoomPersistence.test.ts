import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import campaignExport from '../../electron/campaignExport.cjs';
import { createCampaignStore } from '../editor/campaignStore';
import { editorRoomDataToJson } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { SavedCampaignV1 } from '../levels/campaignSchema';

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

test('created connected room survives edit, playtest close, reopen, export, cache, and reload', async () => {
  const start = editorRoom('start');
  const campaign = {
    v: 1, kind: 'DustWeaverCampaign',
    campaign: { id: 'TEST_CAMPAIGN', title: 'Test', initialRoomId: 'start' },
    metadata: { version: 1 },
    worldMap: {
      worlds: [{ id: 1, name: 'World 1', order: 0 }],
      rooms: [{ id: 'start', name: 'start', worldId: 1, mapX: 0, mapY: 0 }],
    },
    rooms: [dehydrateRoom(editorRoomDataToJson(start))],
  } as SavedCampaignV1;
  const store = createCampaignStore(campaign);

  const connected = editorRoom('connected');
  connected.interiorWalls.push({ uid: 10, xBlock: 5, yBlock: 6, wBlock: 2, hBlock: 1 } as never);
  connected.transitions.push({
    uid: 11, direction: 'left', xBlock: 0, yBlock: 8, openingSizeBlocks: 3,
    targetRoomId: 'start', targetSpawnBlock: [28, 8], positionBlock: 8,
  } as never);
  start.transitions.push({
    uid: 12, direction: 'right', xBlock: 29, yBlock: 8, openingSizeBlocks: 3,
    targetRoomId: 'connected', targetSpawnBlock: [1, 8], positionBlock: 8,
  } as never);

  store.updateWorldMap({
    worlds: [{ id: 1, name: 'World 1', order: 0 }],
    rooms: [
      { id: 'start', name: 'start', worldId: 1, mapX: 0, mapY: 0 },
      { id: 'connected', name: 'connected', worldId: 1, mapX: 1, mapY: 0 },
    ],
  });
  store.commitRoom('connected', connected);
  store.markRoomDirty('start', start);
  store.commitActiveRoom(start);

  const exported = store.buildExportCampaign(campaign);
  const campaignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-connected-room-'));
  const roomIdFirstIndex = new Map(exported.rooms.map((room, index) => [room.id, index]));
  const result = await campaignExport.exportCampaignToDisk({
    campaign: exported, campaignMeta: exported.campaign, campaignId: exported.campaign.id,
    rooms: exported.rooms, roomIdFirstIndex, isOfficialCampaign: false, campaignDir,
  });
  assert.equal(result.ok, true);

  const packed = JSON.parse(fs.readFileSync(path.join(campaignDir, 'TEST_CAMPAIGN.dwcampaign.json'), 'utf8')) as SavedCampaignV1;
  const reopenedStore = createCampaignStore(packed);
  const reopened = reopenedStore.getRoom('connected', 1).roomData;
  assert.equal(reopened.interiorWalls.length, 1);
  assert.equal(reopened.transitions[0]?.targetRoomId, 'start');
  assert.ok(packed.worldMap.rooms.some(room => room.id === 'connected'));
  assert.ok(packed.rooms.find(room => room.id === 'start')?.transitions?.some(t => t.to === 'connected'));
  assert.ok(fs.existsSync(path.join(campaignDir, 'ROOMS', 'connected_room.json')));
});
