/**
 * dustCoreVisual.ts — Reusable dust-core visual helper.
 *
 * Manages per-enemy orbiting mote state (angle, radius, pulse) entirely on the
 * renderer side — no world-state changes required.  Shared by:
 *   - Radiant Tether  (warm amber/gold palette)
 *   - Radiant Web     (cool teal/green palette)
 *
 * Design principles (from DustWeaver coding conventions):
 *   • No allocations per frame — mote arrays are pre-allocated on first init.
 *   • Pixel-locked fillRect for motes (matches ODC / Constellation renderers).
 *   • Fake glow via translucent larger rect behind the core pixel.
 *   • Hit-flash detected by comparing previous HP each frame.
 *   • Death burst stores per-mote velocities and runs for a fixed tick window.
 *
 * Usage:
 *   updateAndRenderDustCore(ctx, cluster, screenX, screenY, scalePx, config);
 */

// ── Per-mote runtime data ─────────────────────────────────────────────────────

interface _MoteState {
  angle: number;       // current orbit angle (radians)
  radius: number;      // current rendered radius (world units — slightly wobbly)
  baseRadius: number;  // rest radius
  pulsePhase: number;  // brightness pulse (radians)
  ringIdx: number;     // which ring this mote belongs to (for speed/color)
}

// ── Per-entity persistent state ───────────────────────────────────────────────

interface _CoreState {
  entityId: number;
  motes: _MoteState[];
  prevHp: number;
  hitFlashTicks: number;     // countdown when hit (max HIT_FLASH_DURATION_TICKS)
  /** Per-mote burst velocity X (pre-allocated; filled on death). */
  burstVelX: Float32Array;
  /** Per-mote burst velocity Y. */
  burstVelY: Float32Array;
  burstTicks: number;        // countdown after death burst begins
  wasDead: boolean;          // true once death burst has started
}

const HIT_FLASH_DURATION_TICKS = 12;
const BURST_DURATION_TICKS     = 50;

// Module-level entity registry — one entry per active Radiant Tether/Web.
const _registry = new Map<number, _CoreState>();

