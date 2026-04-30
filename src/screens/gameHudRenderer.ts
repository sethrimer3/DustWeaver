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
import { renderHudOverlay } from '../render/hud/overlay';
import type { HudState } from '../render/hud/overlay';
import type { CombatTextSystem } from '../render/hud/combatText';
import { DUST_PARTICLES_PER_CONTAINER } from './gameSpawn';
import { HEALTH_BAR_DISPLAY_MS } from './gameRoom';
import {
  getTotalMoteSlotCount,
  getAvailableMoteSlotCount,
  getEffectiveGrappleRangeWorld,
  MOTE_STATE_AVAILABLE,
  MOTE_STATE_DEPLETED,
  BASE_MOTE_REGENERATION_TICKS,
} from '../sim/motes/orderedMoteQueue';

// ── HUD layout constants ────────────────────────────────────────────────────

// Health bar dimensions (virtual pixels)
const HUD_HEALTH_BAR_X_PX     = 8;
const HUD_HEALTH_BAR_Y_PX     = 8;
const HUD_HEALTH_BAR_WIDTH_PX = 60;
const HUD_HEALTH_BAR_HEIGHT_PX = 6;
const HUD_HEALTH_DUST_GAP_PX  = 4;

// Health fraction thresholds for visual escalation
const HEALTH_THRESHOLD_DANGER_FRACTION   = 0.40;  // below this → amber warning
const HEALTH_THRESHOLD_CRITICAL_FRACTION = 0.20;  // below this → pulsing red alert

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

// ── HUD context interface ───────────────────────────────────────────────────

