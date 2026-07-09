import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRoomJsonSongId } from '../editor/roomJson';
import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';
import type { RoomJsonDef } from '../editor/roomJsonSchema';

function makeRoomJson(overrides?: Partial<RoomJsonDef>): RoomJsonDef {
  return {
    id: 'song-test-room',
    name: 'Song Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 15,
    playerSpawnBlock: [10, 7],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    skillTombs: [],
    ...overrides,
  } as RoomJsonDef;
}

test('legacy room JSON song field is accepted as room music', () => {
  const json = makeRoomJson({ song: 'thoughtfulLevel' });

  assert.equal(parseRoomJsonSongId(json), 'thoughtfulLevel');
  assert.equal(roomJsonDefToRoomDef(json).songId, 'thoughtfulLevel');
});

test('songId takes precedence over legacy song when both are present', () => {
  const json = makeRoomJson({
    songId: 'rainWindAtmosphere',
    song: 'thoughtfulLevel',
  });

  assert.equal(parseRoomJsonSongId(json), 'rainWindAtmosphere');
  assert.equal(roomJsonDefToRoomDef(json).songId, 'rainWindAtmosphere');
});
