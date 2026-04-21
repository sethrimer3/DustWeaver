import { WorldSnapshot, ClusterSnapshot } from '../snapshot';
import { DASH_RECHARGE_ANIM_TICKS } from '../../sim/clusters/dashConstants';
import { renderWallSprites } from '../walls/blockSpriteRenderer';
import { BLOCK_SIZE_MEDIUM, PLAYER_HALF_WIDTH_WORLD } from '../../levels/roomDef';
import { ParticleKind } from '../../sim/particles/kinds';
import type { PlayerCloak } from './playerCloak';

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

function _loadImgWithFallback(srcList: readonly string[]): HTMLImageElement {
  const img = _loadImg(srcList[0]);
  if (srcList.length <= 1) return img;

  let candidateIndex = 1;
  img.addEventListener('error', () => {
    if (candidateIndex >= srcList.length) return;
    img.src = srcList[candidateIndex++];
  });
  return img;
}

// ── Character sprite sets ───────────────────────────────────────────────────

interface CharacterSprites {
  standing: HTMLImageElement;
  idle1: HTMLImageElement;
  idle2: HTMLImageElement;
  idleBlink: HTMLImageElement;
  sprinting: HTMLImageElement;
  crouching: HTMLImageElement;
  grappling: HTMLImageElement;
  jumping: HTMLImageElement;
  falling: HTMLImageElement;
  fastFalling: HTMLImageElement;
  swinging: HTMLImageElement;
}

/** 1 virtual pixel outline thickness around player sprites. */
const PLAYER_OUTLINE_THICKNESS_WORLD = 1;
/** Precomputed outer-edge outline masks keyed by source player sprite image. */
const _playerOutlineMaskCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
/** 8-neighbour offsets used to detect silhouette edges (includes diagonals). */
const _outlineNeighborOffsets: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

/**
 * Builds a black outline mask for the sprite's outer silhouette only.
 * Internal transparent holes are excluded by flood-filling only the
 * transparency region connected to the texture border.
 */
function _getOrCreateOuterOutlineMask(sprite: HTMLImageElement): HTMLCanvasElement {
  const cached = _playerOutlineMaskCache.get(sprite);
  if (cached !== undefined) return cached;

  const spriteWidthPx = sprite.naturalWidth;
  const spriteHeightPx = sprite.naturalHeight;
  const paddedWidthPx = spriteWidthPx + 2;
  const paddedHeightPx = spriteHeightPx + 2;
  const pixelCount = paddedWidthPx * paddedHeightPx;

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = paddedWidthPx;
  alphaCanvas.height = paddedHeightPx;
  const alphaCtx = alphaCanvas.getContext('2d');
  if (alphaCtx === null) {
    _playerOutlineMaskCache.set(sprite, alphaCanvas);
    return alphaCanvas;
  }
  alphaCtx.clearRect(0, 0, paddedWidthPx, paddedHeightPx);
  alphaCtx.drawImage(sprite, 1, 1);
  const alphaData = alphaCtx.getImageData(0, 0, paddedWidthPx, paddedHeightPx).data;

  const isOpaqueFlag = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    isOpaqueFlag[pixelIndex] = alphaData[pixelIndex * 4 + 3] > 0 ? 1 : 0;
  }

  const isOutsideFlag = new Uint8Array(pixelCount);
  const queueX = new Int16Array(pixelCount);
  const queueY = new Int16Array(pixelCount);
  let queueReadIndex = 0;
  let queueWriteIndex = 0;

  const enqueueIfOutside = (xPx: number, yPx: number): void => {
    const idx = yPx * paddedWidthPx + xPx;
    if (isOpaqueFlag[idx] === 1 || isOutsideFlag[idx] === 1) return;
    isOutsideFlag[idx] = 1;
    queueX[queueWriteIndex] = xPx;
    queueY[queueWriteIndex] = yPx;
    queueWriteIndex++;
  };

  for (let xPx = 0; xPx < paddedWidthPx; xPx++) {
    enqueueIfOutside(xPx, 0);
    enqueueIfOutside(xPx, paddedHeightPx - 1);
  }
  for (let yPx = 1; yPx < paddedHeightPx - 1; yPx++) {
    enqueueIfOutside(0, yPx);
    enqueueIfOutside(paddedWidthPx - 1, yPx);
  }

  while (queueReadIndex < queueWriteIndex) {
    const xPx = queueX[queueReadIndex];
    const yPx = queueY[queueReadIndex];
    queueReadIndex++;

    if (xPx > 0) enqueueIfOutside(xPx - 1, yPx);
    if (xPx < paddedWidthPx - 1) enqueueIfOutside(xPx + 1, yPx);
    if (yPx > 0) enqueueIfOutside(xPx, yPx - 1);
    if (yPx < paddedHeightPx - 1) enqueueIfOutside(xPx, yPx + 1);
  }

  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = paddedWidthPx;
  outlineCanvas.height = paddedHeightPx;
  const outlineCtx = outlineCanvas.getContext('2d');
  if (outlineCtx === null) {
    _playerOutlineMaskCache.set(sprite, outlineCanvas);
    return outlineCanvas;
  }

  const outlineImage = outlineCtx.createImageData(paddedWidthPx, paddedHeightPx);
  const outlinePixels = outlineImage.data;
  for (let yPx = 0; yPx < paddedHeightPx; yPx++) {
    for (let xPx = 0; xPx < paddedWidthPx; xPx++) {
      const idx = yPx * paddedWidthPx + xPx;
      if (isOutsideFlag[idx] === 0) continue;

      let hasOpaqueNeighbor = false;
      for (let n = 0; n < _outlineNeighborOffsets.length; n++) {
        const nx = xPx + _outlineNeighborOffsets[n][0];
        const ny = yPx + _outlineNeighborOffsets[n][1];
        if (nx < 0 || nx >= paddedWidthPx || ny < 0 || ny >= paddedHeightPx) continue;
        if (isOpaqueFlag[ny * paddedWidthPx + nx] === 1) {
          hasOpaqueNeighbor = true;
          break;
        }
      }
      if (!hasOpaqueNeighbor) continue;

      const dataIndex = idx * 4;
      outlinePixels[dataIndex] = 0;
      outlinePixels[dataIndex + 1] = 0;
      outlinePixels[dataIndex + 2] = 0;
      outlinePixels[dataIndex + 3] = 255;
    }
  }
  outlineCtx.putImageData(outlineImage, 0, 0);
  _playerOutlineMaskCache.set(sprite, outlineCanvas);
  return outlineCanvas;
}

