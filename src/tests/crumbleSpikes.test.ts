/**
 * Tests for crumble spikes — extending crumble ("Cracked") support from
 * plain rect/ramp/stairs blocks to 1x1 and 2x2 spikes.
 *
 * Covers:
 *  - Editor conversion (Cracked toggle on/off) for 1x1 and 2x2 spikes,
 *    preserving direction/size/theme through the round trip.
 *  - Serialization round-trip: Editor -> RoomJson -> Editor, and
 *    Editor/RoomJson -> SavedCrumble compact format -> back.
 *  - Runtime: player meeting the break requirement (isHighVelocityAttacking)
 *    contacting a crumble spike breaks it and deals no damage.
 *  - Runtime: player NOT meeting the break requirement takes normal spike
 *    damage and the block remains active.
 *  - Platforms remain ineligible for the Cracked toggle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { handleCrumbleModifierToggle } from '../editor/editorPropertyChange';
import { createEditorHistory } from '../editor/editorHistory';
import { editorRoomDataToJson } from '../editor/roomJsonSerializer';
import { jsonToEditorRoomData } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { updateMomentumCombatState } from '../sim/momentumCombat';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../sim/momentumCombatConfig';
import { setCombatMode } from '../sim/combatMode';
import { applyHazards } from '../sim/hazards';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import type { RoomDef } from '../levels/roomDef';

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
    playerSpawnBlock: [18, 18],
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
    spikes: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Editor conversion ────────────────────────────────────────────────────────

for (const size of ['1x1', '2x2'] as const) {
  test(`handleCrumbleModifierToggle(true) converts a ${size} spike into a crumble spike, preserving direction/size/theme`, () => {
    const room = makeRoom({
      spikes: [{ uid: 9, xBlock: 3, yBlock: 4, direction: 'up', size, blockTheme: 'blackRock' }],
    });
    const state = createEditorState();
    state.roomData = room;
    state.selectedElements = [{ type: 'spike', uid: 9 }];
    const history = createEditorHistory();

    const changed = handleCrumbleModifierToggle(state, history, true);
    assert.equal(changed, true);
    assert.equal((room.spikes ?? []).length, 0, 'spike removed from spikes array');
    assert.equal((room.crumbleBlocks ?? []).length, 1, 'crumble block created');
    const block = (room.crumbleBlocks ?? [])[0];
    assert.equal(block.uid, 9);
    assert.equal(block.spikeDirection, 'up');
    assert.equal(block.spikeSize, size);
    assert.equal(block.blockTheme, 'blackRock');
    assert.equal(block.xBlock, 3);
    assert.equal(block.yBlock, 4);
    const expectedBlocks = size === '2x2' ? 2 : 1;
    assert.equal(block.wBlock, expectedBlocks);
    assert.equal(block.hBlock, expectedBlocks);
    assert.equal(state.selectedElements[0].type, 'crumbleBlock');

    // Toggle back off — should restore an EditorSpike, not a plain EditorWall.
    // Use a fresh history so this doesn't coalesce with the just-pushed
    // on-toggle entry (coalescing on/off within 1.5s of each other into a
    // single undo step is correct editor behavior, but would make
    // `commitPendingSnapshot` report 'noop' here since it nets out to the
    // original state — see editorHistory.ts's Property: label coalescing).
    const history2 = createEditorHistory();
    const changedBack = handleCrumbleModifierToggle(state, history2, false);
    assert.equal(changedBack, true);
    assert.equal((room.crumbleBlocks ?? []).length, 0);
    assert.equal((room.spikes ?? []).length, 1);
    const spike = (room.spikes ?? [])[0];
    assert.equal(spike.uid, 9);
    assert.equal(spike.direction, 'up');
    assert.equal(spike.size, size);
    assert.equal(spike.blockTheme, 'blackRock');
    assert.equal(state.selectedElements[0].type, 'spike');
  });
}

test('handleCrumbleModifierToggle leaves a platform wall ineligible even alongside a spike', () => {
  const room = makeRoom({
    interiorWalls: [{
      uid: 1, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1,
      isPlatformFlag: 1, platformEdge: 0,
    } as never],
    spikes: [{ uid: 2, xBlock: 5, yBlock: 5, direction: 'down', size: '1x1' }],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 1 }, { type: 'spike', uid: 2 }];
  const history = createEditorHistory();

  const changed = handleCrumbleModifierToggle(state, history, true);
  assert.equal(changed, true, 'the eligible spike sibling should still convert');
  assert.equal((room.interiorWalls ?? []).length, 1, 'platform wall must remain untouched');
  assert.equal(room.interiorWalls[0].isPlatformFlag, 1);
  assert.equal((room.spikes ?? []).length, 0, 'spike was converted');
  assert.equal((room.crumbleBlocks ?? []).length, 1);
});

// ── Serialization round-trip ─────────────────────────────────────────────────

test('crumble spike round-trips through EditorRoomData -> RoomJson -> EditorRoomData', () => {
  const room = makeRoom({
    crumbleBlocks: [{
      uid: 11, xBlock: 2, yBlock: 2, wBlock: 2, hBlock: 2,
      variant: 'fire', blockTheme: 'blackRock',
      spikeDirection: 'left', spikeSize: '2x2',
    } as never],
  });
  const json = editorRoomDataToJson(room);
  const entry = (json.crumbleBlocks ?? [])[0];
  assert.equal(entry.spikeDirection, 'left');
  assert.equal(entry.spikeSize, '2x2');

  const { data: restored } = jsonToEditorRoomData(json, 1000);
  const restoredBlock = (restored.crumbleBlocks ?? [])[0];
  assert.equal(restoredBlock.spikeDirection, 'left');
  assert.equal(restoredBlock.spikeSize, '2x2');
  assert.equal(restoredBlock.variant, 'fire');
  assert.equal(restoredBlock.blockTheme, 'blackRock');
});

test('crumble spike round-trips through RoomJson -> SavedCrumble (compact V2) -> RoomJson', () => {
  const room = makeRoom({
    crumbleBlocks: [{
      uid: 12, xBlock: 6, yBlock: 1, wBlock: 1, hBlock: 1,
      variant: 'normal', spikeDirection: 'right', spikeSize: '1x1',
    } as never],
  });
  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  assert.ok(saved.crumbles && saved.crumbles.length === 1);
  const savedEntry = saved.crumbles[0];
  assert.equal(savedEntry.sd, 'right');
  assert.equal(savedEntry.ss, undefined, '1x1 is the default and should be omitted');

  const rehydrated = hydrateV2Room(saved);
  const rehydratedEntry = (rehydrated.crumbleBlocks ?? [])[0];
  assert.equal(rehydratedEntry.spikeDirection, 'right');
  assert.equal(rehydratedEntry.spikeSize, '1x1');
});

test('crumble spike 2x2 preserves ss=2x2 through the compact V2 round trip', () => {
  const room = makeRoom({
    crumbleBlocks: [{
      uid: 13, xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 2,
      variant: 'normal', spikeDirection: 'down', spikeSize: '2x2',
    } as never],
  });
  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  const savedEntry = (saved.crumbles ?? [])[0];
  assert.equal(savedEntry.sd, 'down');
  assert.equal(savedEntry.ss, '2x2');

  const rehydrated = hydrateV2Room(saved);
  const rehydratedEntry = (rehydrated.crumbleBlocks ?? [])[0];
  assert.equal(rehydratedEntry.spikeDirection, 'down');
  assert.equal(rehydratedEntry.spikeSize, '2x2');
});

// ── Runtime behavior ─────────────────────────────────────────────────────────

function makeWorldWithPlayer(px: number, py: number): WorldState {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, px, py, 1, 10);
  player.halfWidthWorld = 6;
  player.halfHeightWorld = 8;
  world.clusters = [player];
  return world;
}

/** Loads a single crumble-spike room via the real loadRoomHazards path. */
function makeRoomDefWithCrumbleSpike(direction: 'up' | 'down' | 'left' | 'right', size: '1x1' | '2x2'): RoomDef {
  return {
    crumbleBlocks: [{
      xBlock: 2, yBlock: 0, wBlock: size === '2x2' ? 2 : 1, hBlock: size === '2x2' ? 2 : 1,
      variant: 'normal', spikeDirection: direction, spikeSize: size,
    }],
  } as unknown as RoomDef;
}

