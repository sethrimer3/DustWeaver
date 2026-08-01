import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ZoneResidentLoader } from '../screens/zoneResidentLoader';
import { ResidentRoomManager } from '../screens/residentRoomManager';
import { RoomRuntimeCache } from '../screens/roomRuntimeCache';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { buildRoomWallTemplate, type RoomWallTemplate } from '../screens/gameRoomWalls';

function room(id: string, worldNumber = 1): RoomDef {
  return {
    id,
    wBlock: 40,
    hBlock: 24,
    worldNumber,
    transitions: [],
    customBlocks: [],
    exactWalls: [],
    specialWalls: [],
    pixelMaterials: [],
    physicsMaterials: [],
    tombBooks: [],
    backgroundBlocks: [],
    wallDecorations: [],
    backgroundStyle: 0,
    sprites: [],
  } as unknown as RoomDef;
}

/** Minimal but structurally complete RoomDef, valid for the full readiness path. */
function fullRoom(id: string, worldNumber: number, transitions: RoomTransitionDef[]): RoomDef {
  return {
    id,
    name: id,
    worldNumber,
    mapX: 0,
    mapY: 0,
    widthBlocks: 40,
    heightBlocks: 24,
    walls: [],
    enemies: [],
    playerSpawnBlock: [1, 1],
    transitions,
    saveTombs: [],
    backgroundBlocks: [],
    wallDecorations: [],
    sprites: [],
  } as unknown as RoomDef;
}

