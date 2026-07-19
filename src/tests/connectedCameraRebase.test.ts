/**
 * Coverage for the connected-room camera rebase invariant
 * (render/adjacent/connectedCameraRebase.ts).
 *
 * When room B (rendered at offset O in room A's frame) becomes active, B's
 * origin becomes 0, A becomes adjacent at -O, and the camera centre becomes
 * C - O. Every screen-space position `worldPosition + roomOrigin - camera` must
 * be preserved across the rebase — no snap, no one-frame jump.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rebaseCameraCenter,
  rebaseWorldPosition,
  worldToScreenOffset,
  type Vec2,
} from '../render/adjacent/connectedCameraRebase';

function assertVecClose(a: Vec2, b: Vec2, msg?: string): void {
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, msg ?? `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

test('rebase preserves screen position of a point in the destination room B', () => {
  const O: Vec2 = { x: 480, y: 40 };   // B rendered at this offset in A's frame
  const C: Vec2 = { x: 500, y: 120 };  // camera centre before activation
  const pB: Vec2 = { x: 12, y: 6 };    // a point in B, room-local

  const before = worldToScreenOffset(pB, O, C);              // B origin = O
  const C2 = rebaseCameraCenter(C, O);                        // camera → C - O
  const after = worldToScreenOffset(pB, { x: 0, y: 0 }, C2);  // B origin = 0
  assertVecClose(before, after, 'destination point must not move on screen');
  assertVecClose(C2, { x: 20, y: 80 });
});

test('rebase preserves screen position of a point in the outgoing room A', () => {
  const O: Vec2 = { x: 480, y: 40 };
  const C: Vec2 = { x: 500, y: 120 };
  const pA: Vec2 = { x: 300, y: 90 }; // a point in A, room-local

  const before = worldToScreenOffset(pA, { x: 0, y: 0 }, C); // A origin = 0 before
  const C2 = rebaseCameraCenter(C, O);
  const aOriginAfter = rebaseWorldPosition({ x: 0, y: 0 }, O); // A origin → -O
  const after = worldToScreenOffset(pA, aOriginAfter, C2);
  assertVecClose(before, after, 'outgoing point must not move on screen');
  assertVecClose(aOriginAfter, { x: -480, y: -40 });
});

test('rebase is a no-op when the destination was rendered at origin (O = 0)', () => {
  const C: Vec2 = { x: 33, y: 77 };
  assertVecClose(rebaseCameraCenter(C, { x: 0, y: 0 }), C);
});