function _loadCharacterSprites(characterId: string): CharacterSprites {
  const base = `SPRITES/PLAYERS/${characterId}/${characterId}`;
  const standingSrc = `${base}_standing.png`;
  return {
    standing:   _loadImg(standingSrc),
    idle1:      _loadImgWithFallback([`${base}_idle1.png`, standingSrc]),
    idle2:      _loadImgWithFallback([`${base}_idle2.png`, standingSrc]),
    idleBlink:  _loadImgWithFallback([`${base}_idleBlink.png`, standingSrc]),
    sprinting:  _loadImgWithFallback([`${base}_sprinting.png`, standingSrc]),
    crouching:  _loadImgWithFallback([`${base}_crouching.png`, standingSrc]),
    grappling:  _loadImgWithFallback([`${base}_grappling.png`, standingSrc]),
    jumping:    _loadImgWithFallback([`${base}_jumping.png`, standingSrc]),
    falling:    _loadImgWithFallback([`${base}_falling.png`, standingSrc]),
    fastFalling: _loadImgWithFallback([`${base}_fastfalling.png`, standingSrc]),
    swinging:   _loadImgWithFallback([`${base}_swinging.png`, standingSrc]),
  };
}

/** Pre-loaded sprite sets for all playable characters. */
const _characterSprites: Record<string, CharacterSprites> = {
  knight:   _loadCharacterSprites('knight'),
  demonFox: _loadCharacterSprites('demonFox'),
  princess: _loadCharacterSprites('princess'),
  outcast:  _loadCharacterSprites('outcast'),
};

/**
 * Returns the appropriate sprite for the current player state.
 * Priority (highest first):
 *  1. Swinging on grapple with decent velocity → swinging sprite
 *  2. Crouching (grounded + down held) → crouching sprite
 *  3. Airborne & moving upward            → jumping sprite
 *  4. Airborne & fast-falling             → fastFalling sprite
 *  5. Airborne & moving downward          → falling sprite
 *  6. Sprinting                           → sprinting sprite
 *  7. Idle animation states               → idle1 / idle2 / idleBlink
 *  8. Default                             → standing sprite
 *
 * When grappling with low/zero velocity, the standing sprite is shown.
 */
