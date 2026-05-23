/**
 * Dust Constellation Sentinel — AI state machine.
 *
 * States:
 *   0 = idle      — motes drift organically; waiting for activation
 *   1 = gather    — motes converge toward the chosen formation
 *   2 = telegraph — pattern locked; connection lines glow; no damage
 *   3 = beam_fire — beams fire sequentially between motes
 *   4 = recover   — beams fade; cooldown begins
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState, MAX_MOTES_PER_CONSTELLATION } from '../world';
import { nextFloat } from '../rng';
import { closestPointOnSegment } from '../physics/collision';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import {
  DC_SMALL_MOTE_COUNT,
  DC_LARGE_MOTE_COUNT,
  DC_SMALL_FORMATION_SCALE,
  DC_LARGE_FORMATION_SCALE,
  DC_ACTIVATION_RANGE_WORLD,
  DC_ATTACK_COOLDOWN_TICKS,
  DC_GATHER_DURATION_TICKS,
  DC_TELEGRAPH_DURATION_TICKS,
  DC_BEAM_SEGMENT_DURATION_TICKS,
  DC_RECOVER_DURATION_TICKS,
  DC_BOB_FREQ_RAD_PER_TICK,
  DC_BOB_AMPLITUDE_WORLD,
  DC_MOTE_SPRING_BLEND,
  DC_GATHER_SPRING_BLEND,
  DC_MOTE_JITTER_SPEED,
  DC_MOTE_ORBIT_RADIUS_WORLD,
  DC_MOTE_ORBIT_RAD_PER_TICK,
  DC_MOTE_PULSE_FREQ_RAD_PER_TICK,
  DC_BEAM_HITBOX_HALF_WORLD,
  DC_BEAM_DAMAGE,
  DC_BEAM_IFRAMES_TICKS,
  DC_LEASH_RADIUS_WORLD,
} from './dustConstellationConfig';

// ── State identifiers ──────────────────────────────────────────────────────
export const DC_STATE_IDLE      = 0;
export const DC_STATE_GATHER    = 1;
export const DC_STATE_TELEGRAPH = 2;
export const DC_STATE_BEAM_FIRE = 3;
export const DC_STATE_RECOVER   = 4;

// ── Constellation patterns ─────────────────────────────────────────────────
// Each pattern describes per-mote local offsets (normalised so that the
// formation scale constant is applied at use time) and the beam fire order
// (indices into the mote array, sequential pairs become beam segments).

interface ConstellationPattern {
  /** Number of motes in this pattern. */
  moteCount: number;
  /** Normalised X offsets (−1..1 range; multiply by formationScale at runtime). */
  localX: readonly number[];
  /** Normalised Y offsets. */
  localY: readonly number[];
  /** Beam segment sequence: each consecutive pair (i, i+1) defines one segment. */
  beamOrder: readonly number[];
}

// Pattern 0 — triangle / star (6 motes)
const PATTERN_TRIANGLE: ConstellationPattern = {
  moteCount: 6,
  localX: [ 0,  0.87, -0.87,  0.43, -0.43,  0   ],
  localY: [-1, 0.5,   0.5,  -0.5,  -0.5,   0.9  ],
  beamOrder: [0, 1, 2, 3, 4, 5, 0],
};

// Pattern 1 — zigzag chain (7 motes)
const PATTERN_ZIGZAG: ConstellationPattern = {
  moteCount: 7,
  localX: [-1.0, -0.6, -0.2,  0.2,  0.6,  1.0,  0.2 ],
  localY: [ 0,   -0.6,  0.4, -0.4,  0.6, -0.2,  1.0 ],
  beamOrder: [0, 1, 2, 3, 4, 5, 6],
};

// Pattern 2 — partial ring (6 motes for small, expands to 8 for large)
const PATTERN_RING: ConstellationPattern = {
  moteCount: 6,
  localX: [ 1.0,  0.5, -0.5, -1.0, -0.5,  0.5 ],
  localY: [ 0.0, -0.87, -0.87,  0.0,  0.87,  0.87 ],
  beamOrder: [0, 1, 2, 3, 4, 5, 0],
};

