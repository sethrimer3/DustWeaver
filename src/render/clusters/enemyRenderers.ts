/**
 * Enemy rendering helpers — one pure drawing function per enemy type.
 * Extracted from renderer.ts to keep that file focused on the main pipeline.
 *
 * Each function receives only what it needs (ctx, screen coordinates, and
 * the relevant cluster/snapshot data) so the functions are testable in
 * isolation and carry no hidden state.
 */

import type { ClusterSnapshot, WorldSnapshot } from '../snapshot';
import { ParticleKind } from '../../sim/particles/kinds';
export { renderWebSpider, renderWebSpiderFadingWebs } from './webSpiderEnemyRenderer';
export { renderWaterBubbleBody, renderIceBubbleBody, renderBeeSwarm } from './enemyBubbleBeeRenderers';
import { loadImg, isSpriteReady } from '../imageCache';
import {
  RT_STATE_ACTIVE,
} from '../../sim/clusters/radiantTetherAi';
import {
  getCharacterSprites,
  PLAYER_SPRITE_WIDTH_WORLD,
  PLAYER_SPRITE_HEIGHT_WORLD,
  PLAYER_SPRITE_PIVOT_X_WORLD,
  PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD,
} from './characterSprites';

// ── Rolling enemy sprites ────────────────────────────────────────────────────

/** Golden block enemy sprite (16×16 source art). */
const _goldenBlockSprite = loadImg('SPRITES/ENEMIES/goldenBlock/goldenBlock.png');

// ── Rock Elemental sprites ───────────────────────────────────────────────────

const _reHeadDeactivated = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_deactivated.png');
const _reArm1Deactivated = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_deactivated.png');
const _reArm2Deactivated = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_deactivated.png');
const _reHeadActivated   = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_activated.png');
const _reArm1Activated   = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_activated.png');
const _reArm2Activated   = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_activated.png');

// ── Golden Beetle sprites ───────────────────────────────────────────────────

const _beetleWalkSprite = loadImg('SPRITES/ENEMIES/goldenBeetle/goldenBeetle_walking.png');
const _beetleDefensiveSprite = loadImg('SPRITES/ENEMIES/goldenBeetle/goldenBeetle_defensive.png');
const _beetleFlyingSprite = loadImg('SPRITES/ENEMIES/goldenBeetle/goldenBeetle_flying.png');
const _beetleDivingSprite = loadImg('SPRITES/ENEMIES/goldenBeetle/goldenBeetle_diving.png');

// ── Radiant Tether sprites ──────────────────────────────────────────────────

const _radiantTetherFlyingSprite = loadImg('SPRITES/ENEMIES/radiantTeather/radiantTether_flying.png');
const _radiantTetherAttackingSprite = loadImg('SPRITES/ENEMIES/radiantTeather/radiantTether_attacking.png');

// ── Flying Eye rendering constants ──────────────────────────────────────────

/** Sizes of each concentric diamond (as a fraction of the outermost half-diagonal). */
const FLYING_EYE_RING_SCALES = [1.0, 0.72, 0.50, 0.31];
/** Offset of each diamond's centre in the facing direction (fraction of outerR). */
const FLYING_EYE_RING_OFFSETS = [0.0, 0.07, 0.14, 0.19];
/** Stroke widths (screen pixels) for each ring, outer to inner. */
const FLYING_EYE_RING_WIDTHS = [3.5, 2.5, 2.0, 1.5];

// ── Golden Mimic rendering constants ────────────────────────────────────────

/**
 * Pre-computed gold shade palette — from darkest gold to brightest.
 * Allocated once at module load; referenced by index in the hot render loop
 * to avoid per-frame string allocation.
 */
const _goldShades: readonly string[] = [
  '#5a3e00', '#6b4c00', '#7d5900', '#8b6914',
  '#9a7a00', '#b8860b', '#c49a00', '#d4aa00',
  '#daa520', '#e6b800', '#f0c000', '#ffd700',
  '#ffe066', '#fff3b0',
];
const _GOLD_PALETTE_SIZE = _goldShades.length; // 14

// ── Rolling enemy ────────────────────────────────────────────────────────────

