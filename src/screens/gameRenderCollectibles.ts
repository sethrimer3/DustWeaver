/**
 * gameRenderCollectibles.ts — In-world collectible rendering for the main game frame.
 *
 * Handles rendering of all collectible items placed in a room:
 *   • Dust containers (bobbing sprite, viewport-culled)
 *   • Dust swarms (swirling particle cluster, viewport-culled)
 *   • Lambda anchors (recall point indicators)
 *
 * Extracted from gameRender.ts to keep the main render orchestrator leaner.
 * Follows the same context-interface pattern as gameHudRenderer.ts and
 * gameDarkRoomLighting.ts — callers pass a RenderFrameContext directly since
 * RenderFrameContext structurally satisfies CollectiblesRenderContext.
 */

import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { DUST_CONTAINER_SHARD_SIZE_WORLD, DUST_CONTAINER_SIZE_WORLD } from './gameRoom';
import { renderLambdaAnchors } from '../render/lambdaAnchorRenderer';

// ── Collectibles render context ─────────────────────────────────────────────

/** Subset of RenderFrameContext fields needed by renderRoomCollectibles(). */
export interface CollectiblesRenderContext {
  currentRoom: RoomDef;
  collectedDustContainerKeySet: Set<string>;
  isDustContainerSpriteLoaded: boolean;
  dustContainerSprite: HTMLImageElement;
  isDustContainerShardSpriteLoaded: boolean;
  dustContainerShardSprite: HTMLImageElement;
  collectedDustSwarmKeySet: Set<string>;
  linkedAnchorIndex: number;
  linkedAnchorRoomId: string;
}

// ── Dust kind colour lookup ─────────────────────────────────────────────────

/**
 * Returns a CSS colour string for a given dust kind name.
 * Used to tint dust swarm particles cosmetically.
 */
export function getDustKindColor(dustKind: string): string {
  switch (dustKind) {
    case 'Fire':      return '#ff6020';
    case 'Ice':       return '#60c8ff';
    case 'Lightning': return '#ffe040';
    case 'Poison':    return '#60ff40';
    case 'Arcane':    return '#c060ff';
    case 'Wind':      return '#c0f0ff';
    case 'Holy':      return '#ffffa0';
    case 'Shadow':    return '#8040a0';
    case 'Metal':     return '#b0b8c8';
    case 'Earth':     return '#a07040';
    case 'Nature':    return '#40c840';
    case 'Crystal':   return '#80ffe0';
    case 'Void':      return '#4020a0';
    case 'Water':     return '#2080ff';
    case 'Lava':      return '#ff4010';
    case 'Stone':     return '#909090';
    default:          return '#d0c080'; // Golden / unknown
  }
}

// ── Public render function ──────────────────────────────────────────────────

/**
 * Renders all in-world collectibles for the current room: dust containers,
 * dust swarms, and lambda anchors.
 *
 * Must be called while the room clip rect is still active (before ctx.restore())
 * so collectibles outside the room boundary are correctly hidden.
 *
 * @param r               Collectibles render context (subset of RenderFrameContext).
 * @param ctx             Virtual canvas 2D context.
 * @param ox              Camera X offset in virtual pixels.
 * @param oy              Camera Y offset in virtual pixels.
 * @param zoom            Camera zoom (world units → virtual pixels).
 * @param nowMs           Current time in milliseconds (for animation).
 * @param virtualWidthPx  Virtual canvas width in pixels.
 * @param virtualHeightPx Virtual canvas height in pixels.
 */
