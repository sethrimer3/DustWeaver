/**
 * Tests extending crumble ("Cracked") support to the shapes previously
 * excluded from it: stairs (finishing the runtime path — editor/JSON support
 * already existed), half-width pillars, and smooth ramps (both entirely new).
 * Platforms remain the only permanently-excluded shape.
 *
 * Covers:
 *  - Editor conversion (Cracked toggle both directions) for half-pillar and
 *    smooth-ramp walls, preserving their shape fields.
 *  - Editor rotation cycling `smoothRampOrientation` on a crumble block.
 *  - Full-JSON and compact-V2 serialization round-trips carrying
 *    stairsOrientation/smoothRampOrientation/isPillarHalfWidthFlag (closing
 *    the previously-silent compact-format gap for crumble stairs too).
 *  - Runtime hydration: loadRoomHazards() packs the correct shape-orientation
 *    index and half-width footprint into the crumble block's wall slot for
 *    stairs, smooth ramps, and half-pillars (previously hardcoded to a plain
 *    255/non-pillar rectangle for ALL crumble blocks, including ramps).
 *  - Runtime collision: the shared collision geometry (aabbOverlapsWallSolid)
 *    treats an active crumble stairs/smooth-ramp/half-pillar exactly like its
 *    normal (non-crumble) counterpart, and stops colliding once broken.
 *  - Breaking: both the contact 2-hit path and the momentum-attack instant
 *    shatter path work identically regardless of shape.
 *  - Reset/respawn: loadRoomHazards() rebuilding from scratch restores a
 *    previously-broken crumble block of every shape to full, solid health.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createEditorState } from '../editor/editorState';
import type { EditorRoomData, EditorWall } from '../editor/editorElementTypes';
import { rotateSelectedElement } from '../editor/editorTools';
import { handleCrumbleModifierToggle } from '../editor/editorPropertyChange';
import { createEditorHistory } from '../editor/editorHistory';
import { editorRoomDataToJson } from '../editor/roomJsonSerializer';
import { jsonToEditorRoomData } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { hasWallOverlapAtPosition } from '../sim/clusters/movementAxisResolvers';
import { tryShatterCrumbleBlockAtWall } from '../sim/crackedBlockShatter';
import { applyHazards } from '../sim/hazards';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import {
  isStairsOrientationIndex, isSmoothRampOrientationIndex,
} from '../levels/stairsGeometry';
import type { RoomDef } from '../levels/roomDef';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    blockTheme: 'blackRock',
    backgroundId: 'cave',
    lightingEffect: 'DEFAULT',
    songId: '_continue',
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [18, 18],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    dustContainers: [],
    dustContainerPieces: [],
    dustBoostJars: [],
    dustSwarms: [],
    lambdaAnchors: [],
    dustPiles: [],
    grasshopperAreas: [],
    fireflyAreas: [],
    decorations: [],
    ambientLightBlockers: [],
    lightSources: [],
    crumbleBlocks: [],
    spikes: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Editor conversion: half-pillar ──────────────────────────────────────────

test('handleCrumbleModifierToggle(true) converts a half-width pillar wall into a crumble block, preserving the pillar flag', () => {
  const room = makeRoom({
    interiorWalls: [{
      uid: 100, xBlock: 3, yBlock: 3, wBlock: 1, hBlock: 2,
      isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 1, blockTheme: 'blackRock',
    } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 100 }];
  const history = createEditorHistory();

  const changed = handleCrumbleModifierToggle(state, history, true);
  assert.equal(changed, true, 'half-pillars must now be eligible for cracking (only platforms are excluded)');
  assert.equal(room.interiorWalls.length, 0);
  const block = room.crumbleBlocks![0];
  assert.equal(block.isPillarHalfWidthFlag, 1);
  assert.equal(block.xBlock, 3);
  assert.equal(block.hBlock, 2);

  const history2 = createEditorHistory();
  const changedBack = handleCrumbleModifierToggle(state, history2, false);
  assert.equal(changedBack, true);
  const wall = room.interiorWalls[0] as EditorWall;
  assert.equal(wall.isPillarHalfWidthFlag, 1, 'pillar flag must survive un-cracking');
  assert.equal(wall.hBlock, 2);
});

// ── Editor conversion: smooth ramp ──────────────────────────────────────────

test('handleCrumbleModifierToggle(true) converts a smooth-ramp wall into a crumble block, preserving smoothRampOrientation', () => {
  const room = makeRoom({
    interiorWalls: [{
      uid: 101, xBlock: 4, yBlock: 4, wBlock: 2, hBlock: 2,
      isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0, smoothRampOrientation: 2,
    } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 101 }];
  const history = createEditorHistory();

  const changed = handleCrumbleModifierToggle(state, history, true);
  assert.equal(changed, true, 'smooth ramps must now be eligible for cracking');
  const block = room.crumbleBlocks![0];
  assert.equal(block.smoothRampOrientation, 2);
  assert.equal(block.wBlock, 2);
  assert.equal(block.hBlock, 2);

  const history2 = createEditorHistory();
  const changedBack = handleCrumbleModifierToggle(state, history2, false);
  assert.equal(changedBack, true);
  const wall = room.interiorWalls[0] as EditorWall;
  assert.equal(wall.smoothRampOrientation, 2, 'smooth-ramp orientation must survive un-cracking');
});

test('rotateSelectedElement cycles a crumble smooth-ramp block orientation', () => {
  const room = makeRoom({
    crumbleBlocks: [{ uid: 102, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, smoothRampOrientation: 0, variant: 'normal' } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'crumbleBlock', uid: 102 }];
  const changed = rotateSelectedElement(state);
  assert.equal(changed, true);
  assert.equal(room.crumbleBlocks![0].smoothRampOrientation, 1);
});

// ── Serialization round-trip ─────────────────────────────────────────────────

test('full-JSON round trip preserves crumble smoothRampOrientation and isPillarHalfWidthFlag', () => {
  const room = makeRoom({
    crumbleBlocks: [
      { uid: 110, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1, smoothRampOrientation: 3, variant: 'ice' } as never,
      { uid: 111, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 2, isPillarHalfWidthFlag: 1, variant: 'normal' } as never,
    ],
  });
  const json = editorRoomDataToJson(room);
  const { data: rehydrated } = jsonToEditorRoomData(json, 1000);
  const ramp = rehydrated.crumbleBlocks!.find(b => b.xBlock === 1)!;
  assert.equal(ramp.smoothRampOrientation, 3);
  const pillar = rehydrated.crumbleBlocks!.find(b => b.xBlock === 2)!;
  assert.equal(pillar.isPillarHalfWidthFlag, 1);
});

test('compact V2 round trip preserves crumble stairsOrientation (previously silently dropped), smoothRampOrientation, and isPillarHalfWidthFlag', () => {
  const room = makeRoom({
    crumbleBlocks: [
      { uid: 120, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, stairsOrientation: 2, variant: 'normal' } as never,
      { uid: 121, xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, smoothRampOrientation: 1, variant: 'fire' } as never,
      { uid: 122, xBlock: 2, yBlock: 0, wBlock: 1, hBlock: 2, isPillarHalfWidthFlag: 1, variant: 'void' } as never,
    ],
  });
  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  assert.equal(saved.crumbles?.length, 3);

  const stairsEntry = saved.crumbles!.find(c => c.r[0] === 0)!;
  assert.equal(stairsEntry.stairs, 2, 'stairsOrientation must survive the compact V2 dehydrate step');

  const rampEntry = saved.crumbles!.find(c => c.r[0] === 1)!;
  assert.equal(rampEntry.smoothRamp, 1);

  const pillarEntry = saved.crumbles!.find(c => c.r[0] === 2)!;
  assert.equal(pillarEntry.pillar, 1);

  const rehydratedJson = hydrateV2Room(saved);
  const stairsBack = rehydratedJson.crumbleBlocks!.find(c => c.xBlock === 0)!;
  assert.equal(stairsBack.stairsOrientation, 2);
  const rampBack = rehydratedJson.crumbleBlocks!.find(c => c.xBlock === 1)!;
  assert.equal(rampBack.smoothRampOrientation, 1);
  const pillarBack = rehydratedJson.crumbleBlocks!.find(c => c.xBlock === 2)!;
  assert.equal(pillarBack.isPillarHalfWidthFlag, 1);
});

// ── Runtime hydration ────────────────────────────────────────────────────────

function makeWorldWithPlayer(px: number, py: number): WorldState {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, px, py, 1, 10);
  player.halfWidthWorld = 3;
  player.halfHeightWorld = 3;
  world.clusters = [player];
  return world;
}

test('loadRoomHazards packs a crumble stairs block into the wall array with the correct shape-orientation index', () => {
  const world = makeWorldWithPlayer(0, 0);
  const room = {
    crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, stairsOrientation: 0, variant: 'normal' }],
  } as unknown as RoomDef;
  loadRoomHazards(world, room);
  assert.equal(world.crumbleBlockCount, 1);
  const wi = world.crumbleBlockWallIndex[0];
  assert.ok(wi >= 0);
  assert.equal(isStairsOrientationIndex(world.wallRampOrientationIndex[wi]), true,
    'crumble stairs must no longer be hardcoded to a plain rectangle (255)');
});

test('loadRoomHazards packs a crumble smooth ramp with the smooth-ramp orientation index', () => {
  const world = makeWorldWithPlayer(0, 0);
  const room = {
    crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, smoothRampOrientation: 1, variant: 'normal' }],
  } as unknown as RoomDef;
  loadRoomHazards(world, room);
  const wi = world.crumbleBlockWallIndex[0];
  assert.equal(isSmoothRampOrientationIndex(world.wallRampOrientationIndex[wi]), true);
});

test('loadRoomHazards narrows a crumble half-pillar wall slot to half BLOCK_SIZE_MEDIUM width, mirroring normal pillar walls', () => {
  const world = makeWorldWithPlayer(0, 0);
  const room = {
    crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 2, isPillarHalfWidthFlag: 1, variant: 'normal' }],
  } as unknown as RoomDef;
  loadRoomHazards(world, room);
  const wi = world.crumbleBlockWallIndex[0];
  assert.equal(world.wallIsPillarHalfWidthFlag[wi], 1);
  assert.equal(world.wallWWorld[wi], BLOCK_SIZE_MEDIUM / 2, 'width must be halved exactly like gameRoomWalls.ts does for normal pillars');
  assert.equal(world.wallHWorld[wi], 2 * BLOCK_SIZE_MEDIUM, 'height is unaffected by the pillar narrowing');
});

// ── Runtime collision ────────────────────────────────────────────────────────

test('an active crumble stairs block collides using its real stepped geometry, and stops colliding once broken', () => {
  const world = makeWorldWithPlayer(0, 0);
  // stairsOrientation 0 = rises right: solid cell test is col+row >= stepCount-1,
  // so the bottom-left cell (row = stepCount-1, col = 0) is always solid,
  // and the top-right-most cell (row=0, col=0) is never solid at orientation 0.
  const room = {
    crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, stairsOrientation: 0, variant: 'normal' }],
  } as unknown as RoomDef;
  loadRoomHazards(world, room);
  const wi = world.crumbleBlockWallIndex[0];
  const player = world.clusters[0];

  // Bottom-left corner of the tile is always solid regardless of orientation
  // (col=0,row=stepCount-1 satisfies col+row>=stepCount-1 for any stepCount).
  const bottomLeftX = world.wallXWorld[wi] + 0.5;
  const bottomLeftY = world.wallYWorld[wi] + world.wallHWorld[wi] - 0.5;
  assert.equal(hasWallOverlapAtPosition(player, world, bottomLeftX, bottomLeftY), true,
    'the player must collide with the stair step geometry while active');

  // Break it (contact-based path — 2 hits).
  world.crumbleBlockHitsRemaining[0] = 1;
  player.positionXWorld = bottomLeftX;
  player.positionYWorld = bottomLeftY;
  applyHazards(world);
  assert.equal(world.isCrumbleBlockActiveFlag[0], 0, 'second hit must destroy the block');
  assert.equal(hasWallOverlapAtPosition(player, world, bottomLeftX, bottomLeftY), false,
    'a broken crumble stairs block must stop colliding entirely');
});

test('an active crumble half-pillar collides only across its narrow half-width footprint', () => {
  const world = makeWorldWithPlayer(0, 0);
  const room = {
    crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, isPillarHalfWidthFlag: 1, variant: 'normal' }],
  } as unknown as RoomDef;
  loadRoomHazards(world, room);
  const wi = world.crumbleBlockWallIndex[0];
  const player = world.clusters[0];

  const halfWidth = world.wallWWorld[wi]; // already BLOCK_SIZE_MEDIUM/2
  const insideNarrowX = world.wallXWorld[wi] + halfWidth * 0.5;
  const outsideNarrowButInsideFullBlockX = world.wallXWorld[wi] + BLOCK_SIZE_MEDIUM * 0.9;
  const yCenter = world.wallYWorld[wi] + world.wallHWorld[wi] * 0.5;

  assert.equal(hasWallOverlapAtPosition(player, world, insideNarrowX, yCenter), true);
  assert.equal(hasWallOverlapAtPosition(player, world, outsideNarrowButInsideFullBlockX, yCenter), false,
    'collision must respect the narrowed footprint, not the full authored block width');

  // Velocity-based instant shatter (momentum-attack impact path).
  const shattered = tryShatterCrumbleBlockAtWall(world, wi, insideNarrowX, yCenter, -1, 0, 500);
  assert.equal(shattered, true);
  assert.equal(world.isCrumbleBlockActiveFlag[0], 0);
  assert.equal(hasWallOverlapAtPosition(player, world, insideNarrowX, yCenter), false,
    'a shattered half-pillar must stop colliding immediately');
});

test('an active crumble smooth ramp uses identical stepped collision to crumble stairs, and stops colliding once broken', () => {
  const world = makeWorldWithPlayer(0, 0);
  const room = {
    crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, smoothRampOrientation: 0, variant: 'normal' }],
  } as unknown as RoomDef;
  loadRoomHazards(world, room);
  const wi = world.crumbleBlockWallIndex[0];
  const player = world.clusters[0];

  const bottomLeftX = world.wallXWorld[wi] + 0.5;
  const bottomLeftY = world.wallYWorld[wi] + world.wallHWorld[wi] - 0.5;
  assert.equal(hasWallOverlapAtPosition(player, world, bottomLeftX, bottomLeftY), true);

  const shattered = tryShatterCrumbleBlockAtWall(world, wi, bottomLeftX, bottomLeftY, 0, -1, 500);
  assert.equal(shattered, true);
  assert.equal(hasWallOverlapAtPosition(player, world, bottomLeftX, bottomLeftY), false);
});

// ── Reset / respawn restoration ──────────────────────────────────────────────

for (const [label, shapeField] of [
  ['stairs', { stairsOrientation: 0 }],
  ['smooth ramp', { smoothRampOrientation: 0 }],
  ['half-pillar', { isPillarHalfWidthFlag: 1 }],
] as const) {
  test(`a broken crumble ${label} block is fully restored (active, solid geometry) when loadRoomHazards reloads the room`, () => {
    const world = makeWorldWithPlayer(0, 0);
    const room = {
      crumbleBlocks: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, variant: 'normal', ...shapeField }],
    } as unknown as RoomDef;
    loadRoomHazards(world, room);
    const wi = world.crumbleBlockWallIndex[0];
    const player = world.clusters[0];

    tryShatterCrumbleBlockAtWall(world, wi, 0, 0, 0, -1, 500);
    assert.equal(world.isCrumbleBlockActiveFlag[0], 0);
    assert.equal(world.wallWWorld[wi], 0, 'broken geometry must be zeroed');

    // Simulate a full room reload (the documented restoration mechanism —
    // see crackedBlockShatter.ts's comment): rebuild from the same RoomDef.
    loadRoomHazards(world, room);
    assert.equal(world.crumbleBlockCount, 1);
    const wi2 = world.crumbleBlockWallIndex[0];
    assert.equal(world.isCrumbleBlockActiveFlag[0], 1, 'reload must restore the active flag');
    assert.ok(world.wallWWorld[wi2] > 0, 'reload must restore real (non-zero) solid geometry');

    const checkX = world.wallXWorld[wi2] + 0.5;
    const checkY = world.wallYWorld[wi2] + world.wallHWorld[wi2] - 0.5;
    assert.equal(hasWallOverlapAtPosition(player, world, checkX, checkY), true,
      'restored block must collide again after reload');
  });
}
