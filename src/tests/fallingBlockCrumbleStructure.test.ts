/**
 * Regression tests for the falling-block ("crumble structure") lifecycle:
 * editor placement -> serialization -> room load -> render -> collision -> falling -> reset.
 *
 * Covers the bugs fixed in this pass:
 *   - Blackstone (blockTheme) material is preserved through save/load and resolves
 *     to the canonical block-sprite renderer, never a placeholder.
 *   - Every occupied cell renders/collides exactly once; empty cells never do.
 *   - A concave/irregular component's collision is exact merged runs of occupied
 *     tiles, NOT the bounding-box AABB — so ordinary blocks inside holes or
 *     bounding-box concavities do not block falling, while genuine terrain
 *     directly beneath an occupied cell still stops it.
 *   - The falling component never collides with its own (moved) wall slots.
 *   - Disconnected islands get independent collision shapes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState, MAX_WALLS } from '../sim/world';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { editorRoomDataToJson } from '../editor/roomJson';
import { jsonToEditorRoomData } from '../editor/roomJson';
import { roomJsonToSaved } from '../levels/roomSchemaV2';
import { savedToRoomJson } from '../levels/roomSchemaHydrator';
import type { EditorRoomData } from '../editor/editorState';
import type { EditorFallingBlock } from '../editor/editorElementTypes';
import { loadRoomWalls } from '../screens/gameRoomWalls';
import { loadRoomFallingBlocks } from '../screens/gameRoomFallingBlocks';
import { tickFallingBlocks } from '../sim/fallingBlocks/fallingBlockSim';
import {
  FB_STATE_IDLE_STABLE,
  FB_STATE_WARNING,
  FB_STATE_PRE_FALL_PAUSE,
  FB_STATE_FALLING,
  FB_STATE_LANDED_STABLE,
  BLOCK_SIZE_MEDIUM,
} from '../sim/fallingBlocks/fallingBlockTypes';
import { BLOCK_SIZE_MEDIUM as ROOM_BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

function makeRoom(fallingBlocks: EditorFallingBlock[]): EditorRoomData {
  return {
    id: 'test', name: 'Test', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 30, heightBlocks: 20,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks, backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [],
  } as EditorRoomData;
}

let nextUid = 1;
function fb(xBlock: number, yBlock: number, variant: 'tough' | 'sensitive' | 'crumbling' = 'sensitive', blockTheme: string | null = null): EditorFallingBlock {
  return { uid: nextUid++, xBlock, yBlock, variant, blockTheme };
}

// ── 1. Blackstone material survives editor save -> room load -> runtime ──────

test('a falling block tile configured with the Blackstone (blackRock) theme keeps that theme through save/load/hydrate', () => {
  const room = makeRoom([fb(5, 5, 'sensitive', 'blackRock')]);
  const roomDef = editorRoomDataToRoomDef(room);
  assert.equal(roomDef.fallingBlocks?.[0]?.blockTheme, 'blackRock');

  // Round-trip through the full-JSON and compact-saved formats, matching the
  // real save/load pipeline (editor -> RoomJson -> compact Saved -> RoomJson -> editor).
  const json = editorRoomDataToJson(room);
  assert.equal(json.fallingBlocks?.[0]?.blockTheme, 'blackRock');

  const saved = roomJsonToSaved(json);
  assert.equal(saved.fallingBlocks?.[0]?.[3], 'blackRock', 'compact tuple must carry the theme as its 4th element');

  const rehydratedJson = savedToRoomJson(saved);
  assert.equal(rehydratedJson.fallingBlocks?.[0]?.blockTheme, 'blackRock');

  const rehydratedEditorRoom = jsonToEditorRoomData(rehydratedJson);
  assert.equal(rehydratedEditorRoom.fallingBlocks?.[0]?.blockTheme, 'blackRock');

  // Finally, the runtime FallingBlockGroup must carry the resolved theme so the
  // renderer can look up the real Blackstone sprite instead of any fallback.
  const roomDef2 = editorRoomDataToRoomDef(rehydratedEditorRoom);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef2);
  loadRoomFallingBlocks(world, roomDef2);
  assert.equal(world.fallingBlockGroups.length, 1);
  assert.equal(world.fallingBlockGroups[0].blockThemeId, 'blackRock');
});

test('a falling block tile with no theme override resolves to a null blockThemeId (default look), not a stale/defaulted value', () => {
  const room = makeRoom([fb(5, 5, 'tough', null)]);
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);
  assert.equal(world.fallingBlockGroups[0].blockThemeId, null);
});

// ── 2/3/4. Exact cell occupancy for a concave (U-shaped) component ────────────

/**
 * Builds a U-shaped (concave) component out of 1-tile-wide legs and a base,
 * with a gap in the middle that is NOT part of the structure:
 *
 *   X . X
 *   X . X
 *   X X X
 *
 * The `.` cells are empty — they must never render or collide, even though
 * they sit inside the shape's overall bounding rectangle.
 */
