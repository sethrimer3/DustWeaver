import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { nextFloat } from '../rng';
import {
  CW_CONTACT_DAMAGE,
  CW_CONTACT_IFRAMES,
  CW_DEBUG_FORCE_NONE,
  CW_FIREBALL_DURATION_TICKS,
  CW_FIREBALL_SPREAD_RADIANS,
  CW_FIREBALL_TELEGRAPH_TICKS,
  CW_FIREBALL_WIDE_SPREAD_RADIANS,
  CW_INITIAL_COOLDOWN_TICKS,
  CW_IDLE_DRIFT_STRENGTH_X,
  CW_IDLE_DRIFT_STRENGTH_Y,
  CW_METEOR_DURATION_TICKS,
  CW_METEOR_SIZE_WORLD,
  CW_METEOR_TELEGRAPH_TICKS,
  CW_MOVE_ACCEL,
  CW_MOVE_DAMPING,
  CW_MOVE_MAX_SPEED,
  CW_MAX_REPEAT_ATTACKS,
  CW_PHASE_1,
  CW_PHASE_2,
  CW_PHASE_2_HEALTH_RATIO,
  CW_PHASE_3,
  CW_PHASE_3_HEALTH_RATIO,
  CW_PILLAR_COUNT,
  CW_PILLAR_DURATION_TICKS,
  CW_PILLAR_EMIT_INTERVAL_TICKS,
  CW_PILLAR_HALF_WIDTH_WORLD,
  CW_PILLAR_SAFE_GAP_WORLD,
  CW_PILLAR_SPACING_WORLD,
  CW_PILLAR_TELEGRAPH_TICKS,
  CW_PREFERRED_DISTANCE,
  CW_ROOM_MARGIN,
  CW_STATE_FIRE_BALLS,
  CW_STATE_FIRE_PILLARS,
  CW_STATE_GROUND_FIRE_BALLS,
  CW_STATE_IDLE,
  CW_STATE_METEORS,
  CW_STATE_RECOVER,
  CW_STATE_TIDAL_WAVE,
  CW_GROUND_FIREBALL_COUNT,
  CW_GROUND_FIREBALL_INTERVAL_TICKS,
  CW_TELEGRAPH_KIND_CHARGE,
  CW_TELEGRAPH_KIND_METEOR,
  CW_TELEGRAPH_KIND_PILLAR,
  CW_TIDAL_WAVE_LIFETIME_MIN_TICKS,
  CW_TIDAL_WAVE_LIFETIME_VARIANCE_TICKS,
  CW_TIDAL_WAVE_SPACING_WORLD,
  CW_TIDAL_WAVE_SPEED_MIN,
  CW_TIDAL_WAVE_SPEED_VARIANCE,
  CW_TIDAL_WAVE_TELEGRAPH_TICKS,
  CW_TOO_CLOSE_DISTANCE,
  CW_WALL_AVOID_DISTANCE,
  MAX_CW_METEOR_SCHEDULE,
} from './crimsonWizardConfig';
import { ClusterState } from './state';
import { spawnCrimsonFireDust, spawnCrimsonFireball, spawnCrimsonMeteor, spawnCrimsonTelegraph } from './crimsonWizardEffects';
import { isCrimsonWizardGroundCastDone, isCrimsonWizardGroundCasting } from './crimsonWizardAnimation';

export type CrimsonWizardPhase = typeof CW_PHASE_1 | typeof CW_PHASE_2 | typeof CW_PHASE_3;

export interface CrimsonWizardPhaseTuning {
  phase: CrimsonWizardPhase;
  attackCooldownTicks: number;
  recoverTicks: number;
  attackMoveScale: number;
  fireballCount: number;
  fireballIntervalTicks: number;
  fireballSpreadRadians: number;
  pillarCount: number;
  pillarParticlesPerBurst: number;
  meteorCount: number;
  meteorIntervalTicks: number;
  tidalDurationTicks: number;
  tidalParticlesPerEmit: number;
  tidalEmitIntervalTicks: number;
  tidalSpeedMultiplier: number;
}

export interface CrimsonWizardDebugState {
  forceNextAttackState: number;
}

export const crimsonWizardDebug: CrimsonWizardDebugState = {
  forceNextAttackState: CW_DEBUG_FORCE_NONE,
};

