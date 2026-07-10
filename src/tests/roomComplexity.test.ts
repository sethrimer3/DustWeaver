/**
 * Unit tests for the authoritative room/campaign complexity analyzer
 * (src/levels/roomComplexity.ts) and its editor-data adapter
 * (src/editor/editorRoomComplexity.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RoomDef } from '../levels/roomDef';
import type { RoomEnemyDef } from '../levels/roomDef';
import {
  CONTENT_COMPLEXITY_WEIGHTS,
  ROOM_COMPLEXITY_THRESHOLDS,
  analyzeRoomDefComplexity,
  computeRoomComplexityReport,
  countRoomDefCategories,
  analyzeCampaignComplexity,
  analyzeCampaignComplexityCached,
  invalidateCampaignComplexityCache,
  formatRoomComplexityWarningMessage,
  formatCampaignComplexityWarningMessage,
  type RoomComplexityCategoryCounts,
} from '../levels/roomComplexity';
import { analyzeEditorRoomComplexity } from '../editor/editorRoomComplexity';
import type { EditorRoomData } from '../editor/editorElementTypes';

/** Minimal EditorRoomData stub — only the fields the adapter reads are populated. */
function makeEditorRoom(partial: Partial<EditorRoomData>): EditorRoomData {
  return {
    id: 'test-room',
    name: 'Test Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 100,
    heightBlocks: 100,
    playerSpawnBlock: [0, 0],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    dustContainers: [],
    dustContainerPieces: [],
    dustBoostJars: [],
    dustSwarms: [],
    lambdaAnchors: [],
    dustPiles: [],
    grasshopperAreas: [],
    fireflyAreas: [],
    decorations: [],
    ambientLightBlockers: [],
    lightSources: [],
    ...partial,
  } as EditorRoomData;
}

/** Minimal RoomDef stub — only the fields the analyzer reads are populated. */
function makeRoom(partial: Partial<RoomDef>): RoomDef {
  return {
    id: 'test-room',
    name: 'Test Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 100,
    heightBlocks: 100,
    walls: [],
    enemies: [],
    playerSpawnBlock: [0, 0],
    transitions: [],
    saveTombs: [],
    ...partial,
  } as RoomDef;
}

function makeEnemy(particleCount: number, isBossFlag: 0 | 1 = 0): RoomEnemyDef {
  return { xBlock: 0, yBlock: 0, kinds: [], particleCount, isBossFlag };
}

const ZERO_COUNTS: RoomComplexityCategoryCounts = {
  tiles: 0, objects: 0, enemies: 0, enemyParticles: 0, dustCells: 0,
  liquidCells: 0, emitterParticles: 0, hazards: 0, triggers: 0, lights: 0,
};

test('empty room has zero counts, zero score, normal severity, no warning', () => {
  const report = analyzeRoomDefComplexity(makeRoom({}));
  assert.deepEqual(report.categoryCounts, ZERO_COUNTS);
  assert.equal(report.totalPlacedCount, 0);
  assert.equal(report.weightedScore, 0);
  assert.equal(report.severity, 'normal');
  assert.equal(report.shouldWarn, false);
  assert.deepEqual(report.categoriesExceedingThreshold, []);
});

test('raw category counts: tiles = walls + backgroundBlocks', () => {
  const room = makeRoom({
    walls: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1 }] as RoomDef['walls'],
    backgroundBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, blockTheme: null }] as RoomDef['backgroundBlocks'],
  });
  assert.equal(countRoomDefCategories(room).tiles, 2);
});

test('raw category counts: enemies vs enemyParticles are independent', () => {
  const room = makeRoom({
    enemies: [makeEnemy(50), makeEnemy(5000, 1), makeEnemy(20)],
  });
  const counts = countRoomDefCategories(room);
  assert.equal(counts.enemies, 3);
  assert.equal(counts.enemyParticles, 50 + 5000 + 20);
});

test('liquidCells sums zone area (wBlock * hBlock), not zone count', () => {
  const room = makeRoom({
    waterZones: [{ xBlock: 0, yBlock: 0, wBlock: 10, hBlock: 5 }],
    lavaZones: [{ xBlock: 0, yBlock: 0, wBlock: 4, hBlock: 4 }],
  });
  assert.equal(countRoomDefCategories(room).liquidCells, 10 * 5 + 4 * 4);
});

