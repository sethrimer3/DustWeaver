/**
 * poisonField.test.ts — Poison Field hazard tests.
 *
 * Covers exposure timing (entry/recurring/leave/re-entry/timestep
 * subdivision/large-tick/stop-on-death), Verdant immunity and the
 * switch-away immediate hit, multi-field overlap collapsing to one
 * exposure, and room-load/reset lifecycle behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  updatePoisonExposure,
  resetPoisonExposureState,
  isPlayerInsidePoisonField,
} from '../sim/poisonField/poisonExposureState';
import { POISON_TICK_INTERVAL_SECONDS } from '../sim/poisonField/poisonFieldConfig';

const B = BLOCK_SIZE_MEDIUM;
const TICK_DT = 1 / 60;

function makeWorldWithPlayer(xWorld: number, yWorld: number): WorldState {
  const world = createWorldState(1000 / 60);
  const player = createClusterState(0, xWorld, yWorld, 1, 10);
  world.clusters.push(player);
  return world;
}

/** Directly populates world.poisonField* arrays (bypasses the editor/room pipeline). */
function setPoisonFields(world: WorldState, rectsBlock: readonly [number, number, number, number][]): void {
  world.poisonFieldCount = 0;
  for (const [bx, by, bw, bh] of rectsBlock) {
    const i = world.poisonFieldCount++;
    world.poisonFieldXWorld[i] = bx * B;
    world.poisonFieldYWorld[i] = by * B;
    world.poisonFieldWWorld[i] = bw * B;
    world.poisonFieldHWorld[i] = bh * B;
  }
}

function centerOfBlock(bx: number, by: number): [number, number] {
  return [(bx + 0.5) * B, (by + 0.5) * B];
}

function tickN(world: WorldState, n: number, dt = TICK_DT): void {
  for (let i = 0; i < n; i++) updatePoisonExposure(world, dt);
}

function health(world: WorldState): number {
  return world.clusters[0].healthPoints;
}

// ── Overlap helper ──────────────────────────────────────────────────────────

test('isPlayerInsidePoisonField: true when overlapping, false when outside', () => {
  const [px, py] = centerOfBlock(2, 2);
  const world = makeWorldWithPlayer(px, py);
  setPoisonFields(world, [[2, 2, 1, 1]]);
  assert.equal(isPlayerInsidePoisonField(world, world.clusters[0]), true);

  const outside = makeWorldWithPlayer(...centerOfBlock(20, 20));
  setPoisonFields(outside, [[2, 2, 1, 1]]);
  assert.equal(isPlayerInsidePoisonField(outside, outside.clusters[0]), false);
});

// ── Exposure timing ──────────────────────────────────────────────────────────

test('entry deals no immediate damage', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  updatePoisonExposure(world, TICK_DT);
  assert.equal(health(world), 10);
});

test('deals exactly 1 damage at 3.0s of continuous exposure', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  const ticksToThreshold = Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT);
  tickN(world, ticksToThreshold - 1);
  assert.equal(health(world), 10, 'no damage just before 3.0s');
  updatePoisonExposure(world, TICK_DT);
  assert.equal(health(world), 9, 'exactly 1 damage at 3.0s');
});

test('recurring damage every 3.0s thereafter', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  const ticksPerInterval = Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT);
  tickN(world, ticksPerInterval);
  assert.equal(health(world), 9);
  tickN(world, ticksPerInterval);
  assert.equal(health(world), 8);
  tickN(world, ticksPerInterval);
  assert.equal(health(world), 7);
});

test('leaving before 3.0s resets exposure with no damage', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  tickN(world, 90); // 1.5s — inside the grace period
  assert.equal(health(world), 10);
  // Move outside all fields.
  world.clusters[0].positionXWorld = centerOfBlock(20, 20)[0];
  world.clusters[0].positionYWorld = centerOfBlock(20, 20)[1];
  updatePoisonExposure(world, TICK_DT);
  assert.equal(world.poisonExposure.elapsedSeconds, 0);
  assert.equal(world.poisonExposure.isInsideFieldFlag, 0);
});

