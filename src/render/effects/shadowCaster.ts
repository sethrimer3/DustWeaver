/**
 * shadowCaster.ts — Player shadow geometry for the DarkRoom overlay.
 *
 * Builds simple projected-polygon shadow occluders for a single caster
 * (the player) against up to MAX_SHADOW_CASTER_LIGHTS authored local
 * light sources.  The occluders are consumed by DarkRoomOverlay.render()
 * which draws them back into the darkness mask after the light holes have
 * been punched, so the player visibly blocks part of each light cone.
 *
 * Design goals:
 *  - Cheap per-frame geometry — no raycasting, no per-pixel tracing.
 *  - Deterministic and NaN-safe (all edge cases guarded).
 *  - Modular: only the player casts shadows in this phase; enemies or
 *    ropes can be added later by calling buildShadowOccluders() with a
 *    different caster rectangle.
 */

import { BLOCK_SIZE_SMALL, type RoomLightSourceDef } from '../../levels/roomDef';

// ── Shadow polygon type ───────────────────────────────────────────────────────

/**
 * A quadrilateral shadow occluder in virtual-pixel coordinates.
 *
 * Vertex order:
 *
 *   baseA ──── baseB      (player-facing base, wider)
 *     \            /
 *    tipA ──── tipB       (shadow-tip end, narrower)
 *
 * Both the core polygon (alpha) and a soft penumbra (drawn at alpha*0.38
 * with 30 % extra width) are rendered from a single occluder.
 */
