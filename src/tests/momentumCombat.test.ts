/**
 * Unit + integration tests for Momentum Combat system.
 *
 * Tests cover:
 *  - DEFAULT_COMBAT_MODE value
 *  - getCombatMode / setCombatMode round-trip
 *  - Horizontal-speed activation (not total speed)
 *  - Vertical-only speed (jump) does NOT activate
 *  - Damage formula properties
 *  - Hit cooldown enforcement
 *  - Full integration: tickMomentumCombat damages overlapping enemy
 *  - Damage scales with speed
 *  - Same enemy cannot be re-hit within cooldown; CAN be hit after cooldown
 *  - Legacy mode: collision damage does NOT apply
 *  - Momentum mode: player weave/dust offense return early (world.combatMode guard)
 *  - isHighVelocityAttacking blocks enemy contact damage to player
 *  - Player is damageable again after dropping below threshold
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_COMBAT_MODE, getCombatMode, setCombatMode } from '../sim/combatMode';
import {
  MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
  MOMENTUM_COMBAT_MIN_SPEED,
  MOMENTUM_HIT_COOLDOWN_TICKS,
} from '../sim/momentumCombatConfig';
import {
  computeMomentumDamage,
  updateMomentumCombatState,
  applyMomentumCombatCollisionDamage,
} from '../sim/momentumCombat';
import { applyPlayerDamageWithKnockback } from '../sim/playerDamage';
import { MAX_RUN_SPEED_WORLD_PER_SEC, PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal player cluster suitable for momentum combat tests. */
function makePlayer(overrides: Partial<ReturnType<typeof _makeCluster>> = {}) {
  return {
    ..._makeCluster(0, 0, 0),
    isPlayerFlag: 1 as const,
    halfWidthWorld: 6,
    halfHeightWorld: 8,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
    isGroundedFlag: 0 as const,
    ...overrides,
  };
}

function _makeCluster(x: number, y: number, entityId: number) {
  return {
    entityId,
    positionXWorld: x,
    positionYWorld: y,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isAliveFlag: 1 as 0 | 1,
    isPlayerFlag: 0 as 0 | 1,
    healthPoints: 10,
    maxHealthPoints: 10,
    isGroundedFlag: 0 as 0 | 1,
    halfWidthWorld: 6,
    halfHeightWorld: 6,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
    isHighVelocityAttacking: 0 as 0 | 1,
    momentumHitCooldownTicks: 0,
    // Enemy-type flags (all off by default)
    isOrbitalDustCoreFlag: 0 as 0 | 1,
    isOrbitalDustCoreLargeFlag: 0 as 0 | 1,
    isBubbleEnemyFlag: 0 as 0 | 1,
    isDustWeaverArchitectFlag: 0 as 0 | 1,
    dustWeaverArchitectHitFlashTicks: 0,
    isRollingEnemyFlag: 0 as 0 | 1,
    rollingEnemyAggressiveTicks: 0,
    isLargeSlimeFlag: 0 as 0 | 1,
    largeSlimeSplitDoneFlag: 0 as 0 | 1,
    bubbleState: 0,
    bubblePrevHealthPoints: 10,
    coyoteTimeTicks: 0,
  };
}

function makeWorld(combatMode: 'legacy' | 'momentum' = 'momentum') {
  const player = makePlayer();
  const enemy = _makeCluster(0, 0, 1); // overlapping player by default
  return {
    combatMode,
    clusters: [player, enemy],
  } as unknown as import('../sim/world').WorldState;
}

// ── Combat mode defaults ──────────────────────────────────────────────────────

test('DEFAULT_COMBAT_MODE is momentum', () => {
  assert.equal(DEFAULT_COMBAT_MODE, 'momentum');
});

test('getCombatMode returns momentum after setCombatMode(momentum)', () => {
  setCombatMode('momentum');
  assert.equal(getCombatMode(), 'momentum');
});

test('getCombatMode returns legacy after setCombatMode(legacy)', () => {
  setCombatMode('legacy');
  assert.equal(getCombatMode(), 'legacy');
  setCombatMode('momentum');
});

// ── Speed constants sanity ────────────────────────────────────────────────────

