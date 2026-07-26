/**
 * gameHudRenderer.ts — HUD overlay rendering for the main game frame.
 *
 * Handles all screen-space HUD layers drawn after the room clip is closed:
 *   • Debug overlay and room name banner
 *   • Player health bar (top-left, above dust display)
 *   • Dust container display (top-left, below health bar)
 *   • Enemy health bar event detection and per-enemy bar drawing
 *   • Floating combat text (damage numbers, BLOCKED)
 */

import type { WorldState } from '../sim/world';
import type { HudState } from '../render/hud/overlay';
import type { CombatTextSystem } from '../render/hud/combatText';
import type { RenderProfiler } from '../render/hud/renderProfiler';
import { getPlayerMoteCapacity, getPlayerMoteCount } from '../sim/playerMoteLife';
import {
  getMoteLifeColumnCount,
  getMoteLifeSlotPosition,
  MOTE_LIFE_ORIGIN_Y_PX,
  MOTE_LIFE_SLOT_GAP_PX,
  MOTE_LIFE_SLOT_WIDTH_PX,
  MOTE_LIFE_SLOT_HEIGHT_PX,
} from '../render/hud/moteLifeSlots';
import { drawAnimatedDustContainer } from '../render/hud/dustContainerAnimation';
import { formatRunTimer } from '../progression/saveSlots';
import { drawChallengeHudShield } from '../render/challengeElementRenderer';
import { getSpeedrunTimerEnabled } from '../ui/renderSettings';

// ── HUD layout constants ────────────────────────────────────────────────────

// Health bar dimensions (virtual pixels)
const HUD_HEALTH_BAR_X_PX     = 8;
const HUD_HEALTH_BAR_Y_PX     = 8;
const HUD_HEALTH_BAR_WIDTH_PX = 60;
const HUD_HEALTH_BAR_HEIGHT_PX = 6;

// Health fraction thresholds for visual escalation
const HEALTH_THRESHOLD_DANGER_FRACTION   = 0.40;  // below this → amber warning
const HEALTH_THRESHOLD_CRITICAL_FRACTION = 0.20;  // below this → pulsing red alert

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

/** Temporary health-bar visibility test: not final tuning, just comparing what works better for the game. */
const HEALTH_BAR_FADE_MS = 350;
/** Temporary health-bar visibility test: not final tuning, just comparing what works better for the game. */
const HEALTH_BAR_HOLD_VISIBLE_MS = 3000;
/** Temporary health-bar visibility test: not final tuning, just comparing what works better for the game. */
const HEALTH_BAR_HOLD_HIDDEN_MS = 3000;
const HEALTH_BAR_FADE_TICKS = Math.max(1, Math.round(HEALTH_BAR_FADE_MS / FIXED_DT_MS));
const HEALTH_BAR_HOLD_VISIBLE_TICKS = Math.round(HEALTH_BAR_HOLD_VISIBLE_MS / FIXED_DT_MS);
const HEALTH_BAR_HOLD_HIDDEN_TICKS = Math.round(HEALTH_BAR_HOLD_HIDDEN_MS / FIXED_DT_MS);
const HEALTH_BAR_CYCLE_TICKS =
  HEALTH_BAR_FADE_TICKS * 2 + HEALTH_BAR_HOLD_VISIBLE_TICKS + HEALTH_BAR_HOLD_HIDDEN_TICKS;

// ── HUD context interface ───────────────────────────────────────────────────

/** Subset of RenderFrameContext fields needed by renderGameHud(). */
export interface HudRenderContext {
  ctx: CanvasRenderingContext2D;
  world: WorldState;
  isChallengeModeActive: boolean;
  ox: number;
  oy: number;
  zoom: number;
  virtualWidthPx: number;
  isDebugMode: boolean;
  hudState: HudState;
  currentRoom: { name: string };
  prevHealthMap: Map<number, number>;
  healthBarDisplayUntilTick: Map<number, number>;
  combatText: CombatTextSystem;
  prevLastPlayerBlockedTick: { value: number };
  /** When provided, the render profiler panel is drawn in the top-right corner. */
  renderProfiler?: RenderProfiler;
  /** Current speedrun timer value in milliseconds (0 = not started).
   * Displayed as MM:SS.mmm in the top-right corner. */
  runTimerMs: number;
}