function _getPlayerSprite(
  sprites: CharacterSprites,
  cluster: ClusterSnapshot,
  isGrappling: boolean,
): HTMLImageElement {
  // ── Grapple states ─────────────────────────────────────────────────────
  if (isGrappling) {
    const swingSpeed = Math.sqrt(
      cluster.velocityXWorld * cluster.velocityXWorld +
      cluster.velocityYWorld * cluster.velocityYWorld,
    );
    if (swingSpeed > PLAYER_SWING_SPEED_THRESHOLD_WORLD) {
      return sprites.swinging;
    }
    // Low velocity while grappling → show standing sprite
    return sprites.standing;
  }

  // ── Crouch ────────────────────────────────────────────────────────────
  if (cluster.isCrouchingFlag === 1) return sprites.crouching;

  // ── Airborne states ───────────────────────────────────────────────────
  if (cluster.isGroundedFlag === 0) {
    if (cluster.velocityYWorld < 0) return sprites.jumping;
    if (cluster.velocityYWorld > PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD) return sprites.fastFalling;
    return sprites.falling;
  }

  // ── Grounded states ───────────────────────────────────────────────────
  if (cluster.isSprintingFlag === 1) return sprites.sprinting;

  // Idle animation states: 0=standing, 1=idle1, 2=idle2, 3=idleBlink
  switch (cluster.playerIdleAnimState) {
    case 1: return sprites.idle1;
    case 2: return sprites.idle2;
    case 3: return sprites.idleBlink;
    default: return sprites.standing;
  }
}

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

// ── Rock Elemental sprites ────────────────────────────────────────────────

const _reHeadDeactivated = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_deactivated.png');
const _reArm1Deactivated = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_deactivated.png');
const _reArm2Deactivated = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_deactivated.png');
const _reHeadActivated   = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_head_activated.png');
const _reArm1Activated   = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_1_activated.png');
const _reArm2Activated   = _loadImg('SPRITES/ENEMIES/earthElemental/earthElemental_arm_2_activated.png');

// ── Flying Eye rendering constants ─────────────────────────────────────────

/** Sizes of each concentric diamond (as a fraction of the outermost half-diagonal). */
const FLYING_EYE_RING_SCALES = [1.0, 0.72, 0.50, 0.31];
/** Offset of each diamond's centre in the facing direction (fraction of outerR). */
const FLYING_EYE_RING_OFFSETS = [0.0, 0.07, 0.14, 0.19];
/** Stroke widths (screen pixels) for each ring, outer to inner. */
const FLYING_EYE_RING_WIDTHS = [3.5, 2.5, 2.0, 1.5];
/** Player sprite render width in world units (virtual px at zoom 1). */
const PLAYER_SPRITE_WIDTH_WORLD = 16;
/** Player sprite render height in world units (virtual px at zoom 1). */
const PLAYER_SPRITE_HEIGHT_WORLD = 24;
/**
 * X pixel (from sprite's left edge, in world units) used as the flip pivot when
 * mirroring the sprite for the facing-left direction.  Corresponds to the
 * horizontal centre of the gameplay hitbox (x 6–13 → centre at 9.5).
 */
const PLAYER_SPRITE_PIVOT_X_WORLD = 9.5;
/**
 * Vertical offset from hitbox centre to the sprite's draw pivot so that the
 * sprite's pixel-14 (vertical centre of the y 4–24 hitbox) aligns with the
 * cluster's world position.  Equals -(spriteHalfH - 12) = -(12 - 12) + adjustment.
 * Formula: PLAYER_SPRITE_HALF_HEIGHT(12) - hitboxCentreInSprite(14) = -2.
 */
const PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD = -2;
/**
 * Minimum speed (world units/sec) the player must be moving while on the
 * grapple to use the swinging sprite instead of the standing sprite.
 */
const PLAYER_SWING_SPEED_THRESHOLD_WORLD = 60;
/**
 * Downward velocity threshold (world units/sec) above which the fast-falling
 * sprite is shown.  Matches the cloak renderer's fast-fall threshold.
 */
const PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD = 180;
/** Minimum speed (world units/sec) before subtle player afterimages appear. */
const PLAYER_AFTERIMAGE_MIN_SPEED_WORLD_PER_SEC = 185;
/** Number of faint trailing afterimages to draw at high speed. */
const PLAYER_AFTERIMAGE_COUNT = 2;
/**
 * Duration in ticks of the hurt visual feedback window.
 * Must match HURT_VISUAL_DURATION_TICKS in sim/playerDamage.ts.
 */
const HURT_FLASH_DURATION_TICKS = 20;
/** Maximum alpha of the red damage tint overlay (at the start of the hurt window). */
const HURT_FLASH_MAX_ALPHA = 0.45;

const _grappleDustSprite = _loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust.png');
const _grappleDustEndSprite = _loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust_end.png');
const GRAPPLE_DUST_SEGMENT_PX = 4;
const GRAPPLE_DUST_SIZE_PX = 4;
const GRAPPLE_DUST_END_SIZE_PX = 4;

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
 *
 * When isDebugMode is true, a red outline is drawn around every wall AABB so
 * that hitbox boundaries are visible during development.
 */