test('walk speed (MAX_RUN_SPEED) is below horizontal threshold', () => {
  assert.ok(MAX_RUN_SPEED_WORLD_PER_SEC < MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
    `walk speed ${MAX_RUN_SPEED_WORLD_PER_SEC} must be below threshold ${MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED}`);
});

test('sprint speed (MAX_RUN_SPEED × 1.5) is below horizontal threshold', () => {
  const sprintSpeed = MAX_RUN_SPEED_WORLD_PER_SEC * 1.5;
  assert.ok(sprintSpeed < MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
    `sprint speed ${sprintSpeed} must be below threshold ${MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED}`);
});

test('jump speed (PLAYER_JUMP_SPEED_WORLD) is above horizontal threshold (ensures jump would falsely activate with total-speed check)', () => {
  // This documents WHY we use horizontal speed: jump would fire the old total-speed threshold.
  assert.ok(PLAYER_JUMP_SPEED_WORLD > MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
    `jump speed ${PLAYER_JUMP_SPEED_WORLD} should exceed horizontal threshold — confirms the bug the fix addresses`);
});

// ── Horizontal-speed activation ───────────────────────────────────────────────

test('isHighVelocityAttacking is FALSE at walk speed horizontal velocity', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MAX_RUN_SPEED_WORLD_PER_SEC;
  world.clusters[0].velocityYWorld = 0;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 0);
});

test('isHighVelocityAttacking is FALSE at sprint speed horizontal velocity', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MAX_RUN_SPEED_WORLD_PER_SEC * 1.5; // 157.5
  world.clusters[0].velocityYWorld = 0;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 0);
});

test('isHighVelocityAttacking is FALSE when only vertical speed is high (simulating a jump)', () => {
  const world = makeWorld('momentum');
  // Pure vertical jump: vx=0, vy=-PLAYER_JUMP_SPEED_WORLD (255 px/s upward)
  world.clusters[0].velocityXWorld = 0;
  world.clusters[0].velocityYWorld = -PLAYER_JUMP_SPEED_WORLD;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 0,
    'vertical-only jump should NOT activate momentum combat');
});

test('isHighVelocityAttacking is FALSE when sprinting AND jumping (high total speed, but horizontal is only sprint)', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MAX_RUN_SPEED_WORLD_PER_SEC * 1.5; // 157.5 px/s horizontal
  world.clusters[0].velocityYWorld = -PLAYER_JUMP_SPEED_WORLD;           // 255 px/s upward
  // total speed ≈ 300 px/s — would have falsely activated with old total-speed check
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 0,
    'sprint+jump total speed must not activate momentum combat — horizontal check prevents this');
});

test('isHighVelocityAttacking is TRUE at grapple-level horizontal speed', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  world.clusters[0].velocityYWorld = 0;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 1);
});

test('isHighVelocityAttacking is TRUE well above threshold', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 100;
  world.clusters[0].velocityYWorld = -100;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 1);
});

// ── Damage formula ────────────────────────────────────────────────────────────

test('damage is 1 at exactly the damage baseline speed', () => {
  const dmg = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED);
  assert.equal(dmg, 1);
});

test('damage is 1 below the damage baseline', () => {
  assert.equal(computeMomentumDamage(0), 1);
  assert.equal(computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED - 1), 1);
});

test('damage scales above the baseline speed', () => {
  const dmgAt = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED);
  const dmgAbove = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED + 100);
  assert.ok(dmgAbove > dmgAt, 'damage should increase with speed');
});

test('damage rounds to integer', () => {
  const dmg = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED + 77);
  assert.equal(dmg, Math.round(dmg));
});

test('damage at 2× baseline is approximately 5-10', () => {
  const dmg = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED * 2);
  assert.ok(dmg >= 5 && dmg <= 10, `dmg at 2× baseline should be 5-10, got ${dmg}`);
});

// ── Full integration: collision damage ────────────────────────────────────────

test('momentum collision damages an overlapping enemy', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  world.clusters[1].healthPoints = 10;

  updateMomentumCombatState(world);
  applyMomentumCombatCollisionDamage(world);

  assert.ok(world.clusters[1].healthPoints < 10, 'enemy should take damage from momentum collision');
});

