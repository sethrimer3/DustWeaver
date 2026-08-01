import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ZoneResidentLoader } from '../screens/zoneResidentLoader';
import { ResidentRoomManager } from '../screens/residentRoomManager';
import { RoomRuntimeCache } from '../screens/roomRuntimeCache';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import type { RoomWallTemplate } from '../screens/gameRoomWalls';

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
  };
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
});

