import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEditorState, EditorTool } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
import { placeAtCursor } from '../editor/editorPlaceTool';
import { editorRoomDataToJson } from '../editor/roomJsonSerializer';
import { jsonToEditorRoomData } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';
import type { RoomDef } from '../levels/roomDef';
import { createWorldState } from '../sim/world';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import { resetSecretCrumbleBlocksInWorld } from '../screens/residentRoomManager';

function makeEditorRoom(): EditorRoomData {
  return {
    id: 'secret_test',
    name: 'Secret Test',
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
  } as unknown as EditorRoomData;
}

test('Secret Block modifier creates a secret crumble block and survives JSON/V2 round trips', () => {
  const state = createEditorState();
  state.roomData = makeEditorRoom();
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = PALETTE_ITEMS.find(item => item.id === 'block_1x1')!;
  state.pendingBlockPlacementModifier = 'secret';
  state.cursorBlockX = 4;
  state.cursorBlockY = 5;

  assert.equal(placeAtCursor(state), true);
  assert.equal(state.roomData.crumbleBlocks?.[0].isSecretFlag, 1);

  const json = editorRoomDataToJson(state.roomData);
  assert.equal(json.crumbleBlocks?.[0].isSecretFlag, 1);
  assert.equal(jsonToEditorRoomData(json, 1).data.crumbleBlocks?.[0].isSecretFlag, 1);

  const hydrated = hydrateV2Room(dehydrateRoom(json));
  assert.equal(hydrated.crumbleBlocks?.[0].isSecretFlag, 1);
});

test('save/death reset restores only Secret Blocks, including solid geometry', () => {
  const room = {
    crumbleBlocks: [
      { xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1, isSecretFlag: 1 },
      { xBlock: 3, yBlock: 1, wBlock: 1, hBlock: 1 },
    ],
  } as unknown as RoomDef;
  const world = createWorldState();
  loadRoomHazards(world, room);

  for (let i = 0; i < 2; i++) {
    world.isCrumbleBlockActiveFlag[i] = 0;
    world.crumbleBlockHitsRemaining[i] = 0;
    const wi = world.crumbleBlockWallIndex[i];
    world.wallWWorld[wi] = 0;
    world.wallHWorld[wi] = 0;
  }

  assert.equal(resetSecretCrumbleBlocksInWorld(world, room), 1);
  assert.equal(world.isCrumbleBlockActiveFlag[0], 1);
  assert.equal(world.crumbleBlockHitsRemaining[0], 2);
  assert.ok(world.wallWWorld[world.crumbleBlockWallIndex[0]] > 0);
  assert.equal(world.isCrumbleBlockActiveFlag[1], 0);
  assert.equal(world.crumbleBlockHitsRemaining[1], 0);
  assert.equal(world.wallWWorld[world.crumbleBlockWallIndex[1]], 0);
});
