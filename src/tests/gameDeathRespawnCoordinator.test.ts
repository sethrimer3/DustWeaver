import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomDef } from '../levels/roomDef';
import { createDefaultProgress } from '../progression/playerProgress';
import {
  executeGameDeathRespawn,
  type GameDeathRespawnPorts,
} from '../screens/gameDeathRespawnCoordinator';

function makeRoom(id: string): RoomDef {
  return { id, worldNumber: 1 } as unknown as RoomDef;
}

const campaignRoom = makeRoom('campaign-room');
const campaignBlock: readonly [number, number] = [3, 4];

function createPorts(overrides: Partial<GameDeathRespawnPorts> = {}): {
  ports: GameDeathRespawnPorts;
  calls: string[];
} {
  const calls: string[] = [];
  const ports: GameDeathRespawnPorts = {
    getRoomById: (roomId) => {
      calls.push(`getRoomById:${roomId}`);
      return undefined;
    },
    loadRoom: (room, x, y) => {
      calls.push(`loadRoom:${room.id}:${x}:${y}`);
    },
    resetTransitionReveal: () => {
      calls.push('resetTransitionReveal');
    },
    resetFrameClock: () => {
      calls.push('resetFrameClock');
    },
    ...overrides,
  };
  return { ports, calls };
}

describe('executeGameDeathRespawn — target selection', () => {
  it('uses campaign spawn when progress is absent', () => {
    const { ports, calls } = createPorts();
    executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'loadRoom:campaign-room:3:4',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('uses campaign spawn without registry lookup when lastSaveRoomId is null', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = null;
    const { ports, calls } = createPorts();
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'loadRoom:campaign-room:3:4',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('uses campaign spawn without registry lookup when lastSaveRoomId is empty', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = '';
    const { ports, calls } = createPorts();
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'loadRoom:campaign-room:3:4',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('uses saved room and spawn when valid', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = 'saved-room';
    progress.lastSaveSpawnBlock = [7, -1.5];
    const savedRoom = makeRoom('saved-room');
    const { ports, calls } = createPorts({
      getRoomById: (roomId) => {
        calls.push(`getRoomById:${roomId}`);
        return roomId === 'saved-room' ? savedRoom : undefined;
      },
    });
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'getRoomById:saved-room',
      'loadRoom:saved-room:7:-1.5',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('falls back to campaign spawn when saved room is missing from registry', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = 'missing-room';
    progress.lastSaveSpawnBlock = [7, 8];
    const { ports, calls } = createPorts({
      getRoomById: (roomId) => {
        calls.push(`getRoomById:${roomId}`);
        return undefined;
      },
    });
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'getRoomById:missing-room',
      'loadRoom:campaign-room:3:4',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('falls back to campaign spawn when saved room exists but spawn block is null', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = 'saved-room';
    progress.lastSaveSpawnBlock = null;
    const savedRoom = makeRoom('saved-room');
    const { ports, calls } = createPorts({
      getRoomById: (roomId) => {
        calls.push(`getRoomById:${roomId}`);
        return roomId === 'saved-room' ? savedRoom : undefined;
      },
    });
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'getRoomById:saved-room',
      'loadRoom:campaign-room:3:4',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('forwards the exact saved room id to the registry lookup', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = 'exact-room-id';
    progress.lastSaveSpawnBlock = [1, 2];
    const seen: string[] = [];
    const { ports } = createPorts({
      getRoomById: (roomId) => {
        seen.push(roomId);
        return undefined;
      },
    });
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.deepEqual(seen, ['exact-room-id']);
  });

  it('forwards saved coordinates exactly, including fractional and negative values', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = 'saved-room';
    progress.lastSaveSpawnBlock = [-3.25, 0];
    const savedRoom = makeRoom('saved-room');
    let recordedX: number | undefined;
    let recordedY: number | undefined;
    const { ports } = createPorts({
      getRoomById: () => savedRoom,
      loadRoom: (_room, x, y) => {
        recordedX = x;
        recordedY = y;
      },
    });
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);
    assert.equal(recordedX, -3.25);
    assert.equal(recordedY, 0);
  });

  it('forwards campaign coordinates exactly', () => {
    let recordedX: number | undefined;
    let recordedY: number | undefined;
    const { ports } = createPorts({
      loadRoom: (_room, x, y) => {
        recordedX = x;
        recordedY = y;
      },
    });
    executeGameDeathRespawn(undefined, campaignRoom, [11.5, -2], ports);
    assert.equal(recordedX, 11.5);
    assert.equal(recordedY, -2);
  });
});

describe('executeGameDeathRespawn — ordering and failure propagation', () => {
  it('calls load, then transition reset, then frame reset, then respawn callback', () => {
    const calls: string[] = [];
    const { ports } = createPorts({
      loadRoom: () => { calls.push('load'); },
      resetTransitionReveal: () => { calls.push('transition'); },
      resetFrameClock: () => { calls.push('frame'); },
      onRespawn: () => { calls.push('respawn'); },
    });
    executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, ['load', 'transition', 'frame', 'respawn']);
  });

  it('allows a missing optional respawn callback', () => {
    const { ports, calls } = createPorts();
    executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports);
    assert.deepEqual(calls, [
      'loadRoom:campaign-room:3:4',
      'resetTransitionReveal',
      'resetFrameClock',
    ]);
  });

  it('propagates a load failure and short-circuits all later operations', () => {
    const calls: string[] = [];
    const { ports } = createPorts({
      loadRoom: () => { throw new Error('load failed'); },
      resetTransitionReveal: () => { calls.push('transition'); },
      resetFrameClock: () => { calls.push('frame'); },
      onRespawn: () => { calls.push('respawn'); },
    });
    assert.throws(
      () => executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports),
      /load failed/,
    );
    assert.deepEqual(calls, []);
  });

  it('propagates a transition-reset failure and short-circuits later operations', () => {
    const calls: string[] = [];
    const { ports } = createPorts({
      loadRoom: () => { calls.push('load'); },
      resetTransitionReveal: () => { throw new Error('transition failed'); },
      resetFrameClock: () => { calls.push('frame'); },
      onRespawn: () => { calls.push('respawn'); },
    });
    assert.throws(
      () => executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports),
      /transition failed/,
    );
    assert.deepEqual(calls, ['load']);
  });

  it('propagates a frame-reset failure and prevents the respawn callback', () => {
    const calls: string[] = [];
    const { ports } = createPorts({
      loadRoom: () => { calls.push('load'); },
      resetTransitionReveal: () => { calls.push('transition'); },
      resetFrameClock: () => { throw new Error('frame failed'); },
      onRespawn: () => { calls.push('respawn'); },
    });
    assert.throws(
      () => executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports),
      /frame failed/,
    );
    assert.deepEqual(calls, ['load', 'transition']);
  });

  it('propagates a respawn-callback failure after preceding operations complete', () => {
    const calls: string[] = [];
    const { ports } = createPorts({
      loadRoom: () => { calls.push('load'); },
      resetTransitionReveal: () => { calls.push('transition'); },
      resetFrameClock: () => { calls.push('frame'); },
      onRespawn: () => { throw new Error('respawn failed'); },
    });
    assert.throws(
      () => executeGameDeathRespawn(undefined, campaignRoom, campaignBlock, ports),
      /respawn failed/,
    );
    assert.deepEqual(calls, ['load', 'transition', 'frame']);
  });
});

