import test from 'node:test';
import assert from 'node:assert/strict';
import { SecondaryWeaveGesturePhase } from '../input/secondaryWeaveGesture';
import { createReusableSnapshot, updateSnapshotInPlace } from '../render/snapshot';
import { createSnapshot } from '../render/snapshotAllocating';
import type { WorldSnapshot } from '../render/snapshotTypes';
import { createWorldState, type WorldState } from '../sim/world';

interface ExpectedWeaveSnapshotFields {
  selectedDustKind: number;
  hasBowWeaveUnlockedFlag: 0 | 1;
  secondaryWeaveGesturePhase: SecondaryWeaveGesturePhase;
  secondaryWeaveGestureHoldAimXWorld: number;
  secondaryWeaveGestureHoldAimYWorld: number;
  bowArrowPhase: number;
  bowArrowDirXWorld: number;
  bowArrowDirYWorld: number;
  hasSwordWeaveUnlockedFlag: 0 | 1;
  newSwordActiveFlag: number;
  newSwordToShieldTransition01: number;
  newSwordReachWorld: number;
  newSwordHandAnchorXWorld: number;
  newSwordHandAnchorYWorld: number;
  newSwordCurrentAngleRad: number;
}

const FIRST_VALUES: ExpectedWeaveSnapshotFields = {
  selectedDustKind: 3,
  hasBowWeaveUnlockedFlag: 1,
  secondaryWeaveGesturePhase: SecondaryWeaveGesturePhase.Holding,
  secondaryWeaveGestureHoldAimXWorld: 101.25,
  secondaryWeaveGestureHoldAimYWorld: -202.5,
  bowArrowPhase: 7,
  bowArrowDirXWorld: -0.625,
  bowArrowDirYWorld: 0.875,
  hasSwordWeaveUnlockedFlag: 1,
  newSwordActiveFlag: 2,
  newSwordToShieldTransition01: 0.375,
  newSwordReachWorld: 88.5,
  newSwordHandAnchorXWorld: -44.25,
  newSwordHandAnchorYWorld: 77.75,
  newSwordCurrentAngleRad: 1.2345,
};

const SECOND_VALUES: ExpectedWeaveSnapshotFields = {
  selectedDustKind: 5,
  hasBowWeaveUnlockedFlag: 0,
  secondaryWeaveGesturePhase: SecondaryWeaveGesturePhase.Release,
  secondaryWeaveGestureHoldAimXWorld: -303.75,
  secondaryWeaveGestureHoldAimYWorld: 404.125,
  bowArrowPhase: 9,
  bowArrowDirXWorld: 0.3125,
  bowArrowDirYWorld: -0.9375,
  hasSwordWeaveUnlockedFlag: 0,
  newSwordActiveFlag: 4,
  newSwordToShieldTransition01: 0.8125,
  newSwordReachWorld: 144.25,
  newSwordHandAnchorXWorld: 55.5,
  newSwordHandAnchorYWorld: -66.625,
  newSwordCurrentAngleRad: -2.3456,
};

function setWorldFields(world: WorldState, values: ExpectedWeaveSnapshotFields): void {
  world.selectedDustKind = values.selectedDustKind;
  world.hasBowWeaveUnlockedFlag = values.hasBowWeaveUnlockedFlag;
  world.secondaryWeaveGesture.phase = values.secondaryWeaveGesturePhase;
  world.secondaryWeaveGesture.holdAimXWorld = values.secondaryWeaveGestureHoldAimXWorld;
  world.secondaryWeaveGesture.holdAimYWorld = values.secondaryWeaveGestureHoldAimYWorld;
  world.bowArrowPhase = values.bowArrowPhase;
  world.bowArrowDirXWorld = values.bowArrowDirXWorld;
  world.bowArrowDirYWorld = values.bowArrowDirYWorld;
  world.hasSwordWeaveUnlockedFlag = values.hasSwordWeaveUnlockedFlag;
  world.newSwordActiveFlag = values.newSwordActiveFlag;
  world.newSwordToShieldTransition01 = values.newSwordToShieldTransition01;
  world.newSwordReachWorld = values.newSwordReachWorld;
  world.newSwordHandAnchorXWorld = values.newSwordHandAnchorXWorld;
  world.newSwordHandAnchorYWorld = values.newSwordHandAnchorYWorld;
  world.newSwordCurrentAngleRad = values.newSwordCurrentAngleRad;
}

function assertSnapshotFields(snapshot: WorldSnapshot, expected: ExpectedWeaveSnapshotFields): void {
  assert.equal(snapshot.selectedDustKind, expected.selectedDustKind);
  assert.equal(snapshot.hasBowWeaveUnlockedFlag, expected.hasBowWeaveUnlockedFlag);
  assert.equal(snapshot.secondaryWeaveGesturePhase, expected.secondaryWeaveGesturePhase);
  assert.equal(snapshot.secondaryWeaveGestureHoldAimXWorld, expected.secondaryWeaveGestureHoldAimXWorld);
  assert.equal(snapshot.secondaryWeaveGestureHoldAimYWorld, expected.secondaryWeaveGestureHoldAimYWorld);
  assert.equal(snapshot.bowArrowPhase, expected.bowArrowPhase);
  assert.equal(snapshot.bowArrowDirXWorld, expected.bowArrowDirXWorld);
  assert.equal(snapshot.bowArrowDirYWorld, expected.bowArrowDirYWorld);
  assert.equal(snapshot.hasSwordWeaveUnlockedFlag, expected.hasSwordWeaveUnlockedFlag);
  assert.equal(snapshot.newSwordActiveFlag, expected.newSwordActiveFlag);
  assert.equal(snapshot.newSwordToShieldTransition01, expected.newSwordToShieldTransition01);
  assert.equal(snapshot.newSwordReachWorld, expected.newSwordReachWorld);
  assert.equal(snapshot.newSwordHandAnchorXWorld, expected.newSwordHandAnchorXWorld);
  assert.equal(snapshot.newSwordHandAnchorYWorld, expected.newSwordHandAnchorYWorld);
  assert.equal(snapshot.newSwordCurrentAngleRad, expected.newSwordCurrentAngleRad);
}

test('allocating snapshot copies every restored Bow, Sword, gesture, and selection scalar', () => {
  const world = createWorldState(1000 / 60, 555);
  setWorldFields(world, FIRST_VALUES);

  assertSnapshotFields(createSnapshot(world), FIRST_VALUES);
});

test('reusable snapshot refreshes every restored Bow, Sword, gesture, and selection scalar per update', () => {
  const world = createWorldState(1000 / 60, 555);
  const snapshot = createReusableSnapshot(world);

  setWorldFields(world, FIRST_VALUES);
  updateSnapshotInPlace(snapshot, world);
  assertSnapshotFields(snapshot, FIRST_VALUES);

  setWorldFields(world, SECOND_VALUES);
  updateSnapshotInPlace(snapshot, world);
  assertSnapshotFields(snapshot, SECOND_VALUES);
});
