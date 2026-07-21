import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyBindingForces, INFLUENCE_RADIUS_WORLD } from '../sim/clusters/binding';
import { integrateParticles } from '../sim/particles/integration';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { ParticleKind } from '../sim/particles/kinds';

const DT_MS = 1000 / 60;
const PLAYER_ENTITY_ID = 1;

function makeWorldWithFarMote(
  distanceWorld: number,
  opts: { playerVel?: number; ownerEntityId?: number } = {},
) {
  const world = createWorldState(DT_MS);
  const player = createClusterState(PLAYER_ENTITY_ID, 0, 0, 1, 8);
  player.isGroundedFlag = 0;
  player.velocityXWorld = opts.playerVel ?? 0;
  world.clusters.push(player);

  const profile = getElementProfile(ParticleKind.Golden);
  const i = 0;
  world.particleCount = 1;
  world.isAliveFlag[i] = 1;
  world.ownerEntityId[i] = opts.ownerEntityId ?? PLAYER_ENTITY_ID;
  world.kindBuffer[i] = ParticleKind.Golden;
  world.behaviorMode[i] = 0; // orbit
  world.positionXWorld[i] = distanceWorld; // far out along +x
  world.positionYWorld[i] = 0;
  world.velocityXWorld[i] = 0;
  world.velocityYWorld[i] = 0;
  world.massKg[i] = profile.massKg;
  world.anchorAngleRad[i] = 0;
  world.anchorRadiusWorld[i] = profile.orbitRadiusWorld;
  return world;
}

function stepTick(world: ReturnType<typeof createWorldState>): void {
  const dtSec = DT_MS / 1000;
  const player = world.clusters[0];
  player.positionXWorld += player.velocityXWorld * dtSec;
  world.forceX[0] = 0;
  world.forceY[0] = 0;
  applyBindingForces(world);
  integrateParticles(world);
  world.tick++;
}

test('a player mote starting well beyond the influence radius moves back toward the player', () => {
  const world = makeWorldWithFarMote(INFLUENCE_RADIUS_WORLD * 2);
  const startDist = Math.hypot(world.positionXWorld[0] - world.clusters[0].positionXWorld, world.positionYWorld[0]);

  for (let t = 0; t < 120; t++) stepTick(world);

  const endDist = Math.hypot(world.positionXWorld[0] - world.clusters[0].positionXWorld, world.positionYWorld[0]);
  assert.ok(endDist < startDist, `mote should have moved closer: start ${startDist}, end ${endDist}`);
});

test('far-recovery eventually brings the mote back within the influence radius (no indefinite drift)', () => {
  const world = makeWorldWithFarMote(INFLUENCE_RADIUS_WORLD * 1.8);
  let withinRadius = false;
  for (let t = 0; t < 600 && !withinRadius; t++) {
    stepTick(world);
    const dist = Math.hypot(world.positionXWorld[0] - world.clusters[0].positionXWorld, world.positionYWorld[0]);
    if (dist <= INFLUENCE_RADIUS_WORLD) withinRadius = true;
  }
  assert.ok(withinRadius, 'a far mote must eventually recover within the influence radius, never drift indefinitely');
});

test('recovery still works while the player is moving quickly', () => {
  const world = makeWorldWithFarMote(INFLUENCE_RADIUS_WORLD * 1.5, { playerVel: 200 });
  const distances: number[] = [];
  for (let t = 0; t < 300; t++) {
    stepTick(world);
    const dx = world.positionXWorld[0] - world.clusters[0].positionXWorld;
    const dy = world.positionYWorld[0] - world.clusters[0].positionYWorld;
    distances.push(Math.hypot(dx, dy));
  }
  // Should trend downward overall even though the player itself is racing away.
  const earlyAvg = distances.slice(0, 30).reduce((a, b) => a + b, 0) / 30;
  const lateAvg = distances.slice(-30).reduce((a, b) => a + b, 0) / 30;
  assert.ok(lateAvg < earlyAvg, `recovery should still close distance while the player moves: early ${earlyAvg}, late ${lateAvg}`);
});

