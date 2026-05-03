/**
 * Falling block renderer — draws falling block groups and their visual
 * effects (shake, warning dust, landing dust, crumble burst).
 *
 * All rendering uses pixel-aligned world-to-canvas coordinates via
 * the standard (offsetXPx, offsetYPx, zoom) transform.
 *
 * Dust effects are purely visual: they do NOT affect the simulation.
 * A lightweight per-renderer PRNG (LCG) provides visual variety without
 * compromising simulation determinism.
 */

import type { WorldState } from '../../sim/world';
import {
  FB_STATE_WARNING,
  FB_STATE_PRE_FALL_PAUSE,
  FB_STATE_FALLING,
  FB_STATE_LANDED_STABLE,
  FB_STATE_CRUMBLING,
  FB_STATE_REMOVED,
  CRUMBLE_DURATION_TICKS,
} from '../../sim/fallingBlocks/fallingBlockTypes';
import type { FallingBlockGroup } from '../../sim/fallingBlocks/fallingBlockTypes';
import {
  getFBGroupLeftWorld  as getLeft,
  getFBGroupTopWorld   as getTop,
  getFBGroupRightWorld as getRight,
  getFBGroupBottomWorld as getBottom,
} from '../../sim/fallingBlocks/fallingBlockSim';
import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';

// ── Dust particle pool ────────────────────────────────────────────────────────

const MAX_FB_DUST = 256;
const DUST_LIFETIME_MS = 600;
const DUST_GRAVITY_WORLD_PER_SEC2 = 100;
const DUST_SPEED_MIN  = 20;
const DUST_SPEED_MAX  = 80;
const DUST_UPWARD_BIAS = 15;

/** Colour palette for falling block dust — rock/stone tones. */
const DUST_COLORS_WARN    = ['#c8b8a0', '#b0a090', '#988070', '#806858'];
const DUST_COLORS_LAND    = ['#d0c0a0', '#b8a888', '#907860', '#706050'];
const DUST_COLORS_CRUMBLE = ['#e0d0b0', '#c8b898', '#a89070', '#888060', '#606040'];

/** Variant display colours for falling block tile fill/stroke. */
const VARIANT_FILL_COLOR: Record<string, string> = {
  tough:     'rgba(90, 120, 180, 0.72)',
  sensitive: 'rgba(200, 80, 50, 0.72)',
  crumbling: 'rgba(190, 150, 30, 0.72)',
};
const VARIANT_STROKE_COLOR: Record<string, string> = {
  tough:     '#6090e0',
  sensitive: '#e05030',
  crumbling: '#d0a010',
};

export class FallingBlockDustRenderer {
  private count = 0;
  private readonly xWorld   = new Float32Array(MAX_FB_DUST);
  private readonly yWorld   = new Float32Array(MAX_FB_DUST);
  private readonly vxWorld  = new Float32Array(MAX_FB_DUST);
  private readonly vyWorld  = new Float32Array(MAX_FB_DUST);
  private readonly ageMs    = new Float32Array(MAX_FB_DUST);
  private readonly colorIdx = new Uint8Array(MAX_FB_DUST);
  private readonly paletteRef = new Uint8Array(MAX_FB_DUST); // 0=warn, 1=land, 2=crumble

  private rngState = 1;

  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  private allocSlot(): number {
    if (this.count < MAX_FB_DUST) return this.count++;
    // Recycle the oldest particle (slot 0, after compacting)
    return 0;
  }

  private spawnDust(
    xWorld: number, yWorld: number,
    vxBias: number, vyBias: number,
    palette: 0 | 1 | 2,
    count: number,
  ): void {
    const palette3 = palette === 2 ? DUST_COLORS_CRUMBLE : palette === 1 ? DUST_COLORS_LAND : DUST_COLORS_WARN;
    for (let i = 0; i < count; i++) {
      const idx = this.allocSlot();
      const angle = this.nextRandom() * Math.PI * 2;
      const speed = DUST_SPEED_MIN + this.nextRandom() * (DUST_SPEED_MAX - DUST_SPEED_MIN);
      this.xWorld[idx]   = xWorld + (this.nextRandom() - 0.5) * BLOCK_SIZE_MEDIUM;
      this.yWorld[idx]   = yWorld + (this.nextRandom() - 0.5) * BLOCK_SIZE_MEDIUM;
      this.vxWorld[idx]  = Math.cos(angle) * speed + vxBias;
      this.vyWorld[idx]  = Math.sin(angle) * speed - DUST_UPWARD_BIAS + vyBias;
      this.ageMs[idx]    = 0;
      this.colorIdx[idx] = (this.nextRandom() * palette3.length) | 0;
      this.paletteRef[idx] = palette;
    }
  }

