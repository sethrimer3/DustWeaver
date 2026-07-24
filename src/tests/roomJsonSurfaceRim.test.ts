/**
 * roomJsonSurfaceRim.test.ts — Coverage for the compact, deduplicated Surface
 * Rim style table in room JSON (RoomJsonDef.rimStyles / RoomJsonWall.r).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { EditorWall } from '../editor/editorElementTypes';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import type { RoomJsonDef } from '../editor/roomJsonSchema';
import { normalizeSurfaceRimStyle, surfaceRimStylesEqual, DEFAULT_SURFACE_RIM_STYLE } from '../render/walls/surfaceRimStyle';

function makeRoom(interiorWalls: EditorWall[]): EditorRoomData {
  return {
    id: 'rim_test_room',
    name: 'Rim Test Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    blockTheme: 'blackRock',
    backgroundId: 'cave',
    lightingEffect: 'DEFAULT',
    songId: '_continue',
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [2, 2],
    interiorWalls,
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
    backgroundBlocks: [],
  } as unknown as EditorRoomData;
}

function makeWall(uid: number, overrides: Partial<EditorWall> = {}): EditorWall {
  return {
    uid,
    xBlock: uid, yBlock: 0, wBlock: 1, hBlock: 1,
    isPlatformFlag: 0, platformEdge: 0,
    isPillarHalfWidthFlag: 0,
    ...overrides,
  } as EditorWall;
}

test('a wall with no surfaceRim omits `r` and the room omits `rimStyles` entirely', () => {
  const room = makeRoom([makeWall(0)]);
  const json = editorRoomDataToJson(room);
  assert.equal(json.interiorWalls[0].r, undefined);
  assert.equal(json.rimStyles, undefined);
});

test('a wall with the explicit default style also omits `r` (default is never interned)', () => {
  const room = makeRoom([makeWall(0, { surfaceRim: DEFAULT_SURFACE_RIM_STYLE })]);
  const json = editorRoomDataToJson(room);
  assert.equal(json.interiorWalls[0].r, undefined);
  assert.equal(json.rimStyles, undefined);
});

test('identical non-default styles on different walls are deduplicated to one table entry', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff7a18', widthPx: 3, opacity: 0.5 });
  const room = makeRoom([
    makeWall(0, { surfaceRim: style }),
    makeWall(1, { surfaceRim: style }),
    makeWall(2, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'none' }) }),
  ]);
  const json = editorRoomDataToJson(room);
  assert.equal(json.rimStyles!.length, 2, 'two distinct styles -> two table entries');
  assert.equal(json.interiorWalls[0].r, json.interiorWalls[1].r, 'identical styles share the same table index');
  assert.notEqual(json.interiorWalls[0].r, json.interiorWalls[2].r);
});

test('round trip: editor -> json -> editor preserves every non-default style exactly', () => {
  const styles = [
    normalizeSurfaceRimStyle({ mode: 'none' }),
    normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff7a18', widthPx: 3, opacity: 0.5 }),
    normalizeSurfaceRimStyle({ mode: 'gradient', color: '63d9ff', widthPx: 8, opacity: 0.6, falloff: 'exponential' }),
    normalizeSurfaceRimStyle({ mode: 'inverted', color: 'd24cff', widthPx: 5, opacity: 0.7, falloff: 'smooth', interiorDarkness: 0.9 }),
  ];
  const room = makeRoom(styles.map((s, i) => makeWall(i, { surfaceRim: s })));
  const json = editorRoomDataToJson(room);
  const { data } = jsonToEditorRoomData(json, 1000);

  data.interiorWalls.forEach((w, i) => {
    assert.ok(w.surfaceRim, `wall ${i} should have a decoded surfaceRim`);
    assert.ok(surfaceRimStylesEqual(w.surfaceRim!, styles[i]), `wall ${i} style mismatch after round trip`);
  });
});

test('unused styles are not written to the table (dedup table only contains referenced styles)', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'abcdef', widthPx: 2, opacity: 0.2 });
  const room = makeRoom([makeWall(0, { surfaceRim: style })]);
  const json = editorRoomDataToJson(room);
  assert.equal(json.rimStyles!.length, 1);
});

test('backward compatibility: an older room JSON with no `r`/`rimStyles` fields loads with surfaceRim undefined on every wall', () => {
  const json: RoomJsonDef = {
    id: 'legacy_room',
    name: 'Legacy Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 15,
    playerSpawnBlock: [5, 5],
    interiorWalls: [
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1 },
      { xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, isPlatform: true },
    ],
    enemies: [],
    transitions: [],
    skillTombs: [],
  } as unknown as RoomJsonDef;

  const { data } = jsonToEditorRoomData(json, 0);
  for (const w of data.interiorWalls) {
    assert.equal(w.surfaceRim, undefined);
  }
});

test('a wall referencing an out-of-range `r` index degrades to the default style rather than throwing', () => {
  const json: RoomJsonDef = {
    id: 'corrupt_room',
    name: 'Corrupt Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 15,
    playerSpawnBlock: [5, 5],
    interiorWalls: [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, r: 99 }],
    rimStyles: [['s', 'ff0000', 3, 0.5]],
    enemies: [],
    transitions: [],
    skillTombs: [],
  } as unknown as RoomJsonDef;

  const { data } = jsonToEditorRoomData(json, 0);
  assert.ok(surfaceRimStylesEqual(data.interiorWalls[0].surfaceRim!, DEFAULT_SURFACE_RIM_STYLE));
});
