/**
 * Item D regression guards: the gesture-local drag target cache.
 *
 * Per-frame drag movement must perform ZERO per-element collection scans
 * (no `.find()`-equivalent), and a frame whose snapped delta is unchanged
 * must mutate nothing at all. Movement semantics must stay byte-identical to
 * the reference implementation (`moveSelectedElements`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData, SelectedElement } from '../editor/editorElementTypes';
import {
  createDragTargetCache, buildDragTargetCache, applyDragDelta, resetDragTargetCache,
  DRAG_MOVE_KINDS,
} from '../editor/editorDragTargetCache';
import { moveSelectedElements, storeDragStartPositions } from '../editor/editorDragCopyPaste';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT',
    songId: '_continue', widthBlocks: 400, heightBlocks: 400,
    playerSpawnBlock: [18, 18],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

/**
 * Wraps a room collection so any scan-shaped access (`find`, `findIndex`,
 * `filter`, `indexOf`, `some`, iteration) is counted. This is the structural
 * proof that per-frame movement does no lookups.
 */
const SCAN_ACCESSORS = new Set<unknown>([
  'find', 'findIndex', 'filter', 'indexOf', 'some', 'every', 'forEach', Symbol.iterator,
]);
function countingArray<T>(items: T[], counter: { scans: number }): T[] {
  return new Proxy(items, {
    get(target, prop, receiver) {
      if (SCAN_ACCESSORS.has(prop)) counter.scans++;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function makeLargeSelectionState(count: number) {
  const walls = [];
  const enemies = [];
  for (let i = 0; i < count; i++) {
    walls.push({ uid: 1000 + i, xBlock: i % 200, yBlock: Math.floor(i / 200), wBlock: 1, hBlock: 1 });
    enemies.push({ uid: 5000 + i, xBlock: i % 200, yBlock: Math.floor(i / 200), type: 'basic', particleCount: 0 });
  }
  const counter = { scans: 0 };
  const room = makeRoom({
    interiorWalls: countingArray(walls, counter) as never,
    enemies: countingArray(enemies, counter) as never,
  });
  const state = createEditorState();
  state.roomData = room;
  const selection: SelectedElement[] = [];
  for (let i = 0; i < count; i++) {
    selection.push({ type: 'wall', uid: 1000 + i });
    selection.push({ type: 'enemy', uid: 5000 + i });
  }
  state.selectedElements = selection;
  return { state, room, counter, walls, enemies };
}

// ── Structural: zero scans per frame ──────────────────────────────────────

test('large selection: per-frame drag update performs ZERO collection scans', () => {
  const { state, counter, walls } = makeLargeSelectionState(400);
  const cache = createDragTargetCache();

  buildDragTargetCache(state, cache);
  assert.equal(cache.entries.length, 800, 'every selected element resolved once');
  const buildScans = counter.scans;
  assert.ok(buildScans <= 4, `build should touch each involved collection ~once, saw ${buildScans}`);

  counter.scans = 0;
  for (let frame = 1; frame <= 120; frame++) {
    applyDragDelta(state, cache, frame, -frame);
  }
  assert.equal(counter.scans, 0, 'per-frame movement must not scan any collection');
  assert.equal(walls[0].xBlock, (0 % 200) + 120);
  assert.equal(walls[0].yBlock, 0 - 120);
});

test('the reference implementation, by contrast, scans on every frame (guards the test itself)', () => {
  const { state, counter } = makeLargeSelectionState(20);
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(state, positions);
  counter.scans = 0;
  moveSelectedElements(state, positions, 1, 1);
  assert.ok(counter.scans > 0, 'moveSelectedElements is expected to scan — the cache path must not');
});

// ── Unchanged-delta frames mutate nothing ─────────────────────────────────

test('unchanged snapped delta: zero element mutations, dragDeltaNoops incremented', () => {
  const { state, walls, enemies } = makeLargeSelectionState(50);
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);
  resetEditorPerfCounters();

  assert.equal(applyDragDelta(state, cache, 4, 7), true);
  assert.equal(editorPerfCounters.dragDeltaApplied, 1);
  assert.equal(editorPerfCounters.dragDeltaNoops, 0);

  const wallSnapshot = walls.map(w => [w.xBlock, w.yBlock]);
  const enemySnapshot = enemies.map(e => [e.xBlock, e.yBlock]);

  // 99 further frames at the same snapped delta (pointer moving sub-block).
  for (let i = 0; i < 99; i++) {
    assert.equal(applyDragDelta(state, cache, 4, 7), false);
  }
  assert.equal(editorPerfCounters.dragDeltaNoops, 99);
  assert.equal(editorPerfCounters.dragDeltaApplied, 1, 'only the first frame applied');
  assert.deepEqual(walls.map(w => [w.xBlock, w.yBlock]), wallSnapshot);
  assert.deepEqual(enemies.map(e => [e.xBlock, e.yBlock]), enemySnapshot);

  // A new snapped delta applies again.
  assert.equal(applyDragDelta(state, cache, 5, 7), true);
  assert.equal(editorPerfCounters.dragDeltaApplied, 2);
});

// ── Semantic parity with moveSelectedElements ─────────────────────────────

function mixedRoom(): EditorRoomData {
  return makeRoom({
    widthBlocks: 40, heightBlocks: 40,
    interiorWalls: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 }] as never,
    enemies: [{ uid: 2, xBlock: 6, yBlock: 6, type: 'basic', particleCount: 0 }] as never,
    zipMoveBlocks: [{ uid: 3, xBlock: 30, yBlock: 30, wBlock: 3, hBlock: 3 }] as never,
    challengeFields: [{ uid: 4, xBlock: 2, yBlock: 2, wBlock: 5, hBlock: 5 }] as never,
    gates: [{ uid: 8, xBlock: 10, yBlock: 10, wBlock: 2, hBlock: 4 }] as never,
    challengeTotems: [{ uid: 9, xBlock: 12, yBlock: 12 }] as never,
    transitions: [{
      uid: 5, xBlock: 0, yBlock: 8, direction: 'left',
      gradientWidthBlocks: 3, openingSizeBlocks: 4, positionBlock: 8,
    }] as never,
    guideDustPaths: [{
      uid: 6, moteCount: 4, loop: false,
      points: [{ xBlock: 1, yBlock: 1 }, { xBlock: 3, yBlock: 4 }, { xBlock: 7, yBlock: 2 }],
    }] as never,
    spikes: [{ uid: 7, xBlock: 9, yBlock: 9 }] as never,
    playerSpawnBlock: [20, 20],
  });
}

const MIXED_SELECTION: SelectedElement[] = [
  { type: 'wall', uid: 1 },
  { type: 'enemy', uid: 2 },
  { type: 'zipMoveBlock', uid: 3 },
  { type: 'challengeField', uid: 4 },
  { type: 'transition', uid: 5 },
  { type: 'guideDustPath', uid: 6 },
  { type: 'spike', uid: 7 },
  { type: 'gate', uid: 8 },
  { type: 'challengeTotem', uid: 9 },
  { type: 'playerSpawn', uid: 0 },
];

function geometryOf(room: EditorRoomData): unknown {
  return JSON.parse(JSON.stringify({
    walls: room.interiorWalls, enemies: room.enemies,
    zip: room.zipMoveBlocks, fields: room.challengeFields,
    gates: room.gates, totems: room.challengeTotems,
    transitions: room.transitions, paths: room.guideDustPaths,
    spikes: room.spikes, spawn: room.playerSpawnBlock,
  }));
}

for (const [dx, dy] of [[3, 4], [-9, -9], [0, 0], [500, 500], [-500, 12]]) {
  test(`mixed-type selection: cache movement matches moveSelectedElements for delta (${dx}, ${dy})`, () => {
    // Reference path.
    const refState = createEditorState();
    refState.roomData = mixedRoom();
    refState.selectedElements = [...MIXED_SELECTION];
    const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
    storeDragStartPositions(refState, positions);
    moveSelectedElements(refState, positions, dx, dy);

    // Cache path.
    const cacheState = createEditorState();
    cacheState.roomData = mixedRoom();
    cacheState.selectedElements = [...MIXED_SELECTION];
    const cache = createDragTargetCache();
    buildDragTargetCache(cacheState, cache);
    applyDragDelta(cacheState, cache, dx, dy);

    assert.deepEqual(geometryOf(cacheState.roomData!), geometryOf(refState.roomData!));
  });
}

test('transition clamping keeps positionBlock in sync with the clamped axis', () => {
  const state = createEditorState();
  state.roomData = mixedRoom();
  state.selectedElements = [{ type: 'transition', uid: 5 }];
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);
  applyDragDelta(state, cache, 0, 5);
  const transition = state.roomData!.transitions[0] as unknown as { yBlock: number; positionBlock: number };
  assert.equal(transition.yBlock, 13);
  assert.equal(transition.positionBlock, 13, 'horizontal transition syncs positionBlock from y');
});

