import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { integrateParticles } from '../sim/particles/integration';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { ParticleKind } from '../sim/particles/kinds';
import { applyShieldWeaveCrescent } from '../sim/weaves/shieldWeave';
import { MOTE_STATE_AVAILABLE } from '../sim/motes/orderedMoteQueue';

const DT_MS = 1000 / 60;
const PLAYER_ENTITY_ID = 1;
const SHIELD_CRESCENT_RADIUS_WORLD = 12.0; // mirrors the module constant

function makeWorldWithMotes(count: number) {
  const world = createWorldState(DT_MS);
  const player = createClusterState(PLAYER_ENTITY_ID, 0, 0, 1, 8);
  player.isGroundedFlag = 1;
  world.clusters.push(player);

  const profile = getElementProfile(ParticleKind.Golden);
  world.particleCount = count;
  world.moteSlotCount = count;
  for (let i = 0; i < count; i++) {
    world.isAliveFlag[i] = 1;
    world.ownerEntityId[i] = PLAYER_ENTITY_ID;
    world.kindBuffer[i] = ParticleKind.Golden;
    world.behaviorMode[i] = 0;
    world.positionXWorld[i] = 0; // start bunched at the player center
    world.positionYWorld[i] = 0;
    world.velocityXWorld[i] = 0;
    world.velocityYWorld[i] = 0;
    world.massKg[i] = profile.massKg;
    world.anchorAngleRad[i] = 0;
    world.anchorRadiusWorld[i] = profile.orbitRadiusWorld;

    world.moteSlotState[i] = MOTE_STATE_AVAILABLE;
    world.moteSlotParticleIndex[i] = i;
    world.moteSlotKind[i] = ParticleKind.Golden;
  }
  return world;
}

function stepShield(world: ReturnType<typeof makeWorldWithMotes>): void {
  for (let i = 0; i < world.particleCount; i++) {
    world.forceX[i] = 0;
    world.forceY[i] = 0;
  }
  applyShieldWeaveCrescent(world, 0, 0, 1, 0);
  integrateParticles(world);
  world.tick++;
}

test('shield motes snap to their crescent radius almost immediately', () => {
  const world = makeWorldWithMotes(3);

  // Within ~0.2s (12 ticks) every mote should be essentially at the crescent radius.
  for (let t = 0; t < 12; t++) stepShield(world);

  for (let i = 0; i < world.particleCount; i++) {
    const r = Math.hypot(world.positionXWorld[i], world.positionYWorld[i]);
    assert.ok(
      Math.abs(r - SHIELD_CRESCENT_RADIUS_WORLD) < 2.0,
      `mote ${i} radius ${r} should have formed near ${SHIELD_CRESCENT_RADIUS_WORLD}`,
    );
    assert.equal(world.behaviorMode[i], 2, 'mote should be in shield/block mode');
  }
});

test('shield formation does not wildly overshoot the crescent radius', () => {
  const world = makeWorldWithMotes(3);
  let maxRadius = 0;
  for (let t = 0; t < 40; t++) {
    stepShield(world);
    for (let i = 0; i < world.particleCount; i++) {
      maxRadius = Math.max(maxRadius, Math.hypot(world.positionXWorld[i], world.positionYWorld[i]));
    }
  }
  // A tiny animated settle is fine, but not a large overshoot past the radius.
  assert.ok(
    maxRadius < SHIELD_CRESCENT_RADIUS_WORLD * 1.4,
    `max radius ${maxRadius} overshot the crescent radius too far`,
  );
});
