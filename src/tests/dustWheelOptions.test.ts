import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDustWheelOptions,
  isDustWheelEligible,
  getUnlockedDustKindsInCanonicalOrder,
  findNearestDustWheelOption,
  resolveEffectiveSelectedDustKind,
  DUST_WHEEL_START_ANGLE_RAD,
} from '../sim/weaves/dustWheelOptions';
import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import { createDefaultProgress } from '../progression/playerProgress';

function progressWithUnlocked(kinds: ParticleKind[]): ReturnType<typeof createDefaultProgress> {
  const progress = createDefaultProgress();
  progress.unlockedDustKinds = kinds;
  return progress;
}

test('unlock order never affects wheel order — canonical order wins', () => {
  const progressA = progressWithUnlocked([ParticleKind.Light, ParticleKind.Golden, ParticleKind.Void]);
  const progressB = progressWithUnlocked([ParticleKind.Void, ParticleKind.Golden, ParticleKind.Light]);

  const optionsA = buildDustWheelOptions(progressA).map(o => o.kind);
  const optionsB = buildDustWheelOptions(progressB).map(o => o.kind);

  const expected = EQUIPPABLE_KINDS.filter(k =>
    k === ParticleKind.Golden || k === ParticleKind.Void || k === ParticleKind.Light);
  assert.deepEqual(optionsA, expected);
  assert.deepEqual(optionsB, expected);
});

test('duplicate and invalid unlock entries are removed', () => {
  const progress = progressWithUnlocked([
    ParticleKind.Golden, ParticleKind.Golden, ParticleKind.Ice,
    999 as ParticleKind, ParticleKind.Ice,
  ]);
  const ordered = getUnlockedDustKindsInCanonicalOrder(progress);
  assert.deepEqual(ordered, [ParticleKind.Golden, ParticleKind.Ice]);
});

test('the wheel never opens with zero or one available type', () => {
  assert.equal(isDustWheelEligible(progressWithUnlocked([])), false);
  assert.equal(isDustWheelEligible(progressWithUnlocked([ParticleKind.Golden])), false);
  assert.deepEqual(buildDustWheelOptions(progressWithUnlocked([ParticleKind.Golden])), []);
  assert.equal(isDustWheelEligible(progressWithUnlocked([ParticleKind.Golden, ParticleKind.Void])), true);
});

test('options are equally spaced for 2, 3, 4, and 5 unlocked kinds', () => {
  const allFive = [...EQUIPPABLE_KINDS];
  for (let n = 2; n <= 5; n++) {
    const kinds = allFive.slice(0, n);
    const options = buildDustWheelOptions(progressWithUnlocked(kinds));
    assert.equal(options.length, n);
    const step = (Math.PI * 2) / n;
    // First canonical option starts at the top.
    assert.ok(Math.abs(options[0].angleRad - DUST_WHEEL_START_ANGLE_RAD) < 1e-9);
    for (let i = 1; i < n; i++) {
      let delta = options[i].angleRad - options[i - 1].angleRad;
      if (delta < 0) delta += Math.PI * 2;
      assert.ok(Math.abs(delta - step) < 1e-9, `spacing mismatch at index ${i} for n=${n}`);
    }
  }
});

test('nearest-option selection works across the -pi/pi wraparound boundary', () => {
  // Two options straddling the wraparound seam: one just before +PI, one just after -PI.
  const options = [
    { kind: ParticleKind.Golden, angleRad: Math.PI - 0.05 },
    { kind: ParticleKind.Ice, angleRad: -Math.PI + 0.05 },
  ];
  // Aim right at the seam (PI) should pick whichever option is angularly closest —
  // both are 0.05 away, but the function must not treat them as ~2*PI apart.
  const nearest = findNearestDustWheelOption(options, Math.PI);
  assert.ok(nearest !== null);
  const dist = Math.min(
    Math.abs(nearest!.angleRad - Math.PI),
    Math.abs((nearest!.angleRad - Math.PI + Math.PI * 3) % (Math.PI * 2) - Math.PI),
  );
  assert.ok(dist <= 0.05 + 1e-9);
});

test('resolveEffectiveSelectedDustKind falls back deterministically when invalid', () => {
  const progress = progressWithUnlocked([ParticleKind.Ice, ParticleKind.Void]);
  progress.selectedDustKind = ParticleKind.Golden; // not unlocked
  assert.equal(resolveEffectiveSelectedDustKind(progress), ParticleKind.Ice);

  progress.selectedDustKind = ParticleKind.Void;
  assert.equal(resolveEffectiveSelectedDustKind(progress), ParticleKind.Void);

  const empty = progressWithUnlocked([]);
  assert.equal(resolveEffectiveSelectedDustKind(empty), null);
});
