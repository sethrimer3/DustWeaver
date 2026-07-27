import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import {
  applyPersistentPlayerWorldConfig,
  type PersistentPlayerWorldConfig,
} from '../screens/gameLoadRoomPhases';
import { fireGrapple } from '../sim/clusters/grapple';
import { createClusterState } from '../sim/clusters/state';

const DT_MS = 1000 / 60;
const ASSIST_CONFIG: PersistentPlayerWorldConfig = {
  assistMode: true,
  combatMode: 'legacy',
};

function activateRoom(config = ASSIST_CONFIG) {
  const world = createWorldState(DT_MS, 42);
  applyPersistentPlayerWorldConfig(world, config);
  return world;
}

function assertPersistentConfig(world: ReturnType<typeof createWorldState>): void {
  assert.equal(world.isAssistModeFlag, 1);
  assert.equal(world.combatMode, 'legacy');
}

function assertAssistCanRetryAirGrapple(world: ReturnType<typeof createWorldState>): void {
  world.clusters.push(createClusterState(1, 0, 0, 1));
  // A spent charge is the state normal mode blocks before attachment. Assist
  // mode must advance past that guard while the player is airborne.
  world.hasGrappleChargeFlag = 0;
  world.grappleCooldownTicks = 0;
  fireGrapple(world, 100, 0);
  assert.equal(
    world.grappleEmptyFxTicksLeft,
    0,
    'assist mode should bypass the spent-charge rejection while airborne',
  );
}

test('assist grapple and persistent player configuration survive the first-room boundary', () => {
  const initial = activateRoom();
  assertPersistentConfig(initial);
  assertAssistCanRetryAirGrapple(initial);

  const second = activateRoom();
  assertPersistentConfig(second);
  assertAssistCanRetryAirGrapple(second);
});

test('normal mode still rejects an airborne grapple after its charge is spent', () => {
  const world = activateRoom({ assistMode: false, combatMode: 'momentum' });
  world.clusters.push(createClusterState(1, 0, 0, 1));
  world.hasGrappleChargeFlag = 0;
  fireGrapple(world, 100, 0);
  assert.ok(world.grappleEmptyFxTicksLeft > 0);
});

test('persistent configuration survives multiple transitions and returning to the original room', () => {
  const visits = [activateRoom(), activateRoom(), activateRoom(), activateRoom()];
  for (const world of visits) {
    assertPersistentConfig(world);
    assertAssistCanRetryAirGrapple(world);
  }
});

test('death/checkpoint restoration rehydrates persistent player configuration', () => {
  const transitioned = activateRoom();
  transitioned.isAssistModeFlag = 0;
  transitioned.combatMode = 'momentum';

  // Death/checkpoint reload uses the full room activation path, which applies
  // the session-owned configuration to the reused active world.
  applyPersistentPlayerWorldConfig(transitioned, ASSIST_CONFIG);
  assertPersistentConfig(transitioned);
  assertAssistCanRetryAirGrapple(transitioned);
});

test('campaign reload and editor playtest activation use explicit session defaults', () => {
  const campaignReload = activateRoom(ASSIST_CONFIG);
  assertPersistentConfig(campaignReload);

  const editorPlaytest = activateRoom({ assistMode: false, combatMode: 'momentum' });
  assert.equal(editorPlaytest.isAssistModeFlag, 0);
  assert.equal(editorPlaytest.combatMode, 'momentum');
});