/** Renders a rolling enemy: sprite rotated by accumulated roll angle. */
export function renderRollingEnemy(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const boxHalfW = cluster.halfWidthWorld  * scalePx;
  const boxHalfH = cluster.halfHeightWorld * scalePx;
  const boxLeft  = screenX - boxHalfW;
  const boxTop   = screenY - boxHalfH;
  const boxW     = boxHalfW * 2;
  const boxH     = boxHalfH * 2;

  const rollAngle = cluster.rollingEnemyRollAngleRad;
  if (isSpriteReady(_goldenBlockSprite)) {
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(rollAngle);
    ctx.drawImage(_goldenBlockSprite, -boxHalfW, -boxHalfH, boxW, boxH);
    ctx.restore();
  } else {
    // Fallback while sprite loads: orange box
    ctx.fillStyle = '#ff6600';
    ctx.globalAlpha = 0.75;
    ctx.fillRect(boxLeft, boxTop, boxW, boxH);
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#ff6600';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
  }
}

// ── Rock Elemental ───────────────────────────────────────────────────────────

/** Renders a Rock Elemental: composite head + two-arm sprite formation. */
export function renderRockElemental(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const boxW = cluster.halfWidthWorld * scalePx * 2;

  const reState = cluster.rockElementalState;
  const isActiveRE = reState >= 2; // active states use activated sprites
  const activationT = cluster.rockElementalActivationProgress;

  const headSprite = isActiveRE ? _reHeadActivated : _reHeadDeactivated;
  const arm1Sprite = isActiveRE ? _reArm1Activated : _reArm1Deactivated;
  const arm2Sprite = isActiveRE ? _reArm2Activated : _reArm2Deactivated;

  // Piece sizes (matching source sprite proportions):
  // head 24×24, arms 8×16.
  const headSize = boxW * 1.2;
  const armWidth = headSize / 3;
  const armHeight = headSize * (2 / 3);

  if (reState === 0) {
    // Inactive: rock pieces scattered on ground
    if (isSpriteReady(headSprite)) {
      ctx.drawImage(headSprite, screenX - headSize * 0.5, screenY - headSize * 0.3, headSize, headSize);
    }
    if (isSpriteReady(arm1Sprite)) {
      ctx.drawImage(arm1Sprite, screenX - headSize * 0.85, screenY - armHeight * 0.2, armWidth, armHeight);
    }
    if (isSpriteReady(arm2Sprite)) {
      ctx.drawImage(arm2Sprite, screenX + headSize * 0.5, screenY - armHeight * 0.1, armWidth, armHeight);
    }
  } else {
    // Activating or active: lerp pieces into floating formation
    const t = reState === 1 ? activationT : 1.0;

    // Head: rises from ground to center-above
    const headRestY = screenY - headSize * 0.3;
    const headFloatY = screenY - headSize * 1.0;
    const headY = headRestY + (headFloatY - headRestY) * t;

    // Arm 1: slides left
    const arm1RestX = screenX - headSize * 0.85;
    const arm1RestY = screenY - armHeight * 0.2;
    const arm1FloatX = screenX - headSize * 0.6;
    const arm1FloatY = screenY - headSize * 0.55;
    const arm1X = arm1RestX + (arm1FloatX - arm1RestX) * t;
    const arm1Y = arm1RestY + (arm1FloatY - arm1RestY) * t;

    // Arm 2: slides right
    const arm2RestX = screenX + headSize * 0.5;
    const arm2RestY = screenY - armHeight * 0.1;
    const arm2FloatX = screenX + headSize * 0.45;
    const arm2FloatY = screenY - headSize * 0.55;
    const arm2X = arm2RestX + (arm2FloatX - arm2RestX) * t;
    const arm2Y = arm2RestY + (arm2FloatY - arm2RestY) * t;

    // Gentle hover bob when fully active
    const bobOffset = reState >= 2 ? Math.sin(cluster.rockElementalOrbitAngleRad * 0.5) * 2.0 * scalePx : 0;

    if (isSpriteReady(headSprite)) {
      ctx.drawImage(headSprite, screenX - headSize * 0.5, headY + bobOffset, headSize, headSize);
    }
    if (isSpriteReady(arm1Sprite)) {
      ctx.drawImage(arm1Sprite, arm1X, arm1Y + bobOffset, armWidth, armHeight);
    }
    if (isSpriteReady(arm2Sprite)) {
      ctx.drawImage(arm2Sprite, arm2X, arm2Y + bobOffset, armWidth, armHeight);
    }
  }
}

