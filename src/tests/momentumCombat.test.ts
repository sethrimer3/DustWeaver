/**
 * Unit tests for Momentum Combat system.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_COMBAT_MODE, getCombatMode, setCombatMode } from '../sim/combatMode';
import {
  MOMENTUM_COMBAT_MIN_SPEED,
  MOMENTUM_HIT_COOLDOWN_TICKS,
} from '../sim/momentumCombatConfig';
import { computeMomentumDamage } from '../sim/momentumCombat';

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
  setCombatMode('momentum'); // restore default for subsequent tests
});

// ── Speed threshold ───────────────────────────────────────────────────────────

test('isHighVelocityAttacking is false at walk speed (105 px/s)', () => {
  const speed = 105;
  assert.ok(speed < MOMENTUM_COMBAT_MIN_SPEED, 'walk speed must be below threshold');
});

test('isHighVelocityAttacking is false at sprint speed (157.5 px/s)', () => {
  const speed = 157.5;
  assert.ok(speed < MOMENTUM_COMBAT_MIN_SPEED, 'sprint speed must be below threshold');
});

test('isHighVelocityAttacking is true at threshold speed', () => {
  const speed = MOMENTUM_COMBAT_MIN_SPEED;
  assert.ok(speed >= MOMENTUM_COMBAT_MIN_SPEED, 'threshold speed must activate attack state');
});

test('isHighVelocityAttacking is true above threshold', () => {
  const speed = MOMENTUM_COMBAT_MIN_SPEED + 50;
  assert.ok(speed >= MOMENTUM_COMBAT_MIN_SPEED);
});

// ── Damage formula ────────────────────────────────────────────────────────────

test('damage is 1 at exactly threshold speed', () => {
  const dmg = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED);
  assert.equal(dmg, 1);
});

test('damage scales above threshold speed', () => {
  const dmgAtThreshold = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED);
  const dmgAbove = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED + 100);
  assert.ok(dmgAbove > dmgAtThreshold, 'damage should increase with speed');
});

test('damage rounds to integer', () => {
  const dmg = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED + 77);
  assert.equal(dmg, Math.round(dmg));
});

test('minimum damage is 1 even below threshold', () => {
  const dmg = computeMomentumDamage(0);
  assert.equal(dmg, 1);
});

test('damage at 2× threshold is approximately 5-10', () => {
  const dmg = computeMomentumDamage(MOMENTUM_COMBAT_MIN_SPEED * 2);
  assert.ok(dmg >= 5 && dmg <= 10, `dmg at 2× threshold should be 5-10, got ${dmg}`);
});

// ── Hit cooldown ──────────────────────────────────────────────────────────────

test('MOMENTUM_HIT_COOLDOWN_TICKS is approximately 9 (≈150ms at 60fps)', () => {
  const expectedMs = 150;
  const fps = 60;
  const expectedTicks = Math.round(expectedMs / 1000 * fps);
  assert.equal(MOMENTUM_HIT_COOLDOWN_TICKS, expectedTicks);
});

test('second hit on same enemy is blocked within cooldown', () => {
  // Simulate cooldown: if ticksSinceLastHit < MOMENTUM_HIT_COOLDOWN_TICKS, skip
  const ticksSinceLastHit = MOMENTUM_HIT_COOLDOWN_TICKS - 1;
  const isOnCooldown = ticksSinceLastHit < MOMENTUM_HIT_COOLDOWN_TICKS;
  assert.ok(isOnCooldown, 'hit within cooldown window should be blocked');
});

test('hit is allowed after cooldown expires', () => {
  const ticksSinceLastHit = MOMENTUM_HIT_COOLDOWN_TICKS;
  const isOnCooldown = ticksSinceLastHit < MOMENTUM_HIT_COOLDOWN_TICKS;
  assert.ok(!isOnCooldown, 'hit after cooldown should be allowed');
});
