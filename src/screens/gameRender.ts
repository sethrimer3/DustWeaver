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
import type { WorldSnapshot } from '../render/snapshot';
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
import type { CombatTextSystem } from '../render/hud/combatText';
import type { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import type { EnvironmentalDustLayer } from '../render/environmentalDust';
import type { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import type { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import type { PlayerCloak } from '../render/clusters/playerCloak';
import {
  isTheroShowcaseRoom,
  renderTheroShowcaseEffect,
  renderTheroBackgroundEffect,
  renderCrystallineCracksBackground,
} from '../render/effects/theroEffectManager';
import type { BloomSystem } from '../render/effects/bloomSystem';
import type { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import {
  buildRoomDecorations,
  renderDecorationSprites,
  addDecorationBloom,
  collectDecorationLights,
} from '../render/effects/wallDecorations';
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
import { isOffensiveDustOutlineEnabled } from '../ui/renderSettings';
import { getReachableEdgeGlowOpacity, getInfluenceCircleOpacity, getInfluenceHighlightWidth } from '../ui/renderSettings';
import { renderGrappleInfluenceVisuals } from '../render/grappleInfluenceRenderer';

// ── Constants ──────────────────────────────────────────────────────────────

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

/** Touch joystick outer radius matches the max drag radius from handler.ts. */
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// HUD layout — health bar dimensions (virtual pixels)
const HUD_HEALTH_BAR_X_PX        = 8;
const HUD_HEALTH_BAR_Y_PX        = 8;
const HUD_HEALTH_BAR_WIDTH_PX    = 60;
const HUD_HEALTH_BAR_HEIGHT_PX   = 6;
const HUD_HEALTH_DUST_GAP_PX     = 4;
/** Visual spacing between grapple bloom dots along the chain (virtual px). */
const GRAPPLE_BLOOM_SEGMENT_PX = 6;
const OUTLINE_BASE_WIDTH_1080P_PX = 2;
const OFFENSIVE_DUST_BASE_DIAMETER_WORLD = 2.0;

// Health fraction thresholds for visual escalation
const HEALTH_THRESHOLD_DANGER_FRACTION   = 0.40;  // below this → amber warning
const HEALTH_THRESHOLD_CRITICAL_FRACTION = 0.20;  // below this → pulsing red alert

function drawGrappleBloom(
  bloomSystem: BloomSystem,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  const hasActiveOrMiss = snapshot.isGrappleActiveFlag === 1 || snapshot.isGrappleMissActiveFlag === 1;
  if (!hasActiveOrMiss) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const candidate = snapshot.clusters[ci];
    if (candidate.isPlayerFlag === 1 && candidate.isAliveFlag === 1) {
      playerCluster = candidate;
      break;
    }
  }
  if (playerCluster === undefined) return;

  const playerHalfWidthPx = playerCluster.halfWidthWorld * scalePx;
  const offsetDir = playerCluster.isFacingLeftFlag === 1 ? -1 : 1;
  const px = playerCluster.positionXWorld * scalePx + offsetXPx + offsetDir * playerHalfWidthPx;
  const py = playerCluster.positionYWorld * scalePx + offsetYPx;

  let ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  let ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
  if (snapshot.isGrappleMissActiveFlag === 1 && snapshot.grappleParticleStartIndex >= 0) {
    const tipIndex = snapshot.grappleParticleStartIndex + 9;
    const isTipAlive = tipIndex < snapshot.particles.particleCount && snapshot.particles.isAliveFlag[tipIndex] === 1;
    if (isTipAlive) {
      ax = snapshot.particles.positionXWorld[tipIndex] * scalePx + offsetXPx;
      ay = snapshot.particles.positionYWorld[tipIndex] * scalePx + offsetYPx;
    }
  }

  const dx = ax - px;
  const dy = ay - py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const segmentCount = Math.max(1, Math.floor(dist / GRAPPLE_BLOOM_SEGMENT_PX));
  for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
    const t = segmentCount > 0 ? segmentIndex / segmentCount : 0;
    bloomSystem.glowPass.drawCircle({
      x: px + dx * t,
      y: py + dy * t,
      radius: 1.2,
      glow: {
        enabled: true,
        intensity: 0.28,
        color: '#ffd972',
      },
    });
  }

  bloomSystem.glowPass.drawCircle({
    x: ax,
    y: ay,
    radius: 3.0,
    glow: {
      enabled: true,
      intensity: 0.62,
      color: '#ffe79d',
    },
  });
}

/**
 * Draws additive glow for gold dust particles into the bloom system's glow pass.
 * Multiple overlapping particles produce a stronger combined glow (additive blend).
 * Glow intensity scales with particle speed — faster-moving particles glow brighter.
 */
function drawParticleGlow(
  bloomSystem: BloomSystem,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  const particles = snapshot.particles;
  /** Glow radius is slightly larger than the 3×3 dust square for a soft halo. */
  const glowRadius = 2.5 * scalePx;

  /** Speed (world units/s) at which glow reaches full intensity. */
  const MAX_GLOW_SPEED_WORLD_PER_SEC = 120.0;
  /** Base glow intensity for a resting particle. */
  const BASE_GLOW_INTENSITY = 0.25;
  /** Additional glow intensity added at maximum speed. */
  const SPEED_GLOW_RANGE = 0.65;

  for (let i = 0; i < particles.particleCount; i++) {
    if (particles.isAliveFlag[i] === 0) continue;
    // Only glow gold dust (Physical) particles
    const kind = particles.kindBuffer[i];
    if (kind !== ParticleKind.Physical && kind !== ParticleKind.Gold) continue;

    const lt = particles.lifetimeTicks[i];
    const normAge = lt > 0 ? Math.min(1.0, particles.ageTicks[i] / lt) : 0.0;
    const ageFade = 1.0 - normAge;
    if (ageFade < 0.05) continue;

    // Velocity-based brightness: faster particles glow brighter.
    const vx = particles.velocityXWorld[i];
    const vy = particles.velocityYWorld[i];
    const speedWorld = Math.sqrt(vx * vx + vy * vy);
    const speedFactor = Math.min(1.0, speedWorld / MAX_GLOW_SPEED_WORLD_PER_SEC);
    const intensity = (BASE_GLOW_INTENSITY + SPEED_GLOW_RANGE * speedFactor) * ageFade;

    const sx = particles.positionXWorld[i] * scalePx + offsetXPx;
    const sy = particles.positionYWorld[i] * scalePx + offsetYPx;

    bloomSystem.glowPass.drawCircle({
      x: sx,
      y: sy,
      radius: glowRadius,
      glow: {
        enabled: true,
        intensity,
        color: '#ffd700',
      },
    });
  }
}

function drawOffensiveDustOutlineOverlay(
  deviceCtx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  canvasWidthPx: number,
  canvasHeightPx: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (!isOffensiveDustOutlineEnabled()) return;

  const outlineScale = Math.min(canvasWidthPx / 1920.0, canvasHeightPx / 1080.0);
  const lineWidthPx = OUTLINE_BASE_WIDTH_1080P_PX * outlineScale;
  const worldDiameterPx = OFFENSIVE_DUST_BASE_DIAMETER_WORLD * scalePx;
  const radiusPx = Math.max(lineWidthPx * 0.6, worldDiameterPx * 0.6);
  const halfPixelAdjust = ((lineWidthPx % 2) === 0) ? 0.5 : 0;

  deviceCtx.save();
  deviceCtx.strokeStyle = '#ff1a1a';
  deviceCtx.lineWidth = lineWidthPx;

  const particles = snapshot.particles;
  for (let i = 0; i < particles.particleCount; i++) {
    if (particles.isAliveFlag[i] === 0) continue;
    if (particles.behaviorMode[i] !== 1) continue;

    const ownerEntityId = particles.ownerEntityId[i];
    let isEnemyOwned = false;
    for (let ci = 0; ci < snapshot.clusters.length; ci++) {
      const cluster = snapshot.clusters[ci];
      if (cluster.entityId !== ownerEntityId) continue;
      isEnemyOwned = cluster.isPlayerFlag === 0 && cluster.isAliveFlag === 1;
      break;
    }
    if (!isEnemyOwned) continue;

    const sx = particles.positionXWorld[i] * scalePx + offsetXPx;
    const sy = particles.positionYWorld[i] * scalePx + offsetYPx;

    deviceCtx.beginPath();
    deviceCtx.arc(sx + halfPixelAdjust, sy + halfPixelAdjust, radiusPx, 0, Math.PI * 2);
    deviceCtx.stroke();
  }
  deviceCtx.restore();
}

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
  skillTombEffectRenderer: SkillTombEffectRenderer;
  bloomSystem: BloomSystem;
  playerCloak: PlayerCloak;
  darkRoomOverlay: DarkRoomOverlay;

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

  // Combat text floaters
  combatText: CombatTextSystem;
  /**
   * Mutable box holding the last `world.lastPlayerBlockedTick` value seen by
   * the renderer.  Updated each frame so repeated ticks don't re-trigger the
   * same BLOCKED event.  Lives as a single-element object to allow mutation
   * through the interface.
   */
  prevLastPlayerBlockedTick: { value: number };

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
    webglRenderer, environmentalDust, skidDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
    playerCloak, darkRoomOverlay,
    world, currentRoom,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx,
    bgColor, isDebugMode, hudState, inputState,
    prevHealthMap, healthBarDisplayUntilTick,
    combatText, prevLastPlayerBlockedTick,
    collectedDustContainerKeySet,
    isSkillBookSpriteLoaded, isDustContainerSpriteLoaded,
    skillBookSprite, dustContainerSprite,
    progress,
    getPlayerDustCount,
  } = r;

  const nowMs = performance.now();

  const snapshot = createSnapshot(world);
  const roomWidthWorld = currentRoom.widthBlocks * BLOCK_SIZE_SMALL;
  const roomHeightWorld = currentRoom.heightBlocks * BLOCK_SIZE_SMALL;
  const roomScreenXPx = ox;
  const roomScreenYPx = oy;
  const roomScreenWidthPx = roomWidthWorld * zoom;
  const roomScreenHeightPx = roomHeightWorld * zoom;
  // Keep sprite sampling nearest-neighbour even if context state changed.
  ctx.imageSmoothingEnabled = false;
  bloomSystem.beginFrame();

  // ── Clear / fill virtual canvas ─────────────────────────────────────────
  // Always start from black so anything outside the room remains pure black.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
  if (webglRenderer.isAvailable) {
    webglRenderer.render(snapshot, ox, oy, zoom);
  } else if (bgColor !== '#000000') {
    // Keep legacy room-local background tinting behavior when no WebGL layer
    // is active, while preserving black room margins via clipping below.
    ctx.fillStyle = bgColor;
    ctx.fillRect(roomScreenXPx, roomScreenYPx, roomScreenWidthPx, roomScreenHeightPx);
  }

  // Constrain all world-space rendering to the room rectangle so out-of-room
  // areas remain black even when camera framing shows beyond room extents.
  ctx.save();
  ctx.beginPath();
  ctx.rect(roomScreenXPx, roomScreenYPx, roomScreenWidthPx, roomScreenHeightPx);
  ctx.clip();

  // ── World background with parallax ──────────────────────────────────────
  renderWorldBackground(
    ctx,
    currentRoom.worldNumber,
    virtualWidthPx,
    virtualHeightPx,
    ox,
    oy,
    roomWidthWorld,
    roomHeightWorld,
    zoom,
    currentRoom.backgroundId,
  );

  // ── Thero effect procedural overlays ─────────────────────────────────────
  const renderedTheroBackground = renderTheroBackgroundEffect(
    ctx,
    currentRoom.backgroundId,
    virtualWidthPx,
    virtualHeightPx,
    performance.now(),
  );
  // Legacy showcase rooms still use room-id dispatch when no explicit
  // thero_* background override is present.
  if (!renderedTheroBackground && isTheroShowcaseRoom(currentRoom.id)) {
    renderTheroShowcaseEffect(ctx, currentRoom.id, virtualWidthPx, virtualHeightPx, performance.now());
  }

  // ── Crystalline Cracks procedural background effect ──────────────────────
  if (currentRoom.backgroundId === 'crystallineCracks') {
    renderCrystallineCracksBackground(ctx, virtualWidthPx, virtualHeightPx, performance.now());
  }

  // Walls before cluster indicators so clusters are drawn on top
  renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);

  // ── Wall decorations (glowing moss & mushrooms) ──────────────────────────
  // Pre-computed and cached per wall signature; rendered after walls so they
  // appear on top of tile surfaces.  Bloom and light source data are
  // collected here for use later in the frame.
  const isDarkRoom = currentRoom.lightingEffect === 'DarkRoom';
  const wallDecorations = buildRoomDecorations(currentRoom.decorations ?? [], BLOCK_SIZE_SMALL);
  renderDecorationSprites(ctx, wallDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL);

  // Grapple influence visuals (golden circle + edge glow) drawn on top of walls
  // but behind clusters/particles so they don't obscure the action.
  renderGrappleInfluenceVisuals(
    ctx, snapshot, ox, oy, zoom,
    inputState.mouseXPx, inputState.mouseYPx,
    canvas.width, canvas.height,
    virtualWidthPx, virtualHeightPx,
    getReachableEdgeGlowOpacity(),
    getInfluenceCircleOpacity(),
    getInfluenceHighlightWidth(),
  );

  // Environmental hazards (water/lava zones behind, spikes/jars/fireflies on top)
  renderHazards(ctx, world, ox, oy, zoom, world.tick);

  renderClusters(ctx, snapshot, ox, oy, zoom, isDebugMode, playerCloak, /* isDebugCloak */ isDebugMode);
  renderRadiantTether(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderGrapple(ctx, snapshot, ox, oy, zoom);
  drawGrappleBloom(bloomSystem, snapshot, ox, oy, zoom);
  drawParticleGlow(bloomSystem, snapshot, ox, oy, zoom);
  // Decoration bloom — always added (even outside DarkRoom) so moss/mushrooms
  // visibly glow with the atmospheric bloom pass on any lighting setting.
  addDecorationBloom(bloomSystem, wallDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL, nowMs);

  // Tunnel darkness overlays
  drawTunnelDarkness(ctx, currentRoom, ox, oy, zoom);

  environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);
  skidDebris.render(ctx, ox, oy, zoom);

  // Save tombs (sprite + swirling/falling dust particles)
  skillTombRenderer.render(ctx, ox, oy, zoom);

  // Skill tombs — background particles (behind sprite), sprite, then foreground particles
  skillTombEffectRenderer.renderBehind(ctx, ox, oy, zoom);
  skillTombEffectRenderer.renderSprite(ctx, ox, oy, zoom);
  skillTombEffectRenderer.renderFront(ctx, ox, oy, zoom);

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
      bloomSystem.glowPass.drawSprite({
        image: skillBookSprite,
        x: sx * zoom + ox - drawSize * 0.5,
        y: sy * zoom + oy - drawSize * 0.5,
        width: drawSize,
        height: drawSize,
        glow: {
          enabled: true,
          intensity: 0.75,
          color: '#b8a2ff',
        },
      });
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

  // ── Dark room overlay (applied last, inside the room clip) ───────────────
  // Covers the entire room with a near-opaque darkness layer, then "punches"
  // radial light holes at every light source so only illuminated areas show.
  // The bloom pass (composited later on the device canvas) adds atmospheric
  // glow on top of the darkness, making light sources feel warm and radiant.
  if (isDarkRoom) {
    const lights = collectDecorationLights(wallDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL);

    // Player emits a personal lantern-sized light.
    const playerSnap = snapshot.clusters.find(c => c.isPlayerFlag === 1 && c.isAliveFlag === 1);
    if (playerSnap !== undefined) {
      lights.push({
        xPx:          playerSnap.positionXWorld * zoom + ox,
        yPx:          playerSnap.positionYWorld * zoom + oy,
        radiusPx:     38 * zoom,
        innerFraction: 0.18,
      });
    }

    // Alive Physical (golden) dust particles each contribute a small light.
    const MAX_PARTICLE_LIGHTS = 24;
    let particleLightCount = 0;
    const parts = snapshot.particles;
    for (let pi = 0; pi < parts.particleCount && particleLightCount < MAX_PARTICLE_LIGHTS; pi++) {
      if (parts.isAliveFlag[pi] === 0) continue;
      if (parts.kindBuffer[pi] !== ParticleKind.Physical) continue;
      lights.push({
        xPx:          parts.positionXWorld[pi] * zoom + ox,
        yPx:          parts.positionYWorld[pi] * zoom + oy,
        radiusPx:     11 * zoom,
        innerFraction: 0.05,
      });
      particleLightCount++;
    }

    darkRoomOverlay.render(ctx, lights);
  }

  // End room clip before any HUD/screen-space overlays are drawn.
  ctx.restore();

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

    ctx.save();
    // Thin gold outline
    ctx.strokeStyle = '#a07800';
    ctx.lineWidth   = 0.5;
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
    ctx.restore();
  }

  // ── Floating combat text (damage numbers, BLOCKED) ────────────────────────
  combatText.render(ctx, ox, oy, zoom, nowMs);

  // ── Upscale virtual canvas to device canvas ────────────────────────────
  deviceCtx.imageSmoothingEnabled = false;
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  // Composite WebGL particle canvas on top (also at virtual resolution)
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }
  bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);
  drawOffensiveDustOutlineOverlay(deviceCtx, snapshot, canvas.width, canvas.height, ox, oy, zoom);

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

    const joystickDx = joystickCurrentXPx - bx;
    const joystickDy = joystickCurrentYPx - by;
    const dist = Math.sqrt(joystickDx * joystickDx + joystickDy * joystickDy);
    let thumbXPx = joystickCurrentXPx;
    let thumbYPx = joystickCurrentYPx;
    if (dist > JOYSTICK_OUTER_RADIUS_PX) {
      thumbXPx = bx + (joystickDx / dist) * JOYSTICK_OUTER_RADIUS_PX;
      thumbYPx = by + (joystickDy / dist) * JOYSTICK_OUTER_RADIUS_PX;
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
      : 'A/D=walk  |  W/Space/↑=jump  |  Shift=sprint  |  Click=attack  |  Hold=block  |  Hold Left Click=grapple  |  ESC=menu';
    deviceCtx.fillStyle = 'rgba(255,255,255,0.3)';
    deviceCtx.font = '12px monospace';
    const hintWidthPx = deviceCtx.measureText(controlHintText).width;
    deviceCtx.fillText(controlHintText, (canvas.width - hintWidthPx) / 2, canvas.height - 10);
  }
}
