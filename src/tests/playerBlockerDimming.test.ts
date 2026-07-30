import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlayerHitboxFullyCoveredByBlockers,
  PlayerBlockerDimmingController,
  PLAYER_BLOCKER_DIM_FADE_MS,
  playerBrightnessFromBlockerDimAmount,
} from '../render/clusters/playerBlockerDimming';

function playerAt(
  x: number,
  y: number,
  halfWidthWorld = 3.5,
  halfHeightWorld = 10,
) {
  return {
    renderPositionXWorld: x,
    renderPositionYWorld: y,
    halfWidthWorld,
    halfHeightWorld,
  };
}

test('player hitbox must be covered by every blocker cell it intersects', () => {
  const player = playerAt(12, 16);
  const fullCoverage = new Set(['1,0', '1,1', '1,2', '1,3']);

  assert.equal(isPlayerHitboxFullyCoveredByBlockers(player, fullCoverage), true);

  fullCoverage.delete('1,2');
  assert.equal(isPlayerHitboxFullyCoveredByBlockers(player, fullCoverage), false);
});

test('hitbox edge aligned to a tile boundary does not require the next tile', () => {
  const player = playerAt(4, 4, 4, 4);
  assert.equal(
    isPlayerHitboxFullyCoveredByBlockers(player, new Set(['0,0'])),
    true,
  );
});

test('partial overlap with a blocker does not count as full coverage', () => {
  const player = playerAt(8, 8, 3.5, 3.5);
  assert.equal(
    isPlayerHitboxFullyCoveredByBlockers(player, new Set(['0,0'])),
    false,
  );
});

test('dimming eases to 40% darker and smoothly returns to full brightness', () => {
  const controller = new PlayerBlockerDimmingController();

  assert.equal(controller.update(true, 1000), 0);
  const fadeInMid = controller.update(true, 1000 + PLAYER_BLOCKER_DIM_FADE_MS / 2);
  assert.ok(fadeInMid > 0 && fadeInMid < 1);
  assert.equal(controller.update(true, 1000 + PLAYER_BLOCKER_DIM_FADE_MS), 1);
  assert.equal(playerBrightnessFromBlockerDimAmount(1), 0.6);

  assert.equal(controller.update(false, 1300), 1);
  const fadeOutMid = controller.update(false, 1300 + PLAYER_BLOCKER_DIM_FADE_MS / 2);
  assert.ok(fadeOutMid > 0 && fadeOutMid < 1);
  assert.equal(controller.update(false, 1300 + PLAYER_BLOCKER_DIM_FADE_MS), 0);
  assert.equal(playerBrightnessFromBlockerDimAmount(0), 1);
});