/** Subset of RenderFrameContext fields needed by renderGameHud(). */
export interface HudRenderContext {
  ctx: CanvasRenderingContext2D;
  world: WorldState;
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
  getPlayerDustCount: () => number;
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
    ctx, world, ox, oy, zoom, virtualWidthPx,
    isDebugMode, hudState, currentRoom,
    prevHealthMap, healthBarDisplayUntilTick,
    combatText, prevLastPlayerBlockedTick,
    getPlayerDustCount,
  } = r;

  // ── Debug-only overlay and room name banner ─────────────────────────────────
  if (isDebugMode) {
    renderHudOverlay(ctx, hudState);

    // ── Room name banner (top-center) ──────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '7px monospace';
    const roomLabel = currentRoom.name;
    const labelW = ctx.measureText(roomLabel).width;
    ctx.fillText(roomLabel, (virtualWidthPx - labelW) / 2, 22);

    // ── Mote Queue debug overlay (top-right corner) ─────────────────────────
    {
      const totalSlots     = getTotalMoteSlotCount(world);
      const availableSlots = getAvailableMoteSlotCount(world);
      const depletedSlots  = totalSlots - availableSlots;
      const ratio          = totalSlots > 0 ? availableSlots / totalSlots : 1.0;
      const effectiveRange = getEffectiveGrappleRangeWorld(world);
      const displayRadius  = world.moteGrappleDisplayRadiusWorld;

      // Build slot-state bar: green dots for available, red for depleted
      let slotBar = '';
      for (let i = 0; i < world.moteSlotCount; i++) {
        slotBar += world.moteSlotState[i] === MOTE_STATE_DEPLETED ? '○' : '●';
      }

      const moteLines = [
        `Motes: ${availableSlots}/${totalSlots} (${(ratio * 100).toFixed(0)}%)`,
        `Depleted: ${depletedSlots}`,
        `Range eff: ${effectiveRange.toFixed(1)}  disp: ${displayRadius.toFixed(1)}`,
        slotBar || '(no motes)',
      ];

      ctx.save();
      ctx.font = '7px monospace';
      const lineH = 9;
      const padX  = 4;
      const padY  = 4;
      const panelW = 150;
      const panelH = moteLines.length * lineH + padY * 2;
      const panelX = virtualWidthPx - panelW - padX;
      const panelY = padY;

      ctx.fillStyle = 'rgba(0,0,0,0.50)';
      ctx.fillRect(panelX, panelY, panelW, panelH);

      ctx.fillStyle = '#b0f080';
      for (let li = 0; li < moteLines.length; li++) {
        ctx.fillText(moteLines[li], panelX + padX, panelY + padY + (li + 1) * lineH - 2);
      }
      ctx.restore();
    }
  }

  // ── Player health bar in HUD (top-left, above dust display) ─────────────
  {
    const playerForHealth = world.clusters[0];
    if (playerForHealth !== undefined && playerForHealth.isAliveFlag === 1) {
      const healthFraction = playerForHealth.healthPoints / playerForHealth.maxHealthPoints;
      const isCritical = healthFraction < HEALTH_THRESHOLD_CRITICAL_FRACTION;
      const isDanger   = healthFraction < HEALTH_THRESHOLD_DANGER_FRACTION;

      const barX = HUD_HEALTH_BAR_X_PX;
      const barY = HUD_HEALTH_BAR_Y_PX;
      const barW = HUD_HEALTH_BAR_WIDTH_PX;
      const barH = HUD_HEALTH_BAR_HEIGHT_PX;
      const fillW = barW * Math.max(0, healthFraction);

      ctx.save();

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

      ctx.restore();
    }
  }

  // ── Dust container display (top-left, below health bar) ───────────────────
  const dustCount = getPlayerDustCount();
  const fullContainers = Math.floor(dustCount / DUST_PARTICLES_PER_CONTAINER);
  const partialDust = dustCount % DUST_PARTICLES_PER_CONTAINER;
  const dustSquareSize = 8;
  const dustPadding = 2;
  const dustStartX = 8;
  const dustStartY = HUD_HEALTH_BAR_Y_PX + HUD_HEALTH_BAR_HEIGHT_PX + HUD_HEALTH_DUST_GAP_PX;

  ctx.save();
  for (let i = 0; i < fullContainers + (partialDust > 0 ? 1 : 0); i++) {
    const squareX = dustStartX + i * (dustSquareSize + dustPadding);
    const isPartial = i === fullContainers;
    const quadrantsActive = isPartial ? partialDust : DUST_PARTICLES_PER_CONTAINER;

    // Draw square background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(squareX, dustStartY, dustSquareSize, dustSquareSize);

    // Draw quadrants (2x2 grid) - direct indexing to avoid allocation
    const halfSize = dustSquareSize / 2;

    for (let q = 0; q < quadrantsActive; q++) {
      const qx = (q % 2) * halfSize;
      const qy = Math.floor(q / 2) * halfSize;
      ctx.fillStyle = 'rgba(212,168,75,0.9)'; // golden dust color
      ctx.fillRect(squareX + qx + 0.5, dustStartY + qy + 0.5, halfSize - 1, halfSize - 1);
    }

    // Draw border
    ctx.strokeStyle = 'rgba(212,168,75,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(squareX + 0.5, dustStartY + 0.5, dustSquareSize - 1, dustSquareSize - 1);
  }
  ctx.restore();

  // ── Mote Queue display (top-left, below dust containers) ──────────────────
  // Always visible when the player has a configured mote queue.
  // Available motes: bright gold square.  Depleted motes: dark square with
  // a clockwise cooldown arc that grows as the mote regenerates.
  if (world.moteSlotCount > 0) {
    /** Side length of each mote indicator (virtual pixels). */
    const MOTE_DOT_SIZE_PX = 5;
    /** Gap between consecutive mote indicators (virtual pixels). */
    const MOTE_DOT_GAP_PX  = 2;
    /** Vertical gap between the dust-container row and the mote row. */
    const MOTE_ROW_GAP_PX  = 3;

    const moteRowXPx = dustStartX;
    const moteRowYPx = dustStartY + dustSquareSize + MOTE_ROW_GAP_PX;

    ctx.save();
    for (let mi = 0; mi < world.moteSlotCount; mi++) {
      const mxPx = moteRowXPx + mi * (MOTE_DOT_SIZE_PX + MOTE_DOT_GAP_PX);
      const myPx = moteRowYPx;
      const isAvailable = world.moteSlotState[mi] === MOTE_STATE_AVAILABLE;

      // Background fill
      ctx.fillStyle = isAvailable ? 'rgba(255,215,0,0.88)' : 'rgba(18,14,4,0.85)';
      ctx.fillRect(mxPx, myPx, MOTE_DOT_SIZE_PX, MOTE_DOT_SIZE_PX);

      if (isAvailable) {
        // Shine strip along the top edge — matches the dust container style.
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(mxPx, myPx, MOTE_DOT_SIZE_PX, 1);
      } else {
        // Cooldown arc: sweeps clockwise from the top (−π/2) and grows toward
        // a full circle as the mote approaches regeneration.
        const cooldownTicksLeft = world.moteSlotCooldownTicksLeft[mi];
        const regenFraction   = cooldownTicksLeft > 0
          ? 1.0 - cooldownTicksLeft / BASE_MOTE_REGENERATION_TICKS
          : 1.0;
        if (regenFraction > 0) {
          const cxPx = mxPx + MOTE_DOT_SIZE_PX * 0.5;
          const cyPx = myPx + MOTE_DOT_SIZE_PX * 0.5;
          const rPx  = MOTE_DOT_SIZE_PX * 0.5 - 0.5;
          ctx.strokeStyle = 'rgba(255,215,0,0.65)';
          ctx.lineWidth   = 1.0;
          ctx.beginPath();
          ctx.arc(
            cxPx, cyPx, rPx,
            -Math.PI * 0.5,
            -Math.PI * 0.5 + regenFraction * 2 * Math.PI,
          );
          ctx.stroke();
        }
      }

      // Thin border — gold for available, subdued amber for depleted.
      ctx.strokeStyle = isAvailable ? 'rgba(200,160,40,0.75)' : 'rgba(70,55,15,0.55)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(mxPx + 0.25, myPx + 0.25, MOTE_DOT_SIZE_PX - 0.5, MOTE_DOT_SIZE_PX - 0.5);
    }
    ctx.restore();
  }

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

  // ── Enemy health bar display (only when damaged) ──────────────────────────
  const healthBarDisplayTicks = Math.floor(HEALTH_BAR_DISPLAY_MS / FIXED_DT_MS);
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

    // Check for health changes to trigger enemy health bar display.
    if (healthDelta > 0) {
      healthBarDisplayUntilTick.set(cluster.entityId, world.tick + healthBarDisplayTicks);
    }

    // Only show health bar if recently damaged (tick-based).
    const displayUntilTick = healthBarDisplayUntilTick.get(cluster.entityId) ?? 0;
    if (world.tick > displayUntilTick) continue;

    const healthFraction = cluster.healthPoints / cluster.maxHealthPoints;
    const barWidth  = 24;
    const barHeight = 3;
    const barX = cluster.positionXWorld * zoom + ox - barWidth / 2;
    const barY = (cluster.positionYWorld - cluster.halfHeightWorld - 5) * zoom + oy;

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
  }
  ctx.restore();

  // ── Floating combat text (damage numbers, BLOCKED) ────────────────────────
  combatText.render(ctx, ox, oy, zoom, nowMs);
}