export function renderWalls(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number, isDebugMode = false): void {
  renderWallSprites(ctx, snapshot, offsetXPx, offsetYPx, scalePx, BLOCK_SIZE_MEDIUM);

  if (isDebugMode) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (let wi = 0; wi < snapshot.walls.count; wi++) {
      const screenX = snapshot.walls.xWorld[wi] * scalePx + offsetXPx;
      const screenY = snapshot.walls.yWorld[wi] * scalePx + offsetYPx;
      const screenW = snapshot.walls.wWorld[wi] * scalePx;
      const screenH = snapshot.walls.hWorld[wi] * scalePx;
      const isInvisibleBoundary = snapshot.walls.isInvisibleFlag[wi] === 1;
      const isThinHorizontal = screenH <= BLOCK_SIZE_MEDIUM * scalePx;
      const isThinVertical = screenW <= BLOCK_SIZE_MEDIUM * scalePx;
      if (isInvisibleBoundary && (isThinHorizontal || isThinVertical)) {
        // Draw a single centerline for thin invisible boundary walls so room
        // borders show as one dotted line instead of a double-edge rectangle.
        ctx.beginPath();
        if (isThinHorizontal) {
          const centerY = screenY + screenH * 0.5;
          ctx.moveTo(screenX, centerY);
          ctx.lineTo(screenX + screenW, centerY);
        } else {
          const centerX = screenX + screenW * 0.5;
          ctx.moveTo(centerX, screenY);
          ctx.lineTo(centerX, screenY + screenH);
        }
        ctx.stroke();
      } else {
        ctx.strokeRect(screenX, screenY, screenW, screenH);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}

export function renderClusters(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  showHitboxes = false,
  playerCloak?: PlayerCloak,
  isDebugCloak = false,
): void {
  ctx.save();
  // Pixel-art safety: simulation/camera may be subpixel, but sprite draws
  // should land on integer screen pixels to avoid texture interpolation blur.
  ctx.imageSmoothingEnabled = false;

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const screenX = Math.round(cluster.renderPositionXWorld * scalePx + offsetXPx);
    const screenY = Math.round(cluster.renderPositionYWorld * scalePx + offsetYPx);

    const isPlayer = cluster.isPlayerFlag === 1;

    // ── Box dimensions ─────────────────────────────────────────────────────
    const boxHalfW = cluster.halfWidthWorld * scalePx;
    const boxHalfH = cluster.halfHeightWorld * scalePx;
    const boxLeft  = screenX - boxHalfW;
    const boxTop   = screenY - boxHalfH;
    const boxW     = boxHalfW * 2;
    const boxH     = boxHalfH * 2;

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
      // ── Player: character sprite (no rotation; flip when facing left) ────
      const charSprites = _characterSprites[snapshot.characterId] ?? _characterSprites['knight'];
      const isGrappling = snapshot.isGrappleActiveFlag === 1;
      const sprite = _getPlayerSprite(charSprites, cluster, isGrappling);
      // spritePivotX is the x-offset from the flip-pivot (hitbox centre, screenX) to
      // the sprite's left edge.  Pixel 9.5 from the sprite left aligns with screenX,
      // so the sprite left is 9.5px to the left of screenX.
      const spritePivotX = PLAYER_SPRITE_PIVOT_X_WORLD * scalePx;
      const spriteHalfH = (PLAYER_SPRITE_HEIGHT_WORLD * scalePx) * 0.5;
      const spriteW = PLAYER_SPRITE_WIDTH_WORLD * scalePx;
      const spriteH = spriteHalfH * 2;
      const spriteCenterY = screenY + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD * scalePx;
      // Build player state for cloak rendering (shared by back + front).
      const cloakPlayerState = playerCloak !== undefined ? {
        positionXWorld: cluster.positionXWorld,
        positionYWorld: cluster.positionYWorld,
        velocityXWorld: cluster.velocityXWorld,
        velocityYWorld: cluster.velocityYWorld,
        isFacingLeftFlag: cluster.isFacingLeftFlag,
        isGroundedFlag: cluster.isGroundedFlag,
        isSprintingFlag: cluster.isSprintingFlag,
        isCrouchingFlag: cluster.isCrouchingFlag,
        isWallSlidingFlag: cluster.isWallSlidingFlag,
        halfWidthWorld: cluster.halfWidthWorld,
        halfHeightWorld: cluster.halfHeightWorld,
      } : undefined;

      if (_isSpriteReady(sprite)) {
        // ── Invulnerability flicker: skip every other 3 ticks while invulnerable ──
        const isInvulnerable = cluster.invulnerabilityTicks > 0;
        // Flicker: visible for 3 ticks, invisible for 3 ticks — use ticks countdown.
        const flickerHide = isInvulnerable && (Math.floor(cluster.invulnerabilityTicks / 3) % 2 === 0);
        if (flickerHide) {
          // Skip rendering this cluster for this flicker frame — still render cloak
          if (playerCloak !== undefined && cloakPlayerState !== undefined) {
            playerCloak.renderFront(ctx, offsetXPx, offsetYPx, scalePx, cloakPlayerState);
          }
          continue; // skip rest of player rendering
        }

        // ── Layer 1: Back cloak (behind body) ──────────────────────────
        if (playerCloak !== undefined) {
          playerCloak.renderBack(ctx, offsetXPx, offsetYPx, scalePx);
        }

        // ── Layer 2: Player body sprite ────────────────────────────────
        const outlineThicknessPx = PLAYER_OUTLINE_THICKNESS_WORLD * scalePx;
        const outlineMask = _getOrCreateOuterOutlineMask(sprite);
        const speedXWorldPerSec = cluster.velocityXWorld;
        const speedYWorldPerSec = cluster.velocityYWorld;
        const speedWorldPerSec = Math.sqrt(
          speedXWorldPerSec * speedXWorldPerSec + speedYWorldPerSec * speedYWorldPerSec,
        );
        if (speedWorldPerSec > PLAYER_AFTERIMAGE_MIN_SPEED_WORLD_PER_SEC) {
          const normX = speedXWorldPerSec / speedWorldPerSec;
          const normY = speedYWorldPerSec / speedWorldPerSec;
          for (let afterimageIndex = 0; afterimageIndex < PLAYER_AFTERIMAGE_COUNT; afterimageIndex++) {
            const t = (afterimageIndex + 1) / PLAYER_AFTERIMAGE_COUNT;
            const spacingPx = 3.0 * t;
            const drawCenterX = screenX - normX * spacingPx;
            const drawCenterY = spriteCenterY - normY * spacingPx;
            const alpha = 0.085 * (1.0 - t * 0.35);
            ctx.save();
            ctx.translate(Math.round(drawCenterX) - 0.5, Math.round(drawCenterY));
            if (cluster.isFacingLeftFlag === 1) {
              ctx.scale(-1, 1);
            }
            ctx.globalAlpha = alpha;
            ctx.drawImage(
              outlineMask,
              -(spritePivotX + outlineThicknessPx),
              -spriteHalfH - outlineThicknessPx,
              spriteW + outlineThicknessPx * 2,
              spriteH + outlineThicknessPx * 2,
            );
            ctx.drawImage(sprite, -spritePivotX, -spriteHalfH, spriteW, spriteH);
            ctx.restore();
          }
        }
        ctx.save();
        // Shift by -0.5 so that sprite edges (at ±9.5 / ±6.5 from pivot) land on
        // integer virtual pixels in both facing directions, preventing the edge-pixel
        // duplication artifact that appears under ctx.scale(-1, 1).
        ctx.translate(screenX - 0.5, spriteCenterY);
        if (cluster.isFacingLeftFlag === 1) {
          ctx.scale(-1, 1);
        }
        // Draw black outer silhouette first, then the original sprite on top.
        ctx.drawImage(
          outlineMask,
          -(spritePivotX + outlineThicknessPx),
          -spriteHalfH - outlineThicknessPx,
          spriteW + outlineThicknessPx * 2,
          spriteH + outlineThicknessPx * 2,
        );
        ctx.drawImage(sprite, -spritePivotX, -spriteHalfH, spriteW, spriteH);
        ctx.restore();

        // ── Hurt flash overlay: red tint while hurtTicks > 0 ─────────────
        if (cluster.hurtTicks > 0) {
          const flashAlpha = (cluster.hurtTicks / HURT_FLASH_DURATION_TICKS) * HURT_FLASH_MAX_ALPHA;
          ctx.save();
          ctx.globalAlpha = flashAlpha;
          ctx.fillStyle = '#ff2222';
          ctx.fillRect(screenX - spritePivotX, spriteCenterY - spriteHalfH, spriteW, spriteH);
          ctx.restore();
        }

        // ── Debug hitbox for player (only when showHitboxes is on) ────────
        if (showHitboxes) {
          // The sprite's top-left in screen space (constant regardless of facing).
          const spriteTopY = spriteCenterY - spriteHalfH; // = screenY - 14*scalePx
          // Determine state-adjusted hitbox in sprite pixel coordinates.
          // All measured from sprite top-left; y increases downward.
          const isAirborne = cluster.isGroundedFlag === 0;
          const isJumping  = isAirborne && cluster.velocityYWorld < 0;
          // Jumping (y 2–22): the debug rectangle is 2 px higher than the sim
          // hitbox (y 4–24 / PLAYER_HALF_HEIGHT_WORLD = 10).  The sim collision
          // box is intentionally left unchanged for jumping — only the debug
          // indicator shifts to reflect the intended visual hitbox placement.
          let hbTopPx   = isJumping ? 2 : 4;   // sprite y-pixel of hitbox top
          const hbBotPx = isJumping ? 22 : 24;  // sprite y-pixel of hitbox bottom
          // Derive x edges from the pivot constant so they stay in sync.
          const hbHalfWPx = PLAYER_HALF_WIDTH_WORLD; // 3.5
          const hbLeftPx  = PLAYER_SPRITE_PIVOT_X_WORLD - hbHalfWPx; // 9.5 - 3.5 = 6
          const hbRightPx = PLAYER_SPRITE_PIVOT_X_WORLD + hbHalfWPx; // 9.5 + 3.5 = 13
          // Crouching: sim already adjusted positionY and halfHeightWorld.
          // Use the documented sprite y 8–24 for the crouching indicator.
          if (cluster.isCrouchingFlag === 1) {
            hbTopPx = 8; // y 8–24, matching CROUCH_HALF_HEIGHT_WORLD = 8
          }
          const hbScreenLeft = screenX - spritePivotX + hbLeftPx  * scalePx;
          const hbScreenTop  = spriteTopY              + hbTopPx   * scalePx;
          const hbScreenW    = (hbRightPx - hbLeftPx) * scalePx;
          const hbScreenH    = (hbBotPx   - hbTopPx)  * scalePx;
          // Fast-fall: use actual sim half-width (already narrowed in sim).
          const isFastFalling = isAirborne && cluster.velocityYWorld > PLAYER_FAST_FALL_SPRITE_THRESHOLD_WORLD;
          const fastFallHbW    = cluster.halfWidthWorld * 2 * scalePx;
          const fastFallHbLeft = screenX - cluster.halfWidthWorld * scalePx;
          ctx.save();
          ctx.strokeStyle = 'rgba(0, 255, 100, 0.9)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          if (isFastFalling) {
            ctx.strokeRect(fastFallHbLeft, hbScreenTop, fastFallHbW, hbScreenH);
          } else {
            ctx.strokeRect(hbScreenLeft, hbScreenTop, hbScreenW, hbScreenH);
          }
          ctx.setLineDash([]);
          ctx.restore();
        }

        // ── Layer 3: Front cloak (in front of body) ────────────────────
        if (playerCloak !== undefined && cloakPlayerState !== undefined) {
          playerCloak.renderFront(ctx, offsetXPx, offsetYPx, scalePx, cloakPlayerState);
        }

        // ── Debug overlay (both cloak polygons + control points) ───────
        if (playerCloak !== undefined && isDebugCloak && cloakPlayerState !== undefined) {
          playerCloak.renderDebug(ctx, offsetXPx, offsetYPx, scalePx, cloakPlayerState);
        }
      } else {
        // Fallback while sprite loads: coloured box
        const spritePivotXFb = PLAYER_SPRITE_PIVOT_X_WORLD * scalePx;
        const spriteHFb = PLAYER_SPRITE_HEIGHT_WORLD * scalePx;
        ctx.fillStyle = '#00ff99';
        ctx.globalAlpha = 0.75;
        ctx.fillRect(screenX - spritePivotXFb, spriteCenterY - spriteHFb * 0.5, PLAYER_SPRITE_WIDTH_WORLD * scalePx, spriteHFb);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#00ff99';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX - spritePivotXFb, spriteCenterY - spriteHFb * 0.5, PLAYER_SPRITE_WIDTH_WORLD * scalePx, spriteHFb);
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
    } else if (cluster.isRockElementalFlag === 1) {
      // ── Rock Elemental: composite sprite (head + 2 arms) ────────────────
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
        if (_isSpriteReady(headSprite)) {
          ctx.drawImage(headSprite, screenX - headSize * 0.5, screenY - headSize * 0.3, headSize, headSize);
        }
        if (_isSpriteReady(arm1Sprite)) {
          ctx.drawImage(arm1Sprite, screenX - armSize * 1.4, screenY, armSize, armSize);
        }
        if (_isSpriteReady(arm2Sprite)) {
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
        
        if (_isSpriteReady(headSprite)) {
          ctx.drawImage(headSprite, screenX - headSize * 0.5, headY + bobOffset, headSize, headSize);
        }
        if (_isSpriteReady(arm1Sprite)) {
          ctx.drawImage(arm1Sprite, arm1X, arm1Y + bobOffset, armSize, armSize);
        }
        if (_isSpriteReady(arm2Sprite)) {
          ctx.drawImage(arm2Sprite, arm2X, arm2Y + bobOffset, armSize, armSize);
        }
      }

    } else if (cluster.isRadiantTetherFlag === 1) {
      // Radiant Tether boss body is rendered by radiantTetherRenderer.ts
      // Skip default cluster rendering; health bar drawn below.

    } else if (cluster.isGrappleHunterFlag === 1) {
      // ── Grapple Hunter: dark purple box with hook accent ────────────────
      ctx.fillStyle = '#8833cc';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(boxLeft, boxTop, boxW, boxH);
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#aa55ee';
      ctx.lineWidth = 2;
      ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      // Inner highlight
      ctx.fillStyle = 'rgba(200,150,255,0.3)';
      ctx.fillRect(boxLeft + 2, boxTop + 2, boxW - 4, 3);

      // Draw grapple chain during attack/reel states
      if (cluster.grappleHunterState === 2 || cluster.grappleHunterState === 3) {
        const tipScreenX = cluster.grappleHunterTipXWorld * scalePx + offsetXPx;
        const tipScreenY = cluster.grappleHunterTipYWorld * scalePx + offsetYPx;
        // Gold chain line
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(tipScreenX, tipScreenY);
        ctx.strokeStyle = 'rgba(255, 180, 50, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Tip dot
        ctx.beginPath();
        ctx.arc(tipScreenX, tipScreenY, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc00';
        ctx.fill();
      }

    } else if (cluster.isSlimeFlag === 1) {
      // ── Slime: green blob circle ──────────────────────────────────────────
      const healthRatio = cluster.maxHealthPoints > 0 ? cluster.healthPoints / cluster.maxHealthPoints : 1;
      _renderSlimeBody(ctx, screenX, screenY, boxHalfW, false, healthRatio);
    } else if (cluster.isLargeSlimeFlag === 1) {
      // ── Large Dust Slime: larger green blob with orbiting dust ────────────
      const healthRatio = cluster.maxHealthPoints > 0 ? cluster.healthPoints / cluster.maxHealthPoints : 1;
      _renderSlimeBody(ctx, screenX, screenY, boxHalfW, true, healthRatio);
      _renderLargeSlimeDustOrbit(ctx, screenX, screenY, cluster.largeSlimeDustOrbitAngleRad, boxHalfW);
    } else if (cluster.isWheelEnemyFlag === 1) {
      // ── Wheel Enemy: rolling circle with spokes ───────────────────────────
      _renderWheelEnemy(ctx, screenX, screenY, boxHalfW, cluster.wheelRollAngleRad);
    } else if (cluster.isBeetleFlag === 1) {
      // ── Golden Beetle: stub graphics — oval body with wing hints ─────────
      if (cluster.beetleIsFlightModeFlag === 1) {
        _renderBeetleFlying(ctx, screenX, screenY, boxHalfW);
      } else {
        _renderBeetleCrawling(
          ctx, screenX, screenY, boxHalfW,
          cluster.beetleSurfaceNormalXWorld,
          cluster.beetleSurfaceNormalYWorld,
        );
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
    // Player health bar is drawn in the HUD (top-left), not over the character.
    if (isPlayer) continue;

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
    } else if (cluster.isRockElementalFlag === 1) {
      barColor = '#8b6914'; // brown/amber for rock elemental
    } else if (cluster.isRadiantTetherFlag === 1) {
      barColor = '#fffde0'; // radiant white-gold for light boss
    } else if (cluster.isGrappleHunterFlag === 1) {
      barColor = '#aa55ee'; // purple for grapple hunter
    } else if (cluster.isSlimeFlag === 1) {
      barColor = '#44cc44';
    } else if (cluster.isLargeSlimeFlag === 1) {
      barColor = '#228822';
    } else if (cluster.isWheelEnemyFlag === 1) {
      barColor = '#cc8844';
    } else if (cluster.isBeetleFlag === 1) {
      barColor = '#ffd700'; // golden yellow for beetle
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

function _renderSlimeBody(
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

function _renderLargeSlimeDustOrbit(
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

function _renderWheelEnemy(
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

/**
 * Stub renderer for a crawling golden beetle.
 * Draws an oval body oriented according to the surface normal, with stubby legs.
 * The forward direction is the tangent to the surface (perpendicular to normal).
 */
function _renderBeetleCrawling(
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
function _renderBeetleFlying(
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

export function renderGrapple(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const hasActiveOrMiss = snapshot.isGrappleActiveFlag === 1 || snapshot.isGrappleMissActiveFlag === 1;
  if (!hasActiveOrMiss && snapshot.grappleAttachFxTicks <= 0) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined && snapshot.grappleAttachFxTicks <= 0) return;

  // Grapple visually originates from right-middle (or left-middle when facing left) of the sprite
  let px = 0;
  let py = 0;
  if (playerCluster !== undefined) {
    const halfW = playerCluster.halfWidthWorld * scalePx;
    const offsetDir = playerCluster.isFacingLeftFlag === 1 ? -1 : 1;
    px = playerCluster.positionXWorld * scalePx + offsetXPx + offsetDir * halfW;
    py = playerCluster.positionYWorld * scalePx + offsetYPx;
  }
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

  ctx.save();

  if (hasActiveOrMiss && playerCluster !== undefined) {
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

  if (hasActiveOrMiss && playerCluster !== undefined) {
    const dx = ax - px;
    const dy = ay - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const segmentCount = Math.max(1, Math.floor(dist / GRAPPLE_DUST_SEGMENT_PX));
    const dustSizePx = GRAPPLE_DUST_SIZE_PX * Math.max(1, scalePx * 0.5);

    if (_isSpriteReady(_grappleDustSprite)) {
      for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
        const t = segmentCount > 0 ? segmentIndex / segmentCount : 0;
        const sx = px + dx * t;
        const sy = py + dy * t;
        ctx.drawImage(_grappleDustSprite, sx - dustSizePx * 0.5, sy - dustSizePx * 0.5, dustSizePx, dustSizePx);
      }
    } else {
      for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
        const t = segmentCount > 0 ? segmentIndex / segmentCount : 0;
        const sx = px + dx * t;
        const sy = py + dy * t;
        ctx.fillStyle = 'rgba(255, 215, 0, 0.75)';
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }
  }

  const endSizePx = GRAPPLE_DUST_END_SIZE_PX * Math.max(1, scalePx * 0.5);
  if (_isSpriteReady(_grappleDustEndSprite)) {
    ctx.drawImage(_grappleDustEndSprite, ax - endSizePx * 0.5, ay - endSizePx * 0.5, endSizePx, endSizePx);
    if (hasActiveOrMiss && playerCluster !== undefined) {
      ctx.drawImage(_grappleDustEndSprite, px - endSizePx * 0.5, py - endSizePx * 0.5, endSizePx, endSizePx);
    }
  } else {
    ctx.beginPath();
    ctx.arc(ax, ay, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 200, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

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

  // ── Top-surface grapple special effect: rotating golden starburst at anchor ─
  if (snapshot.isGrappleTopSurfaceFlag === 1 && snapshot.isGrappleActiveFlag === 1) {
    /** Tick-to-radians scale for starburst rotation speed. */
    const STARBURST_TIME_SCALE = 0.12;
    /** Number of radiating rays in the starburst. */
    const STARBURST_RAY_COUNT = 8;
    /** Inner radius (px) where rays begin — keeps the center clear. */
    const STARBURST_INNER_RADIUS_PX = 2;
    /** Base outer radius (px) of the starburst rays. */
    const STARBURST_OUTER_BASE_PX = 8;
    /** Frequency of the pulsing outer-radius oscillation. */
    const STARBURST_PULSE_FREQUENCY = 3.0;
    /** Amplitude (px) of the pulsing oscillation on the outer radius. */
    const STARBURST_PULSE_AMPLITUDE_PX = 3;
    /** Radius (px) of the bright center glow circle. */
    const STARBURST_CENTER_GLOW_RADIUS_PX = 3;

    const starAx = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
    const starAy = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
    const time = snapshot.tick * STARBURST_TIME_SCALE;
    const pulseOuter = STARBURST_OUTER_BASE_PX +
      Math.sin(time * STARBURST_PULSE_FREQUENCY) * STARBURST_PULSE_AMPLITUDE_PX;

    // Radiating golden rays
    for (let r = 0; r < STARBURST_RAY_COUNT; r++) {
      const angle = time + (r / STARBURST_RAY_COUNT) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(starAx + cosA * STARBURST_INNER_RADIUS_PX, starAy + sinA * STARBURST_INNER_RADIUS_PX);
      ctx.lineTo(starAx + cosA * pulseOuter, starAy + sinA * pulseOuter);
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Bright center glow
    ctx.beginPath();
    ctx.arc(starAx, starAy, STARBURST_CENTER_GLOW_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 220, 0.95)';
    ctx.fill();

    // Outer pulsing ring (brighter when stuck / decelerating)
    const ringAlpha = snapshot.isGrappleStuckFlag === 1 ? 0.7 : 0.4;
    ctx.beginPath();
    ctx.arc(starAx, starAy, pulseOuter + 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 236, 170, ${ringAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}
