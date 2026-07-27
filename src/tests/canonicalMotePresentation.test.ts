import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { MOTE_LIFE_SLOT_WIDTH_PX, MOTE_LIFE_SLOT_HEIGHT_PX } from '../render/hud/moteLifeSlots';
import { capturePlayerTransferState, restoreTransferredPlayerParticles } from '../screens/playerTransfer';

test('canonical mote presentation: square drawImage destination dimensions in HUD', () => {
  assert.equal(MOTE_LIFE_SLOT_WIDTH_PX, 10, 'mote slot sprite width must be 10px');
  assert.equal(MOTE_LIFE_SLOT_HEIGHT_PX, 10, 'mote slot sprite height must be 10px for square aspect ratio');
  assert.equal(MOTE_LIFE_SLOT_WIDTH_PX, MOTE_LIFE_SLOT_HEIGHT_PX, 'aspect ratio must be exactly square (1:1)');
});

test('canonical mote presentation: resident transfer filters out ordinary mode-0 orbiters while preserving special particles', () => {
  const world = createWorldState(1000 / 60, 1);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];

  // Spawn 2 particles owned by player: one ordinary orbiter (mode 0) and one special (mode 10, e.g., grapple/projectile)
  world.particleCount = 2;
  world.ownerEntityId[0] = player.entityId;
  world.behaviorMode[0] = 0; // ordinary orbiter (must be filtered out)
  world.isAliveFlag[0] = 1;

  world.ownerEntityId[1] = player.entityId;
  world.behaviorMode[1] = 10; // special behavior mode (must be preserved)
  world.isAliveFlag[1] = 1;

  const snapshot = capturePlayerTransferState(world);
  assert.ok(snapshot !== null, 'transfer snapshot should be created');
  assert.equal(snapshot!.ownedParticles.length, 1, 'only special non-zero behaviorMode particles should be transferred');
  assert.equal(snapshot!.ownedParticles[0].behaviorMode, 10, 'preserved particle retains its special behaviorMode');

  // Verify restoring into a new room state preserves the exact behaviorMode
  const targetWorld = createWorldState(1000 / 60, 2);
  const targetPlayer = createClusterState(0, 200, 200, 1, 20);
  targetWorld.clusters = [targetPlayer];
  restoreTransferredPlayerParticles(targetWorld, snapshot!, targetWorld.rng);

  assert.equal(targetWorld.particleCount, 1, 'only preserved particle is restored');
  assert.equal(targetWorld.behaviorMode[0], 10, 'restored particle keeps behaviorMode 10 instead of resetting to mode 0');
});
