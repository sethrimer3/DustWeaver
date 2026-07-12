import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFillBrushCells } from '../editor/editorBrush';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import { dehydrateRoom, hydrateV2Room } from '../levels/roomSchemaV2';

/** Minimal room stub — only the fields the fill brush / hit-test helpers read. */
function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    widthBlocks: 10,
    heightBlocks: 10,
    interiorWalls: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

function key(c: { x: number; y: number }) {
  return `${c.x},${c.y}`;
}

function cellSet(cells: { x: number; y: number }[]) {
  return new Set(cells.map(key));
}

test('water fill: air pocket beneath water stays bounded by the water', () => {
  // Row 4 is a full-width water surface; rows 5-7 are an air pocket beneath
  // it, enclosed by walls on all other sides.
  const room = makeRoom({
    widthBlocks: 6,
    heightBlocks: 8,
    interiorWalls: [
      { xBlock: 0, yBlock: 0, wBlock: 6, hBlock: 1 } as any, // ceiling
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 8 } as any, // left wall
      { xBlock: 5, yBlock: 0, wBlock: 1, hBlock: 8 } as any, // right wall
      { xBlock: 0, yBlock: 7, wBlock: 6, hBlock: 1 } as any, // floor
    ],
    waterZones: [
      { uid: 1, xBlock: 1, yBlock: 4, wBlock: 4, hBlock: 1 },
    ],
  });

  const cells = getFillBrushCells(room, 2, 6, 'water');
  const covered = cellSet(cells);

  // The water row (y=4) fully spans the interior, so it separates the pocket
  // below (rows 5-6) from the air above (rows 1-3) — only the below-water
  // pocket containing the clicked cell should be filled.
  for (const c of cells) {
    assert.ok(c.y !== 4, `fill leaked into the water row at y=4 (cell ${key(c)})`);
    assert.ok(c.y >= 5, `fill crossed the water into the region above it (cell ${key(c)})`);
  }
  assert.ok(covered.has('2,6'), 'expected the clicked pocket cell to be included');
  assert.ok(!covered.has('2,1'), 'fill must not cross the water into the separate region above it');
});

test('water fill: merged rectangular water zone blocks traversal along every covered cell', () => {
  const room = makeRoom({
    widthBlocks: 6,
    heightBlocks: 5,
    interiorWalls: [],
    // Water spans the full room width so there is no unblocked side gap.
    waterZones: [{ uid: 1, xBlock: 0, yBlock: 2, wBlock: 6, hBlock: 1 }],
  });

  // Start above the water; fill must not cross into or past row 2.
  const cells = getFillBrushCells(room, 2, 0, 'water');
  for (const c of cells) {
    assert.ok(c.y < 2, `fill crossed the merged water rectangle at ${key(c)}`);
  }
});

test('water fill: individually painted 1x1 water zones behave like a merged rectangle', () => {
  const room = makeRoom({
    widthBlocks: 6,
    heightBlocks: 5,
    interiorWalls: [],
    waterZones: [
      { uid: 1, xBlock: 0, yBlock: 2, wBlock: 1, hBlock: 1 },
      { uid: 2, xBlock: 1, yBlock: 2, wBlock: 1, hBlock: 1 },
      { uid: 3, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1 },
      { uid: 4, xBlock: 3, yBlock: 2, wBlock: 1, hBlock: 1 },
      { uid: 5, xBlock: 4, yBlock: 2, wBlock: 1, hBlock: 1 },
      { uid: 6, xBlock: 5, yBlock: 2, wBlock: 1, hBlock: 1 },
    ],
  });

  const cells = getFillBrushCells(room, 2, 0, 'water');
  for (const c of cells) {
    assert.ok(c.y < 2, `fill crossed the painted water boundary at ${key(c)}`);
  }
});

test('lava boundary prevents water fill from escaping, and vice versa', () => {
  const room = makeRoom({
    widthBlocks: 6,
    heightBlocks: 5,
    interiorWalls: [],
    lavaZones: [{ uid: 1, xBlock: 0, yBlock: 2, wBlock: 6, hBlock: 1 }],
  });

  const waterCells = getFillBrushCells(room, 2, 0, 'water');
  for (const c of waterCells) assert.ok(c.y < 2);

  const room2 = makeRoom({
    widthBlocks: 6,
    heightBlocks: 5,
    interiorWalls: [],
    waterZones: [{ uid: 1, xBlock: 0, yBlock: 2, wBlock: 6, hBlock: 1 }],
  });
  const lavaCells = getFillBrushCells(room2, 2, 0, 'lava');
  for (const c of lavaCells) assert.ok(c.y < 2);
});

