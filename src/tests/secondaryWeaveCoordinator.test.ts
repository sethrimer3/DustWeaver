import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { getAvailableCanonicalMotes, MoteOwnershipState } from '../sim/weaves/moteOwnership';
import {
  tickSecondaryWeaveGesture,
  cancelSecondaryWeaveGesture,
  markSecondaryWeaveGestureConsumedByOtherSystem,
} from '../input/secondaryWeaveGesture';
import { applyPlayerWeaveCombat } from '../sim/weaves/weaveCombat';
import { NEW_SWORD_SLASH_TICKS } from '../sim/weaves/swordWeave';
import {
  BOW_ARROW_PHASE_NONE,
  BOW_ARROW_PHASE_ASSEMBLING,
  BOW_ARROW_PHASE_OUTBOUND,
  BOW_ARROW_LOAD_3_TICKS,
} from '../sim/weaves/bowArrow';
import { BEHAVIOR_MODE_BOW_ARROW } from '../sim/particles/bowArrowBehaviorMode';

function makeFixture(moteCount = 8) {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, 100, 100, 1, 20);
  player.healthPoints = moteCount;
  player.maxHealthPoints = moteCount;
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  return { world, player };
}

function addEnemy(world: ReturnType<typeof createWorldState>, x: number, y: number, hp = 10) {
  const enemy = createClusterState(1, x, y, 0, hp);
  world.clusters.push(enemy);
  return enemy;
}

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

function countArrowMotes(world: ReturnType<typeof createWorldState>): number {
  let n = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] === BEHAVIOR_MODE_BOW_ARROW) n++;
  }
  return n;
}

function countAvailableMotes(world: ReturnType<typeof createWorldState>): number {
  return getAvailableCanonicalMotes(world).count;
}

// ── Sword / shield (unchanged behavior) ──────────────────────────────────────

test('none unlocked: press/hold/release is a total no-op', () => {
  const { world } = makeFixture();
  press(world, 110, 100);
  for (let i = 0; i < 5; i++) hold(world, 110, 100);
  release(world, 110, 100);
  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
});

test('sword-only: press triggers a swipe, damages an in-arc enemy once, and clears on completion', () => {
  const { world, player } = makeFixture();
  world.hasSwordWeaveUnlockedFlag = 1;
  const enemy = addEnemy(world, player.positionXWorld + 10, player.positionYWorld, 10);

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 1);

  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);

  assert.equal(world.newSwordActiveFlag, 0, 'swipe must end');
  assert.ok(enemy.healthPoints < 10, 'enemy should have taken damage');
  const hpAfterFirstSwipe = enemy.healthPoints;

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
  hold(world, player.positionXWorld, player.positionYWorld - 50);
  assert.equal(world.newSwordAimAngleRad, aimAtPress, 'aim angle must stay fixed at press-time value');
});

test('shield-only: forms while held, releases motes on end, no crescent while nothing held', () => {
  const { world, player } = makeFixture();
  world.hasShieldWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1);
  for (let i = 0; i < player.healthPoints; i++) {
    assert.equal(world.canonicalMoteOwnership[i], MoteOwnershipState.Shield, 'motes should be in shield mode');
  }

  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
  for (let i = 0; i < player.healthPoints; i++) {
    assert.equal(world.canonicalMoteOwnership[i], MoteOwnershipState.Resting, 'motes should return to resting after release');
  }
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

// ── Bow — actual-mote arrow ──────────────────────────────────────────────────

test('bow requires shield: with shield+bow unlocked, the arrow assembles from actual motes and fires ≥3 on release', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING, 'arrow assembles from shield start');
  assert.equal(world.bowArrowCount, 1, 'only the center mote initially');

  // Advance past the 0.75s load threshold plus the seating arc so the 3
  // motes are fully SEATED (not merely reserved/mid-arc) before release.
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.ok(world.bowArrowCount >= 3, 'at least three motes loaded after 0.75s');
  assert.ok(countArrowMotes(world) >= 3, 'reserved motes are actual particles in BOW_ARROW mode');

  const availableBefore = countAvailableMotes(world);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_OUTBOUND, 'arrow fires outbound on release');
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);
  // Motes are conserved — firing does not deplete inventory slots.
  assert.equal(countAvailableMotes(world), availableBefore, 'firing does not permanently remove motes');
});

