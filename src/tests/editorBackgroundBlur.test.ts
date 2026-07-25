/**
 * editorBackgroundBlur.test.ts — Coverage for the "Use blurred version"
 * background option: catalogue blur-URL discovery and RoomJsonDef /
 * SavedRoomV2 round-trip of the optional `backgroundBlur` flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundIdToBlurUrl, BACKGROUND_OPTIONS } from '../render/backgroundCatalogue';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import type { EditorRoomData } from '../editor/editorElementTypes';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'bg_blur_test', name: 'Blur Test', worldNumber: 1,
    mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [],
    ...overrides,
  } as EditorRoomData;
}

test('backgroundIdToBlurUrl returns null for procedural backgrounds', () => {
  assert.equal(backgroundIdToBlurUrl('crystallineCracks'), null);
  assert.equal(backgroundIdToBlurUrl('thero_ch1'), null);
});

test('backgroundIdToBlurUrl returns null for an unknown id', () => {
  assert.equal(backgroundIdToBlurUrl('__not_a_real_background__' as never), null);
});

test('BACKGROUND_OPTIONS entries always expose a blurUrl field (null or string)', () => {
  for (const opt of BACKGROUND_OPTIONS) {
    assert.ok(opt.blurUrl === null || typeof opt.blurUrl === 'string');
    if (opt.isProcedural) assert.equal(opt.blurUrl, null);
  }
});

test('room JSON round-trip omits backgroundBlur entirely when false/unset', () => {
  const room = makeRoom({ backgroundBlur: undefined });
  const json = editorRoomDataToJson(room);
  assert.equal('backgroundBlur' in json, false);
  const { data } = jsonToEditorRoomData(json, 1);
  assert.equal(data.backgroundBlur, undefined);
});

test('room JSON round-trip preserves backgroundBlur: true', () => {
  const room = makeRoom({ backgroundBlur: true });
  const json = editorRoomDataToJson(room);
  assert.equal(json.backgroundBlur, true);
  const { data } = jsonToEditorRoomData(json, 1);
  assert.equal(data.backgroundBlur, true);
});

test('loading JSON without backgroundBlur never fabricates the field (backward compatibility)', () => {
  const room = makeRoom();
  const json = editorRoomDataToJson(room);
  delete (json as { backgroundBlur?: true }).backgroundBlur;
  const { data } = jsonToEditorRoomData(json, 1);
  assert.equal(data.backgroundBlur, undefined);
});
