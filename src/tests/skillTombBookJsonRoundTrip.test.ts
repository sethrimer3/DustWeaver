/**
 * skillTombBookJsonRoundTrip.test.ts — Items 8 & 9 of the Sword/Shield/Bow
 * Weave defense-in-depth test pass: skill-book editor JSON round trips, and
 * copy/paste UID uniqueness.
 *
 * A placed skill/dust book is represented in the editor as `EditorSkillTomb`
 * ({ uid, xBlock, yBlock, weaveId }) inside `EditorRoomData.skillTombs`. Note
 * that `uid` is a session-local editor identifier only — it is NOT part of
 * the persisted JSON format (see `editorRoomDataToJson` in roomJson.ts,
 * which emits only `{ xBlock, yBlock, weaveId }` under the `dustSkillTombs`
 * key) and is freshly reassigned by a running counter on load (`jsonToEditorRoomData`).
 * So "round trips exactly" is verified for `xBlock`/`yBlock`/`weaveId`; `uid`
 * is verified to be freshly (but validly, uniquely) assigned on load instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData, EditorSkillTomb } from '../editor/editorElementTypes';
import { createEditorState } from '../editor/editorState';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import { serializeSelectedElements, pasteFromClipboard } from '../editor/editorDragCopyPaste';
import { WEAVE_SWORD, WEAVE_SHIELD, WEAVE_ARROW } from '../sim/weaves/weaveDefinition';

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

// ---- Item 8: skill-book editor JSON round trips ----------------------------

test('all three skill-book flavors round-trip xBlock/yBlock/weaveId exactly through JSON save/load', () => {
  const books: EditorSkillTomb[] = [
    { uid: 1, xBlock: 3, yBlock: 4, weaveId: WEAVE_SWORD },
    { uid: 2, xBlock: 7, yBlock: 8, weaveId: WEAVE_SHIELD },
    { uid: 3, xBlock: 11, yBlock: 12, weaveId: WEAVE_ARROW },
  ];
  const room = makeRoom({ skillTombs: books });

  const json = editorRoomDataToJson(room);
  // Round-trip through an actual JSON string, exactly as save-to-disk does.
  const reparsed = JSON.parse(JSON.stringify(json));
  const { data: loaded } = jsonToEditorRoomData(reparsed, 1000);

  assert.equal(loaded.skillTombs.length, 3, 'all three placed books must survive the round trip');
  const byWeave = new Map(loaded.skillTombs.map(t => [t.weaveId, t]));

  const sword = byWeave.get(WEAVE_SWORD);
  assert.ok(sword, 'sword skill book must round-trip');
  assert.equal(sword!.xBlock, 3);
  assert.equal(sword!.yBlock, 4);

  const shield = byWeave.get(WEAVE_SHIELD);
  assert.ok(shield, 'shield skill book must round-trip');
  assert.equal(shield!.xBlock, 7);
  assert.equal(shield!.yBlock, 8);

  const bow = byWeave.get(WEAVE_ARROW);
  assert.ok(bow, 'bow skill book must round-trip');
  assert.equal(bow!.xBlock, 11);
  assert.equal(bow!.yBlock, 12);

  // uid is a session-local editor identifier, not part of the JSON format —
  // it must be freshly (and uniquely) assigned on load, not preserved.
  const uids = loaded.skillTombs.map(t => t.uid);
  assert.equal(new Set(uids).size, 3, 'freshly-assigned uids on load must be unique');
  for (const u of uids) assert.ok(u >= 1000, 'freshly-assigned uids must come from the loader\'s uid counter, not the stale pre-save uid');
});

test('skill-book round trip preserves weaveId even with an unusual/legacy weaveId string', () => {
  const room = makeRoom({ skillTombs: [{ uid: 5, xBlock: 1, yBlock: 1, weaveId: 'shield_sword' }] });
  const json = editorRoomDataToJson(room);
  const reparsed = JSON.parse(JSON.stringify(json));
  const { data: loaded } = jsonToEditorRoomData(reparsed, 1);
  assert.equal(loaded.skillTombs.length, 1);
  assert.equal(loaded.skillTombs[0].weaveId, 'shield_sword');
});

// ---- Item 9: copied skill-book UID uniqueness -------------------------------

test('copy-pasting a placed skill book produces a new, distinct UID rather than duplicating the original', () => {
  const state = createEditorState();
  const room = makeRoom({ skillTombs: [{ uid: 42, xBlock: 5, yBlock: 5, weaveId: WEAVE_SWORD }] });
  state.roomData = room;
  // In real usage `nextUid` is always synced past every existing uid by
  // jsonToEditorRoomData when a room is loaded; replicate that here since we
  // hand-construct roomData directly.
  state.nextUid = 100;

  const clipboard = serializeSelectedElements(room, [{ type: 'skillTomb', uid: 42 }]);
  state.clipboard = clipboard;
  state.cursorBlockX = 9;
  state.cursorBlockY = 9;

  pasteFromClipboard(state);

  assert.equal(room.skillTombs.length, 2, 'original plus one pasted copy');
  const originalStillPresent = room.skillTombs.find(t => t.uid === 42);
  assert.ok(originalStillPresent, 'original book with its original uid must remain untouched');

  const pasted = room.skillTombs.find(t => t.uid !== 42);
  assert.ok(pasted, 'a new book with a distinct uid must have been created');
  assert.notEqual(pasted!.uid, 42, 'pasted copy must not reuse the original uid');
  assert.equal(pasted!.weaveId, WEAVE_SWORD, 'pasted copy must preserve the weaveId');
});

test('copy-pasting multiple skill books each get their own unique, distinct UIDs', () => {
  const state = createEditorState();
  const room = makeRoom({
    skillTombs: [
      { uid: 1, xBlock: 1, yBlock: 1, weaveId: WEAVE_SWORD },
      { uid: 2, xBlock: 2, yBlock: 2, weaveId: WEAVE_SHIELD },
    ],
  });
  state.roomData = room;
  state.nextUid = 100;

  const clipboard = serializeSelectedElements(room, [
    { type: 'skillTomb', uid: 1 },
    { type: 'skillTomb', uid: 2 },
  ]);
  state.clipboard = clipboard;
  state.cursorBlockX = 20;
  state.cursorBlockY = 20;

  pasteFromClipboard(state);

  assert.equal(room.skillTombs.length, 4);
  const uids = room.skillTombs.map(t => t.uid);
  assert.equal(new Set(uids).size, 4, 'all four books (2 original + 2 pasted) must have unique uids');
});
