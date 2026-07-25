import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import campaignExport from '../electron/campaignExport.cjs';

const root = process.cwd();
const campaignDir = path.join(root, 'ASSETS', 'CAMPAIGNS', 'DUSTWEAVER_CAMPAIGN');
const packedPath = path.join(campaignDir, 'DustweaverCampaign.dwcampaign.json');
const roomsDir = path.join(campaignDir, 'ROOMS');
const sourceCommit = 'e9398bc0d941b4459b5ba70f8c9ba169cfdf1dbc';
const sourcePath = 'ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json';
const skatingBackup = path.join(
  campaignDir,
  'BACKUPS',
  'DustweaverCampaign_2026-07-25T01-59-10.834Z.dwcampaign.json',
);

const current = JSON.parse(fs.readFileSync(packedPath, 'utf8'));
const historical = JSON.parse(execFileSync('git', ['show', `${sourceCommit}:${sourcePath}`], { encoding: 'utf8' }));
const skatingSource = JSON.parse(fs.readFileSync(skatingBackup, 'utf8'));
const requested = new Map([
  ['ice_hall', historical.rooms.find(room => room.id === 'ice_hall')],
  ['the_icicle', historical.rooms.find(room => room.id === 'the_icicle')],
  ['skating', skatingSource.rooms.find(room => room.id === 'skating')],
]);

for (const [id, room] of requested) {
  if (!room) throw new Error(`Recovery source did not contain complete room payload "${id}"`);
  if (current.rooms.some(existing => existing.id === id)) {
    throw new Error(`Refusing to overwrite existing canonical room payload "${id}"`);
  }
  current.rooms.push(room);
}

const seen = new Set();
for (const room of current.rooms) {
  if (seen.has(room.id)) throw new Error(`Duplicate recovered room ID "${room.id}"`);
  seen.add(room.id);
}

campaignExport.writeJsonAtomic(packedPath, current);
fs.mkdirSync(roomsDir, { recursive: true });
const nowIso = new Date().toISOString();
const manifestRooms = {};
for (const room of current.rooms) {
  const filename = `${room.id}_room.json`;
  campaignExport.writeJsonAtomic(path.join(roomsDir, filename), room);
  manifestRooms[room.id] = {
    roomId: room.id,
    file: filename,
    hash: campaignExport.computeContentHash(room),
    updatedAt: nowIso,
  };
}
const knownRoomIds = new Set(current.rooms.map(room => room.id));
const manifest = {
  campaignId: current.campaign.id,
  campaignName: current.campaign.title || current.campaign.id,
  campaignHash: campaignExport.computeCampaignHash(current),
  campaignVersion: current.metadata?.version || 0,
  campaignSchemaVersion: current.v,
  roomCacheVersion: campaignExport.ROOM_CACHE_VERSION,
  exportedAt: nowIso,
  rooms: manifestRooms,
  adjacency: campaignExport.buildManifestAdjacency(current.rooms, knownRoomIds),
};
campaignExport.writeJsonAtomic(path.join(roomsDir, 'manifest.json'), manifest);

const cacheValidation = campaignExport.validateRoomCacheOnDisk(
  roomsDir,
  manifest,
  current.rooms.map(room => room.id),
);
if (!cacheValidation.ok) throw new Error(cacheValidation.error);
console.log(`Recovered ${[...requested.keys()].join(', ')}; canonical/cache room count=${current.rooms.length}`);
