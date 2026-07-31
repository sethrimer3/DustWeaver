import type { EditorRoomData } from './editorElementTypes';

type ArrayValuedKey<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly unknown[] ? K : never;
}[keyof T];

export type EditorRoomElementCollectionKey = Exclude<ArrayValuedKey<EditorRoomData>, 'playerSpawnBlock'>;

/**
 * Authoritative collection list for persistence contract tests.
 * Adding an EditorRoomData collection is a compile error until it is
 * deliberately included here and therefore exercised by the contract fixture.
 */
export const EDITOR_ROOM_ELEMENT_COLLECTION_KEYS = [
  'interiorWalls', 'enemies', 'transitions', 'saveTombs', 'skillTombs',
  'challengeFields', 'challengeGates', 'challengeTotems', 'gates',
  'dustContainers', 'dustContainerPieces', 'dustBoostJars', 'dustSwarms',
  'lambdaAnchors', 'fireflyJars', 'springboards', 'breakableBlocks',
  'dustPiles', 'grasshopperAreas', 'fireflyAreas', 'decorations',
  'ambientLightBlockers', 'lightSources', 'waterZones', 'lavaZones',
  'timeStopFields', 'poisonFields', 'crumbleBlocks', 'spikes', 'lasers', 'bouncePads', 'kineticBlocks',
  'grappleCarryBlocks', 'zipMoveBlocks', 'phantasmalTiles', 'pixelMaterials',
  'ropes', 'sunbeams', 'sceneLights', 'fallingBlocks', 'dialogueTriggers',
  'backgroundBlocks', 'guideDustPaths', 'customBlockPlacements',
] as const satisfies readonly EditorRoomElementCollectionKey[];

type MissingPersistenceCollection =
  Exclude<EditorRoomElementCollectionKey, typeof EDITOR_ROOM_ELEMENT_COLLECTION_KEYS[number]>;
const EDITOR_PERSISTENCE_COLLECTIONS_ARE_COMPLETE:
  MissingPersistenceCollection extends never ? true : never = true;
void EDITOR_PERSISTENCE_COLLECTIONS_ARE_COMPLETE;