test('velocity stays finite and bounded throughout recovery (no explosive acceleration)', () => {
  const world = makeWorldWithFarMote(INFLUENCE_RADIUS_WORLD * 3);
  let maxSpeed = 0;
  for (let t = 0; t < 400; t++) {
    stepTick(world);
    const speed = Math.hypot(world.velocityXWorld[0], world.velocityYWorld[0]);
    assert.ok(Number.isFinite(speed), 'velocity must remain finite');
    maxSpeed = Math.max(maxSpeed, speed);
  }
  // A generous but real ceiling — nowhere near "explosive"/teleport-scale speeds.
  assert.ok(maxSpeed < 2000, `max speed ${maxSpeed} should stay bounded, not explosive`);
});

test('hard safety relocation resolves an extreme-distance discontinuity (e.g. stale position after a room/owner jump)', () => {
  const world = makeWorldWithFarMote(5000); // absurdly far — simulates a stale position after a discontinuity
  world.forceX[0] = 0;
  world.forceY[0] = 0;
  applyBindingForces(world);
  const dist = Math.hypot(world.positionXWorld[0] - world.clusters[0].positionXWorld, world.positionYWorld[0]);
  assert.ok(dist < INFLUENCE_RADIUS_WORLD, 'extreme distance triggers an immediate hard relocation back near the player');
  assert.equal(world.velocityXWorld[0], 0, 'relocation zeroes velocity rather than launching it back at high speed');
  assert.equal(world.velocityYWorld[0], 0);
});

test('non-player particles with no resolvable owner are unaffected by far-recovery — they drift freely', () => {
  const world = makeWorldWithFarMote(INFLUENCE_RADIUS_WORLD * 2, { ownerEntityId: 999 }); // owned by a non-existent/non-player cluster
  const startX = world.positionXWorld[0];
  const startY = world.positionYWorld[0];
  for (let t = 0; t < 120; t++) stepTick(world);
  // No owner cluster exists with entityId 999, so binding finds no owner and
  // this particle is skipped entirely (matches prior behavior) — position
  // must be unchanged by any binding force (only gravity/other systems, which
  // are absent in this isolated test, could move it).
  assert.equal(world.positionXWorld[0], startX);
  assert.equal(world.positionYWorld[0], startY);
});

test('an enemy-owned particle beyond ITS owner\'s influence radius keeps the exact prior (skip/drift) behavior', () => {
  const world = createWorldState(DT_MS);
  const player = createClusterState(PLAYER_ENTITY_ID, 0, 0, 1, 8);
  world.clusters.push(player);
  const enemyEntityId = 2;
  const enemy = createClusterState(enemyEntityId, 500, 500, 0, 10);
  world.clusters.push(enemy);

  const profile = getElementProfile(ParticleKind.Fire);
  const i = 0;
  world.particleCount = 1;
  world.isAliveFlag[i] = 1;
  world.ownerEntityId[i] = enemyEntityId;
  world.kindBuffer[i] = ParticleKind.Fire;
  world.behaviorMode[i] = 0;
  world.positionXWorld[i] = enemy.positionXWorld + INFLUENCE_RADIUS_WORLD * 2;
  world.positionYWorld[i] = enemy.positionYWorld;
  world.velocityXWorld[i] = 0;
  world.velocityYWorld[i] = 0;
  world.massKg[i] = profile.massKg;
  world.anchorAngleRad[i] = 0;
  world.anchorRadiusWorld[i] = profile.orbitRadiusWorld;

  const startX = world.positionXWorld[i];
  const startY = world.positionYWorld[i];
  for (let t = 0; t < 200; t++) {
    world.forceX[i] = 0;
    world.forceY[i] = 0;
    applyBindingForces(world);
    integrateParticles(world);
    world.tick++;
  }
  // No far-recovery force should ever be applied to a non-player-owned
  // particle, so with zero external forces it never accelerates or moves.
  assert.equal(world.positionXWorld[i], startX, 'enemy-owned far particle must not be pulled by far-recovery');
  assert.equal(world.positionYWorld[i], startY);
  assert.equal(world.velocityXWorld[i], 0);
  assert.equal(world.velocityYWorld[i], 0);
});

test('idle motes already near the player retain their prior behavior (far-recovery never engages in range)', () => {
  const world = makeWorldWithFarMote(INFLUENCE_RADIUS_WORLD * 0.3);
  world.clusters[0].isGroundedFlag = 1;
  world.clusters[0].velocityXWorld = 0;
  for (let t = 0; t < 60; t++) stepTick(world);
  const speed = Math.hypot(world.velocityXWorld[0], world.velocityYWorld[0]);
  assert.ok(speed < 60, `idle in-range mote speed ${speed} should stay calm, unaffected by far-recovery`);
});
