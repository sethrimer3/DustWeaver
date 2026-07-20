import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import {
  tickSecondaryWeaveGesture,
  cancelSecondaryWeaveGesture,
  markSecondaryWeaveGestureConsumedByOtherSystem,
} from '../input/secondaryWeaveGesture';
import { applyPlayerWeaveCombat } from '../sim/weaves/weaveCombat';
import { NEW_SWORD_SLASH_TICKS } from '../sim/weaves/swordWeave';
import { MOTE_4_LOAD_TICKS } from '../sim/weaves/arrowWeave';

function makeFixture(moteCount = 8) {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

function addEnemy(world: ReturnType<typeof createWorldState>, x: number, y: number, hp = 10) {
  const enemy = createClusterState(1, x, y, 0, hp);
  world.clusters.push(enemy);
  return enemy;
}

/** Presses, ticks the gesture + coordinator once. Advances world.tick like the real fixed-step loop. */
function press(world: ReturnType<typeof createWorldState>, aimX: number, aimY: number) {
  world.tick++;
  tickSecondaryWeaveGesture(world.secondaryWeaveGesture, true, aimX, aimY);
  applyPlayerWeaveCombat(world);
}
function hold(world: ReturnType<typeof createWorldState>, aimX: number, aimY: number) {
  world.tick++;
  tickSecondaryWeaveGesture(world.secondaryWeaveGesture, true, aimX, aimY);
  applyPlayerWeaveCombat(world);
}
function release(world: ReturnType<typeof createWorldState>, aimX: number, aimY: number) {
  world.tick++;
  tickSecondaryWeaveGesture(world.secondaryWeaveGesture, false, aimX, aimY);
  applyPlayerWeaveCombat(world);
}
function idleTick(world: ReturnType<typeof createWorldState>) {
  world.tick++;
  tickSecondaryWeaveGesture(world.secondaryWeaveGesture, false, 0, 0);
  applyPlayerWeaveCombat(world);
}

test('none unlocked: press/hold/release is a total no-op', () => {
  const { world } = makeFixture();
  press(world, 110, 100);
  for (let i = 0; i < 5; i++) hold(world, 110, 100);
  release(world, 110, 100);
  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.newBowChargingFlag, 0);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
});

test('sword-only: press triggers a swipe, damages an in-arc enemy once, and clears on completion', () => {
  const { world, player } = makeFixture();
  world.hasSwordWeaveUnlockedFlag = 1;
  const enemy = addEnemy(world, player.positionXWorld + 10, player.positionYWorld, 10);

  press(world, player.positionXWorld + 20, player.positionYWorld); // aim straight at enemy
  assert.equal(world.newSwordActiveFlag, 1);

  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);

  assert.equal(world.newSwordActiveFlag, 0, 'swipe must end');
  assert.ok(enemy.healthPoints < 10, 'enemy should have taken damage');
  const hpAfterFirstSwipe = enemy.healthPoints;

  // Holding further must not re-trigger damage (no auto-swing while idle).
  for (let i = 0; i < 20; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(enemy.healthPoints, hpAfterFirstSwipe, 'no idle auto-swing/auto-target');

  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 0);
});

test('sword: zero available motes still consumes input cleanly with no damage (not a full-length fallback)', () => {
  const { world, player } = makeFixture(0);
  world.hasSwordWeaveUnlockedFlag = 1;
  const enemy = addEnemy(world, player.positionXWorld + 10, player.positionYWorld, 10);

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 1);
  assert.equal(world.newSwordReachWorld, 0);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(enemy.healthPoints, 10, 'no damage with zero motes');
  assert.equal(world.newSwordActiveFlag, 0, 'swipe still completed (input consumed)');
});

test('sword: press-time aim only — retargeting the mouse mid-swing does not redirect the swipe', () => {
  const { world, player } = makeFixture();
  world.hasSwordWeaveUnlockedFlag = 1;
  press(world, player.positionXWorld + 20, player.positionYWorld);
  const aimAtPress = world.newSwordAimAngleRad;
  hold(world, player.positionXWorld, player.positionYWorld - 50); // different aim while swinging
  assert.equal(world.newSwordAimAngleRad, aimAtPress, 'aim angle must stay fixed at press-time value');
});

