import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import { DustSelectionWheelController, DUST_WHEEL_OPEN_ANIM_MS, DUST_WHEEL_CLOSE_ANIM_MS } from '../screens/gameDustSelectionState';
import { isDustWheelSuppressedCommandKind } from '../screens/gameCommandProcessor';
import { CommandKind } from '../input/commands';
import { createDefaultProgress, sanitizePlayerDustProgress } from '../progression/playerProgress';
import { loadSaveSlot, saveSaveSlot, createNewSaveSlot } from '../progression/saveSlots';
import { isDustTypeSwitchInProgress } from '../sim/weaves/dustTypeSwitch';

function makeFixture(moteCount = 4) {
  const world = createWorldState(1000 / 60, 3);
  const player = createClusterState(0, 50, 50, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Golden, ParticleKind.Ice, ParticleKind.Void];
  progress.selectedDustKind = ParticleKind.Golden;
  return { world, player, progress };
}

test('the wheel captures grapple-fire for selection and never lets grapple/weave commands leak through', () => {
  // GrappleFire itself is intercepted for selection (handled specially, not dropped).
  assert.equal(isDustWheelSuppressedCommandKind(CommandKind.GrappleFire), false);

  const mustBeSuppressed = [
    CommandKind.GrappleRelease,
    CommandKind.GrappleZip,
    CommandKind.WeaveActivatePrimary,
    CommandKind.WeaveHoldPrimary,
    CommandKind.WeaveEndPrimary,
    CommandKind.WeaveActivateSecondary,
    CommandKind.WeaveHoldSecondary,
    CommandKind.WeaveEndSecondary,
    CommandKind.ShieldWeaveHold,
    CommandKind.ShieldWeaveEnd,
    CommandKind.Attack,
    CommandKind.BlockStart,
    CommandKind.BlockUpdate,
    CommandKind.BlockEnd,
  ];
  for (const kind of mustBeSuppressed) {
    assert.equal(isDustWheelSuppressedCommandKind(kind), true, `CommandKind ${kind} must be suppressed while the wheel is open`);
  }

  // Movement/jump/menu commands are unaffected.
  assert.equal(isDustWheelSuppressedCommandKind(CommandKind.MovePlayer), false);
  assert.equal(isDustWheelSuppressedCommandKind(CommandKind.Jump), false);
  assert.equal(isDustWheelSuppressedCommandKind(CommandKind.Interact), false);
});

test('aiming inside the dead zone is consumed but selects nothing and keeps the wheel open', () => {
  const { world, player, progress } = makeFixture();
  const wheel = new DustSelectionWheelController();
  wheel.open(progress, 0);
  wheel.tick(DUST_WHEEL_OPEN_ANIM_MS);
  assert.equal(wheel.isOpen(), true);

  const result = wheel.selectAtAim(world, progress, player.positionXWorld + 0.5, player.positionYWorld, player.positionXWorld, player.positionYWorld, 100);
  assert.equal(result, 'deadzone');
  assert.equal(wheel.isOpen(), true);
  assert.equal(progress.selectedDustKind, ParticleKind.Golden, 'unchanged');
});

test('selecting the currently active dust is a safe no-op that closes the wheel', () => {
  const { world, player, progress } = makeFixture();
  const wheel = new DustSelectionWheelController();
  wheel.open(progress, 0);
  wheel.tick(DUST_WHEEL_OPEN_ANIM_MS);

  // Golden is the first canonical option, placed straight up (angle -PI/2).
  const aimX = player.positionXWorld;
  const aimY = player.positionYWorld - 50;
  const result = wheel.selectAtAim(world, progress, aimX, aimY, player.positionXWorld, player.positionYWorld, 100);

  assert.equal(result, 'same');
  assert.equal(progress.selectedDustKind, ParticleKind.Golden);
  assert.equal(isDustTypeSwitchInProgress(world), false, 'no transformation should start');
  assert.equal(wheel.isOpen(), false, 'the wheel closes even though nothing changed');
});

test('selecting a different dust persists it and begins the mote transformation', () => {
  const { world, player, progress } = makeFixture();
  const wheel = new DustSelectionWheelController();
  wheel.open(progress, 0);
  wheel.tick(DUST_WHEEL_OPEN_ANIM_MS);

  // Void is the third canonical option among [Golden, Ice, Void] (index 2 of 3),
  // placed at -PI/2 + 2*(2PI/3).
  const angle = -Math.PI / 2 + 2 * (Math.PI * 2 / 3);
  const aimX = player.positionXWorld + Math.cos(angle) * 50;
  const aimY = player.positionYWorld + Math.sin(angle) * 50;
  const result = wheel.selectAtAim(world, progress, aimX, aimY, player.positionXWorld, player.positionYWorld, 100);

  assert.equal(result, 'switched');
  assert.equal(progress.selectedDustKind, ParticleKind.Void, 'persisted immediately');
  assert.equal(isDustTypeSwitchInProgress(world), true, 'live motes begin animating');
  assert.equal(wheel.isOpen(), false);
});