test('bow: fewer than three total motes never assembles an arrow, and the shield stays valid', () => {
  const { world, player } = makeFixture(2);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'no arrow assembles below three motes');
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1, 'shield still forms normally');
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'nothing fires');
});

test('bow: releasing before the minimum three-mote arrow forms fires nothing and returns motes to orbit', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  // Release well before the 0.75s threshold: only the center mote exists.
  for (let i = 0; i < 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowCount, 1);
  release(world, player.positionXWorld + 20, player.positionYWorld);

  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'no partial arrow fired');
  assert.equal(countArrowMotes(world), 0, 'reserved center mote returned to orbit, none stranded');
});

test('bow: fired arrow dust kind is captured at fire time and unaffected by a later dust-type switch', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;
  world.selectedDustKind = ParticleKind.Golden;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  // Hold past the 0.75s threshold plus the seating arc so the 3 motes are
  // fully SEATED (fires synchronously on release, not merely latched).
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowDustKind, ParticleKind.Golden);

  world.selectedDustKind = ParticleKind.Ice;
  assert.equal(world.bowArrowDustKind, ParticleKind.Golden, 'fired arrow dust kind must be frozen at fire time');
});

test('grapple-consumed press never triggers sword/shield/bow and produces no stale arrow on release', () => {
  const { world, player } = makeFixture(6);
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  tickSecondaryWeaveGesture(world.secondaryWeaveGesture, true, player.positionXWorld + 20, player.positionYWorld);
  markSecondaryWeaveGestureConsumedByOtherSystem(world.secondaryWeaveGesture);
  applyPlayerWeaveCombat(world);

  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 0);

  for (let i = 0; i < 5; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  release(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'no stale arrow from a consumed press');
});

test('cancellation mid-gesture (window blur / pause) leaves no stuck shield and no phantom arrow', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 2; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING);

  cancelSecondaryWeaveGesture(world.secondaryWeaveGesture);
  applyPlayerWeaveCombat(world);

  assert.equal(world.shieldWeaveIndependentActiveFlag, 0, 'shield must not stay stuck');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'assembling arrow must be cancelled, not fired');
  assert.equal(countArrowMotes(world), 0, 'no motes stranded in arrow mode');
  for (let i = 0; i < player.healthPoints; i++) {
    assert.equal(world.canonicalMoteOwnership[i], MoteOwnershipState.Resting, 'motes returned to normal resting state');
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

// ── Sword→shield handoff mote-identity continuity (unchanged) ────────────────

test('sword-to-shield handoff: the exact motes that formed the swipe are the exact motes that form the shield, no gap and no double-render frame', () => {
  const { world, player } = makeFixture(6);
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasShieldWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 1);

  for (let i = 0; i < NEW_SWORD_SLASH_TICKS - 1; i++) {
    hold(world, player.positionXWorld + 20, player.positionYWorld);
    const shieldFormedThisFrame = world.shieldWeaveIndependentActiveFlag === 1;
    assert.ok(!(world.newSwordActiveFlag === 1 && shieldFormedThisFrame), 'sword and shield must never both be fully active the same frame');
  }

  hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.newSwordActiveFlag, 0, 'sword swipe finished');
  assert.equal(world.shieldWeaveIndependentActiveFlag, 1, 'shield active same tick as handoff — no gap frame');

  let assignedToShieldCount = 0;
  for (let i = 0; i < player.healthPoints; i++) {
    if (world.canonicalMoteOwnership[i] === MoteOwnershipState.Shield) assignedToShieldCount++;
  }
  assert.ok(assignedToShieldCount > 0, 'shield must not form with zero assigned motes during handoff');
});

// ── Shield cleanup preserves particles owned by other modes (unchanged) ──────

