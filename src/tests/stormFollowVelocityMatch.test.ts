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

/** Builds a world with a moving player cluster and one owned Gold orbit mote. */
function makeWorldWithPlayerAndMote(playerVelXWorld: number) {
  const world = createWorldState(DT_MS);
  const player = createClusterState(PLAYER_ENTITY_ID, 0, 0, 1, 8);
  player.isGroundedFlag = 0; // airborne so it is not treated as "standing still"
  player.velocityXWorld = playerVelXWorld;
  world.clusters.push(player);

  const profile = getElementProfile(ParticleKind.Golden);
  const i = 0;
  world.particleCount = 1;
  world.isAliveFlag[i] = 1;
  world.ownerEntityId[i] = PLAYER_ENTITY_ID;
  world.kindBuffer[i] = ParticleKind.Golden;
  world.behaviorMode[i] = 0; // orbit
  world.positionXWorld[i] = 0;
  world.positionYWorld[i] = 0;
  world.velocityXWorld[i] = 0;
  world.velocityYWorld[i] = 0;
  world.massKg[i] = profile.massKg;
  world.anchorAngleRad[i] = 0;
  world.anchorRadiusWorld[i] = profile.orbitRadiusWorld;
  return world;
}

/** Advances the sim by one tick: move player, accumulate binding forces, integrate. */
function stepTick(world: ReturnType<typeof makeWorldWithPlayerAndMote>): void {
  const dtSec = DT_MS / 1000;
  const player = world.clusters[0];
  player.positionXWorld += player.velocityXWorld * dtSec;
  world.forceX[0] = 0;
  world.forceY[0] = 0;
  applyBindingForces(world);
  integrateParticles(world);
  world.tick++;
}

test('storm follow keeps a fast-moving player\'s mote essentially in pace', () => {
  const PLAYER_VEL = 250; // grapple/zip-class speed
  const world = makeWorldWithPlayerAndMote(PLAYER_VEL);

  for (let t = 0; t < 120; t++) stepTick(world);

  // Mote velocity should track the player's velocity closely (small deficit).
  const moteVel = world.velocityXWorld[0];
  assert.ok(
    moteVel > PLAYER_VEL * 0.8,
    `mote velocity ${moteVel} should keep pace with player ${PLAYER_VEL}`,
  );

  // And it must never be left far behind: positional lag stays well within the
  // owner influence radius so the mote does not detach from the formation.
  const lag = world.clusters[0].positionXWorld - world.positionXWorld[0];
  assert.ok(
    lag < INFLUENCE_RADIUS_WORLD,
    `positional lag ${lag} should stay within influence radius ${INFLUENCE_RADIUS_WORLD}`,
  );
  assert.ok(lag > 0, 'a small intentional trailing lag should remain (fluid trailing)');
});

test('storm follow does not overshoot the player when it catches up', () => {
  const PLAYER_VEL = 200;
  const world = makeWorldWithPlayerAndMote(PLAYER_VEL);

  let maxMoteVel = 0;
  for (let t = 0; t < 200; t++) {
    stepTick(world);
    maxMoteVel = Math.max(maxMoteVel, world.velocityXWorld[0]);
  }
  // Well-damped: the mote velocity should not blow past the player's velocity
  // by a large margin (no runaway oscillation/overshoot).
  assert.ok(
    maxMoteVel < PLAYER_VEL * 1.25,
    `mote velocity ${maxMoteVel} overshot player velocity ${PLAYER_VEL} too far`,
  );
});

test('idle (standing) player leaves the follow velocity-match disabled', () => {
  // Grounded, stationary player → gate disabled → term contributes no force,
  // so the mote simply orbits at its anchor. Verify it does not get flung.
  const world = makeWorldWithPlayerAndMote(0);
  world.clusters[0].isGroundedFlag = 1;
  world.clusters[0].velocityXWorld = 0;

  for (let t = 0; t < 60; t++) stepTick(world);
  const speed = Math.hypot(world.velocityXWorld[0], world.velocityYWorld[0]);
  assert.ok(speed < 60, `idle mote speed ${speed} should stay calm`);
});
