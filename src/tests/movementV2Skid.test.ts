/**
 * Movement V2 — sprint removal + speed-scaled skid technique.
 *
 * Covers:
 *  1. Shift no longer changes walking speed / accel / friction / crouch / any state.
 *  2. Grounded reversal at 120 (walking speed) enters a skid without Shift.
 *  3. Reversal below the walking-speed threshold does not grant a skid.
 *  4. Reversing at exactly 120 immediately reduces the old-direction velocity.
 *  5. Reversing from over-cap external momentum decelerates and crosses zero.
 *  6. Ice / ultra ice suppress the normal skid.
 *  7. Same-tick reversal + jump is handled correctly (no one-tick lag).
 *  8-10. Skid-jump apex-height scaling at 120/135/150/180/210 (+1/+1.5/+2/+3/+4 blocks).
 *  11. Direct, coyote, and buffered ground-jump paths share one authoritative calc.
 *  12. Wall / water / grapple / zip / ordinary jumps are unaffected by skid state.
 *  13-14. Particle visual-intensity curve is monotonic, near-linear at low speed,
 *         diminishing at extreme speed.
 *  15. Renderer stays deterministic and bounded under sustained high-speed skidding.
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
import { tickPlayerMovement } from '../sim/clusters/playerMovement';
import { applyPlayerGravityAndJump } from '../sim/clusters/playerVerticalMovement';
import { applyPlayerHorizontalMovement } from '../sim/clusters/playerHorizontalMovement';
import { updatePlayerSkidState } from '../sim/clusters/playerSkid';
import { computeSkidJumpBonusBlocks, computeSkidJumpSpeedWorld } from '../sim/clusters/skidJumpHeight';
import { applyClusterMovement } from '../sim/clusters/movement';
import { attemptWallJump } from '../sim/clusters/playerWallJump';
import {
  GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC,
  PLAYER_JUMP_SPEED_WORLD,
  NORMAL_GRAVITY_WORLD_PER_SEC2,
  VAR_JUMP_TIME_TICKS,
  WALL_JUMP_Y_SPEED_WORLD,
  WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD,
  GRAPPLE_SUPER_JUMP_MULTIPLIER,
} from '../sim/clusters/movementConstants';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { computeSkidVisualSpeedWorld, SkidDebrisRenderer, MAX_DEBRIS } from '../render/skidDebrisRenderer';

const DT_MS = 16.6667;
const DT_SEC = DT_MS / 1000;

function makeWorldAndPlayer(): { world: WorldState; player: ClusterState } {
  const world = createWorldState(DT_MS);
  const player = createClusterState(0, 0, 0, 1, 100);
  world.clusters = [player];
  return { world, player };
}

// ── 1. Shift is inert ───────────────────────────────────────────────────────

test('grounded acceleration caps at GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC (120), never a legacy sprint multiplier', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  world.playerMoveInputDxWorld = 1;
  for (let i = 0; i < 300; i++) {
    tickPlayerMovement(player, world, DT_SEC);
  }
  assert.ok(
    Math.abs(player.velocityXWorld - GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01,
    `expected velocity to settle at walking speed ${GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC}, got ${player.velocityXWorld}`,
  );
  assert.ok(player.velocityXWorld < 150, 'velocity must not reach anything resembling a 1.5x sprint multiplier (157.5)');
});

test('crouch (Down key) blocks horizontal acceleration regardless of any other key held', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  world.playerMoveInputDxWorld = 1;
  world.playerCrouchHeldFlag = 1;
  for (let i = 0; i < 60; i++) {
    tickPlayerMovement(player, world, DT_SEC);
  }
  assert.equal(player.velocityXWorld, 0, 'crouching must fully block horizontal acceleration — no Shift-derived slide exception exists anymore');
  assert.equal(player.isCrouchingFlag, 1);
});

test('WorldState and ClusterState no longer expose any sprint field', () => {
  const { world, player } = makeWorldAndPlayer();
  assert.equal((world as unknown as Record<string, unknown>).playerSprintHeldFlag, undefined);
  assert.equal((player as unknown as Record<string, unknown>).isSprintingFlag, undefined);
  assert.equal((player as unknown as Record<string, unknown>).isSlidingFlag, undefined);
});

// ── 2/3. Skid entry threshold ────────────────────────────────────────────────

test('grounded reversal at exactly 120 units/s enters a skid without any sprint-like input', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.velocityXWorld = 120;
  world.playerMoveInputDxWorld = -1;
  updatePlayerSkidState(player, world);
  assert.equal(player.isSkiddingFlag, 1);
  assert.equal(player.skidEntryVelocityXWorld, 120);
});

test('reversal below the walking-speed threshold does not enter a skid', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.velocityXWorld = 100; // below 120
  world.playerMoveInputDxWorld = -1;
  updatePlayerSkidState(player, world);
  assert.equal(player.isSkiddingFlag, 0);
});

// ── 4/5. Reversal deceleration fix ──────────────────────────────────────────

test('reversing at exactly 120 immediately reduces the old-direction velocity (does not get stuck at cap)', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.groundedTicks = 10000; // would have been "stuck" under the old grace-gated bug
  player.velocityXWorld = 120;
  world.playerMoveInputDxWorld = -1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.ok(player.velocityXWorld < 120, `expected velocity to immediately drop below 120, got ${player.velocityXWorld}`);
});

test('reversing from over-cap external momentum continues to decelerate and eventually crosses zero', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.velocityXWorld = -300; // over-cap external momentum (e.g. grapple launch)
  world.playerMoveInputDxWorld = 1;
  let prevAbs = 300;
  let crossedZero = false;
  for (let i = 0; i < 60; i++) {
    applyPlayerHorizontalMovement(player, world, DT_SEC);
    const abs = Math.abs(player.velocityXWorld);
    if (player.velocityXWorld > 0) { crossedZero = true; break; }
    assert.ok(abs <= prevAbs + 1e-6, `magnitude must not increase tick-over-tick (was ${prevAbs}, now ${abs})`);
    prevAbs = abs;
  }
  assert.ok(crossedZero, 'velocity should cross zero into the new (positive) direction within 1 second');
});

test('same-direction held input never destroys over-cap momentum merely because input is held (grace window intact)', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.groundedTicks = 0; // freshly grounded — grace window not yet elapsed
  player.velocityXWorld = 300;
  world.playerMoveInputDxWorld = 1; // SAME direction as velocity
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.equal(player.velocityXWorld, 300, 'over-cap momentum must be preserved within the grounded-decel grace window');
});

// ── 6. Ice suppresses the normal skid ───────────────────────────────────────

test('normal ice suppresses skid entry', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.isGroundedOnIceFlag = 1;
  player.velocityXWorld = 150;
  world.playerMoveInputDxWorld = -1;
  updatePlayerSkidState(player, world);
  assert.equal(player.isSkiddingFlag, 0);
});

test('ultra ice suppresses skid entry', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.isOnUltraIceFlag = 1;
  player.velocityXWorld = 150;
  world.playerMoveInputDxWorld = -1;
  updatePlayerSkidState(player, world);
  assert.equal(player.isSkiddingFlag, 0);
});

test('water suppresses skid entry', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  world.isPlayerInWaterFlag = 1;
  player.velocityXWorld = 150;
  world.playerMoveInputDxWorld = -1;
  updatePlayerSkidState(player, world);
  assert.equal(player.isSkiddingFlag, 0);
});

test('grapple-active suppresses skid entry', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  world.isGrappleActiveFlag = 1;
  player.velocityXWorld = 150;
  world.playerMoveInputDxWorld = -1;
  updatePlayerSkidState(player, world);
  assert.equal(player.isSkiddingFlag, 0);
});

// ── 7. Same-tick reversal + jump ────────────────────────────────────────────

test('same-tick reversal + jump press consumes a skid jump (not lost to tick ordering)', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.velocityXWorld = 200; // over walking speed, moving right
  world.playerMoveInputDxWorld = -1; // reversal this same tick
  world.playerJumpTriggeredFlag = 1;
  world.playerJumpHeldFlag = 1;
  tickPlayerMovement(player, world, DT_SEC);

  const normalSpeed = PLAYER_JUMP_SPEED_WORLD;
  assert.ok(-player.velocityYWorld > normalSpeed, `expected a boosted skid jump (> ${normalSpeed}), got ${-player.velocityYWorld}`);
  assert.equal(player.isSkiddingFlag, 0, 'skid state must be consumed/cleared once the jump fires');
});

// ── 8-10. Apex height scaling ────────────────────────────────────────────────

/** Simulates a full-held jump using the real fixed-step vertical-movement code and returns apex height (world units). */
function simulateHeldJumpApexHeight(launchSpeedWorld: number): number {
  const world = createWorldState(DT_MS);
  const player = createClusterState(0, 0, 0, 1, 100);
  world.clusters = [player];
  player.isGroundedFlag = 0;
  player.velocityYWorld = -launchSpeedWorld;
  player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
  player.varJumpSpeedWorld = -launchSpeedWorld;
  world.playerJumpHeldFlag = 1;
  world.playerJumpTriggeredFlag = 0;

  let y = 0;
  let minY = 0;
  for (let i = 0; i < 600; i++) {
    // Mirror tickPlayerMovement's timer tick-down, which normally runs
    // before applyPlayerGravityAndJump each tick — calling the vertical
    // step directly (to isolate jump physics from horizontal/skid logic)
    // means this test must decrement it manually or the variable-jump
    // sustain clamp holds velocity at launch speed forever.
    if (player.varJumpTimerTicks > 0) player.varJumpTimerTicks -= 1;
    applyPlayerGravityAndJump(player, world, DT_SEC);
    y += player.velocityYWorld * DT_SEC;
    if (y < minY) minY = y;
    if (player.velocityYWorld > 0 && y >= 0) break;
  }
  return -minY;
}