function getHealthBarAlpha(
  entityId: number,
  healthFraction: number,
  currentTick: number,
  healthBarDisplayUntilTick: Map<number, number>,
): number {
  if (healthFraction >= 1) {
    healthBarDisplayUntilTick.delete(entityId);
    return 0;
  }

  let cycleStartTick = healthBarDisplayUntilTick.get(entityId);
  if (cycleStartTick === undefined) {
    cycleStartTick = currentTick;
    healthBarDisplayUntilTick.set(entityId, cycleStartTick);
  }

  const cycleTick = (currentTick - cycleStartTick) % HEALTH_BAR_CYCLE_TICKS;
  if (cycleTick < HEALTH_BAR_FADE_TICKS) {
    return cycleTick / HEALTH_BAR_FADE_TICKS;
  }

  const visibleEndTick = HEALTH_BAR_FADE_TICKS + HEALTH_BAR_HOLD_VISIBLE_TICKS;
  if (cycleTick < visibleEndTick) {
    return 1;
  }

  const fadeOutEndTick = visibleEndTick + HEALTH_BAR_FADE_TICKS;
  if (cycleTick < fadeOutEndTick) {
    return 1 - (cycleTick - visibleEndTick) / HEALTH_BAR_FADE_TICKS;
  }

  return 0;
}

/**
 * Render all HUD layers onto the virtual canvas.
 * Called after the room clip is closed so HUD elements sit above all world
 * geometry and are not clipped to the room rectangle.
 *
 * @param r     HUD context holding all required render state.
 * @param nowMs Current wall-clock time in milliseconds (from performance.now()).
 */