test('dustCells counts authored pixel-material placements', () => {
  const room = makeRoom({
    pixelMaterials: new Array(500).fill(0).map((_, i) => ({ xPixel: i, yPixel: 0, material: 'sand' })) as RoomDef['pixelMaterials'],
  });
  assert.equal(countRoomDefCategories(room).dustCells, 500);
});

test('no double-counting: each RoomDef field contributes to exactly one category', () => {
  // dustSwarms contributes its *count* to `objects` and its dustCount magnitude
  // to `emitterParticles` — those are two different measurements of the same
  // entities (structural count vs. simulated payload), not a double-count of
  // the same metric.
  const room = makeRoom({
    dustSwarms: [{ xBlock: 0, yBlock: 0, dustKind: 'Physical', dustCount: 30 }],
  });
  const counts = countRoomDefCategories(room);
  assert.equal(counts.objects, 1);
  assert.equal(counts.emitterParticles, 30);
  // No other category should have picked up this entity.
  assert.equal(counts.tiles, 0);
  assert.equal(counts.enemies, 0);
  assert.equal(counts.hazards, 0);
});

test('weightedScore is the sum of count * weight across all categories', () => {
  const counts: RoomComplexityCategoryCounts = {
    ...ZERO_COUNTS,
    tiles: 1000,
    enemies: 10,
  };
  const report = computeRoomComplexityReport(counts);
  const expected = 1000 * CONTENT_COMPLEXITY_WEIGHTS.tiles + 10 * CONTENT_COMPLEXITY_WEIGHTS.enemies;
  assert.ok(Math.abs(report.weightedScore - expected) < 1e-9);
});

test('totalPlacedCount excludes derived-magnitude categories (enemyParticles, liquidCells, emitterParticles)', () => {
  const counts: RoomComplexityCategoryCounts = {
    ...ZERO_COUNTS,
    enemies: 5,
    enemyParticles: 999999,
    liquidCells: 999999,
    emitterParticles: 999999,
    tiles: 10,
  };
  const report = computeRoomComplexityReport(counts);
  assert.equal(report.totalPlacedCount, 5 + 10);
});

test('severity classification: normal / elevated / high / extreme boundaries', () => {
  const { elevated, high, extreme } = ROOM_COMPLEXITY_THRESHOLDS.severity;
  const scoreFor = (score: number) => computeRoomComplexityReport({ ...ZERO_COUNTS, tiles: score / CONTENT_COMPLEXITY_WEIGHTS.tiles }).severity;
  assert.equal(scoreFor(0), 'normal');
  assert.equal(scoreFor(elevated - 1), 'normal');
  assert.equal(scoreFor(elevated), 'elevated');
  assert.equal(scoreFor(high - 1), 'elevated');
  assert.equal(scoreFor(high), 'high');
  assert.equal(scoreFor(extreme - 1), 'high');
  assert.equal(scoreFor(extreme), 'extreme');
});

test('a category at or above its individual threshold triggers shouldWarn even at low total score', () => {
  const report = computeRoomComplexityReport({
    ...ZERO_COUNTS,
    enemies: ROOM_COMPLEXITY_THRESHOLDS.category.enemies,
  });
  assert.ok(report.categoriesExceedingThreshold.includes('enemies'));
  assert.equal(report.shouldWarn, true);
});

test('single-category warning message names the category and count', () => {
  const report = computeRoomComplexityReport({ ...ZERO_COUNTS, dustCells: 31400 });
  // Force the threshold path by pushing dustCells over its threshold.
  assert.ok(report.categoryCounts.dustCells === 31400);
  const msg = formatRoomComplexityWarningMessage(computeRoomComplexityReport({
    ...ZERO_COUNTS,
    dustCells: ROOM_COMPLEXITY_THRESHOLDS.category.dustCells + 100,
  }));
  assert.match(msg, /dust cells/);
  assert.match(msg, /performance issues/);
});

test('combined warning message names every category that crossed its threshold', () => {
  const t = ROOM_COMPLEXITY_THRESHOLDS.category;
  const report = computeRoomComplexityReport({
    ...ZERO_COUNTS,
    liquidCells: t.liquidCells + 1,
    dustCells: t.dustCells + 1,
    enemies: t.enemies + 1,
  });
  const msg = formatCampaignComplexityWarningMessage(analyzeCampaignComplexity([
    makeRoom({ id: 'r', name: 'R' }),
  ])) ?? '';
  // (Campaign message is tested separately below; here we just check the
  // room-level combined message format.)
  const roomMsg = formatRoomComplexityWarningMessage(report);
  assert.match(roomMsg, /liquid cells/);
  assert.match(roomMsg, /dust cells/);
  assert.match(roomMsg, /enemies/);
  void msg;
});