const normalApexHeight = simulateHeldJumpApexHeight(PLAYER_JUMP_SPEED_WORLD);
// Fixed-step apex-height tolerance: generous enough to absorb integration
// error but tight enough to catch a meaningfully wrong formula.
const APEX_TOLERANCE_BLOCKS = 0.35;

function measuredBonusBlocks(entrySpeed: number): number {
  const launchSpeed = computeSkidJumpSpeedWorld(
    entrySpeed, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC, PLAYER_JUMP_SPEED_WORLD, NORMAL_GRAVITY_WORLD_PER_SEC2,
  );
  const apex = simulateHeldJumpApexHeight(launchSpeed);
  return (apex - normalApexHeight) / BLOCK_SIZE_SMALL;
}

test('a full-held skid jump entered at 120 reaches approximately +1 BLOCK_SIZE_SMALL over a normal full-held jump', () => {
  const bonus = measuredBonusBlocks(120);
  assert.ok(Math.abs(bonus - 1.0) < APEX_TOLERANCE_BLOCKS, `expected ~+1 block, measured +${bonus.toFixed(3)} blocks`);
});

test('entry speeds 150/180/210 produce approximately +2/+3/+4 blocks (continuous, not stepped)', () => {
  const b150 = measuredBonusBlocks(150);
  const b180 = measuredBonusBlocks(180);
  const b210 = measuredBonusBlocks(210);
  assert.ok(Math.abs(b150 - 2.0) < APEX_TOLERANCE_BLOCKS, `150 -> expected ~+2, got +${b150.toFixed(3)}`);
  assert.ok(Math.abs(b180 - 3.0) < APEX_TOLERANCE_BLOCKS, `180 -> expected ~+3, got +${b180.toFixed(3)}`);
  assert.ok(Math.abs(b210 - 4.0) < APEX_TOLERANCE_BLOCKS, `210 -> expected ~+4, got +${b210.toFixed(3)}`);
});

