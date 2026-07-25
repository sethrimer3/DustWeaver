/**
 * Tests for electron/campaignExport.cjs — the pure (no-Electron-dependency)
 * helpers behind the 'dw:save-official-campaign' and
 * 'dw:export-campaign-with-progress' IPC handlers.
 *
 * These are plain Node tests (no Electron runtime needed) because the write
 * logic was extracted into campaignExport.cjs specifically so it could be
 * exercised without spinning up an Electron process.
 *
 * Covers:
 *   1. A room write failure fails the whole export (no manifest/complete).
 *   2. A manifest write failure fails the whole export.
 *   3. Hash match + missing room file forces a rewrite instead of a skip.
 *   4. Post-export validation catches a room file that went missing after write.
 *   5. Rolling backups are pruned to MAX_BACKUPS after repeated exports.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import campaignExportModule from '../../electron/campaignExport.cjs';

type TestRoom = {
  id: string;
  name: string;
  transitions: Array<{ to?: string }>;
};

type TestCampaign = {
  v: number;
  kind: string;
  campaign: { id: string; title: string };
  metadata: { version: number };
  worldMap: { rooms: Array<{ id: string }> };
  rooms: TestRoom[];
};

type CampaignProgressEvent = {
  step: string;
  message?: string;
  roomIndex?: number;
  totalRooms?: number;
  roomId?: string;
};

type ExportCampaignArgs = {
  campaign: TestCampaign;
  campaignMeta: TestCampaign['campaign'];
  campaignId: string;
  rooms: TestRoom[];
  roomIdFirstIndex: Map<string, number>;
  isOfficialCampaign: boolean;
  campaignDir: string;
  onProgress?: (event: CampaignProgressEvent) => void;
};

type ExportCampaignResult =
  | { ok: true; campaignDir: string; writtenRooms: number; skippedRooms: number; removedCount: number }
  | { ok: false; error: string };

type RoomCacheValidationResult =
  | { ok: true }
  | { ok: false; error: string };

type CampaignExportModule = {
  exportCampaignToDisk(args: ExportCampaignArgs): Promise<ExportCampaignResult>;
  validateRoomCacheOnDisk(
    roomsDir: string,
    manifest: Record<string, unknown>,
    expectedRoomIds?: string[],
  ): RoomCacheValidationResult;
  MAX_BACKUPS: number;
};

const campaignExport = campaignExportModule as CampaignExportModule;
const { exportCampaignToDisk, validateRoomCacheOnDisk, MAX_BACKUPS } = campaignExport;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dw-campaign-export-test-'));
}

function makeCampaign(roomIds: string[]): TestCampaign {
  return {
    v: 1,
    kind: 'DustWeaverCampaign',
    campaign: { id: 'TEST_CAMPAIGN', title: 'Test Campaign' },
    metadata: { version: 1 },
    worldMap: { rooms: roomIds.map((id) => ({ id })) },
    rooms: roomIds.map((id) => ({ id, name: id, transitions: [] })),
  };
}

function roomIdFirstIndexFor(campaign: ReturnType<typeof makeCampaign>): Map<string, number> {
  const m = new Map<string, number>();
  campaign.rooms.forEach((r, i) => m.set(r.id, i));
  return m;
}

function baseArgs(campaignDir: string, roomIds: string[]) {
  const campaign = makeCampaign(roomIds);
  return {
    campaign,
    campaignMeta: campaign.campaign,
    campaignId: campaign.campaign.id,
    rooms: campaign.rooms,
    roomIdFirstIndex: roomIdFirstIndexFor(campaign),
    isOfficialCampaign: false,
    campaignDir,
  };
}

test('room write failure fails the whole export', async () => {
  const campaignDir = makeTmpDir();
  const roomsDir = path.join(campaignDir, 'ROOMS');
  fs.mkdirSync(roomsDir, { recursive: true });

  // Make the target room file path a directory so writing to it fails.
  fs.mkdirSync(path.join(roomsDir, 'roomA_room.json'));

  const events: CampaignProgressEvent[] = [];
  const result = await exportCampaignToDisk({
    ...baseArgs(campaignDir, ['roomA']),
    onProgress: (e) => events.push(e),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /roomA/);
  assert.ok(!events.some((e) => e.step === 'complete'), 'must never send complete on failure');
  assert.ok(events.some((e) => e.step === 'error'), 'must send an error progress event');
  // Manifest must not have been written since the room write failed first.
  assert.equal(fs.existsSync(path.join(roomsDir, 'manifest.json')), false);
});

test('manifest write failure fails the whole export', async () => {
  const campaignDir = makeTmpDir();
  const roomsDir = path.join(campaignDir, 'ROOMS');
  fs.mkdirSync(roomsDir, { recursive: true });

  // Make manifest.json a directory so the atomic write fails.
  fs.mkdirSync(path.join(roomsDir, 'manifest.json'));

  const events: CampaignProgressEvent[] = [];
  const result = await exportCampaignToDisk({
    ...baseArgs(campaignDir, ['roomA']),
    onProgress: (e) => events.push(e),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /manifest/i);
  assert.ok(!events.some((e) => e.step === 'complete'));
});

test('hash match with a missing room file forces a rewrite instead of a skip', async () => {
  const campaignDir = makeTmpDir();

  // First export writes roomA normally.
  const first = await exportCampaignToDisk(baseArgs(campaignDir, ['roomA']));
  assert.equal(first.ok, true);
  assert.equal(first.writtenRooms, 1);

  const roomsDir = path.join(campaignDir, 'ROOMS');
  const roomPath = path.join(roomsDir, 'roomA_room.json');
  assert.ok(fs.existsSync(roomPath));

  // Delete the room file on disk but leave the manifest (with matching hash) intact.
  fs.unlinkSync(roomPath);

  const second = await exportCampaignToDisk(baseArgs(campaignDir, ['roomA']));
  assert.equal(second.ok, true);
  // Because the file was missing, it must be rewritten, not skipped.
  assert.equal(second.writtenRooms, 1);
  assert.equal(second.skippedRooms, 0);
  assert.ok(fs.existsSync(roomPath));
});

test('validateRoomCacheOnDisk catches a missing room file', () => {
  const roomsDir = makeTmpDir();
  const manifest = {
    campaignId: 'TEST_CAMPAIGN',
    rooms: {
      roomA: { roomId: 'roomA', file: 'roomA_room.json', hash: 'abc', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
  };
  const result = validateRoomCacheOnDisk(roomsDir, manifest);
  assert.equal(result.ok, false);
  assert.match(result.error, /missing file/);
});

test('validateRoomCacheOnDisk catches a room missing from the manifest', () => {
  const roomsDir = makeTmpDir();
  const manifest = { campaignId: 'TEST_CAMPAIGN', rooms: {} };
  const result = validateRoomCacheOnDisk(roomsDir, manifest, ['roomA']);
  assert.equal(result.ok, false);
  assert.match(result.error, /no manifest entry/);
});

test('validateRoomCacheOnDisk rejects a file path that escapes ROOMS/', () => {
  const roomsDir = makeTmpDir();
  const manifest = {
    campaignId: 'TEST_CAMPAIGN',
    rooms: {
      roomA: { roomId: 'roomA', file: '../escape.json', hash: 'abc', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
  };
  const result = validateRoomCacheOnDisk(roomsDir, manifest);
  assert.equal(result.ok, false);
  assert.match(result.error, /escapes ROOMS directory/);
});

test('Crimson Throne room (boss enemy + dialogue triggers) writes and hashes normally', async () => {
  // Regression test for the "export stuck at room 19/20: Crimson Throne"
  // report. The room's boss enemy object and dialogueTriggers data were
  // suspected (but not confirmed) as the cause — this exercises the real
  // room file through the actual write path to confirm it serializes,
  // hashes, and writes like any other room.
  const roomPath = path.join(
    __dirname, '..', '..', 'ASSETS', 'CAMPAIGNS', 'DUSTWEAVER_CAMPAIGN', 'ROOMS', 'crimson_throne_room.json',
  );
  const crimsonThroneRoom = JSON.parse(fs.readFileSync(roomPath, 'utf8')) as TestRoom & Record<string, unknown>;
  assert.ok('enemies' in crimsonThroneRoom, 'fixture must still contain the boss enemy data');
  assert.ok('dialogueTriggers' in crimsonThroneRoom, 'fixture must still contain dialogue trigger data');

  const campaignDir = makeTmpDir();
  const otherRooms: TestRoom[] = Array.from({ length: 19 }, (_, i) => ({
    id: `room${i}`,
    name: `room${i}`,
    transitions: [],
  }));
  const rooms = [...otherRooms, crimsonThroneRoom as unknown as TestRoom];

  const campaign: TestCampaign = {
    v: 1,
    kind: 'DustWeaverCampaign',
    campaign: { id: 'TEST_CAMPAIGN', title: 'Test Campaign' },
    metadata: { version: 1 },
    worldMap: { rooms: rooms.map((room) => ({ id: room.id })) },
    rooms,
  };

  const events: CampaignProgressEvent[] = [];
  const result = await exportCampaignToDisk({
    campaign,
    campaignMeta: campaign.campaign,
    campaignId: campaign.campaign.id,
    rooms,
    roomIdFirstIndex: roomIdFirstIndexFor(campaign as unknown as ReturnType<typeof makeCampaign>),
    isOfficialCampaign: false,
    campaignDir,
    onProgress: (e) => events.push(e),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.writtenRooms, 20);
  }
  assert.ok(
    events.some((e) => e.step === 'exporting-room' && e.roomId === 'crimson_throne' && e.roomIndex === 20),
    'crimson_throne must be reported as room 20/20, not stuck at 19/20',
  );
  // The 'complete' event itself is sent by the IPC handler after
  // exportCampaignToDisk() returns (see electron/main.cjs), not by
  // exportCampaignToDisk() itself — so it's not expected in `events` here.
  // What matters is that exportCampaignToDisk() resolves ok:true, which the
  // handler uses to unconditionally send 'complete'.

  const writtenPath = path.join(campaignDir, 'ROOMS', 'crimson_throne_room.json');
  assert.ok(fs.existsSync(writtenPath));
  const written = JSON.parse(fs.readFileSync(writtenPath, 'utf8')) as Record<string, unknown>;
  assert.ok('enemies' in written, 'boss enemy data must survive the write');
  assert.ok('dialogueTriggers' in written, 'dialogue trigger data must survive the write');
});

test('rolling backups are pruned to MAX_BACKUPS after repeated exports', async () => {
  const campaignDir = makeTmpDir();

  // Export MAX_BACKUPS + 3 times with slightly different content each time so
  // each export overwrites the previous packed file (triggering a backup).
  for (let i = 0; i < MAX_BACKUPS + 3; i++) {
    const result = await exportCampaignToDisk(baseArgs(campaignDir, [`room${i}`]));
    assert.equal(result.ok, true, `export ${i} should succeed`);
  }

  const backupsDir = path.join(campaignDir, 'BACKUPS');
  const backups = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.dwcampaign.json'));
  assert.equal(backups.length, MAX_BACKUPS);
});

test('export refuses a world-map room without a payload before writing anything', async () => {
  const campaignDir = makeTmpDir();
  const roomsDir = path.join(campaignDir, 'ROOMS');
  fs.mkdirSync(roomsDir, { recursive: true });
  const protectedPath = path.join(roomsDir, 'unrecovered_room.json');
  fs.writeFileSync(protectedPath, '{"id":"unrecovered","body":"recover me"}');

  const args = baseArgs(campaignDir, ['roomA']);
  args.campaign.worldMap.rooms.push({ id: 'unrecovered' });
  const result = await exportCampaignToDisk(args);

  assert.equal(result.ok, false);
  assert.match(result.error, /world-map IDs without payloads: unrecovered/);
  assert.equal(fs.readFileSync(protectedPath, 'utf8'), '{"id":"unrecovered","body":"recover me"}');
  assert.equal(fs.existsSync(path.join(campaignDir, 'TEST_CAMPAIGN.dwcampaign.json')), false);
  assert.equal(fs.existsSync(path.join(roomsDir, 'manifest.json')), false);
});

test('export refuses duplicate room IDs before writing anything', async () => {
  const campaignDir = makeTmpDir();
  const campaign = makeCampaign(['roomA', 'roomA']);
  const result = await exportCampaignToDisk({
    ...baseArgs(campaignDir, ['roomA']),
    campaign,
    rooms: campaign.rooms,
    roomIdFirstIndex: new Map([['roomA', 0]]),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Duplicate room id "roomA"/);
  assert.equal(fs.readdirSync(campaignDir).length, 0);
});
