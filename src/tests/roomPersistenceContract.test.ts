import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { roomDefToEditorRoomData } from '../editor/editorRoomImporter';
import { EDITOR_ROOM_ELEMENT_COLLECTION_KEYS } from '../editor/editorPersistenceManifest';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import type { RoomJsonDef } from '../editor/roomJsonSchema';
import { dehydrateRoom, enemyFlagsToType, validateRoomRoundtrip } from '../levels/roomSchemaV2';
import { enemyTypeToFlags, hydrateV2Room } from '../levels/roomSchemaHydrator';
import { SAVED_ENEMY_TYPES, type SavedRoomV2 } from '../levels/roomSavedTypes';

const enemyBase = {
  xBlock: 3,
  yBlock: 4,
  kinds: ['Fire'],
  particleCount: 17,
  isBoss: false,
} as const;

test('every saved enemy subtype is bidirectional and unsupported tags throw', () => {
  for (const type of SAVED_ENEMY_TYPES) {
    const flags = enemyTypeToFlags(type, {
      ...enemyBase,
      kinds: [...enemyBase.kinds],
      snakeLength: 9,
      momentumTurretFacingIndex: 3,
      slimeSnailSideIndex: 2,
      slimeSnailCw: 0,
      countsTowardRoomCompletion: 0,
      goldenMimicYFlipped: 1,
    });
    assert.equal(enemyFlagsToType(flags), type, type);
  }
  assert.throws(
    () => enemyTypeToFlags('futureEnemy' as typeof SAVED_ENEMY_TYPES[number], {
      ...enemyBase,
      kinds: [...enemyBase.kinds],
    }),
    /Unsupported saved enemy type/,
  );
});

test('authored persistence fields survive editor, compact-save, runtime, and editor conversion', () => {
  const sourceJson: RoomJsonDef = {
    id: 'persistence_contract',
    name: 'Persistence Contract',
    worldNumber: 7,
    mapX: 12,
    mapY: -9,
    widthBlocks: 64,
    heightBlocks: 48,
    playerSpawnBlock: [2, 3],
    blockTheme: 'blackRock',
    backgroundId: 'cave',
    lightingEffect: 'DEFAULT',
    songId: '_silence',
    backgroundLightSpill: 0.37,
    solidLightSoftness: 0.63,
    sunrays: { enabled: true, intensity: 0.71, angleDeg: 123 },
    rimStyles: [['s', '35a7ff', 7, 0.61]],
    interiorWalls: [{ xBlock: 1, yBlock: 1, wBlock: 3, hBlock: 2, r: 0 }],
    enemies: SAVED_ENEMY_TYPES.map((type, index) => enemyTypeToFlags(type, {
      xBlock: 4 + index,
      yBlock: 5,
      kinds: ['Ice'],
      particleCount: 11 + index,
      isBoss: index === 2,
      countsTowardRoomCompletion: index === 1 ? 0 : undefined,
      goldenMimicYFlipped: 1,
      snakeLength: 9,
      momentumTurretFacingIndex: 3,
      slimeSnailSideIndex: 2,
      slimeSnailCw: 0,
    })),
    transitions: [{
      direction: 'right',
      positionBlock: 13,
      openingSizeBlocks: 5,
      targetRoomId: 'target',
      targetSpawnBlock: [7, 8],
      isSecretDoor: true,
      longTransition: true,
      gradientWidthBlocks: 6,
    }],
    skillTombs: [],
    breakableBlocks: [{ xBlock: 8, yBlock: 9, groupId: 44 }],
    dustPiles: [{ xBlock: 10, yBlock: 11, dustCount: 23, spreadBlocks: 6 }],
    fireflyAreas: [{ xBlock: 12, yBlock: 13, wBlock: 7, hBlock: 5, count: 19 }],
    grappleCarryBlocks: [{ xBlock: 14, yBlock: 15 }],
    zipMoveBlocks: [{ uid: 777, xBlock: 16, yBlock: 17, wBlock: 6, hBlock: 5, variant: 'away' }],
    phantasmalTiles: [{ xBlock: 18, yBlock: 19 }],
    customBlockPlacements: [[20, 21, 'custom:distinctive', 2, 2]],
  };

  assert.deepEqual(validateRoomRoundtrip(sourceJson), []);

  const original = jsonToEditorRoomData(sourceJson, 1000).data;
  const compact = dehydrateRoom(editorRoomDataToJson(original));
  const reopened = jsonToEditorRoomData(hydrateV2Room(compact), 5000).data;
  const finalEditor = roomDefToEditorRoomData(editorRoomDataToRoomDef(reopened), 9000).data;

  for (const key of EDITOR_ROOM_ELEMENT_COLLECTION_KEYS) {
    if (key === 'interiorWalls') continue;
    assert.equal((finalEditor[key] ?? []).length, (original[key] ?? []).length, key);
  }
  assert.equal(finalEditor.backgroundLightSpill, 0.37);
  assert.equal(finalEditor.solidLightSoftness, 0.63);
  assert.deepEqual(finalEditor.sunrays, original.sunrays);
  assert.ok(finalEditor.interiorWalls.some(wall => wall.surfaceRim !== undefined));
  assert.equal(finalEditor.breakableBlocks?.[0].groupId, 44);
  assert.equal(finalEditor.dustPiles[0].spreadBlocks, 6);
  assert.equal(finalEditor.transitions[0].isSecretDoor, true);
  assert.equal(finalEditor.customBlockPlacements?.[0].tileWidth, 2);
  assert.equal(finalEditor.customBlockPlacements?.[0].tileHeight, 2);
  assert.equal(finalEditor.enemies[1].countsTowardRoomCompletionFlag, 0);
  assert.equal(finalEditor.enemies.find(enemy => enemy.isGoldenMimicFlag === 1)?.isGoldenMimicYFlippedFlag, 1);
  assert.equal(finalEditor.enemies.find(enemy => enemy.isMomentumTurretFlag === 1)?.momentumTurretFacingIndex, 3);
});

test('corrupt saved enemy tags cannot hydrate as basic enemies', () => {
  const corrupt: SavedRoomV2 = {
    v: 3,
    id: 'corrupt',
    name: 'Corrupt',
    world: 1,
    size: [10, 10],
    spawn: [1, 1],
    solids: { byTheme: {} },
    enemies: [{ type: 'corruptEnemy' as typeof SAVED_ENEMY_TYPES[number], pos: [2, 2] }],
  };
  assert.throws(() => hydrateV2Room(corrupt), /Unsupported saved enemy type/);
});
