/**
 * lightingSystem.ts — Frame-level lighting compositor.
 *
 * Manages the offscreen canvas that accumulates scene lights and composites
 * it onto the virtual canvas each frame.
 *
 * Responsibilities:
 *   • Own a single offscreen canvas at virtual resolution.
 *   • Cache occluder segments between frames (marked dirty on room load).
 *   • Cull lights outside the viewport each frame (no draw if invisible).
 *   • Call the per-light draw routines from lightRenderer.ts.
 *   • Composite the accumulated light canvas onto the game canvas.
 *
 * Performance rules:
 *   • Pre-allocate all scratch arrays; no per-frame heap allocation.
 *   • Never call gl / webgl API here — Canvas 2D only.
 */

import type { LightDef } from './lightingTypes';
import type { OccluderSegment } from './visibilityPolygon';
import { buildWallOccluders, computeVisibilityPolygon } from './visibilityPolygon';
import { drawLight } from './lightRenderer';

// ── Pre-allocated scratch buffers ─────────────────────────────────────────────

const MAX_LIGHTS = 64;
const MIN_SUNRAY_LENGTH_WORLD = 1;

function isSunrayVisible(
  light: LightDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  viewportW: number,
  viewportH: number,
): boolean {
  const angleRad = light.angleRad ?? light.rotationRad ?? 0;
  const lengthWorld = Math.max(light.lengthWorld ?? light.radiusWorld, MIN_SUNRAY_LENGTH_WORLD);
  const widthStartWorld = Math.max(light.widthStartWorld ?? 1, 1);
  const widthEndWorld = Math.max(light.widthEndWorld ?? widthStartWorld, widthStartWorld);
  const maxHalfWidthWorld = Math.max(widthStartWorld, widthEndWorld) * 0.5;

  const sx = light.xWorld * zoom + offsetXPx;
  const sy = light.yWorld * zoom + offsetYPx;
  const ex = (light.xWorld + Math.cos(angleRad) * lengthWorld) * zoom + offsetXPx;
  const ey = (light.yWorld + Math.sin(angleRad) * lengthWorld) * zoom + offsetYPx;
  const pad = maxHalfWidthWorld * zoom + 6;
  const minX = Math.min(sx, ex) - pad;
  const maxX = Math.max(sx, ex) + pad;
  const minY = Math.min(sy, ey) - pad;
  const maxY = Math.max(sy, ey) + pad;
  if (maxX < 0 || minX > viewportW) return false;
  if (maxY < 0 || minY > viewportH) return false;
  return true;
}

/** Pre-allocated occluder segment pool (one per room-load). */
const _wallOccluders: OccluderSegment[] = Array.from({ length: 2048 }, () => ({
  ax: 0, ay: 0, bx: 0, by: 0,
}));
/** Number of valid entries in `_wallOccluders`. */
let _wallOccluderCount = 0;

/** Per-frame: combined per-light occluder list (reuses slots from _wallOccluders). */
const _culledLights: LightDef[] = new Array<LightDef>(MAX_LIGHTS);
let _culledLightCount = 0;

// ── Module state ──────────────────────────────────────────────────────────────

let _offscreenCanvas: HTMLCanvasElement | null = null;
let _offscreenCtx: CanvasRenderingContext2D | null = null;
let _isOccludersDirty = true;

// Cached room walls (set on each room load).
type WallForOccluder = { xWorld: number; yWorld: number; wWorld: number; hWorld: number; isPlatformFlag?: 0 | 1 };
let _cachedWalls: readonly WallForOccluder[] = [];

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialise (or reinitialise) the lighting system for the given virtual
 * resolution.  Safe to call multiple times (reuses the canvas element).
 */
export function initLightingSystem(widthPx: number, heightPx: number): void {
  if (_offscreenCanvas === null) {
    _offscreenCanvas = document.createElement('canvas');
  }
  if (_offscreenCanvas.width !== widthPx || _offscreenCanvas.height !== heightPx) {
    _offscreenCanvas.width  = widthPx;
    _offscreenCanvas.height = heightPx;
    _offscreenCtx = _offscreenCanvas.getContext('2d');
  }
  _isOccludersDirty = true;
}