test('the wheel animation lifecycle opens, stays open, and fully closes on schedule', () => {
  const wheel = new DustSelectionWheelController();
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Golden, ParticleKind.Ice];

  wheel.open(progress, 0);
  assert.equal(wheel.isOpen(), true);
  assert.equal(wheel.isFullyClosed(), false);
  assert.ok(wheel.getExpansion01(0) < 1);

  wheel.tick(DUST_WHEEL_OPEN_ANIM_MS);
  assert.equal(wheel.getExpansion01(DUST_WHEEL_OPEN_ANIM_MS), 1);

  wheel.cancel(DUST_WHEEL_OPEN_ANIM_MS);
  assert.equal(wheel.isOpen(), false, 'closing is no longer "open" for input-capture purposes');
  assert.equal(wheel.isFullyClosed(), false, 'still animating out');

  wheel.tick(DUST_WHEEL_OPEN_ANIM_MS + DUST_WHEEL_CLOSE_ANIM_MS);
  assert.equal(wheel.isFullyClosed(), true);
  assert.equal(wheel.getExpansion01(DUST_WHEEL_OPEN_ANIM_MS + DUST_WHEEL_CLOSE_ANIM_MS), 0);
});

test('the input-capture latch keeps grapple/weave input suppressed until the button returns to neutral', () => {
  const { world, player, progress } = makeFixture();
  const wheel = new DustSelectionWheelController();
  wheel.open(progress, 0);
  wheel.tick(DUST_WHEEL_OPEN_ANIM_MS);

  const angle = -Math.PI / 2 + (2 * Math.PI / 3); // Ice, the second of [Golden, Ice, Void]
  const aimX = player.positionXWorld + Math.cos(angle) * 50;
  const aimY = player.positionYWorld + Math.sin(angle) * 50;
  wheel.selectAtAim(world, progress, aimX, aimY, player.positionXWorld, player.positionYWorld, 100);

  assert.equal(wheel.isOpen(), false, 'wheel has closed');
  assert.equal(wheel.shouldCaptureGrappleWeaveInput(), true, 'latch still active while the button that selected is held');

  // Button still held — latch must not clear.
  wheel.updateInputCaptureLatch(true, false);
  assert.equal(wheel.shouldCaptureGrappleWeaveInput(), true);

  // Button released — latch clears and normal grapple/weave input resumes.
  wheel.updateInputCaptureLatch(false, false);
  assert.equal(wheel.shouldCaptureGrappleWeaveInput(), false);
});

test('cancel() is safe to call repeatedly (death/blur/modal/teardown all just cancel)', () => {
  const wheel = new DustSelectionWheelController();
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Golden, ParticleKind.Ice];
  wheel.open(progress, 0);
  wheel.cancel(10);
  wheel.cancel(20); // already closing — must not restart the animation or throw
  wheel.cancel(30);
  assert.equal(wheel.isOpen(), false);
});

// ── Persistence / migration ─────────────────────────────────────────────────

test('selectedDustKind falls back deterministically when invalid or unlocked list changes', () => {
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = [ParticleKind.Ice, ParticleKind.Void];
  progress.selectedDustKind = ParticleKind.Golden; // stale / no longer unlocked
  sanitizePlayerDustProgress(progress);
  assert.equal(progress.selectedDustKind, ParticleKind.Ice, 'falls back to first unlocked in canonical order');

  const empty = createDefaultProgress();
  empty.selectedDustKind = ParticleKind.Golden;
  sanitizePlayerDustProgress(empty);
  assert.equal(empty.selectedDustKind, null, 'no unlocked dust kinds — valid empty state preserved');
});

test('an existing save without selectedDustKind migrates safely on load', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });

  const slotIndex = 2;
  const fresh = createNewSaveSlot();
  fresh.progress.unlockedDustKinds = [ParticleKind.Nature];
  // Simulate a pre-existing save serialized before this field existed.
  const legacyProgress = { ...fresh.progress } as Partial<typeof fresh.progress>;
  delete legacyProgress.selectedDustKind;
  saveSaveSlot(slotIndex, { ...fresh, progress: legacyProgress as typeof fresh.progress });

  const loaded = loadSaveSlot(slotIndex);
  assert.ok(loaded !== null);
  assert.equal(loaded!.progress.selectedDustKind, ParticleKind.Nature, 'migrates to the sole unlocked kind');
});