test('midpoint entry speed 135 produces approximately +1.5 blocks, proving continuous interpolation', () => {
  const bonus = measuredBonusBlocks(135);
  assert.ok(Math.abs(bonus - 1.5) < APEX_TOLERANCE_BLOCKS, `expected ~+1.5 blocks, measured +${bonus.toFixed(3)}`);
  // Pure-function cross-check (no simulation, exact formula):
  const pureBonus = computeSkidJumpBonusBlocks(135, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC);
  assert.ok(Math.abs(pureBonus - 1.5) < 1e-9, `formula must give exactly 1.5, got ${pureBonus}`);
});

test('300 units/s entry produces approximately +7 blocks', () => {
  const bonus = measuredBonusBlocks(300);
  assert.ok(Math.abs(bonus - 7.0) < APEX_TOLERANCE_BLOCKS, `expected ~+7 blocks, measured +${bonus.toFixed(3)}`);
});

// ── 11. One authoritative helper across jump paths ──────────────────────────

test('direct grounded skid jump uses computeSkidJumpSpeedWorld exactly', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.isSkiddingFlag = 1;
  player.skidEntryVelocityXWorld = 210;
  world.playerJumpTriggeredFlag = 1;
  world.playerJumpHeldFlag = 1;
  applyPlayerGravityAndJump(player, world, DT_SEC);

  const expected = -computeSkidJumpSpeedWorld(210, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC, PLAYER_JUMP_SPEED_WORLD, NORMAL_GRAVITY_WORLD_PER_SEC2);
  assert.ok(Math.abs(player.velocityYWorld - expected) < 1e-9, `expected exact match to authoritative helper, got ${player.velocityYWorld} vs ${expected}`);
});