function makeUShapeTiles(x0: number, y0: number, variant: 'tough' | 'sensitive' | 'crumbling' = 'sensitive'): EditorFallingBlock[] {
  const tiles: EditorFallingBlock[] = [];
  tiles.push(fb(x0, y0, variant));
  tiles.push(fb(x0 + 2, y0, variant));
  tiles.push(fb(x0, y0 + 1, variant));
  tiles.push(fb(x0 + 2, y0 + 1, variant));
  tiles.push(fb(x0, y0 + 2, variant));
  tiles.push(fb(x0 + 1, y0 + 2, variant));
  tiles.push(fb(x0 + 2, y0 + 2, variant));
  return tiles;
}

test('a concave U-shaped component is one connected group with exactly 7 occupied tiles, not a filled 3x3 rectangle', () => {
  const room = makeRoom(makeUShapeTiles(3, 3));
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  assert.equal(world.fallingBlockGroups.length, 1);
  const g = world.fallingBlockGroups[0];
  assert.equal(g.tileCount, 7, 'must preserve exact tile count, not fill the 3x3 bounding rect (9 cells)');
  assert.equal(g.colliderRectCount, 7);
});

test('static collision wall slots exist only over occupied cells of a concave component — the empty gap has no collider', () => {
  const room = makeRoom(makeUShapeTiles(3, 3));
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  const wallsBefore = world.wallCount;
  loadRoomFallingBlocks(world, roomDef);
  const g = world.fallingBlockGroups[0];

  // The gap cell is local (1,0) and (1,1) relative to the group's top-left (x0,y0).
  const gapWorldX1 = (3 + 1) * ROOM_BLOCK_SIZE_MEDIUM;
  const gapWorldY1 = (3 + 0) * ROOM_BLOCK_SIZE_MEDIUM;
  const gapWorldX2 = gapWorldX1 + ROOM_BLOCK_SIZE_MEDIUM;
  const gapWorldY2 = gapWorldY1 + ROOM_BLOCK_SIZE_MEDIUM * 2; // spans both empty gap rows

  let gapHasCollider = false;
  for (let wi = wallsBefore; wi < world.wallCount; wi++) {
    const wLeft = world.wallXWorld[wi], wTop = world.wallYWorld[wi];
    const wRight = wLeft + world.wallWWorld[wi], wBottom = wTop + world.wallHWorld[wi];
    if (wLeft < gapWorldX2 && wRight > gapWorldX1 && wTop < gapWorldY2 && wBottom > gapWorldY1) {
      gapHasCollider = true;
    }
  }
  assert.equal(gapHasCollider, false, 'the concave gap must never gain a solid collider from a merged/bounding rect');
  assert.ok(g.wallSlotCount >= 1 && g.wallSlotCount < 9, 'wall slots must be exact runs, fewer than a filled 3x3 rect would need cell-by-cell');
});

// ── Coordinate-zero and final-row/column preservation ─────────────────────────