declare global {
  // Console tuning hook: set __dwCrimsonWizardDebug.forceNextAttackState to a CW_STATE_* value.
  var __dwCrimsonWizardDebug: CrimsonWizardDebugState | undefined;
}

globalThis.__dwCrimsonWizardDebug = crimsonWizardDebug;

const PHASE_TUNING: readonly CrimsonWizardPhaseTuning[] = [
  {
    phase: CW_PHASE_1,
    attackCooldownTicks: 54,
    recoverTicks: 50,
    attackMoveScale: 0.62,
    fireballCount: 1,
    fireballIntervalTicks: 20,
    fireballSpreadRadians: 0,
    pillarCount: 4,
    pillarParticlesPerBurst: 22,
    meteorCount: 1,
    meteorIntervalTicks: 34,
    tidalDurationTicks: 78,
    tidalParticlesPerEmit: 10,
    tidalEmitIntervalTicks: 6,
    tidalSpeedMultiplier: 0.9,
  },
  {
    phase: CW_PHASE_2,
    attackCooldownTicks: 42,
    recoverTicks: 42,
    attackMoveScale: 0.72,
    fireballCount: 3,
    fireballIntervalTicks: 17,
    fireballSpreadRadians: CW_FIREBALL_SPREAD_RADIANS,
    pillarCount: 5,
    pillarParticlesPerBurst: 26,
    meteorCount: 2,
    meteorIntervalTicks: 27,
    tidalDurationTicks: 92,
    tidalParticlesPerEmit: 13,
    tidalEmitIntervalTicks: 5,
    tidalSpeedMultiplier: 1,
  },
  {
    phase: CW_PHASE_3,
    attackCooldownTicks: 30,
    recoverTicks: 32,
    attackMoveScale: 0.78,
    fireballCount: 4,
    fireballIntervalTicks: 14,
    fireballSpreadRadians: CW_FIREBALL_WIDE_SPREAD_RADIANS,
    pillarCount: 6,
    pillarParticlesPerBurst: 28,
    meteorCount: 3,
    meteorIntervalTicks: 22,
    tidalDurationTicks: 104,
    tidalParticlesPerEmit: 14,
    tidalEmitIntervalTicks: 5,
    tidalSpeedMultiplier: 1.08,
  },
] as const;

