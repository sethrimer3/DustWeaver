/**
 * Coverage for the adjacent-room draw-pass orchestration
 * (screens/gameRenderAdjacentRooms.ts) — culling, deterministic order, offset
 * derivation from the single camera offset, and skip paths. Canvas primitives
 * are mocked; this verifies the orchestration, not pixel output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { WallSnapshot } from '../render/snapshot';
import { renderAdjacentRoomsPass, type AdjacentRoomDrawParams } from '../screens/gameRenderAdjacentRooms';
import type { ConnectedRoomInstance } from '../render/adjacent/connectedRoomLayout';
import type { ConnectedRoomRenderState, AdjacentRoomView } from '../render/adjacent/adjacentRoomView';

const BS = BLOCK_SIZE_SMALL;

function mockCtx(): CanvasRenderingContext2D {
  return {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
    set fillStyle(_v: string) {}, get fillStyle() { return ''; },
  } as unknown as CanvasRenderingContext2D;
}

function instance(key: string, targetRoomId: string, originXWorld: number, originYWorld: number, w = 40, h = 20): ConnectedRoomInstance {
  return {
    instanceKey: key, sourceRoomId: 'A', sourceTransitionIndex: 0, targetRoomId,
    direction: 'right', originXWorld, originYWorld, targetWidthBlocks: w, targetHeightBlocks: h,
    reciprocalResolution: 'unambiguous', ambiguous: false,
  };
}

function view(inst: ConnectedRoomInstance, ready = true): AdjacentRoomView {
  return { instance: inst, terrainSource: 'wall-template', ready };
}

function roomDef(id: string): RoomDef {
  return { id, name: id, worldNumber: 1, mapX: 0, mapY: 0, widthBlocks: 40, heightBlocks: 20,
    walls: [], enemies: [], playerSpawnBlock: [1, 1], transitions: [], saveTombs: [] } as RoomDef;
}

const wallSnap: WallSnapshot = {
  count: 0, xWorld: new Float32Array(0), yWorld: new Float32Array(0),
  wWorld: new Float32Array(0), hWorld: new Float32Array(0),
  isPlatformFlag: new Uint8Array(0), platformEdge: new Uint8Array(0),
  themeIndex: new Uint8Array(0), isInvisibleFlag: new Uint8Array(0),
  rampOrientationIndex: new Uint8Array(0), isPillarHalfWidthFlag: new Uint8Array(0),
} as unknown as WallSnapshot;

function baseParams(state: ConnectedRoomRenderState, overrides: Partial<AdjacentRoomDrawParams> = {}): AdjacentRoomDrawParams {
  const wallCalls: { roomId: string; offX: number; offY: number }[] = [];
  const bgCalls: string[] = [];
  const params: AdjacentRoomDrawParams = {
    ctx: mockCtx(),
    state,
    ox: 100, oy: 50, zoom: 1, vpWPx: 480, vpHPx: 270,
    maxChunksPerRoom: 8,
    ports: {
      resolveRoomDef: (id) => roomDef(id),
      resolveWallSnapshot: () => wallSnap,
      resolveBgColor: () => null,
    },
    impl: {
      drawWall: (_ctx, roomId, _room, _wallSnapshot, offX, offY) => { wallCalls.push({ roomId, offX, offY }); },
      drawBg: (_ctx, room) => { bgCalls.push(room.id); },
    },
    ...overrides,
  };
  (params as unknown as { _wallCalls: typeof wallCalls })._wallCalls = wallCalls;
  (params as unknown as { _bgCalls: typeof bgCalls })._bgCalls = bgCalls;
  return params;
}

test('empty render state draws nothing', () => {
  const state: ConnectedRoomRenderState = { activeRoomId: 'A', views: [], connectedTargetRoomIds: new Set() };
  const stats = renderAdjacentRoomsPass(baseParams(state));
  assert.deepEqual(stats, { drawn: 0, culled: 0, skippedNoData: 0 });
});

test('draws a visible ready instance with the correct camera-derived offset', () => {
  const inst = instance('A#0', 'B', 40 * BS, 0); // right neighbour just past active room
  const state: ConnectedRoomRenderState = { activeRoomId: 'A', views: [view(inst)], connectedTargetRoomIds: new Set(['B']) };
  const params = baseParams(state);
  const stats = renderAdjacentRoomsPass(params);
  assert.equal(stats.drawn, 1);
  const wallCalls = (params as unknown as { _wallCalls: { roomId: string; offX: number; offY: number }[] })._wallCalls;
  assert.equal(wallCalls.length, 1);
  // offset = ox + originXWorld*zoom = 100 + 320*1
  assert.equal(wallCalls[0].offX, 100 + 40 * BS);
  assert.equal(wallCalls[0].offY, 50);
});

test('not-ready views are ignored', () => {
  const inst = instance('A#0', 'B', 40 * BS, 0);
  const state: ConnectedRoomRenderState = { activeRoomId: 'A', views: [view(inst, false)], connectedTargetRoomIds: new Set() };
  const stats = renderAdjacentRoomsPass(baseParams(state));
  assert.equal(stats.drawn, 0);
});

test('instances outside the viewport are culled', () => {
  // Far to the left, off-screen (camera view world x is [-100, 380] at ox=100).
  const inst = instance('A#0', 'B', -5000, 0);
  const state: ConnectedRoomRenderState = { activeRoomId: 'A', views: [view(inst)], connectedTargetRoomIds: new Set(['B']) };
  const stats = renderAdjacentRoomsPass(baseParams(state));
  assert.equal(stats.culled, 1);
  assert.equal(stats.drawn, 0);
});

test('null wall snapshot skips as no-data (keeps void/transition presentation)', () => {
  const inst = instance('A#0', 'B', 40 * BS, 0);
  const state: ConnectedRoomRenderState = { activeRoomId: 'A', views: [view(inst)], connectedTargetRoomIds: new Set(['B']) };
  const params = baseParams(state, { ports: { resolveRoomDef: (id) => roomDef(id), resolveWallSnapshot: () => null, resolveBgColor: () => null } });
  const stats = renderAdjacentRoomsPass(params);
  assert.equal(stats.drawn, 0);
  assert.equal(stats.skippedNoData, 1);
});

test('multiple visible instances draw in deterministic instanceKey order', () => {
  const i1 = instance('A#2', 'C', 40 * BS, 0);
  const i2 = instance('A#0', 'B', 0, 20 * BS); // below
  const state: ConnectedRoomRenderState = {
    activeRoomId: 'A', views: [view(i1), view(i2)], connectedTargetRoomIds: new Set(['B', 'C']),
  };
  const params = baseParams(state);
  renderAdjacentRoomsPass(params);
  const wallCalls = (params as unknown as { _wallCalls: { roomId: string }[] })._wallCalls;
  assert.deepEqual(wallCalls.map((c) => c.roomId), ['B', 'C'], 'A#0 before A#2');
});
