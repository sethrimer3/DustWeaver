/**
 * gameRender.ts — Rendering orchestration for the main game frame.
 *
 * Owns all canvas draw calls: background, world geometry, particles, HUD
 * overlays, device-canvas upscale, and touch-joystick visuals.
 *
 * No simulation state is mutated here — the function reads world/room state
 * and writes only to canvas contexts.  Health-bar display Maps are updated
 * in-place (passed by reference) as part of the HUD tracking logic.
 */

import { createSnapshot } from '../render/snapshot';
import type { WorldState } from '../sim/world';
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ParticleKind } from '../sim/particles/kinds';
import { renderWorldBackground } from '../render/backgroundRenderer';
import { renderWalls, renderClusters, renderGrapple } from '../render/clusters/renderer';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';
import { renderHazards } from '../render/hazards';
import { renderParticles } from '../render/particles/renderer';
import { renderHudOverlay } from '../render/hud/overlay';
import type { HudState } from '../render/hud/overlay';
import type { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import type { EnvironmentalDustLayer } from '../render/environmentalDust';
import type { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import { isTheroShowcaseRoom, renderTheroShowcaseEffect } from '../render/effects/theroEffectManager';
import type { InputState } from '../input/handler';
import { JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import { DUST_PARTICLES_PER_CONTAINER } from './gameSpawn';
import {
  drawTunnelDarkness,
  SKILLBOOK_SIZE_WORLD,
  DUST_CONTAINER_SIZE_WORLD,
  HEALTH_BAR_DISPLAY_MS,
} from './gameRoom';
import type { PlayerProgress } from '../progression/playerProgress';

// ── Constants ──────────────────────────────────────────────────────────────

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

/** Touch joystick outer radius matches the max drag radius from handler.ts. */
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// HUD layout
const HUD_HEALTH_BAR_X_PX = 8;
const HUD_HEALTH_BAR_Y_PX = 8;
const HUD_HEALTH_BAR_WIDTH_PX = 50;
const HUD_HEALTH_BAR_HEIGHT_PX = 4;
const HUD_HEALTH_DUST_GAP_PX = 3;

// ── Public interface ───────────────────────────────────────────────────────

/** All data needed by `renderFrame` — avoids a 20+ positional parameter list. */
export interface RenderFrameContext {
  // Canvas contexts
  ctx: CanvasRenderingContext2D;
  deviceCtx: CanvasRenderingContext2D;
  virtualCanvas: HTMLCanvasElement;
  canvas: HTMLCanvasElement;

  // Renderer instances
  webglRenderer: WebGLParticleRenderer;
  environmentalDust: EnvironmentalDustLayer;
  skidDebris: SkidDebrisRenderer;
  skillTombRenderer: SkillTombRenderer;

  // World / room
  world: WorldState;
  currentRoom: RoomDef;

  // Camera
  ox: number;
  oy: number;
  zoom: number;
  virtualWidthPx: number;
  virtualHeightPx: number;

  // Display state
  bgColor: string;
  isDebugMode: boolean;
  hudState: HudState;
  inputState: InputState;

  // Health-bar tracking (mutated in-place)
  prevHealthMap: Map<number, number>;
  healthBarDisplayUntilTick: Map<number, number>;

  // Collectibles
  collectedDustContainerKeySet: Set<string>;
  isSkillBookSpriteLoaded: boolean;
  isDustContainerSpriteLoaded: boolean;
  skillBookSprite: HTMLImageElement;
  dustContainerSprite: HTMLImageElement;

  // Progression
  progress: PlayerProgress | undefined;

  // Callbacks
  getPlayerDustCount: () => number;
}

/**
 * Render a single frame to the virtual canvas and upscale to the device
 * canvas.  Handles every rendering layer: world background, geometry,
 * particles, HUD, touch-joystick overlay.
 */
export function renderFrame(r: RenderFrameContext): void {
  const {
    ctx, deviceCtx, virtualCanvas, canvas,
    webglRenderer, environmentalDust, skidDebris, skillTombRenderer,
    world, currentRoom,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx,
    bgColor, isDebugMode, hudState, inputState,
    prevHealthMap, healthBarDisplayUntilTick,
    collectedDustContainerKeySet,
    isSkillBookSpriteLoaded, isDustContainerSpriteLoaded,
    skillBookSprite, dustContainerSprite,
    progress,
    getPlayerDustCount,
  } = r;

  const snapshot = createSnapshot(world);

  // ── Clear / fill virtual canvas ─────────────────────────────────────────
  if (webglRenderer.isAvailable) {
    webglRenderer.render(snapshot, ox, oy, zoom);
    ctx.clearRect(0, 0, virtualWidthPx, virtualHeightPx);
  } else {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
  }

  // ── World background with parallax ──────────────────────────────────────
  renderWorldBackground(
    ctx,
    currentRoom.worldNumber,
    virtualWidthPx,
    virtualHeightPx,
    ox,
    oy,
    currentRoom.widthBlocks * BLOCK_SIZE_SMALL,
    currentRoom.heightBlocks * BLOCK_SIZE_SMALL,
    zoom,
  );

  // ── Thero effect showcase overlay (worldNumber=99 rooms) ────────────────
  if (isTheroShowcaseRoom(currentRoom.id)) {
    renderTheroShowcaseEffect(ctx, currentRoom.id, virtualWidthPx, virtualHeightPx, performance.now());
  }

  // Walls before cluster indicators so clusters are drawn on top
  renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);

  // Environmental hazards (water/lava zones behind, spikes/jars/fireflies on top)
  renderHazards(ctx, world, ox, oy, zoom, world.tick);

  renderClusters(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderRadiantTether(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderGrapple(ctx, snapshot, ox, oy, zoom);

  // Tunnel darkness overlays
  drawTunnelDarkness(ctx, currentRoom, ox, oy, zoom);

  environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);
  skidDebris.render(ctx, ox, oy, zoom);

  // Skill tombs (sprite + dust particles)
  skillTombRenderer.render(ctx, ox, oy, zoom);

  // Skill books (collectibles)
  if (isSkillBookSpriteLoaded && progress && !progress.unlockedDustKinds.includes(ParticleKind.Physical)) {
    const roomSkillBooks = currentRoom.skillBooks ?? [];
    const bobOffsetWorld = Math.sin(performance.now() * 0.004) * 2.0;
    for (let i = 0; i < roomSkillBooks.length; i++) {
      const sb = roomSkillBooks[i];
      const sx = (sb.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const sy = (sb.yBlock + 0.5) * BLOCK_SIZE_MEDIUM + bobOffsetWorld;
      const drawSize = SKILLBOOK_SIZE_WORLD * zoom;
      ctx.drawImage(
        skillBookSprite,
        sx * zoom + ox - drawSize * 0.5,
        sy * zoom + oy - drawSize * 0.5,
        drawSize,
        drawSize,
      );
    }
  }

  // Dust containers (collectibles)
  if (isDustContainerSpriteLoaded) {
    const roomDustContainers = currentRoom.dustContainers ?? [];
    const bobOffsetWorld = Math.sin(performance.now() * 0.0032) * 1.5;
    for (let i = 0; i < roomDustContainers.length; i++) {
      const pickupKey = `${currentRoom.id}:${i}`;
      if (collectedDustContainerKeySet.has(pickupKey)) continue;

      const dc = roomDustContainers[i];
      const dx = (dc.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const dy = (dc.yBlock + 0.5) * BLOCK_SIZE_MEDIUM + bobOffsetWorld;
      const drawSize = DUST_CONTAINER_SIZE_WORLD * zoom;
      ctx.drawImage(
        dustContainerSprite,
        dx * zoom + ox - drawSize * 0.5,
        dy * zoom + oy - drawSize * 0.5,
        drawSize,
        drawSize,
      );
    }
  }

  // Particles drawn on top of all game layers (Canvas 2D fallback only —
  // WebGL renders to its own offscreen canvas at virtual resolution)
  if (!webglRenderer.isAvailable) {
    renderParticles(ctx, snapshot, ox, oy, zoom);
  }

  // Debug-only HUD and room name
  if (isDebugMode) {
    renderHudOverlay(ctx, hudState);

    // ── Room name banner (top-center) ──────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '7px monospace';
    const roomLabel = currentRoom.name;
    const labelW = ctx.measureText(roomLabel).width;
    ctx.fillText(roomLabel, (virtualWidthPx - labelW) / 2, 22);
  }

  // ── Player health bar in HUD (top-left, above dust display) ─────────────
  {
    const playerForHealth = world.clusters[0];
    if (playerForHealth !== undefined && playerForHealth.isAliveFlag === 1) {
      const healthFraction = playerForHealth.healthPoints / playerForHealth.maxHealthPoints;

      ctx.save();
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(HUD_HEALTH_BAR_X_PX, HUD_HEALTH_BAR_Y_PX, HUD_HEALTH_BAR_WIDTH_PX, HUD_HEALTH_BAR_HEIGHT_PX);
      // Health fill
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(HUD_HEALTH_BAR_X_PX, HUD_HEALTH_BAR_Y_PX, HUD_HEALTH_BAR_WIDTH_PX * healthFraction, HUD_HEALTH_BAR_HEIGHT_PX);
      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(HUD_HEALTH_BAR_X_PX, HUD_HEALTH_BAR_Y_PX, HUD_HEALTH_BAR_WIDTH_PX, HUD_HEALTH_BAR_HEIGHT_PX);
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

  // ── Enemy health bar display (only when damaged) ──────────────────────────
  const healthBarDisplayTicks = Math.floor(HEALTH_BAR_DISPLAY_MS / FIXED_DT_MS);
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;
    // Skip the player — their health bar is in the HUD, not over their character
    if (cluster.isPlayerFlag === 1) {
      prevHealthMap.set(cluster.entityId, cluster.healthPoints);
      continue;
    }

    // Check for health changes to trigger display
    const prevHealth = prevHealthMap.get(cluster.entityId) ?? cluster.maxHealthPoints;
    if (cluster.healthPoints < prevHealth) {
      healthBarDisplayUntilTick.set(cluster.entityId, world.tick + healthBarDisplayTicks);
    }
    prevHealthMap.set(cluster.entityId, cluster.healthPoints);

    // Only show health bar if recently damaged (tick-based)
    const displayUntilTick = healthBarDisplayUntilTick.get(cluster.entityId) ?? 0;
    if (world.tick > displayUntilTick) continue;

    const healthFraction = cluster.healthPoints / cluster.maxHealthPoints;
    const barWidth = 24;
    const barHeight = 3;
    const barX = cluster.positionXWorld * zoom + ox - barWidth / 2;
    const barY = (cluster.positionYWorld - cluster.halfHeightWorld - 4) * zoom + oy;

    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    // Health fill — enemies only (player skipped above)
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(barX, barY, barWidth * healthFraction, barHeight);
    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    ctx.restore();
  }

  // ── Upscale virtual canvas to device canvas ────────────────────────────
  deviceCtx.imageSmoothingEnabled = false;
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  // Composite WebGL particle canvas on top (also at virtual resolution)
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }

  // ── Touch joystick (drawn on device canvas in screen space) ───────────
  if (inputState.isTouchJoystickActiveFlag === 1) {
    const bx = inputState.touchJoystickBaseXPx;
    const by = inputState.touchJoystickBaseYPx;
    const joystickCurrentXPx = inputState.touchJoystickCurrentXPx;
    const joystickCurrentYPx = inputState.touchJoystickCurrentYPx;

    deviceCtx.save();
    deviceCtx.beginPath();
    deviceCtx.arc(bx, by, JOYSTICK_OUTER_RADIUS_PX, 0, Math.PI * 2);
    deviceCtx.strokeStyle = 'rgba(0,207,255,0.35)';
    deviceCtx.lineWidth = 2;
    deviceCtx.stroke();
    deviceCtx.fillStyle = 'rgba(0,207,255,0.08)';
    deviceCtx.fill();

    const jdx = joystickCurrentXPx - bx;
    const jdy = joystickCurrentYPx - by;
    const dist = Math.sqrt(jdx * jdx + jdy * jdy);
    let thumbXPx = joystickCurrentXPx;
    let thumbYPx = joystickCurrentYPx;
    if (dist > JOYSTICK_OUTER_RADIUS_PX) {
      thumbXPx = bx + (jdx / dist) * JOYSTICK_OUTER_RADIUS_PX;
      thumbYPx = by + (jdy / dist) * JOYSTICK_OUTER_RADIUS_PX;
    }

    deviceCtx.beginPath();
    deviceCtx.arc(thumbXPx, thumbYPx, JOYSTICK_INNER_RADIUS_PX, 0, Math.PI * 2);
    deviceCtx.fillStyle = 'rgba(0,207,255,0.45)';
    deviceCtx.fill();
    deviceCtx.restore();
  }

  // ── Control hints (debug only, drawn on device canvas) ──────────────────
  if (isDebugMode) {
    const controlHintText = IS_TOUCH_DEVICE
      ? 'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MENU to return'
      : 'A/D=walk  |  W/Space/↑=jump  |  Shift=sprint  |  Click=attack  |  Hold=block  |  Hold E=grapple  |  ESC=menu';
    deviceCtx.fillStyle = 'rgba(255,255,255,0.3)';
    deviceCtx.font = '12px monospace';
    const hintWidthPx = deviceCtx.measureText(controlHintText).width;
    deviceCtx.fillText(controlHintText, (canvas.width - hintWidthPx) / 2, canvas.height - 10);
  }
}
