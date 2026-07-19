/**
 * Coverage for the pure radius-1 connected-room layout module
 * (render/adjacent/connectedRoomLayout.ts).
 *
 * Verifies: all four directions, different room sizes, offset transition
 * openings, round-trip A→B→A origin consistency, a single target linked through
 * multiple transition instances, ambiguous / missing reciprocals, one-way
 * transitions, long-transition and secret-transition exclusion, missing lazy
 * targets, viewport culling, and that the effective-off path performs no
 * adjacency work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import {
  computeConnectedRoomLayout,
  cullConnectedInstances,
  instanceWorldRect,
  makeInstanceKey,
  type ConnectedLayoutRoom,
} from '../render/adjacent/connectedRoomLayout';

const BS = BLOCK_SIZE_SMALL;

function tx(
  direction: TransitionDirection,
  targetRoomId: string,
  xBlock: number,
  yBlock: number,
  openingSizeBlocks: number,
  extra: Partial<RoomTransitionDef> = {},
): RoomTransitionDef {
  return {
    direction,
    targetRoomId,
    xBlock,
    yBlock,
    positionBlock: 0,
    openingSizeBlocks,
    targetSpawnBlock: [xBlock, yBlock],
    ...extra,
  };
}

function room(
  id: string,
  widthBlocks: number,
  heightBlocks: number,
  transitions: RoomTransitionDef[],
): ConnectedLayoutRoom {
  return { id, widthBlocks, heightBlocks, transitions };
}

function registryOf(...rooms: ConnectedLayoutRoom[]) {
  const map = new Map(rooms.map((r) => [r.id, r]));
  return (id: string) => map.get(id) ?? null;
}

test('effective-off performs zero adjacency work (no neighbour lookups)', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4)]);
  let lookups = 0;
  const layout = computeConnectedRoomLayout({
    activeRoom: A,
    resolveRoom: (id) => { lookups++; return id === 'B' ? room('B', 40, 20, []) : null; },
    enabled: false,
  });
  assert.equal(lookups, 0, 'resolveRoom must never be called when disabled');
  assert.deepEqual(layout.instances, []);
});

test('right connection: origin at active width, offset by opening delta', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4)]);
  const B = room('B', 40, 20, [tx('left', 'A', 0, 5, 4)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  assert.equal(layout.instances.length, 1);
  const inst = layout.instances[0];
  assert.equal(inst.direction, 'right');
  assert.equal(inst.originXWorld, 60 * BS);
  assert.equal(inst.originYWorld, (10 - 5) * BS);
  assert.equal(inst.reciprocalResolution, 'unambiguous');
  assert.equal(inst.instanceKey, makeInstanceKey('A', 0));
});

test('left connection: origin at negative target width', () => {
  const A = room('A', 60, 34, [tx('left', 'B', 0, 8, 4)]);
  const B = room('B', 40, 20, [tx('right', 'A', 39, 8, 4)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  const inst = layout.instances[0];
  assert.equal(inst.originXWorld, -40 * BS);
  assert.equal(inst.originYWorld, 0);
});

test('down connection: origin at active height, x offset by column delta', () => {
  const A = room('A', 60, 34, [tx('down', 'B', 12, 33, 5)]);
  const B = room('B', 50, 25, [tx('up', 'A', 3, 0, 5)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  const inst = layout.instances[0];
  assert.equal(inst.originYWorld, 34 * BS);
  assert.equal(inst.originXWorld, (12 - 3) * BS);
});

test('up connection: origin at negative target height', () => {
  const A = room('A', 60, 34, [tx('up', 'B', 20, 0, 5)]);
  const B = room('B', 50, 25, [tx('down', 'A', 20, 24, 5)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  const inst = layout.instances[0];
  assert.equal(inst.originYWorld, -25 * BS);
  assert.equal(inst.originXWorld, 0);
});

test('round-trip A→B→A origin consistency: B-in-A == -(A-in-B)', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4)]);
  const B = room('B', 40, 20, [tx('left', 'A', 0, 5, 4)]);
  const reg = registryOf(A, B);
  const fromA = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: reg, enabled: true }).instances[0];
  const fromB = computeConnectedRoomLayout({ activeRoom: B, resolveRoom: reg, enabled: true }).instances[0];
  assert.equal(fromA.originXWorld, -fromB.originXWorld);
  assert.equal(fromA.originYWorld, -fromB.originYWorld);
});

test('same target room via multiple transitions yields two distinct instances', () => {
  const A = room('A', 60, 34, [
    tx('right', 'B', 59, 10, 4),
    tx('down', 'B', 20, 33, 5),
  ]);
  const B = room('B', 40, 20, [
    tx('left', 'A', 0, 5, 4),
    tx('up', 'A', 20, 0, 5),
  ]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  assert.equal(layout.instances.length, 2);
  const keys = new Set(layout.instances.map((i) => i.instanceKey));
  assert.equal(keys.size, 2, 'distinct instance keys per source transition');
  assert.equal(layout.instances[0].targetRoomId, 'B');
  assert.equal(layout.instances[1].targetRoomId, 'B');
});

test('ambiguous reciprocal: chosen deterministically with a DEV warning', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4)]);
  // Two reverse-direction transitions in B both point back to A. The one with
  // the matching opening size and closest row wins deterministically.
  const B = room('B', 40, 20, [
    tx('left', 'A', 0, 0, 2), // wrong size, far row
    tx('left', 'A', 0, 5, 4), // matching size, closer row → winner
  ]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  const inst = layout.instances[0];
  assert.equal(inst.ambiguous, true);
  assert.equal(inst.reciprocalResolution, 'deterministic');
  assert.equal(inst.originYWorld, (10 - 5) * BS, 'aligned to the size-matched candidate');
  assert.ok(layout.warnings.some((w) => w.includes('reciprocal candidates')));
  // Determinism: recomputing yields the same choice.
  const again = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true }).instances[0];
  assert.equal(again.originYWorld, inst.originYWorld);
});

test('one-way / missing reciprocal: degrades via targetSpawnBlock, still renders', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 12, 4, { targetSpawnBlock: [2, 7] })]);
  const B = room('B', 40, 20, []); // no transition back to A
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  const inst = layout.instances[0];
  assert.equal(inst.reciprocalResolution, 'fallback-spawn');
  assert.equal(inst.originXWorld, 60 * BS);
  assert.equal(inst.originYWorld, (12 - 7) * BS, 'aligned from source opening + target spawn row');
  assert.ok(layout.warnings.some((w) => w.includes('no reciprocal')));
});

test('long transition is excluded', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4, { longTransition: true })]);
  const B = room('B', 40, 20, [tx('left', 'A', 0, 5, 4)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B), enabled: true });
  assert.equal(layout.instances.length, 0);
  assert.ok(layout.skipped.some((s) => s.reason === 'long-transition'));
});

test('unrevealed secret is excluded; revealed secret renders', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4, { isSecretDoor: true })]);
  const B = room('B', 40, 20, [tx('left', 'A', 0, 5, 4)]);
  const reg = registryOf(A, B);

  const hidden = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: reg, enabled: true });
  assert.equal(hidden.instances.length, 0);
  assert.ok(hidden.skipped.some((s) => s.reason === 'unrevealed-secret'));

  const revealed = computeConnectedRoomLayout({
    activeRoom: A, resolveRoom: reg, enabled: true,
    isTransitionRevealed: (roomId, idx) => roomId === 'A' && idx === 0,
  });
  assert.equal(revealed.instances.length, 1);
});

test('missing lazy-loaded target is skipped and reported for async load', () => {
  const A = room('A', 60, 34, [tx('right', 'B', 59, 10, 4)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: () => null, enabled: true });
  assert.equal(layout.instances.length, 0);
  assert.ok(layout.skipped.some((s) => s.reason === 'missing-target' && s.targetRoomId === 'B'));
});

test('self-link, invalid opening, and malformed direction are skipped safely', () => {
  const A = room('A', 60, 34, [
    tx('right', 'A', 59, 10, 4),                 // self-link
    tx('left', 'B', 0, 5, 0),                    // zero opening
    tx('sideways' as TransitionDirection, 'C', 0, 0, 4), // malformed
  ]);
  const layout = computeConnectedRoomLayout({
    activeRoom: A,
    resolveRoom: registryOf(A, room('B', 10, 10, []), room('C', 10, 10, [])),
    enabled: true,
  });
  assert.equal(layout.instances.length, 0);
  const reasons = layout.skipped.map((s) => s.reason);
  assert.ok(reasons.includes('self-link'));
  assert.ok(reasons.includes('invalid-opening'));
  assert.ok(reasons.includes('malformed-direction'));
});

test('viewport culling drops instances outside the camera view', () => {
  const A = room('A', 60, 34, [
    tx('right', 'B', 59, 10, 4),
    tx('left', 'C', 0, 8, 4),
  ]);
  const B = room('B', 40, 20, [tx('left', 'A', 0, 5, 4)]);
  const C = room('C', 40, 20, [tx('right', 'A', 39, 8, 4)]);
  const layout = computeConnectedRoomLayout({ activeRoom: A, resolveRoom: registryOf(A, B, C), enabled: true });
  assert.equal(layout.instances.length, 2);

  // Camera view over the right seam only sees room B (to the right).
  const view = { x: 55 * BS, y: 0, width: 20 * BS, height: 34 * BS };
  const visible = cullConnectedInstances(layout.instances, view, 0);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].targetRoomId, 'B');

  // Sanity: B's world rect sits to the right of the active room.
  const rect = instanceWorldRect(visible[0]);
  assert.equal(rect.x, 60 * BS);
  assert.equal(rect.width, 40 * BS);
});