test('four-directional connectivity: diagonally adjacent empty regions stay separate', () => {
  // Two air cells that only touch diagonally, separated by walls on the
  // cardinal sides.
  const room = makeRoom({
    widthBlocks: 4,
    heightBlocks: 4,
    interiorWalls: [
      { xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1 } as any,
      { xBlock: 0, yBlock: 1, wBlock: 1, hBlock: 1 } as any,
    ],
  });
  // (0,0) and (1,1) touch only diagonally; walls at (1,0) and (0,1) separate them.
  const cells = getFillBrushCells(room, 0, 0, 'water');
  const covered = cellSet(cells);
  assert.ok(!covered.has('1,1'), 'diagonal neighbor must not be connected');
});

test('room bounds: fill never produces coordinates outside the room', () => {
  const room = makeRoom({ widthBlocks: 3, heightBlocks: 3, interiorWalls: [] });
  const cells = getFillBrushCells(room, 1, 1, 'water');
  for (const c of cells) {
    assert.ok(c.x >= 0 && c.x < 3 && c.y >= 0 && c.y < 3, `out of bounds cell ${key(c)}`);
  }
  assert.equal(cells.length, 9);
});

test('existing-liquid no-op: clicking inside a cell covered by a larger water rectangle fills nothing', () => {
  const room = makeRoom({
    widthBlocks: 6,
    heightBlocks: 6,
    interiorWalls: [],
    waterZones: [{ uid: 1, xBlock: 0, yBlock: 0, wBlock: 4, hBlock: 4 }],
  });
  // (2,2) is covered by the 4x4 water rect even though no 1x1 zone matches it exactly.
  const cells = getFillBrushCells(room, 2, 2, 'water');
  assert.deepEqual(cells, []);

  const room2 = makeRoom({
    widthBlocks: 6,
    heightBlocks: 6,
    interiorWalls: [],
    lavaZones: [{ uid: 1, xBlock: 0, yBlock: 0, wBlock: 4, hBlock: 4 }],
  });
  const lavaCells = getFillBrushCells(room2, 2, 2, 'lava');
  assert.deepEqual(lavaCells, []);
});

test('block fill (tile kind): preserves original occupied/empty flood-fill behavior', () => {
  const room = makeRoom({
    widthBlocks: 5,
    heightBlocks: 3,
    interiorWalls: [
      { xBlock: 0, yBlock: 0, wBlock: 5, hBlock: 1 } as any,
    ],
  });
  // Default fillKind ('tile') should flood the solid wall row when clicked on it.
  const wallCells = getFillBrushCells(room, 2, 0);
  assert.equal(wallCells.length, 5);
  for (const c of wallCells) assert.equal(c.y, 0);

  // And flood the empty rows below when clicked there.
  const emptyCells = getFillBrushCells(room, 2, 1);
  assert.equal(emptyCells.length, 10);
});

test('serialization round trip: fill boundaries match after dehydrate/hydrate', () => {
  const room = {
    id: 'fillRoom', name: 'Fill Room', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 6, heightBlocks: 5,
    playerSpawnBlock: [1, 1], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
    waterZones: [{ uid: 1, xBlock: 0, yBlock: 2, wBlock: 6, hBlock: 1 }],
    lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [],
  } as unknown as EditorRoomData;

  const before = getFillBrushCells(room, 2, 0, 'water');

  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  const rehydratedJson = hydrateV2Room(saved);
  const rehydrated = jsonToEditorRoomData(rehydratedJson, 100).data;

  const after = getFillBrushCells(rehydrated as unknown as EditorRoomData, 2, 0, 'water');

  assert.deepEqual(cellSet(before), cellSet(after));
  for (const c of after) assert.ok(c.y < 2, `rehydrated fill crossed the water boundary at ${key(c)}`);
});

test('large empty room: fill completes without duplicate or repeated coordinates', () => {
  const room = makeRoom({ widthBlocks: 40, heightBlocks: 40, interiorWalls: [] });
  const cells = getFillBrushCells(room, 20, 20, 'water');
  assert.equal(cells.length, 1600);
  const seen = new Set<string>();
  for (const c of cells) {
    const k = key(c);
    assert.ok(!seen.has(k), `duplicate cell ${k}`);
    seen.add(k);
  }
});