test('layer locked mid-drag freezes that element but not the rest', () => {
  const state = createEditorState();
  state.roomData = mixedRoom();
  state.selectedElements = [{ type: 'wall', uid: 1 }, { type: 'enemy', uid: 2 }];
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);
  applyDragDelta(state, cache, 2, 2);
  assert.deepEqual([state.roomData!.enemies[0].xBlock, state.roomData!.enemies[0].yBlock], [8, 8]);

  state.layers.enemies.locked = true;
  applyDragDelta(state, cache, 5, 5);
  assert.deepEqual(
    [state.roomData!.enemies[0].xBlock, state.roomData!.enemies[0].yBlock], [8, 8],
    'locked enemy must stop moving',
  );
  assert.deepEqual(
    [state.roomData!.interiorWalls[0].xBlock, state.roomData!.interiorWalls[0].yBlock], [10, 10],
    'still-editable wall keeps moving',
  );
});

test('return-to-origin restores exact pre-drag geometry (rollback path)', () => {
  const state = createEditorState();
  state.roomData = mixedRoom();
  state.selectedElements = [...MIXED_SELECTION];
  const before = geometryOf(state.roomData);
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);
  applyDragDelta(state, cache, 7, -3);
  assert.notDeepEqual(geometryOf(state.roomData), before);
  applyDragDelta(state, cache, 0, 0);   // rollback
  assert.deepEqual(geometryOf(state.roomData), before);
});

