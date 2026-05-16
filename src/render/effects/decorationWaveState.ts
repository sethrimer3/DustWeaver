/**
 * decorationWaveState.ts — Decoration wave/sway state and room decoration builder.
 *
 * Extracted from wallDecorations.ts (BUILD 327) to keep wallDecorations.ts
 * focused on the pure canvas drawing pass.
 *
 * Exports:
 *  - `WallDecoration`      — render-ready descriptor for a single decoration.
 *  - `DecorationWaveState` — per-room sway spring simulation.
 *  - `buildRoomDecorations` — converts RoomDecorationDef[] → WallDecoration[].
 */

import type { RoomDecorationDef, DecorationKind } from '../../levels/roomDef';
import type { ClusterSnapshot } from '../snapshot';

// ── Re-export canonical kind type ─────────────────────────────────────────────

export type { DecorationKind };

// ── WallDecoration ────────────────────────────────────────────────────────────

export interface WallDecoration {
  /** World-space X of the anchor block's left edge (xBlock * blockSizePx). */
  readonly worldLeftPx: number;
  /**
   * World-space Y of the decoration's surface anchor:
   * - For 'mushroom' / 'glowGrass': top surface of the floor block (yBlock * blockSizePx).
   * - For 'vine': bottom surface of the ceiling block ((yBlock + 1) * blockSizePx).
   *
   * Mushroom/grass draw UPWARD from this Y; vines draw DOWNWARD.
   */
  readonly worldAnchorYPx: number;
  /** Visual kind. */
  readonly kind: DecorationKind;
  /** Deterministic seed derived from block coordinates. */
  readonly seed: number;
}

// ── Deterministic hash (render-only, not sim RNG) ─────────────────────────────

/**
 * A simple, allocation-free 32-bit integer hash of three integers.
 * Returns a non-negative number.  For decoration use only (not sim RNG).
 */
function _hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 0x6c62272e) ^ Math.imul(b, 0x9e3779b9) ^ Math.imul(c, 0x517cc1b7)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

// ── DecorationWaveState ───────────────────────────────────────────────────────

/**
 * Per-room sway state for decoration push-wave animation.
 * When entities (player/enemies) move past decorations their horizontal
 * velocity imparts a momentary push — the decorations lean in the direction
 * of travel then spring back, with a higher velocity producing more lean.
 *
 * This is render-side state only; never referenced in sim code.
 * Uses `performance.now()` indirectly through the caller-supplied `dtSec`.
 */
export class DecorationWaveState {
  private readonly _swayAngleRad: Float32Array;
  private readonly _swayVelRad: Float32Array;
  private _count = 0;

  /** Maximum pre-allocated capacity in decorations. */
  static readonly MAX_DECORATIONS = 512;

  /** Spring stiffness — how quickly decorations return to upright. */
  private static readonly SPRING_K = 10.0;
  /** Velocity damping factor (fraction retained per second). */
  private static readonly DAMPING = 0.80;
  /** World-unit radius within which an entity influences a decoration. */
  private static readonly PUSH_RADIUS_WORLD = 36;
  /**
   * Velocity-to-angular-impulse scaling.
   * At 200 world-units/s, this produces ~0.12 rad/s of angular velocity.
   */
  private static readonly PUSH_FACTOR = 0.0006;
  /** Maximum allowed sway angle (radians). */
  private static readonly MAX_SWAY_RAD = 0.35;
  /**
   * Minimum absolute horizontal velocity (world units/s) a cluster must have
   * before it can impart a push impulse on decorations.  Clusters slower
   * than this are skipped entirely (broad-phase reject) to avoid iterating
   * all decorations for effectively-still entities.
   */
  private static readonly MIN_PUSH_VELOCITY_THRESHOLD = 1.0;

  constructor() {
    this._swayAngleRad = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
    this._swayVelRad   = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  }

  /**
   * Call once when loading a new room (or when the decoration list changes).
   * Resets all sway state for a fresh start.
   */
  reset(count: number): void {
    this._count = Math.min(count, DecorationWaveState.MAX_DECORATIONS);
    this._swayAngleRad.fill(0, 0, this._count);
    this._swayVelRad.fill(0, 0, this._count);
  }

