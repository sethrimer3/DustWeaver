/**
 * Regression tests for the Ice Mote freeze aura (src/sim/iceMoteAura.ts):
 *   - 80px-radius nearest-point detection freezes/ignores water zones correctly.
 *   - Frozen zones become solid (injected ice wall) and suppress water physics.
 *   - Freeze lifetime is a fixed 60 simulation ticks (1000ms at the 16.666ms
 *     fixed tick) that is NOT reset by continued proximity.
 *   - A post-thaw cooldown prevents instant re-freeze until the zone leaves
 *     the radius at least once.
 *   - Unequipping Ice Motes stops new freezes but lets active ice finish.
 *   - Thaw restores the exact original water zone data.
 *   - Room reload/reset clears all aura state.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createClusterState } from '../sim/clusters/state';
import { createWorldState, type WorldState } from '../sim/world';
import { computePlayerWaterState } from '../sim/hazards';
import { ParticleKind } from '../sim/particles/kinds';
import {
  ICE_MOTE_FREEZE_RADIUS_WORLD,
  ICE_MOTE_FREEZE_LIFETIME_MS,
  tickIceMoteAura,
  resetIceMoteAuraForRoom,
} from '../sim/iceMoteAura';

const DT_MS = 1000 / 60; // fixed 60Hz tick -> 16.666...ms per tick
const TICKS_PER_SECOND = Math.round(1000 / DT_MS);

function createWorldWithWaterZone(
  playerX: number,
  playerY: number,
  zone: { x: number; y: number; w: number; h: number },
  moteKind: number = ParticleKind.Ice,
): WorldState {
  const world = createWorldState(DT_MS, 123);
  const player = createClusterState(1, playerX, playerY, 1, 10);
  world.clusters.push(player);
  world.selectedDustKind = moteKind;

  world.waterZoneCount = 1;
  world.waterZoneXWorld[0] = zone.x;
  world.waterZoneYWorld[0] = zone.y;
  world.waterZoneWWorld[0] = zone.w;
  world.waterZoneHWorld[0] = zone.h;

  // The aura module holds its tracking state in a module-level singleton
  // (mirroring production, where a single WorldState is live at a time), so
  // each test must reset it the same way a real room load does — this also
  // captures world.wallCount as the correct baseWallCount for THIS world.
  resetIceMoteAuraForRoom(world);

  return world;
}

function stepTicks(world: WorldState, n: number): void {
  for (let i = 0; i < n; i++) {
    tickIceMoteAura(world);
    computePlayerWaterState(world);
  }
}

describe('Ice Mote freeze aura', () => {
  test('water within 80px freezes when Ice Motes are equipped', () => {
    // Player at (0,0), zone spans x=[70,110]; nearest point is x=70 -> dist 70 <= 80.
    const world = createWorldWithWaterZone(0, 0, { x: 70, y: -5, w: 40, h: 10 });

    tickIceMoteAura(world);

    assert.equal(world.frozenWaterZoneMask[0], 1);
  });

  test('water beyond 80px does not freeze', () => {
    // Nearest point at x=90 -> dist 90 > 80.
    const world = createWorldWithWaterZone(0, 0, { x: 90, y: -5, w: 40, h: 10 });

    tickIceMoteAura(world);

    assert.equal(world.frozenWaterZoneMask[0], 0);
  });

  test('no freezing occurs with a different mote type equipped', () => {
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 }, ParticleKind.Fire);

    tickIceMoteAura(world);

    assert.equal(world.frozenWaterZoneMask[0], 0);
  });

  test('frozen water is solid and suppresses normal water physics', () => {
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 });
    const baseWallCount = world.wallCount;

    tickIceMoteAura(world);
    computePlayerWaterState(world);

    // A new ice wall was injected for the frozen zone.
    assert.equal(world.wallCount, baseWallCount + 1);
    assert.equal(world.wallIsIceFlag[baseWallCount], 1);
    assert.equal(world.wallIsPlatformFlag[baseWallCount], 1);

    // Normal water-in-contact detection skips frozen zones.
    assert.equal(world.isPlayerInWaterFlag, 0);
  });

  test('ice thaws after exactly 60 ticks (1 second) of simulation time', () => {
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 });
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);

    // Advance 59 more ticks (60 total including the freeze tick) -> still frozen.
    for (let i = 0; i < TICKS_PER_SECOND - 1; i++) tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1, 'should still be frozen just before lifetime elapses');

    // One more tick crosses the ICE_MOTE_FREEZE_LIFETIME_MS threshold.
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 0, 'should have thawed at exactly 60 ticks');
  });

  test('remaining inside the radius the whole time does not reset/extend the timer', () => {
    // Player stays put, well inside radius, for the entire lifetime + margin.
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 });
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);

    stepTicks(world, TICKS_PER_SECOND + 5);

    // Despite never leaving radius, the zone thawed right on schedule.
    assert.equal(world.frozenWaterZoneMask[0], 0);
  });

  test('water can freeze again after leaving and re-entering the radius post-thaw', () => {
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 });
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);

    // Run to completion so it thaws.
    stepTicks(world, TICKS_PER_SECOND);
    assert.equal(world.frozenWaterZoneMask[0], 0);

    // Still inside radius immediately after thaw -> must NOT re-freeze (cooldown).
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 0, 'should stay thawed while still within radius after thaw');

    // Move the player far away (leaves radius), then back into range.
    world.clusters[0].positionXWorld = -10000;
    tickIceMoteAura(world); // cooldown cleared while outside radius

    world.clusters[0].positionXWorld = 0; // back in range
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1, 'should be able to re-freeze after leaving and re-entering');
  });

  test('unequipping Ice Motes prevents new freezes but active ice keeps running its full lifetime', () => {
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 });
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);

    // Unequip.
    world.selectedDustKind = ParticleKind.Fire;

    // Should NOT immediately thaw.
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1, 'existing ice must not be cut short by unequip');

    // Runs to its normal completion.
    stepTicks(world, TICKS_PER_SECOND);
    assert.equal(world.frozenWaterZoneMask[0], 0);

    // And no new freeze occurs while unequipped, even though still in range.
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 0);
  });

  test('thawing restores the exact original water zone data', () => {
    const zone = { x: 12.5, y: -3.25, w: 41.5, h: 9.75 };
    const world = createWorldWithWaterZone(0, 0, zone);

    const before = {
      x: world.waterZoneXWorld[0],
      y: world.waterZoneYWorld[0],
      w: world.waterZoneWWorld[0],
      h: world.waterZoneHWorld[0],
    };

    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);

    stepTicks(world, TICKS_PER_SECOND);
    assert.equal(world.frozenWaterZoneMask[0], 0);

    assert.deepEqual(
      {
        x: world.waterZoneXWorld[0],
        y: world.waterZoneYWorld[0],
        w: world.waterZoneWWorld[0],
        h: world.waterZoneHWorld[0],
      },
      before,
    );
  });

  test('room reset clears all frozen/cooldown state', () => {
    const world = createWorldWithWaterZone(0, 0, { x: 10, y: -5, w: 40, h: 10 });
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);
    const frozenWallCount = world.wallCount;
    assert.ok(frozenWallCount > 0);

    resetIceMoteAuraForRoom(world);

    assert.equal(world.frozenWaterZoneMask[0], 0);
    // resetIceMoteAuraForRoom itself doesn't rewind world.wallCount (that's the
    // job of the room's authored-wall load, which runs separately); it re-captures
    // the CURRENT wallCount as the new baseWallCount so future freezes append cleanly.
    assert.equal(world.wallCount, frozenWallCount);

    // And it is immediately freezable again (no leftover cooldown from the reset room).
    tickIceMoteAura(world);
    assert.equal(world.frozenWaterZoneMask[0], 1);
  });

  test('freeze radius constant matches the 80px spec', () => {
    assert.equal(ICE_MOTE_FREEZE_RADIUS_WORLD, 80);
  });

  test('freeze lifetime constant matches 60 ticks (1000ms) at the fixed 60Hz tick', () => {
    assert.equal(ICE_MOTE_FREEZE_LIFETIME_MS, 1000);
    assert.equal(TICKS_PER_SECOND, 60);
  });
});
