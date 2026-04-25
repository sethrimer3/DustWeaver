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
import { loadImg, isSpriteReady } from '../imageCache';
import {
  getCharacterSprites,
  PLAYER_SPRITE_WIDTH_WORLD,
  PLAYER_SPRITE_HEIGHT_WORLD,
  PLAYER_SPRITE_PIVOT_X_WORLD,
  PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD,
} from './characterSprites';

// ── Rolling enemy sprites ────────────────────────────────────────────────────

/** Rolling enemy sprites indexed by spriteIndex (1–6). Index 0 is unused. */
const _enemySprites: HTMLImageElement[] = [
  loadImg('SPRITES/player/player.png'), // placeholder at index 0 (unused)
  loadImg('SPRITES/enemies/universal/enemy (1).png'),
  loadImg('SPRITES/enemies/universal/enemy (2).png'),
  loadImg('SPRITES/enemies/universal/enemy (3).png'),
  loadImg('SPRITES/enemies/universal/enemy (4).png'),
  loadImg('SPRITES/enemies/universal/enemy (5).png'),
  loadImg('SPRITES/enemies/universal/enemy (6).png'),
];

// ── Rock Elemental sprites ───────────────────────────────────────────────────

const _reHeadDeactivated = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_deactivated.png');
const _reArm1Deactivated = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_deactivated.png');
const _reArm2Deactivated = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_deactivated.png');
const _reHeadActivated   = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_activated.png');
const _reArm1Activated   = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_activated.png');
const _reArm2Activated   = loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_activated.png');

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

  const idx    = cluster.rollingEnemySpriteIndex;
  const sprite = idx >= 1 && idx <= 6 ? _enemySprites[idx] : _enemySprites[1];
  const rollAngle = cluster.rollingEnemyRollAngleRad;
  if (isSpriteReady(sprite)) {
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.rotate(rollAngle);
    ctx.drawImage(sprite, -boxHalfW, -boxHalfH, boxW, boxH);
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

  // Piece sizes
  const headSize = boxW * 1.2;
  const armSize = boxW * 0.9;

  if (reState === 0) {
    // Inactive: rock pieces scattered on ground
    if (isSpriteReady(headSprite)) {
      ctx.drawImage(headSprite, screenX - headSize * 0.5, screenY - headSize * 0.3, headSize, headSize);
    }
    if (isSpriteReady(arm1Sprite)) {
      ctx.drawImage(arm1Sprite, screenX - armSize * 1.4, screenY, armSize, armSize);
    }
    if (isSpriteReady(arm2Sprite)) {
      ctx.drawImage(arm2Sprite, screenX + armSize * 0.5, screenY + armSize * 0.1, armSize, armSize);
    }
  } else {
    // Activating or active: lerp pieces into floating formation
    const t = reState === 1 ? activationT : 1.0;

    // Head: rises from ground to center-above
    const headRestY = screenY - headSize * 0.3;
    const headFloatY = screenY - headSize * 1.0;
    const headY = headRestY + (headFloatY - headRestY) * t;

    // Arm 1: slides left
    const arm1RestX = screenX - armSize * 1.4;
    const arm1RestY = screenY;
    const arm1FloatX = screenX - armSize * 1.1;
    const arm1FloatY = screenY - armSize * 0.4;
    const arm1X = arm1RestX + (arm1FloatX - arm1RestX) * t;
    const arm1Y = arm1RestY + (arm1FloatY - arm1RestY) * t;

    // Arm 2: slides right
    const arm2RestX = screenX + armSize * 0.5;
    const arm2RestY = screenY + armSize * 0.1;
    const arm2FloatX = screenX + armSize * 0.3;
    const arm2FloatY = screenY - armSize * 0.4;
    const arm2X = arm2RestX + (arm2FloatX - arm2RestX) * t;
    const arm2Y = arm2RestY + (arm2FloatY - arm2RestY) * t;

    // Gentle hover bob when fully active
    const bobOffset = reState >= 2 ? Math.sin(cluster.rockElementalOrbitAngleRad * 0.5) * 2.0 * scalePx : 0;

    if (isSpriteReady(headSprite)) {
      ctx.drawImage(headSprite, screenX - headSize * 0.5, headY + bobOffset, headSize, headSize);
    }
    if (isSpriteReady(arm1Sprite)) {
      ctx.drawImage(arm1Sprite, arm1X, arm1Y + bobOffset, armSize, armSize);
    }
    if (isSpriteReady(arm2Sprite)) {
      ctx.drawImage(arm2Sprite, arm2X, arm2Y + bobOffset, armSize, armSize);
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

/**
 * Stub renderer for a crawling golden beetle.
 * Draws an oval body oriented according to the surface normal, with stubby legs.
 * The forward direction is the tangent to the surface (perpendicular to normal).
 */
export function renderBeetleCrawling(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  halfSizePx: number,
  normalX: number,
  normalY: number,
): void {
  // Angle: body faces along the tangent of the surface normal.
  // Normal (0,-1) → tangent (1,0) → angle=0; normal (-1,0) → tangent (0,-1) → angle=-π/2.
  const tangentX = -normalY;
  const tangentY =  normalX;
  const angle = Math.atan2(tangentY, tangentX);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  // Elytra (wing covers) — golden oval
  ctx.beginPath();
  ctx.ellipse(0, 0, halfSizePx * 1.1, halfSizePx * 0.75, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c8900a';
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Gold sheen outline
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Elytra dividing line down the middle
  ctx.beginPath();
  ctx.moveTo(0, -halfSizePx * 0.75);
  ctx.lineTo(0, halfSizePx * 0.75);
  ctx.strokeStyle = '#ffec60';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Head nub (front)
  ctx.beginPath();
  ctx.arc(halfSizePx * 0.95, 0, halfSizePx * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#b87000';
  ctx.fill();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Legs — 3 pairs (stub lines perpendicular to body)
  ctx.strokeStyle = '#8b5000';
  ctx.lineWidth = 1;
  const legOffsets = [-halfSizePx * 0.5, 0, halfSizePx * 0.5];
  for (let li = 0; li < legOffsets.length; li++) {
    const lx = legOffsets[li];
    ctx.beginPath();
    ctx.moveTo(lx, halfSizePx * 0.7);
    ctx.lineTo(lx + halfSizePx * 0.2, halfSizePx * 1.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx, -halfSizePx * 0.7);
    ctx.lineTo(lx + halfSizePx * 0.2, -halfSizePx * 1.3);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Stub renderer for a flying golden beetle.
 * Draws the body with spread wing outlines to indicate flight.
 */
export function renderBeetleFlying(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  halfSizePx: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Wings (spread out, semi-transparent)
  ctx.beginPath();
  ctx.ellipse(-halfSizePx * 1.5, -halfSizePx * 0.3,
    halfSizePx * 1.3, halfSizePx * 0.45, -Math.PI * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 220, 80, 0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(halfSizePx * 1.5, -halfSizePx * 0.3,
    halfSizePx * 1.3, halfSizePx * 0.45, Math.PI * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 220, 80, 0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Elytra body — slightly open (horizontal orientation)
  ctx.beginPath();
  ctx.ellipse(0, 0, halfSizePx * 1.1, halfSizePx * 0.75, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c8900a';
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Head nub
  ctx.beginPath();
  ctx.arc(halfSizePx * 0.95, 0, halfSizePx * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#b87000';
  ctx.fill();
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Small antennae
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(halfSizePx * 1.2, -halfSizePx * 0.2);
  ctx.lineTo(halfSizePx * 1.9, -halfSizePx * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(halfSizePx * 1.2, halfSizePx * 0.2);
  ctx.lineTo(halfSizePx * 1.9, halfSizePx * 0.8);
  ctx.stroke();

  ctx.restore();
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

// ── Bubble enemies ───────────────────────────────────────────────────────────

export function renderWaterBubbleBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radiusPx: number,
  healthRatio: number,
): void {
  const alpha = 0.15 + healthRatio * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(40,120,220,${alpha.toFixed(2)})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(80,180,255,${(0.55 + healthRatio * 0.35).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function renderIceBubbleBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radiusPx: number,
  healthRatio: number,
): void {
  const alpha = 0.12 + healthRatio * 0.18;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(200,235,255,${alpha.toFixed(2)})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(220,245,255,${(0.6 + healthRatio * 0.3).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ── Bee Swarm ─────────────────────────────────────────────────────────────────

/**
 * Renders a bee swarm: draws each alive bee as a 4×2 sprite made of two
 * 2×2 pixel squares — a gold head square and a black butt square.
 *
 * The sprite faces the direction of the bee's velocity:
 *   • Moving right (velX ≥ 0): gold on the RIGHT, black on the LEFT
 *     (head in direction of travel, butt behind).
 *   • Moving left  (velX < 0): gold on the LEFT,  black on the RIGHT.
 *
 * `aliveCount` is `cluster.healthPoints`; bees at index ≥ aliveCount are dead.
 */
export function renderBeeSwarm(
  ctx: CanvasRenderingContext2D,
  cluster: ClusterSnapshot,
  snapshot: WorldSnapshot,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  const slot = cluster.beeSwarmSlotIndex;
  if (slot < 0) return;

  const aliveCount = cluster.healthPoints;
  const base       = slot * 10; // BEES_PER_SWARM = 10

  const isCharging = cluster.beeSwarmState === 1;

  for (let bi = 0; bi < aliveCount; bi++) {
    const idx = base + bi;
    const bx  = snapshot.beeSwarmBeeXWorld[idx];
    const by  = snapshot.beeSwarmBeeYWorld[idx];
    const bvx = snapshot.beeSwarmBeeVelXWorld[idx];

    // Each bee is 4 wide × 2 tall in world units → 2 px half-width, 1 px half-height
    // The "pixel" size on screen depends on scalePx.
    const halfW = 2 * scalePx; // total 4 world-unit width rendered at scalePx
    const halfH = 1 * scalePx; // total 2 world-unit height

    const cx = bx * scalePx + offsetXPx;
    const cy = by * scalePx + offsetYPx;

    // Each half-square is 2×2 world units = 2*scalePx × 2*scalePx on screen
    const sq = 2 * scalePx;

    // Face right when velocity X ≥ 0: gold head is on the right half
    const facingRight = bvx >= 0;

    // Black (butt) square position
    const buttX = facingRight ? cx - halfW : cx;
    // Gold (head) square position
    const headX = facingRight ? cx         : cx - halfW;
    const squareY = cy - halfH;

    ctx.globalAlpha = isCharging ? 0.95 : 0.82;

    // Draw butt (black square)
    ctx.fillStyle = '#111111';
    ctx.fillRect(buttX, squareY, sq, sq);

    // Draw head (gold square)
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(headX, squareY, sq, sq);

    // Thin amber outline around whole bee (2 pixels wide in world = 1 px thin outline)
    ctx.strokeStyle = isCharging ? '#ff8800' : '#c89000';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cx - halfW, squareY, halfW * 2, sq);
  }

  ctx.globalAlpha = 1.0;
}