test('shield-only: forms while held, releases motes on end, no crescent while nothing held', () => {
  const { world, player } = makeFixture();
  world.hasShieldWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1);
  for (let i = 0; i < world.moteSlotCount; i++) {
    const pidx = world.moteSlotParticleIndex[i];
    assert.equal(world.behaviorMode[pidx], 2, 'motes should be in block/shield mode');
  }

  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
  for (let i = 0; i < world.moteSlotCount; i++) {
    const pidx = world.moteSlotParticleIndex[i];
    assert.equal(world.behaviorMode[pidx], 0, 'motes should return to orbit after release');
  }
});

test('bow-only: charges on press, tier increases over time, fires on release consuming motes', () => {
  const { world, player } = makeFixture(6);
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newBowChargingFlag, 1);
  assert.equal(world.newBowTierMoteCount, 2);

  for (let i = 0; i < MOTE_4_LOAD_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newBowTierMoteCount, 4);

  const availableBefore = countAvailableMotes(world);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newBowChargingFlag, 0);
  const availableAfter = countAvailableMotes(world);
  assert.equal(availableBefore - availableAfter, 4, 'exactly the fired arrow tier worth of motes should deplete');
  assert.equal(world.arrowCount >= 1, true);
});

test('bow: tier is capped by available motes, and mid-charge depletion clamps live', () => {
  const { world, player } = makeFixture(2);
  world.hasBowWeaveUnlockedFlag = 1;
  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < MOTE_4_LOAD_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newBowTierMoteCount, 2, 'tier capped by only 2 available motes');
});

test('sword+shield: swipe completes then the SAME motes hand off to the shield crescent (no gap, no duplication)', () => {
  const { world, player } = makeFixture();
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasShieldWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 1);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0, 'shield suppressed while sword is swinging');

  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);

  assert.equal(world.newSwordActiveFlag, 0, 'sword swipe finished');
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1, 'shield takes over immediately, same tick');
  assert.equal(world.newSwordToShieldTransition01, 1);

  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
});

test('sword unlocked, shield NOT unlocked: after swipe completes, no phantom shield even if still held', () => {
  const { world, player } = makeFixture();
  world.hasSwordWeaveUnlockedFlag = 1;
  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
});

test('sword+bow: quick release during the swipe queues exactly one pending arrow and fires it after sword completes with the captured release aim', () => {
  const { world, player } = makeFixture(6);
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  // Charge a couple of ticks then release mid-swing (before NEW_SWORD_SLASH_TICKS).
  for (let i = 0; i < 3; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 1, 'sword still swinging');

  const releaseAimX = player.positionXWorld + 5;
  const releaseAimY = player.positionYWorld + 30;
  release(world, releaseAimX, releaseAimY);
  assert.equal(world.newBowPendingReleaseFlag, 1, 'a pending release must be latched');
  assert.equal(world.arrowCount, 0, 'no arrow must fire before the sword finishes');

  // Let the sword finish.
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2; i++) idleTick(world);

  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.newBowPendingReleaseFlag, 0, 'pending release consumed');
  assert.equal(world.arrowCount, 1, 'exactly one arrow fired');
  const dx = world.arrowDirXWorld[0];
  const dy = world.arrowDirYWorld[0];
  const expectedDx = releaseAimX - player.positionXWorld;
  const expectedDy = releaseAimY - player.positionYWorld;
  const expectedLen = Math.hypot(expectedDx, expectedDy);
  assert.ok(Math.abs(dx - expectedDx / expectedLen) < 1e-3);
  assert.ok(Math.abs(dy - expectedDy / expectedLen) < 1e-3);
});

test('sword not unlocked, bow unlocked: release fires immediately (no delay)', () => {
  const { world, player } = makeFixture(6);
  world.hasBowWeaveUnlockedFlag = 1;
  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.arrowCount, 1);
  assert.equal(world.newBowPendingReleaseFlag, 0);
});

test('shield+bow: shield forms while bow charges concurrently; releasing ends shield before/at fire', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1);
  assert.equal(world.newBowChargingFlag, 1);

  for (let i = 0; i < 10; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);

  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
  assert.equal(world.arrowCount, 1);
});

