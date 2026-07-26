/**
 * Regression tests for interior room transitions (transitions placed away
 * from a room's outer boundary).
 *
 * Bug: `computeSpawnBlockForTransition` hardcoded the spawn coordinate
 * relative to the destination room's outer boundary (e.g. a fixed inset
 * from the left wall for a 'left' transition) instead of deriving it from
 * the destination transition's actual placed geometry (`xBlock`/`yBlock`/
 * `gradientWidthBlocks`). This was correct only when the transition
 * happened to sit exactly on the room perimeter. An interior transition
 * (e.g. a 'left'-facing transition placed in the middle of a room) would
 * spawn the player at the room's far boundary instead of at the
 * transition's actual inner edge.
 *
 * Mirrored on the visual-map editor side: `getDoorCenterWorld` anchored the
 * transition marker on the room's outer boundary rather than on the
 * transition's actual active/directional edge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeSpawnBlockForTransition, TRANSITION_SPAWN_INSET_BLOCKS } from '../screens/gameTransitions';
import { getDoorCenterWorld, applyDoorSnap } from '../editor/editorVisualMapHelpers';
import type { MapRoomPlacement } from '../editor/editorVisualMapHelpers';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';

function makeRoom(overrides: Partial<RoomDef> = {}): RoomDef {
  return {
    id: 'room',
    name: 'Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 20,
    heightBlocks: 20,
    walls: [],
    enemies: [],
    playerSpawnBlock: [1, 1],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    challengeFields: [],
    challengeGates: [],
    challengeTotems: [],
    gates: [],
    ...overrides,
  } as unknown as RoomDef;
}

function makeTransition(overrides: Partial<RoomTransitionDef> = {}): RoomTransitionDef {
  return {
    direction: 'left',
    targetRoomId: 'other',
    xBlock: 0,
    yBlock: 5,
    positionBlock: 5,
    openingSizeBlocks: 4,
    targetSpawnBlock: [0, 0] as const,
    ...overrides,
  } as RoomTransitionDef;
}

// ── computeSpawnBlockForTransition: interior transitions, all 4 directions ──

test('interior left transition: spawn X sits just past the transition\'s own inner edge, not the room boundary', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, gradientWidthBlocks: 3 });
  const [sx] = computeSpawnBlockForTransition(room, t, 0.5);
  // active edge = xBlock (10); arrival spawn X = xBlock + gw = 13
  assert.equal(sx, 13);
});

test('interior right transition: spawn X sits just before the transition\'s own inner edge', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'right', xBlock: 10, yBlock: 5, gradientWidthBlocks: 3 });
  const [sx] = computeSpawnBlockForTransition(room, t, 0.5);
  // active edge = xBlock + gw (13); arrival spawn X = xBlock - 1 = 9
  assert.equal(sx, 9);
});

test('interior up transition: spawn Y sits just past the transition\'s own inner edge', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'up', xBlock: 5, yBlock: 10, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const [, sy] = computeSpawnBlockForTransition(room, t, 0.5);
  // active edge = yBlock (10); arrival spawn Y = yBlock + gw = 13
  assert.equal(sy, 13);
});

test('interior down transition: spawn Y sits just before the transition\'s own inner edge', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'down', xBlock: 5, yBlock: 10, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const [, sy] = computeSpawnBlockForTransition(room, t, 0.5);
  // active edge = yBlock + gw (13); arrival spawn Y = yBlock - 1 = 9
  assert.equal(sy, 9);
});

// ── Ordinary boundary transitions: unchanged spawn coordinates ──────────────

test('boundary left transition at xBlock=0, gw=3 spawns at X=3 (unchanged legacy behaviour)', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const t = makeTransition({ direction: 'left', xBlock: 0, yBlock: 5, gradientWidthBlocks: 3 });
  const [sx] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.equal(sx, TRANSITION_SPAWN_INSET_BLOCKS);
  assert.equal(sx, 3);
});

test('boundary right transition at xBlock=roomWidth-3 spawns at X=roomWidth-4 (unchanged legacy behaviour)', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const t = makeTransition({ direction: 'right', xBlock: 17, yBlock: 5, gradientWidthBlocks: 3 });
  const [sx] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.equal(sx, room.widthBlocks - 4);
  assert.equal(sx, 16);
});

test('boundary up transition at yBlock=0 spawns at Y=3 (unchanged legacy behaviour)', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const t = makeTransition({ direction: 'up', xBlock: 5, yBlock: 0, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const [, sy] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.equal(sy, 3);
});

test('boundary down transition at yBlock=roomHeight-3 spawns at Y=roomHeight-4 (unchanged legacy behaviour)', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const t = makeTransition({ direction: 'down', xBlock: 5, yBlock: 17, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const [, sy] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.equal(sy, room.heightBlocks - 4);
  assert.equal(sy, 16);
});

// ── Relative opening-offset preservation ─────────────────────────────────────

test('entryOffsetFraction is preserved along the opening for an interior transition', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, openingSizeBlocks: 5, gradientWidthBlocks: 3 });
  const [, syNear] = computeSpawnBlockForTransition(room, t, 0);
  const [, syFar] = computeSpawnBlockForTransition(room, t, 1);
  const [, syMid] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.ok(syNear < syMid);
  assert.ok(syMid < syFar);
});

// ── Opening sizes below and above the frame-margin threshold ────────────────

test('opening below the margin threshold (size < 3) applies zero edge margin', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, openingSizeBlocks: 2, gradientWidthBlocks: 3 });
  const [, syNear] = computeSpawnBlockForTransition(room, t, 0);
  // No edge margin at openingSizeBlocks < 3: fraction 0 maps straight to yBlock.
  assert.equal(syNear, 5);
});

test('opening at/above the margin threshold (size >= 3) applies a 1-block edge margin', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, openingSizeBlocks: 5, gradientWidthBlocks: 3 });
  const [, syNear] = computeSpawnBlockForTransition(room, t, 0);
  // 1-block margin at openingSizeBlocks >= 3: fraction 0 maps to yBlock + 1.
  assert.equal(syNear, 6);
});

// ── Explicit xBlock/yBlock vs legacy positionBlock/depthBlock fallback ──────

test('explicit xBlock/yBlock fields are used directly for an interior transition', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'up', xBlock: 12, yBlock: 8, openingSizeBlocks: 4, gradientWidthBlocks: 2 });
  const [sx] = computeSpawnBlockForTransition(room, t, 0);
  assert.equal(sx, 13); // edgeMargin(1) + xBlock(12)
});

test('legacy positionBlock/depthBlock fallback still resolves xBlock/yBlock when explicit fields are absent', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = {
    direction: 'left',
    targetRoomId: 'other',
    xBlock: undefined,
    yBlock: undefined,
    positionBlock: 9,
    depthBlock: 4,
    openingSizeBlocks: 4,
    targetSpawnBlock: [0, 0] as const,
    gradientWidthBlocks: 3,
  } as unknown as RoomTransitionDef;
  const [sx, sy] = computeSpawnBlockForTransition(room, t, 0);
  // xBlock falls back to depthBlock(4); yBlock falls back to positionBlock(9).
  assert.equal(sx, 4 + 3); // xBlock + gw
  assert.equal(sy, 10); // edgeMargin(1) + positionBlock(9)
});

// ── Omitted / invalid gradientWidthBlocks ────────────────────────────────────

test('omitted gradientWidthBlocks falls back to the legacy default of 3', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, gradientWidthBlocks: undefined });
  const [sx] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.equal(sx, 13); // xBlock(10) + gw(3)
});

test('invalid (<=0) gradientWidthBlocks is normalized to 2', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, gradientWidthBlocks: 0 });
  const [sx] = computeSpawnBlockForTransition(room, t, 0.5);
  assert.equal(sx, 12); // xBlock(10) + gw(2)
});

// ── Visual-map active-edge coordinates: all four directions ─────────────────

function makePlacement(room: RoomDef, mapXWorld = 100, mapYWorld = 200): MapRoomPlacement {
  return { room, mapXWorld, mapYWorld };
}

test('visual map: interior left transition anchor sits at its own xBlock, not the room\'s left boundary', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'left', xBlock: 10, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const placement = makePlacement(room);
  const [wx, wy] = getDoorCenterWorld(t, placement);
  assert.equal(wx, placement.mapXWorld + 10); // NOT placement.mapXWorld (the room's left edge)
  assert.equal(wy, placement.mapYWorld + 5 + 4 / 2);
});

test('visual map: interior right transition anchor sits at xBlock+gw, not the room\'s right boundary', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'right', xBlock: 10, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const placement = makePlacement(room);
  const [wx] = getDoorCenterWorld(t, placement);
  assert.equal(wx, placement.mapXWorld + 13); // xBlock + gw, NOT mapXWorld + roomWidth
});

test('visual map: interior up transition anchor sits at its own yBlock, not the room\'s top boundary', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'up', xBlock: 5, yBlock: 12, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const placement = makePlacement(room);
  const [wx, wy] = getDoorCenterWorld(t, placement);
  assert.equal(wy, placement.mapYWorld + 12);
  assert.equal(wx, placement.mapXWorld + 5 + 4 / 2);
});

test('visual map: interior down transition anchor sits at yBlock+gw, not the room\'s bottom boundary', () => {
  const room = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  const t = makeTransition({ direction: 'down', xBlock: 5, yBlock: 12, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const placement = makePlacement(room);
  const [, wy] = getDoorCenterWorld(t, placement);
  assert.equal(wy, placement.mapYWorld + 15); // yBlock + gw, NOT mapYWorld + roomHeight
});

test('visual map: boundary transitions still anchor flush on the room edge (unchanged)', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const left = makeTransition({ direction: 'left', xBlock: 0, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const right = makeTransition({ direction: 'right', xBlock: 17, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3 });
  const placement = makePlacement(room);
  assert.equal(getDoorCenterWorld(left, placement)[0], placement.mapXWorld);
  assert.equal(getDoorCenterWorld(right, placement)[0], placement.mapXWorld + room.widthBlocks);
});

// ── applyDoorSnap: interior transitions must not cause invalid room-overlap snapping ──

test('applyDoorSnap does not snap two rooms together via an interior transition pair', () => {
  const roomA = makeRoom({
    id: 'a', widthBlocks: 20, heightBlocks: 20,
    transitions: [makeTransition({ direction: 'right', xBlock: 8, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3, targetRoomId: 'b' })],
  });
  const roomB = makeRoom({
    id: 'b', widthBlocks: 20, heightBlocks: 20,
    transitions: [makeTransition({ direction: 'left', xBlock: 6, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3, targetRoomId: 'a' })],
  });
  const placementA = makePlacement(roomA, 0, 0);
  const placementB = makePlacement(roomB, 50, 0);
  const placements = new Map<string, MapRoomPlacement>([['a', placementA], ['b', placementB]]);

  const originalX = placementA.mapXWorld;
  const originalY = placementA.mapYWorld;
  const result = applyDoorSnap('a', placementA, placements, 1000);

  assert.equal(result, null);
  assert.equal(placementA.mapXWorld, originalX);
  assert.equal(placementA.mapYWorld, originalY);
});

test('applyDoorSnap still snaps two ordinary boundary transitions flush (unchanged)', () => {
  const roomA = makeRoom({
    id: 'a', widthBlocks: 20, heightBlocks: 20,
    transitions: [makeTransition({ direction: 'right', xBlock: 17, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3, targetRoomId: 'b' })],
  });
  const roomB = makeRoom({
    id: 'b', widthBlocks: 20, heightBlocks: 20,
    transitions: [makeTransition({ direction: 'left', xBlock: 0, yBlock: 5, openingSizeBlocks: 4, gradientWidthBlocks: 3, targetRoomId: 'a' })],
  });
  const placementA = makePlacement(roomA, 0, 0);
  const placementB = makePlacement(roomB, 50, 3);
  const placements = new Map<string, MapRoomPlacement>([['a', placementA], ['b', placementB]]);

  const result = applyDoorSnap('a', placementA, placements, 1000);

  assert.ok(result !== null);
  // Flush wall-to-wall: room A's right edge (mapXWorld + widthBlocks) meets room B's left edge (mapXWorld).
  assert.equal(placementA.mapXWorld + roomA.widthBlocks, placementB.mapXWorld);
});

// ── Linked pair with one or both reciprocal transitions interior ────────────

test('linked pair: interior source + interior destination both resolve independently via their own geometry', () => {
  const destRoom = makeRoom({ widthBlocks: 30, heightBlocks: 30 });
  // Destination ("return") transition is itself interior (faces 'down', away from the bottom wall).
  const returnTransition = makeTransition({ direction: 'down', xBlock: 8, yBlock: 15, openingSizeBlocks: 5, gradientWidthBlocks: 3 });

  // Player crossed an interior 'up' transition in the source room at some offset fraction;
  // that fraction is carried over into the destination spawn.
  const [sx, sy] = computeSpawnBlockForTransition(destRoom, returnTransition, 0.5);

  // active edge = yBlock + gw (18); arrival spawn Y = yBlock - 1 = 14
  assert.equal(sy, 14);
  // openingOffset centered within [8, 8+5-1] with 1-block margin -> xBlock + edgeMargin(1) + round(0.5*maxOffset)
  assert.ok(sx >= returnTransition.xBlock && sx <= returnTransition.xBlock + returnTransition.openingSizeBlocks - 1);
});
