import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APEX_FLOAT_GRAVITY_MULTIPLIER, APEX_FLOAT_VELOCITY_THRESHOLD,
  getSkidJumpBonusBlocks, getSkidJumpLaunchSpeedWorld,
  NORMAL_GRAVITY_WORLD_PER_SEC2, PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS,
} from '../sim/clusters/movementConstants';

const DT_SEC = 1 / 60;

function measureHeldJumpApex(launchSpeedWorld: number): number {
  let y = 0, minY = 0, velocityY = -launchSpeedWorld;
  let sustainTicks = VAR_JUMP_TIME_TICKS;
  for (let tick = 0; tick < 600; tick++) {
    const gravity = Math.abs(velocityY) < APEX_FLOAT_VELOCITY_THRESHOLD
      ? NORMAL_GRAVITY_WORLD_PER_SEC2 * APEX_FLOAT_GRAVITY_MULTIPLIER
      : NORMAL_GRAVITY_WORLD_PER_SEC2;
    velocityY += gravity * DT_SEC;
    if (sustainTicks > 0) {
      velocityY = Math.min(velocityY, -launchSpeedWorld);
      sustainTicks--;
    }
    y += velocityY * DT_SEC;
    minY = Math.min(minY, y);
    if (velocityY >= 0 && sustainTicks === 0) break;
  }
  return -minY;
}

test('dynamic skid bonus is continuous from the 120 wu/s walking target', () => {
  assert.deepEqual([120, 135, 150, 180, 210, 300].map(getSkidJumpBonusBlocks),
    [1, 1.5, 2, 3, 4, 7]);
});

test('fixed-step held-jump apex gains track requested skid bonus heights', () => {
  const baseApex = measureHeldJumpApex(PLAYER_JUMP_SPEED_WORLD);
  const cases = [[120, 1], [135, 1.5], [150, 2], [180, 3], [210, 4], [300, 7]] as const;
  for (const [entrySpeed, bonusBlocks] of cases) {
    const apex = measureHeldJumpApex(getSkidJumpLaunchSpeedWorld(entrySpeed));
    assert.ok(Math.abs((apex - baseApex) - bonusBlocks * 8) < 1,
      `${entrySpeed} wu/s produced ${(apex - baseApex).toFixed(3)} wu`);
  }
});