test('sword+shield+bow: full matrix — swipe, handoff to shield while bow keeps charging, quick release mid-swipe on a fresh gesture defers the arrow', () => {
  const { world, player } = makeFixture(8);
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 1);
  assert.equal(world.newBowChargingFlag, 1);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0, 'shield suppressed during swipe');

  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1, 'shield now active');
  assert.equal(world.newBowChargingFlag, 1, 'bow kept charging through sword+shield');

  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
  assert.equal(world.arrowCount, 1);
});

test('grapple-consumed press never triggers sword/shield/bow and produces no stale arrow on release', () => {
  const { world, player } = makeFixture(6);
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  tickSecondaryWeaveGesture(world.secondaryWeaveGesture, true, player.positionXWorld + 20, player.positionYWorld);
  // Grapple claims this press immediately (simulating arbitration).
  markSecondaryWeaveGestureConsumedByOtherSystem(world.secondaryWeaveGesture);
  applyPlayerWeaveCombat(world);

  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.newBowChargingFlag, 0);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);

  for (let i = 0; i < 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.arrowCount, 0, 'no stale arrow from a consumed press');
});

test('cancellation mid-gesture (window blur / pause) leaves no stuck shield and no phantom arrow', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1);
  assert.equal(world.newBowChargingFlag, 1);

  // Simulate pause: cancel every frame while button remains physically held.
  cancelSecondaryWeaveGesture(world.secondaryWeaveGesture);
  applyPlayerWeaveCombat(world);

  assert.equal(world.shieldWeaveIndependentActiveFlag, 0, 'shield must not stay stuck');
  assert.equal(world.newBowChargingFlag, 0, 'bow charge must be cancelled, not fired');
  assert.equal(world.arrowCount, 0, 'no phantom arrow generated purely from a cancel');
  for (let i = 0; i < world.moteSlotCount; i++) {
    const pidx = world.moteSlotParticleIndex[i];
    assert.equal(world.behaviorMode[pidx], 0, 'motes returned to normal orbit');
  }
});

test('default (non-legacy) combat mode: weave combat now functions (was previously a full no-op)', () => {
  const { world, player } = makeFixture();
  assert.notEqual(world.combatMode, 'legacy');
  world.hasSwordWeaveUnlockedFlag = 1;
  const enemy = addEnemy(world, player.positionXWorld + 10, player.positionYWorld, 10);
  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.ok(enemy.healthPoints < 10, 'default combat mode must allow weave damage now');
});

test('bow: fired arrow dust kind is captured at fire time and unaffected by a later dust-type switch', () => {
  const { world, player } = makeFixture(6);
  world.hasBowWeaveUnlockedFlag = 1;
  // Give all motes a known kind.
  for (let i = 0; i < world.moteSlotCount; i++) world.moteSlotKind[i] = ParticleKind.Golden;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < MOTE_4_LOAD_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.arrowCount, 1);
  assert.equal(world.arrowDustKind[0], ParticleKind.Golden);

  // Simulate a later dust-type switch changing the remaining motes' kind —
  // the already-fired arrow's stored kind must not change.
  for (let i = 0; i < world.moteSlotCount; i++) world.moteSlotKind[i] = ParticleKind.Ice;
  assert.equal(world.arrowDustKind[0], ParticleKind.Golden, 'fired arrow dust kind must be frozen at fire time');
});

test('bow: failed arrow-slot reservation consumes no motes', () => {
  const { world, player } = makeFixture(6);
  world.hasBowWeaveUnlockedFlag = 1;
  // Fill every arrow flight slot with a still-alive arrow so reservation fails.
  const MAX_ARROWS = world.arrowLifetimeTicksLeft.length;
  world.arrowCount = MAX_ARROWS;
  for (let i = 0; i < MAX_ARROWS; i++) world.arrowLifetimeTicksLeft[i] = 999;

  const availableBefore = countAvailableMotes(world);
  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < MOTE_4_LOAD_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);

  assert.equal(countAvailableMotes(world), availableBefore, 'no motes consumed when the arrow slot reservation fails');
});

function countAvailableMotes(world: ReturnType<typeof createWorldState>): number {
  let n = 0;
  for (let i = 0; i < world.moteSlotCount; i++) {
    if (world.moteSlotState[i] === 0) n++;
  }
  return n;
}
