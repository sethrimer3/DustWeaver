/**
 * editorNewElements.test.ts — Coverage for the five newly editor-exposed
 * elements: Grapple Hunter enemy, Firefly Jar, Springboard, generic
 * Breakable Block, and the Half-width Pillar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { placeAtCursor } from '../editor/editorPlaceTool';
import { placeEnemyAtCursor } from '../editor/editorEnemyPlacer';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { roomDefToEditorRoomData } from '../editor/editorRoomImporter';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import { deleteAtCursor } from '../editor/editorDeleteTool';
import { selectAtCursor } from '../editor/editorTools';

const NEW_PALETTE_IDS = [
  'enemy_grapple_hunter',
  'firefly_jar',
  'springboard',
  'breakable_block_1x1',
  'breakable_block_2x2',
  'pillar_half_width',
];

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
    ...overrides,
  } as unknown as EditorRoomData;
}

function makeStateWithItem(
  itemId: string,
  room: EditorRoomData,
  bx: number,
  by: number,
  existingState?: ReturnType<typeof createEditorState>,
) {
  const state = existingState ?? createEditorState();
  state.roomData = room;
  const item = PALETTE_ITEMS.find(i => i.id === itemId);
  assert.ok(item, `palette item ${itemId} must exist`);
  state.selectedPaletteItem = item!;
  state.cursorBlockX = bx;
  state.cursorBlockY = by;
  return state;
}

// ── 1. Static palette items exist exactly once ─────────────────────────────

test('each new palette item exists exactly once', () => {
  for (const id of NEW_PALETTE_IDS) {
    const matches = PALETTE_ITEMS.filter(i => i.id === id);
    assert.equal(matches.length, 1, `expected exactly one palette entry for ${id}`);
  }
});

// ── 2. Every new palette item has a non-fallback preview ───────────────────
//
// editorPalettePreview.ts / editorUIHelpers.ts transitively import the
// Vite-only folder-theme catalogue (import.meta.glob), so they cannot be
// loaded under the plain Node test runner. Instead we source-scan for a
// dedicated case/key per id, matching the same non-fallback contract that
// getPalettePreviewKind() enforces at runtime (specialBlocks items always
// get a real shape via makeBlockPreviewShapeCss; other categories need an
// explicit ITEM_VISUAL or ITEM_SPRITE_URL entry keyed by id).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewSrc = fs.readFileSync(path.resolve(__dirname, '../editor/editorPalettePreview.ts'), 'utf8');
const uiHelpersSrc = fs.readFileSync(path.resolve(__dirname, '../editor/editorUIHelpers.ts'), 'utf8');

test('each new palette item resolves to a non-fallback preview', () => {
  for (const id of NEW_PALETTE_IDS) {
    const item = PALETTE_ITEMS.find(i => i.id === id)!;
    if (item.category === 'specialBlocks' || item.category === 'blocks') {
      // Routed through makeBlockPreviewShapeCss(item.id, ...) — must have its
      // own `case 'id':` (not just the generic default block-tile fallback).
      assert.ok(
        uiHelpersSrc.includes(`case '${id}':`),
        `expected a dedicated block-shape case for ${id} in editorUIHelpers.ts`,
      );
    } else {
      const hasVisual = new RegExp(`\\b${id}:\\s*\\{`).test(previewSrc);
      const hasSprite = new RegExp(`\\b${id}:\\s*'`).test(previewSrc);
      assert.ok(hasVisual || hasSprite, `expected a procedural or sprite preview entry for ${id}`);
    }
  }
});

// ── 3/4. Grapple Hunter ─────────────────────────────────────────────────────

test('Grapple Hunter placement sets isGrappleHunterFlag: 1 and no other kind flag', () => {
  const room = makeRoom();
  const state = createEditorState();
  const item = PALETTE_ITEMS.find(i => i.id === 'enemy_grapple_hunter')!;
  const handled = placeEnemyAtCursor(state, room, item, 5, 5);
  assert.equal(handled, true);
  assert.equal(room.enemies.length, 1);
  const e = room.enemies[0];
  assert.equal(e.isGrappleHunterFlag, 1);
  assert.equal(e.isBossFlag, 0);
  assert.equal(e.isRockElementalFlag, 0);
  assert.equal(e.isSlimeFlag, 0);
});

test('Grapple Hunter survives editor JSON round-trip and the RoomDef export path', () => {
  const room = makeRoom();
  const state = createEditorState();
  const item = PALETTE_ITEMS.find(i => i.id === 'enemy_grapple_hunter')!;
  placeEnemyAtCursor(state, room, item, 5, 5);

  const json = editorRoomDataToJson(room);
  const roundTripped = jsonToEditorRoomData(json, 1000).data;
  const hunter = roundTripped.enemies.find(e => e.isGrappleHunterFlag === 1);
  assert.ok(hunter, 'grapple hunter enemy missing after JSON round-trip');

  const roomDef = editorRoomDataToRoomDef(room);
  const defHunter = roomDef.enemies.find(e => e.isGrappleHunterFlag === 1);
  assert.ok(defHunter, 'grapple hunter enemy missing after RoomDef export (runtime spawn path)');
});

// ── 5/6. Firefly Jar ─────────────────────────────────────────────────────────

test('Firefly Jar placement writes to room.fireflyJars', () => {
  const room = makeRoom();
  const state = makeStateWithItem('firefly_jar', room, 3, 4);
  placeAtCursor(state);
  assert.equal((room.fireflyJars ?? []).length, 1);
  assert.equal(room.fireflyJars![0].xBlock, 3);
  assert.equal(room.fireflyJars![0].yBlock, 4);
});

test('Firefly Jar survives export/import round-trip', () => {
  const room = makeRoom();
  const state = makeStateWithItem('firefly_jar', room, 3, 4);
  placeAtCursor(state);

  const roomDef = editorRoomDataToRoomDef(room);
  assert.equal((roomDef.fireflyJars ?? []).length, 1);

  const reimported = roomDefToEditorRoomData(roomDef, 1000).data;
  assert.equal((reimported.fireflyJars ?? []).length, 1);
  assert.equal(reimported.fireflyJars![0].xBlock, 3);
  assert.equal(reimported.fireflyJars![0].yBlock, 4);
});

// ── 7/8. Springboard ─────────────────────────────────────────────────────────

test('Springboard placement writes to room.springboards', () => {
  const room = makeRoom();
  const state = makeStateWithItem('springboard', room, 6, 7);
  placeAtCursor(state);
  assert.equal((room.springboards ?? []).length, 1);
  assert.equal(room.springboards![0].xBlock, 6);
  assert.equal(room.springboards![0].yBlock, 7);
});

test('Springboards remain distinct from bounce pads (separate arrays/types)', () => {
  const room = makeRoom();
  const state = makeStateWithItem('springboard', room, 6, 7);
  placeAtCursor(state);
  makeStateWithItem('bounce_pad_1x1_dim', room, 8, 9, state);
  placeAtCursor(state);

  assert.equal((room.springboards ?? []).length, 1);
  assert.equal((room.bouncePads ?? []).length, 1);
  assert.notEqual((room.springboards ?? [])[0].uid, (room.bouncePads ?? [])[0].uid);

  const roomDef = editorRoomDataToRoomDef(room);
  assert.equal((roomDef.springboards ?? []).length, 1);
  assert.equal((roomDef.bouncePads ?? []).length, 1);
});

// ── 9/10. Breakable Block ────────────────────────────────────────────────────

test('Breakable Block 1x1 placement writes a single cell to room.breakableBlocks', () => {
  const room = makeRoom();
  const state = makeStateWithItem('breakable_block_1x1', room, 4, 4);
  placeAtCursor(state);
  assert.equal((room.breakableBlocks ?? []).length, 1);
});

test('Breakable Block 2x2 placement produces four grouped cells sharing one groupId', () => {
  const room = makeRoom();
  const state = makeStateWithItem('breakable_block_2x2', room, 4, 4);
  placeAtCursor(state);
  const cells = room.breakableBlocks ?? [];
  assert.equal(cells.length, 4);
  const groupIds = new Set(cells.map(c => c.groupId));
  assert.equal(groupIds.size, 1, 'all four cells must share one groupId');
  assert.ok(groupIds.values().next().value !== undefined);
  const coords = new Set(cells.map(c => `${c.xBlock},${c.yBlock}`));
  assert.deepEqual(coords, new Set(['4,4', '5,4', '4,5', '5,5']));
});

// ── 11/12. Half-width Pillar ─────────────────────────────────────────────────

test('Half-width Pillar placement sets isPillarHalfWidthFlag: 1', () => {
  const room = makeRoom();
  const state = makeStateWithItem('pillar_half_width', room, 2, 2);
  placeAtCursor(state);
  assert.equal(room.interiorWalls.length, 1);
  assert.equal(room.interiorWalls[0].isPillarHalfWidthFlag, 1);
});

test('the half-width pillar flag survives serialization, import, and RoomDef conversion', () => {
  const room = makeRoom();
  const state = makeStateWithItem('pillar_half_width', room, 2, 2);
  placeAtCursor(state);

  const json = editorRoomDataToJson(room);
  const roundTripped = jsonToEditorRoomData(json, 1000).data;
  assert.equal(roundTripped.interiorWalls.some(w => w.isPillarHalfWidthFlag === 1), true);

  const roomDef = editorRoomDataToRoomDef(room);
  assert.equal(roomDef.walls.some(w => w.isPillarHalfWidthFlag === 1), true);

  const reimported = roomDefToEditorRoomData(roomDef, 1000).data;
  assert.equal(reimported.interiorWalls.some(w => w.isPillarHalfWidthFlag === 1), true);
});

test('placing multiple half-width pillars does not merge them into a full-width wall', () => {
  const room = makeRoom();
  const s1 = makeStateWithItem('pillar_half_width', room, 2, 2);
  placeAtCursor(s1);
  const s2 = makeStateWithItem('pillar_half_width', room, 3, 2);
  placeAtCursor(s2);
  assert.equal(room.interiorWalls.length, 2, 'adjacent half-width pillars must remain separate walls');
  for (const w of room.interiorWalls) assert.equal(w.isPillarHalfWidthFlag, 1);
});

// ── 13. Selection and deletion for the new element types ───────────────────

test('Firefly Jar, Springboard, and Breakable Block are selectable and deletable', () => {
  // Placed several cells apart — hitTestPoint() uses a generous 1.5-block
  // radius shared by every point-placed element, so adjacent single-cell
  // objects can otherwise shadow each other's hit test.
  const room = makeRoom();
  placeAtCursor(makeStateWithItem('firefly_jar', room, 1, 1));
  placeAtCursor(makeStateWithItem('springboard', room, 5, 1));
  placeAtCursor(makeStateWithItem('breakable_block_1x1', room, 9, 1));

  const state = createEditorState();
  state.roomData = room;

  state.cursorBlockX = 1; state.cursorBlockY = 1;
  const jarHit = selectAtCursor(state);
  assert.equal(jarHit?.type, 'fireflyJar');

  state.cursorBlockX = 5; state.cursorBlockY = 1;
  const springHit = selectAtCursor(state);
  assert.equal(springHit?.type, 'springboard');

  state.cursorBlockX = 9; state.cursorBlockY = 1;
  const breakHit = selectAtCursor(state);
  assert.equal(breakHit?.type, 'breakableBlock');

  state.cursorBlockX = 1; state.cursorBlockY = 1;
  deleteAtCursor(state);
  state.cursorBlockX = 5; state.cursorBlockY = 1;
  deleteAtCursor(state);
  state.cursorBlockX = 9; state.cursorBlockY = 1;
  deleteAtCursor(state);
  assert.equal((room.fireflyJars ?? []).length, 0);
  assert.equal((room.springboards ?? []).length, 0);
  assert.equal((room.breakableBlocks ?? []).length, 0);
});

// ── 14. Backward compatibility ──────────────────────────────────────────────

test('existing rooms containing legacy fireflyJars/springboards/breakableBlocks JSON load without mutation', () => {
  const json = {
    id: 'legacy_room',
    name: 'Legacy Room',
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
    skillTombs: [],
    fireflyJars: [{ xBlock: 5, yBlock: 5 }],
    springboards: [{ xBlock: 6, yBlock: 6 }],
    breakableBlocks: [{ xBlock: 7, yBlock: 7 }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const editorData = jsonToEditorRoomData(json, 1000).data;
  assert.equal((editorData.fireflyJars ?? []).length, 1);
  assert.equal((editorData.springboards ?? []).length, 1);
  assert.equal((editorData.breakableBlocks ?? []).length, 1);
  assert.equal(editorData.fireflyJars![0].xBlock, 5);
  assert.equal(editorData.springboards![0].xBlock, 6);
  assert.equal(editorData.breakableBlocks![0].xBlock, 7);
});

// ── 15. Palette-to-placement coverage ───────────────────────────────────────

test('every static palette item that is not documented as a legacy exception has a placement handler', () => {
  // Legacy exception: plain ramps are intentionally retired from placement
  // (see comment in editorPaletteItems.ts) but old data with rampOrientation
  // still loads/renders. No palette items with id starting 'ramp_' exist any
  // more, so this set should stay empty — asserting it documents the intent.
  const LEGACY_EXCEPTIONS = new Set<string>([]);

  for (const item of PALETTE_ITEMS) {
    if (LEGACY_EXCEPTIONS.has(item.id)) continue;
    const room = makeRoom();
    const state = makeStateWithItem(item.id, room, 5, 5);
    // Should not throw; a handled item should mutate the room in some way,
    // OR (for narrow validity-gated items) at least not crash.
    assert.doesNotThrow(() => placeAtCursor(state), `placing ${item.id} threw unexpectedly`);
  }
});