test('coyote skid jump (airborne within coyote window) uses the same authoritative calculation', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 0;
  player.coyoteTimeTicks = 3;
  player.isSkiddingFlag = 1;
  player.skidEntryVelocityXWorld = 180;
  world.playerJumpTriggeredFlag = 1;
  world.playerJumpHeldFlag = 1;
  applyPlayerGravityAndJump(player, world, DT_SEC);

  const expected = -computeSkidJumpSpeedWorld(180, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC, PLAYER_JUMP_SPEED_WORLD, NORMAL_GRAVITY_WORLD_PER_SEC2);
  assert.ok(Math.abs(player.velocityYWorld - expected) < 1e-9, `coyote jump must match the same authoritative helper, got ${player.velocityYWorld} vs ${expected}`);
});

test('landing-buffered ground jump uses the same authoritative calculation', () => {
  const { world, player } = makeWorldAndPlayer();
  // Set up a world-floor landing one tick away.
  world.worldHeightWorld = player.positionYWorld + player.halfHeightWorld + 1;
  player.isGroundedFlag = 0;
  player.velocityYWorld = 50; // falling toward the floor
  player.jumpBufferTicks = 5;
  // Skid still legitimately active into this tick: within the coyote
  // window, velocity still in the original direction, input still opposing
  // it — updatePlayerSkidState (which runs every tick, including this one,
  // before the landing/buffer logic below) keeps it latched rather than
  // clearing it.
  player.coyoteTimeTicks = 3;
  player.isSkiddingFlag = 1;
  player.skidEntryVelocityXWorld = 210;
  player.velocityXWorld = 210;
  world.playerMoveInputDxWorld = -1;
  applyClusterMovement(world);

  const expected = -computeSkidJumpSpeedWorld(210, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC, PLAYER_JUMP_SPEED_WORLD, NORMAL_GRAVITY_WORLD_PER_SEC2);
  assert.ok(Math.abs(player.velocityYWorld - expected) < 1e-6, `buffered ground jump must match the same authoritative helper, got ${player.velocityYWorld} vs ${expected}`);
  assert.equal(player.isSkiddingFlag, 0, 'skid state must be consumed on the buffered jump');
});

// ── 12. Non-skid jump paths are unaffected ──────────────────────────────────

test('ordinary (non-skid) grounded jump is unaffected — exactly PLAYER_JUMP_SPEED_WORLD', () => {
  const { world, player } = makeWorldAndPlayer();
  player.isGroundedFlag = 1;
  player.isSkiddingFlag = 0;
  world.playerJumpTriggeredFlag = 1;
  world.playerJumpHeldFlag = 1;
  applyPlayerGravityAndJump(player, world, DT_SEC);
  assert.equal(player.velocityYWorld, -PLAYER_JUMP_SPEED_WORLD);
});

test('wall jump vertical speed is unaffected by an active skid state', () => {
  const { world, player } = makeWorldAndPlayer();
  const playerRight = player.positionXWorld + player.halfWidthWorld;
  const playerTop = player.positionYWorld - player.halfHeightWorld;
  const wallIndex = world.wallCount;
  world.wallXWorld[wallIndex] = playerRight;
  world.wallYWorld[wallIndex] = playerTop - 50;
  world.wallWWorld[wallIndex] = 8;
  world.wallHWorld[wallIndex] = 200;
  world.wallIsPlatformFlag[wallIndex] = 0;
  world.wallRampOrientationIndex[wallIndex] = 255;
  world.wallCount += 1;
  player.isTouchingWallRightFlag = 1;
  player.isGroundedFlag = 0;
  player.velocityYWorld = 50;
  // Actively "skidding" with a huge entry speed — must have zero influence on wall jumps.
  player.isSkiddingFlag = 1;
  player.skidEntryVelocityXWorld = 400;

  const fired = attemptWallJump(player, world);
  assert.equal(fired, true);
  assert.equal(player.velocityYWorld, -(WALL_JUMP_Y_SPEED_WORLD + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD));
});

