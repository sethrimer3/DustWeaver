import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { fireGrapple } from '../sim/clusters/grapple';
import { tickPlayerMovement } from '../sim/clusters/playerMovement';
import {
  isVoidDustEquipped,
  quantizeVoidDashDirection,
  VOID_DASH_BRAKE_DURATION_SEC,
  VOID_DASH_LAUNCH_SPEED_WORLD_PER_SEC,
} from '../sim/clusters/voidDash';

function makeWorld(dtMs = 1000 / 60) {
  const world = createWorldState(dtMs, 1);
  const player = createClusterState(1, 10, 20, 1, 10);
  world.clusters = [player];
  world.selectedDustKind = ParticleKind.Void;
  world.hasGrappleChargeFlag = 1;
  return { world, player };
}

describe('Void Dust directional dash', () => {
  test('Void is the only dust kind accepted by its authoritative predicate', () => {
    const { world } = makeWorld();
    assert.equal(isVoidDustEquipped(world), true);
    world.selectedDustKind = ParticleKind.Golden;
    assert.equal(isVoidDustEquipped(world), false);
  });

  test('aim rounds to the nearest of 16 directions with exact cardinal axes', () => {
    assert.deepEqual(quantizeVoidDashDirection(10, 0), { x: 1, y: 0 });
    assert.deepEqual(quantizeVoidDashDirection(0, 10), { x: 0, y: 1 });
    assert.deepEqual(quantizeVoidDashDirection(-10, 0), { x: -1, y: 0 });
    assert.deepEqual(quantizeVoidDashDirection(0, -10), { x: 0, y: -1 });

    const step = Math.PI / 8;
    const nearSlotThree = quantizeVoidDashDirection(Math.cos(step * 3 + 0.04), Math.sin(step * 3 + 0.04));
    assert.ok(Math.abs(nearSlotThree.x - Math.cos(step * 3)) < 1e-12);
    assert.ok(Math.abs(nearSlotThree.y - Math.sin(step * 3)) < 1e-12);
  });

  test('grapple fire starts a Void dash, consumes charge, and creates no grapple', () => {
    const { world } = makeWorld();
    fireGrapple(world, 110, 20);
    assert.equal(world.voidDash.isBraking, true);
    assert.equal(world.isGrappleActiveFlag, 0);
    assert.equal(world.hasGrappleChargeFlag, 0);
    assert.equal(world.voidDash.launchDirXWorld, 1);
    assert.equal(world.voidDash.launchDirYWorld, 0);
  });

  test('velocity decreases linearly from the latched vector, then launches at exactly 300 px/s', () => {
    const { world, player } = makeWorld(250);
    player.velocityXWorld = 200;
    player.velocityYWorld = -100;
    fireGrapple(world, 10, -80); // straight up

    tickPlayerMovement(player, world, 0.25);
    assert.equal(player.velocityXWorld, 100);
    assert.equal(player.velocityYWorld, -50);
    assert.equal(world.voidDash.isBraking, true);

    tickPlayerMovement(player, world, 0.25);
    assert.equal(world.voidDash.elapsedSec, VOID_DASH_BRAKE_DURATION_SEC);
    assert.equal(world.voidDash.isBraking, false);
    assert.equal(player.velocityXWorld, 0);
    assert.equal(player.velocityYWorld, -VOID_DASH_LAUNCH_SPEED_WORLD_PER_SEC);
  });

  test('the 0.5-second result is stable under timestep subdivision and ignores input/gravity while braking', () => {
    const run = (dtSec: number) => {
      const { world, player } = makeWorld(dtSec * 1000);
      player.velocityXWorld = -240;
      player.velocityYWorld = 180;
      fireGrapple(world, 110, 20); // right
      const ticks = Math.round(0.5 / dtSec);
      for (let i = 0; i < ticks; i++) {
        world.playerMoveInputDxWorld = -1;
        world.playerJumpHeldFlag = 1;
        tickPlayerMovement(player, world, dtSec);
      }
      return { x: player.velocityXWorld, y: player.velocityYWorld };
    };

    assert.deepEqual(run(1 / 60), { x: 300, y: 0 });
    assert.deepEqual(run(1 / 120), { x: 300, y: 0 });
  });

  test('zero-distance aim does not consume the grapple charge', () => {
    const { world, player } = makeWorld();
    fireGrapple(world, player.positionXWorld, player.positionYWorld);
    assert.equal(world.voidDash.isBraking, false);
    assert.equal(world.hasGrappleChargeFlag, 1);
  });
});
