import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import type { WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles, releaseGrapple } from '../sim/clusters/grapple';
import {
  GRAPPLE_SEGMENT_COUNT,
  GRAPPLE_RELEASE_POOL_GROUPS,
  GRAPPLE_RELEASE_POOL_CAPACITY,
} from '../sim/clusters/grappleShared';
import { applyWallForces, applyWallBounce } from '../sim/particles/walls';
import { ParticleKind } from '../sim/particles/kinds';

function addWall(world: WorldState, x: number, y: number, w: number, h: number): void {
  const i = world.wallCount++;
  world.wallXWorld[i] = x;
  world.wallYWorld[i] = y;
  world.wallWWorld[i] = w;
  world.wallHWorld[i] = h;
}

/** Sets up a world with an active grapple whose chain slots are alive. */
function setUpActiveGrapple(world: WorldState, playerX: number, playerY: number): void {
  const player = createClusterState(1, playerX, playerY, 1, 100);
  world.clusters.push(player);
  initGrappleChainParticles(world, 1);

  world.isGrappleActiveFlag = 1;
  world.grappleAnchorXWorld = playerX + 100;
  world.grappleAnchorYWorld = playerY - 100;

  const start = world.grappleParticleStartIndex;
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const idx = start + i;
    world.isAliveFlag[idx] = 1;
    world.positionXWorld[idx] = playerX + i * 5;
    world.positionYWorld[idx] = playerY - i * 5;
  }
}

function countAliveInReleasePool(world: WorldState): number {
  let count = 0;
  const start = world.grappleReleaseStartIndex;
  for (let i = 0; i < GRAPPLE_RELEASE_POOL_CAPACITY; i++) {
    if (world.isAliveFlag[start + i] === 1) count++;
  }
  return count;
}

test('releaseGrapple allocates a dedicated release pool distinct from active chain slots', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);

  assert.ok(world.grappleReleaseStartIndex >= 0);
  assert.notEqual(world.grappleReleaseStartIndex, world.grappleParticleStartIndex);
  assert.equal(countAliveInReleasePool(world), 0);
});

test('releasing the grapple kills the old chain slots and spawns unowned Gold motes in the release pool', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);

  releaseGrapple(world, false, false);

  const chainStart = world.grappleParticleStartIndex;
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    assert.equal(world.isAliveFlag[chainStart + i], 0);
  }

  assert.equal(countAliveInReleasePool(world), GRAPPLE_SEGMENT_COUNT);
  const releaseStart = world.grappleReleaseStartIndex;
  for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) {
    const idx = releaseStart + i;
    assert.equal(world.ownerEntityId[idx], -1);
    assert.equal(world.kindBuffer[idx], ParticleKind.Gold);
    assert.equal(world.behaviorMode[idx], 0);
    assert.equal(world.isTransientFlag[idx], 1);
    const speed = Math.sqrt(
      world.velocityXWorld[idx] * world.velocityXWorld[idx] +
      world.velocityYWorld[idx] * world.velocityYWorld[idx],
    );
    assert.ok(speed > 0);
  }
});

test('up to GRAPPLE_RELEASE_POOL_GROUPS overlapping release bursts persist simultaneously', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);

  const fire = () => {
    world.isGrappleActiveFlag = 1;
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) world.isAliveFlag[start + i] = 1;
    releaseGrapple(world, false, false);
  };

  for (let burst = 0; burst < GRAPPLE_RELEASE_POOL_GROUPS; burst++) fire();

  assert.equal(countAliveInReleasePool(world), GRAPPLE_SEGMENT_COUNT * GRAPPLE_RELEASE_POOL_GROUPS);
});

test('a 4th overlapping release burst evicts the oldest group (round-robin)', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);

  const fire = () => {
    world.isGrappleActiveFlag = 1;
    const start = world.grappleParticleStartIndex;
    for (let i = 0; i < GRAPPLE_SEGMENT_COUNT; i++) world.isAliveFlag[start + i] = 1;
    releaseGrapple(world, false, false);
  };

  fire();
  fire();
  fire();
  assert.equal(world.grappleReleaseBurstCounter, GRAPPLE_RELEASE_POOL_GROUPS);

  fire(); // 4th release — deterministic round-robin must reuse group 0 again
  assert.equal(world.grappleReleaseBurstCounter, GRAPPLE_RELEASE_POOL_GROUPS + 1);
  assert.equal(countAliveInReleasePool(world), GRAPPLE_SEGMENT_COUNT * GRAPPLE_RELEASE_POOL_GROUPS);
});

test('released motes receive zero wall-repulsion force while near but not touching a wall', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);
  addWall(world, 20, -50, 8, 100); // wall just to the right, within the 18wu repulsion margin

  releaseGrapple(world, false, false);
  const releaseStart = world.grappleReleaseStartIndex;
  world.positionXWorld[releaseStart] = 10; // 10 world units from wall face — inside old repulsion margin
  world.positionYWorld[releaseStart] = 0;
  world.forceX[releaseStart] = 0;
  world.forceY[releaseStart] = 0;

  applyWallForces(world);

  assert.equal(world.forceX[releaseStart], 0);
  assert.equal(world.forceY[releaseStart], 0);
});

test('released motes reflect off a contacted wall and retain exactly 50% speed', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);
  addWall(world, 20, -50, 8, 100); // vertical wall face at x=20

  releaseGrapple(world, false, false);
  const idx = world.grappleReleaseStartIndex;
  world.positionXWorld[idx] = 18; // within bounce margin, approaching the wall
  world.positionYWorld[idx] = 0;
  world.velocityXWorld[idx] = 100; // moving toward the wall (+X)
  world.velocityYWorld[idx] = 0;

  applyWallBounce(world);

  // Normal points toward -X (away from wall); moving +X reflects to -X, damped 50%.
  assert.ok(world.velocityXWorld[idx] < 0);
  assert.ok(Math.abs(Math.abs(world.velocityXWorld[idx]) - 50) < 1e-6);
});

test('ordinary particles keep the generic 60% wall-bounce damping unaffected', () => {
  const world = createWorldState(1000 / 60, 1);
  addWall(world, 20, -50, 8, 100);

  const idx = world.particleCount++;
  world.kindBuffer[idx] = ParticleKind.Ice;
  world.ownerEntityId[idx] = -1;
  world.isAliveFlag[idx] = 1;
  world.isTransientFlag[idx] = 1;
  world.positionXWorld[idx] = 18;
  world.positionYWorld[idx] = 0;
  world.velocityXWorld[idx] = 100;
  world.velocityYWorld[idx] = 0;

  applyWallBounce(world);

  assert.ok(Math.abs(Math.abs(world.velocityXWorld[idx]) - 60) < 1e-6);
});