export function renderRoomCollectibles(
  r: CollectiblesRenderContext,
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  zoom: number,
  nowMs: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
): void {
  const {
    currentRoom,
    collectedDustContainerKeySet,
    isDustContainerSpriteLoaded,
    dustContainerSprite,
    isDustContainerShardSpriteLoaded,
    dustContainerShardSprite,
    collectedDustSwarmKeySet,
    linkedAnchorIndex,
    linkedAnchorRoomId,
  } = r;

  // ── Dust containers ───────────────────────────────────────────────────────
  if (isDustContainerSpriteLoaded) {
    const roomDustContainers = currentRoom.dustContainers ?? [];
    const bobOffsetWorld = Math.sin(nowMs * 0.0032) * 1.5;
    // Viewport bounds in world space for culling.
    const vpMinXWorld = -ox / zoom;
    const vpMinYWorld = -oy / zoom;
    const vpMaxXWorld = (virtualWidthPx - ox) / zoom;
    const vpMaxYWorld = (virtualHeightPx - oy) / zoom;
    for (let i = 0; i < roomDustContainers.length; i++) {
      const pickupKey = `${currentRoom.id}:container:${i}`;
      if (collectedDustContainerKeySet.has(pickupKey)) continue;

      const dc = roomDustContainers[i];
      const dx = (dc.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const dy = (dc.yBlock + 0.5) * BLOCK_SIZE_MEDIUM + bobOffsetWorld;

      // Cull containers fully outside the viewport (+ small margin).
      const margin = DUST_CONTAINER_SIZE_WORLD;
      if (dx < vpMinXWorld - margin || dx > vpMaxXWorld + margin) continue;
      if (dy < vpMinYWorld - margin || dy > vpMaxYWorld + margin) continue;

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

  if (isDustContainerShardSpriteLoaded) {
    const roomDustContainerPieces = currentRoom.dustContainerPieces ?? [];
    const bobOffsetWorld = Math.sin(nowMs * 0.0032 + 1.8) * 1.1;
    const vpMinXWorld = -ox / zoom;
    const vpMinYWorld = -oy / zoom;
    const vpMaxXWorld = (virtualWidthPx - ox) / zoom;
    const vpMaxYWorld = (virtualHeightPx - oy) / zoom;
    for (let i = 0; i < roomDustContainerPieces.length; i++) {
      const pickupKey = `${currentRoom.id}:containerShard:${i}`;
      if (collectedDustContainerKeySet.has(pickupKey)) continue;

      const piece = roomDustContainerPieces[i];
      const dx = (piece.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const dy = (piece.yBlock + 0.5) * BLOCK_SIZE_MEDIUM + bobOffsetWorld;

      const margin = DUST_CONTAINER_SHARD_SIZE_WORLD;
      if (dx < vpMinXWorld - margin || dx > vpMaxXWorld + margin) continue;
      if (dy < vpMinYWorld - margin || dy > vpMaxYWorld + margin) continue;

      const drawSize = DUST_CONTAINER_SHARD_SIZE_WORLD * zoom;
      ctx.drawImage(
        dustContainerShardSprite,
        dx * zoom + ox - drawSize * 0.5,
        dy * zoom + oy - drawSize * 0.5,
        drawSize,
        drawSize,
      );
    }
  }

  // ── Dust swarms ───────────────────────────────────────────────────────────
  {
    const roomDustSwarms = currentRoom.dustSwarms ?? [];
    const t = nowMs * 0.001;
    // Viewport bounds in world space for culling (with margin for swarm radius).
    const swarmMarginWorld = BLOCK_SIZE_MEDIUM * 2;
    const vpMinXWorld = -ox / zoom - swarmMarginWorld;
    const vpMinYWorld = -oy / zoom - swarmMarginWorld;
    const vpMaxXWorld = (virtualWidthPx - ox) / zoom + swarmMarginWorld;
    const vpMaxYWorld = (virtualHeightPx - oy) / zoom + swarmMarginWorld;
    ctx.save();
    for (let i = 0; i < roomDustSwarms.length; i++) {
      const swarmKey = `${currentRoom.id}:dustswarm:${i}`;
      if (collectedDustSwarmKeySet.has(swarmKey)) continue;
      const sw = roomDustSwarms[i];
      const cx = (sw.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const cy = (sw.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;

      // Cull swarms fully outside viewport.
      if (cx < vpMinXWorld || cx > vpMaxXWorld) continue;
      if (cy < vpMinYWorld || cy > vpMaxYWorld) continue;
      // Draw a swirling cluster of ~12 small dots using deterministic time/index math.
      const particleCount = 12;
      for (let p = 0; p < particleCount; p++) {
        const angle = (p / particleCount) * Math.PI * 2 + t * (1.4 + (p % 3) * 0.3);
        const wobble = Math.sin(t * 2.0 + p * 1.1) * 0.5;
        const radius = (3.5 + (p % 4) * 1.2 + wobble) * BLOCK_SIZE_MEDIUM * 0.12;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius * 0.6 + Math.sin(t * 1.7 + p) * 1.0;
        const alpha = 0.55 + Math.sin(t * 2.5 + p * 0.9) * 0.25;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = getDustKindColor(sw.dustKind);
        const size = (1.2 + (p % 3) * 0.4) * zoom;
        ctx.fillRect(
          Math.round((px * zoom + ox) - size * 0.5),
          Math.round((py * zoom + oy) - size * 0.5),
          Math.ceil(size), Math.ceil(size),
        );
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Lambda anchors ────────────────────────────────────────────────────────
  // Recall points — press F to link, press F again to teleport.
  renderLambdaAnchors(
    ctx,
    currentRoom.lambdaAnchors ?? [],
    linkedAnchorRoomId === currentRoom.id ? linkedAnchorIndex : -1,
    ox,
    oy,
    zoom,
    nowMs,
  );
}