test('crumble spike breaks (no damage) when the player meets the momentum-attack break requirement', () => {
  const world = makeWorldWithPlayer(0, 0);
  loadRoomHazards(world, makeRoomDefWithCrumbleSpike('up', '1x1'));
  assert.equal(world.spikeCount, 1);
  assert.equal(world.crumbleBlockCount, 1);
  const crumbleIdx = world.spikeCrumbleBlockIndex[0];
  assert.ok(crumbleIdx >= 0, 'spike must be linked to its crumble-block record');

  setCombatMode('momentum');
  world.combatMode = 'momentum';
  const player = world.clusters[0];
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  updateMomentumCombatState(world);
  assert.equal(player.isHighVelocityAttacking, 1);

  // Spike direction 'up' -> damaging half is the bottom half of the tile.
  // Position the player overlapping that region.
  player.positionXWorld = world.spikeXWorld[0];
  player.positionYWorld = world.spikeYWorld[0] + BLOCK_SIZE_MEDIUM * 0.25;
  const healthBefore = player.healthPoints;

  applyHazards(world);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIdx], 0, 'crumble spike must be destroyed');
  assert.equal(player.healthPoints, healthBefore, 'no damage should be dealt on a qualifying break');
});

test('crumble spike deals normal spike damage and stays active when the break requirement is not met', () => {
  const world = makeWorldWithPlayer(0, 0);
  loadRoomHazards(world, makeRoomDefWithCrumbleSpike('up', '1x1'));
  const crumbleIdx = world.spikeCrumbleBlockIndex[0];
  assert.ok(crumbleIdx >= 0);

  const player = world.clusters[0];
  assert.equal(player.isHighVelocityAttacking, 0, 'player is not attacking by default');

  player.positionXWorld = world.spikeXWorld[0];
  player.positionYWorld = world.spikeYWorld[0] + BLOCK_SIZE_MEDIUM * 0.25;
  const healthBefore = player.healthPoints;

  applyHazards(world);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIdx], 1, 'crumble spike must remain active');
  assert.ok(player.healthPoints < healthBefore, 'casual contact should still deal normal spike damage');
});

test('a destroyed crumble spike no longer damages the player on subsequent ticks', () => {
  const world = makeWorldWithPlayer(0, 0);
  loadRoomHazards(world, makeRoomDefWithCrumbleSpike('up', '1x1'));
  const crumbleIdx = world.spikeCrumbleBlockIndex[0];
  const player = world.clusters[0];

  setCombatMode('momentum');
  world.combatMode = 'momentum';
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  updateMomentumCombatState(world);
  player.positionXWorld = world.spikeXWorld[0];
  player.positionYWorld = world.spikeYWorld[0] + BLOCK_SIZE_MEDIUM * 0.25;
  applyHazards(world);
  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIdx], 0);

  // Reset invuln/attack state and stay in the same overlapping position —
  // a live (non-crumble) spike would deal damage here; a destroyed one must not.
  world.spikeInvulnTicks = 0;
  player.isHighVelocityAttacking = 0;
  const healthBefore = player.healthPoints;
  applyHazards(world);
  assert.equal(player.healthPoints, healthBefore, 'destroyed crumble spike must be fully inert');
});