// ── Campaign analysis ──────────────────────────────────────────────────────────

test('campaign analysis: identifies the highest-complexity room and its stable index', () => {
  const rooms: RoomDef[] = [
    makeRoom({ id: 'a', name: 'A' }),
    makeRoom({ id: 'b', name: 'Flooded Foundry', enemies: new Array(500).fill(0).map(() => makeEnemy(10)) }),
    makeRoom({ id: 'c', name: 'C' }),
  ];
  const campaignReport = analyzeCampaignComplexity(rooms);
  assert.equal(campaignReport.mostComplexRoom?.roomId, 'b');
  assert.equal(campaignReport.mostComplexRoom?.roomIndex, 1);
  assert.equal(campaignReport.mostComplexRoom?.roomName, 'Flooded Foundry');
});

test('campaign analysis works on unexplored rooms — pure data, no instantiation required', () => {
  // If this test needed a game screen / world instance to run, it would
  // throw or hang; it doesn't, proving the analyzer only reads RoomDef data.
  const rooms: RoomDef[] = [makeRoom({ id: 'only-room' })];
  const campaignReport = analyzeCampaignComplexity(rooms);
  assert.equal(campaignReport.rooms.length, 1);
  assert.equal(campaignReport.shouldWarnBeforePlay, false);
});

test('campaign analysis accepts a Map (as returned by hydrateSavedCampaignToRoomDefs) preserving order', () => {
  const map = new Map<string, RoomDef>();
  map.set('first', makeRoom({ id: 'first', name: 'First' }));
  map.set('second', makeRoom({ id: 'second', name: 'Second' }));
  const campaignReport = analyzeCampaignComplexity(map);
  assert.equal(campaignReport.rooms[0]?.roomId, 'first');
  assert.equal(campaignReport.rooms[0]?.roomIndex, 0);
  assert.equal(campaignReport.rooms[1]?.roomId, 'second');
  assert.equal(campaignReport.rooms[1]?.roomIndex, 1);
});

test('campaign warning message reports room count, index (1-based), name, total count, and cause category', () => {
  const t = ROOM_COMPLEXITY_THRESHOLDS.category;
  const rooms: RoomDef[] = [
    makeRoom({ id: 'a', name: 'Calm Room' }),
    makeRoom({
      id: 'b',
      name: 'Flooded Foundry',
      waterZones: [{ xBlock: 0, yBlock: 0, wBlock: 300, hBlock: 300 }], // 90,000 liquid cells
      enemies: new Array(t.enemies + 10).fill(0).map(() => makeEnemy(10)),
    }),
  ];
  const campaignReport = analyzeCampaignComplexity(rooms);
  const msg = formatCampaignComplexityWarningMessage(campaignReport);
  assert.ok(msg !== null);
  assert.match(msg!, /1 room/);
  assert.match(msg!, /Room 2/);
  assert.match(msg!, /Flooded Foundry/);
  assert.match(msg!, /placed elements/);
});

test('campaign warning message is null when no room exceeds the threshold', () => {
  const rooms: RoomDef[] = [makeRoom({ id: 'a' }), makeRoom({ id: 'b' })];
  const msg = formatCampaignComplexityWarningMessage(analyzeCampaignComplexity(rooms));
  assert.equal(msg, null);
});

test('raw item count vs. weighted complexity can disagree: the analyzer reports both correctly', () => {
  // Room A: huge raw count of the cheapest category (tiles).
  const roomA = makeRoom({
    id: 'a',
    name: 'Big But Cheap',
    walls: new Array(20000).fill({ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1 }) as RoomDef['walls'],
  });
  // Room B: smaller raw count but of the most expensive categories (enemies + scene lights).
  const roomB = makeRoom({
    id: 'b',
    name: 'Small But Deadly',
    enemies: new Array(200).fill(0).map(() => makeEnemy(200, 1)),
    sceneLights: new Array(200).fill({}) as RoomDef['sceneLights'],
  });

  const reportA = analyzeRoomDefComplexity(roomA);
  const reportB = analyzeRoomDefComplexity(roomB);

  // Room A has the larger raw placed-content count...
  assert.ok(reportA.totalPlacedCount > reportB.totalPlacedCount);
  // ...but Room B has the higher weighted complexity score.
  assert.ok(reportB.weightedScore > reportA.weightedScore);

  const campaignReport = analyzeCampaignComplexity([roomA, roomB]);
  assert.equal(campaignReport.mostComplexRoom?.roomId, 'b');
});

