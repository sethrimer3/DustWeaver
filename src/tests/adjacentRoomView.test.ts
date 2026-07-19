/**
 * Coverage for adjacent-room cache identity and frozen-resident-world pairing
 * (render/adjacent/adjacentRoomView.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeAdjacentRoomCacheKey,
  isResidentWorldUsableForRoom,
  EMPTY_CONNECTED_RENDER_STATE,
} from '../render/adjacent/adjacentRoomView';

test('cache key is stable and distinguishes room / render-state / scale / generation', () => {
  const base = makeAdjacentRoomCacheKey('roomA', 'rsk-1', 4, 0);
  assert.equal(base, makeAdjacentRoomCacheKey('roomA', 'rsk-1', 4, 0), 'deterministic');
  assert.notEqual(base, makeAdjacentRoomCacheKey('roomB', 'rsk-1', 4, 0), 'room id matters');
  assert.notEqual(base, makeAdjacentRoomCacheKey('roomA', 'rsk-2', 4, 0), 'render-state key matters');
  assert.notEqual(base, makeAdjacentRoomCacheKey('roomA', 'rsk-1', 2, 0), 'scale matters');
  assert.notEqual(base, makeAdjacentRoomCacheKey('roomA', 'rsk-1', 4, 1), 'dynamic generation matters');
});

test('resident world is only usable when builtForRoomId matches the room', () => {
  assert.equal(isResidentWorldUsableForRoom('roomA', 'roomA'), true);
  assert.equal(isResidentWorldUsableForRoom('roomB', 'roomA'), false, 'wrong builtForRoomId rejected');
  assert.equal(isResidentWorldUsableForRoom(null, 'roomA'), false);
  assert.equal(isResidentWorldUsableForRoom(undefined, 'roomA'), false);
  assert.equal(isResidentWorldUsableForRoom('', 'roomA'), false);
});

test('empty render state is inert (no views, no connected targets)', () => {
  assert.equal(EMPTY_CONNECTED_RENDER_STATE.views.length, 0);
  assert.equal(EMPTY_CONNECTED_RENDER_STATE.connectedTargetRoomIds.size, 0);
});