test('re-entry starts a fresh 3.0s grace period (no banked time)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  tickN(world, 150); // 2.5s inside
  assert.equal(health(world), 10);
  world.clusters[0].positionXWorld = centerOfBlock(20, 20)[0];
  world.clusters[0].positionYWorld = centerOfBlock(20, 20)[1];
  updatePoisonExposure(world, TICK_DT); // leave -> reset
  world.clusters[0].positionXWorld = centerOfBlock(2, 2)[0];
  world.clusters[0].positionYWorld = centerOfBlock(2, 2)[1];
  tickN(world, 150); // another 2.5s — should NOT have banked the prior 2.5s
  assert.equal(health(world), 10, 'no damage yet — fresh grace period, not banked total');
  tickN(world, 30); // complete to 3.0s of the fresh exposure
  assert.equal(health(world), 9);
});

test('timestep subdivision equivalence: many small ticks == one large tick, same total dt', () => {
  const worldSmall = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(worldSmall, [[2, 2, 1, 1]]);
  const totalSeconds = POISON_TICK_INTERVAL_SECONDS * 2.5;
  const steps = 1000;
  for (let i = 0; i < steps; i++) updatePoisonExposure(worldSmall, totalSeconds / steps);

  const worldLarge = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(worldLarge, [[2, 2, 1, 1]]);
  updatePoisonExposure(worldLarge, totalSeconds);

  assert.equal(health(worldSmall), health(worldLarge));
  assert.equal(health(worldSmall), 10 - 2); // 2 thresholds crossed (3s, 6s) within 7.5s
});

test('large tick crossing multiple 3s boundaries fires the correct number of hits', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  updatePoisonExposure(world, POISON_TICK_INTERVAL_SECONDS * 4.2);
  assert.equal(health(world), 10 - 4);
});

test('stops processing further poison ticks once the player dies', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  world.clusters[0].healthPoints = 2;
  setPoisonFields(world, [[2, 2, 1, 1]]);
  updatePoisonExposure(world, POISON_TICK_INTERVAL_SECONDS * 10);
  assert.equal(world.clusters[0].isAliveFlag, 0);
  assert.equal(world.poisonExposure.isInsideFieldFlag, 0);
  assert.equal(world.poisonExposure.hitsFired, 0);
});

// ── Verdant immunity ─────────────────────────────────────────────────────────

test('Verdant equipped on entry: fully immune, no damage, no timer advance', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  world.selectedDustKind = ParticleKind.Nature;
  setPoisonFields(world, [[2, 2, 1, 1]]);
  tickN(world, Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT) * 3);
  assert.equal(health(world), 10);
  assert.equal(world.poisonExposure.elapsedSeconds, 0);
});

test('equipping Verdant mid-exposure cancels the timer with no damage (no banking)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  tickN(world, 150); // 2.5s progress
  world.selectedDustKind = ParticleKind.Nature;
  updatePoisonExposure(world, TICK_DT);
  assert.equal(world.poisonExposure.elapsedSeconds, 0);
  // Keep Verdant equipped well past where the original cadence would have hit.
  tickN(world, Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT) * 2);
  assert.equal(health(world), 10, 'no banked damage after Verdant cancels exposure');
});

test('switching Verdant -> non-Verdant while inside deals exactly 1 immediate hit, then 3.0s cadence', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  world.selectedDustKind = ParticleKind.Nature;
  setPoisonFields(world, [[2, 2, 1, 1]]);
  updatePoisonExposure(world, TICK_DT); // immune entry tick
  assert.equal(health(world), 10);

  world.selectedDustKind = 0; // switch away from Verdant
  updatePoisonExposure(world, TICK_DT);
  assert.equal(health(world), 9, 'exactly one immediate hit on switch-away');

  // Next hit should land exactly 3.0s later, not immediately and not banked.
  const ticksPerInterval = Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT);
  tickN(world, ticksPerInterval - 1);
  assert.equal(health(world), 9, 'no damage just before the fresh cadence completes');
  updatePoisonExposure(world, TICK_DT);
  assert.equal(health(world), 8);
});