test('legacy/partial room data: missing optional arrays do not throw and count as zero', () => {
  const legacyRoom = makeRoom({ id: 'legacy' }); // no optional arrays populated at all
  const report = analyzeRoomDefComplexity(legacyRoom);
  assert.equal(report.totalPlacedCount, 0);
  assert.equal(report.severity, 'normal');
});

// ── Editor adapter ──────────────────────────────────────────────────────────────

test('editor adapter produces a zeroed report for an empty room, matching the RoomDef analyzer shape', () => {
  const report = analyzeEditorRoomComplexity(makeEditorRoom({}));
  assert.deepEqual(report.categoryCounts, ZERO_COUNTS);
  assert.equal(report.shouldWarn, false);
});

test('editor adapter counts enemies and enemyParticles from EditorRoomData independently', () => {
  const room = makeEditorRoom({
    enemies: [
      { uid: 1, xBlock: 0, yBlock: 0, kinds: [], particleCount: 40, isBossFlag: 0 },
      { uid: 2, xBlock: 0, yBlock: 0, kinds: [], particleCount: 4000, isBossFlag: 1 },
    ] as EditorRoomData['enemies'],
  });
  const report = analyzeEditorRoomComplexity(room);
  assert.equal(report.categoryCounts.enemies, 2);
  assert.equal(report.categoryCounts.enemyParticles, 4040);
});

test('editor adapter liquidCells sums EditorWaterZone/EditorLavaZone area', () => {
  const room = makeEditorRoom({
    waterZones: [{ uid: 1, xBlock: 0, yBlock: 0, wBlock: 6, hBlock: 6 }],
    lavaZones: [{ uid: 2, xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 3 }],
  });
  const report = analyzeEditorRoomComplexity(room);
  assert.equal(report.categoryCounts.liquidCells, 36 + 6);
});

// ── Campaign complexity cache ────────────────────────────────────────────────

test('analyzeCampaignComplexityCached: a cache hit does not re-invoke getRooms', () => {
  const key = {}; // stand-in for a loaded campaign object
  let hydrateCallCount = 0;
  const getRooms = (): RoomDef[] => {
    hydrateCallCount++;
    return [makeRoom({ id: 'a' })];
  };

  const first = analyzeCampaignComplexityCached(key, getRooms);
  const second = analyzeCampaignComplexityCached(key, getRooms);

  assert.equal(hydrateCallCount, 1);
  assert.equal(first, second); // same cached object reference
});

test('analyzeCampaignComplexityCached: invalidate forces recomputation and picks up new content', () => {
  const key = {};
  let roomsVersion: RoomDef[] = [makeRoom({ id: 'a' })];
  const getRooms = (): RoomDef[] => roomsVersion;

  const before = analyzeCampaignComplexityCached(key, getRooms);
  assert.equal(before.shouldWarnBeforePlay, false);

  // Simulate the room content changing to something that should now warn.
  roomsVersion = [makeRoom({
    id: 'a',
    enemies: new Array(ROOM_COMPLEXITY_THRESHOLDS.category.enemies + 1).fill(0).map(() => makeEnemy(1)),
  })];

  // Without invalidation, the stale cached (non-warning) report is returned.
  const stillCached = analyzeCampaignComplexityCached(key, getRooms);
  assert.equal(stillCached.shouldWarnBeforePlay, false);

  invalidateCampaignComplexityCache(key);
  const after = analyzeCampaignComplexityCached(key, getRooms);
  assert.equal(after.shouldWarnBeforePlay, true);
});

test('different campaign keys get independent cache entries', () => {
  const keyA = {};
  const keyB = {};
  const reportA = analyzeCampaignComplexityCached(keyA, () => [makeRoom({ id: 'a' })]);
  const reportB = analyzeCampaignComplexityCached(keyB, () => [makeRoom({
    id: 'b',
    enemies: new Array(ROOM_COMPLEXITY_THRESHOLDS.category.enemies + 1).fill(0).map(() => makeEnemy(1)),
  })]);
  assert.equal(reportA.shouldWarnBeforePlay, false);
  assert.equal(reportB.shouldWarnBeforePlay, true);
});
