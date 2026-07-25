/**
 * Regression tests for transition-depth (gradientWidthBlocks) normalization
 * at JSON/save load time.
 *
 * Bug: legacy saved data could carry an explicit `gradientWidthBlocks <= 0`
 * (e.g. from the old DEFAULT_GRADIENT=0 editor placement path), which then
 * flowed straight through into the runtime RoomDef and produced a
 * zero/negative-depth transition zone. A fully OMITTED field must keep the
 * existing fallback (3) — only an explicitly-present non-positive value
 * should be clamped, to 2.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';
import type { RoomJsonDef, RoomJsonTransition } from '../editor/roomJsonSchema';

function makeMinimalRoomJson(overrides: Partial<RoomJsonDef> = {}): RoomJsonDef {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 12,
    playerSpawnBlock: [1, 1],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    skillTombs: [],
    ...overrides,
  };
}

function makeTransition(overrides: Partial<RoomJsonTransition> = {}): RoomJsonTransition {
  return {
    direction: 'right',
    positionBlock: 4,
    openingSizeBlocks: 6,
    targetRoomId: 'other_room',
    targetSpawnBlock: [3, 3],
    ...overrides,
  };
}

test('explicit gradientWidthBlocks of 0 is normalized up to 2', () => {
  const json = makeMinimalRoomJson({ transitions: [makeTransition({ gradientWidthBlocks: 0, xBlock: 5, yBlock: 5 })] });
  const room = roomJsonDefToRoomDef(json);
  assert.equal(room.transitions[0].gradientWidthBlocks, 2);
});

test('explicit negative gradientWidthBlocks is normalized up to 2', () => {
  const json = makeMinimalRoomJson({ transitions: [makeTransition({ gradientWidthBlocks: -4, xBlock: 5, yBlock: 5 })] });
  const room = roomJsonDefToRoomDef(json);
  assert.equal(room.transitions[0].gradientWidthBlocks, 2);
});

test('a fully omitted gradientWidthBlocks is left undefined (legacy fallback path untouched)', () => {
  const json = makeMinimalRoomJson({ transitions: [makeTransition({ xBlock: 5, yBlock: 5 })] });
  const room = roomJsonDefToRoomDef(json);
  assert.equal(room.transitions[0].gradientWidthBlocks, undefined);
});

test('a valid positive explicit gradientWidthBlocks passes through unchanged', () => {
  const json = makeMinimalRoomJson({ transitions: [makeTransition({ gradientWidthBlocks: 5, xBlock: 5, yBlock: 5 })] });
  const room = roomJsonDefToRoomDef(json);
  assert.equal(room.transitions[0].gradientWidthBlocks, 5);
});