// Larger variants of each pattern (used when isDustConstellationLargeFlag === 1)
const PATTERN_TRIANGLE_LARGE: ConstellationPattern = {
  moteCount: 9,
  localX: [ 0,  0.87, -0.87,  0.43, -0.43,  0,   1.0, -1.0,  0    ],
  localY: [-1,  0.5,   0.5, -0.5,  -0.5,   0.9, -0.2,  -0.2,  1.1  ],
  beamOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8, 0],
};

const PATTERN_ZIGZAG_LARGE: ConstellationPattern = {
  moteCount: 9,
  localX: [-1.0, -0.7, -0.4, -0.1,  0.2,  0.5,  0.8,  0.2, -0.4 ],
  localY: [ 0,   -0.6,  0.4, -0.4,  0.6, -0.3,  0.5,  1.0,  1.0  ],
  beamOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

const PATTERN_RING_LARGE: ConstellationPattern = {
  moteCount: 10,
  localX: [ 1.0,  0.71,  0.0, -0.71, -1.0, -0.71, -0.0,  0.71,  0.5, -0.5 ],
  localY: [ 0.0, -0.71, -1.0, -0.71,  0.0,  0.71,  1.0,  0.71, -0.3, -0.3 ],
  beamOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
};

const SMALL_PATTERNS: readonly ConstellationPattern[] = [
  PATTERN_TRIANGLE,
  PATTERN_ZIGZAG,
  PATTERN_RING,
];

const LARGE_PATTERNS: readonly ConstellationPattern[] = [
  PATTERN_TRIANGLE_LARGE,
  PATTERN_ZIGZAG_LARGE,
  PATTERN_RING_LARGE,
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simple deterministic noise substitute — returns a value in [−1, 1]. */
function _noise(seed: number): number {
  // Cheap bit-mix hash derived from the tick count seed, avoids Math.random().
  let h = seed ^ (seed >>> 7);
  h = Math.imul(h, 0x9e3779b9);
  h = h ^ (h >>> 15);
  h = Math.imul(h, 0x85ebca6b);
  return ((h >>> 0) / 0xffffffff) * 2.0 - 1.0;
}

/** Pick a random pattern index using the world RNG. */
function _pickPattern(world: WorldState): number {
  return Math.floor(nextFloat(world.rng) * 3);
}

/** Return the effective mote count for a constellation cluster. */
function _moteCount(isLarge: number): number {
  return isLarge === 1 ? DC_LARGE_MOTE_COUNT : DC_SMALL_MOTE_COUNT;
}

/** Return the formation scale for a constellation cluster. */
function _formationScale(isLarge: number): number {
  return isLarge === 1 ? DC_LARGE_FORMATION_SCALE : DC_SMALL_FORMATION_SCALE;
}

/** Return the correct pattern set for a constellation cluster. */
function _pattern(isLarge: number, patternIndex: number): ConstellationPattern {
  const set = isLarge === 1 ? LARGE_PATTERNS : SMALL_PATTERNS;
  return set[Math.min(patternIndex, set.length - 1)];
}

/** Set formation target offsets in the world arrays for the given slot. */
function _applyFormationTargets(
  world: WorldState,
  slotIndex: number,
  pattern: ConstellationPattern,
  scale: number,
): void {
  const base = slotIndex * MAX_MOTES_PER_CONSTELLATION;
  for (let m = 0; m < pattern.moteCount; m++) {
    world.constellationMoteTargetLocalX[base + m] = pattern.localX[m] * scale;
    world.constellationMoteTargetLocalY[base + m] = pattern.localY[m] * scale;
  }
}

/** Apply a spring-damper step moving mote positions toward their targets. */
function _springMotesToTargets(
  world: WorldState,
  slotIndex: number,
  moteCount: number,
  centerX: number,
  centerY: number,
  blend: number,
): void {
  const base = slotIndex * MAX_MOTES_PER_CONSTELLATION;
  for (let m = 0; m < moteCount; m++) {
    const idx = base + m;
    const tx = centerX + world.constellationMoteTargetLocalX[idx];
    const ty = centerY + world.constellationMoteTargetLocalY[idx];
    const cx = world.constellationMoteXWorld[idx];
    const cy = world.constellationMoteYWorld[idx];
    world.constellationMoteXWorld[idx] = cx + (tx - cx) * blend;
    world.constellationMoteYWorld[idx] = cy + (ty - cy) * blend;
    // Damp velocity during gather/telegraph so motes lock smoothly
    world.constellationMoteVelXWorld[idx] *= 0.7;
    world.constellationMoteVelYWorld[idx] *= 0.7;
  }
}

/** Test the active beam segment against the player hurtbox and deal damage. */
function _testBeamDamage(
  world: WorldState,
  cluster: WorldState['clusters'][number],
  slotIndex: number,
  pattern: ConstellationPattern,
  activeSegment: number,
): void {
  if (activeSegment >= pattern.beamOrder.length - 1) return;

  const base = slotIndex * MAX_MOTES_PER_CONSTELLATION;
  const moteA = pattern.beamOrder[activeSegment];
  const moteB = pattern.beamOrder[activeSegment + 1];
  const ax = world.constellationMoteXWorld[base + moteA];
  const ay = world.constellationMoteYWorld[base + moteA];
  const bx = world.constellationMoteXWorld[base + moteB];
  const by = world.constellationMoteYWorld[base + moteB];

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const player = world.clusters[ci];
    if (player.isPlayerFlag !== 1 || player.isAliveFlag !== 1) continue;
    if (player.invulnerabilityTicks > 0) continue;

    // Test player center against beam segment
    const px = player.positionXWorld;
    const py = player.positionYWorld;
    const { distSq } = closestPointOnSegment(px, py, ax, ay, bx, by);
    const threshold = DC_BEAM_HITBOX_HALF_WORLD + player.halfWidthWorld;
    if (distSq < threshold * threshold) {
      applyPlayerDamageWithKnockback(player, DC_BEAM_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
      player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, DC_BEAM_IFRAMES_TICKS);
    }
    break; // only one player
  }
}

// ── Main AI update ─────────────────────────────────────────────────────────

export function applyDustConstellationAI(world: WorldState): void {
  // Locate player
  let playerX = 0.0;
  let playerY = 0.0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isDustConstellationFlag !== 1) continue;

    const slot  = cluster.dustConstellationSlotIndex;
    const base  = slot * MAX_MOTES_PER_CONSTELLATION;
    const isLarge = cluster.isDustConstellationLargeFlag;
    const moteCount = _moteCount(isLarge);

    // ── Dead state cleanup ──────────────────────────────────────────────────
    if (cluster.isAliveFlag === 0) {
      // Scatter motes outward as a death burst
      const ticksSinceDeath = cluster.dustConstellationStateTicks;
      if (ticksSinceDeath < 40) {
        for (let m = 0; m < moteCount; m++) {
          const idx = base + m;
          const mx = world.constellationMoteXWorld[idx];
          const my = world.constellationMoteYWorld[idx];
          const dx = mx - cluster.positionXWorld;
          const dy = my - cluster.positionYWorld;
          const len = Math.sqrt(dx * dx + dy * dy) + 0.001;
          world.constellationMoteVelXWorld[idx] += (dx / len) * 3.0;
          world.constellationMoteVelYWorld[idx] += (dy / len) * 3.0;
          world.constellationMoteXWorld[idx] += world.constellationMoteVelXWorld[idx];
          world.constellationMoteYWorld[idx] += world.constellationMoteVelYWorld[idx];
          world.constellationMoteVelXWorld[idx] *= 0.88;
          world.constellationMoteVelYWorld[idx] *= 0.88;
        }
        cluster.dustConstellationStateTicks++;
      }
      continue;
    }

    // ── Advance bob phase ───────────────────────────────────────────────────
    cluster.dustConstellationBobPhaseRad += DC_BOB_FREQ_RAD_PER_TICK;

    // ── Floating centre position: slow idle drift toward spawn ──────────────
    const spawnX = cluster.dustConstellationSpawnXWorld;
    const spawnY = cluster.dustConstellationSpawnYWorld;
    const bobY   = Math.sin(cluster.dustConstellationBobPhaseRad) * DC_BOB_AMPLITUDE_WORLD;

    // Gently drift back inside leash radius
    const toSpawnX = spawnX - cluster.positionXWorld;
    const toSpawnY = (spawnY + bobY) - cluster.positionYWorld;
    const distToSpawn = Math.sqrt(toSpawnX * toSpawnX + toSpawnY * toSpawnY);
    if (distToSpawn > 1.0) {
      const leashBlend = Math.min(0.02, distToSpawn / DC_LEASH_RADIUS_WORLD) * 0.5;
      cluster.velocityXWorld = (cluster.velocityXWorld + toSpawnX * leashBlend) * 0.95;
      cluster.velocityYWorld = (cluster.velocityYWorld + toSpawnY * leashBlend) * 0.95;
    } else {
      cluster.velocityXWorld *= 0.95;
      cluster.velocityYWorld *= 0.95;
    }
    cluster.positionXWorld += cluster.velocityXWorld;
    cluster.positionYWorld += cluster.velocityYWorld;

    const cx = cluster.positionXWorld;
    const cy = cluster.positionYWorld;

    // ── Per-state logic ─────────────────────────────────────────────────────
    cluster.dustConstellationStateTicks++;
    const stateTicks = cluster.dustConstellationStateTicks;
    const state      = cluster.dustConstellationState;

    if (state === DC_STATE_IDLE) {
      // ── Mote organic drift ─────────────────────────────────────────────
      for (let m = 0; m < moteCount; m++) {
        const idx  = base + m;
        const mx   = world.constellationMoteXWorld[idx];
        const my   = world.constellationMoteYWorld[idx];
        const tx   = world.constellationMoteTargetLocalX[idx];
        const ty   = world.constellationMoteTargetLocalY[idx];
        const phase = world.constellationMotePulsePhaseRad[idx];

        // Orbit offset using per-mote phase
        const orbitAngle = stateTicks * DC_MOTE_ORBIT_RAD_PER_TICK + phase;
        const oX = Math.cos(orbitAngle) * DC_MOTE_ORBIT_RADIUS_WORLD;
        const oY = Math.sin(orbitAngle * 1.3) * DC_MOTE_ORBIT_RADIUS_WORLD * 0.55;

        const idleTargetX = cx + tx + oX;
        const idleTargetY = cy + ty + oY;

        // Jitter using deterministic noise based on tick + mote index
        const jitterX = _noise(stateTicks * 13 + m * 7) * DC_MOTE_JITTER_SPEED * (1.0 / 60.0);
        const jitterY = _noise(stateTicks * 11 + m * 5) * DC_MOTE_JITTER_SPEED * (1.0 / 60.0);

        const dvx = (idleTargetX - mx) * DC_MOTE_SPRING_BLEND + jitterX;
        const dvy = (idleTargetY - my) * DC_MOTE_SPRING_BLEND + jitterY;
        world.constellationMoteVelXWorld[idx] = (world.constellationMoteVelXWorld[idx] + dvx) * 0.8;
        world.constellationMoteVelYWorld[idx] = (world.constellationMoteVelYWorld[idx] + dvy) * 0.8;
        world.constellationMoteXWorld[idx]    = mx + world.constellationMoteVelXWorld[idx];
        world.constellationMoteYWorld[idx]    = my + world.constellationMoteVelYWorld[idx];

        // Pulse phase advances per mote
        world.constellationMotePulsePhaseRad[idx] = phase + DC_MOTE_PULSE_FREQ_RAD_PER_TICK;
      }

      // Check activation
      if (cluster.dustConstellationAttackCooldownTicks > 0) {
        cluster.dustConstellationAttackCooldownTicks--;
      } else if (playerFound) {
        const dx = playerX - cx;
        const dy = playerY - cy;
        if (dx * dx + dy * dy < DC_ACTIVATION_RANGE_WORLD * DC_ACTIVATION_RANGE_WORLD) {
          // Pick pattern and begin gather
          cluster.dustConstellationPatternIndex = _pickPattern(world);
          const pat   = _pattern(isLarge, cluster.dustConstellationPatternIndex);
          const scale = _formationScale(isLarge);
          _applyFormationTargets(world, slot, pat, scale);
          cluster.dustConstellationState      = DC_STATE_GATHER;
          cluster.dustConstellationStateTicks = 0;
        }
      }

    } else if (state === DC_STATE_GATHER) {
      // Smoothly pull motes into formation
      _springMotesToTargets(world, slot, moteCount, cx, cy, DC_GATHER_SPRING_BLEND);

      // Advance pulse
      for (let m = 0; m < moteCount; m++) {
        world.constellationMotePulsePhaseRad[base + m] += DC_MOTE_PULSE_FREQ_RAD_PER_TICK;
      }

      if (stateTicks >= DC_GATHER_DURATION_TICKS) {
        cluster.dustConstellationState      = DC_STATE_TELEGRAPH;
        cluster.dustConstellationStateTicks = 0;
      }

    } else if (state === DC_STATE_TELEGRAPH) {
      // Lock motes tightly into formation
      _springMotesToTargets(world, slot, moteCount, cx, cy, 0.25);

      for (let m = 0; m < moteCount; m++) {
        world.constellationMotePulsePhaseRad[base + m] += DC_MOTE_PULSE_FREQ_RAD_PER_TICK * 1.5;
      }

      if (stateTicks >= DC_TELEGRAPH_DURATION_TICKS) {
        cluster.dustConstellationActiveBeamIndex = 0;
        cluster.dustConstellationState           = DC_STATE_BEAM_FIRE;
        cluster.dustConstellationStateTicks      = 0;
      }

    } else if (state === DC_STATE_BEAM_FIRE) {
      const pat = _pattern(isLarge, cluster.dustConstellationPatternIndex);
      const segmentCount = pat.beamOrder.length - 1;
      const beamIdx = cluster.dustConstellationActiveBeamIndex;

      // Lock motes into formation while firing
      _springMotesToTargets(world, slot, moteCount, cx, cy, 0.3);

      // Damage collision for the active beam segment
      _testBeamDamage(world, cluster, slot, pat, beamIdx);

      // Advance beam index when segment duration expires
      if (stateTicks >= DC_BEAM_SEGMENT_DURATION_TICKS) {
        const nextBeam = beamIdx + 1;
        if (nextBeam >= segmentCount) {
          cluster.dustConstellationState      = DC_STATE_RECOVER;
          cluster.dustConstellationStateTicks = 0;
        } else {
          cluster.dustConstellationActiveBeamIndex = nextBeam;
          cluster.dustConstellationStateTicks      = 0;
        }
      }

    } else if (state === DC_STATE_RECOVER) {
      // Let motes drift back toward idle offsets
      for (let m = 0; m < moteCount; m++) {
        world.constellationMotePulsePhaseRad[base + m] += DC_MOTE_PULSE_FREQ_RAD_PER_TICK;
      }

      if (stateTicks >= DC_RECOVER_DURATION_TICKS) {
        cluster.dustConstellationAttackCooldownTicks = DC_ATTACK_COOLDOWN_TICKS;
        cluster.dustConstellationState              = DC_STATE_IDLE;
        cluster.dustConstellationStateTicks         = 0;
      }
    }
  }
}

// ── Public accessor for renderer ──────────────────────────────────────────

/** Expose pattern data so the renderer can draw telegraphed lines and beams. */
export function getConstellationPattern(isLarge: number, patternIndex: number): ConstellationPattern {
  return _pattern(isLarge, patternIndex);
}

export type { ConstellationPattern };
