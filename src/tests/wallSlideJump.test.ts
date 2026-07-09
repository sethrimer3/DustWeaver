/**
 * Coverage for the unified wall-slide / wall-jump contact model
 * (src/sim/clusters/playerWallJump.ts `getWallJumpCandidate`, consumed by
 * both wall-slide eligibility in movement.ts and wall-jump eligibility in
 * playerVerticalMovement.ts).
 *
 * Focus areas (see problem statement):
 *   - Slide and jump agree on the same valid contact, including
 *     top-corner-only contact on a tall wall.
 *   - Tiny ledges / stair steps remain blocked for both.
 *   - The ground-connected exclusion zone suppresses both.
 *   - A same-frame jump press during newly-detected wall contact (before
 *     `isTouchingWallLeftFlag`/`isTouchingWallRightFlag` are rebuilt for the
 *     tick) is not silently dropped.
 *   - Wall-jump lockout still blocks immediate re-grab.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// getAdvancedWallJumpsEnabled() reads localStorage; provide a minimal
// in-memory shim since this suite runs under plain node:test (no DOM).
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState, type ClusterState } from '../sim/clusters/state';
import { getWallJumpCandidate } from '../sim/clusters/playerWallJump';
import { PLAYER_HALF_WIDTH_WORLD, PLAYER_HALF_HEIGHT_WORLD } from '../levels/roomDef';

function addWall(world: WorldState, x: number, y: number, w: number, h: number): void {
  const i = world.wallCount;
  world.wallXWorld[i] = x;
  world.wallYWorld[i] = y;
  world.wallWWorld[i] = w;
  world.wallHWorld[i] = h;
  world.wallIsPlatformFlag[i] = 0;
  world.wallRampOrientationIndex[i] = 255;
  world.wallCount += 1;
}

function makeWorldAndPlayer(playerX: number, playerY: number): { world: WorldState; player: ClusterState } {
  const world = createWorldState(16.6667);
  world.worldHeightWorld = 10000; // keep world-floor shortcut out of the way by default
  const player = createClusterState(0, playerX, playerY, 1, 100);
  player.isGroundedFlag = 0;
  player.velocityYWorld = 50; // falling
  world.clusters = [player];
  return { world, player };
}

test('slide and jump agree on a full-height valid wall contact (right side, touching)', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const playerLeft   = player.positionXWorld - player.halfWidthWorld;
  const playerRight  = player.positionXWorld + player.halfWidthWorld;
  const playerTop    = player.positionYWorld - player.halfHeightWorld;

  // Tall wall directly to the player's right, touching (gap=0), full vertical overlap.
  addWall(world, playerRight, playerTop - 50, 8, 200);
  player.isTouchingWallRightFlag = 1;

  const candidate = getWallJumpCandidate(player, world);
  assert.equal(candidate.canSlideFromRight, true, `slide should be eligible: ${candidate.dbgRight}`);
  assert.equal(candidate.canJumpFromRight, true, `jump should be eligible: ${candidate.dbgRight}`);
});

test('top-corner-only contact on a tall wall: slide-eligible implies jump-eligible', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const playerRight  = player.positionXWorld + player.halfWidthWorld;
  const playerTop    = player.positionYWorld - player.halfHeightWorld;

  // Wall's bottom edge only dips 2 world units into the player's top region;
  // the wall itself extends far upward — a genuine tall valid wall, just a
  // thin overlap slice near the player's top (not a ledge near the feet).
  addWall(world, playerRight, playerTop - 200, 8, 202);
  player.isTouchingWallRightFlag = 1;

  const candidate = getWallJumpCandidate(player, world);
  assert.equal(candidate.canSlideFromRight, true, `expected slide-eligible: ${candidate.dbgRight}`);
  assert.equal(
    candidate.canJumpFromRight,
    candidate.canSlideFromRight,
    `jump must agree with slide on the same contact (jump reason: ${candidate.dbgRight})`,
  );
});

test('tiny ledge / stair-step contact near the feet is blocked for both slide and jump', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const playerRight  = player.positionXWorld + player.halfWidthWorld;
  const playerBottom = player.positionYWorld + player.halfHeightWorld;

  // Wall top sits 2 world units above the player's feet (within the 4-unit
  // ledge-suppression band) — classic stair-step / low-ledge clip.
  addWall(world, playerRight, playerBottom - 2, 8, 40);
  player.isTouchingWallRightFlag = 1;

  const candidate = getWallJumpCandidate(player, world);
  assert.equal(candidate.canSlideFromRight, false, 'ledge contact must not allow slide');
  assert.equal(candidate.canJumpFromRight, false, 'ledge contact must not allow jump');
});

test('ground-connected exclusion zone suppresses both slide and jump', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const playerRight  = player.positionXWorld + player.halfWidthWorld;
  const playerTop    = player.positionYWorld - player.halfHeightWorld;
  const playerBottom = player.positionYWorld + player.halfHeightWorld;

  // Tall wall whose base reaches the world floor (world-floor shortcut path
  // in computeGroundConnectedExclusion) — player is standing low against it,
  // inside the bottom exclusion band.
  world.worldHeightWorld = playerBottom + 1;
  addWall(world, playerRight, playerTop - 100, 8, playerBottom + 1 - (playerTop - 100));
  player.isTouchingWallRightFlag = 1;

  const candidate = getWallJumpCandidate(player, world);
  assert.equal(candidate.canSlideFromRight, false, `expected slide suppressed: ${candidate.dbgRight}`);
  assert.equal(candidate.canJumpFromRight, false, `expected jump suppressed: ${candidate.dbgRight}`);
});

test('same-frame jump during newly-detected wall contact is not dropped (timing bug regression)', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const playerRight  = player.positionXWorld + player.halfWidthWorld;
  const playerTop    = player.positionYWorld - player.halfHeightWorld;

  addWall(world, playerRight, playerTop - 50, 8, 200);

  // Simulate the exact moment before movement.ts's collision pass has
  // rebuilt this tick's touch flags: isTouchingWallRightFlag is still 0
  // even though the player's AABB geometrically touches the wall (gap=0).
  player.isTouchingWallRightFlag = 0;
  player.wallJumpGraceRightTicks = 0;

  const candidate = getWallJumpCandidate(player, world);
  assert.equal(
    candidate.canJumpFromRight,
    true,
    `expected same-tick geometric touch to grant a wall jump: ${candidate.dbgRight}`,
  );
});

test('wall-jump lockout blocks both jump and slide eligibility', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  const playerRight  = player.positionXWorld + player.halfWidthWorld;
  const playerTop    = player.positionYWorld - player.halfHeightWorld;

  addWall(world, playerRight, playerTop - 50, 8, 200);
  player.isTouchingWallRightFlag = 1;
  player.wallJumpLockoutTicks = 5;

  const candidate = getWallJumpCandidate(player, world);
  assert.equal(candidate.canJumpFromRight, false);
  assert.equal(candidate.canSlideFromRight, false);
  assert.equal(candidate.dbgRight, 'lockout');
});

test('sanity: player half-extent constants used by these tests are as expected', () => {
  assert.equal(PLAYER_HALF_WIDTH_WORLD > 0, true);
  assert.equal(PLAYER_HALF_HEIGHT_WORLD > 0, true);
});