/** Configuration describing the visual style of a dust-core enemy. */
export interface DustCoreConfig {
  /** Per-ring specs — innermost ring first. */
  rings: ReadonlyArray<{
    /** Number of motes in this ring. */
    count: number;
    /** Rest orbit radius (world units). */
    baseRadius: number;
    /** Base angular speed (radians/tick).  Inner rings should be faster. */
    angularSpeed: number;
    /** Mote core fill colour. */
    color: string;
    /** Mote glow fill colour (translucent). */
    glowColor: string;
  }>;
  /** Central core fill colour. */
  coreColor: string;
  /** Central core glow colour (translucent). */
  coreGlowColor: string;
  /** Core rest radius (world units). */
  coreRadiusWorld: number;
  /**
   * When > 0 the motes near this direction are stretched/brightened to
   * telegraph an attack.  Should be a unit vector.
   */
  attackDirX?: number;
  attackDirY?: number;
  /**
   * 0 = fully organic orbit, 1 = motes fully emphasising attack direction.
   * Values in-between create a smooth blend.
   */
  attackEmphasisT?: number;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Call once per frame for each Radiant Tether / Radiant Web enemy.
 * Advances mote simulation, checks for hit flash, renders everything.
 *
 * @param isAlive  Pass false after the enemy dies so the death burst fires.
 * @param currentHp  Current enemy HP (used to detect hits).
 */
export function updateAndRenderDustCore(
  ctx: CanvasRenderingContext2D,
  entityId: number,
  screenX: number,
  screenY: number,
  scalePx: number,
  isAlive: boolean,
  currentHp: number,
  globalTick: number,
  config: DustCoreConfig,
): void {
  const state = _getOrCreate(entityId, config);
  _update(state, isAlive, currentHp, config);
  _render(ctx, state, screenX, screenY, scalePx, isAlive, globalTick, config);
}

/** Remove cached state for an entity when its room is unloaded. */
export function removeDustCoreVisualState(entityId: number): void {
  _registry.delete(entityId);
}

/** Remove all cached state (call on room unload). */
export function clearAllDustCoreVisualState(): void {
  _registry.clear();
}

/**
 * Normalize a 2D vector to unit length.  Returns [x, y] unchanged if the
 * vector length is below `epsilon` (avoids division by near-zero).
 *
 * Shared by Radiant Tether and Radiant Web to compute attack emphasis direction
 * from the average of their active beam / chain vectors.
 */
export function normalizeDir(
  x: number, y: number, epsilon = 0.01,
): [number, number] {
  const len = Math.sqrt(x * x + y * y);
  return len > epsilon ? [x / len, y / len] : [0, 0];
}

// ── Init / retrieve ───────────────────────────────────────────────────────────

function _getOrCreate(entityId: number, config: DustCoreConfig): _CoreState {
  let s = _registry.get(entityId);
  if (s !== undefined) return s;

  const totalMotes = config.rings.reduce((n, r) => n + r.count, 0);
  const motes: _MoteState[] = [];
  for (let ri = 0; ri < config.rings.length; ri++) {
    const ring = config.rings[ri];
    const step = (Math.PI * 2) / ring.count;
    for (let m = 0; m < ring.count; m++) {
      // Stagger initial angles so motes don't all start at the same position
      const initAngle = step * m + (ri * Math.PI / config.rings.length);
      motes.push({
        angle:      initAngle,
        radius:     ring.baseRadius,
        baseRadius: ring.baseRadius,
        pulsePhase: initAngle * 1.7 + ri * 0.9,
        ringIdx:    ri,
      });
    }
  }

  s = {
    entityId,
    motes,
    prevHp: -1,     // -1 = not yet observed
    hitFlashTicks: 0,
    burstVelX: new Float32Array(totalMotes),
    burstVelY: new Float32Array(totalMotes),
    burstTicks: 0,
    wasDead: false,
  };
  _registry.set(entityId, s);
  return s;
}

// ── Per-frame update ──────────────────────────────────────────────────────────

// Death-burst animation constants
/** Fraction of burst window (0→1) at which the collapse phase ends and scatter begins. */
const BURST_COLLAPSE_THRESHOLD = 0.6;
/** Inward-collapse scale factor applied to baseRadius during collapse phase. */
const BURST_INWARD_SCALE = 0.8;
/** Outward-scatter scale factor applied to baseRadius during scatter phase. */
const BURST_OUTWARD_SCALE = 3.0;

/**
 * Deterministic pseudo-random noise in [-1, 1] for the given integer seed.
 * Uses the same Murmur-style integer hash as dustConstellationAi.ts.
 * Returns the same value for the same seed on every call (no hidden state).
 */
function _noise(seed: number): number {
  let h = seed ^ (seed >>> 7);
  h = Math.imul(h, 0x9e3779b9);
  h = h ^ (h >>> 15);
  h = Math.imul(h, 0x85ebca6b);
  return ((h >>> 0) / 0xffffffff) * 2.0 - 1.0;
}

function _update(state: _CoreState, isAlive: boolean, currentHp: number, config: DustCoreConfig): void {
  // ── Hit flash detection ─────────────────────────────────────────────────
  if (state.prevHp >= 0 && currentHp < state.prevHp && isAlive) {
    state.hitFlashTicks = HIT_FLASH_DURATION_TICKS;
  }
  if (state.prevHp < 0 || isAlive) {
    state.prevHp = currentHp;
  }
  if (state.hitFlashTicks > 0) state.hitFlashTicks--;

  // ── Death burst init (fires once when enemy dies) ───────────────────────
  if (!isAlive && !state.wasDead) {
    state.wasDead = true;
    state.burstTicks = BURST_DURATION_TICKS;
    for (let m = 0; m < state.motes.length; m++) {
      const mo = state.motes[m];
      // Outward impulse from core along each mote's current angle
      const speed = 1.5 + mo.baseRadius * 0.05 + _noise(m * 31 + 997) * 0.8;
      state.burstVelX[m] = Math.cos(mo.angle) * speed;
      state.burstVelY[m] = Math.sin(mo.angle) * speed;
    }
  }

  // ── Mote simulation ────────────────────────────────────────────────────
  const isHit      = state.hitFlashTicks > 0;
  const emphasisT  = (config.attackEmphasisT ?? 0);
  const atkDirX    = config.attackDirX ?? 0;
  const atkDirY    = config.attackDirY ?? 0;

  for (let m = 0; m < state.motes.length; m++) {
    const mo   = state.motes[m];
    const ring = config.rings[mo.ringIdx];
    const noiseSeed = m * 17 + Math.floor(mo.pulsePhase * 10);

    // Advance orbit angle (inner rings are faster)
    mo.angle += ring.angularSpeed;

    // Radius wobble: subtle sinusoidal deviation from base radius
    const wobble = Math.sin(mo.pulsePhase * 0.7 + m * 1.3) * ring.baseRadius * 0.12;
    const jitter = _noise(noiseSeed) * ring.baseRadius * 0.04;

    // Attack emphasis: motes near the attack direction stretch slightly outward
    let emphasisBoost = 0.0;
    if (emphasisT > 0.0 && (atkDirX !== 0 || atkDirY !== 0)) {
      const dot = Math.cos(mo.angle) * atkDirX + Math.sin(mo.angle) * atkDirY;
      // dot ∈ [-1,1]; aligned motes get a positive boost
      emphasisBoost = Math.max(0, dot) * emphasisT * ring.baseRadius * 0.35;
    }

    // Hit flash: briefly scatter motes outward
    let hitBoost = 0.0;
    if (isHit) {
      hitBoost = (state.hitFlashTicks / HIT_FLASH_DURATION_TICKS) * ring.baseRadius * 0.25;
    }

    mo.radius = ring.baseRadius + wobble + jitter + emphasisBoost + hitBoost;

    // Advance pulse phase (controls brightness)
    mo.pulsePhase += 0.065 + mo.ringIdx * 0.012;

    // Death burst: push motes outward
    if (state.burstTicks > 0) {
      const t = state.burstTicks / BURST_DURATION_TICKS;
      // Collapse briefly then burst outward (first 40% = inward, rest = outward)
      const collapsePhase = t > BURST_COLLAPSE_THRESHOLD ? (1.0 - t) / (1.0 - BURST_COLLAPSE_THRESHOLD) : 1.0;
      const burstScale = t > BURST_COLLAPSE_THRESHOLD
        ? -((t - BURST_COLLAPSE_THRESHOLD) / (1.0 - BURST_COLLAPSE_THRESHOLD)) * ring.baseRadius * BURST_INWARD_SCALE
        : (1.0 - t) * ring.baseRadius * BURST_OUTWARD_SCALE;
      mo.radius = ring.baseRadius * collapsePhase + burstScale;
      mo.angle += state.burstVelX[m] * 0.02;
    }
  }

  if (state.burstTicks > 0) state.burstTicks--;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _render(
  ctx: CanvasRenderingContext2D,
  state: _CoreState,
  screenX: number,
  screenY: number,
  scalePx: number,
  isAlive: boolean,
  globalTick: number,
  config: DustCoreConfig,
): void {
  const isHit      = state.hitFlashTicks > 0;
  const hitT       = state.hitFlashTicks / HIT_FLASH_DURATION_TICKS;
  const inBurst    = state.burstTicks > 0;
  const burstFade  = state.burstTicks / BURST_DURATION_TICKS;

  // Overall alpha: fade out during burst
  const globalAlpha = inBurst ? burstFade : 1.0;
  if (globalAlpha <= 0) return;

  // ── Draw motes ────────────────────────────────────────────────────────────
  const moteRadiusPx = Math.max(1, Math.round(1.8 * scalePx));
  const glowPx       = moteRadiusPx * 2 + 1;

  for (let m = 0; m < state.motes.length; m++) {
    const mo       = state.motes[m];
    const ring     = config.rings[mo.ringIdx];
    const brightness = 0.65 + Math.sin(mo.pulsePhase) * 0.35;
    const hitBright  = isHit ? (1.0 + hitT * 0.8) : 1.0;

    const mwx = screenX + Math.cos(mo.angle) * mo.radius * scalePx;
    const mwy = screenY + Math.sin(mo.angle) * mo.radius * scalePx;
    const mpx = Math.round(mwx);
    const mpy = Math.round(mwy);

    // Glow rect
    ctx.globalAlpha = globalAlpha * brightness * hitBright * 0.28;
    ctx.fillStyle   = ring.glowColor;
    ctx.fillRect(mpx - glowPx, mpy - glowPx, glowPx * 2, glowPx * 2);

    // Core pixel
    ctx.globalAlpha = globalAlpha * brightness * hitBright;
    ctx.fillStyle   = ring.color;
    ctx.fillRect(mpx - moteRadiusPx, mpy - moteRadiusPx, moteRadiusPx * 2, moteRadiusPx * 2);
  }

  ctx.globalAlpha = 1.0;

  if (!isAlive && !inBurst) return;

  // ── Draw core ─────────────────────────────────────────────────────────────
  const coreRadiusPx = Math.max(2, Math.round(config.coreRadiusWorld * scalePx));
  const coreGlowPx   = coreRadiusPx * 3;

  // Core pulse
  const corePulse = 0.75 + Math.sin(globalTick * 0.08) * 0.25;
  // Hit flash: briefly brighten/whiten the core
  const coreAlpha  = (isHit ? Math.min(1.0, 0.85 + hitT * 0.5) : 0.85) * globalAlpha;

  // Outer glow
  ctx.globalAlpha = coreAlpha * 0.35;
  ctx.fillStyle   = config.coreGlowColor;
  ctx.beginPath();
  ctx.arc(screenX, screenY, coreGlowPx, 0, Math.PI * 2);
  ctx.fill();

  // Mid pulse ring
  const pulseRadius = coreRadiusPx * (1.15 + 0.2 * corePulse);
  ctx.globalAlpha = coreAlpha * 0.45;
  ctx.strokeStyle = config.coreGlowColor;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(screenX, screenY, pulseRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Core disc
  ctx.globalAlpha = coreAlpha;
  ctx.fillStyle   = isHit ? '#ffffff' : config.coreColor;
  ctx.beginPath();
  ctx.arc(screenX, screenY, coreRadiusPx, 0, Math.PI * 2);
  ctx.fill();

  // Inner highlight
  ctx.globalAlpha = coreAlpha * 0.45;
  ctx.fillStyle   = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(
    screenX - coreRadiusPx * 0.28,
    screenY - coreRadiusPx * 0.28,
    coreRadiusPx * 0.38,
    0, Math.PI * 2,
  );
  ctx.fill();

  ctx.globalAlpha = 1.0;
}
