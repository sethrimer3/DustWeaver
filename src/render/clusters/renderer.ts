import { WorldSnapshot } from '../snapshot';
import { DASH_RECHARGE_ANIM_TICKS } from '../../sim/clusters/dashConstants';
import { renderWallSprites } from '../walls/blockSpriteRenderer';
import { BLOCK_SIZE_WORLD } from '../../levels/roomDef';
import { ParticleKind } from '../../sim/particles/kinds';

/** Block size in world units — walls are decomposed into tiles of this size. */
const BLOCK_SIZE_PX = BLOCK_SIZE_WORLD;

// ── Sprite loading ──────────────────────────────────────────────────────────

/** Module-level image cache keyed by URL — populated once, reused forever. */
const _imgCache = new Map<string, HTMLImageElement>();

function _loadImg(src: string): HTMLImageElement {
  const cached = _imgCache.get(src);
  if (cached !== undefined) return cached;
  const img = new Image();
  img.src = src;
  _imgCache.set(src, img);
  return img;
}

function _isSpriteReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/** Player character sprite. */
const _playerSprite: HTMLImageElement = _loadImg('SPRITES/player/player.png');

/** Rolling enemy sprites indexed by spriteIndex (1–6). Index 0 is unused. */
const _enemySprites: HTMLImageElement[] = [
  _loadImg('SPRITES/player/player.png'), // placeholder at index 0 (unused)
  _loadImg('SPRITES/enemies/universal/enemy (1).png'),
  _loadImg('SPRITES/enemies/universal/enemy (2).png'),
  _loadImg('SPRITES/enemies/universal/enemy (3).png'),
  _loadImg('SPRITES/enemies/universal/enemy (4).png'),
  _loadImg('SPRITES/enemies/universal/enemy (5).png'),
  _loadImg('SPRITES/enemies/universal/enemy (6).png'),
];

// ── Flying Eye rendering constants ─────────────────────────────────────────

/** Sizes of each concentric diamond (as a fraction of the outermost half-diagonal). */
const FLYING_EYE_RING_SCALES = [1.0, 0.72, 0.50, 0.31];
/** Offset of each diamond's centre in the facing direction (fraction of outerR). */
const FLYING_EYE_RING_OFFSETS = [0.0, 0.07, 0.14, 0.19];
/** Stroke widths (screen pixels) for each ring, outer to inner. */
const FLYING_EYE_RING_WIDTHS = [3.5, 2.5, 2.0, 1.5];