  // ── Public spawn APIs ────────────────────────────────────────────────────

  /** Warning shake dust — tiny puff around the group bottom/sides. */
  spawnWarningDust(g: FallingBlockGroup): void {
    const bx = (getLeft(g) + getRight(g)) * 0.5;
    const by = getBottom(g);
    this.spawnDust(bx, by, 0, 0, 0, 6);
    // Side puffs
    this.spawnDust(getLeft(g),  by, -20, 0, 0, 3);
    this.spawnDust(getRight(g), by,  20, 0, 0, 3);
  }

  /**
   * Landing dust — bursts outward from the left and right edges of the contact
   * segment where the group bottom meets the surface.
   */
  spawnLandingDust(g: FallingBlockGroup): void {
    const by  = getBottom(g);
    const lx  = getLeft(g);
    const rx  = getRight(g);
    // Left-edge burst
    this.spawnDust(lx, by, -40, -10, 1, 10);
    // Right-edge burst
    this.spawnDust(rx, by,  40, -10, 1, 10);
    // Center splay for wider groups (dust squeezed out from under)
    const groupW = g.wWorld;
    const extraBursts = Math.floor(groupW / (BLOCK_SIZE_MEDIUM * 2));
    for (let k = 1; k <= extraBursts; k++) {
      const frac = k / (extraBursts + 1);
      const ex = lx + groupW * frac;
      const dir = frac < 0.5 ? -20 : 20;
      this.spawnDust(ex, by, dir, -8, 1, 4);
    }
  }

  /** Crumble disappear dust — large burst covering the whole group area. */
  spawnCrumbleDust(g: FallingBlockGroup): void {
    const cx = (getLeft(g) + getRight(g)) * 0.5;
    const cy = (getTop(g) + getBottom(g)) * 0.5;
    // Dense omnidirectional burst
    this.spawnDust(cx, cy, 0, -20, 2, 20);
    // Extra particles along the top edge
    this.spawnDust(cx, getTop(g), 0, -30, 2, 10);
  }

  // ── Update and render ────────────────────────────────────────────────────

  update(dtMs: number): void {
    const dt = dtMs / 1000.0;
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] > DUST_LIFETIME_MS) {
        this.count--;
        // Swap with last
        this.xWorld[i]   = this.xWorld[this.count];
        this.yWorld[i]   = this.yWorld[this.count];
        this.vxWorld[i]  = this.vxWorld[this.count];
        this.vyWorld[i]  = this.vyWorld[this.count];
        this.ageMs[i]    = this.ageMs[this.count];
        this.colorIdx[i] = this.colorIdx[this.count];
        this.paletteRef[i] = this.paletteRef[this.count];
        continue;
      }
      this.vyWorld[i] += DUST_GRAVITY_WORLD_PER_SEC2 * dt;
      this.xWorld[i]  += this.vxWorld[i] * dt;
      this.yWorld[i]  += this.vyWorld[i] * dt;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number, offsetYPx: number, zoom: number,
  ): void {
    for (let i = 0; i < this.count; i++) {
      const age = this.ageMs[i] / DUST_LIFETIME_MS;
      const alpha = Math.max(0, 1 - age);
      const palette = this.paletteRef[i] === 2
        ? DUST_COLORS_CRUMBLE
        : this.paletteRef[i] === 1
          ? DUST_COLORS_LAND
          : DUST_COLORS_WARN;
      const color = palette[this.colorIdx[i] % palette.length];

      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = color;
      const px = this.xWorld[i] * zoom + offsetXPx;
      const py = this.yWorld[i] * zoom + offsetYPx;
      const sz = Math.max(1, zoom);
      ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
    }
    ctx.globalAlpha = 1;
  }
}

// ── Falling block group renderer ──────────────────────────────────────────────

/**
 * Ticks for how often warning dust spawns (every N ticks during warning state).
 * Keeps dust spawning lightweight.
 */
const WARN_DUST_SPAWN_INTERVAL_TICKS = 8;

/**
 * Per-frame tick event tracking — stored per group index to know when to
 * spawn new warning dust without allocating per-tick.
 * Kept in the renderer, never in the sim.
 */
const _warnDustCooldown = new Uint16Array(64); // up to 64 groups per room

/**
 * Landing dust is spawned once when a group transitions to landedStable.
 * We track which groups have already had their landing dust spawned by
 * watching state transitions.
 */
const _prevStateByGroup = new Uint8Array(64);