test('damage scales with speed: higher speed deals more damage', () => {
  const worldLow = makeWorld('momentum');
  worldLow.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  worldLow.clusters[0].velocityYWorld = 0;
  worldLow.clusters[1].healthPoints = 100;
  updateMomentumCombatState(worldLow);
  applyMomentumCombatCollisionDamage(worldLow);
  const dmgLow = 100 - worldLow.clusters[1].healthPoints;

  const worldHigh = makeWorld('momentum');
  worldHigh.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 200;
  worldHigh.clusters[0].velocityYWorld = -200;
  worldHigh.clusters[1].healthPoints = 100;
  updateMomentumCombatState(worldHigh);
  applyMomentumCombatCollisionDamage(worldHigh);
  const dmgHigh = 100 - worldHigh.clusters[1].healthPoints;

  assert.ok(dmgHigh > dmgLow, `higher speed should deal more damage (low=${dmgLow}, high=${dmgHigh})`);
});

test('same enemy cannot be hit twice within MOMENTUM_HIT_COOLDOWN_TICKS', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  world.clusters[1].healthPoints = 100;

  updateMomentumCombatState(world);
  applyMomentumCombatCollisionDamage(world); // first hit
  const hpAfterFirst = world.clusters[1].healthPoints;

  // Second hit on same tick (cooldown just set)
  applyMomentumCombatCollisionDamage(world);
  assert.equal(world.clusters[1].healthPoints, hpAfterFirst, 'second hit within cooldown should be blocked');
});

test('same enemy CAN be hit after MOMENTUM_HIT_COOLDOWN_TICKS ticks expire', () => {
  const world = makeWorld('momentum');
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
  world.clusters[1].healthPoints = 100;

  updateMomentumCombatState(world);
  applyMomentumCombatCollisionDamage(world); // first hit
  const hpAfterFirst = world.clusters[1].healthPoints;

  // Simulate cooldown expiry
  world.clusters[1].momentumHitCooldownTicks = 0;

  applyMomentumCombatCollisionDamage(world); // second hit allowed
  assert.ok(world.clusters[1].healthPoints < hpAfterFirst, 'hit should be allowed after cooldown expires');
});

// ── Legacy mode: collision damage does NOT apply ──────────────────────────────

test('legacy mode: momentum collision damage does not apply', () => {
  const world = makeWorld('legacy');
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 100;
  world.clusters[1].healthPoints = 10;

  updateMomentumCombatState(world);
  applyMomentumCombatCollisionDamage(world);

  assert.equal(world.clusters[1].healthPoints, 10, 'enemy should take no damage in legacy mode');
  assert.equal(world.clusters[0].isHighVelocityAttacking, 0, 'isHighVelocityAttacking should be 0 in legacy mode');
});

// ── isHighVelocityAttacking blocks enemy contact damage ──────────────────────

test('isHighVelocityAttacking blocks enemy contact damage to player', () => {
  const player = makePlayer({ isHighVelocityAttacking: 1, healthPoints: 10 });
  applyPlayerDamageWithKnockback(player, 3, 0, 0);
  assert.equal(player.healthPoints, 10, 'player with isHighVelocityAttacking=1 should be immune to enemy damage');
});

test('player is damageable when isHighVelocityAttacking is 0', () => {
  const player = makePlayer({ isHighVelocityAttacking: 0, healthPoints: 10 });
  applyPlayerDamageWithKnockback(player, 3, 0, 0);
  assert.ok(player.healthPoints < 10, 'player should take damage when not in high velocity attack state');
});

test('player drops below threshold: isHighVelocityAttacking becomes 0', () => {
  const world = makeWorld('momentum');
  // Start above threshold
  world.clusters[0].velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 1);

  // Drop to walk speed
  world.clusters[0].velocityXWorld = MAX_RUN_SPEED_WORLD_PER_SEC;
  updateMomentumCombatState(world);
  assert.equal(world.clusters[0].isHighVelocityAttacking, 0,
    'isHighVelocityAttacking should clear when dropping below horizontal threshold');
});

// ── MOMENTUM_HIT_COOLDOWN_TICKS value ────────────────────────────────────────

test('MOMENTUM_HIT_COOLDOWN_TICKS is approximately 9 (≈150ms at 60fps)', () => {
  const expectedMs = 150;
  const fps = 60;
  const expectedTicks = Math.round(expectedMs / 1000 * fps);
  assert.equal(MOMENTUM_HIT_COOLDOWN_TICKS, expectedTicks);
});