/** Returns the primary display colour for a flying eye by element kind. */
function getFlyingEyeColor(elementKind: number): string {
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
function renderFlyingEye(
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

/**
 * Renders walls (level geometry) from the snapshot on the 2D canvas using
 * context-sensitive (auto-tiling) block sprites.  Falls back to solid-colour
 * rectangles per tile while sprites are still loading.
 * Walls are drawn before cluster indicators so clusters appear on top.
 */
export function renderWalls(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  renderWallSprites(ctx, snapshot, offsetXPx, offsetYPx, scalePx, BLOCK_SIZE_PX);
}

export function renderClusters(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  showHitboxes = false,
): void {
  ctx.save();

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const screenX = cluster.positionXWorld * scalePx + offsetXPx;
    const screenY = cluster.positionYWorld * scalePx + offsetYPx;

    const isPlayer = cluster.isPlayerFlag === 1;

    // ── Box dimensions ─────────────────────────────────────────────────────
    const boxHalfW = cluster.halfWidthWorld * scalePx;
    const boxHalfH = cluster.halfHeightWorld * scalePx;
    const boxLeft  = screenX - boxHalfW;
    const boxTop   = screenY - boxHalfH;
    const boxW     = boxHalfW * 2;
    const boxH     = boxHalfH * 2;

    // ── Influence ring (faint, dashed) ─────────────────────────────────────
    const influenceRadiusPx = cluster.influenceRadiusWorld * scalePx;
    ctx.beginPath();
    ctx.arc(screenX, screenY, influenceRadiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = isPlayer
      ? 'rgba(0,255,153,0.10)'
      : 'rgba(255,102,0,0.08)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Dash recharge golden ring animation ───────────────────────────────
    if (isPlayer && cluster.dashRechargeAnimTicks > 0) {
      const animProgress = 1.0 - cluster.dashRechargeAnimTicks / DASH_RECHARGE_ANIM_TICKS;
      const startDistancePx = 60;
      const endDistancePx   = boxHalfW;
      const ringRadiusPx    = startDistancePx + (endDistancePx - startDistancePx) * animProgress;
      const alpha = animProgress < 0.6
        ? animProgress / 0.6
        : 1.0 - (animProgress - 0.6) / 0.4;
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringRadiusPx, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#ffd23c';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // ── Dash cooldown arc (only when recharging) ──────────────────────────
    if (cluster.dashCooldownTicks > 0 && isPlayer) {
      const progress = 1.0 - cluster.dashCooldownTicks / cluster.maxDashCooldownTicks;
      ctx.beginPath();
      ctx.arc(screenX, screenY, boxHalfW + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,30,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (cluster.isFlyingEyeFlag === 1) {
      // ── Flying Eye: draw 4 concentric diamond outlines ──────────────────
      const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;
      const outerHalfDiagonalScreen = boxHalfW * 2.5;
      renderFlyingEye(
        ctx, screenX, screenY,
        outerHalfDiagonalScreen,
        cluster.flyingEyeFacingAngleRad,
        cluster.flyingEyeElementKind,
        healthRatio,
      );
    } else if (isPlayer) {
      // ── Player: sprite (fitted to box, slowly rotating) ─────────────────
      const rotAngle = cluster.playerRotationAngleRad;
      const sprite   = _playerSprite;
      if (_isSpriteReady(sprite)) {
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(rotAngle);
        ctx.drawImage(sprite, -boxHalfW, -boxHalfH, boxW, boxH);
        ctx.restore();
      } else {
        // Fallback while sprite loads: coloured box
        ctx.fillStyle = '#00ff99';
        ctx.globalAlpha = 0.75;
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#00ff99';
        ctx.lineWidth = 2;
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      }
    } else if (cluster.isRollingEnemyFlag === 1) {
      // ── Rolling enemy: sprite rotated by accumulated roll angle ──────────
      const idx    = cluster.rollingEnemySpriteIndex;
      const sprite = idx >= 1 && idx <= 6 ? _enemySprites[idx] : _enemySprites[1];
      const rollAngle = cluster.rollingEnemyRollAngleRad;
      if (_isSpriteReady(sprite)) {
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
    } else {
      // ── Regular cluster box body ─────────────────────────────────────────
      const bodyColor = '#ff6600';

      // Filled box
      ctx.fillStyle = bodyColor;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(boxLeft, boxTop, boxW, boxH);
      ctx.globalAlpha = 1.0;

      // Box border
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(boxLeft, boxTop, boxW, boxH);

      // Inner highlight on top edge
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(boxLeft + 2, boxTop + 2, boxW - 4, 3);

      if (showHitboxes) {
        ctx.strokeStyle = 'rgba(255, 120, 40, 0.95)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
        ctx.setLineDash([]);
      }
    }

    // ── Health bar (above the body) ───────────────────────────────────────
    const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;
    // For flying eyes the health bar is anchored above the outer diamond ring;
    // for regular clusters it sits above the box.
    const barWidthPx  = cluster.isFlyingEyeFlag === 1
      ? boxHalfW * 5.0
      : boxW;
    const barHeightPx = 4;
    const barXPx      = cluster.isFlyingEyeFlag === 1
      ? screenX - barWidthPx * 0.5
      : boxLeft;
    const barYPx      = cluster.isFlyingEyeFlag === 1
      ? screenY - boxHalfW * 2.5 - barHeightPx - 6
      : boxTop - barHeightPx - 4;

    ctx.fillStyle = '#333';
    ctx.fillRect(barXPx, barYPx, barWidthPx, barHeightPx);
    let barColor: string;
    if (cluster.isFlyingEyeFlag === 1) {
      barColor = getFlyingEyeColor(cluster.flyingEyeElementKind);
    } else if (isPlayer) {
      barColor = '#00ff99';
    } else {
      barColor = '#ff6600';
    }
    ctx.fillStyle = barColor;
    ctx.fillRect(barXPx, barYPx, barWidthPx * healthRatio, barHeightPx);
  }

  ctx.restore();
}

export function renderGrapple(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  if (snapshot.isGrappleActiveFlag === 0 && snapshot.grappleAttachFxTicks <= 0) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined && snapshot.grappleAttachFxTicks <= 0) return;

  const px = playerCluster !== undefined ? playerCluster.positionXWorld * scalePx + offsetXPx : 0;
  const py = playerCluster !== undefined ? playerCluster.positionYWorld * scalePx + offsetYPx : 0;
  const ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  const ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;

  ctx.save();

  if (snapshot.isGrappleActiveFlag === 1 && playerCluster !== undefined) {
    // Faint guide glow only — the "rope" itself is represented by gold particles.
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ax, ay);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.08)';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([1, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Anchor point circle ───────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(ax, ay, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 200, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (snapshot.grappleAttachFxTicks > 0) {
    const fxProgress = 1.0 - snapshot.grappleAttachFxTicks / 14.0;
    const fxRadius = 6 + fxProgress * 24;
    const fxAlpha = 0.4 * (1.0 - fxProgress);
    ctx.beginPath();
    ctx.arc(
      snapshot.grappleAttachFxXWorld * scalePx + offsetXPx,
      snapshot.grappleAttachFxYWorld * scalePx + offsetYPx,
      fxRadius,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(255, 236, 170, ${fxAlpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}
