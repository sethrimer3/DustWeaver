import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleKind } from '../sim/particles/kinds';
import type { WorldSnapshot } from '../render/snapshot';
import {
  PLAYER_LUMINANT_BASE_RADIUS_WORLD,
  PLAYER_LUMINANT_RADIUS_PER_MOTE_WORLD,
  computePlayerLuminantTargetRadiusWorld,
  countActivePlayerLuminantMotes,
  resetPlayerLuminantLight,
  updatePlayerLuminantLight,
} from '../screens/gamePlayerLuminantLight';

const PLAYER_ENTITY_ID = 1;

function makeParticles(kinds: readonly ParticleKind[], owners: readonly number[]) {
  return {
    particleCount: kinds.length,
    isAliveFlag: new Uint8Array(kinds.length).fill(1),
    kindBuffer: Uint8Array.from(kinds),
    ownerEntityId: Int32Array.from(owners),
  };
}

function makeSnapshot(
  particleKinds: readonly ParticleKind[],
  particleOwners: readonly number[],
  playerAlive = true,
  playerX = 0,
  playerY = 0,
): WorldSnapshot {
  return {
    clusters: [
      {
        entityId: PLAYER_ENTITY_ID,
        isPlayerFlag: 1,
        isAliveFlag: playerAlive ? 1 : 0,
        positionXWorld: playerX,
        positionYWorld: playerY,
      },
    ],
    particles: makeParticles(particleKinds, particleOwners),
  } as unknown as WorldSnapshot;
}

test('target radius formula: base 100 + 10 per active Luminant mote', () => {
  assert.equal(computePlayerLuminantTargetRadiusWorld(0), 0);
  assert.equal(computePlayerLuminantTargetRadiusWorld(1), 110);
  assert.equal(computePlayerLuminantTargetRadiusWorld(4), 140);
});

test('damage reducing Luminant count from 4 to 3 lowers the target from 140 to 130', () => {
  const before = computePlayerLuminantTargetRadiusWorld(4);
  const after = computePlayerLuminantTargetRadiusWorld(3);
  assert.equal(before, 140);
  assert.equal(after, 130);
});

test('only alive, player-owned Light-kind particles count as active Luminant motes', () => {
  const particles = makeParticles(
    [ParticleKind.Light, ParticleKind.Light, ParticleKind.Golden, ParticleKind.Light],
    [PLAYER_ENTITY_ID, PLAYER_ENTITY_ID, PLAYER_ENTITY_ID, 99],
  );
  // Non-Luminant kind and a boss/enemy-owned Light mote must not contribute.
  assert.equal(countActivePlayerLuminantMotes(particles, PLAYER_ENTITY_ID), 2);

  particles.isAliveFlag[0] = 0;
  assert.equal(countActivePlayerLuminantMotes(particles, PLAYER_ENTITY_ID), 1);
});

test('rendered radius interpolates smoothly toward target rather than snapping', () => {
  resetPlayerLuminantLight();
  const snapshot = makeSnapshot(
    [ParticleKind.Light, ParticleKind.Light, ParticleKind.Light, ParticleKind.Light],
    [PLAYER_ENTITY_ID, PLAYER_ENTITY_ID, PLAYER_ENTITY_ID, PLAYER_ENTITY_ID],
  );

  const first = updatePlayerLuminantLight(snapshot, 1 / 60);
  assert.notEqual(first, null);
  assert.ok(first!.radiusWorld > 0 && first!.radiusWorld < 140, 'first frame must not snap straight to target');

  let last = first!.radiusWorld;
  for (let i = 0; i < 300; i++) {
    const l = updatePlayerLuminantLight(snapshot, 1 / 60);
    assert.ok(l!.radiusWorld >= last - 1e-6, 'radius must grow monotonically toward target while gaining motes');
    last = l!.radiusWorld;
  }
  assert.ok(Math.abs(last - 140) < 0.1, 'radius must converge to the 4-mote target of 140');
});

test('zero Luminant motes fades the light out to null rather than staying visible', () => {
  resetPlayerLuminantLight();
  const withMotes = makeSnapshot([ParticleKind.Light], [PLAYER_ENTITY_ID]);
  for (let i = 0; i < 120; i++) updatePlayerLuminantLight(withMotes, 1 / 60);

  const withoutMotes = makeSnapshot([], []);
  let result = updatePlayerLuminantLight(withoutMotes, 1 / 60);
  assert.notEqual(result, null, 'should still be visible immediately after losing motes (fading, not snapped off)');

  for (let i = 0; i < 300; i++) result = updatePlayerLuminantLight(withoutMotes, 1 / 60);
  assert.equal(result, null, 'light must fully fade out and be removed once settled at zero');
});

test('re-equipping Luminant motes restores exactly one light, never duplicates', () => {
  resetPlayerLuminantLight();
  const none = makeSnapshot([], []);
  for (let i = 0; i < 300; i++) updatePlayerLuminantLight(none, 1 / 60);

  const withOne = makeSnapshot([ParticleKind.Light], [PLAYER_ENTITY_ID]);
  const a = updatePlayerLuminantLight(withOne, 1 / 60);
  const b = updatePlayerLuminantLight(withOne, 1 / 60);
  assert.notEqual(a, null);
  assert.strictEqual(a, b, 'must reuse the same singleton LightDef instance, never allocate a second light');
});

test('death/respawn/room-transition reset clears the light immediately', () => {
  const snapshot = makeSnapshot([ParticleKind.Light, ParticleKind.Light], [PLAYER_ENTITY_ID, PLAYER_ENTITY_ID]);
  for (let i = 0; i < 60; i++) updatePlayerLuminantLight(snapshot, 1 / 60);
  assert.notEqual(updatePlayerLuminantLight(snapshot, 1 / 60), null);

  resetPlayerLuminantLight();
  // Immediately after reset, even with motes present, the light must rebuild
  // from zero (no stale radius/intensity carried across the transition).
  const afterReset = updatePlayerLuminantLight(snapshot, 1 / 600);
  assert.notEqual(afterReset, null);
  assert.ok(afterReset!.radiusWorld < 5, 'radius must restart from ~0 after a reset, not resume from stale state');
});

test('dead player produces no light', () => {
  resetPlayerLuminantLight();
  const snapshot = makeSnapshot([ParticleKind.Light], [PLAYER_ENTITY_ID], /* playerAlive */ false);
  for (let i = 0; i < 300; i++) updatePlayerLuminantLight(snapshot, 1 / 60);
  assert.equal(updatePlayerLuminantLight(snapshot, 1 / 60), null);
});

test('constants match the specified formula', () => {
  assert.equal(PLAYER_LUMINANT_BASE_RADIUS_WORLD, 100);
  assert.equal(PLAYER_LUMINANT_RADIUS_PER_MOTE_WORLD, 10);
});