const PHASE_ATTACK_WEIGHTS: Readonly<Record<CrimsonWizardPhase, Readonly<Record<number, number>>>> = {
  [CW_PHASE_1]: {
    [CW_STATE_FIRE_BALLS]: 36,
    [CW_STATE_GROUND_FIRE_BALLS]: 20,
    [CW_STATE_FIRE_PILLARS]: 26,
    [CW_STATE_TIDAL_WAVE]: 12,
    [CW_STATE_METEORS]: 6,
  },
  [CW_PHASE_2]: {
    [CW_STATE_FIRE_BALLS]: 24,
    [CW_STATE_GROUND_FIRE_BALLS]: 18,
    [CW_STATE_FIRE_PILLARS]: 24,
    [CW_STATE_METEORS]: 20,
    [CW_STATE_TIDAL_WAVE]: 14,
  },
  [CW_PHASE_3]: {
    [CW_STATE_FIRE_BALLS]: 20,
    [CW_STATE_GROUND_FIRE_BALLS]: 16,
    [CW_STATE_FIRE_PILLARS]: 24,
    [CW_STATE_METEORS]: 24,
    [CW_STATE_TIDAL_WAVE]: 16,
  },
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function randSigned(world: WorldState): number {
  return nextFloat(world.rng) * 2 - 1;
}

function setState(cluster: ClusterState, state: number): void {
  cluster.crimsonWizardState = state;
  cluster.crimsonWizardStateTicks = 0;
  cluster.crimsonWizardTelegraphTicks = 0;
  if (state !== CW_STATE_METEORS) {
    cluster.crimsonWizardMeteorCount = 0;
    cluster.crimsonWizardMeteorSpawnedFlag.fill(0);
  }
}

function playableBounds(world: WorldState, boss: ClusterState): { minX: number; maxX: number; minY: number; maxY: number } {
  const minX = CW_ROOM_MARGIN + boss.halfWidthWorld;
  const maxX = Math.max(minX, world.worldWidthWorld - CW_ROOM_MARGIN - boss.halfWidthWorld);
  const minY = CW_ROOM_MARGIN + boss.halfHeightWorld;
  const maxY = Math.max(minY, world.worldHeightWorld - CW_ROOM_MARGIN - boss.halfHeightWorld);
  return { minX, maxX, minY, maxY };
}

export function getCrimsonWizardPhase(healthPoints: number, maxHealthPoints: number): CrimsonWizardPhase {
  const ratio = maxHealthPoints > 0 ? healthPoints / maxHealthPoints : 1;
  if (ratio <= CW_PHASE_3_HEALTH_RATIO) return CW_PHASE_3;
  if (ratio <= CW_PHASE_2_HEALTH_RATIO) return CW_PHASE_2;
  return CW_PHASE_1;
}

export function getCrimsonWizardPhaseTuning(phase: CrimsonWizardPhase): CrimsonWizardPhaseTuning {
  return PHASE_TUNING[phase - 1] ?? PHASE_TUNING[0];
}

function activeProjectileCount(world: WorldState): number {
  let count = 0;
  for (let i = 0; i < world.cwProjectileAliveFlag.length; i++) {
    if (world.cwProjectileAliveFlag[i] === 1) count += 1;
  }
  return count;
}

export function isCrimsonWizardAttackValid(world: WorldState, attackState: number, phase: CrimsonWizardPhase): boolean {
  if (attackState === CW_STATE_METEORS && phase === CW_PHASE_1) return world.worldHeightWorld >= 96;
  if (attackState === CW_STATE_FIRE_PILLARS) return world.worldWidthWorld >= CW_PILLAR_SAFE_GAP_WORLD + CW_ROOM_MARGIN * 2;
  if (attackState === CW_STATE_TIDAL_WAVE) return world.worldWidthWorld >= 96;
  if (attackState === CW_STATE_METEORS) return world.worldHeightWorld >= 88 && activeProjectileCount(world) < 6;
  if (attackState === CW_STATE_FIRE_BALLS) return activeProjectileCount(world) < 10;
  if (attackState === CW_STATE_GROUND_FIRE_BALLS) return activeProjectileCount(world) < 10;
  return true;
}

export function selectCrimsonWizardAttack(world: WorldState, boss: ClusterState, phase: CrimsonWizardPhase): number {
  if (crimsonWizardDebug.forceNextAttackState !== CW_DEBUG_FORCE_NONE) {
    const forced = crimsonWizardDebug.forceNextAttackState;
    crimsonWizardDebug.forceNextAttackState = CW_DEBUG_FORCE_NONE;
    if (isCrimsonWizardAttackValid(world, forced, phase)) return forced;
  }

  const weights = PHASE_ATTACK_WEIGHTS[phase];
  const candidates = [
    CW_STATE_FIRE_BALLS,
    CW_STATE_GROUND_FIRE_BALLS,
    CW_STATE_FIRE_PILLARS,
    CW_STATE_METEORS,
    CW_STATE_TIDAL_WAVE,
  ];
  let total = 0;
  const weighted: Array<{ state: number; weight: number }> = [];
  for (const state of candidates) {
    if (!isCrimsonWizardAttackValid(world, state, phase)) continue;
    let weight = weights[state] ?? 0;
    if (weight <= 0) continue;
    if (state === boss.crimsonWizardLastAttackState && boss.crimsonWizardRepeatCount >= CW_MAX_REPEAT_ATTACKS) weight = 0;
    if (weight <= 0) continue;
    total += weight;
    weighted.push({ state, weight });
  }
  if (weighted.length === 0) return CW_STATE_FIRE_BALLS;

  const salt = nextFloat(world.rng) + (boss.crimsonWizardNextAttackIndex % 7) * 0.03125;
  let pick = (salt - Math.floor(salt)) * total;
  for (const item of weighted) {
    pick -= item.weight;
    if (pick <= 0) return item.state;
  }
  return weighted[weighted.length - 1].state;
}

export function findCrimsonWizardFloorY(world: WorldState, xWorld: number): number {
  let floorY = world.worldHeightWorld - CW_ROOM_MARGIN;
  for (let i = 0; i < world.wallCount; i++) {
    const x0 = world.wallXWorld[i];
    const x1 = x0 + world.wallWWorld[i];
    const y = world.wallYWorld[i];
    if (xWorld < x0 || xWorld > x1 || y <= 0) continue;
    if (y < floorY) floorY = y;
  }
  return clamp(floorY, CW_ROOM_MARGIN, world.worldHeightWorld - 4);
}

const CW_GROUND_DESCENT_SPEED_WORLD = 2.2;

/** While ground-casting, glides the boss down to (and holds it at) the floor instead of hovering. */
function steerCrimsonWizardGrounded(world: WorldState, boss: ClusterState): void {
  const floorY = findCrimsonWizardFloorY(world, boss.positionXWorld) - boss.halfHeightWorld;
  const dy = floorY - boss.positionYWorld;
  if (Math.abs(dy) > CW_GROUND_DESCENT_SPEED_WORLD) {
    boss.positionYWorld += Math.sign(dy) * CW_GROUND_DESCENT_SPEED_WORLD;
  } else {
    boss.positionYWorld = floorY;
  }
  boss.crimsonWizardVelXWorld *= CW_MOVE_DAMPING;
  boss.crimsonWizardVelYWorld = 0;
  boss.velocityXWorld = 0;
  boss.velocityYWorld = 0;
}

export function steerCrimsonWizardMovement(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if (boss.crimsonWizardState === CW_STATE_GROUND_FIRE_BALLS) {
    steerCrimsonWizardGrounded(world, boss);
    return;
  }
  const tuning = getCrimsonWizardPhaseTuning(getCrimsonWizardPhase(boss.healthPoints, boss.maxHealthPoints));
  const dx = player.positionXWorld - boss.positionXWorld;
  const dy = player.positionYWorld - boss.positionYWorld;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  if (Math.abs(dx) > 0.5) boss.crimsonWizardFacingX = dx < 0 ? -1 : 1;

  let desiredX = 0;
  let desiredY = 0;
  if (dist < CW_TOO_CLOSE_DISTANCE) {
    const panic = (CW_TOO_CLOSE_DISTANCE - dist) / CW_TOO_CLOSE_DISTANCE;
    desiredX -= (dx / dist) * (1.1 + panic);
    desiredY -= (dy / dist) * (0.8 + panic * 0.6);
  } else if (dist > CW_PREFERRED_DISTANCE) {
    desiredX += (dx / dist) * 0.35;
    desiredY += (dy / dist) * 0.18;
  } else {
    desiredX -= (dx / dist) * 0.12;
  }

  const phase = boss.crimsonWizardHoverPhaseRad;
  desiredX += Math.cos(phase * 0.73) * CW_IDLE_DRIFT_STRENGTH_X;
  desiredY += Math.sin(phase) * CW_IDLE_DRIFT_STRENGTH_Y;

  const { minX, maxX, minY, maxY } = playableBounds(world, boss);
  const leftT = clamp((boss.positionXWorld - minX) / CW_WALL_AVOID_DISTANCE, 0, 1);
  const rightT = clamp((maxX - boss.positionXWorld) / CW_WALL_AVOID_DISTANCE, 0, 1);
  const topT = clamp((boss.positionYWorld - minY) / CW_WALL_AVOID_DISTANCE, 0, 1);
  const bottomT = clamp((maxY - boss.positionYWorld) / CW_WALL_AVOID_DISTANCE, 0, 1);
  desiredX += (1 - leftT) * 1.5;
  desiredX -= (1 - rightT) * 1.5;
  desiredY += (1 - topT) * 1.3;
  desiredY -= (1 - bottomT) * 1.3;

  const desiredLen = Math.sqrt(desiredX * desiredX + desiredY * desiredY);
  const telegraphScale = boss.crimsonWizardTelegraphTicks > 0 ? 0.55 : 1;
  const attackScale = boss.crimsonWizardState === CW_STATE_IDLE || boss.crimsonWizardState === CW_STATE_RECOVER ? 1 : tuning.attackMoveScale * telegraphScale;
  if (desiredLen > 0.001) {
    boss.crimsonWizardVelXWorld += (desiredX / desiredLen) * CW_MOVE_ACCEL * attackScale;
    boss.crimsonWizardVelYWorld += (desiredY / desiredLen) * CW_MOVE_ACCEL * attackScale;
  }
  boss.crimsonWizardVelXWorld *= CW_MOVE_DAMPING;
  boss.crimsonWizardVelYWorld *= CW_MOVE_DAMPING;

  const speed = Math.sqrt(boss.crimsonWizardVelXWorld * boss.crimsonWizardVelXWorld + boss.crimsonWizardVelYWorld * boss.crimsonWizardVelYWorld);
  const maxSpeed = CW_MOVE_MAX_SPEED * attackScale;
  if (speed > maxSpeed) {
    const s = maxSpeed / speed;
    boss.crimsonWizardVelXWorld *= s;
    boss.crimsonWizardVelYWorld *= s;
  }

  const nextX = boss.positionXWorld + boss.crimsonWizardVelXWorld;
  const nextY = boss.positionYWorld + boss.crimsonWizardVelYWorld;
  boss.positionXWorld = clamp(nextX, minX, maxX);
  boss.positionYWorld = clamp(nextY, minY, maxY);
  if ((boss.positionXWorld === minX && boss.crimsonWizardVelXWorld < 0) || (boss.positionXWorld === maxX && boss.crimsonWizardVelXWorld > 0)) {
    boss.crimsonWizardVelXWorld = 0;
  }
  if ((boss.positionYWorld === minY && boss.crimsonWizardVelYWorld < 0) || (boss.positionYWorld === maxY && boss.crimsonWizardVelYWorld > 0)) {
    boss.crimsonWizardVelYWorld = 0;
  }
  boss.velocityXWorld = boss.crimsonWizardVelXWorld * 60;
  boss.velocityYWorld = boss.crimsonWizardVelYWorld * 60;
  boss.crimsonWizardHoverPhaseRad += 0.045;
}

function maybeSpawnChargeTelegraph(world: WorldState, boss: ClusterState, ticks: number): void {
  if (boss.crimsonWizardStateTicks !== 1) return;
  boss.crimsonWizardTelegraphTicks = ticks;
  spawnCrimsonTelegraph(world, boss.positionXWorld, boss.positionYWorld + boss.halfHeightWorld + 4, boss.halfWidthWorld, CW_TELEGRAPH_KIND_CHARGE, ticks);
}

function emitTidalWave(world: WorldState, boss: ClusterState, tuning: CrimsonWizardPhaseTuning): void {
  if (boss.crimsonWizardStateTicks <= CW_TIDAL_WAVE_TELEGRAPH_TICKS) return;
  if (((boss.crimsonWizardStateTicks - CW_TIDAL_WAVE_TELEGRAPH_TICKS) % tuning.tidalEmitIntervalTicks) !== 0) return;
  const dir = boss.crimsonWizardFacingX;
  const lowWave = tuning.phase !== CW_PHASE_1 && (boss.crimsonWizardNextAttackIndex & 1) === 0;
  const waveY = lowWave
    ? findCrimsonWizardFloorY(world, boss.positionXWorld) - 24 + Math.sin(boss.crimsonWizardStateTicks * 0.1) * 4
    : boss.positionYWorld + 2 + Math.sin(boss.crimsonWizardStateTicks * 0.13) * 10;
  for (let i = 0; i < tuning.tidalParticlesPerEmit; i++) {
    const gapOffset = lowWave && i === Math.floor(tuning.tidalParticlesPerEmit * 0.5) ? 10 : 0;
    const spread = (i - (tuning.tidalParticlesPerEmit - 1) * 0.5) * CW_TIDAL_WAVE_SPACING_WORLD + gapOffset;
    spawnCrimsonFireDust(
      world,
      boss.positionXWorld + dir * (10 + i * 1.7),
      waveY + spread * 0.34,
      dir * (CW_TIDAL_WAVE_SPEED_MIN + nextFloat(world.rng) * CW_TIDAL_WAVE_SPEED_VARIANCE) * tuning.tidalSpeedMultiplier,
      -0.22 + randSigned(world) * 0.38,
      CW_TIDAL_WAVE_LIFETIME_MIN_TICKS + Math.floor(nextFloat(world.rng) * CW_TIDAL_WAVE_LIFETIME_VARIANCE_TICKS),
    );
  }
}

function pillarXForStep(world: WorldState, player: ClusterState, step: number, pillarCount = CW_PILLAR_COUNT): number {
  const rowWidth = (pillarCount - 1) * CW_PILLAR_SPACING_WORLD;
  const minX = CW_ROOM_MARGIN + CW_PILLAR_HALF_WIDTH_WORLD;
  const maxX = Math.max(minX, world.worldWidthWorld - CW_ROOM_MARGIN - CW_PILLAR_HALF_WIDTH_WORLD);
  const maxStartX = Math.max(minX, maxX - rowWidth);
  const startX = clamp(player.positionXWorld - rowWidth * 0.5, minX, maxStartX);
  return clamp(startX + step * CW_PILLAR_SPACING_WORLD, minX, maxX);
}

export function getCrimsonWizardPillarSteps(phase: CrimsonWizardPhase, variant: number, pillarCount: number): number[] {
  const steps: number[] = [];
  const safeGapIndex = phase === CW_PHASE_1 ? -1 : Math.max(1, Math.min(pillarCount - 2, variant % pillarCount));
  for (let step = 0; step < pillarCount; step++) {
    if (step === safeGapIndex) continue;
    if (phase >= CW_PHASE_2 && (variant & 1) === 1 && (step % 2) === 1) continue;
    steps.push(step);
  }
  if (steps.length === 0) steps.push(0);
  return steps;
}

function emitPillarTelegraphs(world: WorldState, boss: ClusterState, player: ClusterState, tuning: CrimsonWizardPhaseTuning): void {
  if (boss.crimsonWizardStateTicks !== 1) return;
  boss.crimsonWizardTelegraphTicks = CW_PILLAR_TELEGRAPH_TICKS;
  const steps = getCrimsonWizardPillarSteps(tuning.phase, boss.crimsonWizardNextAttackIndex, tuning.pillarCount);
  for (const step of steps) {
    const x = pillarXForStep(world, player, step, tuning.pillarCount);
    spawnCrimsonTelegraph(world, x, findCrimsonWizardFloorY(world, x) - 2, CW_PILLAR_HALF_WIDTH_WORLD + 2, CW_TELEGRAPH_KIND_PILLAR, CW_PILLAR_TELEGRAPH_TICKS);
  }
}

function emitPillarRow(world: WorldState, boss: ClusterState, player: ClusterState, tuning: CrimsonWizardPhaseTuning): void {
  if (boss.crimsonWizardStateTicks <= CW_PILLAR_TELEGRAPH_TICKS) return;
  const attackTick = boss.crimsonWizardStateTicks - CW_PILLAR_TELEGRAPH_TICKS;
  if ((attackTick % CW_PILLAR_EMIT_INTERVAL_TICKS) !== 0) return;
  const steps = getCrimsonWizardPillarSteps(tuning.phase, boss.crimsonWizardNextAttackIndex, tuning.pillarCount);
  const stepIndex = Math.floor(attackTick / CW_PILLAR_EMIT_INTERVAL_TICKS);
  if (stepIndex >= steps.length) return;
  const step = tuning.phase === CW_PHASE_3 && (boss.crimsonWizardNextAttackIndex & 1) === 0
    ? steps[steps.length - 1 - stepIndex]
    : steps[stepIndex];
  const x = pillarXForStep(world, player, step, tuning.pillarCount);
  const floorY = findCrimsonWizardFloorY(world, x);
  for (let i = 0; i < tuning.pillarParticlesPerBurst; i++) {
    spawnCrimsonFireDust(
      world,
      x + randSigned(world) * CW_PILLAR_HALF_WIDTH_WORLD,
      floorY - 2 - nextFloat(world.rng) * 8,
      randSigned(world) * 0.24,
      -1.0 - nextFloat(world.rng) * 1.35,
      44 + Math.floor(nextFloat(world.rng) * 24),
    );
  }
}

function meteorTargetX(world: WorldState, player: ClusterState, index: number, tuning: CrimsonWizardPhaseTuning): number {
  const spread = tuning.phase === CW_PHASE_3 ? 34 : 28;
  const offset = (index - (tuning.meteorCount - 1) * 0.5) * spread + randSigned(world) * 12;
  return clamp(player.positionXWorld + offset, CW_ROOM_MARGIN + CW_METEOR_SIZE_WORLD, world.worldWidthWorld - CW_ROOM_MARGIN - CW_METEOR_SIZE_WORLD);
}

export function prepareCrimsonWizardMeteorSchedule(world: WorldState, boss: ClusterState, player: ClusterState, tuning: CrimsonWizardPhaseTuning): void {
  const count = Math.min(tuning.meteorCount, MAX_CW_METEOR_SCHEDULE);
  boss.crimsonWizardMeteorCount = count;
  boss.crimsonWizardMeteorSpawnedFlag.fill(0);
  for (let i = 0; i < count; i++) {
    const targetX = meteorTargetX(world, player, i, tuning);
    const targetY = findCrimsonWizardFloorY(world, targetX) - CW_METEOR_SIZE_WORLD * 0.5;
    boss.crimsonWizardMeteorTargetXWorld[i] = targetX;
    boss.crimsonWizardMeteorTargetYWorld[i] = targetY;
    boss.crimsonWizardMeteorSpawnXWorld[i] = targetX + randSigned(world) * 36;
    boss.crimsonWizardMeteorSpawnYWorld[i] = -CW_METEOR_SIZE_WORLD * 1.5;
    boss.crimsonWizardMeteorSpawnTick[i] = CW_METEOR_TELEGRAPH_TICKS + 3 + i * tuning.meteorIntervalTicks;
    spawnCrimsonTelegraph(world, targetX, targetY, CW_METEOR_SIZE_WORLD * 0.65, CW_TELEGRAPH_KIND_METEOR, boss.crimsonWizardMeteorSpawnTick[i]);
  }
}

function emitMeteors(world: WorldState, boss: ClusterState, player: ClusterState, tuning: CrimsonWizardPhaseTuning): void {
  if (boss.crimsonWizardStateTicks === 1) {
    boss.crimsonWizardTelegraphTicks = CW_METEOR_TELEGRAPH_TICKS;
    prepareCrimsonWizardMeteorSchedule(world, boss, player, tuning);
  }
  for (let i = 0; i < boss.crimsonWizardMeteorCount; i++) {
    if (boss.crimsonWizardMeteorSpawnedFlag[i] === 1 || boss.crimsonWizardStateTicks < boss.crimsonWizardMeteorSpawnTick[i]) continue;
    const targetX = boss.crimsonWizardMeteorTargetXWorld[i];
    const targetY = boss.crimsonWizardMeteorTargetYWorld[i];
    boss.crimsonWizardMeteorSpawnedFlag[i] = 1;
    spawnCrimsonTelegraph(world, targetX, targetY, CW_METEOR_SIZE_WORLD * 0.65, CW_TELEGRAPH_KIND_METEOR, 18);
    spawnCrimsonMeteor(world, boss.crimsonWizardMeteorSpawnXWorld[i], boss.crimsonWizardMeteorSpawnYWorld[i], targetX, targetY);
  }
}

function spawnAimedFireball(world: WorldState, boss: ClusterState, targetXWorld: number, targetYWorld: number, angleOffsetRad: number): void {
  const dx = targetXWorld - boss.positionXWorld;
  const dy = targetYWorld - boss.positionYWorld;
  const baseAngle = Math.atan2(dy, dx);
  const angle = baseAngle + angleOffsetRad;
  spawnCrimsonFireball(
    world,
    boss.positionXWorld,
    boss.positionYWorld,
    boss.positionXWorld + Math.cos(angle) * 120,
    boss.positionYWorld + Math.sin(angle) * 120,
  );
}

function emitFireballs(world: WorldState, boss: ClusterState, player: ClusterState, tuning: CrimsonWizardPhaseTuning): void {
  maybeSpawnChargeTelegraph(world, boss, CW_FIREBALL_TELEGRAPH_TICKS);
  if (boss.crimsonWizardStateTicks <= CW_FIREBALL_TELEGRAPH_TICKS) return;
  const attackTick = boss.crimsonWizardStateTicks - CW_FIREBALL_TELEGRAPH_TICKS;
  if ((attackTick % tuning.fireballIntervalTicks) !== 2) return;
  const volleyIndex = Math.floor(attackTick / tuning.fireballIntervalTicks);
  if (volleyIndex >= (tuning.phase === CW_PHASE_3 ? 3 : 2)) return;
  const count = tuning.phase === CW_PHASE_1 ? 1 : tuning.fireballCount;
  const centerOffset = tuning.phase === CW_PHASE_3 && (volleyIndex & 1) === 1 ? tuning.fireballSpreadRadians * 0.5 : 0;
  for (let i = 0; i < count; i++) {
    const offset = count === 1 ? 0 : (i - (count - 1) * 0.5) * tuning.fireballSpreadRadians + centerOffset;
    spawnAimedFireball(world, boss, player.positionXWorld + randSigned(world) * 12, player.positionYWorld + randSigned(world) * 8, offset);
  }
}

function emitGroundFireballs(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if (!isCrimsonWizardGroundCasting(boss.crimsonWizardStateTicks)) return;
  const castTick = boss.crimsonWizardStateTicks;
  if ((castTick % CW_GROUND_FIREBALL_INTERVAL_TICKS) !== 1) return;
  const volleyIndex = Math.floor(castTick / CW_GROUND_FIREBALL_INTERVAL_TICKS);
  if (volleyIndex >= CW_GROUND_FIREBALL_COUNT) return;
  spawnAimedFireball(world, boss, player.positionXWorld + randSigned(world) * 12, player.positionYWorld + randSigned(world) * 8, 0);
}

function tickAttackState(world: WorldState, boss: ClusterState, player: ClusterState): void {
  const phase = getCrimsonWizardPhase(boss.healthPoints, boss.maxHealthPoints);
  const tuning = getCrimsonWizardPhaseTuning(phase);
  boss.crimsonWizardStateTicks += 1;
  if (boss.crimsonWizardAttackCooldownTicks > 0) boss.crimsonWizardAttackCooldownTicks -= 1;
  if (boss.crimsonWizardTelegraphTicks > 0) boss.crimsonWizardTelegraphTicks -= 1;

  switch (boss.crimsonWizardState) {
    case CW_STATE_IDLE:
      if (boss.crimsonWizardAttackCooldownTicks <= 0) {
        const nextState = selectCrimsonWizardAttack(world, boss, phase);
        boss.crimsonWizardNextAttackIndex += 1;
        boss.crimsonWizardRepeatCount = nextState === boss.crimsonWizardLastAttackState ? boss.crimsonWizardRepeatCount + 1 : 0;
        boss.crimsonWizardLastAttackState = nextState;
        setState(boss, nextState);
      }
      break;
    case CW_STATE_TIDAL_WAVE:
      maybeSpawnChargeTelegraph(world, boss, CW_TIDAL_WAVE_TELEGRAPH_TICKS);
      emitTidalWave(world, boss, tuning);
      if (boss.crimsonWizardStateTicks > tuning.tidalDurationTicks) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_FIRE_PILLARS:
      emitPillarTelegraphs(world, boss, player, tuning);
      emitPillarRow(world, boss, player, tuning);
      if (boss.crimsonWizardStateTicks > CW_PILLAR_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_METEORS:
      emitMeteors(world, boss, player, tuning);
      if (boss.crimsonWizardStateTicks > CW_METEOR_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_FIRE_BALLS:
      emitFireballs(world, boss, player, tuning);
      if (boss.crimsonWizardStateTicks > CW_FIREBALL_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_GROUND_FIRE_BALLS:
      emitGroundFireballs(world, boss, player);
      if (isCrimsonWizardGroundCastDone(boss.crimsonWizardStateTicks)) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_RECOVER:
      if (boss.crimsonWizardStateTicks > tuning.recoverTicks) {
        boss.crimsonWizardAttackCooldownTicks = tuning.attackCooldownTicks;
        setState(boss, CW_STATE_IDLE);
      }
      break;
  }
}

export function applyCrimsonWizardAI(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;
  for (let ci = 1; ci < world.clusters.length; ci++) {
    const boss = world.clusters[ci];
    if (boss.isCrimsonWizardFlag !== 1 || boss.isAliveFlag === 0) continue;
    if (boss.crimsonWizardAttackCooldownTicks <= 0 && boss.crimsonWizardState === CW_STATE_IDLE && boss.crimsonWizardStateTicks === 0) {
      boss.crimsonWizardAttackCooldownTicks = CW_INITIAL_COOLDOWN_TICKS;
    }
    steerCrimsonWizardMovement(world, boss, player);
    tickAttackState(world, boss, player);

    if (player.invulnerabilityTicks <= 0) {
      const overlapX = Math.abs(player.positionXWorld - boss.positionXWorld) <= player.halfWidthWorld + boss.halfWidthWorld;
      const overlapY = Math.abs(player.positionYWorld - boss.positionYWorld) <= player.halfHeightWorld + boss.halfHeightWorld;
      if (overlapX && overlapY) {
        applyPlayerDamageWithKnockback(player, CW_CONTACT_DAMAGE, boss.positionXWorld, boss.positionYWorld);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, CW_CONTACT_IFRAMES);
      }
    }
  }
}