test('cells at local coordinate zero and in the final row/column of a component are preserved, not dropped', () => {
  // L-shape anchored at block (0,0): (0,0), (0,1), (1,1) — covers coordinate zero
  // and both a "first" and "last" row/column cell.
  const room = makeRoom([fb(0, 0, 'tough'), fb(0, 1, 'tough'), fb(1, 1, 'tough')]);
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  assert.equal(world.fallingBlockGroups.length, 1);
  const g = world.fallingBlockGroups[0];
  assert.equal(g.tileCount, 3);
  assert.equal(g.restXWorld, 0);
  assert.equal(g.restYWorld, 0);

  const relCells = new Set<string>();
  for (let i = 0; i < g.tileCount; i++) relCells.add(`${g.tileRelXWorld[i]},${g.tileRelYWorld[i]}`);
  assert.ok(relCells.has('0,0'), 'coordinate-zero cell must be present');
  assert.ok(relCells.has(`0,${BLOCK_SIZE_MEDIUM}`), 'final-row cell must be present');
  assert.ok(relCells.has(`${BLOCK_SIZE_MEDIUM},${BLOCK_SIZE_MEDIUM}`), 'final-column cell must be present');
});

// ── 5/6/7/8/9. Falling behaviour with ordinary terrain in/around a concave shape

test('ordinary blocks inside the bounding-box concavity of a U-shape do not block it from falling', () => {
  const room = makeRoom(makeUShapeTiles(3, 3, 'sensitive'));
  // Place ordinary (non-falling) solid terrain right in the U's empty gap —
  // inside the overall bounding rectangle but never touching an occupied cell.
  room.interiorWalls = [
    { uid: 900, xBlock: 4, yBlock: 3, wBlock: 1, hBlock: 2, isPlatformFlag: 0, rampOrientation: undefined } as unknown as EditorRoomData['interiorWalls'][number],
  ];
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  const g = world.fallingBlockGroups[0];
  g.state = FB_STATE_FALLING;
  g.stateTimerTicks = 0;
  g.velocityYWorld = 0;
  g.hasReachedTopSpeedFlag = 0;
  g.crumbleTimerTicks = 0;

  const startOffset = g.offsetYWorld;
  for (let i = 0; i < 30; i++) tickFallingBlocks(world, 1000 / 60);
  assert.ok(g.offsetYWorld > startOffset, 'the component must actually fall despite ordinary terrain inside its bounding-box concavity');
});

test('ordinary blocks touching the left/right sides of a falling component do not prevent vertical falling', () => {
  const room = makeRoom([fb(5, 5, 'sensitive'), fb(5, 6, 'sensitive')]);
  room.interiorWalls = [
    { uid: 901, xBlock: 4, yBlock: 5, wBlock: 1, hBlock: 2, isPlatformFlag: 0, rampOrientation: undefined } as unknown as EditorRoomData['interiorWalls'][number],
    { uid: 902, xBlock: 6, yBlock: 5, wBlock: 1, hBlock: 2, isPlatformFlag: 0, rampOrientation: undefined } as unknown as EditorRoomData['interiorWalls'][number],
  ];
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  const g = world.fallingBlockGroups[0];
  g.state = FB_STATE_FALLING;
  const startOffset = g.offsetYWorld;
  for (let i = 0; i < 30; i++) tickFallingBlocks(world, 1000 / 60);
  assert.ok(g.offsetYWorld > startOffset, 'side-adjacent terrain must never block vertical movement');
});

test('genuine ordinary terrain directly below an occupied cell stops the component at the correct surface', () => {
  const room = makeRoom([fb(5, 5, 'sensitive')]);
  const groundYBlock = 10;
  room.interiorWalls = [
    { uid: 903, xBlock: 4, yBlock: groundYBlock, wBlock: 3, hBlock: 1, isPlatformFlag: 0, rampOrientation: undefined } as unknown as EditorRoomData['interiorWalls'][number],
  ];
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  const g = world.fallingBlockGroups[0];
  g.state = FB_STATE_FALLING;

  for (let i = 0; i < 300 && g.state === FB_STATE_FALLING; i++) tickFallingBlocks(world, 1000 / 60);
  assert.equal(g.state, FB_STATE_LANDED_STABLE, 'the block must land rather than fall through or float forever');

  const finalBottom = g.restYWorld + g.offsetYWorld + BLOCK_SIZE_MEDIUM;
  assert.equal(finalBottom, groundYBlock * ROOM_BLOCK_SIZE_MEDIUM, 'must stop exactly on top of the real ground surface');
});