/**
 * Signal that the occluder cache is stale (call when the room changes or walls
 * are modified in the editor).
 */
export function markOccludersDirty(
  walls: readonly WallForOccluder[],
): void {
  _cachedWalls = walls;
  _isOccludersDirty = true;
}

// ── Per-frame render ──────────────────────────────────────────────────────────

/**
 * Render all scene lights onto `targetCtx` (the virtual canvas).
 *
 * Must be called within the room clip (after `ctx.save()` sets the room
 * scissor rectangle, before `ctx.restore()`).
 *
 * @param targetCtx   Virtual canvas 2D context.
 * @param lights      Scene lights from the current room's `RoomDef.sceneLights`.
 * @param offsetXPx   Camera X offset (world→canvas translation) in virtual pixels.
 * @param offsetYPx   Camera Y offset.
 * @param zoom        Camera zoom (virtual pixels per world unit).
 * @param viewportW   Viewport width in virtual pixels.
 * @param viewportH   Viewport height in virtual pixels.
 * @param nowMs       Current time in milliseconds (for animations).
 */
export function renderLightingPass(
  targetCtx: CanvasRenderingContext2D,
  lights: readonly LightDef[] | undefined,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  viewportW: number,
  viewportH: number,
  nowMs: number,
): void {
  if (!lights || lights.length === 0) return;
  if (_offscreenCtx === null || _offscreenCanvas === null) return;

  const ctx = _offscreenCtx;

  // Rebuild occluder cache if stale.
  if (_isOccludersDirty) {
    // Convert wall data from world units to the same coordinate space the
    // lights use (world units).  Occluder build is cheap (done in world space).
    _wallOccluderCount = buildWallOccluders(
      _cachedWalls,
      0, 0, 1e9,
      _wallOccluders,
    );
    _isOccludersDirty = false;
  }

  // Cull lights that are entirely outside the viewport.
  _culledLightCount = 0;
  for (let i = 0; i < lights.length && _culledLightCount < MAX_LIGHTS; i++) {
    const l = lights[i];
    if (l.kind === 'sunray') {
      if (!isSunrayVisible(l, offsetXPx, offsetYPx, zoom, viewportW, viewportH)) continue;
    } else {
      // Light screen centre
      const screenX = l.xWorld * zoom + offsetXPx;
      const screenY = l.yWorld * zoom + offsetYPx;
      const screenR = l.radiusWorld * zoom;
      if (screenX + screenR < 0 || screenX - screenR > viewportW) continue;
      if (screenY + screenR < 0 || screenY - screenR > viewportH) continue;
    }
    _culledLights[_culledLightCount++] = l;
  }
  if (_culledLightCount === 0) return;

  // Clear the offscreen canvas.
  ctx.clearRect(0, 0, _offscreenCanvas.width, _offscreenCanvas.height);

  // Apply camera transform so we draw in world space.
  ctx.save();
  ctx.translate(offsetXPx, offsetYPx);
  ctx.scale(zoom, zoom);

  // Draw each light.
  for (let i = 0; i < _culledLightCount; i++) {
    const light = _culledLights[i];
    let visResult = null;

    if (light.castsShadowsFlag === 1 && _wallOccluderCount > 0) {
      const visRadiusWorld = light.kind === 'sunray'
        ? Math.max(light.radiusWorld, light.lengthWorld ?? light.radiusWorld)
        : light.radiusWorld;
      // Build per-light occluders culled to light radius.
      // Reuse a slice of _wallOccluders (the build already caps at MAX_SEGS).
      visResult = computeVisibilityPolygon(
        light.xWorld, light.yWorld, visRadiusWorld,
        _wallOccluders, _wallOccluderCount,
      );
    }

    drawLight(ctx, light, nowMs, visResult);
  }

  ctx.restore();

  // Composite the accumulated light canvas onto the target (game canvas).
  // Use 'lighter' (additive) so overlapping lights brighten the scene.
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'lighter';
  targetCtx.globalAlpha = 1;
  targetCtx.drawImage(_offscreenCanvas, 0, 0);
  targetCtx.restore();
}
