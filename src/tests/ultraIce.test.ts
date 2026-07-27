/**
 * Ultra ice acceptance criteria (docs/Todo.md deferred item):
 *   1. Wall contact stops slip — touching a wall while forced-sliding on ultra
 *      ice must zero horizontal velocity and return control immediately.
 *   2. Touching ultra ice recharges the grapple the same way ground contact does.
 *   3. Zero-velocity stuck cases return control — if locked slip velocity ever
 *      decays under the stop epsilon, the forced-slip state must clear instead
 *      of leaving input permanently suppressed.
 *
 * These were previously unverified by any automated test (only skid
 * suppression on ultra ice was covered, in movementV2Skid.test.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState, type ClusterState } from '../sim/clusters/state';
import { applyClusterMovement } from '../sim/clusters/movement';

const DT_MS = 1000 / 60;

function makeWorldAndPlayer(playerX: number, playerY: number): { world: WorldState; player: ClusterState } {
  const world = createWorldState(DT_MS, 1);
  const player = createClusterState(0, playerX, playerY, 1, 100);
  world.clusters = [player];
  return { world, player };
}

/** Adds a wide flat ultra-ice floor wall whose top surface sits at floorTopY. */
function addUltraIceFloor(world: WorldState, floorTopY: number, left = -1000, right = 1000): void {
  const wi = world.wallCount++;
  world.wallXWorld[wi] = left;
  world.wallYWorld[wi] = floorTopY;
  world.wallWWorld[wi] = right - left;
  world.wallHWorld[wi] = 40;
  world.wallIsUltraIceFlag[wi] = 1;
}

/** Adds a tall solid (non-ice) wall segment, e.g. to stop a slide. */
function addSolidWall(world: WorldState, left: number, top: number, w: number, h: number): void {
  const wi = world.wallCount++;
  world.wallXWorld[wi] = left;
  world.wallYWorld[wi] = top;
  world.wallWWorld[wi] = w;
  world.wallHWorld[wi] = h;
}

function tick(world: WorldState, n = 1): void {
  for (let i = 0; i < n; i++) applyClusterMovement(world);
}

test('landing on ultra ice locks lateral velocity to the minimum forced-slip speed', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const floorTopY = player.positionYWorld + player.halfHeightWorld;
  addUltraIceFloor(world, floorTopY);
  player.isFacingLeftFlag = 0;

  // Give the player a tiny downward nudge so the Y sweep detects the landing
  // on the very first tick instead of needing to fall from further away.
  player.velocityYWorld = 1;

  tick(world, 5);

  assert.equal(player.isGroundedFlag, 1);
  assert.equal(player.isOnUltraIceFlag, 1, 'landing on an ultra-ice wall must enter the forced-slip state');
  assert.ok(Math.abs(player.velocityXWorld) > 0, 'ultra ice applies a minimum forced-slip velocity on first contact');
});

test('wall contact stops ultra-ice slip and returns control immediately', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const floorTopY = player.positionYWorld + player.halfHeightWorld;
  addUltraIceFloor(world, floorTopY);
  // A solid wall a short distance to the right of the player's landing spot.
  const wallLeft = player.positionXWorld + 20;
  addSolidWall(world, wallLeft, floorTopY - 200, 20, 400);

  player.isFacingLeftFlag = 0; // slip direction: rightward, toward the wall
  player.velocityYWorld = 1;

  // Land and start forced-sliding.
  tick(world, 3);
  assert.equal(player.isOnUltraIceFlag, 1, 'setup failed: player should be forced-sliding before reaching the wall');

  // Keep ticking until the slide reaches the wall.
  let hitWall = false;
  for (let i = 0; i < 240; i++) {
    tick(world);
    if (player.isTouchingWallRightFlag === 1) { hitWall = true; break; }
  }

  assert.ok(hitWall, 'player never reached the wall — test geometry is wrong');
  assert.equal(player.velocityXWorld, 0, 'wall contact must zero the locked slide velocity');
  assert.equal(player.isOnUltraIceFlag, 0, 'wall contact must exit the forced-slip state so control returns');
});

test('touching ultra ice recharges the grapple like any other ground contact', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const floorTopY = player.positionYWorld + player.halfHeightWorld;
  addUltraIceFloor(world, floorTopY);
  player.velocityYWorld = 1;

  world.hasGrappleChargeFlag = 0;
  world.prevHasGrappleChargeFlag = 0;

  tick(world, 3);

  assert.equal(player.isGroundedOnUltraIceFlag, 1, 'setup failed: player should be grounded on the ultra-ice wall');
  assert.equal(world.hasGrappleChargeFlag, 1, 'landing on ultra ice must recharge the grapple, same as ordinary ground');
});

test('a locked slip velocity that decays under the stop epsilon releases control instead of leaving the player stuck', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const floorTopY = player.positionYWorld + player.halfHeightWorld;
  addUltraIceFloor(world, floorTopY);

  // Simulate a player already mid-slide on ultra ice whose locked velocity has
  // been reduced (e.g. by an external effect) to just under the stop epsilon,
  // with no wall involved.
  player.isGroundedFlag = 1;
  player.isGroundedOnUltraIceFlag = 1;
  player.isOnUltraIceFlag = 1;
  player.velocityXWorld = 0.05;
  player.velocityYWorld = 0;

  tick(world);

  assert.equal(player.isOnUltraIceFlag, 0, 'near-zero locked velocity must release the forced-slip state, not strand the player');

  // Control should be fully restored: horizontal input now moves the player.
  world.playerMoveInputDxWorld = 1;
  const vxBefore = player.velocityXWorld;
  tick(world, 5);
  assert.ok(player.velocityXWorld > vxBefore, 'player must be able to accelerate normally again after the stuck-state release');
});