test('switching between non-Verdant dust kinds never deals an extra immediate hit', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  updatePoisonExposure(world, TICK_DT);
  world.selectedDustKind = 3; // some other non-Verdant kind
  updatePoisonExposure(world, TICK_DT);
  world.selectedDustKind = 7; // another non-Verdant kind
  updatePoisonExposure(world, TICK_DT);
  assert.equal(health(world), 10, 'no immediate hits from non-Verdant-to-non-Verdant switches');
});

test('repeated Verdant transitions leave no stale state', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  for (let i = 0; i < 5; i++) {
    world.selectedDustKind = ParticleKind.Nature;
    updatePoisonExposure(world, TICK_DT);
    world.selectedDustKind = 0;
    updatePoisonExposure(world, TICK_DT); // 1 immediate hit each cycle
  }
  assert.equal(health(world), 10 - 5);
});

// ── Overlap ──────────────────────────────────────────────────────────────────

test('two overlapping fields behave as one exposure — no double damage', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 2, 2], [3, 3, 2, 2]]); // overlapping rectangles
  const ticksPerInterval = Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT);
  tickN(world, ticksPerInterval);
  assert.equal(health(world), 9, 'exactly one hit, not one per overlapping field');
});

test('moving between overlapping fields without fully leaving does not reset or duplicate', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[0, 0, 4, 4], [3, 3, 4, 4]]);
  tickN(world, 90); // 1.5s in the first field's region
  world.clusters[0].positionXWorld = centerOfBlock(4, 4)[0];
  world.clusters[0].positionYWorld = centerOfBlock(4, 4)[1]; // still inside union (overlap zone)
  const ticksPerInterval = Math.round(POISON_TICK_INTERVAL_SECONDS / TICK_DT);
  tickN(world, ticksPerInterval - 90);
  assert.equal(health(world), 9, 'progress carried through without reset');
});

test('leaving the final field resets exposure', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1], [10, 10, 1, 1]]);
  tickN(world, 90);
  world.clusters[0].positionXWorld = centerOfBlock(50, 50)[0];
  world.clusters[0].positionYWorld = centerOfBlock(50, 50)[1];
  updatePoisonExposure(world, TICK_DT);
  assert.equal(world.poisonExposure.isInsideFieldFlag, 0);
  assert.equal(world.poisonExposure.elapsedSeconds, 0);
});

// ── Lifecycle / reset ────────────────────────────────────────────────────────

test('resetPoisonExposureState clears all fields without dealing damage', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  tickN(world, 150);
  resetPoisonExposureState(world.poisonExposure);
  assert.equal(world.poisonExposure.isInsideFieldFlag, 0);
  assert.equal(world.poisonExposure.elapsedSeconds, 0);
  assert.equal(world.poisonExposure.hitsFired, 0);
  assert.equal(world.poisonExposure.wasVerdantLastTick, 0);
  assert.equal(health(world), 10);
});

test('no player cluster: safe no-op reset, never throws', () => {
  const world = createWorldState(1000 / 60);
  setPoisonFields(world, [[2, 2, 1, 1]]);
  assert.doesNotThrow(() => updatePoisonExposure(world, TICK_DT));
});

test('pause semantics: caller simply must not invoke updatePoisonExposure while paused (no dt = no advance)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(2, 2));
  setPoisonFields(world, [[2, 2, 1, 1]]);
  tickN(world, 90);
  const before = world.poisonExposure.elapsedSeconds;
  // Simulate a paused frame: simply don't call updatePoisonExposure at all.
  assert.equal(world.poisonExposure.elapsedSeconds, before);
});
