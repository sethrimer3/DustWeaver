/**
 * Phase 3: declarative element-adapter registry + marquee parity.
 *
 * Verifies:
 *  - Every SelectedElementType has a registered adapter (exhaustiveness).
 *  - Click hit-test priority is unchanged for several element types in
 *    overlap scenarios (same ordering as the old hand-written scan).
 *  - Every previously click-selectable type is now also marquee-selectable,
 *    closing the parity gap the old hand-written `getAllElementsInRect` had.
 *  - Marquee respects layer visibility/lock/solo/select-only restrictions.
 *  - Partial rectangle intersection includes an element; a non-intersecting
 *    rectangle excludes it.
 *  - A marquee spanning multiple layers selects from all of them at once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData, SelectedElementType } from '../editor/editorElementTypes';
import { ELEMENT_ADAPTERS, ALL_ELEMENT_TYPES } from '../editor/editorElementRegistry';
import { getAllElementsInRect, selectAtCursor } from '../editor/editorTools';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 30, heightBlocks: 30, playerSpawnBlock: [28, 28],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Exhaustiveness ─────────────────────────────────────────────────────────

const EXPECTED_TYPES: readonly SelectedElementType[] = [
  'wall', 'enemy', 'transition', 'saveTomb', 'skillTomb', 'challengeField', 'challengeGate',
  'gate', 'challengeTotem', 'dustContainer', 'dustContainerPiece', 'dustBoostJar', 'dustSwarm',
  'lambdaAnchor', 'dustPile', 'grasshopperArea', 'fireflyArea', 'decoration', 'playerSpawn',
  'campaignSpawn', 'ambientLightBlocker', 'lightSource', 'waterZone', 'lavaZone', 'timeStopField',
  'poisonField',
  'crumbleBlock', 'spike', 'laser', 'bouncePad', 'kineticBlock', 'grappleCarryBlock', 'zipMoveBlock',
  'phantasmalTile', 'pixelMaterial', 'rope', 'sunbeam', 'sceneLight', 'fallingBlock',
  'dialogueTrigger', 'backgroundBlock', 'guideDustPath', 'customBlock', 'fireflyJar',
  'springboard', 'breakableBlock',
];

test('every SelectedElementType has a registered adapter', () => {
  for (const type of EXPECTED_TYPES) {
    assert.ok(ELEMENT_ADAPTERS[type] !== undefined, `missing adapter for ${type}`);
    assert.equal(ELEMENT_ADAPTERS[type].elementType, type);
  }
  assert.equal(ALL_ELEMENT_TYPES.length, EXPECTED_TYPES.length);
});

// ── Click priority unchanged ───────────────────────────────────────────────

test('click priority: transition beats everything else at the same cell', () => {
  const room = makeRoom({
    transitions: [{ uid: 1, direction: 'right', xBlock: 5, yBlock: 5, openingSizeBlocks: 3, targetRoomId: '', targetSpawnBlock: [0, 0], positionBlock: 5 }],
    enemies: [{ uid: 2, xBlock: 5, yBlock: 5, kinds: [], particleCount: 0 } as never],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  const clicked = selectAtCursor(state);
  assert.equal(clicked?.type, 'transition');
});

test('click priority: enemy beats save tomb at the same cell', () => {
  const room = makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, kinds: [], particleCount: 0 } as never],
    saveTombs: [{ uid: 2, xBlock: 5, yBlock: 5 }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  assert.equal(selectAtCursor(state)?.type, 'enemy');
});

test('click priority: wall is lower priority than dialogue trigger at the same cell', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
    dialogueTriggers: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 4, hBlock: 4, conversationId: 'c', conversationTitle: '', entries: [] }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  assert.equal(selectAtCursor(state)?.type, 'dialogueTrigger');
});

test('click priority: ambient-light blocker is lowest priority (below wall)', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
    ambientLightBlockers: [{ uid: 2, xBlock: 5, yBlock: 5, isDarkFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  assert.equal(selectAtCursor(state)?.type, 'wall');
});

test('click priority: crumble block beats falling block tile at the same cell', () => {
  const room = makeRoom({
    crumbleBlocks: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, variant: 'normal' } as never],
    fallingBlocks: [{ uid: 2, xBlock: 5, yBlock: 5, variant: 'tough' } as never],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  assert.equal(selectAtCursor(state)?.type, 'crumbleBlock');
});

// ── Marquee parity ─────────────────────────────────────────────────────────

test('every previously-missing marquee type is now selectable (challengeField, gate, guideDustPath, customBlock, sceneLight, kineticBlock, campaignSpawn)', () => {
  const room = makeRoom({
    challengeFields: [{ uid: 1, xBlock: 2, yBlock: 2, wBlock: 2, hBlock: 2 }],
    challengeGates: [{ uid: 2, xBlock: 6, yBlock: 6, wBlock: 2, hBlock: 2 }],
    gates: [{ schemaVersion: 1, uid: 3, kind: 'heart', xBlock: 10, yBlock: 10, wBlock: 2, hBlock: 2, openVisualMode: 'fadeAway', openPersistence: 'untilPlayerLeavesRoom' } as never],
    zipMoveBlocks: [{ uid: 4, xBlock: 14, yBlock: 14, wBlock: 3, hBlock: 3, variant: 'toward' }],
    dialogueTriggers: [{ uid: 5, xBlock: 18, yBlock: 18, wBlock: 4, hBlock: 4, conversationId: 'c', conversationTitle: '', entries: [] }],
    guideDustPaths: [{ uid: 6, points: [{ xBlock: 1, yBlock: 1, speed: 1 }, { xBlock: 3, yBlock: 3, speed: 1 }], loop: false, visibleInGame: true, moteCount: 8, moteSpeedFactor: 1, opacityPct: 100 }],
    customBlockPlacements: [{ uid: 7, xBlock: 22, yBlock: 22, blockId: 'x', tileWidth: 1, tileHeight: 1 }],
    sceneLights: [{ uid: 8, xWorld: 0, yWorld: 0 } as never],
    kineticBlocks: [{ uid: 9, xBlock: 25, yBlock: 0, wBlock: 1, hBlock: 1 }],
    challengeTotems: [{ uid: 10, xBlock: 0, yBlock: 25 }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.campaignSpawnBlock = [27, 27];

  const all = getAllElementsInRect(state, room, 0, 0, 29, 29);
  const types = new Set(all.map(e => e.type));
  for (const t of [
    'challengeField', 'challengeGate', 'gate', 'zipMoveBlock', 'dialogueTrigger',
    'guideDustPath', 'customBlock', 'sceneLight', 'kineticBlock', 'challengeTotem', 'campaignSpawn',
  ] as const) {
    assert.ok(types.has(t), `expected marquee to include ${t}`);
  }
});

test('rope is marquee-selectable via its anchor bounding box', () => {
  const room = makeRoom({
    ropes: [{
      uid: 1, anchorAXBlock: 2, anchorAYBlock: 2, anchorBXBlock: 6, anchorBYBlock: 6,
      segmentCount: 4, isAnchorBFixedFlag: 1, destructibility: 'indestructible', thicknessIndex: 0,
    }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  const inRange = getAllElementsInRect(state, room, 0, 0, 8, 8);
  assert.ok(inRange.some(e => e.type === 'rope'));
  const outOfRange = getAllElementsInRect(state, room, 20, 20, 25, 25);
  assert.ok(!outOfRange.some(e => e.type === 'rope'));
});

// ── Layer restriction respected by marquee ────────────────────────────────

test('marquee excludes elements on a locked layer', () => {
  const room = makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, kinds: [], particleCount: 0 } as never],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.enemies.locked = true;
  const result = getAllElementsInRect(state, room, 0, 0, 10, 10);
  assert.ok(!result.some(e => e.type === 'enemy'));
});

test('marquee excludes elements on a hidden layer', () => {
  const room = makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, kinds: [], particleCount: 0 } as never],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.enemies.visible = false;
  const result = getAllElementsInRect(state, room, 0, 0, 10, 10);
  assert.ok(!result.some(e => e.type === 'enemy'));
});

test('marquee excludes non-select-only layers when select-only is active elsewhere', () => {
  const room = makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, kinds: [], particleCount: 0 } as never],
    saveTombs: [{ uid: 2, xBlock: 5, yBlock: 5 }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.objects.selectOnly = true; // saveTomb lives on 'objects'
  const result = getAllElementsInRect(state, room, 0, 0, 10, 10);
  assert.ok(!result.some(e => e.type === 'enemy'), 'enemies layer is not select-only, must be excluded');
  assert.ok(result.some(e => e.type === 'saveTomb'), 'objects layer is select-only, must be included');
});

// ── Partial/non intersection ───────────────────────────────────────────────

test('a rectangle element partially inside the marquee is included', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 4, yBlock: 4, wBlock: 4, hBlock: 4, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  // Marquee only overlaps the wall's top-left corner.
  const result = getAllElementsInRect(state, room, 0, 0, 4, 4);
  assert.ok(result.some(e => e.type === 'wall' && e.uid === 1));
});

test('a rectangle element fully outside the marquee is excluded', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 4, yBlock: 4, wBlock: 2, hBlock: 2, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  const result = getAllElementsInRect(state, room, 10, 10, 15, 15);
  assert.ok(!result.some(e => e.type === 'wall' && e.uid === 1));
});

// ── Multi-layer marquee ────────────────────────────────────────────────────

test('a single marquee selects elements from multiple layers at once', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
    enemies: [{ uid: 2, xBlock: 4, yBlock: 4, kinds: [], particleCount: 0 } as never],
    spikes: [{ uid: 3, xBlock: 6, yBlock: 6, direction: 'up', size: '1x1' }],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  const result = getAllElementsInRect(state, room, 0, 0, 8, 8);
  const types = new Set(result.map(e => e.type));
  assert.ok(types.has('wall'));
  assert.ok(types.has('enemy'));
  assert.ok(types.has('spike'));
});

// ── Preflight side-effect check for the registry itself ───────────────────

test('enumerate/hitTest/marqueeTest never mutate room data', () => {
  const room = makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, kinds: [], particleCount: 0 } as never],
  } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  const snapshot = JSON.stringify(room);
  const adapter = ELEMENT_ADAPTERS.enemy;
  for (const el of adapter.enumerate(state, room)) {
    adapter.hitTest(el, 5, 5, room);
    adapter.marqueeTest(el, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, room);
  }
  assert.equal(JSON.stringify(room), snapshot);
});