  /**
   * Advance sway spring simulation and apply entity-velocity impulses.
   * Call once per render frame with `dtSec = elapsedMs / 1000`.
   *
   * @param dtSec    Frame delta in seconds.
   * @param decorations  Decoration list (same order as used by renderDecorationSprites).
   * @param clusters All cluster snapshots (player + enemies) — read-only.
   * @param decorationCenterX  Pre-computed center X (world units) for each decoration.
   * @param decorationCenterY  Pre-computed center Y (world units) for each decoration.
   *   Both arrays must have length >= decorations.length.  Populated once per
   *   room load in `loadRoom()` alongside `cachedWallDecorations`.
   */
  update(
    dtSec: number,
    decorations: readonly WallDecoration[],
    clusters: readonly ClusterSnapshot[],
    decorationCenterX: Float32Array,
    decorationCenterY: Float32Array,
  ): void {
    const count = Math.min(this._count, decorations.length);
    const springK = DecorationWaveState.SPRING_K;
    const damping = DecorationWaveState.DAMPING;
    const pushRadius = DecorationWaveState.PUSH_RADIUS_WORLD;
    const pushFactor = DecorationWaveState.PUSH_FACTOR;
    const maxSway  = DecorationWaveState.MAX_SWAY_RAD;
    const minVelThreshold = DecorationWaveState.MIN_PUSH_VELOCITY_THRESHOLD;

    const dampFactor = Math.pow(damping, dtSec);
    const radiusSq = pushRadius * pushRadius;

    // ── Apply entity-velocity impulses ────────────────────────────────────────
    for (let ci = 0; ci < clusters.length; ci++) {
      const c = clusters[ci];
      if (c.isAliveFlag === 0) continue;
      const velX = c.velocityXWorld;
      // Broad-phase: skip clusters that are effectively still — their
      // impulse contribution would be zero or negligible.
      if (Math.abs(velX) < minVelThreshold) continue;

      const cx = c.positionXWorld;
      const cy = c.positionYWorld;

      for (let i = 0; i < count; i++) {
        // AABB early-out using pre-cached decoration centers — avoids
        // the more expensive distSq multiply-add for distant decorations.
        // Direct range comparisons avoid the two Math.abs() calls.
        const dx = cx - decorationCenterX[i];
        const dy = cy - decorationCenterY[i];
        if (dx < -pushRadius || dx > pushRadius || dy < -pushRadius || dy > pushRadius) continue;
        const distSq = dx * dx + dy * dy;
        if (distSq >= radiusSq) continue;

        const dist    = Math.sqrt(distSq);
        const falloff = 1.0 - dist / pushRadius;
        // Push in direction of entity horizontal velocity, scaled by speed and proximity.
        this._swayVelRad[i] += velX * pushFactor * falloff;
      }
    }

    // ── Advance spring + damping ───────────────────────────────────────────────
    for (let i = 0; i < count; i++) {
      // Spring restoring force
      this._swayVelRad[i] -= this._swayAngleRad[i] * springK * dtSec;
      // Velocity damping
      this._swayVelRad[i] *= dampFactor;
      // Integrate angle
      this._swayAngleRad[i] += this._swayVelRad[i] * dtSec;
      // Clamp sway angle
      if (this._swayAngleRad[i] > maxSway)  this._swayAngleRad[i] = maxSway;
      if (this._swayAngleRad[i] < -maxSway) this._swayAngleRad[i] = -maxSway;
    }
  }

  /**
   * Returns the current sway angle (radians) for decoration at `index`.
   * Positive = lean right; negative = lean left.
   * Returns 0 for out-of-range indices.
   */
  getSway(index: number): number {
    if (index < 0 || index >= this._count) return 0;
    return this._swayAngleRad[index];
  }
}

// ── buildRoomDecorations ──────────────────────────────────────────────────────

/**
 * Converts room decoration definitions into render-ready WallDecoration objects.
 * The seed for each decoration is derived deterministically from its position and kind.
 */
export function buildRoomDecorations(
  decorations: readonly RoomDecorationDef[],
  blockSizePx: number,
): WallDecoration[] {
  const result: WallDecoration[] = [];
  for (let i = 0; i < decorations.length; i++) {
    const d = decorations[i];
    const kindCode = d.kind === 'mushroom' ? 1 : d.kind === 'glowGrass' ? 2 : 3;
    const seed = _hash(d.xBlock, d.yBlock, kindCode);

    const worldLeftPx = d.xBlock * blockSizePx;
    // Floor decorations anchor to the TOP surface of their block (grows upward).
    // Vine decorations anchor to the BOTTOM surface of their block (hangs downward).
    const worldAnchorYPx = d.kind === 'vine'
      ? (d.yBlock + 1) * blockSizePx
      : d.yBlock * blockSizePx;

    result.push({ worldLeftPx, worldAnchorYPx, kind: d.kind, seed });
  }
  return result;
}