// ── Flying Eye ───────────────────────────────────────────────────────────────

/** Returns the primary display colour for a flying eye by element kind. */
export function getFlyingEyeColor(elementKind: number): string {
  switch (elementKind as ParticleKind) {
    case ParticleKind.Fire:  return '#ff5522';
    case ParticleKind.Ice:   return '#44ccff';
    case ParticleKind.Wind:  return '#88ffaa';
    default:                 return '#ccccff';
  }
}

/**
 * Draws four concentric diamond outlines centred at (screenX, screenY).
 * The inner diamonds are offset in the facing direction so the eye appears
 * to "look" in that direction.
 */
export function renderFlyingEye(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  outerHalfDiagonalPx: number,
  facingAngleRad: number,
  elementKind: number,
  healthRatio: number,
): void {
  const color = getFlyingEyeColor(elementKind);
  const facingDirX = Math.cos(facingAngleRad);
  const facingDirY = Math.sin(facingAngleRad);

  ctx.strokeStyle = color;
  ctx.fillStyle = 'transparent';
  ctx.globalAlpha = 0.85 + healthRatio * 0.15;

  for (let d = 0; d < FLYING_EYE_RING_SCALES.length; d++) {
    const r   = outerHalfDiagonalPx * FLYING_EYE_RING_SCALES[d];
    const off = outerHalfDiagonalPx * FLYING_EYE_RING_OFFSETS[d];
    const cx  = screenX + facingDirX * off;
    const cy  = screenY + facingDirY * off;

    ctx.lineWidth = FLYING_EYE_RING_WIDTHS[d];
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);       // right point
    ctx.lineTo(cx,     cy + r);   // bottom point
    ctx.lineTo(cx - r, cy);       // left point
    ctx.lineTo(cx,     cy - r);   // top point
    ctx.closePath();
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
}

// ── Golden Mimic ─────────────────────────────────────────────────────────────

