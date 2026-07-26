/**
 * Tests for Todo.md "Decouple editor block identities from compact
 * room-schema grouping": compact `solids.v1ByTheme` runs/points must expand
 * into independently editable per-cell `EditorWall`s on the editor load
 * path, while bulk `solids.byTheme` walls and special/atomic walls keep
 * their existing multi-cell semantics, and the runtime hydration fast path
 * (`hydrateSolidsByTheme` / `hydrateV2Room` without `forEditor`) stays
 * byte-for-byte unchanged.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonToEditorRoomData, editorRoomDataToJson } from '../editor/roomJson';
import type { RoomJsonDef } from '../editor/roomJsonSchema';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import {
  hydrateV2Room,
  hydrateSolidsByTheme,
  hydrateSolidsByThemeForEditor,
} from '../levels/roomSchemaHydrator';
import type { SavedSolids } from '../levels/roomSavedTypes';

test('runtime hydrateSolidsByTheme is unaffected by the editor split (v1ByTheme run stays merged)', () => {
  const solids: SavedSolids = {
    byTheme: {},
    v1ByTheme: { __default__: { runs: [[5, 2, 6]] } }, // y=5, x 2..6 -> 4 adjacent 1x1 walls
  };
  const runtimeWalls = hydrateSolidsByTheme(solids);
  assert.equal(runtimeWalls.length, 1);
  assert.deepEqual(runtimeWalls[0], { xBlock: 2, yBlock: 5, wBlock: 4, hBlock: 1 });
});

test('hydrateSolidsByThemeForEditor splits a v1ByTheme run into independent 1x1 walls', () => {
  const solids: SavedSolids = {
    byTheme: {},
    v1ByTheme: { __default__: { runs: [[5, 2, 6]] } },
  };
  const editorWalls = hydrateSolidsByThemeForEditor(solids);
  assert.equal(editorWalls.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(editorWalls[i], { xBlock: 2 + i, yBlock: 5, wBlock: 1, hBlock: 1 });
  }
});

test('hydrateSolidsByThemeForEditor leaves v1ByTheme points and byTheme bulk rects/runs untouched', () => {
  const solids: SavedSolids = {
    byTheme: { __default__: { rects: [[0, 0, 3, 3]], runs: [[8, 0, 5]] } },
    v1ByTheme: { __default__: { points: [[10, 10]] } },
  };
  const editorWalls = hydrateSolidsByThemeForEditor(solids);
  // 1 bulk rect + 1 bulk run + 1 v1 point (wBlock=1, no split needed) = 3 walls total.
  assert.equal(editorWalls.length, 3);
  assert.deepEqual(editorWalls[0], { xBlock: 0, yBlock: 0, wBlock: 3, hBlock: 3 });
  assert.deepEqual(editorWalls[1], { xBlock: 0, yBlock: 8, wBlock: 5, hBlock: 1 });
  assert.deepEqual(editorWalls[2], { xBlock: 10, yBlock: 10, wBlock: 1, hBlock: 1 });
});

test('adjacent same-theme 1x1 walls: save -> reopen in editor -> independent select/move/delete', () => {
  const sourceJson: RoomJsonDef = {
    id: 'adjacent_1x1',
    name: 'Adjacent 1x1',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [1, 1],
    interiorWalls: [
      { xBlock: 2, yBlock: 5, wBlock: 1, hBlock: 1 },
      { xBlock: 3, yBlock: 5, wBlock: 1, hBlock: 1 },
      { xBlock: 4, yBlock: 5, wBlock: 1, hBlock: 1 },
    ],
    enemies: [],
    transitions: [],
    skillTombs: [],
  };

  const original = jsonToEditorRoomData(sourceJson, 1000).data;
  assert.equal(original.interiorWalls.length, 3, 'authoring-time walls are already independent');

  // Compact-save: dehydrateRoom will coalesce the three 1x1 walls into one run.
  const compact = dehydrateRoom(editorRoomDataToJson(original));
  assert.ok(compact.solids.v1ByTheme, 'adjacent 1x1 walls are stored via v1ByTheme');
  const v1Layer = compact.solids.v1ByTheme!['__default__'];
  assert.equal(v1Layer?.runs?.length, 1, 'the three adjacent walls compress into a single run');

  // Runtime hydration (no forEditor) reconstructs ONE aggregate wall — this is
  // expected/fine for gameplay collision, which never needs per-cell identity.
  const runtimeJson = hydrateV2Room(compact);
  assert.equal(runtimeJson.interiorWalls.length, 1);
  assert.equal(runtimeJson.interiorWalls[0].wBlock, 3);

  // Editor reopen (forEditor: true) must restore three independent walls,
  // each occupying the same cell as before, each with its own UID.
  const reopenedJson = hydrateV2Room(compact, { forEditor: true });
  assert.equal(reopenedJson.interiorWalls.length, 3);
  const reopened = jsonToEditorRoomData(reopenedJson, 5000).data;
  assert.equal(reopened.interiorWalls.length, 3);
  const uids = reopened.interiorWalls.map(w => w.uid);
  assert.equal(new Set(uids).size, 3, 'every reopened wall has a distinct UID');
  const cells = reopened.interiorWalls.map(w => `${w.xBlock},${w.yBlock}`).sort();
  assert.deepEqual(cells, ['2,5', '3,5', '4,5']);
  for (const wall of reopened.interiorWalls) {
    assert.equal(wall.wBlock, 1);
    assert.equal(wall.hBlock, 1);
  }

  // Simulate "delete one block": only its own UID should be removable
  // without touching neighbours (the actual delete tool operates purely by
  // UID/index, so distinct UIDs are sufficient to prove independence here).
  const targetUid = reopened.interiorWalls.find(w => w.xBlock === 3)!.uid;
  const afterDelete = reopened.interiorWalls.filter(w => w.uid !== targetUid);
  assert.equal(afterDelete.length, 2);
  assert.deepEqual(afterDelete.map(w => `${w.xBlock},${w.yBlock}`).sort(), ['2,5', '4,5']);
});

test('true 2x2 walls, platforms, ramps, stairs, half-pillars, and Surface Rim overrides are never split', () => {
  const sourceJson: RoomJsonDef = {
    id: 'atomic_shapes',
    name: 'Atomic Shapes',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 30,
    heightBlocks: 30,
    playerSpawnBlock: [1, 1],
    rimStyles: [['s', 'ffaa00', 5, 0.5]],
    interiorWalls: [
      { xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 2 }, // true 2x2 sprite (exactWalls)
      { xBlock: 5, yBlock: 5, wBlock: 4, hBlock: 1, isPlatform: true }, // platform
      { xBlock: 10, yBlock: 10, wBlock: 3, hBlock: 1, rampOrientation: 1 }, // ramp
      { xBlock: 15, yBlock: 15, wBlock: 3, hBlock: 1, stairsOrientation: 2 }, // stairs
      { xBlock: 20, yBlock: 20, wBlock: 1, hBlock: 1, isPillarHalfWidth: true }, // half pillar
      { xBlock: 25, yBlock: 25, wBlock: 3, hBlock: 1, r: 0 }, // Surface Rim override run
    ],
    enemies: [],
    transitions: [],
    skillTombs: [],
  };

  const original = jsonToEditorRoomData(sourceJson, 1000).data;
  const compact = dehydrateRoom(editorRoomDataToJson(original));
  const reopenedJson = hydrateV2Room(compact, { forEditor: true });
  const reopened = jsonToEditorRoomData(reopenedJson, 9000).data;

  assert.equal(reopened.interiorWalls.length, 6, 'no atomic/special wall is split into extra units');
  const platform = reopened.interiorWalls.find(w => w.isPlatformFlag === 1);
  assert.equal(platform?.wBlock, 4);
  const ramp = reopened.interiorWalls.find(w => w.rampOrientation !== undefined);
  assert.equal(ramp?.wBlock, 3);
  const stairs = reopened.interiorWalls.find(w => w.stairsOrientation !== undefined);
  assert.equal(stairs?.wBlock, 3);
  const halfPillar = reopened.interiorWalls.find(w => w.isPillarHalfWidthFlag === 1);
  assert.ok(halfPillar);
  const rimWall = reopened.interiorWalls.find(w => w.surfaceRim !== undefined);
  assert.equal(rimWall?.wBlock, 3);
  const twoByTwo = reopened.interiorWalls.find(w => w.wBlock === 2 && w.hBlock === 2);
  assert.ok(twoByTwo, 'true 2x2 sprite survives as one atomic unit');
});

test('bulk solids.byTheme walls (hBlock > 1, not 1x1-grain compressed) are preserved atomic', () => {
  const solids: SavedSolids = {
    byTheme: { __default__: { rects: [[3, 3, 4, 5]] } }, // area 20 rect, hBlock=5
  };
  const editorWalls = hydrateSolidsByThemeForEditor(solids);
  assert.equal(editorWalls.length, 1);
  assert.deepEqual(editorWalls[0], { xBlock: 3, yBlock: 3, wBlock: 4, hBlock: 5 });
});

test('deterministic overlapping coverage and unchanged compact output on save', () => {
  const sourceJson: RoomJsonDef = {
    id: 'overlap_room',
    name: 'Overlap Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [1, 1],
    interiorWalls: [
      { xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 },
      { xBlock: 2, yBlock: 1, wBlock: 1, hBlock: 1 },
      { xBlock: 3, yBlock: 1, wBlock: 1, hBlock: 1 },
    ],
    enemies: [],
    transitions: [],
    skillTombs: [],
  };
  const original = jsonToEditorRoomData(sourceJson, 1000).data;
  const compactFirst = dehydrateRoom(editorRoomDataToJson(original));

  // Reopen in editor (splits back to 3), then re-export/save without any
  // edits: the next compact save must regroup back to the same shape.
  const reopened = jsonToEditorRoomData(hydrateV2Room(compactFirst, { forEditor: true }), 5000).data;
  const compactSecond = dehydrateRoom(editorRoomDataToJson(reopened));

  assert.deepEqual(compactSecond.solids, compactFirst.solids);
});

test('background blocks: compact bgLayers hydration is unaffected by the editor wall split', () => {
  const sourceJson: RoomJsonDef = {
    id: 'bg_room',
    name: 'Bg Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [1, 1],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    skillTombs: [],
    backgroundBlocks: [
      { xBlock: 6, yBlock: 6, wBlock: 1, hBlock: 1 },
      { xBlock: 7, yBlock: 6, wBlock: 1, hBlock: 1 },
    ],
  };
  const original = jsonToEditorRoomData(sourceJson, 1000).data;
  const compact = dehydrateRoom(editorRoomDataToJson(original));
  assert.ok(compact.bgLayers && compact.bgLayers.length > 0);

  const reopenedJson = hydrateV2Room(compact, { forEditor: true });
  const reopened = jsonToEditorRoomData(reopenedJson, 5000).data;
  // Background blocks: still hydrate to the same total occupied-cell coverage
  // (this schema has no v1/bulk provenance split like walls do, so the
  // editor-split boundary intentionally leaves them unchanged for now — see
  // nextSteps.md for the follow-up needed to fully decouple them too).
  assert.equal(reopened.backgroundBlocks?.length, 1);
  assert.equal(reopened.backgroundBlocks?.[0].wBlock, 2);
});

test('room round trip validation: editor split changes editor UIDs, not geometry or theme', () => {
  const sourceJson: RoomJsonDef = {
    id: 'roundtrip_room',
    name: 'Roundtrip Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [1, 1],
    blockTheme: 'blackRock',
    interiorWalls: [
      { xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1, blockTheme: 'blueCrystal' },
      { xBlock: 2, yBlock: 1, wBlock: 1, hBlock: 1, blockTheme: 'blueCrystal' },
    ],
    enemies: [],
    transitions: [],
    skillTombs: [],
  };
  const original = jsonToEditorRoomData(sourceJson, 1000).data;
  const compact = dehydrateRoom(editorRoomDataToJson(original));
  const reopenedJson = hydrateV2Room(compact, { forEditor: true });
  const reopened = jsonToEditorRoomData(reopenedJson, 5000).data;

  assert.equal(reopened.interiorWalls.length, 2);
  for (const wall of reopened.interiorWalls) {
    assert.equal(wall.blockTheme, 'blueCrystal');
    assert.equal(wall.hBlock, 1);
    assert.equal(wall.wBlock, 1);
  }
  // Occupied cells unchanged.
  assert.deepEqual(reopened.interiorWalls.map(w => `${w.xBlock},${w.yBlock}`).sort(), ['1,1', '2,1']);
});