// ── Cache lifecycle ───────────────────────────────────────────────────────

test('resetDragTargetCache clears entries and the delta sentinel', () => {
  const { state } = makeLargeSelectionState(5);
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);
  applyDragDelta(state, cache, 3, 3);
  resetDragTargetCache(cache);
  assert.equal(cache.entries.length, 0);
  assert.equal(cache.room, null);
  // A rebuilt cache must apply on its first frame even at the same delta.
  buildDragTargetCache(state, cache);
  resetEditorPerfCounters();
  assert.equal(applyDragDelta(state, cache, 3, 3), true);
  assert.equal(editorPerfCounters.dragDeltaApplied, 1);
});

test('a room change invalidates the cache (no cross-room mutation)', () => {
  const state = createEditorState();
  state.roomData = mixedRoom();
  state.selectedElements = [{ type: 'wall', uid: 1 }];
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);

  const otherRoom = mixedRoom();
  state.roomData = otherRoom;
  const before = geometryOf(otherRoom);
  assert.equal(applyDragDelta(state, cache, 9, 9), false);
  assert.deepEqual(geometryOf(otherRoom), before);
});

test('a selection entry for a deleted element is simply skipped at build time', () => {
  const state = createEditorState();
  state.roomData = mixedRoom();
  state.selectedElements = [{ type: 'wall', uid: 1 }, { type: 'wall', uid: 999 }];
  const cache = createDragTargetCache();
  buildDragTargetCache(state, cache);
  assert.equal(cache.entries.length, 1);
});

test('non-draggable selected types are excluded, matching moveSelectedElements', () => {
  for (const type of ['campaignSpawn', 'ambientLightBlocker', 'kineticBlock',
    'grappleCarryBlock', 'phantasmalTile', 'pixelMaterial', 'rope', 'sceneLight',
    'dialogueTrigger', 'backgroundBlock', 'customBlock'] as const) {
    assert.equal(DRAG_MOVE_KINDS[type], undefined, `${type} must stay immovable`);
  }
});