/**
 * Render all active falling block groups into the virtual canvas.
 *
 * @param ctx           2D canvas context (the virtual 480×270 canvas).
 * @param world         Current world state.
 * @param offsetXPx     Camera X offset in virtual pixels.
 * @param offsetYPx     Camera Y offset in virtual pixels.
 * @param zoom          Current zoom (normally 1.0).
 * @param dtMs          Frame delta time in ms (for dust particle update).
 * @param dustRenderer  Shared dust renderer instance.
 */
export function renderFallingBlocks(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  dtMs: number,
  dustRenderer: FallingBlockDustRenderer,
): void {
  dustRenderer.update(dtMs);

  for (let gi = 0; gi < world.fallingBlockGroups.length; gi++) {
    const g = world.fallingBlockGroups[gi];
    if (g.state === FB_STATE_REMOVED) continue;

    const prevState = _prevStateByGroup[gi];

    // ── Spawn effects on state transitions ─────────────────────────────────

    if (prevState !== g.state) {
      if (g.state === FB_STATE_LANDED_STABLE) {
        dustRenderer.spawnLandingDust(g);
      } else if (g.state === FB_STATE_CRUMBLING) {
        dustRenderer.spawnLandingDust(g);
      }
      _prevStateByGroup[gi] = g.state;
    }

    // Periodic warning dust
    if (g.state === FB_STATE_WARNING) {
      if (_warnDustCooldown[gi] === 0) {
        dustRenderer.spawnWarningDust(g);
        _warnDustCooldown[gi] = WARN_DUST_SPAWN_INTERVAL_TICKS;
      } else {
        _warnDustCooldown[gi]--;
      }
    } else {
      _warnDustCooldown[gi] = 0;
    }

    // Crumble burst dust just before disappearing
    if (g.state === FB_STATE_CRUMBLING && g.crumbleTimerTicks === CRUMBLE_DURATION_TICKS) {
      dustRenderer.spawnCrumbleDust(g);
    }

    // ── Draw each tile ──────────────────────────────────────────────────────

    const shakeX = g.shakeOffsetXWorld;
    const fillColor   = VARIANT_FILL_COLOR[g.variant] ?? 'rgba(100,100,100,0.7)';
    const strokeColor = VARIANT_STROKE_COLOR[g.variant] ?? '#aaa';

    // Crumble state: fade out as the timer counts down
    let alpha = 1.0;
    if (g.state === FB_STATE_CRUMBLING) {
      alpha = Math.max(0, Math.min(1, g.crumbleTimerTicks / CRUMBLE_DURATION_TICKS));
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    for (let ti = 0; ti < g.tileCount; ti++) {
      const tileLeft = (g.restXWorld + g.tileRelXWorld[ti] + shakeX) * zoom + offsetXPx;
      const tileTop  = (g.restYWorld + g.tileRelYWorld[ti] + g.offsetYWorld)  * zoom + offsetYPx;
      const tileSz   = BLOCK_SIZE_MEDIUM * zoom;

      ctx.fillStyle = fillColor;
      ctx.fillRect(tileLeft, tileTop, tileSz, tileSz);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = Math.max(1, zoom * 0.5);
      ctx.strokeRect(tileLeft, tileTop, tileSz, tileSz);

      // Warning cross-hatch pattern overlay
      if (g.state === FB_STATE_WARNING || g.state === FB_STATE_PRE_FALL_PAUSE) {
        ctx.strokeStyle = 'rgba(255,220,80,0.45)';
        ctx.lineWidth = Math.max(1, zoom * 0.5);
        ctx.beginPath();
        ctx.moveTo(tileLeft, tileTop + tileSz * 0.5);
        ctx.lineTo(tileLeft + tileSz, tileTop + tileSz * 0.5);
        ctx.moveTo(tileLeft + tileSz * 0.5, tileTop);
        ctx.lineTo(tileLeft + tileSz * 0.5, tileTop + tileSz);
        ctx.stroke();
      }

      // Falling state: downward motion lines
      if (g.state === FB_STATE_FALLING) {
        ctx.strokeStyle = 'rgba(200,200,255,0.25)';
        ctx.lineWidth = Math.max(1, zoom * 0.4);
        const numLines = 3;
        for (let ln = 0; ln < numLines; ln++) {
          const lx = tileLeft + tileSz * ((ln + 1) / (numLines + 1));
          ctx.beginPath();
          ctx.moveTo(lx, tileTop);
          ctx.lineTo(lx, tileTop - tileSz * 0.3);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  // Render all accumulated dust particles
  dustRenderer.render(ctx, offsetXPx, offsetYPx, zoom);
}