export function renderGameHud(r: HudRenderContext, nowMs: number): void {
  const {
    ctx, world, ox, oy, zoom,
    prevHealthMap, healthBarDisplayUntilTick,
    combatText, prevLastPlayerBlockedTick,
  } = r;

  // ── Player health bar in HUD (top-left, above dust display) ─────────────
  if (getSpeedrunTimerEnabled()) {
    const playerForHealth = world.clusters[0];
    // Retained temporarily for legacy health-bar tuning reference; runtime
    // player ticks are non-negative, so only the mote-slot HUD below is drawn.
    if (world.tick < 0 && playerForHealth !== undefined && playerForHealth.isAliveFlag === 1) {
      const healthFraction = playerForHealth.healthPoints / playerForHealth.maxHealthPoints;
      const healthBarAlpha = r.isChallengeModeActive ? 1 : getHealthBarAlpha(
        playerForHealth.entityId,
        healthFraction,
        world.tick,
        healthBarDisplayUntilTick,
      );
      if (healthBarAlpha > 0) {
      const isCritical = healthFraction < HEALTH_THRESHOLD_CRITICAL_FRACTION;
      const isDanger   = healthFraction < HEALTH_THRESHOLD_DANGER_FRACTION;

      const barX = HUD_HEALTH_BAR_X_PX;
      const barY = HUD_HEALTH_BAR_Y_PX;
      const barW = HUD_HEALTH_BAR_WIDTH_PX;
      const barH = HUD_HEALTH_BAR_HEIGHT_PX;
      const fillW = barW * Math.max(0, healthFraction);

      ctx.save();
      ctx.globalAlpha *= healthBarAlpha;

      // ── Outer danger glow at critical health (pulsing shadow) ────────────
      if (isCritical) {
        const pulseT = (Math.sin(nowMs * 0.008) + 1) * 0.5;  // 0..1 at ~0.76 Hz
        ctx.shadowBlur  = 5 + 7 * pulseT;
        ctx.shadowColor = `rgba(255,25,25,${0.55 + 0.45 * pulseT})`;
      } else if (isDanger) {
        ctx.shadowBlur  = 3;
        ctx.shadowColor = 'rgba(255,140,0,0.45)';
      }

      // ── Gold outline — 1 px outside the bar bounds ────────────────────────
      ctx.strokeStyle = '#c89820';
      ctx.lineWidth   = 1;
      // strokeRect draws centered on the path, so offset by 0.5 px to align
      // precisely to the pixel grid.
      ctx.strokeRect(barX - 1.5, barY - 1.5, barW + 3, barH + 3);

      ctx.shadowBlur = 0;  // reset before fill draws

      // ── Dark background ────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(barX, barY, barW, barH);

      // ── Health fill — color escalates with urgency ─────────────────────────
      let fillColor: string;
      if (isCritical) {
        // Pulsing between deep red and bright red for maximum urgency.
        const pulseT = (Math.sin(nowMs * 0.008) + 1) * 0.5;
        const rHigh  = Math.round(210 + 45 * pulseT);
        fillColor = `rgb(${rHigh},25,25)`;
      } else if (isDanger) {
        fillColor = '#e07000';  // amber-orange warning
      } else {
        fillColor = '#00b866';  // rich green — healthy
      }

      if (fillW > 0) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(barX, barY, fillW, barH);

        // ── Inner shine: 1 px lighter strip along the top edge ───────────────
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(barX, barY, fillW, 1);

        // ── Subtle dividers at 25 / 50 / 75 % so fractions read at a glance ──
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let q = 1; q <= 3; q++) {
          const divX = barX + barW * (q * 0.25);
          if (divX < barX + fillW) {
            ctx.fillRect(divX - 0.5, barY + 1, 1, barH - 1);
          }
        }
      }

      // ── Thin dark inner border (gives a recessed look) ────────────────────
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

      if (r.isChallengeModeActive) {
        drawChallengeHudShield(ctx, barX + barW * 0.5, barY + barH * 0.5);
      }

      ctx.fillStyle = '#0066ff';
      ctx.fillRect(barX + barW + 3, barY, 1, 1);

      ctx.restore();
      }
    }
  }

  // ── Dust container display (top-left, below health bar) ───────────────────
  // Container outlines come from owned capacity (playerContainerCount) so they
  // persist even when no dust type is unlocked or no live particles exist.
  // Quadrant fills come from live particle count so they reflect the current
  // in-world dust amount.
  const playerForMoteLife = world.clusters[0];
  const currentMoteCount = playerForMoteLife ? getPlayerMoteCount(playerForMoteLife) : 0;
  const maxMoteCapacity = playerForMoteLife ? getPlayerMoteCapacity(playerForMoteLife) : 0;
  const dustSquareWidth = MOTE_LIFE_SLOT_WIDTH_PX;
  const dustSquareHeight = MOTE_LIFE_SLOT_HEIGHT_PX;
  const dustStartX = 8;

  ctx.save();
  for (let moteIndex = 0; moteIndex < maxMoteCapacity; moteIndex++) {
    const slot = getMoteLifeSlotPosition(moteIndex);
    const isFilled = moteIndex < currentMoteCount;
    drawAnimatedDustContainer(ctx, slot.xPx, slot.yPx, dustSquareWidth, dustSquareHeight, isFilled, moteIndex, nowMs);
  }
  const moteLifeColumnCount = getMoteLifeColumnCount(maxMoteCapacity);
  if (r.isChallengeModeActive && moteLifeColumnCount > 0) {
    drawChallengeHudShield(ctx, dustStartX + moteLifeColumnCount * (dustSquareWidth + MOTE_LIFE_SLOT_GAP_PX) + 4, MOTE_LIFE_ORIGIN_Y_PX + 6);
  }
  ctx.restore();

  // ── Health bar / combat-text event detection ──────────────────────────────
  // Detect BLOCKED events (armor absorbed a full hit) and spawn floater text.
  {
    const currentBlockedTick = world.lastPlayerBlockedTick;
    if (currentBlockedTick !== prevLastPlayerBlockedTick.value && currentBlockedTick >= 0) {
      prevLastPlayerBlockedTick.value = currentBlockedTick;
      const player = world.clusters[0];
      if (player !== undefined && player.isAliveFlag === 1) {
        combatText.spawnBlocked(player.positionXWorld, player.positionYWorld, nowMs);
      }
    }
  }

  // Enemy health bar display: only while below full health.
  // Hoist constant canvas state outside the per-enemy loop to avoid redundant
  // state-change calls and one save/restore pair per live enemy.
  ctx.save();
  ctx.strokeStyle = '#a07800';
  ctx.lineWidth   = 0.5;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const prevHealth = prevHealthMap.get(cluster.entityId) ?? cluster.maxHealthPoints;
    const healthDelta = prevHealth - cluster.healthPoints;

    // Spawn damage floater when health decreased for any cluster.
    if (healthDelta > 0) {
      if (cluster.isPlayerFlag === 1) {
        // Player was damaged — spawn urgent red floater above player.
        combatText.spawnDamage(
          cluster.positionXWorld,
          cluster.positionYWorld - cluster.halfHeightWorld,
          healthDelta,
          1,
          nowMs,
        );
      } else {
        // Enemy was damaged — spawn gold floater above the enemy.
        combatText.spawnDamage(
          cluster.positionXWorld,
          cluster.positionYWorld - cluster.halfHeightWorld,
          healthDelta,
          0,
          nowMs,
        );
      }
    }

    // Update tracked health for next frame.
    prevHealthMap.set(cluster.entityId, cluster.healthPoints);

    // Player health bar is in the HUD; skip per-character bar for player.
    if (cluster.isPlayerFlag === 1) continue;

    const healthFraction = cluster.healthPoints / cluster.maxHealthPoints;
    const healthBarAlpha = getHealthBarAlpha(
      cluster.entityId,
      healthFraction,
      world.tick,
      healthBarDisplayUntilTick,
    );
    if (healthBarAlpha <= 0) continue;

    const barWidth  = 24;
    const barHeight = 3;
    const barX = cluster.positionXWorld * zoom + ox - barWidth / 2;
    const barY = (cluster.positionYWorld - cluster.halfHeightWorld - 5) * zoom + oy;

    ctx.globalAlpha = healthBarAlpha;
    // Thin gold outline
    ctx.strokeRect(barX - 0.5, barY - 0.5, barWidth + 1, barHeight + 1);
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    // Health fill — red for enemies
    const enemyFillW = barWidth * Math.max(0, healthFraction);
    if (enemyFillW > 0) {
      ctx.fillStyle = '#cc3333';
      ctx.fillRect(barX, barY, enemyFillW, barHeight);
      // Shine
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(barX, barY, enemyFillW, 1);
    }
    ctx.fillStyle = '#0066ff';
    ctx.fillRect(barX + barWidth + 2, barY, 1, 1);
  }
  ctx.restore();

  // ── Floating combat text (damage numbers, BLOCKED) ────────────────────────
  combatText.render(ctx, ox, oy, zoom, nowMs);

  // ── Speedrun timer (top-right corner) ─────────────────────────────────────
  // Opt-in setting, off by default. Uses monospace format MM:SS.mmm / H:MM:SS.mmm.
  {
    const timerText = formatRunTimer(r.runTimerMs);
    const timerPaddingRight = 6;
    const timerY = 10;
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    // Dark shadow for legibility over any background.
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(timerText, r.virtualWidthPx - timerPaddingRight + 1, timerY + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(timerText, r.virtualWidthPx - timerPaddingRight, timerY);
    ctx.restore();
  }

}