test('end shield ownership only resets shield-owned motes, leaving other-mode motes untouched', () => {
  const { world, player } = makeFixture(6);
  world.hasShieldWeaveUnlockedFlag = 1;

  world.canonicalMoteOwnership[0] = MoteOwnershipState.Shield;
  world.canonicalMoteOwnership[1] = MoteOwnershipState.Shield;
  world.canonicalMoteOwnership[2] = MoteOwnershipState.BowAssembling;
  world.shieldWeaveIndependentActiveFlag = 1;

  release(world, player.positionXWorld, player.positionYWorld);
  assert.equal(world.canonicalMoteOwnership[0], MoteOwnershipState.Resting, 'shield motes released to resting');
  assert.equal(world.canonicalMoteOwnership[1], MoteOwnershipState.Resting, 'shield motes released to resting');
  assert.equal(world.canonicalMoteOwnership[2], MoteOwnershipState.BowAssembling, 'other ability motes untouched');
});

// ── Default combat mode executes exactly one ability path (unchanged) ────────

test('default combat mode applies sword damage exactly once per hit, and the legacy path never fires', () => {
  const { world, player } = makeFixture();
  assert.notEqual(world.combatMode, 'legacy');
  world.hasSwordWeaveUnlockedFlag = 1;
  const enemy = addEnemy(world, player.positionXWorld + 10, player.positionYWorld, 20);

  press(world, player.positionXWorld + 20, player.positionYWorld);
  const hpTrace: number[] = [enemy.healthPoints];
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2; i++) {
    hold(world, player.positionXWorld + 20, player.positionYWorld);
    hpTrace.push(enemy.healthPoints);
  }

  let dropCount = 0;
  for (let i = 1; i < hpTrace.length; i++) {
    if (hpTrace[i] < hpTrace[i - 1]) dropCount++;
  }
  assert.equal(dropCount, 1, 'damage must be applied exactly once for this single swipe');

  assert.equal(world.isPlayerSecondaryWeaveActiveFlag, 0, 'legacy secondary-weave-active flag must never be touched by the default-mode coordinator path');
});

// ── Cancellation aborts an assembling arrow before it can fire ───────────────

test('cancellation while the button is still held mid-assembly aborts the arrow before any fire', () => {
  const { world, player } = makeFixture(6);
  world.hasSwordWeaveUnlockedFlag = 1;
  world.hasShieldWeaveUnlockedFlag = 1;
  world.hasBowWeaveUnlockedFlag = 1;

  press(world, player.positionXWorld + 20, player.positionYWorld);
  // Let the sword finish and the shield/arrow start assembling.
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + BOW_ARROW_LOAD_3_TICKS; i++) hold(world, player.positionXWorld + 20, player.positionYWorld);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING, 'arrow assembling');

  cancelSecondaryWeaveGesture(world.secondaryWeaveGesture);
  applyPlayerWeaveCombat(world);

  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'arrow assembly must be cancelled, not left assembling');
  assert.equal(countArrowMotes(world), 0, 'no motes stranded in arrow mode');

  release(world, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 5; i++) idleTick(world);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'no arrow must fire purely from a cancelled assembly');
});

test('global bow behavior regression test: WEAVE_ARROW equipped in legacy combat mode operates via actual follower motes in Stage 3 coordinator', () => {
  const { world, player } = makeFixture(6);
  world.combatMode = 'legacy';
  world.playerSecondaryWeaveId = 'arrow';
  world.canUsePlayerSecondaryWeaveFlag = 1;

  press(world, player.positionXWorld + 50, player.positionYWorld);
  // Hold enough ticks to form shield crescent and assemble arrow
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + BOW_ARROW_LOAD_3_TICKS + 5; i++) {
    hold(world, player.positionXWorld + 50, player.positionYWorld);
  }

  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING, 'actual-mote arrow assembling in legacy mode');
  assert.ok(world.bowArrowCount >= 3, 'at least 3 actual motes loaded');
  assert.equal(world.isPlayerSecondaryWeaveActiveFlag, 0, 'obsolete legacy arrow active flag must remain 0');

  // Verify that actual particle indices are in BEHAVIOR_MODE_BOW_ARROW
  let bowMoteCount = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] === BEHAVIOR_MODE_BOW_ARROW) bowMoteCount++;
  }
  assert.ok(bowMoteCount >= 3, 'actual particles are reserved in BOW_ARROW behavior mode in legacy combat mode');
});
