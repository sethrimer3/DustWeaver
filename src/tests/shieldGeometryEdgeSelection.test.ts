import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { initMoteQueueFromParticles, getAvailableOrderedMoteSlots } from '../sim/motes/orderedMoteQueue';
import { computeShieldCenterWorld, centerOutArcT, SHIELD_CRESCENT_RADIUS_WORLD } from '../sim/weaves/shieldGeometry';
import {
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  BOW_ARROW_LOAD_3_TICKS,
} from '../sim/weaves/bowArrow';
import { applyShieldWeaveCrescent } from '../sim/weaves/shieldWeave';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 8) {
  const world = createWorldState(DT_MS, 9);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

// ── §2: shield-center helper ────────────────────────────────────────────────

test('computeShieldCenterWorld offsets the player by the crescent radius along the aim direction', () => {
  const out = { x: 0, y: 0 };
  computeShieldCenterWorld(out, 100, 100, 1, 0, 1, 0);
  assert.ok(Math.abs(out.x - (100 + SHIELD_CRESCENT_RADIUS_WORLD)) < 1e-6);
  assert.ok(Math.abs(out.y - 100) < 1e-6);

  computeShieldCenterWorld(out, 100, 100, 0, 1, 1, 0);
  assert.ok(Math.abs(out.x - 100) < 1e-6);
  assert.ok(Math.abs(out.y - (100 + SHIELD_CRESCENT_RADIUS_WORLD)) < 1e-6);
});

test('computeShieldCenterWorld falls back to the given direction when the aim delta is ~zero', () => {
  const out = { x: 0, y: 0 };
  computeShieldCenterWorld(out, 100, 100, 0, 0, 0, -1); // aim exactly on the player; fallback = up
  assert.ok(Math.abs(out.x - 100) < 1e-6);
  assert.ok(Math.abs(out.y - (100 - SHIELD_CRESCENT_RADIUS_WORLD)) < 1e-6);
});

test('rotating the aim rotates the shield center correctly (always exactly RADIUS from the player)', () => {
  const out = { x: 0, y: 0 };
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    computeShieldCenterWorld(out, 50, 50, Math.cos(angle), Math.sin(angle), 1, 0);
    const dist = Math.hypot(out.x - 50, out.y - 50);
    assert.ok(Math.abs(dist - SHIELD_CRESCENT_RADIUS_WORLD) < 1e-6, `angle ${angle}: dist ${dist}`);
  }
});

test('Bow assembly seats at the shield center; launch origin equals the assembly center; preview would agree', () => {
  const { world, player } = makeFixture(8);
  const out = { x: 0, y: 0 };
  computeShieldCenterWorld(out, player.positionXWorld, player.positionYWorld, 1, 0, 1, 0);

  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  const centerPidx = world.bowArrowParticleIndex[0];
  assert.ok(Math.abs(world.positionXWorld[centerPidx] - out.x) < 1e-3, 'center mote seats at the shield center');
  assert.ok(Math.abs(world.positionYWorld[centerPidx] - out.y) < 1e-3);

  assert.equal(fireBowArrow(world, 1, 0), true);
  assert.ok(Math.abs(world.bowArrowOriginXWorld - out.x) < 1e-3, 'launch origin equals the assembly (shield) center');
  assert.ok(Math.abs(world.bowArrowOriginYWorld - out.y) < 1e-3);
});

// ── §3: deterministic edge-mote selection ───────────────────────────────────

test('centerOutArcT places the last two ranks at the two arc extremes (0 and 1) for any slot count', () => {
  for (const n of [2, 3, 4, 5, 6, 10, 15, 30]) {
    const tSecondLast = centerOutArcT(n - 2, n);
    const tLast = centerOutArcT(n - 1, n);
    const extremes = [tSecondLast, tLast].sort((a, b) => a - b);
    assert.ok(Math.abs(extremes[0] - 0) < 1e-9, `n=${n}: expected an arc-t of 0 among the last two ranks, got ${extremes[0]}`);
    assert.ok(Math.abs(extremes[1] - 1) < 1e-9, `n=${n}: expected an arc-t of 1 among the last two ranks, got ${extremes[1]}`);
  }
});

test('Bow selects the two outermost shield-arc motes first, by queue rank — not by physics distance', () => {
  const { world, player } = makeFixture(6);

  // Manually displace all motes to the SAME physical distance from the
  // player (defeating any distance-based heuristic), but leave their queue
  // order (moteSlotParticleIndex ordering) intact — the correct selection is
  // rank-based and must be unaffected by this.
  const available = getAvailableOrderedMoteSlots(world);
  for (let k = 0; k < available.count; k++) {
    const pidx = world.moteSlotParticleIndex[available.indices[k]];
    const angle = (k / available.count) * Math.PI * 2;
    world.positionXWorld[pidx] = player.positionXWorld + Math.cos(angle) * 20;
    world.positionYWorld[pidx] = player.positionYWorld + Math.sin(angle) * 20;
  }

  // Expected outermost-first order, purely from queue rank: for n=6 available
  // motes (indices 0..5), centerOutArcT's last two ranks are 4 and 5.
  const expectedFirstEdgePidx = world.moteSlotParticleIndex[available.indices[5]];
  const expectedSecondEdgePidx = world.moteSlotParticleIndex[available.indices[4]];

  beginBowArrowAssembly(world, world.tick, 1);
  // Advance to just past the 0.75s threshold — exactly two motes get pulled
  // this instant (rank 1 and rank 2 of the arrow).
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 1; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  assert.equal(world.bowArrowCount, 3);
  const pulledPidx = [world.bowArrowParticleIndex[1], world.bowArrowParticleIndex[2]];
  assert.ok(pulledPidx.includes(expectedFirstEdgePidx), 'the true outermost shield-arc mote is pulled first');
  assert.ok(pulledPidx.includes(expectedSecondEdgePidx), 'the second-outermost shield-arc mote is pulled alongside it');
});

test('Shield crescent excludes motes reserved by the Bow arrow from ordinary slot placement', () => {
  const { world, player } = makeFixture(6);
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 1; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  const reservedPidx = new Set([
    world.bowArrowParticleIndex[0], world.bowArrowParticleIndex[1], world.bowArrowParticleIndex[2],
  ]);

  applyShieldWeaveCrescent(world, player.positionXWorld, player.positionYWorld, 1, 0);

  for (const pidx of reservedPidx) {
    assert.notEqual(world.behaviorMode[pidx], 2, `mote ${pidx} reserved by the Bow must not also be placed in a shield slot`);
  }
});