export interface ShadowCasterOccluderPx {
  /** Left base vertex (virtual canvas pixels). */
  baseAx: number;
  baseAy: number;
  /** Right base vertex (virtual canvas pixels). */
  baseBx: number;
  baseBy: number;
  /** Left tip vertex (virtual canvas pixels). */
  tipAx: number;
  tipAy: number;
  /** Right tip vertex (virtual canvas pixels). */
  tipBx: number;
  tipBy: number;
  /**
   * Core fill opacity (0-1).  The penumbra is drawn at `alpha * 0.38`.
   * Defaults to SHADOW_CORE_ALPHA if omitted.
   */
  alpha?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum authored lights that cast player shadows per frame.
 * Nearest + brightest lights are preferred.
 */
const MAX_SHADOW_CASTER_LIGHTS = 4;

/** Minimum light-to-player distance (px) before shadow geometry is skipped. */
const SHADOW_MIN_DIST_PX = 5;

/**
 * A player that is further than (lightRadiusPx × SHADOW_REACH_FACTOR) from
 * a light centre casts no shadow from that light — they are in darkness.
 */
const SHADOW_REACH_FACTOR = 1.05;

/** Opacity of the core (hard) shadow polygon. */
const SHADOW_CORE_ALPHA = 0.88;

// ── Scratch arrays (avoids per-frame allocations in hot path) ─────────────────

// These two parallel arrays store up to MAX_SHADOW_CASTER_LIGHTS candidate
// indices and their sort scores.  They are reset at the start of every call.
const _candIdx   = new Int32Array(MAX_SHADOW_CASTER_LIGHTS);
const _candScore = new Float32Array(MAX_SHADOW_CASTER_LIGHTS);

// Pre-allocated pool of mutable occluder objects — filled in-place each frame
// instead of creating new object literals per call.
const _shadowPool: ShadowCasterOccluderPx[] = Array.from(
  { length: MAX_SHADOW_CASTER_LIGHTS },
  () => ({ baseAx: 0, baseAy: 0, baseBx: 0, baseBy: 0, tipAx: 0, tipAy: 0, tipBx: 0, tipBy: 0, alpha: 0 }),
);

// ── Public API ────────────────────────────────────────────────────────────────

const _cornerX = new Float32Array(4);
const _cornerY = new Float32Array(4);
const _cornerAngle = new Float32Array(4);
const _cornerOrder = new Int32Array(4);

export function buildRectShadowOccluderPx(
  casterXPx: number,
  casterYPx: number,
  casterHalfWPx: number,
  casterHalfHPx: number,
  lightXPx: number,
  lightYPx: number,
  shadowLengthPx: number,
  out: ShadowCasterOccluderPx,
  alpha = SHADOW_CORE_ALPHA,
): boolean {
  if (casterHalfWPx <= 0 || casterHalfHPx <= 0 || shadowLengthPx <= 0) return false;

  const minX = casterXPx - casterHalfWPx;
  const maxX = casterXPx + casterHalfWPx;
  const minY = casterYPx - casterHalfHPx;
  const maxY = casterYPx + casterHalfHPx;

  if (lightXPx > minX && lightXPx < maxX && lightYPx > minY && lightYPx < maxY) return false;

  _cornerX[0] = minX; _cornerY[0] = minY;
  _cornerX[1] = maxX; _cornerY[1] = minY;
  _cornerX[2] = maxX; _cornerY[2] = maxY;
  _cornerX[3] = minX; _cornerY[3] = maxY;

  for (let i = 0; i < 4; i++) {
    _cornerAngle[i] = Math.atan2(_cornerY[i] - lightYPx, _cornerX[i] - lightXPx);
    _cornerOrder[i] = i;
  }

  for (let i = 1; i < 4; i++) {
    const idx = _cornerOrder[i];
    const angle = _cornerAngle[idx];
    let j = i - 1;
    while (j >= 0 && _cornerAngle[_cornerOrder[j]] > angle) {
      _cornerOrder[j + 1] = _cornerOrder[j];
      j--;
    }
    _cornerOrder[j + 1] = idx;
  }

  let largestGap = -1;
  let gapStartOrder = 0;
  for (let i = 0; i < 4; i++) {
    const currentIdx = _cornerOrder[i];
    const nextIdx = _cornerOrder[(i + 1) & 3];
    const currentAngle = _cornerAngle[currentIdx];
    const nextAngle = _cornerAngle[nextIdx] + (i === 3 ? Math.PI * 2 : 0);
    const gap = nextAngle - currentAngle;
    if (gap > largestGap) {
      largestGap = gap;
      gapStartOrder = i;
    }
  }

  const nearAIdx = _cornerOrder[(gapStartOrder + 1) & 3];
  const nearBIdx = _cornerOrder[gapStartOrder];
  const nearAx = _cornerX[nearAIdx];
  const nearAy = _cornerY[nearAIdx];
  const nearBx = _cornerX[nearBIdx];
  const nearBy = _cornerY[nearBIdx];

  const dirAx = nearAx - lightXPx;
  const dirAy = nearAy - lightYPx;
  const dirBx = nearBx - lightXPx;
  const dirBy = nearBy - lightYPx;
  const lenA = Math.sqrt(dirAx * dirAx + dirAy * dirAy);
  const lenB = Math.sqrt(dirBx * dirBx + dirBy * dirBy);
  if (lenA < SHADOW_MIN_DIST_PX || lenB < SHADOW_MIN_DIST_PX) return false;

  out.baseAx = nearAx;
  out.baseAy = nearAy;
  out.baseBx = nearBx;
  out.baseBy = nearBy;
  out.tipAx = nearAx + (dirAx / lenA) * shadowLengthPx;
  out.tipAy = nearAy + (dirAy / lenA) * shadowLengthPx;
  out.tipBx = nearBx + (dirBx / lenB) * shadowLengthPx;
  out.tipBy = nearBy + (dirBy / lenB) * shadowLengthPx;
  out.alpha = alpha;
  return true;
}

/**
 * Populates `out` with shadow occluder polygons for the given player caster
 * against up to {@link MAX_SHADOW_CASTER_LIGHTS} authored light sources.
 *
 * All coordinates are in **virtual canvas pixels** (the 480 × 270 space).
 *
 * @param playerXPx     Player centre X, virtual pixels.
 * @param playerYPx     Player centre Y, virtual pixels.
 * @param playerHalfWPx Player half-width, virtual pixels.
 * @param playerHalfHPx Player half-height, virtual pixels.
 * @param lightSources  Authored light sources from `RoomDef.lightSources`.
 * @param ox            Camera X offset (world-to-px: `worldX * zoom + ox`).
 * @param oy            Camera Y offset.
 * @param zoom          Camera zoom factor (virtual pixels per world unit).
 * @param out           Output array — cleared and filled by this function.
 */
export function buildPlayerShadowOccluders(
  playerXPx:     number,
  playerYPx:     number,
  playerHalfWPx: number,
  playerHalfHPx: number,
  lightSources:  readonly RoomLightSourceDef[],
  ox:            number,
  oy:            number,
  zoom:          number,
  out:           ShadowCasterOccluderPx[],
): void {
  out.length = 0;

  if (lightSources.length === 0) return;

  // ── Phase 1: collect the best MAX_SHADOW_CASTER_LIGHTS candidates ─────────
  // Sort criterion: lower score = better.  Score = distance / brightnessFraction
  // so near, bright lights win over dim or distant ones.
  let candCount = 0;
  _candIdx.fill(-1);
  _candScore.fill(0);

  for (let i = 0; i < lightSources.length; i++) {
    const ls = lightSources[i];
    const bPct = Math.max(0, Math.min(100, ls.brightnessPct)) / 100;
    if (bPct <= 0) continue;

    const worldX   = (ls.xBlock + 0.5) * BLOCK_SIZE_SMALL;
    const worldY   = (ls.yBlock + 0.5) * BLOCK_SIZE_SMALL;
    const lightXPx = worldX * zoom + ox;
    const lightYPx = worldY * zoom + oy;

    const dx     = playerXPx - lightXPx;
    const dy     = playerYPx - lightYPx;
    const distPx = Math.sqrt(dx * dx + dy * dy);

    // Skip degenerate (player almost on the light).
    if (distPx < SHADOW_MIN_DIST_PX) continue;

    // Precompute effective radius to check reach early.
    const radiusWorld   = Math.max(1, ls.radiusBlocks) * BLOCK_SIZE_SMALL;
    const lightRadiusPx = radiusWorld * zoom * (0.5 + 0.5 * bPct);

    if (distPx > lightRadiusPx * SHADOW_REACH_FACTOR) continue;

    // Score: distance / brightness (lower = nearer & brighter → higher priority).
    const score = distPx / bPct;

    // Insertion sort into the fixed-size candidate buffer.
    let insertAt = candCount;
    for (let j = 0; j < candCount; j++) {
      if (score < _candScore[j]) { insertAt = j; break; }
    }
    if (insertAt < MAX_SHADOW_CASTER_LIGHTS) {
      const end = Math.min(candCount, MAX_SHADOW_CASTER_LIGHTS - 1);
      for (let j = end; j > insertAt; j--) {
        _candIdx[j]   = _candIdx[j - 1];
        _candScore[j] = _candScore[j - 1];
      }
      _candIdx[insertAt]   = i;
      _candScore[insertAt] = score;
      if (candCount < MAX_SHADOW_CASTER_LIGHTS) candCount++;
    }
  }

  // ── Phase 2: build shadow polygon for each selected light ─────────────────
  for (let ci = 0; ci < candCount; ci++) {
    const i  = _candIdx[ci];
    const ls = lightSources[i];

    const bPct = Math.max(0, Math.min(100, ls.brightnessPct)) / 100;

    const worldX        = (ls.xBlock + 0.5) * BLOCK_SIZE_SMALL;
    const worldY        = (ls.yBlock + 0.5) * BLOCK_SIZE_SMALL;
    const radiusWorld   = Math.max(1, ls.radiusBlocks) * BLOCK_SIZE_SMALL;
    const lightRadiusPx = radiusWorld * zoom * (0.5 + 0.5 * bPct);
    const lightXPx      = worldX * zoom + ox;
    const lightYPx      = worldY * zoom + oy;

    const dx     = playerXPx - lightXPx;
    const dy     = playerYPx - lightYPx;
    const distPx = Math.sqrt(dx * dx + dy * dy);

    // Guard against degenerate geometry (should have been caught above, but
    // guard again in case floating-point drift produces a 0 dist here).
    if (distPx < SHADOW_MIN_DIST_PX) continue;

    // ── Shadow length ─────────────────────────────────────────────────────
    // Shadows are longer near the light and shorter toward the edge of the
    // illuminated circle, giving a physically plausible falloff without
    // any real physics.
    const distFraction    = Math.min(1.0, distPx / lightRadiusPx);
    const rawLengthPx     = lightRadiusPx * 0.70 * (1.0 - distFraction * 0.65);
    const shadowLengthPx  = Math.max(8.0, Math.min(lightRadiusPx * 0.70, rawLengthPx));

    const poolObj = _shadowPool[out.length];
    if (buildRectShadowOccluderPx(
      playerXPx,
      playerYPx,
      playerHalfWPx,
      playerHalfHPx,
      lightXPx,
      lightYPx,
      shadowLengthPx,
      poolObj,
      SHADOW_CORE_ALPHA,
    )) {
      out.push(poolObj);
    }
  }
}
