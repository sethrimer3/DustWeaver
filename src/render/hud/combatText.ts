/**
 * combatText.ts — Floating combat text system.
 *
 * Renders floating damage numbers and BLOCKED text on the virtual canvas.
 * Animation is driven by performance.now() — never by tick count, keeping
 * this module firmly in render/ with no sim dependencies.
 *
 * Visual design:
 *   - Enemy hit (player deals damage): gold numbers that pop and float upward.
 *   - Player hit (enemy deals damage): red numbers, larger and more urgent.
 *   - BLOCKED: cyan "BLOCKED" label that pops briefly in place then fades.
 *   - Larger damage amounts produce visually larger/brighter numbers.
 *   - All text has a dark stroke for readability on any background.
 */

/** How long a damage number stays visible (milliseconds). */
const DAMAGE_NUMBER_DURATION_MS = 1150;
/** How long BLOCKED text stays visible (milliseconds). */
const BLOCKED_DURATION_MS = 820;
/** Virtual pixels the floater drifts upward over its full lifetime. */
const FLOAT_RISE_PX = 22;
/** Pre-allocated pool size — oldest entry overwritten when full. */
const MAX_COMBAT_TEXT_ENTRIES = 48;

/** A single active floating text entry in the pre-allocated pool. */
interface CombatTextEntry {
  isActiveFlag: 0 | 1;
  xWorld: number;
  yWorld: number;
  /** Damage amount; 0 for BLOCKED entries. */
  amount: number;
  /** 1 = player was the damage target (red text); 0 = enemy was target (gold). */
  isPlayerTargetFlag: 0 | 1;
  /** 1 = this is a BLOCKED notice rather than a numeric damage value. */
  isBlockedFlag: 0 | 1;
  spawnMs: number;
  durationMs: number;
}

export interface CombatTextSystem {
  /** Spawn a numeric damage floater at a world-space position. */
  spawnDamage(
    xWorld: number,
    yWorld: number,
    amount: number,
    isPlayerTargetFlag: 0 | 1,
    nowMs: number,
  ): void;

  /** Spawn a BLOCKED floater at a world-space position. */
  spawnBlocked(xWorld: number, yWorld: number, nowMs: number): void;

  /**
   * Render all active entries to the virtual canvas.
   * Must be called after world geometry and HUD are drawn.
   */
  render(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    zoom: number,
    nowMs: number,
  ): void;
}

