/**
 * Dust Selection Wheel — option ordering and angular geometry.
 *
 * The wheel's option list must be deterministic regardless of the order in
 * which dust types were unlocked or stored in a save (progress.unlockedDustKinds
 * is unlock-ordered, not display-ordered). This module derives the wheel's
 * option list purely from the canonical EQUIPPABLE_KINDS order, filtered down
 * to whatever the player has actually unlocked.
 */

import { ParticleKind, EQUIPPABLE_KINDS, isEquippableParticleKind } from '../particles/kinds';

/** Minimum number of unlocked dust types required for the wheel to be usable. */
export const DUST_WHEEL_MIN_OPTION_COUNT = 2;

/** Starting angle (radians) for the first canonical option — straight up. */
export const DUST_WHEEL_START_ANGLE_RAD = -Math.PI / 2;

export interface DustWheelOption {
  kind: ParticleKind;
  /** Angle (radians) of this option's position on the wheel, in [-PI, PI]. */
  angleRad: number;
}

interface DustWheelEligibilityGate {
  unlockedDustKinds: readonly ParticleKind[];
  isDevModeDustUnlocked?: boolean;
}

/**
 * Returns the player's unlocked dust kinds in canonical display order,
 * de-duplicated and filtered to valid equippable kinds. Never trusts the
 * raw order or contents of `unlockedDustKinds` directly.
 */
export function getUnlockedDustKindsInCanonicalOrder(
  progress: DustWheelEligibilityGate | undefined,
): ParticleKind[] {
  if (progress === undefined) return [];
  if (progress.isDevModeDustUnlocked === true) return [...EQUIPPABLE_KINDS];

  const unlockedSet = new Set<ParticleKind>();
  for (const kind of progress.unlockedDustKinds) {
    if (isEquippableParticleKind(kind)) unlockedSet.add(kind);
  }

  const ordered: ParticleKind[] = [];
  for (const kind of EQUIPPABLE_KINDS) {
    if (unlockedSet.has(kind)) ordered.push(kind);
  }
  return ordered;
}

/** Normalizes an angle to (-PI, PI]. */
function normalizeAngleRad(angleRad: number): number {
  let a = angleRad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Builds the deterministic wheel option list (canonical order, equal angular
 * spacing) from the player's unlocked dust kinds. Returns an empty array when
 * fewer than `DUST_WHEEL_MIN_OPTION_COUNT` kinds are unlocked — callers should
 * check `isDustWheelEligible` before opening the wheel.
 */
export function buildDustWheelOptions(
  progress: DustWheelEligibilityGate | undefined,
): DustWheelOption[] {
  const ordered = getUnlockedDustKindsInCanonicalOrder(progress);
  const n = ordered.length;
  if (n < DUST_WHEEL_MIN_OPTION_COUNT) return [];

  const step = (Math.PI * 2) / n;
  return ordered.map((kind, index) => ({
    kind,
    angleRad: normalizeAngleRad(DUST_WHEEL_START_ANGLE_RAD + index * step),
  }));
}

/** True when the player currently has enough unlocked dust kinds to open the wheel. */
export function isDustWheelEligible(progress: DustWheelEligibilityGate | undefined): boolean {
  return getUnlockedDustKindsInCanonicalOrder(progress).length >= DUST_WHEEL_MIN_OPTION_COUNT;
}

interface SelectedDustKindGate extends DustWheelEligibilityGate {
  selectedDustKind: ParticleKind | null;
}

/**
 * Resolves the dust kind that ordinary player motes should spawn/use right now:
 * the persisted `selectedDustKind` if it is still unlocked and equippable,
 * otherwise the first unlocked kind in canonical order, otherwise `null` when
 * the player has nothing unlocked at all.
 */
export function resolveEffectiveSelectedDustKind(
  progress: SelectedDustKindGate | undefined,
): ParticleKind | null {
  if (progress === undefined) return null;
  const canonicalUnlocked = getUnlockedDustKindsInCanonicalOrder(progress);
  if (progress.selectedDustKind !== null
      && isEquippableParticleKind(progress.selectedDustKind)
      && (progress.isDevModeDustUnlocked === true || canonicalUnlocked.includes(progress.selectedDustKind))) {
    return progress.selectedDustKind;
  }
  return canonicalUnlocked.length > 0 ? canonicalUnlocked[0] : null;
}

/**
 * Shortest signed angular distance from `a` to `b`, in (-PI, PI].
 * Positive means `b` is clockwise (in increasing-angle direction) from `a`.
 */
export function angularDeltaRad(fromRad: number, toRad: number): number {
  return normalizeAngleRad(toRad - fromRad);
}

/** Shortest unsigned angular distance between two angles, in [0, PI]. */
export function angularDistanceRad(aRad: number, bRad: number): number {
  return Math.abs(angularDeltaRad(aRad, bRad));
}

/**
 * Finds the option whose angle is angularly nearest to `aimAngleRad`.
 * Returns null when `options` is empty. Correctly handles wraparound across
 * the -PI/PI boundary since comparisons use `angularDistanceRad`.
 */
export function findNearestDustWheelOption(
  options: readonly DustWheelOption[],
  aimAngleRad: number,
): DustWheelOption | null {
  if (options.length === 0) return null;
  let best = options[0];
  let bestDist = angularDistanceRad(aimAngleRad, best.angleRad);
  for (let i = 1; i < options.length; i++) {
    const dist = angularDistanceRad(aimAngleRad, options[i].angleRad);
    if (dist < bestDist) {
      best = options[i];
      bestDist = dist;
    }
  }
  return best;
}
