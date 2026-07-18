/**
 * Skid-jump height solver — the single authoritative place that converts a
 * latched skid-entry speed into a launch velocity for a skid jump.
 *
 * Movement V2 replaces the old fixed SKID_JUMP_MULTIPLIER (a flat launch-speed
 * multiplier) with a target expressed in actual added apex height:
 *
 *   bonusBlocks = SKID_JUMP_BASE_BONUS_BLOCKS
 *     + max(0, abs(skidEntryVelocityXWorld) - walkingSpeed)
 *       / SKID_JUMP_HEIGHT_SPEED_PER_BLOCK_WORLD
 *
 * Because jump height is a nonlinear (quadratic) function of launch speed, a
 * flat multiplier over- or under-shoots depending on the base jump speed and
 * gravity in play (including live debug overrides). Instead, this module
 * derives the exact launch speed needed to reach a target apex height under
 * the idealized held-jump model used by the rest of the jump system:
 *
 *   height(v) = v * sustainTime + v^2 / (2 * gravity)
 *
 * Inverting for v (positive root):
 *
 *   v = -gravity * sustainTime
 *     + sqrt(gravity^2 * sustainTime^2 + 2 * gravity * targetHeight)
 *
 * `targetHeight` is the normal full-held-jump apex height (computed from the
 * same idealized model, using the active base jump speed) plus the requested
 * bonus height in world units. This keeps the bonus meaningful in real apex
 * height regardless of debug jump-speed/gravity overrides.
 *
 * Call `computeSkidJumpSpeedWorld` from every ground-jump path that can
 * legitimately consume a skid (direct grounded jump, coyote jump, and
 * landing-buffered ground jump) rather than duplicating the formula.
 */

import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  SKID_JUMP_BASE_BONUS_BLOCKS,
  SKID_JUMP_HEIGHT_SPEED_PER_BLOCK_WORLD,
  VAR_JUMP_TIME_SEC,
} from './movementConstants';

/**
 * Continuous bonus apex height, in small blocks, for a given skid-entry
 * speed. Zero when below walking speed (no qualifying skid); exactly
 * SKID_JUMP_BASE_BONUS_BLOCKS at walking speed; grows linearly beyond that.
 */
export function computeSkidJumpBonusBlocks(
  skidEntrySpeedWorld: number,
  walkingSpeedWorld: number,
): number {
  const excessSpeed = Math.max(0, Math.abs(skidEntrySpeedWorld) - walkingSpeedWorld);
  return SKID_JUMP_BASE_BONUS_BLOCKS + excessSpeed / SKID_JUMP_HEIGHT_SPEED_PER_BLOCK_WORLD;
}

/**
 * Idealized full-held-jump apex height (world units) for a given launch
 * speed, gravity, and variable-jump sustain duration.
 */
function computeIdealHeldJumpHeightWorld(
  launchSpeedWorld: number,
  gravityWorldPerSec2: number,
  sustainTimeSec: number,
): number {
  return launchSpeedWorld * sustainTimeSec
    + (launchSpeedWorld * launchSpeedWorld) / (2 * gravityWorldPerSec2);
}

/**
 * Inverts the idealized held-jump height model to find the launch speed that
 * reaches `targetHeightWorld` under the given gravity and sustain duration.
 */
function solveLaunchSpeedForHeightWorld(
  targetHeightWorld: number,
  gravityWorldPerSec2: number,
  sustainTimeSec: number,
): number {
  const gt = gravityWorldPerSec2 * sustainTimeSec;
  return -gt + Math.sqrt(gt * gt + 2 * gravityWorldPerSec2 * targetHeightWorld);
}

/**
 * The one authoritative skid-jump launch-speed helper. Given the speed
 * latched at skid entry, the walking-speed threshold, the active base
 * (normal) jump speed, and the active gravity, returns the upward launch
 * speed (positive magnitude) that reaches the normal full-jump apex height
 * plus the speed-scaled skid bonus.
 *
 * Uses the currently active base jump speed and gravity (which may be live
 * debug overrides) so the bonus always represents real added apex height
 * rather than drifting out of sync with tuning changes.
 */
export function computeSkidJumpSpeedWorld(
  skidEntrySpeedWorld: number,
  walkingSpeedWorld: number,
  baseJumpSpeedWorld: number,
  gravityWorldPerSec2: number,
): number {
  const bonusBlocks = computeSkidJumpBonusBlocks(skidEntrySpeedWorld, walkingSpeedWorld);
  const bonusHeightWorld = bonusBlocks * BLOCK_SIZE_SMALL;
  const normalHeightWorld = computeIdealHeldJumpHeightWorld(
    baseJumpSpeedWorld, gravityWorldPerSec2, VAR_JUMP_TIME_SEC,
  );
  const targetHeightWorld = normalHeightWorld + bonusHeightWorld;
  return solveLaunchSpeedForHeightWorld(targetHeightWorld, gravityWorldPerSec2, VAR_JUMP_TIME_SEC);
}