export function createCombatTextSystem(): CombatTextSystem {
  // Pre-allocate pool — no runtime allocations.
  const entries: CombatTextEntry[] = [];
  for (let i = 0; i < MAX_COMBAT_TEXT_ENTRIES; i++) {
    entries.push({
      isActiveFlag: 0,
      xWorld: 0,
      yWorld: 0,
      amount: 0,
      isPlayerTargetFlag: 0,
      isBlockedFlag: 0,
      spawnMs: 0,
      durationMs: 0,
    });
  }
  let nextSlot = 0;

  function _spawnEntry(
    xWorld: number,
    yWorld: number,
    amount: number,
    isPlayerTargetFlag: 0 | 1,
    isBlockedFlag: 0 | 1,
    nowMs: number,
  ): void {
    const e = entries[nextSlot];
    e.isActiveFlag = 1;
    e.xWorld = xWorld;
    e.yWorld = yWorld;
    e.amount = amount;
    e.isPlayerTargetFlag = isPlayerTargetFlag;
    e.isBlockedFlag = isBlockedFlag;
    e.spawnMs = nowMs;
    e.durationMs = isBlockedFlag === 1 ? BLOCKED_DURATION_MS : DAMAGE_NUMBER_DURATION_MS;
    nextSlot = (nextSlot + 1) % MAX_COMBAT_TEXT_ENTRIES;
  }

  return {
    spawnDamage(xWorld, yWorld, amount, isPlayerTargetFlag, nowMs) {
      _spawnEntry(xWorld, yWorld, amount, isPlayerTargetFlag, 0, nowMs);
    },

    spawnBlocked(xWorld, yWorld, nowMs) {
      _spawnEntry(xWorld, yWorld, 0, 1, 1, nowMs);
    },

    render(ctx, ox, oy, zoom, nowMs) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < MAX_COMBAT_TEXT_ENTRIES; i++) {
        const e = entries[i];
        if (e.isActiveFlag === 0) continue;

        const elapsedMs = nowMs - e.spawnMs;
        if (elapsedMs >= e.durationMs) {
          e.isActiveFlag = 0;
          continue;
        }

        const t = elapsedMs / e.durationMs; // normalised age [0, 1)

        // ── Per-kind animation parameters ────────────────────────────────
        let alpha: number;
        let scale: number;
        let riseOffsetPx: number;

        if (e.isBlockedFlag === 1) {
          // BLOCKED: fast pop-in, brief hold, quick fade.  No upward drift.
          const popT = Math.min(1.0, t * 6.0);          // 0→1 in first ~17%
          const easeOut = 1.0 - Math.pow(1.0 - popT, 3);  // cubic ease-out
          scale = 0.45 + 0.65 * easeOut;
          alpha = t < 0.55 ? 1.0 : 1.0 - (t - 0.55) / 0.45;
          riseOffsetPx = 0;
        } else {
          // Damage number: sharp scale pop, then float upward and fade.
          const popPhase = Math.min(1.0, t * 5.0);       // 0→1 in first 20%
          const popEase  = 1.0 - Math.pow(1.0 - popPhase, 2.5);
          // Overshoot slightly then settle: peak scale ~1.25 at 20%, back to 1.0
          const overshoot = Math.sin(popPhase * Math.PI) * 0.28;
          scale = 0.55 + 0.45 * popEase + overshoot;
          alpha = t < 0.65 ? 1.0 : 1.0 - (t - 0.65) / 0.35;
          riseOffsetPx = FLOAT_RISE_PX * Math.sqrt(t);   // ease-in rise
        }

        if (alpha <= 0.01) { e.isActiveFlag = 0; continue; }

        // ── World → screen coordinate conversion ─────────────────────────
        const sx = e.xWorld * zoom + ox;
        const sy = e.yWorld * zoom + oy - riseOffsetPx;

        // ── Font size based on kind and damage amount ─────────────────────
        let fontSizePx: number;
        let fillColor: string;
        let strokeColor: string;
        let strokeWidth: number;

        if (e.isBlockedFlag === 1) {
          fontSizePx = 7;
          fillColor  = '#00e8ff';
          strokeColor = '#002233';
          strokeWidth = 2.5;
        } else if (e.isPlayerTargetFlag === 1) {
          // Player hurt — urgent red; larger for bigger hits.
          const sizeBoost = Math.min(1.5, 0.85 + e.amount * 0.22);
          fontSizePx  = Math.round(9 * sizeBoost);
          fillColor   = '#ff2e2e';
          strokeColor = '#3a0000';
          strokeWidth = 3.0;
        } else {
          // Enemy hurt — gold; scales with damage but stays readable.
          const sizeBoost = Math.min(1.6, 0.75 + e.amount * 0.12);
          fontSizePx  = Math.round(8 * sizeBoost);
          fillColor   = '#ffe060';
          strokeColor = '#3a1a00';
          strokeWidth = 2.5;
        }

        const displayText = e.isBlockedFlag === 1 ? 'BLOCKED' : `${e.amount}`;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(sx, sy);
        ctx.scale(scale, scale);

        ctx.font = `bold ${fontSizePx}px monospace`;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = strokeColor;
        ctx.strokeText(displayText, 0, 0);
        ctx.fillStyle = fillColor;
        ctx.fillText(displayText, 0, 0);

        ctx.restore();
      }

      ctx.restore();
    },
  };
}