/** Renders a Golden Mimic: golden pixel-grid overlay clipped to the player silhouette. */
export function renderGoldenMimic(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  tick: number,
  scalePx: number,
  characterId: string,
): void {
  const sprites = getCharacterSprites(characterId);
  const sprite  = sprites.standing;
  const isYFlipped  = cluster.isGoldenMimicYFlippedFlag === 1;
  const fadeAlpha   = cluster.goldenMimicFadeAlpha;
  const spritePivotXPx = PLAYER_SPRITE_PIVOT_X_WORLD * scalePx;
  const spriteHPx      = PLAYER_SPRITE_HEIGHT_WORLD  * scalePx;
  const spriteWPx      = PLAYER_SPRITE_WIDTH_WORLD   * scalePx;
  const spriteCenterY  = screenY + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD * scalePx;

  ctx.save();
  ctx.translate(Math.round(screenX) - 0.5, Math.round(spriteCenterY));
  ctx.scale(
    cluster.isFacingLeftFlag === 1 ? -1 : 1,
    isYFlipped ? -1 : 1,
  );

  if (isSpriteReady(sprite)) {
    // Step 1: draw the sprite at the desired fade alpha — establishes the
    // alpha mask that source-atop will clip to in step 2.
    ctx.globalAlpha = fadeAlpha;
    ctx.drawImage(sprite, -spritePivotXPx, -spriteHPx * 0.5, spriteWPx, spriteHPx);

    // Step 2: overlay gold pixel grid clipped to sprite silhouette.
    ctx.globalCompositeOperation = 'source-atop';

    // Pixel block size: 2 virtual pixels at normal scale, 1 at very small scale.
    const blockPx = scalePx >= 1.5 ? 2 : 1;
    const numBX   = Math.ceil(spriteWPx / blockPx) + 1;
    const numBY   = Math.ceil(spriteHPx / blockPx) + 1;

    // Tick seed advances every 4 ticks for a slow shimmering effect.
    const slowTick = tick >> 2;

    for (let bx = 0; bx < numBX; bx++) {
      for (let by = 0; by < numBY; by++) {
        // Fast pseudo-random hash of (block position, time) using prime multipliers
        // (MurmurHash-inspired integer mixing) — no allocations.
        const h = (((bx * 374761393 + by * 1664525 + slowTick * 22695477) >>> 0) * 2246822519) >>> 0;
        const shadeIdx  = (h >> 24) % _GOLD_PALETTE_SIZE;
        // Alpha variation range: min 0.72 + up to 0.28 additional = [0.72, 1.0],
        // then multiplied by fadeAlpha so the heap fade-out applies uniformly.
        const blockAlpha = fadeAlpha * (0.72 + ((h >> 16) & 0xff) * (0.28 / 255));
        ctx.globalAlpha  = blockAlpha;
        ctx.fillStyle    = _goldShades[shadeIdx];
        ctx.fillRect(
          -spritePivotXPx + bx * blockPx,
          -spriteHPx * 0.5 + by * blockPx,
          blockPx + 1,
          blockPx + 1,
        );
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Fallback while sprite image loads: golden box in the player's footprint.
    ctx.globalAlpha = fadeAlpha * 0.8;
    ctx.fillStyle   = '#ffd700';
    ctx.fillRect(-spritePivotXPx, -spriteHPx * 0.5, spriteWPx, spriteHPx);
  }

  ctx.globalAlpha = 1.0;
  ctx.restore();
}

// ── Slime ────────────────────────────────────────────────────────────────────

export function renderSlimeBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radiusPx: number,
  isLarge: boolean,
  healthRatio: number,
): void {
  const greenIntensity = Math.round(120 + healthRatio * 80);
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = isLarge ? `rgb(20,${greenIntensity},20)` : `rgb(40,${greenIntensity},40)`;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.strokeStyle = isLarge ? '#00ff44' : '#44ff88';
  ctx.lineWidth = 1;
  ctx.stroke();
  const eyeOffsetX = radiusPx * 0.3;
  const eyeOffsetY = -radiusPx * 0.2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - eyeOffsetX, cy + eyeOffsetY, radiusPx * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeOffsetX, cy + eyeOffsetY, radiusPx * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

export function renderLargeSlimeDustOrbit(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  orbitAngleRad: number,
  radiusPx: number,
): void {
  const orbitRadius = radiusPx * 1.6;
  const dotRadius = radiusPx * 0.15;
  ctx.fillStyle = '#88ffaa';
  ctx.globalAlpha = 0.7;
  for (let d = 0; d < 4; d++) {
    const angle = orbitAngleRad + (d * Math.PI * 0.5);
    const dx = Math.cos(angle) * orbitRadius;
    const dy = Math.sin(angle) * orbitRadius;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
}

// ── Wheel Enemy ──────────────────────────────────────────────────────────────

export function renderWheelEnemy(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radiusPx: number,
  rollAngleRad: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(180, 100, 40, 0.85)';
  ctx.fill();
  ctx.strokeStyle = '#ffaa44';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = '#ffcc88';
  ctx.lineWidth = 1;
  for (let s = 0; s < 4; s++) {
    const spokeAngle = rollAngleRad + (s * Math.PI * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(spokeAngle) * radiusPx, cy + Math.sin(spokeAngle) * radiusPx);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffcc88';
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

// ── Golden Beetle ────────────────────────────────────────────────────────────

function drawBeetleSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  cx: number,
  cy: number,
  halfSizePx: number,
): boolean {
  if (!isSpriteReady(sprite)) return false;
  const drawW = halfSizePx * 2;
  const drawH = halfSizePx * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.drawImage(sprite, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
  ctx.restore();
  return true;
}

export function renderBeetleCrawling(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  halfSizePx: number,
  _normalX: number,
  _normalY: number,
  beetleAiState: number,
): void {
  const isIdleState = beetleAiState === 2;
  const sprite = isIdleState ? _beetleDefensiveSprite : _beetleWalkSprite;
  if (!drawBeetleSprite(ctx, sprite, cx, cy, halfSizePx)) {
    ctx.fillStyle = '#c8900a';
    ctx.fillRect(cx - halfSizePx, cy - halfSizePx, halfSizePx * 2, halfSizePx * 2);
  }
}

export function renderBeetleFlying(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  halfSizePx: number,
  beetleAiState: number,
): void {
  const isFlyToward = beetleAiState === 4;
  const sprite = isFlyToward ? _beetleDivingSprite : _beetleFlyingSprite;
  if (!drawBeetleSprite(ctx, sprite, cx, cy, halfSizePx)) {
    ctx.fillStyle = '#c8900a';
    ctx.fillRect(cx - halfSizePx, cy - halfSizePx, halfSizePx * 2, halfSizePx * 2);
  }
}

export function getRadiantTetherBodySprite(state: number): HTMLImageElement {
  if (state === RT_STATE_ACTIVE) {
    return _radiantTetherAttackingSprite;
  }
  return _radiantTetherFlyingSprite;
}

// ── Square Stampede ──────────────────────────────────────────────────────────

/**
 * Renders a Square Stampede enemy: a chain of concentric ghost squares as the
 * trail (oldest farthest back, most faded) plus the current body square.
 *
 * Trail piece index 0 is the most-recently recorded position (closest behind
 * the enemy, 95% of original size); index TRAIL_COUNT-1 is farthest (5% of
 * original size).
 */
export function renderSquareStampede(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  snapshot: WorldSnapshot,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  const slotIndex = cluster.squareStampedeSlotIndex;
  const baseHalfSize = cluster.squareStampedeBaseHalfSizeWorld;
  const stride = snapshot.squareStampedeTrailStride;

  // ── Draw trail (oldest to newest so newer pieces render on top) ──────────
  if (slotIndex >= 0) {
    const base = slotIndex * stride;
    const count = snapshot.squareStampedeTrailCount[slotIndex];
    const head  = snapshot.squareStampedeTrailHead[slotIndex];

    for (let i = count - 1; i >= 0; i--) {
      // Ring-buffer index: i=0 → most recent (head-1), i=count-1 → oldest
      const ringIdx = (head - 1 - i + stride * 2) % stride;
      const trailX  = snapshot.squareStampedeTrailXWorld[base + ringIdx];
      const trailY  = snapshot.squareStampedeTrailYWorld[base + ringIdx];

      // Size: trail piece 0 (most recent, closest) is ~100% of original,
      // piece (stride-1) (oldest, farthest) is ~5% of original.
      // Formula: (stride - i) / stride → i=0: 1.0, i=18: 1/19 ≈ 5%
      // The main body is drawn separately on top, so piece 0 reading as "100%"
      // is fine — its low alpha means it blends naturally behind the body.
      const pieceFrac  = (stride - i) / stride;
      const halfSizePx = baseHalfSize * pieceFrac * scalePx;
      if (halfSizePx < 0.5) continue;

      // Alpha fades from ~35% for the closest piece to ~5% for the farthest
      const alpha = 0.05 + 0.30 * pieceFrac;
      const tx = Math.round(trailX * scalePx + offsetXPx);
      const ty = Math.round(trailY * scalePx + offsetYPx);

      ctx.globalAlpha = Math.min(alpha, 0.45);
      ctx.strokeStyle = '#cc55ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx - halfSizePx, ty - halfSizePx, halfSizePx * 2, halfSizePx * 2);
    }
    ctx.globalAlpha = 1.0;
  }

  // ── Draw current body square ──────────────────────────────────────────────
  const curHalfPx = cluster.halfWidthWorld * scalePx;

  // Glow fill
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#880033';
  ctx.fillRect(screenX - curHalfPx, screenY - curHalfPx, curHalfPx * 2, curHalfPx * 2);
  ctx.globalAlpha = 1.0;

  // Vivid magenta border
  ctx.strokeStyle = '#ff22cc';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(screenX - curHalfPx, screenY - curHalfPx, curHalfPx * 2, curHalfPx * 2);

  // Inner highlight (top-left corner glow)
  ctx.fillStyle = 'rgba(255, 100, 255, 0.35)';
  ctx.fillRect(screenX - curHalfPx + 1, screenY - curHalfPx + 1, curHalfPx * 2 - 2, 2);
  ctx.fillRect(screenX - curHalfPx + 1, screenY - curHalfPx + 1, 2, curHalfPx * 2 - 2);
}

// Web Spider rendering is in webSpiderEnemyRenderer.ts (re-exported above).