describe('executeGameDeathRespawn — mutation and isolation', () => {
  it('does not mutate progress, spawn tuples, or room definitions', () => {
    const progress = createDefaultProgress();
    progress.lastSaveRoomId = 'saved-room';
    progress.lastSaveSpawnBlock = [5, 6];
    const savedRoom = makeRoom('saved-room');
    const progressSnapshot = JSON.parse(JSON.stringify(progress));
    const savedRoomSnapshot = JSON.parse(JSON.stringify(savedRoom));
    const campaignRoomSnapshot = JSON.parse(JSON.stringify(campaignRoom));
    const campaignBlockSnapshot = [...campaignBlock];

    const { ports } = createPorts({ getRoomById: () => savedRoom });
    executeGameDeathRespawn(progress, campaignRoom, campaignBlock, ports);

    assert.deepEqual(progress, progressSnapshot);
    assert.deepEqual(savedRoom, savedRoomSnapshot);
    assert.deepEqual(campaignRoom, campaignRoomSnapshot);
    assert.deepEqual([...campaignBlock], campaignBlockSnapshot);
  });

  it('repeated calls with different registries/progress remain independent', () => {
    const progressA = createDefaultProgress();
    progressA.lastSaveRoomId = 'room-a';
    progressA.lastSaveSpawnBlock = [1, 1];
    const roomA = makeRoom('room-a');

    const progressB = createDefaultProgress();
    progressB.lastSaveRoomId = 'room-b';
    progressB.lastSaveSpawnBlock = [2, 2];
    const roomB = makeRoom('room-b');

    const recordedA: string[] = [];
    const { ports: portsA } = createPorts({
      getRoomById: (id) => (id === 'room-a' ? roomA : undefined),
      loadRoom: (room, x, y) => { recordedA.push(`${room.id}:${x}:${y}`); },
    });
    const recordedB: string[] = [];
    const { ports: portsB } = createPorts({
      getRoomById: (id) => (id === 'room-b' ? roomB : undefined),
      loadRoom: (room, x, y) => { recordedB.push(`${room.id}:${x}:${y}`); },
    });

    executeGameDeathRespawn(progressA, campaignRoom, campaignBlock, portsA);
    executeGameDeathRespawn(progressB, campaignRoom, campaignBlock, portsB);

    assert.deepEqual(recordedA, ['room-a:1:1']);
    assert.deepEqual(recordedB, ['room-b:2:2']);
  });
});
