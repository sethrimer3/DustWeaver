import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState, MAX_CANONICAL_MOTES } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import {
  grantOverhealthMotes,
  grantPlayerMotes,
  getPlayerMoteCount,
} from '../sim/playerMoteLife';
import { getStormweaveMoteCount } from '../sim/stormweave/lifeMotes';
import { applyPlayerDamageWithKnockback } from '../sim/playerDamage';
import { processRoomPickups } from '../screens/gamePickups';
import type { RoomDef } from '../levels/roomDef';
import { createRng } from '../sim/rng';

function makeRoom(overrides: Partial<RoomDef> = {}): RoomDef {
  return {
    id: 'test-room',
    dustContainers: [],
    dustContainerPieces: [],
    ...overrides,
  } as unknown as RoomDef;
}

test('overhealth: Dust Boost Jar collection grants exactly dustCount overhealth without touching capacity or spawning particles', () => {
  const world = createWorldState(1000 / 60, 1);
  const player = createClusterState(1, 0, 0, 1, 10);
  world.clusters = [player];

  world.dustBoostJarCount = 1;
  world.dustBoostJarKind[0] = 0; // Golden — must be an equippable kind
  world.dustBoostJarDustCount[0] = 7;
  world.isDustBoostJarActiveFlag[0] = 0; // deactivated == collected this frame

  const collectedKeySet = new Set<string>();
  const room = makeRoom();
  const before = world.particleCount;

  processRoomPickups(world, room, collectedKeySet, undefined, player, createRng(1));

  assert.equal(player.healthPoints, 17, 'health should be capacity(10) + dustCount(7) = 17 overhealth');
  assert.equal(player.maxHealthPoints, 10, 'max capacity must not change from a jar pickup');
  assert.equal(world.particleCount, before, 'no player-owned mode-0 particles should be spawned');
});

test('overhealth: damage consumes overhealth before permanent health slots empty', () => {
  const player = createClusterState(1, 0, 0, 1, 10);
  grantOverhealthMotes(player, 5); // health = 15, max = 10
  assert.equal(player.healthPoints, 15);

  applyPlayerDamageWithKnockback(player, 5, 100, 0);
  assert.equal(player.healthPoints, 10, 'overhealth absorbed the 5 damage; permanent health untouched');

  player.invulnerabilityTicks = 0; // clear post-hit invulnerability window for the second hit
  applyPlayerDamageWithKnockback(player, 3, 100, 0);
  assert.equal(player.healthPoints, 7, 'further damage now eats into permanent health');
});

test('overhealth: ordinary healing clamps to maxHealthPoints and does not restore lost overhealth', () => {
  const player = createClusterState(1, 0, 0, 1, 10);
  player.healthPoints = 4; // damaged, no overhealth
  const granted = grantPlayerMotes(player, 100);
  assert.equal(granted, 6, 'heal grant clamped to remaining capacity');
  assert.equal(player.healthPoints, 10, 'ordinary heal never exceeds maxHealthPoints');
});

test('overhealth: canonical stormweave mote count reflects current health including overhealth, clamped at MAX_CANONICAL_MOTES', () => {
  const player = createClusterState(1, 0, 0, 1, 10);
  grantOverhealthMotes(player, 8);
  assert.equal(player.healthPoints, 18);
  assert.equal(getPlayerMoteCount(player), 18);
  assert.equal(getStormweaveMoteCount(player.healthPoints), 18);

  // Absurd overhealth is still safely clamped rather than overflowing fixed-size arrays.
  grantOverhealthMotes(player, 10_000);
  assert.equal(getStormweaveMoteCount(player.healthPoints), MAX_CANONICAL_MOTES);
});