test('water jump is unaffected by skid state', () => {
  function waterJumpSpeed(isSkidding: 0 | 1): number {
    const { world, player } = makeWorldAndPlayer();
    world.isPlayerInWaterFlag = 1;
    player.isSkiddingFlag = isSkidding;
    player.skidEntryVelocityXWorld = isSkidding === 1 ? 400 : 0;
    world.playerJumpTriggeredFlag = 1;
    applyPlayerGravityAndJump(player, world, DT_SEC);
    return player.velocityYWorld;
  }
  assert.equal(waterJumpSpeed(0), waterJumpSpeed(1), 'water jump must not read skid state at all');
});

test('grapple super-jump multiplier constant is unchanged by this refactor', () => {
  assert.equal(GRAPPLE_SUPER_JUMP_MULTIPLIER, 1.331);
});

// ── 13/14. Particle visual-intensity curve ──────────────────────────────────

test('skid visual speed curve is monotonic non-decreasing with skid speed', () => {
  const walk = GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC;
  const softKnee = 90;
  let prev = -Infinity;
  for (const s of [0, 60, 120, 135, 150, 180, 210, 300, 500, 1000, 3000]) {
    const v = computeSkidVisualSpeedWorld(s, walk, softKnee);
    assert.ok(v >= prev - 1e-9, `curve must be monotonic: at speed ${s}, value ${v} < previous ${prev}`);
    prev = v;
  }
});

test('skid visual speed curve is approximately linear near walking speed and diminishes at extreme speed', () => {
  const walk = GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC;
  const softKnee = 90;
  const lowSlope = (computeSkidVisualSpeedWorld(walk + 10, walk, softKnee) - computeSkidVisualSpeedWorld(walk, walk, softKnee)) / 10;
  const highSlope = (computeSkidVisualSpeedWorld(3010, walk, softKnee) - computeSkidVisualSpeedWorld(3000, walk, softKnee)) / 10;
  assert.ok(lowSlope > 0.85, `slope near walking speed should be close to linear (≈1), got ${lowSlope}`);
  assert.ok(highSlope < lowSlope * 0.1, `slope at extreme speed should be much smaller (diminishing returns), got ${highSlope} vs low-speed ${lowSlope}`);
});

// ── 15. Renderer determinism + boundedness ──────────────────────────────────

function makeSkidWorld(entrySpeed: number): WorldState {
  const world = createWorldState(DT_MS);
  world.isPlayerSkiddingFlag = 1;
  world.playerSkidEntryVelocityXWorld = entrySpeed;
  world.playerLandingSkidSpeedFactor = 0;
  world.isGrappleStuckFlag = 0;
  world.skidDebrisXWorld = 0;
  world.skidDebrisYWorld = 0;
  return world;
}

test('renderer stays within the fixed debris pool under sustained high-speed skidding', () => {
  const renderer = new SkidDebrisRenderer();
  const world = makeSkidWorld(600);
  for (let i = 0; i < 500; i++) {
    renderer.update(world, DT_MS);
    assert.ok(renderer.debrisCount <= MAX_DEBRIS, `debris count ${renderer.debrisCount} exceeded pool size ${MAX_DEBRIS}`);
  }
});

test('renderer is deterministic: two identically-driven instances match exactly', () => {
  const rendererA = new SkidDebrisRenderer();
  const rendererB = new SkidDebrisRenderer();
  const worldA = makeSkidWorld(250);
  const worldB = makeSkidWorld(250);
  for (let i = 0; i < 100; i++) {
    rendererA.update(worldA, DT_MS);
    rendererB.update(worldB, DT_MS);
  }
  assert.equal(rendererA.debrisCount, rendererB.debrisCount);
  assert.equal(rendererA.debugStateChecksum(), rendererB.debugStateChecksum());
});

test('particle spawn rate and velocity scale up (not down) with skid-entry speed', () => {
  const rendererWalk = new SkidDebrisRenderer();
  const rendererFast = new SkidDebrisRenderer();
  const worldWalk = makeSkidWorld(GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC);
  const worldFast = makeSkidWorld(400);
  rendererWalk.update(worldWalk, DT_MS);
  rendererFast.update(worldFast, DT_MS);
  assert.ok(rendererFast.debrisCount >= rendererWalk.debrisCount, 'higher skid-entry speed must spawn at least as many particles this tick');
});