test('no occupied tile of a falling component ever passes through genuine solid terrain (no tunneling)', () => {
  const room = makeRoom([fb(5, 5, 'sensitive'), fb(6, 5, 'sensitive')]);
  const groundYBlock = 7;
  room.interiorWalls = [
    { uid: 904, xBlock: 4, yBlock: groundYBlock, wBlock: 4, hBlock: 1, isPlatformFlag: 0, rampOrientation: undefined } as unknown as EditorRoomData['interiorWalls'][number],
  ];
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  const g = world.fallingBlockGroups[0];
  g.state = FB_STATE_FALLING;
  const groundTopWorld = groundYBlock * ROOM_BLOCK_SIZE_MEDIUM;

  for (let i = 0; i < 300 && g.state === FB_STATE_FALLING; i++) {
    tickFallingBlocks(world, 1000 / 60);
    const bottom = g.restYWorld + g.offsetYWorld + BLOCK_SIZE_MEDIUM;
    assert.ok(bottom <= groundTopWorld + 0.5, `component bottom (${bottom}) must never pass below the ground surface (${groundTopWorld})`);
  }
  assert.equal(g.state, FB_STATE_LANDED_STABLE);
});

// ── 10. The falling component does not collide with its own colliders ────────

test('a falling component does not collide with its own (moving) wall slots', () => {
  // A component whose own wall slots would overlap themselves at any given
  // tick if self-collision were not excluded — a 2-tall vertical strip whose
  // upper wall slot could otherwise appear to "block" the lower one moving
  // through the space it just vacated.
  const room = makeRoom([fb(5, 5, 'sensitive'), fb(5, 6, 'sensitive'), fb(5, 7, 'sensitive')]);
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  const g = world.fallingBlockGroups[0];
  g.state = FB_STATE_FALLING;
  const startOffset = g.offsetYWorld;
  for (let i = 0; i < 20; i++) tickFallingBlocks(world, 1000 / 60);
  assert.ok(g.offsetYWorld > startOffset, 'a component must fall freely through open air without its own slots self-blocking it');
});

// ── 11. Disconnected islands get independent collision shapes ────────────────

test('two disconnected falling-block islands become two independent groups, each with its own collision shape', () => {
  const room = makeRoom([
    fb(2, 2, 'sensitive'), fb(3, 2, 'sensitive'),
    fb(10, 2, 'sensitive'), fb(11, 2, 'sensitive'),
  ]);
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  assert.equal(world.fallingBlockGroups.length, 2, 'disconnected tile clusters must become separate groups, not one merged rectangle');
  const [g1, g2] = world.fallingBlockGroups;
  assert.equal(g1.tileCount, 2);
  assert.equal(g2.tileCount, 2);
  assert.notEqual(g1.wallIndices[0], g2.wallIndices[0]);
});

// ── 14. Different block themes never silently merge into one group ───────────

test('adjacent tiles with different block themes do not merge into a single group (material is not silently lost)', () => {
  const room = makeRoom([fb(5, 5, 'sensitive', 'blackRock'), fb(6, 5, 'sensitive', 'brownRock')]);
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);

  assert.equal(world.fallingBlockGroups.length, 2, 'differently-themed adjacent tiles must remain distinct structures');
  const themes = world.fallingBlockGroups.map(g => g.blockThemeId).sort();
  assert.deepEqual(themes, ['blackRock', 'brownRock']);
});

test('reserving wall slots for a very large room does not exceed MAX_WALLS budget silently corrupting collision', () => {
  const room = makeRoom([fb(5, 5, 'tough')]);
  const roomDef = editorRoomDataToRoomDef(room);
  const world = createWorldState(1000 / 60, 1);
  world.wallCount = MAX_WALLS; // simulate an already-full wall budget
  loadRoomWalls(world, roomDef);
  loadRoomFallingBlocks(world, roomDef);
  // Loader must not throw or corrupt state; the group simply gets an
  // unassigned (-1) wall slot rather than writing out of bounds.
  assert.equal(world.fallingBlockGroups.length, 1);
  assert.equal(world.fallingBlockGroups[0].wallIndices[0], -1);
});
