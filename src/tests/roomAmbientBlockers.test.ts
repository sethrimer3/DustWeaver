/**
 * Unit tests for buildRoomAmbientBlockerKeys — the shared ambient-light blocker
 * builder consolidated from the four inline copies in the room-load pipeline.
 *
 * These lock in the exact semantics the render-state key depends on: any drift
 * would desync the prewarm build-time key from the room-entry adopt-time key and
 * cause prewarmed chunks to be discarded (a first-frame wall-rebuild hitch).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoomAmbientBlockerKeys } from '../levels/roomAmbientBlockers';
import type { RoomDef } from '../levels/roomDef';

/** Minimal RoomDef stub — only the fields the builder reads are populated. */
function makeRoom(partial: Partial<RoomDef>): RoomDef {
  return partial as RoomDef;
}

test('empty room yields undefined for both sets (no wasted allocation)', () => {
  const { blockerKeys, darkBlockerKeys } = buildRoomAmbientBlockerKeys(makeRoom({}));
  assert.equal(blockerKeys, undefined);
  assert.equal(darkBlockerKeys, undefined);
});

test('ambientLightBlockers produce one "x,y" key each', () => {
  const { blockerKeys, darkBlockerKeys } = buildRoomAmbientBlockerKeys(makeRoom({
    ambientLightBlockers: [
      { xBlock: 3, yBlock: 1 },
      { xBlock: 5, yBlock: 9 },
    ],
  }));
  assert.deepEqual([...blockerKeys!].sort(), ['3,1', '5,9']);
  assert.equal(darkBlockerKeys, undefined);
});

test('isDark blockers appear in BOTH blockerKeys and darkBlockerKeys', () => {
  const { blockerKeys, darkBlockerKeys } = buildRoomAmbientBlockerKeys(makeRoom({
    ambientLightBlockers: [
      { xBlock: 1, yBlock: 1 },
      { xBlock: 2, yBlock: 2, isDark: true },
    ],
  }));
  assert.ok(blockerKeys!.has('2,2'));
  assert.ok(darkBlockerKeys!.has('2,2'));
  assert.ok(!darkBlockerKeys!.has('1,1'));
});

test('light-blocking background block expands to every footprint cell', () => {
  const { blockerKeys } = buildRoomAmbientBlockerKeys(makeRoom({
    backgroundBlocks: [
      { xBlock: 10, yBlock: 20, wBlock: 2, hBlock: 3, blockTheme: null, isLightBlockingFlag: 1 },
    ],
  }));
  assert.deepEqual(
    [...blockerKeys!].sort(),
    ['10,20', '10,21', '10,22', '11,20', '11,21', '11,22'].sort(),
  );
});

test('non-light-blocking background blocks are ignored', () => {
  const { blockerKeys, darkBlockerKeys } = buildRoomAmbientBlockerKeys(makeRoom({
    backgroundBlocks: [
      { xBlock: 0, yBlock: 0, wBlock: 4, hBlock: 4, blockTheme: null, isLightBlockingFlag: 0 },
    ],
  }));
  assert.equal(blockerKeys, undefined);
  assert.equal(darkBlockerKeys, undefined);
});

test('blockers + light-blocking background merge into one set', () => {
  const { blockerKeys } = buildRoomAmbientBlockerKeys(makeRoom({
    ambientLightBlockers: [{ xBlock: 0, yBlock: 0 }],
    backgroundBlocks: [
      { xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1, blockTheme: null, isLightBlockingFlag: 1 },
    ],
  }));
  assert.deepEqual([...blockerKeys!].sort(), ['0,0', '1,1']);
});
