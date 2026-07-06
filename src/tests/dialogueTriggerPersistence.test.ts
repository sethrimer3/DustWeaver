/**
 * Regression tests for dialogue trigger persistence across the room
 * save/load pipeline.
 *
 * Bug: `roomJsonDefToRoomDef` dropped `json.dialogueTriggers` when building
 * the runtime `RoomDef`, so triggers authored in the editor and saved to
 * disk never fired in gameplay after the room was reloaded from JSON.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';
import type { RoomJsonDef, RoomJsonDialogueTrigger } from '../editor/roomJsonSchema';
import { prepareRoomDialogueVisitState } from '../screens/gameDialogueHandler';
import { closeDialogue } from '../dialogue/dialogueRuntime';
import type { DialogueState } from '../dialogue/dialogueState';
import type { DialogueOverlayRenderer } from '../render/ui/dialogueOverlayRenderer';

function makeTrigger(): RoomJsonDialogueTrigger {
  return {
    xBlock: 3,
    yBlock: 4,
    wBlock: 2,
    hBlock: 1,
    conversation: {
      id: 'convo_1',
      title: 'Mysterious Voice',
      entries: [
        { text: 'Hello there.', portraitId: 'sage', portraitSide: 'left' },
        { text: 'Be careful ahead.', portraitId: 'sage', portraitSide: 'left' },
      ],
    },
  };
}

function makeMinimalRoomJson(overrides: Partial<RoomJsonDef> = {}): RoomJsonDef {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 12,
    playerSpawnBlock: [1, 1],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    skillTombs: [],
    ...overrides,
  };
}

test('roomJsonDefToRoomDef preserves dialogueTriggers', () => {
  const trigger = makeTrigger();
  const json = makeMinimalRoomJson({ dialogueTriggers: [trigger] });

  const room = roomJsonDefToRoomDef(json);

  assert.equal(room.dialogueTriggers?.length, 1);
  const rt = room.dialogueTriggers![0];
  assert.equal(rt.xBlock, trigger.xBlock);
  assert.equal(rt.yBlock, trigger.yBlock);
  assert.equal(rt.wBlock, trigger.wBlock);
  assert.equal(rt.hBlock, trigger.hBlock);
  assert.equal(rt.conversation.id, trigger.conversation.id);
  assert.equal(rt.conversation.title, trigger.conversation.title);
  assert.deepEqual(rt.conversation.entries, trigger.conversation.entries);

  // Deep-copy check: mutating the source must not affect the runtime RoomDef.
  trigger.conversation.entries[0].text = 'MUTATED';
  assert.notEqual(rt.conversation.entries[0].text, 'MUTATED');
});

test('RoomJsonDef -> dehydrateRoom -> hydrateV2Room -> roomJsonDefToRoomDef preserves dialogueTriggers', () => {
  const trigger = makeTrigger();
  const json = makeMinimalRoomJson({ dialogueTriggers: [trigger] });

  const saved = dehydrateRoom(json);
  const rehydratedJson = hydrateV2Room(saved);
  const room = roomJsonDefToRoomDef(rehydratedJson);

  assert.equal(room.dialogueTriggers?.length, 1);
  const rt = room.dialogueTriggers![0];
  assert.equal(rt.xBlock, trigger.xBlock);
  assert.equal(rt.yBlock, trigger.yBlock);
  assert.equal(rt.wBlock, trigger.wBlock);
  assert.equal(rt.hBlock, trigger.hBlock);
  assert.equal(rt.conversation.id, trigger.conversation.id);
  assert.equal(rt.conversation.title, trigger.conversation.title);
  assert.deepEqual(rt.conversation.entries, trigger.conversation.entries);
});

test('a loaded RoomDef with a dialogue trigger produces cached conversations via prepareRoomDialogueVisitState', () => {
  const trigger = makeTrigger();
  const json = makeMinimalRoomJson({ dialogueTriggers: [trigger] });
  const room = roomJsonDefToRoomDef(json);

  const dialogueState: DialogueState = {
    isDialogueActiveFlag: false,
    activeConversation: null,
    activeEntryIndex: 0,
  };
  let hidden = false;
  const dialogueRenderer = { hide: () => { hidden = true; }, show: () => {} } as unknown as DialogueOverlayRenderer;

  const { firedDialogueTriggerUids, cachedRoomConversations } =
    prepareRoomDialogueVisitState(room, dialogueState, dialogueRenderer);

  assert.equal(firedDialogueTriggerUids.size, 0);
  assert.equal(cachedRoomConversations.length, 1);
  assert.equal(cachedRoomConversations[0].id, trigger.conversation.id);
  assert.equal(cachedRoomConversations[0].entries.length, 2);
  assert.ok(hidden);

  closeDialogue(dialogueState);
});