describe('ZoneResidentLoader', () => {
  test('Reaching the displayed room count resolves the authoritative readiness barrier', () => {
    const room1 = room('room1', 1);
    const room2 = room('room2', 1);

    const registry = new Map<string, RoomDef>([
      ['room1', room1],
      ['room2', room2],
    ]);
    const runtimeCache = new RoomRuntimeCache(1); // Capacity 1 to force eviction if unpinned
    const loader = new ZoneResidentLoader(registry, runtimeCache);
    const residentRoomManager = new ResidentRoomManager();

    loader.startZoneLoad(1, residentRoomManager);
    
    // Simulate generator completion for both rooms
    residentRoomManager.ensureResident(room1);
    residentRoomManager.getResident('room1')!.runtimeReady = true;
    runtimeCache.set('room1', { renderRevision: 1, wallTemplate: null as unknown as RoomWallTemplate, edgeExtension: null, blockerKeys: new Set(), darkBlockerKeys: new Set(), wallDecorations: [] });

    residentRoomManager.ensureResident(room2);
    residentRoomManager.getResident('room2')!.runtimeReady = true;
    runtimeCache.set('room2', { renderRevision: 1, wallTemplate: null as unknown as RoomWallTemplate, edgeExtension: null, blockerKeys: new Set(), darkBlockerKeys: new Set(), wallDecorations: [] });

    // The loader should pin both rooms so they survive the capacity limit
    assert.strictEqual(runtimeCache.has('room1'), true, 'Room 1 should be pinned and survive eviction');
    assert.strictEqual(runtimeCache.has('room2'), true, 'Room 2 should be pinned and survive eviction');
  });

  test('gameScreen.ts queueZoneEntryViewportTasks passes the same roomRuntimeCache instance used elsewhere', () => {
    // Regression guard for a build break where addZoneEntryViewportTasks was
    // called with a stale/undefined `runtimeCache` identifier instead of the
    // single authoritative `roomRuntimeCache` instance shared by resident
    // loading, room preparation, and zone-entry viewport warming. TypeScript
    // catches an undefined identifier, but a duplicate cache instance created
    // just to "fix" the type error would compile fine while breaking cache
    // coherence, so this test pins the exact call-site wiring in source.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const gameScreenPath = path.join(here, '..', 'screens', 'gameScreen.ts');
    const src = readFileSync(gameScreenPath, 'utf8');

    // The single RoomRuntimeCache instance must be constructed exactly once.
    const instanceMatches = src.match(/new RoomRuntimeCache\(/g) ?? [];
    assert.strictEqual(
      instanceMatches.length,
      1,
      'gameScreen.ts must construct exactly one RoomRuntimeCache instance (no second/alias cache).',
    );

    // addZoneEntryViewportTasks must be wired to that same instance's variable name.
    const callMatch = src.match(/addZoneEntryViewportTasks\(\s*zoneRoomIds,\s*ROOM_REGISTRY,\s*(\w+),/);
    assert.ok(callMatch, 'Expected to find the addZoneEntryViewportTasks call site in gameScreen.ts');
    assert.strictEqual(
      callMatch![1],
      'roomRuntimeCache',
      'addZoneEntryViewportTasks must be passed the authoritative `roomRuntimeCache` variable, ' +
        'the same instance used by resident loading, room preparation, and entry-viewport warming.',
    );
  });

  test('zone readiness does not hang forever on a cold app launch (chunk-warm scheduler never initialized)', () => {
    // Reproduces the "stuck at N/N" loading hang: on the very first app launch,
    // `scheduleChunkPrewarms()` (which initializes the module-level scheduler
    // singletons in roomRenderChunkWarmScheduler.ts) has never been called —
    // it only runs from gameLoadRoomPhases.ts on an actual room transition,
    // which cannot happen until the initial zone load finishes. The zone
    // loader still calls addZoneEntryViewportTasks()/runChunkPrewarmSliceNow()
    // directly during the initial load, so this test exercises that exact
    // cold-start path with no prior scheduleChunkPrewarms() call in this
    // process (node:test runs each test file in its own process, so the
    // scheduler's module state here starts genuinely uninitialized).
    const t: RoomTransitionDef = {
      direction: 'right',
      targetRoomId: 'room2',
      xBlock: 0,
      yBlock: 0,
      positionBlock: 0,
      openingSizeBlocks: 4,
      targetSpawnBlock: [0, 0],
    };
    const tBack: RoomTransitionDef = {
      direction: 'left',
      targetRoomId: 'room1',
      xBlock: 0,
      yBlock: 0,
      positionBlock: 0,
      openingSizeBlocks: 4,
      targetSpawnBlock: [0, 0],
    };
    // worldNumber 99 keeps background-decode readiness trivially true (no
    // static image to wait on), isolating the test from the Node test
    // environment's lack of a real Image()/network stack — irrelevant to the
    // scheduler bug under test.
    const room1 = fullRoom('room1', 99, [t]);
    const room2 = fullRoom('room2', 99, [tBack]);
    const registry = new Map<string, RoomDef>([
      ['room1', room1],
      ['room2', room2],
    ]);
    const runtimeCache = new RoomRuntimeCache();
    const loader = new ZoneResidentLoader(registry, runtimeCache);
    const residentRoomManager = new ResidentRoomManager();

    loader.startZoneLoad(99, residentRoomManager);

    // Fast-forward both rooms to fully-built/fully-prepared, exactly as the
    // real generator loop would leave them once resident builds complete.
    for (const [id, r] of registry) {
      residentRoomManager.ensureResident(r);
      residentRoomManager.getResident(id)!.runtimeReady = true;
      runtimeCache.set(id, {
        renderRevision: 1,
        wallTemplate: buildRoomWallTemplate(r),
        edgeExtension: null,
        blockerKeys: new Set(),
        darkBlockerKeys: new Set(),
        wallDecorations: [],
      });
    }

    // Drive the tick loop the same way gameScreen.ts does: once per frame,
    // with no external call to scheduleChunkPrewarms() in between (the
    // cold-start condition). Cap iterations well above what a correct
    // implementation needs so a genuine hang fails the test instead of
    // looping forever.
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      ready = loader.tickZoneLoad(residentRoomManager, 1, 480, 270, 1);
    }

    assert.strictEqual(
      ready,
      true,
      'Zone readiness must eventually resolve even when no room transition has ' +
        'ever called scheduleChunkPrewarms() — entry-viewport warm tasks queued by ' +
        'addZoneEntryViewportTasks() must still be processed by runChunkPrewarmSliceNow() ' +
        'instead of being silently dropped because the chunk-warm scheduler\'s module-level ' +
        'registry/runtime-cache/quality singletons were never initialized.',
    );
  });
});

